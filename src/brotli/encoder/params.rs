//! What the caller asks for, and what becomes of it.

use super::bit_writer::Bits;
use crate::format::{
    DistanceParams, LARGE_MAX_WINDOW_BITS, MAX_DIRECT_CODES, MAX_POSTFIX_BITS, MAX_WINDOW_BITS,
    MIN_WINDOW_BITS, max_backward_distance,
};

pub const MIN_QUALITY: i32 = 0;
pub const MAX_QUALITY: i32 = 11;

pub(super) const LARGE_INPUT_SIZE: usize = 1 << 20;
const MIN_BLOCK_BITS: u32 = 16;
const MAX_BLOCK_BITS: u32 = 24;
const MODE_FONT: u32 = 2;
/// Qualities 0 and 1 go this far back whatever the window is.
pub(super) const FAST_WINDOW_BITS: u32 = 18;

pub(super) struct Requested {
    mode: u32,
    quality: i32,
    window_bits: i32,
    block_bits: i32,
    disable_literal_context_modeling: bool,
    size_hint: u32,
    large_window: bool,
    postfix_bits: u32,
    direct_codes: u32,
    stream_offset: u32,
}

impl Default for Requested {
    fn default() -> Self {
        Self {
            mode: 0,
            quality: MAX_QUALITY,
            window_bits: 22,
            block_bits: 0,
            disable_literal_context_modeling: false,
            size_hint: 0,
            large_window: false,
            postfix_bits: 0,
            direct_codes: 0,
            stream_offset: 0,
        }
    }
}

impl Requested {
    pub(super) fn with_quality(quality: i32) -> Self {
        Self {
            quality,
            ..Self::default()
        }
    }

    pub(super) fn set(&mut self, key: u32, value: u32) -> bool {
        match key {
            0 => self.mode = value,
            1 => self.quality = value as i32,
            2 => self.window_bits = value as i32,
            3 => self.block_bits = value as i32,
            4 if value <= 1 => self.disable_literal_context_modeling = value != 0,
            5 => self.size_hint = value,
            6 => self.large_window = value != 0,
            7 => self.postfix_bits = value,
            8 => self.direct_codes = value,
            9 if value <= 1 << 30 => self.stream_offset = value,
            _ => return false,
        }
        true
    }
}

#[derive(Clone, Copy)]
pub(super) struct Params {
    pub(super) quality: u32,
    pub(super) window_bits: u32,
    pub(super) block_bits: u32,
    pub(super) stream_offset: usize,
    pub(super) size_hint: usize,
    pub(super) disable_literal_context_modeling: bool,
    pub(super) large_window: bool,
    pub(super) distance: DistanceParams,
}

impl Params {
    pub(super) fn new(requested: &Requested) -> Self {
        let quality = requested.quality.clamp(MIN_QUALITY, MAX_QUALITY) as u32;
        let large_window = requested.large_window && quality > 2;
        let max_window_bits = if large_window {
            LARGE_MAX_WINDOW_BITS
        } else {
            MAX_WINDOW_BITS
        };
        let window_bits = requested
            .window_bits
            .clamp(MIN_WINDOW_BITS as i32, max_window_bits as i32) as u32;
        let block_bits = match (quality, requested.block_bits) {
            (0 | 1, _) => window_bits,
            (2 | 3, _) => 14,
            (9.., 0) => window_bits.clamp(16, 18),
            (_, 0) => 16,
            (_, bits) => bits.clamp(MIN_BLOCK_BITS as i32, MAX_BLOCK_BITS as i32) as u32,
        };
        let (postfix_bits, direct_codes) = match (requested.postfix_bits, requested.direct_codes) {
            _ if quality < 4 => (0, 0),
            _ if requested.mode == MODE_FONT => (1, 12),
            (postfix @ ..=MAX_POSTFIX_BITS, direct @ ..=MAX_DIRECT_CODES)
                if ((direct >> postfix) & 0xF) << postfix == direct =>
            {
                (postfix, direct)
            }
            _ => (0, 0),
        };
        Self {
            quality,
            window_bits,
            block_bits,
            stream_offset: (requested.stream_offset as usize)
                .min(max_backward_distance(window_bits)),
            size_hint: requested.size_hint as usize,
            disable_literal_context_modeling: requested.disable_literal_context_modeling,
            large_window,
            distance: DistanceParams::new(postfix_bits, direct_codes, large_window),
        }
    }

    pub(super) fn stream_header(&self) -> Bits {
        let window_bits = u64::from(if self.quality <= 1 {
            self.window_bits.max(FAST_WINDOW_BITS)
        } else {
            self.window_bits
        });
        match window_bits {
            _ if self.stream_offset != 0 => Bits::EMPTY,
            _ if self.large_window => Bits::new(14, (window_bits << 8) | 0x11),
            16 => Bits::new(1, 0),
            17 => Bits::new(7, 1),
            18.. => Bits::new(4, ((window_bits - 17) << 1) | 1),
            _ => Bits::new(7, ((window_bits - 8) << 4) | 1),
        }
    }

    pub(super) fn block_size(&self) -> usize {
        1 << self.block_bits
    }

    pub(super) fn ring_buffer_bits(&self) -> u32 {
        1 + self.window_bits.max(self.block_bits)
    }

    pub(super) fn max_meta_block_size(&self) -> usize {
        1 << self.ring_buffer_bits().min(MAX_BLOCK_BITS)
    }

    pub(super) fn max_backward_distance(&self) -> usize {
        max_backward_distance(self.window_bits)
    }
}
