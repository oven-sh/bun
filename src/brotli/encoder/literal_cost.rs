//! Estimates what each byte costs as a literal, from the bytes around it.

use super::log2::fast_log2;

/// Whether more than three quarters of the bytes belong to UTF-8 sequences.
pub(super) fn is_mostly_utf8([first, second]: [&[u8]; 2]) -> bool {
    let after = |bytes: &[u8], next: &[u8]| {
        let (mut joined, last) = ([0; 6], &bytes[bytes.len().saturating_sub(3)..]);
        let slots = joined[3 - last.len()..].iter_mut();
        for (slot, byte) in slots.zip(last.iter().chain(next)) {
            *slot = *byte;
        }
        bytes_in_sequences(&joined)
    };
    let valid = bytes_in_sequences(first)
        + after(first, second)
        + bytes_in_sequences(second)
        + after(second, &[]);
    valid * 4 > (first.len() + second.len()) * 3
}

/// Of those that start before the last three bytes. They do not overlap, because none starts with a continuation byte.
#[inline(never)]
fn bytes_in_sequences(bytes: &[u8]) -> usize {
    const BATCH: usize = 48;
    let (mut total, mut rest) = (0, bytes);
    while let Some(batch) = rest.first_chunk::<{ BATCH + 3 }>() {
        let sum = (0..BATCH).fold(0, |sum, i| {
            sum + sequence_length(batch[i], batch[i + 1], batch[i + 2], batch[i + 3])
        });
        total += usize::from(sum);
        rest = &rest[BATCH..];
    }
    let lengths = rest
        .array_windows()
        .map(|&[lead, b, c, d]| sequence_length(lead, b, c, d));
    total + lengths.map(usize::from).sum::<usize>()
}

/// Zero for NUL, and for what is not UTF-8. Surrogates count.
#[inline(always)]
fn sequence_length(lead: u8, b: u8, c: u8, d: u8) -> u8 {
    let continues = |byte: u8| (byte as i8) < -0x40;
    let (two, three, four) = (continues(b), continues(c), continues(d));
    let out_of_range =
        (lead == 0xE0) & (b < 0xA0) | (lead == 0xF0) & (b < 0x90) | (lead == 0xF4) & (b >= 0x90);
    let two = two & !out_of_range;
    u8::from(matches!(lead, 1..=0x7F))
        + 2 * u8::from(matches!(lead, 0xC2..=0xDF) & two)
        + 3 * u8::from(matches!(lead, 0xE0..=0xEF) & two & three)
        + 4 * u8::from(matches!(lead, 0xF0..=0xF4) & two & three & four)
}

/// Carries the rounding error along.
#[derive(Default)]
pub(super) struct Sum {
    total: f32,
    carry: f32,
}

impl Sum {
    #[inline(always)]
    pub(super) fn add(&mut self, cost: f32) -> f32 {
        self.carry += cost;
        let total = self.total + self.carry;
        self.carry -= total - self.total;
        self.total = total;
        total
    }
}

/// Appends the cost up to each byte to `sums`, which has room for them.
pub(super) fn estimate(data: &[u8], sums: &mut Vec<f32>) {
    let mut sum = Sum::default();
    let mut add = |cost| sums.push(sum.add(cost as f32));
    // https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/literal_cost.c#L61
    if !is_mostly_utf8([data, &[]]) {
        estimate_in_classes(data, 2000, 0.029, |_| 0, add);
        return;
    }
    // After a lead byte, or after the second byte of three or more.
    let continues = |pair: &[u8; 2]| pair[1] >= 0xC0 || (pair[1] >= 0x80 && pair[0] >= 0xE0);
    let starts_with_lead = data.first().is_some_and(|&byte| byte >= 0xC0);
    let continuations = data.array_windows().filter(|pair| continues(pair));
    let use_classes = continuations.take(25).count() + usize::from(starts_with_lead) >= 25;
    let class_at = |at: usize| {
        let before = |n| at.checked_sub(n).map_or(0, |at| data[at]);
        usize::from(continues(&[before(2), before(1)]))
    };
    let mut position = 0;
    let emit = |mut cost| {
        if position < 2000 {
            cost += 0.35 + (0.35 / 2000.0) * f64::from(position);
            position += 1;
        }
        add(cost);
    };
    if use_classes {
        estimate_in_classes(data, 495, 0.02905, class_at, emit);
    } else {
        estimate_in_classes(data, 495, 0.02905, |_| 0, emit);
    }
}

#[derive(Clone, Copy)]
struct Class {
    counts: [usize; 256],
    total: usize,
    /// A total, and its logarithm.
    logged: (usize, f64),
}

impl Class {
    #[inline(always)]
    fn add(&mut self, byte: u8) {
        self.counts[usize::from(byte)] += 1;
        self.total += 1;
    }

    #[inline(always)]
    fn remove(&mut self, byte: u8) {
        self.counts[usize::from(byte)] -= 1;
        self.total -= 1;
    }

    #[inline(always)]
    fn cost(&mut self, byte: u8, overhead: f64) -> f64 {
        if self.logged.0 != self.total {
            self.logged = (self.total, fast_log2(self.total));
        }
        let cost = self.logged.1 - fast_log2(self.counts[usize::from(byte)]) + overhead;
        if cost < 1.0 { cost * 0.5 + 0.5 } else { cost }
    }
}

#[inline(always)]
fn estimate_in_classes(
    data: &[u8],
    half_window: usize,
    overhead: f64,
    class_at: impl Fn(usize) -> usize,
    mut emit: impl FnMut(f64),
) {
    let mut classes = [Class {
        counts: [0; _],
        total: 0,
        logged: (0, 0.0),
    }; 2];
    for (at, &byte) in data.iter().enumerate().take(half_window) {
        classes[class_at(at)].add(byte);
    }
    for (at, &byte) in data.iter().enumerate() {
        if let Some(old) = at.checked_sub(half_window) {
            classes[class_at(old)].remove(data[old]);
        }
        if let Some(&new) = data.get(at + half_window) {
            classes[class_at(at + half_window)].add(new);
        }
        emit(classes[class_at(at)].cost(byte, overhead));
    }
}
