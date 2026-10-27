//! The settings of an encoder, and the constants and formulas that trade speed for density and so define the quality
//! levels.

use super::compound_dictionary::CompoundDictionary;
use super::{
    EncoderMode, LARGE_MAX_WINDOW_BITS, MAX_INPUT_BLOCK_BITS, MAX_QUALITY, MAX_WINDOW_BITS,
    MIN_INPUT_BLOCK_BITS, MIN_QUALITY, MIN_WINDOW_BITS,
};
use crate::common::constants::{
    LARGE_MAX_DISTANCE_BITS, MAX_ALLOWED_DISTANCE, MAX_DISTANCE_BITS,
    calculate_distance_code_limit, distance_alphabet_size,
};

/// How thorough H5 and H6 are.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct HasherParams {
    /// `log2` of how many positions are kept for each hash.
    pub(crate) block_bits: u32,
    pub(crate) num_last_distances_to_check: usize,
}

/// See [`EncoderParams::choose_hasher`]. H58 and H68 keep 16 or 32 positions for each hash.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HasherType {
    H2,
    H3,
    H4,
    H5(HasherParams),
    H6(HasherParams),
    H10,
    H35,
    H40,
    H41,
    H42,
    H54,
    H55,
    H58x16,
    H58x32,
    H65(HasherParams),
    H68x16,
    H68x32,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct DistanceParams {
    pub(crate) distance_postfix_bits: u32,
    pub(crate) num_direct_distance_codes: u32,
    pub(crate) alphabet_size_max: u32,
    pub(crate) alphabet_size_limit: u32,
    pub(crate) max_distance: usize,
}

impl DistanceParams {
    pub(crate) fn new(npostfix: u32, ndirect: u32, large_window: bool) -> Self {
        let (alphabet_size_max, alphabet_size_limit, max_distance) = if large_window {
            let limit = calculate_distance_code_limit(MAX_ALLOWED_DISTANCE, npostfix, ndirect);
            (
                distance_alphabet_size(npostfix, ndirect, LARGE_MAX_DISTANCE_BITS),
                limit.max_alphabet_size,
                limit.max_distance,
            )
        } else {
            let alphabet_size = distance_alphabet_size(npostfix, ndirect, MAX_DISTANCE_BITS);
            let max_distance =
                ndirect + (1 << (MAX_DISTANCE_BITS + npostfix + 2)) - (1 << (npostfix + 2));
            (alphabet_size, alphabet_size, max_distance)
        };
        Self {
            distance_postfix_bits: npostfix,
            num_direct_distance_codes: ndirect,
            alphabet_size_max,
            alphabet_size_limit,
            max_distance: max_distance as usize,
        }
    }
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
    pub(crate) dist: DistanceParams,
    pub(crate) dictionary: CompoundDictionary,
}

