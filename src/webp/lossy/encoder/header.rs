//! The frame header and the modes of the macroblocks, RFC 6386 sections 9, 11 and 19.

use super::bool_writer::{BoolWriter, Symbol};
use super::luma;
use super::segments::{CHROMA_DC_DELTA, Segments};
use crate::array::At;
use crate::error::{Error, Result};
use crate::lossy::tables::{
    COEFFICIENT_UPDATE_PROBABILITIES, DEFAULT_COEFFICIENT_PROBABILITIES,
    SUBBLOCK_MODE_PROBABILITIES,
};
use crate::lossy::{
    CoefficientProbabilities, FRAME_HEADER_LEN, MacroblockMode, SEGMENTS, SIGNATURE,
    SUBBLOCK_MODES, SubblockMode,
};
use crate::slice::InBounds;

pub(super) const MAX_FIRST_PARTITION_LEN: usize = (1 << 19) - 1;

pub(super) struct Modes {
    pub(super) luma: luma::Mode,
    pub(super) chroma: MacroblockMode,
}

pub(super) fn uncompressed(
    width: usize,
    height: usize,
    first_partition_len: usize,
) -> Result<[u8; FRAME_HEADER_LEN]> {
    const IS_SHOWN: usize = 1 << 4;
    if first_partition_len > MAX_FIRST_PARTITION_LEN {
        return Err(Error::TooLarge);
    }
    let [t0, t1, t2, ..] = (IS_SHOWN | first_partition_len << 5).to_le_bytes();
    let [s0, s1, s2] = SIGNATURE;
    let ([w0, w1, ..], [h0, h1, ..]) = (width.to_le_bytes(), height.to_le_bytes());
    Ok([t0, t1, t2, s0, s1, s2, w0, w1, h0, h1])
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/syntax_enc.c#L274
pub(super) fn write_parameters(
    writer: &mut BoolWriter,
    segments: &Segments,
    filter_level: u8,
    probabilities: &CoefficientProbabilities,
) {
    // Color space, clamping type.
    writer.write_unsigned(0, 2);
    if writer.write_flag(segments.count > 1) {
        writer.write_flag(segments.map_probabilities.is_some());
        // The values follow, and they are absolute.
        writer.write_unsigned(0b11, 2);
        for segment in &segments.segments {
            writer.write_optional_signed(segment.quantizer_index as i8, 7);
        }
        for segment in &segments.segments {
            writer.write_optional_signed(segment.filter_level as i8, 6);
        }
        for probability in segments.map_probabilities.into_iter().flatten() {
            if writer.write_flag(probability != 255) {
                writer.write_unsigned(probability, 8);
            }
        }
    }
    // The normal filter.
    writer.write_flag(false);
    writer.write_unsigned(filter_level, 6);
    // No sharpness, no deltas to the level, one token partition.
    writer.write_unsigned(0, 3 + 1 + 2);
    writer.write_unsigned(segments.segments[0].quantizer_index, 7);
    for delta in [0, 0, 0, CHROMA_DC_DELTA, segments.chroma_ac_delta] {
        writer.write_optional_signed(delta, 4);
    }
    // The probabilities are not for later frames.
    writer.write_flag(false);
    let [probabilities, defaults, updates] = [
        probabilities,
        &DEFAULT_COEFFICIENT_PROBABILITIES,
        &COEFFICIENT_UPDATE_PROBABILITIES,
    ]
    .map(|it| it.as_flattened().as_flattened().as_flattened());
    for ((&probability, &default), &update) in probabilities.iter().zip(defaults).zip(updates) {
        if writer.write(probability != default, update) {
            writer.write_unsigned(probability, 8);
        }
    }
    // Macroblocks do not say whether they have coefficients.
    writer.write_flag(false);
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/tree_enc.c#L318
pub(super) fn write_modes(
    writer: &mut BoolWriter,
    segments: &Segments,
    modes: &[Modes],
    width: usize,
) {
    let width = width.max(1);
    let mut row_above: &[Modes] = &[];
    for (row, map) in modes.chunks(width).zip(segments.map.chunks(width)) {
        let mut left = [SubblockMode::Dc; 4];
        for (x, (modes, &segment)) in row.iter().zip(map).enumerate() {
            if let Some(probabilities) = segments.map_probabilities {
                write_segment(writer, segment, probabilities);
            }
            match modes.luma {
                luma::Mode::Whole(mode) => write_luma_mode(writer, mode),
                luma::Mode::Subblocks(subblocks) => {
                    writer.write(false, 145);
                    let above = row_above.get(x).map(|it| it.luma.bottom());
                    let above = above.unwrap_or([SubblockMode::Dc; 4]);
                    write_subblock_modes(writer, subblocks, above, left);
                }
            }
            write_chroma_mode(writer, modes.chroma);
            left = modes.luma.right();
        }
        row_above = row;
    }
}

fn write_segment(
    writer: &mut BoolWriter,
    segment: u8,
    [high, low_of_0, low_of_1]: [u8; SEGMENTS - 1],
) {
    let low = if writer.write(segment >= 2, high) {
        low_of_1
    } else {
        low_of_0
    };
    writer.write(segment & 1 != 0, low);
}

fn write_luma_mode(writer: &mut BoolWriter, mode: MacroblockMode) {
    use MacroblockMode::*;
    writer.write(true, 145);
    if writer.write(matches!(mode, TrueMotion | Horizontal), 156) {
        writer.write(mode == TrueMotion, 128);
    } else {
        writer.write(mode == Vertical, 163);
    }
}

/// By the modes above and to the left, the probabilities along the two longest ways through the tree of modes.
#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
static BRANCHES: [[[[u16; 8]; 2]; SUBBLOCK_MODES]; SUBBLOCK_MODES] = {
    const NODES: [[usize; 8]; 2] = [[0, 1, 2, 3, 4, 5, 0, 0], [0, 1, 2, 3, 6, 7, 8, 0]];
    let mut branches = [[[[0; 8]; 2]; SUBBLOCK_MODES]; SUBBLOCK_MODES];
    let mut i = 0;
    while i < SUBBLOCK_MODES * SUBBLOCK_MODES * 16 {
        let (above, left) = (i / 16 / SUBBLOCK_MODES, i / 16 % SUBBLOCK_MODES);
        let probability = SUBBLOCK_MODE_PROBABILITIES[above][left][NODES[i / 8 % 2][i % 8]];
        branches[above][left][i / 8 % 2][i % 8] = Symbol::new(false, probability).0;
        i += 1;
    }
    branches
};

fn write_subblock_modes(
    writer: &mut BoolWriter,
    modes: [[SubblockMode; 4]; 4],
    mut above: [SubblockMode; 4],
    left: [SubblockMode; 4],
) {
    /// For each mode, the bits and how many of them there are.
    static CODES: [[u16; 8]; SUBBLOCK_MODES] = [
        [0, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 2],
        [1, 1, 0, 0, 0, 0, 0, 3],
        [1, 1, 1, 0, 0, 0, 0, 5],
        [1, 1, 1, 0, 1, 0, 0, 6],
        [1, 1, 1, 0, 1, 1, 0, 6],
        [1, 1, 1, 1, 0, 0, 0, 5],
        [1, 1, 1, 1, 1, 0, 0, 6],
        [1, 1, 1, 1, 1, 1, 0, 7],
        [1, 1, 1, 1, 1, 1, 1, 7],
    ];
    let mut symbols = [0; 128 + 8];
    let mut len = 0;
    for (row, mut left) in modes.into_iter().zip(left) {
        for (mode, above) in row.into_iter().zip(above) {
            let code = CODES.at(mode as usize);
            let branches = BRANCHES.at(above as usize).at(left as usize);
            let branch = branches.at(code[3].into());
            let eight = core::array::from_fn(|i| branch.at(i) | code.at(i));
            symbols.set_chunk::<8>(len % 128, eight);
            len += usize::from(code[7]);
            left = mode;
        }
        above = row;
    }
    writer.write_all(symbols.iter().take(len).map(|&it| Symbol(it)));
}

fn write_chroma_mode(writer: &mut BoolWriter, mode: MacroblockMode) {
    use MacroblockMode::*;
    if writer.write(mode != Dc, 142) && writer.write(mode != Vertical, 114) {
        writer.write(mode != Horizontal, 183);
    }
}
