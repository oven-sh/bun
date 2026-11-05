use crate::{Quick, R, why};

impl Quick {
    pub(crate) fn print_angular(&mut self, _n: i32, _k: i32) -> R<()> {
        Err(self.stop(why::RARE))
    }
}
