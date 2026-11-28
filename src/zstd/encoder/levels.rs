//! What the compression levels stand for.

use bun_highway::zstd_stages::Effort;

use crate::parameters::Strategy::{self, *};

pub(crate) const MAX_LEVEL: i32 = 22;

/// The logs of window, chain, hash and search, the minimum match and the target length. Row 0 is for negative levels.
#[rustfmt::skip]
pub(crate) static LEVELS: [[([u16; 6], Strategy); MAX_LEVEL as usize + 1]; 4] = [
    // More than 256 KB, or unknown
    [
        ([19, 12, 13,  1, 6,   1], Fast),
        ([19, 13, 14,  1, 7,   0], Fast),
        ([20, 15, 16,  1, 6,   0], Fast),
        ([21, 16, 17,  1, 5,   0], DoubleFast),
        ([21, 18, 18,  1, 5,   0], DoubleFast),
        ([21, 19, 18,  1, 4,   2], Greedy),
        ([21, 19, 18,  1, 4,   4], Lazy),
        ([21, 19, 18,  2, 4,   8], Lazy),
        ([21, 20, 18,  2, 4,  16], Lazy),
        ([22, 20, 19,  2, 4,  16], Lazy),
        ([22, 21, 20,  2, 4,  16], Lazy2),
        ([22, 21, 20,  4, 4,  16], Lazy2),
        ([22, 21, 21,  4, 4,  32], Lazy2),
        ([22, 21, 21,  5, 4,  32], TreeLazy2),
        ([22, 21, 21,  6, 4,  32], TreeLazy2),
        ([22, 22, 21,  7, 4,  32], TreeLazy2),
        ([22, 21, 20,  6, 4,  48], Ultra),
        ([23, 22, 21,  6, 4,  64], Ultra2),
        ([23, 22, 21,  8, 3,  64], Ultra2),
        ([23, 22, 22,  8, 3, 256], Ultra2),
        ([25, 23, 22,  8, 3, 512], Ultra2),
        ([26, 24, 23,  9, 3, 512], Ultra2),
        ([27, 25, 24,  9, 3, 999], Ultra2),
    ],
    // Up to 256 KB
    [
        ([18, 12, 13,  1, 5,   1], Fast),
        ([18, 13, 14,  1, 6,   0], Fast),
        ([18, 14, 14,  1, 5,   0], DoubleFast),
        ([18, 16, 16,  1, 4,   0], DoubleFast),
        ([18, 18, 17,  1, 4,   2], Greedy),
        ([18, 18, 17,  1, 4,   2], Greedy),
        ([18, 18, 17,  1, 4,   4], Lazy),
        ([18, 18, 17,  2, 4,   4], Lazy),
        ([18, 18, 18,  2, 4,   8], Lazy),
        ([18, 18, 18,  3, 4,   8], Lazy),
        ([18, 18, 18,  3, 4,   8], Lazy2),
        ([18, 18, 18,  6, 4,  12], Lazy2),
        ([18, 18, 18,  6, 4,  12], TreeLazy2),
        ([18, 18, 18,  5, 3,  16], TreeLazy2),
        ([18, 18, 18,  4, 3,  16], Ultra),
        ([18, 18, 18,  4, 3,  64], Ultra),
        ([18, 18, 18,  5, 3,  64], Ultra2),
        ([18, 18, 18,  5, 3, 256], Ultra2),
        ([18, 18, 18,  7, 3, 128], Ultra2),
        ([18, 18, 18,  7, 3, 256], Ultra2),
        ([18, 18, 18,  9, 3, 256], Ultra2),
        ([18, 18, 18,  9, 3, 512], Ultra2),
        ([18, 18, 18,  9, 3, 999], Ultra2),
    ],
    // Up to 128 KB
    [
        ([17, 12, 12,  1, 5,   1], Fast),
        ([17, 12, 13,  1, 6,   0], Fast),
        ([17, 13, 15,  1, 5,   0], Fast),
        ([17, 15, 16,  2, 5,   0], DoubleFast),
        ([17, 17, 17,  2, 4,   0], DoubleFast),
        ([17, 17, 17,  1, 4,   2], Greedy),
        ([17, 17, 17,  1, 4,   4], Lazy),
        ([17, 17, 17,  1, 4,   8], Lazy),
        ([17, 17, 17,  1, 4,   8], Lazy),
        ([17, 17, 17,  2, 4,   8], Lazy),
        ([17, 17, 17,  3, 4,   8], Lazy),
        ([17, 17, 17,  3, 4,   8], Lazy2),
        ([17, 17, 17,  6, 4,  12], Lazy2),
        ([17, 17, 17,  4, 3,  12], TreeLazy2),
        ([17, 17, 17,  4, 3,  16], Ultra),
        ([17, 17, 17,  4, 3,  32], Ultra),
        ([17, 17, 17,  5, 3,  64], Ultra),
        ([17, 17, 17,  5, 3, 128], Ultra),
        ([17, 17, 17,  5, 3, 128], Ultra2),
        ([17, 17, 17,  7, 3, 256], Ultra2),
        ([17, 17, 17,  7, 3, 256], Ultra2),
        ([17, 17, 17,  8, 3, 512], Ultra2),
        ([17, 17, 17,  8, 3, 999], Ultra2),
    ],
    // Up to 16 KB
    [
        ([14, 12, 13,  1, 5,   1], Fast),
        ([14, 14, 15,  1, 5,   0], Fast),
        ([14, 14, 15,  1, 4,   0], Fast),
        ([14, 14, 15,  2, 4,   0], DoubleFast),
        ([14, 14, 14,  1, 4,   2], Greedy),
        ([14, 14, 14,  1, 4,   4], Lazy),
        ([14, 14, 14,  1, 4,   8], Lazy),
        ([14, 14, 14,  1, 4,   8], Lazy),
        ([14, 14, 14,  1, 4,   8], Lazy),
        ([14, 14, 14,  1, 4,   8], Lazy),
        ([14, 14, 14,  3, 4,   8], Lazy),
        ([14, 14, 14,  5, 4,  12], Lazy2),
        ([14, 14, 14,  4, 3,  24], TreeLazy2),
        ([14, 14, 14,  3, 3,  32], Optimal),
        ([14, 14, 14,  2, 3,  32], Ultra),
        ([14, 14, 14,  3, 3,  64], Ultra),
        ([14, 14, 14,  4, 3,  64], Ultra),
        ([14, 14, 14,  5, 3, 128], Ultra),
        ([14, 14, 14,  5, 3, 256], Ultra),
        ([14, 14, 14,  5, 3, 256], Ultra2),
        ([14, 14, 14,  5, 3, 512], Ultra2),
        ([14, 14, 14,  5, 3, 512], Ultra2),
        ([14, 14, 14,  5, 3, 999], Ultra2),
    ],
];

