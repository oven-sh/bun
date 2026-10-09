//! The project's own Prettier, for `bun format`: files in a language that only one of its plugins reads. See
//! `worker/prettier.js`.

use super::eslint::{NOT_INSTALLED, OUT_OF_STEP, Refusal};
use super::host::Host;
use super::wire::{self, result};

/// What the program is called with, after those of `eslint.rs`.
mod call {
    /// The length of the JSON, the JSON, the text.
    pub(super) const FORMAT: u32 = 30;
}

impl Host<'_> {
    /// `prettier.format(text, ..)`. `how`: JSON, as `formatWithPrettier` in `worker/prettier.js` reads it.
    pub fn format_with_prettier(&self, how: &[u8], text: &[u8]) -> Result<Vec<u8>, Refusal> {
        let mut message = Vec::with_capacity(4 + how.len() + text.len());
        wire::words(&mut message, &[how.len() as u32]);
        message.extend_from_slice(how);
        message.extend_from_slice(text);
        let mut returned = Err(OUT_OF_STEP.to_vec());
        self.engine.with_vm(text.len(), &mut |vm| {
            let mut serve = |asked: u32, details: &[u8], out: &mut Vec<u8>| {
                self.serve_any(asked, details, out);
            };
            returned = vm.call(call::FORMAT, &message, &mut serve);
        })?;
        match returned?.split_first() {
            Some((&result::DONE, formatted)) => Ok(formatted.to_vec()),
            Some((&NOT_INSTALLED, _)) => Err(Refusal::NotInstalled),
            Some((&result::FAILED, why)) => Err(why.to_vec().into()),
            _ => Err(OUT_OF_STEP.to_vec().into()),
        }
    }
}
