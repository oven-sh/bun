//! `palette.c`: collects the colours of an image and orders them.

use crate::util::{Checked, SliceExt};
use crate::vp8l::enc::color_cache::hash_pix;
use crate::vp8l::enc::format::MAX_PALETTE_SIZE;
use crate::vp8l::enc::predictors::sub_pixels;

/// Up to `MAX_PALETTE_SIZE` colours.
#[derive(Clone, Copy)]
pub(crate) struct Palette {
    colors: [u32; MAX_PALETTE_SIZE],
    size: usize,
}

impl Palette {
    pub(crate) fn colors(&self) -> &[u32] {
        self.colors.get(..self.size).unwrap_or_default()
    }

    fn colors_mut(&mut self) -> &mut [u32] {
        self.colors.get_mut(..self.size).unwrap_or_default()
    }
}

const fn palette_component_distance(v: u32) -> u32 {
    if v <= 128 { v } else { 256 - v }
}

/// Goes up with the entropy that writing `col1` after `col2` adds.
fn palette_color_distance(col1: u32, col2: u32) -> u32 {
    const MORE_WEIGHT_FOR_RGB_THAN_FOR_ALPHA: u32 = 9;
    let [b, g, r, a] = sub_pixels(col1, col2)
        .to_le_bytes()
        .map(|diff| palette_component_distance(diff.into()));
    (b + g + r) * MORE_WEIGHT_FOR_RGB_THAN_FOR_ALPHA + a
}

/// `GetColorPalette`: the colours of `argb` in increasing order, if there are no more than `MAX_PALETTE_SIZE`.
pub(crate) fn get_color_palette(argb: &[u32]) -> Checked<Option<Palette>> {
    const COLOR_HASH_SIZE: usize = MAX_PALETTE_SIZE * 4;
    const COLOR_HASH_RIGHT_SHIFT: u32 = 22;
    let mut colors = [None; COLOR_HASH_SIZE];
    let mut num_colors = 0;
    let mut last_pix = None;
    for &pix in argb {
        if Some(pix) == last_pix {
            continue;
        }
        last_pix = Some(pix);
        let mut key = hash_pix(pix, COLOR_HASH_RIGHT_SHIFT) as usize;
        loop {
            let slot = colors.at_mut(key)?;
            if slot.is_none() {
                *slot = last_pix;
                num_colors += 1;
                if num_colors > MAX_PALETTE_SIZE {
                    return Ok(None);
                }
                break;
            } else if *slot == last_pix {
                break;
            }
            key = (key + 1) & (COLOR_HASH_SIZE - 1);
        }
    }

    let mut palette = Palette {
        colors: [0; MAX_PALETTE_SIZE],
        size: num_colors,
    };
    for (out, color) in palette.colors.iter_mut().zip(colors.into_iter().flatten()) {
        *out = color;
    }
    palette.colors_mut().sort_unstable();
    Ok(Some(palette))
}

/// Whether red, green or blue goes both up and down along the palette. If none does, as in a grey image or an alpha
/// plane, there is nothing to gain from another order.
fn palette_has_non_monotonous_deltas(palette: &[u32]) -> bool {
    let mut predict = 0;
    let mut sign_found = 0u32;
    for &color in palette {
        let [bd, gd, rd, _] = sub_pixels(color, predict).to_le_bytes();
        if rd != 0 {
            sign_found |= if rd < 0x80 { 1 } else { 2 };
        }
        if gd != 0 {
            sign_found |= if gd < 0x80 { 8 } else { 16 };
        }
        if bd != 0 {
            sign_found |= if bd < 0x80 { 64 } else { 128 };
        }
        predict = color;
    }
    sign_found & (sign_found << 1) != 0
}

/// `PaletteSortMinimizeDeltas`: each colour is followed by the nearest of those that are left, because the palette is
/// written as the differences between its colours.
pub(crate) fn palette_sort_minimize_deltas(palette_sorted: &Palette) -> Checked<Palette> {
    let mut palette = *palette_sorted;
    if !palette_has_non_monotonous_deltas(palette_sorted.colors()) {
        return Ok(palette);
    }
    let mut colors = palette.colors_mut();
    // A transparent black at the end need not be written, if the indices are not packed.
    if colors.len() > 17 && colors.first() == Some(&0) {
        let last = colors.len() - 1;
        colors.swap(0, last);
        colors = colors.sub_mut(..last)?;
    }
    let mut predict = 0;
    for i in 0..colors.len() {
        let mut best_ix = i;
        let mut best_score = u32::MAX;
        for (k, &color) in colors.iter().enumerate().skip(i) {
            let cur_score = palette_color_distance(color, predict);
            if best_score > cur_score {
                best_score = cur_score;
                best_ix = k;
            }
        }
        colors.swap(best_ix, i);
        predict = colors.at(i)?;
    }
    Ok(palette)
}
