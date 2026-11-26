//! What a caller asks for, and what a frame is compressed with.

use core::ops::RangeInclusive;

use bun_zstd_decoder::array::At;
use bun_zstd_decoder::format::{
    BLOCK_LEN_MAX, WINDOW_LOG_LIMIT_DEFAULT, WINDOW_LOG_MAX, WINDOW_LOG_MIN,
};
use bun_zstd_decoder::{Error, Result};

use crate::bytes::highest_bit;
use crate::levels::{LEVELS, MAX_LEVEL};

pub const DEFAULT_LEVEL: i32 = 3;
const MIN_LEVEL: i32 = -(BLOCK_LEN_MAX as i32);
const HASH_LOG_MIN: u32 = 6;
const HASH_LOG_MAX: u32 = 30;
const TARGET_BLOCK_LEN_MIN: i32 = 1340;
pub(crate) const JOB_LEN_MIN: usize = 512 << 10;
const JOB_LEN_MAX: i32 = 1 << 30;
const WORKERS_MAX: i32 = 256;
/// The bits of a hash that rows, and the tables of a dictionary for the two fast strategies, keep beside an index.
pub(crate) const TAG_BITS: u32 = 8;

/// The values of `ZSTD_cParameter`.
mod key {
    pub(super) const FORMAT: u32 = 10;
    pub(super) const COMPRESSION_LEVEL: u32 = 100;
    pub(super) const WINDOW_LOG: u32 = 101;
    pub(super) const HASH_LOG: u32 = 102;
    pub(super) const CHAIN_LOG: u32 = 103;
    pub(super) const SEARCH_LOG: u32 = 104;
    pub(super) const MIN_MATCH: u32 = 105;
    pub(super) const TARGET_LENGTH: u32 = 106;
    pub(super) const STRATEGY: u32 = 107;
    pub(super) const TARGET_BLOCK_SIZE: u32 = 130;
    pub(super) const ENABLE_LONG_DISTANCE_MATCHING: u32 = 160;
    pub(super) const LDM_HASH_LOG: u32 = 161;
    pub(super) const LDM_MIN_MATCH: u32 = 162;
    pub(super) const LDM_BUCKET_SIZE_LOG: u32 = 163;
    pub(super) const LDM_HASH_RATE_LOG: u32 = 164;
    pub(super) const CONTENT_SIZE_FLAG: u32 = 200;
    pub(super) const CHECKSUM_FLAG: u32 = 201;
    pub(super) const DICTIONARY_ID_FLAG: u32 = 202;
    pub(super) const WORKERS: u32 = 400;
    pub(super) const JOB_SIZE: u32 = 401;
    pub(super) const OVERLAP_LOG: u32 = 402;
}

/// The values are those of `ZSTD_strategy`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub(crate) enum Strategy {
    Fast = 1,
    DoubleFast,
    Greedy,
    Lazy,
    Lazy2,
    TreeLazy2,
    Optimal,
    Ultra,
    Ultra2,
}

impl Strategy {
    fn new(value: i32) -> Option<Self> {
        use Strategy::*;
        let all = [
            Fast, DoubleFast, Greedy, Lazy, Lazy2, TreeLazy2, Optimal, Ultra, Ultra2,
        ];
        all.into_iter().find(|&strategy| strategy as i32 == value)
    }

    fn can_use_rows(self) -> bool {
        (Self::Greedy..=Self::Lazy2).contains(&self)
    }

    /// How small `len` bytes have to get.
    pub(crate) fn worth_it_below(self, len: usize) -> usize {
        let log = if self >= Self::Ultra {
            self as u32 - 1
        } else {
            6
        };
        len.saturating_sub((len >> log) + 2)
    }
}

/// How matches are searched for.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Tuning {
    pub(crate) window_log: u32,
    pub(crate) chain_log: u32,
    pub(crate) hash_log: u32,
    pub(crate) search_log: u32,
    pub(crate) min_match: u32,
    pub(crate) target_length: u32,
    pub(crate) strategy: Strategy,
}

/// What a [`Tuning`] is chosen for.
#[derive(Clone, Copy)]
pub(crate) enum Purpose {
    /// A frame whose tables also index a dictionary of that size, if it has one.
    Frame { dictionary_len: usize },
    /// The tables of a dictionary.
    Dictionary { len: usize },
}

impl Purpose {
    fn dictionary_len(self) -> u64 {
        match self {
            Self::Frame {
                dictionary_len: len,
            }
            | Self::Dictionary { len } => len as u64,
        }
    }
}

