//! Reads the fixups off the executable.
//!
//! Nearly all of a table is fixups, and nearly everything about a fixup is in the executable already:
//! - WHAT it refers to: the field holds the address. Decode it and see which unit that is.
//! - WHERE it is: a `call`, a `bl`, an `adrp`, a pointer the loader is told about can be told by their bytes.
//! - HOW it is encoded follows from which of those it is.
//!
//! So the table does not list them. [`scan`] walks the executable by a fixed rule and asks a series of questions. When the
//! table is made ([`crate::compact`]) every answer is known, from the linker's own relocations, and is written down; when
//! it is used ([`crate::expand`]) the same walk asks the same questions in the same order and reads the answers. What
//! the walk never asks about is listed outright.
//!
//! Nothing is decided here. The rule does not have to be right about anything, only repeatable: where it would be wrong,
//! the recorded answer says so. How good the rule is decides how small the table is and nothing else. The build checks
//! that the table expands to what it was made from, field for field, and the table carries a checksum of that, so that it
//! is refused for any other bytes.

use crate::Result;
use crate::bytes::{i32_at, u32_at, u64_at};
use crate::executable::Executable;
use crate::table::{Arch, Container, Fixup, Form, NO_UNIT, Table};

/// What a question is about. The answers to each kind are kept apart, because how often it is "yes" differs a lot.
#[derive(Clone, Copy)]
pub(crate) enum Kind {
    Pointer,
    Call,
    Jump,
    ConditionalJump,
    IpRelative,
    /// `mov $address, %r32`
    MoveAddress,
    /// `address(, %index, scale)`
    IndexedAddress,
    /// `address(%base)`
    DisplacedAddress,
    /// `movq $address, memory or register`, `cmp $address, register`
    StoredAddress,
    AnyAddress,
    Branch,
    Page,
    PageOffset,
}

impl Kind {
    pub(crate) const COUNT: usize = 13;

    /// The answer that is not written down: only how many of these lie between two of the other.
    pub(crate) fn usual_answer(index: usize) -> bool {
        const NO: [usize; 4] = [
            Kind::ConditionalJump as usize,
            Kind::DisplacedAddress as usize,
            Kind::StoredAddress as usize,
            Kind::AnyAddress as usize,
        ];
        !NO.contains(&index)
    }
}

pub(crate) trait Answers {
    /// Is there a fixup of this form at `place`?
    fn is_fixup(&mut self, kind: Kind, place: u64, form: Form) -> Result<bool>;
    /// The unit the fixup at `place` refers to, given the one its field decodes to.
    fn target(&mut self, place: u64, form: Form, decoded: u32) -> Result<u32>;
    /// The low 12 bits of what the `adrp` at `place` refers to, given those of the first instruction that uses its result.
    fn low_bits(&mut self, place: u64, of_first_use: Option<u16>) -> Result<u16>;
}

/// `table` needs its units, areas and code ranges. The fixups come back in the order they were found.
pub(crate) fn scan(
    table: &Table,
    exe: &Executable<'_>,
    answers: &mut impl Answers,
) -> Result<Vec<Fixup>> {
    let mut piece_of = vec![0u32; table.units.len()];
    let mut piece = 0;
    for (u, unit) in table.units.iter().enumerate() {
        if unit.starts_piece() {
            piece = u as u32;
        }
        piece_of[u] = piece;
    }
    let mut found = Vec::new();

    exe.for_each_pointer(|place| {
        let value = u64_at(exe.at(place, 8)?, 0)?;
        let (address, form) = match table.format.container {
            Container::MachO if exe.is_weak_slot(place) => {
                (value & 0xf_ffff_ffff, Form::ChainRebaseWeak)
            }
            Container::MachO => (value & 0xf_ffff_ffff, Form::ChainRebase),
            Container::Elf | Container::Pe => (value.wrapping_sub(exe.pointer_base), Form::Abs64),
        };
        let decoded = table.unit_at(address);
        if decoded != NO_UNIT && answers.is_fixup(Kind::Pointer, place, form)? {
            found.push(Fixup {
                place,
                form,
                target: answers.target(place, form, decoded)?,
                extra: 0,
            });
        }
        Ok(())
    })?;

    for &(low, high) in &table.code {
        let first = table.units.partition_point(|u| u.start < low);
        for (u, unit) in table
            .units
            .iter()
            .enumerate()
            .skip(first)
            .take_while(|(_, unit)| unit.start < high)
        {
            let code = Code {
                table,
                exe,
                piece_of: &piece_of,
                piece: piece_of[u],
                start: unit.start,
                bytes: exe.at(unit.start, unit.size)?,
            };
            match table.format.arch {
                Arch::Arm64 => code.scan_arm64(answers, &mut found)?,
                Arch::X64 => code.scan_x64(answers, &mut found)?,
            }
        }
    }
    Ok(found)
}

