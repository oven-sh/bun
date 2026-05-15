//! Adler-32 checksum.
//!
//! Ported from `vendor/zig/lib/std/hash/Adler32.zig` (which itself follows
//! https://tools.ietf.org/html/rfc1950#section-9 and zlib's `adler32.c`).
//!
//! `HashObject.zig` exposes this via `hashWrap(std.hash.Adler32)`, which calls
//! the single-argument `hash(input)` (no seed) — the JS-side seed argument is
//! ignored for Adler32.

pub struct Adler32 {
    pub adler: u32,
}

impl Default for Adler32 {
    #[inline]
    fn default() -> Self {
        Self { adler: 1 }
    }
}

impl Adler32 {
    const BASE: u32 = 65521;
    const NMAX: usize = 5552;

    #[inline]
    pub fn init() -> Self {
        Self::default()
    }

    pub fn permute(state: u32, input: &[u8]) -> u32 {
        let mut s1 = state & 0xffff;
        let mut s2 = (state >> 16) & 0xffff;

        if input.len() == 1 {
            s1 = s1.wrapping_add(input[0] as u32);
            if s1 >= Self::BASE {
                s1 -= Self::BASE;
            }
            s2 = s2.wrapping_add(s1);
            if s2 >= Self::BASE {
                s2 -= Self::BASE;
            }
        } else if input.len() < 16 {
            for &b in input {
                s1 = s1.wrapping_add(b as u32);
                s2 = s2.wrapping_add(s1);
            }
            if s1 >= Self::BASE {
                s1 -= Self::BASE;
            }
            s2 %= Self::BASE;
        } else {
            const N: usize = Adler32::NMAX / 16; // note: 16 | NMAX

            let mut i: usize = 0;

            while i + Self::NMAX <= input.len() {
                let mut rounds: usize = 0;
                while rounds < N {
                    // Zig: `inline while (j < 16)` — rely on the optimizer to unroll.
                    for j in 0..16usize {
                        s1 = s1.wrapping_add(input[i + j] as u32);
                        s2 = s2.wrapping_add(s1);
                    }
                    i += 16;
                    rounds += 1;
                }
                s1 %= Self::BASE;
                s2 %= Self::BASE;
            }

            if i < input.len() {
                while i + 16 <= input.len() {
                    for j in 0..16usize {
                        s1 = s1.wrapping_add(input[i + j] as u32);
                        s2 = s2.wrapping_add(s1);
                    }
                    i += 16;
                }
                while i < input.len() {
                    s1 = s1.wrapping_add(input[i] as u32);
                    s2 = s2.wrapping_add(s1);
                    i += 1;
                }
                s1 %= Self::BASE;
                s2 %= Self::BASE;
            }
        }

        s1 | (s2 << 16)
    }

    #[inline]
    pub fn update(&mut self, input: &[u8]) {
        self.adler = Self::permute(self.adler, input);
    }

    #[inline]
    pub fn hash(input: &[u8]) -> u32 {
        Self::permute(1, input)
    }
}

#[cfg(test)]
mod tests {
    use super::Adler32;

    #[test]
    fn sanity() {
        assert_eq!(Adler32::hash(b"a"), 0x620062);
        assert_eq!(Adler32::hash(b"example"), 0xbc002ed);
    }

    #[test]
    fn long() {
        let long1 = [1u8; 1024];
        assert_eq!(Adler32::hash(&long1), 0x06780401);
        let long2 = [1u8; 1025];
        assert_eq!(Adler32::hash(&long2), 0x0a7a0402);
    }

    #[test]
    fn very_long() {
        let long = [1u8; 5553];
        assert_eq!(Adler32::hash(&long), 0x707f15b2);
    }

    #[test]
    fn very_long_with_variation() {
        let mut long = [0u8; 6000];
        for (i, b) in long.iter_mut().enumerate() {
            *b = i as u8; // @truncate
        }
        assert_eq!(Adler32::hash(&long), 0x5af38d6e);
    }
}
