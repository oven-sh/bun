//! Brings every field that holds an address up to date. In place, at the old addresses: the bytes are moved afterwards.

use crate::bytes::{i32_at, offset, put_u32, put_u64, slice, slice_mut, u32_at, u64_at};
use crate::executable::Executable;
use crate::plan::{Options, Plan};
use crate::table::{Form, NO_UNIT, Table};
use crate::{Error, Result};

/// `bytes` is a copy of the file that `exe` describes. `base_shift`: how far the image base moves (Mach-O).
pub(crate) fn patch(
    t: &Table,
    o: &Options<'_>,
    p: &Plan,
    exe: &Executable<'_>,
    bytes: &mut [u8],
    base_shift: i64,
) -> Result<()> {
    let file_offset = |address: u64| {
        exe.file_offset(address)
            .ok_or(Error::TableOfAnotherExecutable)
    };

    for f in &t.fixups {
        if f.form == Form::None {
            continue;
        }
        let source = t.unit_at(f.place);
        if source != NO_UNIT && !p.is_unit_live[source as usize] {
            continue;
        }
        let at = file_offset(f.place)?;
        if f.target != NO_UNIT && !p.is_piece_live[f.target as usize] {
            match f.form {
                Form::Abs64Weak => put_u64(bytes, at, 0)?,
                Form::ChainRebaseWeak => {}
                _ => return Err(Error::Inconsistent),
            }
            continue;
        }
        let of_place = if source == NO_UNIT {
            0
        } else {
            p.delta[source as usize]
        };
        let of_target = if f.target == NO_UNIT {
            0
        } else {
            p.delta[f.target as usize]
        };
        match f.form {
            Form::None => {}
            Form::Abs64 | Form::Abs64Weak => {
                put_u64(bytes, at, offset(u64_at(bytes, at)?, of_target))?
            }
            Form::Abs32 => put_u32(
                bytes,
                at,
                u32_at(bytes, at)?.wrapping_add_signed(of_target as i32),
            )?,
            Form::Rel32 => {
                let distance = i64::from(i32_at(bytes, at)?) + of_target - of_place;
                put_u32(
                    bytes,
                    at,
                    i32::try_from(distance)
                        .map_err(|_| Error::Inconsistent)?
                        .cast_unsigned(),
                )?;
            }
            Form::Rel64 => put_u64(bytes, at, offset(u64_at(bytes, at)?, of_target - of_place))?,
            Form::Base32 => put_u32(
                bytes,
                at,
                u32_at(bytes, at)?.wrapping_add_signed((of_target - base_shift) as i32),
            )?,
            Form::ChainRebase | Form::ChainRebaseWeak => {
                const ADDRESS: u64 = 0xf_ffff_ffff;
                let value = u64_at(bytes, at)?;
                put_u64(
                    bytes,
                    at,
                    (value & !ADDRESS) | (offset(value & ADDRESS, of_target) & ADDRESS),
                )?;
            }
            Form::Branch26 => {
                let w = u32_at(bytes, at)?;
                let words = i64::from((w << 6).cast_signed() >> 6) + (of_target - of_place) / 4;
                if !(-(1 << 25)..1 << 25).contains(&words) {
                    return Err(Error::Inconsistent);
                }
                put_u32(bytes, at, (w & 0xfc00_0000) | (words as u32 & 0x03ff_ffff))?;
            }
            Form::Page21 => {
                let w = u32_at(bytes, at)?;
                let count = ((((w >> 5) & 0x7_ffff) << 2) | ((w >> 29) & 3)) << 11;
                let target = (f.place & !0xfff)
                    .wrapping_add_signed(i64::from(count.cast_signed() >> 11) * 4096)
                    + u64::from(f.extra);
                let pages = ((offset(target, of_target) & !0xfff).cast_signed()
                    - (offset(f.place, of_place) & !0xfff).cast_signed())
                    / 4096;
                if !(-(1 << 20)..1 << 20).contains(&pages) {
                    return Err(Error::Inconsistent);
                }
                let pages = pages as u32 & 0x1f_ffff;
                put_u32(
                    bytes,
                    at,
                    (w & 0x9f00_001f) | ((pages & 3) << 29) | ((pages >> 2) << 5),
                )?;
            }
            Form::PageOff12 => {
                let w = u32_at(bytes, at)?;
                let low =
                    (i64::from(((w >> 10) & 0xfff) << f.extra) + of_target).rem_euclid(4096) as u32;
                if low & ((1 << f.extra) - 1) != 0 {
                    return Err(Error::Inconsistent); // a scaled access would lose its alignment
                }
                put_u32(bytes, at, (w & 0xffc0_03ff) | ((low >> f.extra) << 10))?;
            }
        }
    }

    // Dead units of live pieces, and dead pieces that stay in place.
    for (u, unit) in t.units.iter().enumerate() {
        if p.is_unit_live[u] || unit.size == 0 {
            continue;
        }
        let area = t.area_of(unit.start);
        if area.is_some() && !p.is_piece_live[u] {
            continue; // it is simply not copied
        }
        let fill: &[u8] = area.map_or(&[0], |a| &t.areas[a].fill);
        let dead = slice_mut(bytes, file_offset(unit.start)?, unit.size as usize)?;
        for (byte, &fill) in dead.iter_mut().zip(fill.iter().cycle()) {
            *byte = fill;
        }
    }

    if !o.keeps_everything() {
        for patch in &t.patches {
            let unit = t.unit_at(patch.place);
            if o.is_excluded(patch.feature) && unit != NO_UNIT && p.is_unit_live[unit as usize] {
                slice_mut(bytes, file_offset(patch.place)?, patch.bytes.len())?
                    .copy_from_slice(&patch.bytes);
            }
        }
    }
    Ok(())
}

/// The bytes of an area after the move: what is live at its new place, the area's fill elsewhere.
pub(crate) fn moved(
    t: &Table,
    p: &Plan,
    exe: &Executable<'_>,
    bytes: &[u8],
    area: usize,
) -> Result<Vec<u8>> {
    let (low, high) = (t.areas[area].low, t.areas[area].high);
    let mut out: Vec<u8> = t.areas[area]
        .fill
        .iter()
        .copied()
        .cycle()
        .take((high - low) as usize)
        .collect();
    for run in &p.runs[area] {
        let length = (run.end - run.start) as usize;
        let from = slice(
            bytes,
            exe.file_offset(run.start)
                .ok_or(Error::TableOfAnotherExecutable)?,
            length,
        )?;
        let to = usize::try_from(offset(run.start, run.delta).wrapping_sub(low))
            .map_err(|_| Error::Inconsistent)?;
        out.get_mut(to..)
            .and_then(|o| o.get_mut(..length))
            .ok_or(Error::Inconsistent)?
            .copy_from_slice(from);
    }
    Ok(out)
}
