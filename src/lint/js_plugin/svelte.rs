//! The project's own `svelte/compiler`, for `svelte/no-unused-svelte-ignore`. See `worker/svelte.js`.

use super::eslint::{NOT_INSTALLED, PLUGIN_PROTOCOL_ERROR};
use super::host::Host;
use super::wire::{self, result};
use crate::svelte_compiler::{Compiled, SvelteCompiler};

/// Call kinds, numbered after those in `prettier.rs`.
mod call {
    /// The JSON's length, the JSON, the text.
    pub(super) const COMPILE: u32 = 31;
}

impl SvelteCompiler for Host<'_> {
    fn compile(&self, request: &[u8], text: &[u8]) -> Compiled {
        let mut message = Vec::with_capacity(4 + request.len() + text.len());
        wire::words(&mut message, &[request.len() as u32]);
        message.extend_from_slice(request);
        message.extend_from_slice(text);
        let mut returned = Err(PLUGIN_PROTOCOL_ERROR.to_vec());
        // A component is small, and its realm has no TypeScript program to keep.
        let called = self.engine.with_vm(0, &mut |vm| {
            let mut serve = |asked: u32, details: &[u8], out: &mut Vec<u8>| {
                self.serve_common(asked, details, out);
            };
            returned = vm.call(call::COMPILE, &message, &mut serve);
        });
        if let Err(why) = called {
            return Compiled::Failed(why);
        }
        match returned {
            Ok(answer) => match answer.split_first() {
                Some((&result::DONE, json)) => crate::json::parse(json).map_or_else(
                    || Compiled::Failed(PLUGIN_PROTOCOL_ERROR.to_vec()),
                    Compiled::Answer,
                ),
                Some((&NOT_INSTALLED, _)) => Compiled::NotInstalled,
                Some((&result::FAILED, why)) => Compiled::Failed(why.to_vec()),
                _ => Compiled::Failed(PLUGIN_PROTOCOL_ERROR.to_vec()),
            },
            Err(why) => Compiled::Failed(why),
        }
    }
}
