//! Pixels in memory.

use std::ptr::NonNull;

use super::formats::{bytes_per_pixel, components};
use super::gl::*;
use crate::abi_webgl::Unpacking;

pub fn to_half(value: f32) -> u16 {
    let (bits, sign) = (
        value.to_bits() & 0x7fff_ffff,
        (value.to_bits() >> 16) as u16 & 0x8000,
    );
    sign | match bits >> 23 {
        255 => 0x7c00 | u16::from(value.is_nan()) << 9,
        143.. => 0x7c00,
        113.. => ((bits - (112 << 23) + 0xfff + (bits >> 13 & 1)) >> 13) as u16,
        _ => (f32::from_bits(bits) * 16_777_216.).round_ties_even() as u16,
    }
}

pub fn from_half(half: u16) -> f32 {
    let (magnitude, sign) = (u32::from(half & 0x7fff), u32::from(half & 0x8000) << 16);
    f32::from_bits(
        sign | match magnitude >> 10 {
            0 => (magnitude as f32 / 16_777_216.).to_bits(),
            31 => magnitude << 13 | 0x7f80_0000,
            _ => (magnitude << 13) + (112 << 23),
        },
    )
}

/// `None` if there is no memory.
pub fn zeroed(length: usize) -> Option<Vec<u8>> {
    let capacity = length.max(1);
    // SAFETY: the size is not zero.
    let bytes = NonNull::new(unsafe {
        std::alloc::alloc_zeroed(std::alloc::Layout::array::<u8>(capacity).ok()?)
    })?;
    // SAFETY: the global allocator has made it with the layout of that many bytes, which are initialized.
    Some(unsafe { Vec::from_raw_parts(bytes.as_ptr(), length, capacity) })
}

/// Where the rows of an image are, in bytes.
pub struct Layout {
    pub start: u64,
    pub row: u64,
    pub row_stride: u64,
    /// 0 if there are no pixels, and the largest number if it is too much for the 31 bits in which drivers count.
    pub end: u64,
}

impl Layout {
    pub fn new(
        store: &Unpacking,
        format: u32,
        kind: u32,
        size: [u32; 3],
        has_layers: bool,
    ) -> Layout {
        let (pixel, [width, height, depth], skip) = (
            u64::from(bytes_per_pixel(format, kind)),
            size.map(u64::from),
            store.skip.map(u64::from),
        );
        let or = |given: u32, otherwise: u64| if given > 0 { given.into() } else { otherwise };
        let row_stride =
            (or(store.row_length, width) * pixel).next_multiple_of(store.alignment.max(1).into());
        let image_stride = if has_layers {
            or(store.image_height, height).saturating_mul(row_stride)
        } else {
            0
        };
        let offset = |images: u64, rows: u64, pixels: u64| {
            images
                .saturating_mul(image_stride)
                .saturating_add(rows.saturating_mul(row_stride))
                .saturating_add(pixels * pixel)
        };
        let start = offset(skip[2], skip[1], skip[0]);
        let end = if size.contains(&0) {
            0
        } else {
            start.saturating_add(offset(depth - 1, height - 1, width))
        };
        let is_too_much = end > 0 && end.max(row_stride).max(image_stride) > i32::MAX as u64;
        Layout {
            start,
            row: width * pixel,
            row_stride,
            end: if is_too_much { u64::MAX } else { end },
        }
    }
}

pub fn premultiply([red, green, blue, alpha]: [u8; 4]) -> [u8; 4] {
    let scale = |it: u8| ((u32::from(it) * u32::from(alpha) + 127) / 255) as u8;
    [scale(red), scale(green), scale(blue), alpha]
}

pub fn unpremultiply([red, green, blue, alpha]: [u8; 4]) -> [u8; 4] {
    let scale = |it: u8| {
        (u32::from(it) * 255 + u32::from(alpha) / 2)
            .checked_div(alpha.into())
            .map_or(it, |it| it.min(255) as u8)
    };
    [scale(red), scale(green), scale(blue), alpha]
}

/// The widths of the fields, from the highest bits.
fn fields(kind: u32) -> [u32; 4] {
    match kind {
        UNSIGNED_SHORT_4_4_4_4 => [4, 4, 4, 4],
        UNSIGNED_SHORT_5_5_5_1 => [5, 5, 5, 1],
        _ => [5, 6, 5, 0],
    }
}

