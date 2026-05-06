//! RapidHash.
//!
//! Ported from `src/bun_core/deprecated.zig` (`bun.deprecated.RapidHash`).
//! `HashObject.zig` exposes this via `hashWrap(bun.deprecated.RapidHash)`,
//! which calls `hash(seed: u64, input: []const u8) -> u64`.

pub struct RapidHash;

impl RapidHash {
    pub const RAPID_SEED: u64 = 0xbdd89aa982704029;
    const RAPID_SECRET: [u64; 3] = [0x2d358dccaa6c78a5, 0x8bb84b93962eacc9, 0x4b33a62ed433d4a3];

    pub fn hash(seed: u64, input: &[u8]) -> u64 {
        let sc = Self::RAPID_SECRET;
        let len = input.len();
        let mut a: u64 = 0;
        let mut b: u64 = 0;
        let mut k = input;
        let mut is: [u64; 3] = [seed, 0, 0];

        is[0] ^= Self::mix(seed ^ sc[0], sc[1]) ^ (len as u64);

        if len <= 16 {
            if len >= 4 {
                let d: usize = (len & 24) >> (len >> 3);
                let e = len - 4;
                a = (Self::r32(k) << 32) | Self::r32(&k[e..]);
                b = (Self::r32(&k[d..]) << 32) | Self::r32(&k[e - d..]);
            } else if len > 0 {
                a = ((k[0] as u64) << 56) | ((k[len >> 1] as u64) << 32) | (k[len - 1] as u64);
            }
        } else {
            let mut remain = len;
            if len > 48 {
                is[1] = is[0];
                is[2] = is[0];
                while remain >= 96 {
                    // PERF(port): was `inline for (0..6)` — rely on optimizer.
                    for i in 0..6usize {
                        let m1 = Self::r64(&k[8 * i * 2..]);
                        let m2 = Self::r64(&k[8 * (i * 2 + 1)..]);
                        is[i % 3] = Self::mix(m1 ^ sc[i % 3], m2 ^ is[i % 3]);
                    }
                    k = &k[96..];
                    remain -= 96;
                }
                if remain >= 48 {
                    // PERF(port): was `inline for (0..3)` — rely on optimizer.
                    for i in 0..3usize {
                        let m1 = Self::r64(&k[8 * i * 2..]);
                        let m2 = Self::r64(&k[8 * (i * 2 + 1)..]);
                        is[i] = Self::mix(m1 ^ sc[i], m2 ^ is[i]);
                    }
                    k = &k[48..];
                    remain -= 48;
                }

                is[0] ^= is[1] ^ is[2];
            }

            if remain > 16 {
                is[0] = Self::mix(Self::r64(k) ^ sc[2], Self::r64(&k[8..]) ^ is[0] ^ sc[1]);
                if remain > 32 {
                    is[0] = Self::mix(Self::r64(&k[16..]) ^ sc[2], Self::r64(&k[24..]) ^ is[0]);
                }
            }

            a = Self::r64(&input[len - 16..]);
            b = Self::r64(&input[len - 8..]);
        }

        a ^= sc[1];
        b ^= is[0];
        Self::mum(&mut a, &mut b);
        Self::mix(a ^ sc[0] ^ (len as u64), b ^ sc[1])
    }

    #[inline(always)]
    fn mum(a: &mut u64, b: &mut u64) {
        let r = (*a as u128) * (*b as u128);
        *a = r as u64;
        *b = (r >> 64) as u64;
    }

    #[inline(always)]
    fn mix(a: u64, b: u64) -> u64 {
        let mut ca = a;
        let mut cb = b;
        Self::mum(&mut ca, &mut cb);
        ca ^ cb
    }

    #[inline(always)]
    fn r64(p: &[u8]) -> u64 {
        u64::from_le_bytes(p[0..8].try_into().unwrap())
    }

    #[inline(always)]
    fn r32(p: &[u8]) -> u64 {
        u32::from_le_bytes(p[0..4].try_into().unwrap()) as u64
    }
}

#[cfg(test)]
mod tests {
    use super::RapidHash;

    /// Mirrors the `RapidHash.hash` test in `src/bun_core/deprecated.zig`.
    #[test]
    fn vectors() {
        const BYTES: [u8; 100] = {
            let mut a = [0u8; 100];
            let mut i = 0u8;
            while i < 100 {
                a[i as usize] = i;
                i += 1;
            }
            a
        };
        const SIZES: [u64; 7] = [0, 3, 4, 16, 24, 32, 100];
        const OUTPUTS: [u64; 7] = [
            0x93228a4de0eec5a2,
            0x0dc3b86978ecf01a,
            0x1ddcfedbee9b69bb,
            0x0e6ea0ae36208ae5,
            0xf1a934408a826e6c,
            0xf5246e93237ffaf7,
            0x806e54bee5e034ee,
        ];
        for (s, o) in SIZES.iter().zip(OUTPUTS.iter()) {
            assert_eq!(RapidHash::hash(RapidHash::RAPID_SEED, &BYTES[..*s as usize]), *o);
        }
    }
}
