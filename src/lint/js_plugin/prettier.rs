//! The project's own Prettier, for `bun fmt`: files in a language that only one of its plugins reads. See
//! `worker/prettier.js`.

use super::eslint::{NOT_INSTALLED, OUT_OF_STEP};
use super::host::Host;
use super::wire::{self, result};

/// What the program is called with, after those of `eslint.rs`.
mod call {
    /// The length of the JSON, the JSON, the text.
    pub(super) const FORMAT: u32 = 30;
}

/// The first byte of what the call returns, besides those of `wire.rs`: [`Unformatted::Message`].
const MESSAGE: u8 = b'7';

/// Why there is no text from Prettier.
#[derive(Debug)]
pub enum Unformatted {
    /// The project has no `prettier`.
    NotInstalled,
    /// With `looksAtStdin`: `error.message` of what `prettier.format` has thrown.
    Message(Vec<u8>),
    /// What was thrown, as `handleError` of Prettier's command line shows it.
    Thrown(Vec<u8>),
}

impl From<Vec<u8>> for Unformatted {
    fn from(thrown: Vec<u8>) -> Unformatted {
        Unformatted::Thrown(thrown)
    }
}

impl Host<'_> {
    /// `prettier.format(text, ..)`. `how`: JSON, as `formatWithPrettier` in `worker/prettier.js` reads it.
    pub fn format_with_prettier(&self, how: &[u8], text: &[u8]) -> Result<Vec<u8>, Unformatted> {
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
            Some((&NOT_INSTALLED, _)) => Err(Unformatted::NotInstalled),
            Some((&MESSAGE, message)) => Err(Unformatted::Message(message.to_vec())),
            Some((&result::FAILED, why)) => Err(why.to_vec().into()),
            _ => Err(OUT_OF_STEP.to_vec().into()),
        }
    }
}