fn scale_last<T: Copy, const N: usize>(
    row: &mut [u8],
    count: usize,
    read: fn([u8; N]) -> T,
    write: fn(T) -> [u8; N],
    multiply: fn(T, T) -> T,
) {
    for pixel in row.as_chunks_mut().0.chunks_exact_mut(count) {
        if let [colors @ .., alpha] = pixel {
            colors
                .iter_mut()
                .for_each(|it| *it = write(multiply(read(*it), read(*alpha))));
        }
    }
}

pub fn premultiply_row(row: &mut [u8], format: u32, kind: u32) {
    let count = components(format) as usize;
    match kind {
        _ if !matches!(format, RGBA | SRGB_ALPHA_EXT | LUMINANCE_ALPHA) => {}
        UNSIGNED_BYTE => scale_last(row, count, u8::from_ne_bytes, u8::to_ne_bytes, |a, b| {
            premultiply([a, 0, 0, b])[0]
        }),
        UNSIGNED_SHORT => scale_last(row, count, u16::from_ne_bytes, u16::to_ne_bytes, |a, b| {
            ((u32::from(a) * u32::from(b) + 32767) / 65535) as u16
        }),
        HALF_FLOAT | HALF_FLOAT_OES => {
            scale_last(row, count, u16::from_ne_bytes, u16::to_ne_bytes, |a, b| {
                to_half(from_half(a) * from_half(b))
            })
        }
        FLOAT => scale_last(row, count, f32::from_ne_bytes, f32::to_ne_bytes, |a, b| {
            a * b
        }),
        _ => {}
    }
    for pixel in row
        .as_chunks_mut()
        .0
        .iter_mut()
        .filter(|_| matches!(kind, UNSIGNED_SHORT_4_4_4_4 | UNSIGNED_SHORT_5_5_5_1))
    {
        let value = u16::from_ne_bytes(*pixel);
        let scaled = |shift: u16| (((value >> shift & 15) * (value & 15) + 7) / 15) << shift;
        *pixel = if kind == UNSIGNED_SHORT_5_5_5_1 {
            value * (value & 1)
        } else {
            scaled(12) | scaled(8) | scaled(4) | value & 15
        }
        .to_ne_bytes();
    }
}

/// Appends a row in the format that a texture is given.
pub fn convert_row(row: impl Iterator<Item = [u8; 4]>, format: u32, kind: u32, out: &mut Vec<u8>) {
    let (first, count) = (
        if format == ALPHA { 3 } else { 0 },
        components(format) as usize,
    );
    let channels = row.map(|it| {
        if format == LUMINANCE_ALPHA {
            [it[0], it[3], 0, 0]
        } else {
            it
        }
    });
    let share = |it: u8| f32::from(it) / 255.;
    let scaled = |it: u8, bits: u32| (u32::from(it) * ((1 << bits) - 1) + 127) / 255;
    match kind {
        UNSIGNED_BYTE if count == 4 => out.extend(channels.flatten()),
        UNSIGNED_BYTE => channels.for_each(|it| out.extend_from_slice(&it[first..first + count])),
        UNSIGNED_SHORT => channels
            .for_each(|it| out.extend(it[first..first + count].iter().flat_map(|it| [*it; 2]))),
        FLOAT => channels.for_each(|it| {
            out.extend(
                it[first..first + count]
                    .iter()
                    .flat_map(|it| share(*it).to_ne_bytes()),
            )
        }),
        HALF_FLOAT | HALF_FLOAT_OES => channels.for_each(|it| {
            out.extend(
                it[first..first + count]
                    .iter()
                    .flat_map(|it| to_half(share(*it)).to_ne_bytes()),
            )
        }),
        UNSIGNED_INT_2_10_10_10_REV => out.extend(channels.flat_map(|it| {
            (scaled(it[0], 10)
                | scaled(it[1], 10) << 10
                | scaled(it[2], 10) << 20
                | scaled(it[3], 2) << 30)
                .to_ne_bytes()
        })),
        UNSIGNED_INT_10F_11F_11F_REV => {
            let small = |it: u8, dropped: u32| {
                (u32::from(to_half(share(it))) + (1 << dropped >> 1)) >> dropped
            };
            out.extend(channels.flat_map(|it| {
                (small(it[0], 4) | small(it[1], 4) << 11 | small(it[2], 5) << 22).to_ne_bytes()
            }));
        }
        _ => out.extend(channels.flat_map(|it| {
            (it.iter()
                .zip(fields(kind))
                .fold(0, |all, (it, bits)| all << bits | scaled(*it, bits)) as u16)
                .to_ne_bytes()
        })),
    }
}
