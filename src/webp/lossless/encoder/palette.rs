//! Images of up to 256 colors.

use super::sub;
use crate::array::At;
use crate::error::Result;
use crate::lossless::{Argb, BLACK, MAX_PALETTE_LEN, bundle_bits, color_cache_key, subsampled};
use crate::slice::InBounds;
use crate::vec;

/// Up to this many colors the transparent black stays in the palette, or the indices would be taken for bundled.
const MAX_LEN_STORED_IN_FULL: usize = 17;

/// What the bytes of an image of bytes stand for.
pub(super) type Colors = [Argb; MAX_PALETTE_LEN];

/// A byte for each pixel, what they stand for and those that are used, by their color. `None` if there are too many.
pub(super) fn index(
    rgba: &[[u8; 4]],
    to_argb: impl Fn([u8; 4]) -> Argb,
) -> Result<Option<(Vec<u8>, Box<Colors>, Vec<u8>)>> {
    const SLOT_BITS: u32 = 11;
    const CHUNK: usize = 16;
    let mut sorted: Vec<(Argb, u8)> = vec::with_room(MAX_PALETTE_LEN)?;
    // By hash, the color last looked up. It starts with ones that have another hash.
    let mut recent = vec::array::<_, { 1 << SLOT_BITS }>((0, 0))?;
    *recent.at_mut(0) = (1, 0);
    let mut index_of = |pixel| {
        let pixel = to_argb(pixel);
        let (color, index) = recent.at_mut(color_cache_key(pixel, SLOT_BITS));
        if *color != pixel {
            *color = pixel;
            *index = match sorted.binary_search_by_key(&pixel, |&(color, _)| color) {
                Ok(at) => sorted.value(at).1,
                Err(at) => {
                    let index = u8::try_from(sorted.len()).ok()?;
                    sorted.insert(at, (pixel, index));
                    index
                }
            };
        }
        Some(*index)
    };
    let mut indices = vec::with_room(rgba.len())?;
    let (chunks, rest) = rgba.as_chunks::<CHUNK>();
    for chunk @ &[first, ..] in chunks {
        let differ = |pixel| u32::from_ne_bytes(pixel) ^ u32::from_ne_bytes(first);
        let mut found = [0; CHUNK];
        if chunk.iter().fold(0, |bits, &pixel| bits | differ(pixel)) == 0 {
            let Some(index) = index_of(first) else {
                return Ok(None);
            };
            found.fill(index);
        } else {
            for (to, &pixel) in found.iter_mut().zip(chunk) {
                let Some(index) = index_of(pixel) else {
                    return Ok(None);
                };
                *to = index;
            }
        }
        indices.extend(found);
    }
    for &pixel in rest {
        let Some(index) = index_of(pixel) else {
            return Ok(None);
        };
        indices.push(index);
    }
    let (mut colors, mut used) = (vec::array(0)?, vec::with_room(sorted.len())?);
    for (color, index) in sorted {
        *colors.at_mut(index.into()) = color;
        used.push(index);
    }
    Ok(Some((indices, colors, used)))
}

pub(super) struct Palette {
    colors: Vec<Argb>,
    /// What stands for each of them.
    bytes: Vec<u8>,
}

impl Palette {
    /// Rearranges `bytes`, which are sorted by color, so that the differences between one color and the next are small.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/utils/palette.c#L187
    pub(super) fn new(all: &Colors, mut bytes: Vec<u8>) -> Result<Self> {
        let mut colors = vec::with_room(bytes.len())?;
        colors.extend(bytes.iter().map(|&byte| *all.at(byte.into())));

        let (mut go_up, mut go_down) = (0, 0);
        for difference in differences(&colors) {
            go_down |= difference & 0x0080_8080;
            go_up |= ((difference & 0x007f_7f7f) + 0x007f_7f7f) & !difference;
        }
        if go_up & go_down == 0 {
            return Ok(Self { colors, bytes });
        }
        let mut swap = |colors: &mut [Argb], a, b| {
            if let (Ok([a, b]), Ok([byte_a, byte_b])) = (
                colors.get_disjoint_mut([a, b]),
                bytes.get_disjoint_mut([a, b]),
            ) {
                core::mem::swap(a, b);
                core::mem::swap(byte_a, byte_b);
            }
        };
        let mut end = colors.len();
        if end > MAX_LEN_STORED_IN_FULL && colors.first() == Some(&0) {
            end -= 1;
            swap(&mut colors, 0, end);
        }
        let mut previous = 0;
        for next in 0..end {
            let unordered = colors.part(next..end).iter().zip(0..);
            let keys = unordered.map(|(&color, index)| distance(color, previous) << 8 | index);
            let nearest = keys.fold(u32::MAX, u32::min) as u8;
            swap(&mut colors, next, next + usize::from(nearest));
            previous = colors.value(next);
        }
        Ok(Self { colors, bytes })
    }

    pub(super) fn len(&self) -> usize {
        self.colors.len()
    }

    /// What gets stored: each color as the difference from the one before.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/vp8l_enc.c#L1442
    pub(super) fn stored(&self) -> Result<Vec<Argb>> {
        let colors = match self.colors.as_slice() {
            // An index behind the end stands for it.
            [rest @ .., 0] if self.len() > MAX_LEN_STORED_IN_FULL => rest,
            all => all,
        };
        let mut stored = vec::with_room(colors.len())?;
        stored.extend(differences(colors));
        Ok(stored)
    }

    /// The image of indices, and its width.
    pub(super) fn apply(&self, bytes: &[u8], width: usize) -> Result<(Vec<Argb>, usize)> {
        let mut indices = [0; MAX_PALETTE_LEN];
        for (index, &byte) in (0..=u8::MAX).zip(&self.bytes) {
            *indices.at_mut(byte.into()) = index;
        }
        let bits = bundle_bits(self.len());
        let bundles_per_row = subsampled(width, bits);
        let rows = bytes.chunks(width.max(1));
        let mut pixels = vec::with_room(bundles_per_row * rows.len())?;
        let bundle = match bits {
            0 => bundle::<1>,
            1 => bundle::<2>,
            2 => bundle::<4>,
            _ => bundle::<8>,
        };
        rows.for_each(|row| bundle(row, &indices, &mut pixels));
        Ok((pixels, bundles_per_row))
    }
}

fn bundle<const N: usize>(row: &[u8], indices: &[u8; MAX_PALETTE_LEN], to: &mut Vec<Argb>) {
    let pixel = |bytes: &[u8]| {
        let indices = bytes
            .iter()
            .map(|&byte| Argb::from(*indices.at(byte.into())));
        BLACK | indices.rfold(0, |green, index| green << (8 / N) | index) << 8
    };
    let (whole, rest) = row.as_chunks::<N>();
    to.extend(whole.iter().map(|bytes| pixel(bytes)));
    if !rest.is_empty() {
        to.push(pixel(rest));
    }
}

fn differences(colors: &[Argb]) -> impl Iterator<Item = Argb> {
    colors.iter().scan(0, |previous, &color| {
        Some(sub(color, core::mem::replace(previous, color)))
    })
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/utils/palette.c#L47
#[inline(always)]
fn distance(a: Argb, b: Argb) -> u32 {
    let difference = sub(a, b);
    let channel = |shift: u32| ((difference << (24 - shift)) as i32 >> 24).unsigned_abs();
    9 * (channel(0) + channel(8) + channel(16)) + channel(24)
}