pub(crate) const STAGED_LEN_MIN: u64 = 256;

/// Whether [`stages_for`] has something that does as well as zstd.
pub(crate) fn is_staged(level: i32, input_len: Option<u64>) -> bool {
    match (level, input_len.unwrap_or(u64::MAX)) {
        (_, ..STAGED_LEN_MIN) | (5, 0x801..=0x4000) => false,
        (1..=5, _) | (6..=10, ..=0x800) => true,
        _ => false,
    }
}

pub(crate) struct Stages {
    /// The second one is for text.
    pub(crate) efforts: [Effort; 2],
    /// Of the tables for long and for short matches.
    pub(crate) logs: [u32; 2],
}

const NEVER: u16 = u16::MAX;

const THRIFTY: Effort = Effort {
    is_single: false,
    is_narrow: false,
    short_len: 4,
    cut: 2,
    narrow_from: 128,
    all_from: NEVER,
    second_from: 72,
    repeats_from: 40,
    records_from: 100,
};

const HASTY: Effort = Effort {
    narrow_from: NEVER,
    second_from: 130,
    repeats_from: 80,
    records_from: NEVER,
    ..THRIFTY
};

const THOROUGH: Effort = Effort {
    is_narrow: true,
    cut: 0,
    all_from: 0,
    second_from: 0,
    repeats_from: 10,
    ..THRIFTY
};

/// For matches within `len` bytes.
#[rustfmt::skip]
pub(crate) fn stages_for(level: i32, len: u64) -> Stages {
    let log = len.max(256).next_power_of_two().ilog2();
    let (effort, logs) = match (level, log) {
        (1, ..=13) => (Effort { is_single: true, ..HASTY }, [log - 3, log - 1]),
        (2, ..=13) => (Effort { is_single: true, all_from: 140, ..HASTY }, [log - 3, log - 1]),
        (3, ..=13) => (Effort { is_single: true, all_from: 120, ..THRIFTY }, [log - 3, log]),
        (_, ..=11) => (Effort { is_single: true, ..THOROUGH }, [log - 3, log]),
        (1, 14) => (HASTY, [11, 12]),
        (1, 15 | 16) => (Effort { short_len: 6, cut: 0, all_from: 160, ..HASTY }, [log - 2, log - 1]),
        (1, _) => (Effort { short_len: 6, ..HASTY }, [14, 15]),
        (2, 14) => (Effort { all_from: 220, ..HASTY }, [11, 13]),
        (2, 15..=17) => (Effort { second_from: 120, ..HASTY }, [log - 2, 14]),
        (2, 18) => (Effort { second_from: 80, ..THRIFTY }, [16, 15]),
        (2, _) => (Effort { short_len: 6, cut: 0, all_from: 150, second_from: 110, ..HASTY }, [15, 16]),
        (3, 14) => (Effort { narrow_from: NEVER, all_from: 220, second_from: 100, ..THRIFTY }, [11, 13]),
        (3, 15..=17) => (THRIFTY, [log - 2, log - 2]),
        (3, 18) => (Effort { all_from: 200, ..THRIFTY }, [16, 16]),
        (3, _) => (Effort { cut: 0, ..THRIFTY }, [16, 16]),
        (4, 15..=17) => (Effort { all_from: 150, second_from: 56, ..THRIFTY }, [log - 2, log - 1]),
        (4, 19..) => (Effort { cut: 0, all_from: 100, second_from: 48, ..THRIFTY }, [17, 17]),
        (5, 15..=17) => (Effort { all_from: 60, second_from: 32, repeats_from: 30, ..THOROUGH }, [log - 1, log]),
        (_, 19..) => (Effort { all_from: 60, second_from: 32, repeats_from: 30, ..THOROUGH }, [18, 18]),
        (_, ..=14) => (THOROUGH, [log, log]),
        _ => (THOROUGH, [log - 1, log]),
    };
    let mut text = Effort { narrow_from: NEVER, records_from: NEVER, repeats_from: 80.min(2 * effort.repeats_from), ..effort };
    if level <= 3 && log >= 14 {
        text.all_from = NEVER;
    }
    if log >= 15 {
        text.second_from = effort.second_from.min(if level == 1 { 96 } else { 88 });
    }
    if log >= if effort.is_narrow { 19 } else { 15 } || (level, log) == (1, 14) {
        (text.short_len, text.cut) = (effort.short_len.max(5), 2);
    }
    Stages { efforts: [effort, text], logs }
}
