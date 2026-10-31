//! XXH64, which is the checksum of a frame.

const PRIME64_1: u64 = 0x9E37_79B1_85EB_CA87;
const PRIME64_2: u64 = 0xC2B2_AE3D_27D4_EB4F;
const PRIME64_3: u64 = 0x1656_67B1_9E37_79F9;
const PRIME64_4: u64 = 0x85EB_CA77_C2B2_AE63;
const PRIME64_5: u64 = 0x27D4_EB2F_1656_67C5;

const STRIPE: usize = 32;

#[inline(always)]
fn round(acc: u64, input: u64) -> u64 {
    acc.wrapping_add(input.wrapping_mul(PRIME64_2))
        .rotate_left(31)
        .wrapping_mul(PRIME64_1)
}

#[inline(always)]
fn merge_round(acc: u64, val: u64) -> u64 {
    (acc ^ round(0, val))
        .wrapping_mul(PRIME64_1)
        .wrapping_add(PRIME64_4)
}

/// `XXH64_state_t`, with a seed of 0.
#[derive(Clone)]
pub(crate) struct Xxh64 {
    total_len: u64,
    acc: [u64; 4],
    buffer: [u8; STRIPE],
    buffered: usize,
}

impl Xxh64 {
    /// `XXH64_reset`
    pub(crate) const fn new() -> Self {
        Self {
            total_len: 0,
            acc: [
                PRIME64_1.wrapping_add(PRIME64_2),
                PRIME64_2,
                0,
                0u64.wrapping_sub(PRIME64_1),
            ],
            buffer: [0; STRIPE],
            buffered: 0,
        }
    }

    #[inline(always)]
    fn consume(acc: &mut [u64; 4], stripe: &[u8; STRIPE]) {
        let (lanes, _) = stripe.as_chunks::<8>();
        for (acc, lane) in acc.iter_mut().zip(lanes) {
            *acc = round(*acc, u64::from_le_bytes(*lane));
        }
    }

    /// `XXH64_update`
    pub(crate) fn update(&mut self, mut input: &[u8]) {
        self.total_len = self.total_len.wrapping_add(input.len() as u64);

        if self.buffered > 0 {
            let Some(free) = self.buffer.get_mut(self.buffered..) else {
                return;
            };
            let Some((head, tail)) = input.split_at_checked(free.len()) else {
                if let Some(free) = free.get_mut(..input.len()) {
                    free.copy_from_slice(input);
                }
                self.buffered += input.len();
                return;
            };
            free.copy_from_slice(head);
            Self::consume(&mut self.acc, &self.buffer);
            self.buffered = 0;
            input = tail;
        }

        let (stripes, rest) = input.as_chunks::<STRIPE>();
        let mut acc = self.acc;
        for stripe in stripes {
            Self::consume(&mut acc, stripe);
        }
        self.acc = acc;

        if let Some(buffer) = self.buffer.get_mut(..rest.len()) {
            buffer.copy_from_slice(rest);
        }
        self.buffered = rest.len();
    }

    /// `XXH64_digest`
    pub(crate) fn digest(&self) -> u64 {
        let [v1, v2, v3, v4] = self.acc;
        let mut hash = if self.total_len >= STRIPE as u64 {
            let mut hash = v1
                .rotate_left(1)
                .wrapping_add(v2.rotate_left(7))
                .wrapping_add(v3.rotate_left(12))
                .wrapping_add(v4.rotate_left(18));
            for v in self.acc {
                hash = merge_round(hash, v);
            }
            hash
        } else {
            v3.wrapping_add(PRIME64_5)
        };
        hash = hash.wrapping_add(self.total_len);

        let tail = self.buffer.get(..self.buffered).unwrap_or_default();
        let (lanes, tail) = tail.as_chunks::<8>();
        for lane in lanes {
            hash ^= round(0, u64::from_le_bytes(*lane));
            hash = hash
                .rotate_left(27)
                .wrapping_mul(PRIME64_1)
                .wrapping_add(PRIME64_4);
        }
        let (words, tail) = tail.as_chunks::<4>();
        for word in words {
            hash ^= u64::from(u32::from_le_bytes(*word)).wrapping_mul(PRIME64_1);
            hash = hash
                .rotate_left(23)
                .wrapping_mul(PRIME64_2)
                .wrapping_add(PRIME64_3);
        }
        for &byte in tail {
            hash ^= u64::from(byte).wrapping_mul(PRIME64_5);
            hash = hash.rotate_left(11).wrapping_mul(PRIME64_1);
        }

        hash ^= hash >> 33;
        hash = hash.wrapping_mul(PRIME64_2);
        hash ^= hash >> 29;
        hash = hash.wrapping_mul(PRIME64_3);
        hash ^= hash >> 32;
        hash
    }
}
