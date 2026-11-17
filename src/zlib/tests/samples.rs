//! Made-up data. The same arguments always give the same bytes.

use std::collections::BTreeMap;
use std::ops::Range;

pub(crate) struct Random(u64);

impl Random {
    pub(crate) fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0xd134_2543_de82_ef95))
    }

    pub(crate) fn below(&mut self, end: usize) -> usize {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mixed = (self.0 ^ self.0 >> 32).wrapping_mul(0xd6e8_feb8_6659_fd93);
        let mixed = (mixed ^ mixed >> 32).wrapping_mul(0xd6e8_feb8_6659_fd93);
        (((mixed >> 32) * end as u64) >> 32) as usize
    }

    pub(crate) fn up_to(&mut self, max: usize) -> usize {
        self.below(max + 1)
    }

    pub(crate) fn pick<T: Copy>(&mut self, all: &[T]) -> T {
        all[self.below(all.len())]
    }

    pub(crate) fn bytes(&mut self, len: usize) -> Vec<u8> {
        (0..len).map(|_| self.below(256) as u8).collect()
    }

    pub(crate) fn shuffle<T>(&mut self, all: &mut [T]) {
        for len in (2..=all.len()).rev() {
            all.swap(len - 1, self.below(len));
        }
    }

    /// Stretches that differ in what is new and in what is repeated from where.
    pub(crate) fn mixed(&mut self, len: usize, window_size: usize) -> Vec<u8> {
        let mut out = Vec::new();
        while out.len() < len {
            let end = len.min(out.len() + 1 + self.below(1 + len / 3));
            let (first, symbols) = self.pick(&[(0, 256), (144, 112), (97, 26), (97, 5), (0, 2)]);
            let fresh = self.pick(&[1, 3, 12, 60, 3000]);
            let (shortest, longest) = self.pick(&[(0, 0), (3, 6), (3, 20), (8, 300), (250, 900)]);
            let near = window_size - 270;
            let (nearest, reach) = self.pick(&[(1, 1), (1, 40), (1, 600), (1, near), (near, 16)]);
            while out.len() < end {
                for _ in 0..=self.below(fresh) {
                    out.push((first + self.below(symbols)) as u8);
                }
                if let Some(start) = out.len().checked_sub(nearest + self.below(reach)) {
                    for at in start..start + shortest + self.up_to(longest - shortest) {
                        out.push(out[at]);
                    }
                }
            }
            out.truncate(end);
        }
        out
    }

    /// The bytes below `count`, as often as it takes for an optimal code to get a bit longer with each.
    pub(crate) fn uneven(&mut self, count: u8) -> Vec<u8> {
        let (mut all, mut times, mut more) = (Vec::new(), 1, 2);
        for byte in 0..count {
            all.resize(all.len() + times, byte);
            (times, more) = (more, times + more);
        }
        self.shuffle(&mut all);
        all
    }
}

/// Has no matches but those that are put in.
pub(crate) struct Planned {
    pub(crate) bytes: Vec<u8>,
    /// How often each three bytes occur.
    seen: BTreeMap<[u8; 3], u32>,
    random: Random,
}

impl Planned {
    /// They take 9 bits in a fixed block.
    pub(crate) fn with_literals(len: usize) -> Self {
        let mut planned = Self {
            bytes: vec![144, 145],
            seen: BTreeMap::new(),
            random: Random::new(1),
        };
        while planned.bytes.len() < len {
            let byte = 144 + planned.random.below(112) as u8;
            planned.append_if_new_at_the_joint(&[byte]);
        }
        planned
    }

    pub(crate) fn copy(&mut self, len: usize, distances: Range<usize>) {
        loop {
            let start = self.bytes.len() - distances.start - self.random.below(distances.len());
            let copy = self.bytes[start..start + len].to_vec();
            if self.seen[&copy[..3]] == 1 && self.append_if_new_at_the_joint(&copy) {
                return;
            }
        }
    }

    fn append_if_new_at_the_joint(&mut self, more: &[u8]) -> bool {
        let joined = [&self.bytes[self.bytes.len() - 2..], more].concat();
        let triples = joined.array_windows::<3>();
        let is_new = triples
            .clone()
            .take(2)
            .all(|it| !self.seen.contains_key(it));
        if is_new {
            triples.for_each(|&it| *self.seen.entry(it).or_default() += 1);
            self.bytes.extend(more);
        }
        is_new
    }
}
