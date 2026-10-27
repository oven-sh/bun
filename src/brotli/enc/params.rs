//! The settings of an encoder, and the constants and formulas that trade speed for density and so define the quality
//! levels.

use super::compound_dictionary::CompoundDictionary;
use super::{
    LARGE_MAX_WINDOW_BITS, MAX_INPUT_BLOCK_BITS, MAX_QUALITY, MAX_WINDOW_BITS,
    MIN_INPUT_BLOCK_BITS, MIN_QUALITY, MIN_WINDOW_BITS,
};

/// `BrotliEncoderMode`: what kind of data to tune for.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum EncoderMode {
    /// Nothing is known about the input.
    Generic = 0,
    /// UTF-8 text.
    Text = 1,
    /// WOFF 2.0 fonts.
    Font = 2,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct HasherParams {
    pub(crate) type_: i32,
    pub(crate) bucket_bits: i32,
    pub(crate) block_bits: i32,
    pub(crate) num_last_distances_to_check: i32,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct DistanceParams {
    pub(crate) distance_postfix_bits: u32,
    pub(crate) num_direct_distance_codes: u32,
    pub(crate) alphabet_size_max: u32,
    pub(crate) alphabet_size_limit: u32,
    pub(crate) max_distance: usize,
}

pub(crate) struct EncoderParams {
    pub(crate) mode: EncoderMode,
    pub(crate) quality: i32,
    pub(crate) lgwin: i32,
    pub(crate) lgblock: i32,
    pub(crate) stream_offset: usize,
    pub(crate) size_hint: usize,
    pub(crate) disable_literal_context_modeling: bool,
    pub(crate) large_window: bool,
    pub(crate) hasher: HasherParams,
    pub(crate) dist: DistanceParams,
    pub(crate) dictionary: CompoundDictionary,
}

pub(crate) const FAST_ONE_PASS_COMPRESSION_QUALITY: i32 = 0;
pub(crate) const FAST_TWO_PASS_COMPRESSION_QUALITY: i32 = 1;
pub(crate) const ZOPFLIFICATION_QUALITY: i32 = 10;
pub(crate) const HQ_ZOPFLIFICATION_QUALITY: i32 = 11;

pub(crate) const MAX_QUALITY_FOR_STATIC_ENTROPY_CODES: i32 = 2;
pub(crate) const MIN_QUALITY_FOR_BLOCK_SPLIT: i32 = 4;
pub(crate) const MIN_QUALITY_FOR_NONZERO_DISTANCE_PARAMS: i32 = 4;
pub(crate) const MIN_QUALITY_FOR_OPTIMIZE_HISTOGRAMS: i32 = 4;
pub(crate) const MIN_QUALITY_FOR_EXTENSIVE_REFERENCE_SEARCH: i32 = 5;
pub(crate) const MIN_QUALITY_FOR_CONTEXT_MODELING: i32 = 5;
pub(crate) const MIN_QUALITY_FOR_HQ_CONTEXT_MODELING: i32 = 7;
pub(crate) const MIN_QUALITY_FOR_HQ_BLOCK_SPLITTING: i32 = 10;

/// Below [`MIN_QUALITY_FOR_BLOCK_SPLIT`] no more than this many literals and commands are buffered.
pub(crate) const MAX_NUM_DELAYED_SYMBOLS: usize = 0x2FFF;

/// The hashers that compare a byte-sized tag of each candidate before looking at it are only faster up to here. The
/// reference encoder uses 7 when built for 64-bit x86 Windows.
const MAX_TAGGED_HASHER_QUALITY: i32 = 6;

/// The size of the hash table of qualities 0 and 1.
pub(crate) const fn max_hash_table_size(quality: i32) -> usize {
    if quality == FAST_ONE_PASS_COMPRESSION_QUALITY {
        1 << 15
    } else {
        1 << 17
    }
}

/// The longest match for which zopflification tells distances apart.
const MAX_ZOPFLI_LEN_QUALITY_10: usize = 150;
const MAX_ZOPFLI_LEN_QUALITY_11: usize = 325;

/// After a copy this long, the search is less thorough.
pub(crate) const LONG_COPY_QUICK_STEP: usize = 16384;

impl EncoderParams {
    pub(crate) fn max_zopfli_len(&self) -> usize {
        if self.quality <= 10 {
            MAX_ZOPFLI_LEN_QUALITY_10
        } else {
            MAX_ZOPFLI_LEN_QUALITY_11
        }
    }

    /// How many of the best candidates are tried to extend a zopfli chain.
    pub(crate) fn max_zopfli_candidates(&self) -> usize {
        if self.quality <= 10 { 1 } else { 5 }
    }

    pub(crate) fn sanitize(&mut self) {
        self.quality = self.quality.clamp(MIN_QUALITY, MAX_QUALITY);
        if self.quality <= MAX_QUALITY_FOR_STATIC_ENTROPY_CODES {
            self.large_window = false;
        }
        let max_lgwin = if self.large_window {
            LARGE_MAX_WINDOW_BITS
        } else {
            MAX_WINDOW_BITS
        };
        self.lgwin = self.lgwin.clamp(MIN_WINDOW_BITS, max_lgwin);
    }

    pub(crate) fn compute_lg_block(&self) -> i32 {
        if self.quality == FAST_ONE_PASS_COMPRESSION_QUALITY
            || self.quality == FAST_TWO_PASS_COMPRESSION_QUALITY
        {
            self.lgwin
        } else if self.quality < MIN_QUALITY_FOR_BLOCK_SPLIT {
            14
        } else if self.lgblock == 0 {
            if self.quality >= 9 && self.lgwin > 16 {
                self.lgwin.min(18)
            } else {
                16
            }
        } else {
            self.lgblock
                .clamp(MIN_INPUT_BLOCK_BITS, MAX_INPUT_BLOCK_BITS)
        }
    }

    /// `log2` of the size of the ring buffer. It has to hold the window and a new block at the same time, and be larger
    /// than the copy of its start that is kept after its end.
    pub(crate) fn compute_rb_bits(&self) -> i32 {
        1 + self.lgwin.max(self.lgblock)
    }

    pub(crate) fn max_meta_block_size(&self) -> usize {
        1 << self.compute_rb_bits().min(MAX_INPUT_BLOCK_BITS)
    }

    /// After this many literals in a row, qualities 2 to 9 no longer look for a match at every position: a failed lookup
    /// is expensive. They take steps of 8 bytes at first, and of 16 after 4 times as many literals.
    pub(crate) fn literal_spree_length_for_sparse_search(&self) -> usize {
        if self.quality < 9 { 64 } else { 512 }
    }

    /// Which hasher a quality uses:
    ///
    /// | quality | hasher | small window | large input |
    /// | --- | --- | --- | --- |
    /// | 2, 3 | H2, H3 | | |
    /// | 4 | H4 | | H54 |
    /// | 5, 6 | H58 | H40 | H68 |
    /// | 7, 8 | H5 | H41 | H6 |
    /// | 9 | H5 | H42 | H6 |
    /// | 10, 11 | H10 | | |
    pub(crate) fn choose_hasher(&self) -> HasherParams {
        let mut hparams = self.hasher;
        let long_match = |tagged: i32, plain: i32, bucket_bits: i32| HasherParams {
            type_: if self.quality <= MAX_TAGGED_HASHER_QUALITY {
                tagged
            } else {
                plain
            },
            block_bits: self.quality - 1,
            bucket_bits,
            num_last_distances_to_check: if self.quality < 7 {
                4
            } else if self.quality < 9 {
                10
            } else {
                16
            },
        };
        if self.quality > 9 {
            hparams.type_ = 10;
        } else if self.quality == 4 && self.size_hint >= (1 << 20) {
            hparams.type_ = 54;
        } else if self.quality < 5 {
            hparams.type_ = self.quality;
        } else if self.lgwin <= 16 {
            hparams.type_ = if self.quality < 7 {
                40
            } else if self.quality < 9 {
                41
            } else {
                42
            };
        } else if self.size_hint >= (1 << 20) && self.lgwin >= 19 {
            hparams = long_match(68, 6, 15);
        } else {
            hparams = long_match(58, 5, if self.quality < 7 { 14 } else { 15 });
        }

        if self.lgwin > 24 {
            // Qualities up to 2 are too fast for a large window, and H10 already works well with one.
            hparams.type_ = match hparams.type_ {
                3 => 35,
                54 => 55,
                6 | 68 => 65,
                other => other,
            };
        }
        hparams
    }
}
