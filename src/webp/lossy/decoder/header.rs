//! The frame header, RFC 6386 sections 9 and 19.2.

use bun_highway::webp::FilterStrength;

use super::bool_reader::BoolReader;
use super::residuals::{Probabilities, Quantizers};
use crate::array::At;
use crate::error::{Error, Result};
use crate::lossy::tables::{AC_QUANTIZERS, DC_QUANTIZERS};
use crate::lossy::{FRAME_HEADER_LEN, SEGMENTS, SIGNATURE};

const MAX_PARTITIONS: usize = 8;

/// The part of the frame header that is not compressed.
pub(crate) struct Header<'a> {
    pub(crate) width: u16,
    pub(crate) height: u16,
    first_partition_len: usize,
    rest: &'a [u8],
}

impl<'a> Header<'a> {
    pub(crate) fn parse(bytes: &'a [u8], declared_len: usize) -> Result<Self> {
        let (&[t0, t1, t2, s0, s1, s2, w0, w1, h0, h1], rest) = bytes
            .split_first_chunk::<FRAME_HEADER_LEN>()
            .ok_or(Error::UnexpectedEof)?;
        let tag = u32::from_le_bytes([t0, t1, t2, 0]);
        let is_key_frame = tag & 1 == 0;
        let version = (tag >> 1) & 7;
        let is_shown = (tag >> 4) & 1 != 0;
        let first_partition_len = (tag >> 5) as usize;
        // The two highest bits suggest an upscaling.
        let width = u16::from_le_bytes([w0, w1]) & 0x3fff;
        let height = u16::from_le_bytes([h0, h1]) & 0x3fff;
        if [s0, s1, s2] != SIGNATURE
            || !is_key_frame
            || version > 3
            || !is_shown
            || first_partition_len >= declared_len
            || width == 0
            || height == 0
        {
            return Err(Error::InvalidLossyFrame);
        }
        Ok(Self {
            width,
            height,
            first_partition_len,
            rest,
        })
    }

    /// Columns and rows.
    pub(super) fn macroblocks(&self) -> [usize; 2] {
        [self.width, self.height].map(|it| usize::from(it.div_ceil(16)))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum FilterType {
    None,
    Simple,
    Normal,
}

pub(super) struct Segment {
    pub(super) quantizers: Quantizers,
    /// For a macroblock that is predicted as a whole, and for one that is predicted by subblocks.
    pub(super) filter_strengths: [FilterStrength; 2],
}

/// The compressed part.
pub(super) struct Parameters<'a> {
    /// The first partition, where the modes of the macroblocks begin.
    pub(super) modes: BoolReader<'a>,
    token_partitions: [BoolReader<'a>; MAX_PARTITIONS],
    /// A power of two.
    token_partition_count: usize,
    pub(super) segments: [Segment; SEGMENTS],
    /// `None`: all macroblocks are in the first segment.
    pub(super) segment_probabilities: Option<[u8; SEGMENTS - 1]>,
    /// `None`: macroblocks do not say whether they have coefficients.
    pub(super) skip_probability: Option<u8>,
    pub(super) filter_type: FilterType,
    pub(super) probabilities: Probabilities,
}

impl<'a> Parameters<'a> {
    pub(super) fn parse(header: &Header<'a>) -> Result<Self> {
        let (first_partition, rest) = header
            .rest
            .split_at_checked(header.first_partition_len)
            .ok_or(Error::UnexpectedEof)?;
        let [columns, rows] = header.macroblocks();
        // The modes of a macroblock take more than 3 bits.
        if 8 * first_partition.len() < 3 * columns * rows {
            return Err(Error::UnexpectedEof);
        }
        let mut reader = BoolReader::new(first_partition);
        let _color_space = reader.read_flag();
        let _clamping_type = reader.read_flag();
        let segmentation = Segmentation::read(&mut reader);
        let filter = Filter::read(&mut reader);
        let token_partition_count = 1 << reader.read_unsigned(2);
        let token_partitions = split_partitions(rest, token_partition_count)?;
        let quantizer = QuantizerIndices::read(&mut reader);
        let _refresh_entropy_probabilities = reader.read_flag();
        let probabilities = Probabilities::read(&mut reader)?;
        let skip_probability = reader.read_flag().then(|| reader.read_unsigned(8));
        reader.check_not_past_end()?;
        Ok(Self {
            modes: reader,
            token_partitions,
            token_partition_count,
            segments: core::array::from_fn(|segment| {
                let index = segmentation.adjust(quantizer.base, &segmentation.quantizers, segment);
                let level = segmentation.adjust(filter.level, &segmentation.filter_levels, segment);
                Segment {
                    quantizers: quantizer.look_up(index),
                    filter_strengths: [false, true].map(|it| filter.strength(level, it)),
                }
            }),
            segment_probabilities: segmentation.probabilities,
            skip_probability,
            filter_type: filter.filter_type,
            probabilities,
        })
    }

    pub(super) fn token_partition(&mut self, macroblock_row: usize) -> &mut BoolReader<'a> {
        let index = macroblock_row & (self.token_partition_count - 1);
        self.token_partitions.at_mut(index)
    }
}

fn split_partitions(bytes: &[u8], count: usize) -> Result<[BoolReader<'_>; MAX_PARTITIONS]> {
    let (lens, mut unread) = bytes
        .split_at_checked(3 * (count - 1))
        .ok_or(Error::UnexpectedEof)?;
    let mut partitions = [BoolReader::default(); MAX_PARTITIONS];
    for (partition, &[l0, l1, l2]) in partitions.iter_mut().zip(lens.as_chunks().0) {
        let len = u32::from_le_bytes([l0, l1, l2, 0]) as usize;
        let (bytes, rest) = unread.split_at_checked(len).ok_or(Error::UnexpectedEof)?;
        *partition = BoolReader::new(bytes);
        unread = rest;
    }
    if unread.is_empty() {
        return Err(Error::UnexpectedEof);
    }
    *partitions.at_mut(count - 1) = BoolReader::new(unread);
    Ok(partitions)
}

#[derive(Default)]
struct Segmentation {
    is_enabled: bool,
    is_relative: bool,
    quantizers: [i32; SEGMENTS],
    filter_levels: [i32; SEGMENTS],
    probabilities: Option<[u8; SEGMENTS - 1]>,
}

impl Segmentation {
    fn read(reader: &mut BoolReader) -> Self {
        let mut this = Self::default();
        if !reader.read_flag() {
            return this;
        }
        this.is_enabled = true;
        let has_map = reader.read_flag();
        if reader.read_flag() {
            this.is_relative = !reader.read_flag();
            let mut read =
                |bits| [(); SEGMENTS].map(|()| reader.read_optional_signed(bits).unwrap_or(0));
            this.quantizers = read(7);
            this.filter_levels = read(6);
        }
        this.probabilities = has_map.then(|| {
            [(); SEGMENTS - 1].map(|()| match reader.read_flag() {
                true => reader.read_unsigned(8),
                false => 255,
            })
        });
        this
    }

