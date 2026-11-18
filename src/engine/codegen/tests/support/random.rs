//! Numbers that depend on a seed only.

pub(crate) fn mix(a: u64, b: u64) -> u64 {
    let mut z = (a ^ b.rotate_left(32)).wrapping_add(0x9e37_79b9_7f4a_7c15 ^ b);
    z = (z ^ z >> 30).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ z >> 27).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ z >> 31
}

#[derive(Clone)]
pub(crate) struct Random(u64);

impl Random {
    pub(crate) fn new(seed: u64) -> Self {
        Self(mix(seed, 0x1234_5678))
    }

    pub(crate) fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ z >> 30).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ z >> 27).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ z >> 31
    }

    pub(crate) fn next128(&mut self) -> u128 {
        u128::from(self.next()) << 64 | u128::from(self.next())
    }

    /// From zero up to `end`, which is excluded.
    pub(crate) fn below(&mut self, end: usize) -> usize {
        debug_assert!(end != 0);
        ((u128::from(self.next()) * end as u128) >> 64) as usize
    }

    /// Both ends are included.
    pub(crate) fn between(&mut self, least: i64, greatest: i64) -> i64 {
        least + self.below((greatest - least) as usize + 1) as i64
    }

    pub(crate) fn percent(&mut self, chance: u32) -> bool {
        self.below(100) < chance as usize
    }

    pub(crate) fn one_in(&mut self, count: usize) -> bool {
        self.below(count) == 0
    }

    pub(crate) fn flip(&mut self) -> bool {
        self.next() >> 63 != 0
    }

    pub(crate) fn pick<T: Copy>(&mut self, items: &[T]) -> T {
        items[self.below(items.len())]
    }

    /// The weights are not all zero.
    pub(crate) fn weighted<T: Copy>(&mut self, items: &[(u32, T)]) -> T {
        let total: u32 = items.iter().map(|&(weight, _)| weight).sum();
        let mut rest = self.below(total as usize) as u32;
        for &(weight, item) in items {
            if rest < weight {
                return item;
            }
            rest -= weight;
        }
        unreachable!()
    }

    pub(crate) fn shuffle<T>(&mut self, items: &mut [T]) {
        for end in (1..items.len()).rev() {
            items.swap(end, self.below(end + 1));
        }
    }
}