impl Tuning {
    pub(crate) fn for_level(level: i32, input_len: Option<u64>, purpose: Purpose) -> Self {
        let size = match (input_len, purpose.dictionary_len()) {
            (None, 0) => u64::MAX,
            (None, dictionary_len) => dictionary_len + 499,
            (Some(len), dictionary_len) => len.wrapping_add(dictionary_len),
        };
        let class = [256 << 10, 128 << 10, 16 << 10].map(|limit| usize::from(size <= limit));
        let row = level.clamp(0, MAX_LEVEL) as usize;
        let (values, strategy) = *LEVELS.at(class.iter().sum()).at(row);
        let [window, chain, hash, search, min_match, target] = values.map(u32::from);
        let tuning = Self {
            window_log: window,
            chain_log: chain,
            hash_log: hash,
            search_log: search,
            min_match,
            target_length: if level < 0 {
                level.max(MIN_LEVEL).unsigned_abs()
            } else {
                target
            },
            strategy,
        };
        tuning.fitted(input_len, purpose)
    }

    /// With smaller tables where the input does not need large ones.
    pub(crate) fn fitted(mut self, input_len: Option<u64>, purpose: Purpose) -> Self {
        const RESIZED_UP_TO: u64 = 1 << (WINDOW_LOG_MAX - 1);
        let dictionary_len = purpose.dictionary_len();
        let is_for_dictionary = matches!(purpose, Purpose::Dictionary { .. });
        let input_len =
            input_len.or_else(|| (is_for_dictionary && dictionary_len != 0).then_some(513));

        if let Some(input_len) = input_len {
            if input_len <= RESIZED_UP_TO && dictionary_len <= RESIZED_UP_TO {
                let total = (input_len + dictionary_len) as u32;
                let log = if total < 1 << HASH_LOG_MIN {
                    HASH_LOG_MIN
                } else {
                    highest_bit(total - 1) + 1
                };
                self.window_log = self.window_log.min(log);
            }
            let reach_log = self.reach_log(input_len, dictionary_len);
            self.hash_log = self.hash_log.min(reach_log + 1);
            self.chain_log -= self.cycle_log().saturating_sub(reach_log);
        }
        self.window_log = self.window_log.max(WINDOW_LOG_MIN);

        if is_for_dictionary && self.strategy <= Strategy::DoubleFast {
            self.hash_log = self.hash_log.min(32 - TAG_BITS);
            self.chain_log = self.chain_log.min(32 - TAG_BITS);
        }
        if self.strategy.can_use_rows() {
            self.hash_log = self.hash_log.min(32 - TAG_BITS + self.row_log());
        }
        self
    }

    /// All of a dictionary is within reach as long as its last byte is in the window.
    fn reach_log(&self, input_len: u64, dictionary_len: u64) -> u32 {
        let window_len = 1u64 << self.window_log;
        let reach = dictionary_len + window_len;
        if dictionary_len == 0 || window_len >= dictionary_len.wrapping_add(input_len) {
            self.window_log
        } else if reach >= 1 << WINDOW_LOG_MAX {
            WINDOW_LOG_MAX
        } else {
            highest_bit(reach as u32 - 1) + 1
        }
    }

    /// After how many positions the chain table starts over.
    pub(crate) fn cycle_log(&self) -> u32 {
        self.chain_log - u32::from(self.strategy >= Strategy::TreeLazy2)
    }

    pub(crate) fn row_log(&self) -> u32 {
        self.search_log.clamp(4, 6)
    }

    pub(crate) fn prefers_rows(&self) -> bool {
        self.strategy.can_use_rows() && self.window_log > 14
    }

