use crate::BigIntRef;

const MULTIPLIER: u64 = 0x9e37_79b9_7f4a_7c15;
const SEED: u64 = 0x243f_6a88_85a3_08d3;

#[inline(always)]
fn mix(value: u64) -> u64 {
    let product = u128::from(value) * u128::from(MULTIPLIER);
    product as u64 ^ (product >> 64) as u64
}

impl BigIntRef<'_> {
    /// Never zero, so that zero can stand for "not computed yet".
    #[inline]
    pub fn hash(self) -> u32 {
        let start = if self.is_negative { !SEED } else { SEED };
        let state = self
            .digits
            .iter()
            .fold(start, |state, &digit| mix(state ^ digit));
        (mix(state) as u32).max(1)
    }
}