/// An `adrp`, which says the page of what it refers to. The rest is in the instruction that uses its result.
struct Page {
    fixup: usize,
    page: u64,
    is_resolved: bool,
}

/// The instructions of one unit.
struct Code<'a> {
    table: &'a Table,
    exe: &'a Executable<'a>,
    piece_of: &'a [u32],
    piece: u32,
    start: u64,
    bytes: &'a [u8],
}

impl Code<'_> {
    /// A distance inside a piece does not change, so it is no fixup, and no question.
    fn leaves_the_piece(&self, address: u64) -> bool {
        let unit = self.table.unit_at(address);
        unit == NO_UNIT || self.piece_of[unit as usize] != self.piece
    }

    fn moves(&self, unit: u32) -> bool {
        unit != NO_UNIT
            && self
                .table
                .area_of(self.table.units[unit as usize].start)
                .is_some()
    }

    /// `at` is where a 4-byte field would start. What precedes it says what kind of field it could be.
    fn scan_x64(&self, answers: &mut impl Answers, found: &mut Vec<Fixup>) -> Result<()> {
        // Not position independent: code holds 32-bit addresses.
        let has_addresses = self.table.format.container == Container::Elf;
        let b = self.bytes;
        let mut at = 1;
        while at + 4 <= b.len() {
            let place = self.start + at as u64;
            let before = b[at - 1];
            let before2 = if at >= 2 { b[at - 2] } else { 0 };
            let kind = match before {
                0xe8 => Some(Kind::Call),
                0xe9 => Some(Kind::Jump),
                _ if before & 0xc7 == 0x05 => Some(Kind::IpRelative),
                0x80..=0x8f if at >= 2 && before2 == 0x0f => Some(Kind::ConditionalJump),
                _ => None,
            };
            if let Some(kind) = kind {
                // An operand that follows the field makes the address fall short of what is meant, by up to 8 bytes.
                let address = (place + 4).cast_signed() + i64::from(i32_at(b, at)?);
                let is_in_the_image = address >= self.exe.low.cast_signed() - 8
                    && address < self.exe.high.cast_signed();
                let address = address.cast_unsigned();
                if is_in_the_image
                    && self.leaves_the_piece(address)
                    && answers.is_fixup(kind, place, Form::Rel32)?
                {
                    let target = answers.target(place, Form::Rel32, self.table.unit_at(address))?;
                    found.push(Fixup {
                        place,
                        form: Form::Rel32,
                        target,
                        extra: 0,
                    });
                    at += 4;
                    continue;
                }
            }
            if has_addresses {
                let address = u64::from(u32_at(b, at)?);
                if address >= self.exe.low && address < self.exe.high {
                    let kind = if (0xb8..=0xbf).contains(&before) {
                        Kind::MoveAddress
                    } else if before2 & 0xc7 == 0x04 && before & 7 == 5 {
                        Kind::IndexedAddress
                    } else if before & 0xc0 == 0x80 || (before2 & 0xc0 == 0x80 && before2 & 7 == 4)
                    {
                        Kind::DisplacedAddress
                    } else if (at >= 4 && b[at - 4] == 0xc7)
                        || (at >= 5 && b[at - 5] == 0xc7)
                        || before2 == 0xc7
                        || before2 == 0x81
                    {
                        Kind::StoredAddress
                    } else {
                        Kind::AnyAddress
                    };
                    if answers.is_fixup(kind, place, Form::Abs32)? {
                        let target =
                            answers.target(place, Form::Abs32, self.table.unit_at(address))?;
                        found.push(Fixup {
                            place,
                            form: Form::Abs32,
                            target,
                            extra: 0,
                        });
                        at += 4;
                        continue;
                    }
                }
            }
            at += 1;
        }
        Ok(())
    }

    fn resolve(
        &self,
        page: &mut Page,
        of_first_use: Option<u16>,
        found: &mut [Fixup],
        answers: &mut impl Answers,
    ) -> Result<()> {
        page.is_resolved = true;
        let fixup = &mut found[page.fixup];
        let low = answers.low_bits(fixup.place, of_first_use)?;
        fixup.target = answers.target(
            fixup.place,
            Form::Page21,
            self.table.unit_at(page.page + u64::from(low)),
        )?;
        // Of what stays, the page is all that is needed.
        fixup.extra = if fixup.target == NO_UNIT { 0 } else { low };
        Ok(())
    }

    fn scan_arm64(&self, answers: &mut impl Answers, found: &mut Vec<Fixup>) -> Result<()> {
        let mut pages: Vec<Page> = Vec::new();
        // The last `adrp` into each register, until the register is seen to be overwritten.
        let mut in_register = [None::<usize>; 32];

        for (i, word) in self.bytes.as_chunks::<4>().0.iter().enumerate() {
            let place = self.start + 4 * i as u64;
            let w = u32::from_le_bytes(*word);
            if w & 0x7c00_0000 == 0x1400_0000 {
                let address = place.wrapping_add_signed(i64::from((w << 6).cast_signed() >> 6) * 4);
                if address >= self.exe.low
                    && address < self.exe.high
                    && self.leaves_the_piece(address)
                    && answers.is_fixup(Kind::Branch, place, Form::Branch26)?
                {
                    let target =
                        answers.target(place, Form::Branch26, self.table.unit_at(address))?;
                    found.push(Fixup {
                        place,
                        form: Form::Branch26,
                        target,
                        extra: 0,
                    });
                }
            } else if w & 0x9f00_0000 == 0x9000_0000 {
                if !answers.is_fixup(Kind::Page, place, Form::Page21)? {
                    continue;
                }
                let count = ((((w >> 5) & 0x7_ffff) << 2) | ((w >> 29) & 3)) << 11;
                let page = (place & !0xfff)
                    .wrapping_add_signed(i64::from(count.cast_signed() >> 11) * 4096);
                in_register[(w & 31) as usize] = Some(pages.len());
                pages.push(Page {
                    fixup: found.len(),
                    page,
                    is_resolved: false,
                });
                found.push(Fixup {
                    place,
                    form: Form::Page21,
                    target: NO_UNIT,
                    extra: 0,
                });
            } else {
                let is_add = w & 0xffc0_0000 == 0x9100_0000;
                let is_load_or_store = w & 0x3b00_0000 == 0x3900_0000;
                if !is_add && !is_load_or_store {
                    continue;
                }
                // A load or store scales its offset by the size of the access; 128-bit accesses are encoded apart.
                let log2_scale = if is_add {
                    0
                } else if w & 0x0400_0000 != 0 && w & 0x0080_0000 != 0 {
                    4
                } else {
                    (w >> 30) as u16
                };
                if let Some(p) = in_register[((w >> 5) & 31) as usize] {
                    if !pages[p].is_resolved {
                        self.resolve(
                            &mut pages[p],
                            Some((((w >> 10) & 0xfff) as u16) << log2_scale),
                            found,
                            answers,
                        )?;
                    }
                    let of_page = found[pages[p].fixup].target;
                    if self.moves(of_page)
                        && answers.is_fixup(Kind::PageOffset, place, Form::PageOff12)?
                    {
                        let target = answers.target(place, Form::PageOff12, of_page)?;
                        found.push(Fixup {
                            place,
                            form: Form::PageOff12,
                            target,
                            extra: log2_scale,
                        });
                    }
                }
                // An add, or a load into a general register, overwrites its destination.
                if is_add || (w & 0x0400_0000 == 0 && w & 0x00c0_0000 != 0) {
                    in_register[(w & 31) as usize] = None;
                }
            }
        }
        for page in pages.iter_mut().filter(|p| !p.is_resolved) {
            self.resolve(page, None, found, answers)?;
        }
        Ok(())
    }
}
