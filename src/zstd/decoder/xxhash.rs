//! XXH64. Unlike that of `bun_highway`, it links without the C++ objects and inlines into the search for long matches.

const PRIME_1: u64 = 0x9E37_79B1_85EB_CA87;
const PRIME_2: u64 = 0xC2B2_AE3D_27D4_EB4F;
const PRIME_3: u64 = 0x1656_67B1_9E37_79F9;
const PRIME_4: u64 = 0x85EB_CA77_C2B2_AE63;
const PRIME_5: u64 = 0x27D4_EB2F_1656_67C5;
const STRIPE_LEN: usize = 32;

/// With seed 0.
pub struct XxHash64 {
    lanes: [u64; 4],
    total_len: u64,
    /// The first `total_len % STRIPE_LEN` bytes count.
    partial: [u8; STRIPE_LEN],
}

#[inline(always)]
fn round(state: u64, word: u64) -> u64 {
    (state.wrapping_add(word.wrapping_mul(PRIME_2)))
        .rotate_left(31)
        .wrapping_mul(PRIME_1)
}

#[inline(always)]
fn consume(lanes: &mut [u64; 4], stripes: &[[u8; STRIPE_LEN]]) {
    let mut state = *lanes;
    for stripe in stripes {
        for (lane, word) in state.iter_mut().zip(stripe.as_chunks().0) {
            *lane = round(*lane, u64::from_le_bytes(*word));
        }
    }
    *lanes = state;
}

#[inline(always)]
fn finish(lanes: [u64; 4], total_len: u64, tail: &[u8]) -> u64 {
    let mut hash = if total_len >= STRIPE_LEN as u64 {
        let [a, b, c, d] = lanes;
        let sum = a
            .rotate_left(1)
            .wrapping_add(b.rotate_left(7))
            .wrapping_add(c.rotate_left(12))
            .wrapping_add(d.rotate_left(18));
        lanes.into_iter().fold(sum, |hash, word| {
            (hash ^ round(0, word))
                .wrapping_mul(PRIME_1)
                .wrapping_add(PRIME_4)
        })
    } else {
        PRIME_5
    };
    hash = hash.wrapping_add(total_len);

    let (words, mut tail) = tail.as_chunks();
    for word in words {
        hash ^= round(0, u64::from_le_bytes(*word));
        hash = hash
            .rotate_left(27)
            .wrapping_mul(PRIME_1)
            .wrapping_add(PRIME_4);
    }
    if let Some((word, rest)) = tail.split_first_chunk() {
        hash ^= u64::from(u32::from_le_bytes(*word)).wrapping_mul(PRIME_1);
        hash = hash
            .rotate_left(23)
            .wrapping_mul(PRIME_2)
            .wrapping_add(PRIME_3);
        tail = rest;
    }
    for &byte in tail {
        hash ^= u64::from(byte).wrapping_mul(PRIME_5);
        hash = hash.rotate_left(11).wrapping_mul(PRIME_1);
    }

    hash = (hash ^ (hash >> 33)).wrapping_mul(PRIME_2);
    hash = (hash ^ (hash >> 29)).wrapping_mul(PRIME_3);
    hash ^ (hash >> 32)
}

impl XxHash64 {
    pub const fn new() -> Self {
        Self {
            lanes: [
                PRIME_1.wrapping_add(PRIME_2),
                PRIME_2,
                0,
                PRIME_1.wrapping_neg(),
            ],
            total_len: 0,
            partial: [0; STRIPE_LEN],
        }
    }

    #[inline]
    pub fn hash(bytes: &[u8]) -> u64 {
        let mut lanes = Self::new().lanes;
        let (stripes, tail) = bytes.as_chunks();
        consume(&mut lanes, stripes);
        finish(lanes, bytes.len() as u64, tail)
    }

    fn partial_len(&self) -> usize {
        (self.total_len % STRIPE_LEN as u64) as usize
    }

    pub fn update(&mut self, mut bytes: &[u8]) {
        let partial_len = self.partial_len();
        self.total_len = self.total_len.wrapping_add(bytes.len() as u64);
        if partial_len != 0 {
            let (head, rest) = bytes.split_at(bytes.len().min(STRIPE_LEN - partial_len));
            for (to, from) in self.partial.iter_mut().skip(partial_len).zip(head) {
                *to = *from;
            }
            if partial_len + head.len() < STRIPE_LEN {
                return;
            }
            consume(&mut self.lanes, &[self.partial]);
            bytes = rest;
        }
        let (stripes, tail) = bytes.as_chunks();
        consume(&mut self.lanes, stripes);
        for (to, from) in self.partial.iter_mut().zip(tail) {
            *to = *from;
        }
    }

    pub fn digest(&self) -> u64 {
        let tail = self.partial.get(..self.partial_len()).unwrap_or_default();
        finish(self.lanes, self.total_len, tail)
    }
}
