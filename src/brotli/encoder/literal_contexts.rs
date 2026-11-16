//! Qualities 5 to 9 choose among a few fixed ways to group the contexts of literals.

use super::log2::fast_log2;
use super::params::{LARGE_INPUT_SIZE, Params};
use super::ring_buffer::Window;
use crate::context::{ContextMode, LITERAL_CONTEXTS};

pub(super) const MAX_GROUPS: usize = 13;

pub(super) struct ContextGroups {
    pub(super) count: usize,
    pub(super) of_context: [u8; LITERAL_CONTEXTS],
}

const fn with_first(count: usize, first: [u8; 4]) -> ContextGroups {
    let mut of_context = [0; LITERAL_CONTEXTS];
    of_context.split_at_mut(4).0.copy_from_slice(&first);
    ContextGroups { count, of_context }
}

// https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/encode.c#L264
static SIMPLE_UTF8: ContextGroups = with_first(2, [0, 0, 1, 1]);
static CONTINUATION: ContextGroups = with_first(3, [1, 1, 2, 2]);
static COMPLEX_UTF8: ContextGroups = ContextGroups {
    count: MAX_GROUPS,
    of_context: [
        11, 11, 12, 12, 0, 0, 0, 0, 1, 1, 9, 9, 2, 2, 2, 2, 1, 1, 1, 1, 8, 3, 3, 3, 1, 1, 1, 1, 2,
        2, 2, 2, 8, 4, 4, 4, 8, 7, 4, 4, 8, 0, 0, 0, 3, 3, 3, 3, 5, 5, 10, 5, 5, 5, 10, 5, 6, 6, 6,
        6, 6, 6, 6, 6,
    ],
};

const SAMPLE_LENGTH: usize = 64;

pub(super) fn choose(
    window: Window<'_>,
    start: usize,
    length: usize,
    params: &Params,
) -> Option<&'static ContextGroups> {
    if params.quality < 5 || params.disable_literal_context_modeling || length < SAMPLE_LENGTH {
        return None;
    }
    let samples = || {
        let starts = (start..=start + length - SAMPLE_LENGTH).step_by(4096);
        starts.map(|at| (at..at + SAMPLE_LENGTH).map(move |at| window.byte(at)))
    };
    if params.size_hint >= LARGE_INPUT_SIZE && complex_groups_help(samples()) {
        return Some(&COMPLEX_UTF8);
    }
    let mut bigrams = [[0; 3]; 3];
    for sample in samples() {
        let mut previous: Option<usize> = None;
        for byte in sample {
            let kind = usize::from(byte >> 6).saturating_sub(1);
            if let Some(previous) = previous.replace(kind) {
                bigrams[previous][kind] += 1;
            }
        }
    }
    choose_by_bigrams(&bigrams, params.quality)
}

#[inline(never)]
fn entropy(counts: &[u32]) -> f64 {
    let mut total = 0;
    let mut sum = 0.0;
    for &count in counts {
        total += count as usize;
        sum += f64::from(count) * fast_log2(count as usize);
    }
    total as f64 * fast_log2(total) - sum
}

// https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/encode.c#L328
fn complex_groups_help(samples: impl Iterator<Item = impl Iterator<Item = u8>>) -> bool {
    let lut = ContextMode::Utf8.lut();
    let mut combined = [0; 32];
    let mut grouped = [[0; 32]; MAX_GROUPS];
    for sample in samples {
        let (mut last, mut second_last) = (0, 0);
        for (i, byte) in sample.enumerate() {
            if i >= 2 {
                let group = COMPLEX_UTF8.of_context[lut.context(last, second_last)];
                combined[usize::from(byte >> 3)] += 1;
                grouped[usize::from(group)][usize::from(byte >> 3)] += 1;
            }
            (last, second_last) = (byte, last);
        }
    }
    let scale = 1.0 / f64::from(combined.iter().sum::<u32>());
    let without = entropy(&combined) * scale;
    let with = grouped.iter().fold(0.0, |sum, group| sum + entropy(group)) * scale;
    with <= 3.0 && without - with >= 0.2
}

/// `bigrams` counts ASCII, continuation and lead bytes after each other.
fn choose_by_bigrams(bigrams: &[[u32; 3]; 3], quality: u32) -> Option<&'static ContextGroups> {
    let add = |a: [u32; 3], b: [u32; 3]| [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    let [after_ascii, after_continuation, after_lead] = *bigrams;
    let after_others = add(after_ascii, after_lead);
    let all = add(after_others, after_continuation);
    let scale = 1.0 / f64::from(all.iter().sum::<u32>());
    let one = entropy(&all) * scale;
    let two = (entropy(&after_others) + entropy(&after_continuation)) * scale;
    let three = if quality < 7 {
        one * 10.0
    } else {
        (entropy(&after_ascii) + entropy(&after_continuation) + entropy(&after_lead)) * scale
    };
    if one - two < 0.2 && one - three < 0.2 {
        None
    } else if two - three < 0.02 {
        Some(&SIMPLE_UTF8)
    } else {
        Some(&CONTINUATION)
    }
}
