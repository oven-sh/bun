//! What the first partition says about each macroblock, RFC 6386 sections 10, 11 and 19.3.

use super::bool_reader::BoolReader;
use crate::array::At;
use crate::lossy::tables::SUBBLOCK_MODE_PROBABILITIES;
use crate::lossy::{MacroblockMode, SEGMENTS, SubblockMode};

pub(super) enum LumaMode {
    Whole(MacroblockMode),
    /// By row and column.
    Subblocks([[SubblockMode; 4]; 4]),
}

pub(super) fn read_segment(reader: &mut BoolReader, probabilities: [u8; SEGMENTS - 1]) -> usize {
    let [high, low_of_0, low_of_1] = probabilities;
    if reader.read(high) {
        2 + usize::from(reader.read(low_of_1))
    } else {
        usize::from(reader.read(low_of_0))
    }
}

/// `above` and `left` are the modes of the subblocks next to the macroblock, and become those along its far edges.
pub(super) fn read_luma_mode(
    reader: &mut BoolReader,
    above: &mut [SubblockMode; 4],
    left: &mut [SubblockMode; 4],
) -> LumaMode {
    if reader.read(145) {
        let mode = if reader.read(156) {
            match reader.read(128) {
                true => MacroblockMode::TrueMotion,
                false => MacroblockMode::Horizontal,
            }
        } else {
            match reader.read(163) {
                true => MacroblockMode::Vertical,
                false => MacroblockMode::Dc,
            }
        };
        *above = [mode.into(); 4];
        *left = [mode.into(); 4];
        return LumaMode::Whole(mode);
    }
    let mut modes = [*above; 4];
    for (row, left) in modes.iter_mut().zip(left) {
        for above in &mut *above {
            *left = read_subblock_mode(reader, *above, *left);
            *above = *left;
        }
        *row = *above;
    }
    LumaMode::Subblocks(modes)
}

#[inline(always)]
fn read_subblock_mode(
    reader: &mut BoolReader,
    above: SubblockMode,
    left: SubblockMode,
) -> SubblockMode {
    let probabilities = SUBBLOCK_MODE_PROBABILITIES.at(above as usize);
    let probabilities = probabilities.at(left as usize);
    let mut read = |node| reader.read(*probabilities.at(node));
    if !read(0) {
        SubblockMode::Dc
    } else if !read(1) {
        SubblockMode::TrueMotion
    } else if !read(2) {
        SubblockMode::Vertical
    } else if !read(3) {
        if !read(4) {
            SubblockMode::Horizontal
        } else if !read(5) {
            SubblockMode::RightDown
        } else {
            SubblockMode::VerticalRight
        }
    } else if !read(6) {
        SubblockMode::LeftDown
    } else if !read(7) {
        SubblockMode::VerticalLeft
    } else if !read(8) {
        SubblockMode::HorizontalDown
    } else {
        SubblockMode::HorizontalUp
    }
}

pub(super) fn read_chroma_mode(reader: &mut BoolReader) -> MacroblockMode {
    if !reader.read(142) {
        MacroblockMode::Dc
    } else if !reader.read(114) {
        MacroblockMode::Vertical
    } else if reader.read(183) {
        MacroblockMode::TrueMotion
    } else {
        MacroblockMode::Horizontal
    }
}
