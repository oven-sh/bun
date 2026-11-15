//! Estimates what each byte costs as a literal, from the bytes around it.

use super::log2::fast_log2;

/// Whether more than three quarters of the bytes belong to UTF-8 sequences.
pub(super) fn is_mostly_utf8(parts: [&[u8]; 2]) -> bool {
    let [first, second] = parts;
    let (mut valid, mut at) = (0, 0);
    while let Some(rest @ [_, ..]) = first.get(at..) {
        let length = if rest.len() >= 4 {
            sequence_length(rest)
        } else {
            let mut joined = [0; 4];
            for (slot, byte) in joined.iter_mut().zip(rest.iter().chain(second)) {
                *slot = *byte;
            }
            sequence_length(&joined)
        };
        valid += length;
        at += length.max(1);
    }
    at -= first.len();
    while let Some(rest @ [_, ..]) = second.get(at..) {
        let length = sequence_length(rest);
        valid += length;
        at += length.max(1);
    }
    valid * 4 > (first.len() + second.len()) * 3
}

/// Zero for NUL, and for what is not UTF-8. Surrogates count.
#[inline(always)]
fn sequence_length(bytes: &[u8]) -> usize {
    match *bytes {
        [1..=0x7F, ..] => 1,
        [0xC2..=0xDF, 0x80..=0xBF, ..] => 2,
        [0xE0, 0xA0..=0xBF, 0x80..=0xBF, ..] | [0xE1..=0xEF, 0x80..=0xBF, 0x80..=0xBF, ..] => 3,
        [0xF0, 0x90..=0xBF, 0x80..=0xBF, 0x80..=0xBF, ..]
        | [0xF1..=0xF3, 0x80..=0xBF, 0x80..=0xBF, 0x80..=0xBF, ..]
        | [0xF4, 0x80..=0x8F, 0x80..=0xBF, 0x80..=0xBF, ..] => 4,
        _ => 0,
    }
}

/// Appends a cost for each byte to `costs`, which has room for them.
pub(super) fn estimate(data: &[u8], costs: &mut Vec<f32>) {
    // https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/literal_cost.c#L61
    if !is_mostly_utf8([data, &[]]) {
        estimate_in_classes(data, 2000, 0.029, |_| 0, |cost| costs.push(cost as f32));
        return;
    }
    // After a lead byte, or after the second byte of three or more.
    let continues = |pair: &[u8; 2]| pair[1] >= 0xC0 || (pair[1] >= 0x80 && pair[0] >= 0xE0);
    let starts_with_lead = data.first().is_some_and(|&byte| byte >= 0xC0);
    let continuations = data.array_windows().filter(|pair| continues(pair)).count();
    let use_classes = continuations + usize::from(starts_with_lead) >= 25;
    let class_at = |at: usize| {
        let before = |n| at.checked_sub(n).map_or(0, |at| data[at]);
        usize::from(use_classes && continues(&[before(2), before(1)]))
    };
    let mut position = 0;
    estimate_in_classes(data, 495, 0.02905, class_at, |mut cost| {
        if position < 2000 {
            cost += 0.35 + (0.35 / 2000.0) * f64::from(position);
            position += 1;
        }
        costs.push(cost as f32);
    });
}

#[inline(always)]
fn estimate_in_classes(
    data: &[u8],
    half_window: usize,
    overhead: f64,
    class_at: impl Fn(usize) -> usize,
    mut emit: impl FnMut(f64),
) {
    let mut histograms = [[0; 256]; 2];
    let mut totals = [0; 2];
    for (at, &byte) in data.iter().enumerate().take(half_window) {
        histograms[class_at(at)][usize::from(byte)] += 1;
        totals[class_at(at)] += 1;
    }
    for (at, &byte) in data.iter().enumerate() {
        if let Some(old) = at.checked_sub(half_window) {
            histograms[class_at(old)][usize::from(data[old])] -= 1;
            totals[class_at(old)] -= 1;
        }
        if let Some(&new) = data.get(at + half_window) {
            histograms[class_at(at + half_window)][usize::from(new)] += 1;
            totals[class_at(at + half_window)] += 1;
        }
        let class = class_at(at);
        let count = histograms[class][usize::from(byte)];
        let cost = fast_log2(totals[class]) - fast_log2(count) + overhead;
        emit(if cost < 1.0 { cost * 0.5 + 0.5 } else { cost });
    }
}
