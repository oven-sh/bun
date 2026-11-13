use crate::types::fold;

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
