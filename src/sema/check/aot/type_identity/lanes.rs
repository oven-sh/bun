use crate::types::fold;
use std::hash::Hasher;

#[derive(Copy, Clone)]
pub struct Lanes(pub [u64; 2]);

impl Lanes {
    pub const START: Lanes = Lanes([0x243f_6a88_85a3_08d3, 0x1319_8a2e_0370_7344]);

    #[inline]
    pub fn add(&mut self, word: u64) {
        self.0[0] = fold(self.0[0] ^ word, 0x9e37_79b9_7f4a_7c15);
        self.0[1] = fold(self.0[1].rotate_left(23) ^ word, 0xc2b2_ae3d_27d4_eb4f);
    }
}

impl Hasher for Lanes {
    fn write(&mut self, bytes: &[u8]) {
        let (words, rest) = bytes.as_chunks::<8>();
        for word in words {
            self.add(u64::from_le_bytes(*word));
        }
        let mut last = [0; 8];
        last[..rest.len()].copy_from_slice(rest);
        self.add(u64::from_le_bytes(last) ^ (bytes.len() as u64) << 56);
    }

    fn finish(&self) -> u64 {
        self.0[0]
    }
}