    pub(crate) fn compresses_literals(&self) -> bool {
        self.strategy != Strategy::Fast || self.target_length == 0
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct LongDistance {
    pub(crate) hash_log: u32,
    pub(crate) bucket_log: u32,
    pub(crate) min_match: u32,
    pub(crate) hash_rate_log: u32,
}

impl LongDistance {
    /// With what is 0 derived from `tuning`.
    pub(crate) fn completed(mut self, tuning: &Tuning) -> Self {
        let strategy = tuning.strategy as u32;
        if self.hash_rate_log == 0 {
            self.hash_rate_log = if self.hash_log > 0 {
                tuning.window_log.saturating_sub(self.hash_log)
            } else {
                7 - strategy / 3
            };
        }
        if self.hash_log == 0 {
            let log = tuning.window_log.saturating_sub(self.hash_rate_log);
            self.hash_log = log.clamp(HASH_LOG_MIN, HASH_LOG_MAX);
        }
        if self.min_match == 0 {
            self.min_match = 64 >> u32::from(tuning.strategy >= Strategy::Ultra);
        }
        if self.bucket_log == 0 {
            self.bucket_log = strategy.clamp(4, 8);
        }
        self.bucket_log = self.bucket_log.min(self.hash_log);
        self
    }
}

#[derive(Clone, Copy)]
pub(crate) struct HeaderFlags {
    pub(crate) has_magic: bool,
    pub(crate) has_content_size: bool,
    pub(crate) has_checksum: bool,
    pub(crate) has_dictionary_id: bool,
}

/// What a caller asks for. 0 leaves a value to the level.
#[derive(Clone, Copy)]
pub(crate) struct Request {
    level: i32,
    window_log: u32,
    chain_log: u32,
    hash_log: u32,
    search_log: u32,
    min_match: u32,
    target_length: u32,
    strategy: Option<Strategy>,
    matches_long_distance: Option<bool>,
    long_distance: LongDistance,
    pub(crate) header: HeaderFlags,
    target_block_len: usize,
    pub(crate) workers: usize,
    pub(crate) job_len: usize,
    pub(crate) overlap_log: u32,
}

impl Request {
    pub(crate) const fn new(level: i32) -> Self {
        Self {
            level: if level == 0 { DEFAULT_LEVEL } else { level },
            window_log: 0,
            chain_log: 0,
            hash_log: 0,
            search_log: 0,
            min_match: 0,
            target_length: 0,
            strategy: None,
            matches_long_distance: None,
            long_distance: LongDistance {
                hash_log: 0,
                bucket_log: 0,
                min_match: 0,
                hash_rate_log: 0,
            },
            header: HeaderFlags {
                has_magic: true,
                has_content_size: true,
                has_checksum: false,
                has_dictionary_id: true,
            },
            target_block_len: 0,
            workers: 0,
            job_len: 0,
            overlap_log: 0,
        }
    }

    /// `key` is a `ZSTD_cParameter`.
    pub(crate) fn set(&mut self, key: u32, value: i32) -> Result<()> {
        let within = |range: RangeInclusive<u32>| match u32::try_from(value) {
            Ok(value) if value == 0 || range.contains(&value) => Ok(value),
            _ => Err(Error::ParameterOutOfBound),
        };
        match key {
            key::FORMAT => self.header.has_magic = within(0..=1)? == 0,
            key::COMPRESSION_LEVEL => self.level = Self::new(value).level,
            key::WINDOW_LOG => self.window_log = within(WINDOW_LOG_MIN..=WINDOW_LOG_MAX)?,
            key::HASH_LOG => self.hash_log = within(HASH_LOG_MIN..=HASH_LOG_MAX)?,
            key::CHAIN_LOG => self.chain_log = within(HASH_LOG_MIN..=HASH_LOG_MAX)?,
            key::SEARCH_LOG => self.search_log = within(1..=WINDOW_LOG_MAX - 1)?,
            key::MIN_MATCH => self.min_match = within(3..=7)?,
            key::TARGET_LENGTH => self.target_length = within(0..=BLOCK_LEN_MAX as u32)?,
            key::STRATEGY => self.strategy = within(1..=9).map(|_| Strategy::new(value))?,
            key::TARGET_BLOCK_SIZE if value > BLOCK_LEN_MAX as i32 => {
                return Err(Error::ParameterOutOfBound);
            }
            key::TARGET_BLOCK_SIZE if value == 0 => self.target_block_len = 0,
            key::TARGET_BLOCK_SIZE => {
                self.target_block_len = value.max(TARGET_BLOCK_LEN_MIN) as usize
            }
            key::ENABLE_LONG_DISTANCE_MATCHING => {
                self.matches_long_distance = (within(0..=2)? != 0).then_some(value == 1)
            }
            key::LDM_HASH_LOG => self.long_distance.hash_log = within(HASH_LOG_MIN..=HASH_LOG_MAX)?,
            key::LDM_MIN_MATCH => self.long_distance.min_match = within(4..=4096)?,
            key::LDM_BUCKET_SIZE_LOG => self.long_distance.bucket_log = within(1..=8)?,
            key::LDM_HASH_RATE_LOG => {
                self.long_distance.hash_rate_log = within(0..=WINDOW_LOG_MAX - HASH_LOG_MIN)?
            }
            key::CONTENT_SIZE_FLAG => self.header.has_content_size = value != 0,
            key::CHECKSUM_FLAG => self.header.has_checksum = value != 0,
            key::DICTIONARY_ID_FLAG => self.header.has_dictionary_id = value != 0,
            key::WORKERS => self.workers = value.clamp(0, WORKERS_MAX) as usize,
            key::JOB_SIZE if value == 0 => self.job_len = 0,
            key::JOB_SIZE => self.job_len = value.clamp(JOB_LEN_MIN as i32, JOB_LEN_MAX) as usize,
            key::OVERLAP_LOG => self.overlap_log = value.clamp(0, 9) as u32,
            _ => return Err(Error::ParameterUnsupported),
        }
        Ok(())
    }

    pub(crate) fn tuning(&self, input_len: Option<u64>, purpose: Purpose) -> Tuning {
        let of_level = Tuning::for_level(self.level, input_len, purpose);
        let or = |asked: u32, of_level: u32| if asked != 0 { asked } else { of_level };
        let window_log = if self.matches_long_distance == Some(true) {
            WINDOW_LOG_LIMIT_DEFAULT
        } else {
            of_level.window_log
        };
        let tuning = Tuning {
            window_log: or(self.window_log, window_log),
            chain_log: or(self.chain_log, of_level.chain_log),
            hash_log: or(self.hash_log, of_level.hash_log),
            search_log: or(self.search_log, of_level.search_log),
            min_match: or(self.min_match, of_level.min_match),
            target_length: or(self.target_length, of_level.target_length),
            strategy: self.strategy.unwrap_or(of_level.strategy),
        };
        tuning.fitted(input_len, purpose)
    }

    pub(crate) fn plan(&self, tuning: Tuning) -> Plan {
        let is_optimal = tuning.strategy >= Strategy::Optimal;
        let matches_long_distance = self
            .matches_long_distance
            .unwrap_or(is_optimal && tuning.window_log >= WINDOW_LOG_LIMIT_DEFAULT);
        Plan {
            tuning,
            uses_rows: tuning.prefers_rows(),
            splits_blocks: is_optimal && tuning.window_log >= 17,
            long_matches: if matches_long_distance {
                LongMatches::Own(self.long_distance)
            } else {
                LongMatches::None
            },
            target_block_len: self.target_block_len,
            header: self.header,
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum LongMatches {
    None,
    /// Not yet [`completed`](LongDistance::completed): a dictionary has a say in the tuning.
    Own(LongDistance),
    /// From a finder that sees more of the input.
    Given,
}

/// What a frame is compressed with.
#[derive(Clone, Copy)]
pub(crate) struct Plan {
    pub(crate) tuning: Tuning,
    pub(crate) uses_rows: bool,
    pub(crate) splits_blocks: bool,
    pub(crate) long_matches: LongMatches,
    /// 0 for none.
    pub(crate) target_block_len: usize,
    pub(crate) header: HeaderFlags,
}

#[cfg(test)]
mod tests {
    use bun_zstd_decoder::XxHash64;

    use super::*;

    fn hash(values: impl Iterator<Item = u32>) -> u32 {
        XxHash64::hash(&values.flat_map(u32::to_le_bytes).collect::<Vec<_>>()) as u32
    }

    /// The hashes are of what `ZSTD_getCParamsFromCCtxParams()` returns.
    #[test]
    fn tunings_are_those_of_zstd() -> Result<()> {
        const INPUT_LENS: [u64; 16] = [
            0,
            63,
            64,
            65,
            1024,
            1025,
            16384,
            16385,
            131_072,
            131_073,
            262_144,
            262_145,
            1 << 30,
            (1 << 30) + 1,
            3_000_000_000,
            1 << 40,
        ];
        const DICTIONARY_LENS: [usize; 15] = [
            0,
            1,
            511,
            512,
            1024,
            1025,
            15885,
            15886,
            130_573,
            130_574,
            261_645,
            261_646,
            1 << 24,
            1 << 30,
            (1 << 30) + 1,
        ];
        let requests: [(&[_], _); _] = [
            (&[], 0xE596_4A40),
            (&[(101, 31)], 0xA529_2197),
            (&[(101, 10)], 0x560F_2647),
            (&[(160, 1)], 0xBB91_69F1),
            (&[(102, 30), (103, 30), (107, 1)], 0xA40D_53E8),
            (&[(102, 30), (103, 30), (107, 2)], 0x213D_6B66),
            (&[(102, 30), (104, 3), (107, 3)], 0x22CC_8BAF),
            (&[(102, 30), (104, 5), (107, 4)], 0x342E_4B09),
            (&[(102, 30), (104, 7), (107, 5)], 0x1EC8_E829),
            (&[(101, 31), (102, 30), (103, 30), (107, 6)], 0xA5A7_EAD3),
            (&[(101, 27), (105, 7), (106, 9), (107, 7)], 0xF0D0_4CCA),
            (&[(101, 26), (107, 9), (160, 2)], 0x6955_FE0D),
            (&[(101, 30), (102, 30), (103, 30), (107, 9)], 0x4587_195A),
            (&[(101, 10), (102, 20), (103, 20), (107, 2)], 0xF538_53F1),
        ];
        for (parameters, expected) in requests {
            let mut tunings = Vec::new();
            for level in [MIN_LEVEL - 1, -7].into_iter().chain(-1..=24) {
                let mut request = Request::new(level);
                for &(key, value) in parameters {
                    request.set(key, value)?;
                }
                for len in DICTIONARY_LENS {
                    tunings.push(request.tuning(
                        None,
                        Purpose::Frame {
                            dictionary_len: len,
                        },
                    ));
                    tunings.push(request.tuning(None, Purpose::Dictionary { len }));
                }
                for input_len in INPUT_LENS {
                    tunings.extend(DICTIONARY_LENS.map(|dictionary_len| {
                        request.tuning(Some(input_len), Purpose::Frame { dictionary_len })
                    }));
                }
            }
            let values = tunings.iter().flat_map(|it| {
                let logs = [it.window_log, it.chain_log, it.hash_log, it.search_log];
                logs.into_iter()
                    .chain([it.min_match, it.target_length, it.strategy as u32])
            });
            assert_eq!(hash(values), expected, "{parameters:?}");
        }
        Ok(())
    }

    /// The hash is of what `ZSTD_ldm_adjustParameters()` leaves.
    #[test]
    fn long_distance_parameters_are_those_of_zstd() {
        let mut values = Vec::new();
        for window_log in WINDOW_LOG_MIN..=WINDOW_LOG_MAX {
            for strategy in (1..=9).filter_map(Strategy::new) {
                let tuning = Tuning {
                    window_log,
                    strategy,
                    ..Request::new(1).tuning(None, Purpose::Frame { dictionary_len: 0 })
                };
                for index in 0..6 * 4 * 3 * 2 {
                    let asked = LongDistance {
                        hash_log: index / 24 * 6,
                        hash_rate_log: index / 6 % 4 * 3,
                        bucket_log: index / 2 % 3 * 4,
                        min_match: index % 2 * 8,
                    };
                    let it = asked.completed(&tuning);
                    values.extend([it.hash_log, it.bucket_log, it.min_match, it.hash_rate_log]);
                }
            }
        }
        assert_eq!(hash(values.into_iter()), 0x6925_7E0A);
    }

    #[test]
    fn large_windows_bring_more_with_them() -> Result<()> {
        // Rows, splitting, long distances
        let plans = [
            (14, 3, [false, false, false]),
            (15, 2, [false, false, false]),
            (15, 3, [true, false, false]),
            (31, 5, [true, false, false]),
            (31, 6, [false, false, false]),
            (16, 7, [false, false, false]),
            (17, 7, [false, true, false]),
            (26, 9, [false, true, false]),
            (27, 7, [false, true, true]),
            (28, 9, [false, true, true]),
        ];
        for (window_log, strategy, expected) in plans {
            let mut request = Request::new(1);
            request.set(101, window_log)?;
            request.set(107, strategy)?;
            let plan = request.plan(request.tuning(None, Purpose::Frame { dictionary_len: 0 }));
            let actual = [
                plan.uses_rows,
                plan.splits_blocks,
                matches!(plan.long_matches, LongMatches::Own(_)),
            ];
            assert_eq!(actual, expected, "{window_log} {strategy}");
        }
        Ok(())
    }

    #[test]
    fn some_values_are_clamped() -> Result<()> {
        let mut request = Request::new(1);
        for (value, expected) in [
            (i32::MAX, [256, 1 << 30, 9]),
            (1, [1, 512 << 10, 1]),
            (0, [0, 0, 0]),
            (i32::MIN, [0, 512 << 10, 0]),
        ] {
            for key in [400, 401, 402] {
                request.set(key, value)?;
            }
            let actual = [
                request.workers,
                request.job_len,
                request.overlap_log as usize,
            ];
            assert_eq!(actual, expected);
        }
        for (value, expected) in [(-1, 1340), (1340, 1340), (1341, 1341), (0, 0)] {
            request.set(130, value)?;
            assert_eq!(request.target_block_len, expected);
        }
        Ok(())
    }
}
