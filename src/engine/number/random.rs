use core::mem::offset_of;

/// The generator behind Math.random: xorshift128+ of Vigna, "Further scramblings of Marsaglia's xorshift generators",
/// with the shifts 23, 17 and 26. Compiled code steps it in line.
#[derive(Clone, Copy)]
#[repr(C)]
pub struct Random {
    low: u64,
    high: u64,
    seed: u32,
}

impl Random {
    pub const OFFSET_OF_LOW: usize = offset_of!(Random, low);
    pub const OFFSET_OF_HIGH: usize = offset_of!(Random, high);

    pub fn new(seed: u32) -> Random {
        // An all-zero state stays zero.
        let state = u64::from(seed.max(1));
        let mut random = Random {
            low: state,
            high: state,
            seed,
        };
        random.next_u64();
        random
    }

    pub fn seed(&self) -> u32 {
        self.seed
    }

    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        let (mut x, y) = (self.low, self.high);
        x ^= x << 23;
        x ^= x >> 17;
        x ^= y ^ (y >> 26);
        (self.low, self.high) = (y, x);
        x.wrapping_add(y)
    }

    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        self.next_u64() as u32
    }

    /// The low 53 bits over 2^53.
    #[inline]
    pub fn next_f64(&mut self) -> f64 {
        const SCALE: u64 = 1 << 53;
        (self.next_u64() % SCALE) as i64 as f64 * (1.0 / SCALE as f64)
    }
}