pub(crate) const FAST_ONE_PASS_COMPRESSION_QUALITY: i32 = 0;
pub(crate) const FAST_TWO_PASS_COMPRESSION_QUALITY: i32 = 1;
/// Those two refer back as far as a window of this many bits allows, even if `lgwin` is less.
pub(crate) const FAST_COMPRESSION_WINDOW_BITS: i32 = 18;
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

    /// Whether the input is compressed where it is, block by block, without a ring buffer.
    pub(crate) fn is_fast(&self) -> bool {
        self.quality == FAST_ONE_PASS_COMPRESSION_QUALITY
            || self.quality == FAST_TWO_PASS_COMPRESSION_QUALITY
    }

    pub(crate) fn compute_lgblock(&self) -> i32 {
        if self.is_fast() {
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
    pub(crate) fn ring_buffer_bits(&self) -> i32 {
        1 + self.lgwin.max(self.lgblock)
    }

    pub(crate) fn max_meta_block_size(&self) -> usize {
        1 << self.ring_buffer_bits().min(MAX_INPUT_BLOCK_BITS)
    }

    /// After this many literals in a row, qualities 2 to 9 no longer look for a match at every position: a failed lookup
    /// is expensive. They take steps of 8 bytes at first, and of 16 after 4 times as many literals.
    pub(crate) fn literal_spree_length_for_sparse_search(&self) -> usize {
        if self.quality < 9 { 64 } else { 512 }
    }

    /// Which hasher a quality uses:
    ///
    /// | quality | hasher | `lgwin <= 16` | input of 1 MiB or more | and `lgwin > 24` |
    /// | --- | --- | --- | --- | --- |
    /// | 2 | H2 | | | |
    /// | 3 | H3 | | | H35, for any input |
    /// | 4 | H4 | | H54 | H55 |
    /// | 5, 6 | H58 | H40 | H68, if `lgwin >= 19` | H65 |
    /// | 7, 8 | H5 | H41 | H6, if `lgwin >= 19` | H65 |
    /// | 9 | H5 | H42 | H6, if `lgwin >= 19` | H65 |
    /// | 10, 11 | H10 | | | |
    ///
    /// H58 and H68 are H5 and H6 with a tag for each candidate, by which most are rejected without a look at them. That
    /// is only faster up to quality 6. The reference encoder goes up to 7 when built for 64-bit x86 Windows.
    pub(crate) fn choose_hasher(&self) -> HasherType {
        let large_input = self.size_hint >= (1 << 20);
        // Qualities up to 2 are too fast for a large window, and H10 already works well with one.
        let large_window = self.lgwin > 24;
        let hasher_params = HasherParams {
            block_bits: (self.quality - 1) as u32,
            num_last_distances_to_check: match self.quality {
                ..7 => 4,
                7..9 => 10,
                9.. => 16,
            },
        };
        match self.quality {
            ..=2 => HasherType::H2,
            3 if large_window => HasherType::H35,
            3 => HasherType::H3,
            4 if large_input && large_window => HasherType::H55,
            4 if large_input => HasherType::H54,
            4 => HasherType::H4,
            10.. => HasherType::H10,
            5 | 6 if self.lgwin <= 16 => HasherType::H40,
            7 | 8 if self.lgwin <= 16 => HasherType::H41,
            9 if self.lgwin <= 16 => HasherType::H42,
            5..=9 if large_input && large_window => HasherType::H65(hasher_params),
            5 if large_input && self.lgwin >= 19 => HasherType::H68x16,
            6 if large_input && self.lgwin >= 19 => HasherType::H68x32,
            7..=9 if large_input && self.lgwin >= 19 => HasherType::H6(hasher_params),
            5 => HasherType::H58x16,
            6 => HasherType::H58x32,
            7..=9 => HasherType::H5(hasher_params),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::HasherType::*;
    use super::*;

    /// H58 finds the same matches as H5, and H68 as H6, so the output does not tell which one was chosen. The table is
    /// `ChooseHasher` of the reference encoder, built with `BROTLI_MAX_SIMD_QUALITY` 6.
    #[test]
    fn chooses_the_hasher_of_the_reference_encoder() {
        const MIB: usize = 1 << 20;
        let p = |block_bits, num_last_distances_to_check| HasherParams {
            block_bits,
            num_last_distances_to_check,
        };
        let table = [
            (2, 10, 0, H2),
            (2, 22, 0, H2),
            (2, 24, MIB, H2),
            (3, 16, 0, H3),
            (3, 22, MIB, H3),
            (3, 24, 0, H3),
            (3, 25, 0, H35),
            (3, 30, MIB, H35),
            (4, 16, 0, H4),
            (4, 22, MIB - 1, H4),
            (4, 25, MIB - 1, H4),
            (4, 16, MIB, H54),
            (4, 22, MIB, H54),
            (4, 24, MIB, H54),
            (4, 25, MIB, H55),
            (5, 10, 0, H40),
            (5, 16, MIB, H40),
            (6, 16, 0, H40),
            (7, 16, 0, H41),
            (8, 16, MIB, H41),
            (9, 16, 0, H42),
            (5, 17, 0, H58x16),
            (5, 18, MIB, H58x16),
            (5, 19, MIB - 1, H58x16),
            (5, 25, MIB - 1, H58x16),
            (6, 17, 0, H58x32),
            (6, 18, MIB, H58x32),
            (6, 19, MIB - 1, H58x32),
            (6, 25, 0, H58x32),
            (7, 17, 0, H5(p(6, 10))),
            (7, 18, MIB, H5(p(6, 10))),
            (7, 19, MIB - 1, H5(p(6, 10))),
            (7, 25, MIB - 1, H5(p(6, 10))),
            (8, 17, 0, H5(p(7, 10))),
            (8, 22, MIB - 1, H5(p(7, 10))),
            (9, 17, 0, H5(p(8, 16))),
            (9, 18, MIB, H5(p(8, 16))),
            (9, 22, MIB - 1, H5(p(8, 16))),
            (5, 19, MIB, H68x16),
            (5, 24, MIB, H68x16),
            (6, 19, MIB, H68x32),
            (6, 24, MIB, H68x32),
            (7, 19, MIB, H6(p(6, 10))),
            (7, 24, MIB, H6(p(6, 10))),
            (8, 19, MIB, H6(p(7, 10))),
            (9, 19, MIB, H6(p(8, 16))),
            (9, 24, MIB, H6(p(8, 16))),
            (5, 25, MIB, H65(p(4, 4))),
            (6, 25, MIB, H65(p(5, 4))),
            (7, 25, MIB, H65(p(6, 10))),
            (8, 25, MIB, H65(p(7, 10))),
            (9, 25, MIB, H65(p(8, 16))),
            (9, 30, MIB, H65(p(8, 16))),
            (10, 10, 0, H10),
            (10, 16, MIB, H10),
            (10, 22, 0, H10),
            (10, 25, MIB, H10),
            (11, 22, MIB, H10),
            (11, 30, 0, H10),
        ];
        for (quality, lgwin, size_hint, expected) in table {
            let params = EncoderParams {
                mode: EncoderMode::Generic,
                quality,
                lgwin,
                lgblock: 0,
                stream_offset: 0,
                size_hint,
                disable_literal_context_modeling: false,
                large_window: lgwin > MAX_WINDOW_BITS,
                dist: DistanceParams::default(),
                dictionary: CompoundDictionary::default(),
            };
            assert_eq!(
                params.choose_hasher(),
                expected,
                "quality {quality}, lgwin {lgwin}, size hint {size_hint}"
            );
        }
    }
}
