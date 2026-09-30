// internal/core/tristate_stringer_generated.go: the String method that stringer generates for Tristate.
use crate::core::tristate::Tristate;

const TRISTATE_NAME: &[u8] = b"TSUnknownTSFalseTSTrue";

const TRISTATE_INDEX: [u8; 4] = [0, 9, 16, 22];

impl Tristate {
    pub fn string(self) -> Vec<u8> {
        let idx = usize::from(self.0);
        match (TRISTATE_INDEX.get(idx), TRISTATE_INDEX.get(idx + 1)) {
            (Some(&start), Some(&end)) => TRISTATE_NAME
                .get(usize::from(start)..usize::from(end))
                .unwrap_or(&[])
                .to_vec(),
            _ => format!("Tristate({})", self.0).into_bytes(),
        }
    }
}