    fn adjust(&self, frame_value: i32, values: &[i32; SEGMENTS], segment: usize) -> i32 {
        match (self.is_enabled, self.is_relative) {
            (false, _) => frame_value,
            (true, false) => *values.at(segment),
            (true, true) => frame_value + values.at(segment),
        }
    }
}

struct Filter {
    filter_type: FilterType,
    level: i32,
    sharpness: u8,
    /// Added to the level, for all macroblocks of a key frame and for those that are predicted by subblocks.
    intra_delta: i32,
    subblock_delta: i32,
}

impl Filter {
    fn read(reader: &mut BoolReader) -> Self {
        let is_simple = reader.read_flag();
        let level = reader.read_unsigned(6);
        let sharpness = reader.read_unsigned(3);
        let has_deltas = reader.read_flag() && reader.read_flag();
        // The others are for frames that refer to earlier ones.
        let [intra_delta, subblock_delta] = [(); 2].map(|()| {
            let [first, ..] = [(); 4].map(|()| has_deltas.then(|| reader.read_optional_signed(6)));
            first.flatten().unwrap_or(0)
        });
        Self {
            filter_type: match (level, is_simple) {
                (0, _) => FilterType::None,
                (_, true) => FilterType::Simple,
                (_, false) => FilterType::Normal,
            },
            level: level.into(),
            sharpness,
            intra_delta,
            subblock_delta,
        }
    }

    /// Section 15.
    fn strength(&self, segment_level: i32, has_subblock_modes: bool) -> FilterStrength {
        let delta = self.intra_delta
            + if has_subblock_modes {
                self.subblock_delta
            } else {
                0
            };
        let level = (segment_level + delta).clamp(0, 63) as u8;
        if level == 0 {
            return FilterStrength::default();
        }
        let interior_limit = match self.sharpness {
            0 => level,
            1..=4 => (level >> 1).min(9 - self.sharpness),
            _ => (level >> 2).min(9 - self.sharpness),
        };
        let interior_limit = interior_limit.max(1);
        FilterStrength {
            edge_limit: 2 * level + interior_limit,
            interior_limit,
            high_variance_threshold: u8::from(level >= 15) + u8::from(level >= 40),
            filters_inner_edges: has_subblock_modes,
        }
    }
}

struct QuantizerIndices {
    base: i32,
    /// For luma DC, Y2 DC, Y2 AC, chroma DC and chroma AC.
    deltas: [i32; 5],
}

impl QuantizerIndices {
    fn read(reader: &mut BoolReader) -> Self {
        Self {
            base: reader.read_unsigned(7).into(),
            deltas: [(); 5].map(|()| reader.read_optional_signed(4).unwrap_or(0)),
        }
    }

    /// Section 14.1.
    fn look_up(&self, index: i32) -> Quantizers {
        let dc = |delta: i32| i32::from(*DC_QUANTIZERS.at((index + delta).clamp(0, 127) as usize));
        let ac = |delta: i32| i32::from(*AC_QUANTIZERS.at((index + delta).clamp(0, 127) as usize));
        let [luma_dc, y2_dc, y2_ac, chroma_dc, chroma_ac] = self.deltas;
        Quantizers {
            luma: [dc(luma_dc), ac(0)],
            y2: [dc(y2_dc) * 2, (ac(y2_ac) * 155 / 100).max(8)],
            chroma: [dc(chroma_dc).min(132), ac(chroma_ac)],
        }
    }
}
