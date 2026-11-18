//! Keeps a program from placing bytes of its choice in executable memory reliably.

use crate::operand::Width;

const ONE_IN: u64 = 64;
const LEAST_BLINDED: u64 = 0x00ff_ffff;

pub(crate) struct Blinding {
    state: u64,
}

impl Blinding {
    pub(crate) fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    /// SplitMix64.
    fn next(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut mixed = self.state;
        mixed = (mixed ^ mixed >> 30).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        mixed = (mixed ^ mixed >> 27).wrapping_mul(0x94d0_49bb_1331_11eb);
        mixed ^ mixed >> 31
    }

    /// Random bits to disguise `value` with, for some of the constants that are long enough to hold an instruction.
    #[inline]
    pub(crate) fn key_for(&mut self, width: Width, value: i64) -> Option<u32> {
        let (bits, complement) = match width {
            Width::W32 => (u64::from(value as u32), u64::from(!value as u32)),
            Width::W64 => (value as u64, !value as u64),
        };
        if bits < LEAST_BLINDED || complement <= 0xff {
            return None;
        }
        let random = self.next();
        random
            .is_multiple_of(ONE_IN)
            .then_some((random >> 32) as u32)
    }
}
