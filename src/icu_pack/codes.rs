//! Chooses prefix codes and writes bits and numbers. There is no floating point, so that all machines choose alike.

use bun_icu_format::code::{MAX_LENGTH, SLOT_BITS, SLOTS};

/// In units of 1 / 16 bit.
pub(crate) type Cost = u32;
pub(crate) const BIT: Cost = 16;

pub(crate) fn log2(x: u32) -> Cost {
    let whole = x.ilog2();
    let (mut mantissa, mut result) = (u64::from(x) << (31 - whole), whole);
    for _ in 0..BIT.ilog2() {
        let square = (mantissa * mantissa) >> 31;
        result = result << 1 | (square >> 32) as u32;
        mantissa = square >> (square >> 32);
    }
    result
}

/// A code for values from 0 on, of which none is shorter than one before it.
pub(crate) struct Code {
    /// The number of slots for each length from 1 on.
    pub(crate) slots: Vec<u8>,
    /// By value: the bits and their number.
    codes: Vec<(u16, u8)>,
}

impl Code {
    /// The best one for values that occur `counts` times.
    pub(crate) fn new(counts: &[u32]) -> Self {
        let step = |length: usize| match length.checked_sub(SLOT_BITS as usize) {
            Some(more) => (1 << more, 1),
            None => (1, SLOTS >> length),
        };
        let mut sums = vec![0];
        sums.extend(counts.iter().scan(0, |sum, &count| {
            *sum += u64::from(count);
            Some(*sum)
        }));
        // The cost of the values from `value` on if `used` slots are taken and no code is shorter than `length`.
        let at = |value: usize, used: usize, length: usize| {
            (value * (SLOTS + 1) + used) * (MAX_LENGTH + 2) + length
        };
        let mut costs = vec![u64::MAX; at(counts.len(), 0, 0)];
        let taking = |costs: &[u64], value: usize, used: usize, length: usize| {
            let (values, slots) = step(length);
            let next = counts.len().min(value + values);
            let rest = match costs.get(at(next, used + slots, length)) {
                _ if used + slots > SLOTS => u64::MAX,
                rest => rest.copied().unwrap_or(0),
            };
            rest.saturating_add((sums[next] - sums[value]) * length as u64)
        };
        for value in (0..counts.len()).rev() {
            for used in 0..=SLOTS {
                for length in (1..=MAX_LENGTH).rev() {
                    let longer = costs[at(value, used, length + 1)];
                    costs[at(value, used, length)] =
                        longer.min(taking(&costs, value, used, length));
                }
            }
        }
        let (mut slots, mut codes, mut used) = (vec![0], Vec::new(), 0);
        while codes.len() < counts.len() {
            let (value, length) = (codes.len(), slots.len());
            if taking(&costs, value, used, length) > costs[at(value, used, length + 1)] {
                slots.push(0);
                continue;
            }
            let (values, taken) = step(length);
            let first = used << length >> SLOT_BITS;
            codes.extend((first..first + values).map(|code| (code as u16, length as u8)));
            slots[length - 1] += taken as u8;
            used += taken;
        }
        codes.truncate(counts.len());
        Self { slots, codes }
    }

    pub(crate) fn cost(&self, value: usize) -> Cost {
        Cost::from(self.codes[value].1) * BIT
    }
}

#[derive(Default)]
pub(crate) struct BitWriter {
    pub(crate) bytes: Vec<u8>,
    free: u32,
}

impl BitWriter {
    pub(crate) fn put(&mut self, bits: usize, count: u32) {
        for bit in (0..count).rev() {
            if self.free == 0 {
                self.bytes.push(0);
                self.free = 8;
            }
            self.free -= 1;
            *self.bytes.last_mut().expect("a byte") |= ((bits >> bit & 1) as u8) << self.free;
        }
    }

    pub(crate) fn put_value(&mut self, code: &Code, value: usize) {
        let (bits, count) = code.codes[value];
        self.put(bits.into(), count.into());
    }
}

pub(crate) fn push_length(out: &mut Vec<u8>, length: usize) {
    out.resize(out.len() + length / 255, 255);
    out.push((length % 255) as u8);
}

pub(crate) fn push_number(out: &mut Vec<u8>, mut number: usize) {
    while number >= 0x80 {
        out.push(number as u8 | 0x80);
        number >>= 7;
    }
    out.push(number as u8);
}

pub(crate) fn to_bytes(words: &[u16]) -> Vec<u8> {
    words.iter().flat_map(|word| word.to_le_bytes()).collect()
}
