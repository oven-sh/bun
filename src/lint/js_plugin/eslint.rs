//! Runs ESLint's own `Linter` for files that Bun can't build a tree for: those where an `eslint.config.js` sets a
//! `language` other than JavaScript, or a parser that Bun doesn't know. See `worker/eslint.js`.
//!
//! The `Linter` comes from the project's installed `eslint`. Its config is built from what's configured for the file
//! ([`Configuration`]) plus the objects that this refers to, each taken from the module that exports it. The config
//! file is only run again for values that JSON can't represent.

use super::engine::Vm;
use super::host::Host;
use super::processor::{FindRule, read_messages};
use super::wire::{self, result};
use crate::linter::{LintMessage, write_json};
use crate::options::Json;
use std::sync::atomic::{AtomicU32, Ordering};

/// Call kinds, numbered after those in `processor.rs`.
mod call {
    /// `flags`, the [`Configuration`](super::Configuration)'s id, the path's length, the length of the path's prefix
    /// that is the file's path on disk, the path, the text.
    pub(super) const LINT: u32 = 20;
    /// JSON: `[id, run, configuration]`.
    pub(super) const CONFIGURE: u32 = 21;
}

/// First bytes of a call's result, numbered after those in `processor.rs`.
const NEEDS_CONFIGURATION: u8 = b'4';
pub(super) const NOT_INSTALLED: u8 = b'5';

pub(super) const PLUGIN_PROTOCOL_ERROR: &[u8] =
    b"Internal error while running JavaScript plugins. This is a bug in Bun.";

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

/// A file's config.
#[derive(Debug)]
pub struct Configuration {
    id: u32,
    /// `{ object, parser, plugins }`, as `builtConfiguration` in `worker/eslint.js` reads it. `null` for
    /// [`Configuration::whole`].
    json: Box<[u8]>,
}

impl Configuration {
    pub fn new(built: &Json) -> Configuration {
        let mut json = Vec::new();
        write_json(&mut json, built);
        Configuration {
            id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
            json: json.into(),
        }
    }

    /// Uses whatever the config file has for a file. A realm runs the whole config file.
    pub fn whole() -> Configuration {
        Configuration::new(&Json::Null)
    }
}

/// Text to lint.
#[derive(Copy, Clone)]
pub struct Text<'t> {
    /// ESLint's `filename`.
    pub path: &'t [u8],
    /// The length of the prefix of `path` that is ESLint's `physicalFilename`. That's all of it, unless this is a block
    /// extracted by a processor.
    pub physical_path_len: usize,
    pub text: &'t [u8],
    /// ESLint's `disableFixes`.
    pub without_fixes: bool,
}

/// The result of ESLint's `Linter` for a text.
#[derive(Default, Debug)]
pub struct Linted {
    pub messages: Vec<LintMessage>,
    pub suppressed: Vec<LintMessage>,
    /// JSON: ESLint's `usedDeprecatedRules`.
    pub deprecated: Vec<u8>,
}

/// Why ESLint's `Linter` returned no result.
#[derive(Clone, Debug)]
pub enum EslintFailure {
    /// The project has no `eslint`.
    NotInstalled,
    Thrown(Vec<u8>),
}

impl From<Vec<u8>> for EslintFailure {
    fn from(message: Vec<u8>) -> EslintFailure {
        EslintFailure::Thrown(message)
    }
}

impl Host<'_> {
    /// Calls `vm` with `message`, sending it the config first if it doesn't have it yet. Returns JSON.
    fn lint_in(
        &self,
        vm: &mut dyn Vm,
        message: &[u8],
        configuration: &Configuration,
        run: &[u8],
    ) -> Result<Vec<u8>, EslintFailure> {
        let mut serve = |request: u32, details: &[u8], out: &mut Vec<u8>| {
            self.serve_common(request, details, out);
        };
        for _ in 0..2 {
            let returned = vm.call(call::LINT, message, &mut serve)?;
            match returned.split_first() {
                Some((&result::DONE, json)) => return Ok(json.to_vec()),
                Some((&result::FAILED, why)) => return Err(why.to_vec().into()),
                Some((&NEEDS_CONFIGURATION, _)) => {}
                _ => break,
            }
            let id = configuration.id.to_string();
            let parts: [&[u8]; 7] = [
                b"[",
                id.as_bytes(),
                b",",
                run,
                b",",
                &configuration.json,
                b"]",
            ];
            let configured = vm.call(call::CONFIGURE, &parts.concat(), &mut serve)?;
            match configured.split_first() {
                Some((&result::DONE, _)) => {}
                Some((&NOT_INSTALLED, _)) => return Err(EslintFailure::NotInstalled),
                Some((&result::FAILED, why)) => return Err(why.to_vec().into()),
                _ => break,
            }
        }
        Err(PLUGIN_PROTOCOL_ERROR.to_vec().into())
    }

    /// Calls ESLint's `Linter.verify`. `run` is JSON with what all files of a config file share: `from`, `basePath`,
    /// `allowInlineConfig`, `onlyErrors`, `aboutLayout`, and for [`Configuration::whole`] `file`, `ignores` and `added`.
    /// `reviveOverride` in `worker/eslint.js` turns each object in `added` into one that every ESLint 9 and 10 accepts.
    pub fn lint_with_eslint(
        &self,
        configuration: &Configuration,
        run: &[u8],
        file: Text,
        find_rule: &FindRule,
    ) -> Result<Linted, EslintFailure> {
        let mut message = Vec::with_capacity(16 + file.path.len() + file.text.len());
        wire::words(
            &mut message,
            &[
                u32::from(file.without_fixes),
                configuration.id,
                file.path.len() as u32,
                file.physical_path_len as u32,
            ],
        );
        message.extend_from_slice(file.path);
        message.extend_from_slice(file.text);
        self.count_eslint_run();
        let mut returned = Err(PLUGIN_PROTOCOL_ERROR.to_vec().into());
        self.engine.with_vm(file.text.len(), &mut |vm| {
            returned = self.lint_in(vm, &message, configuration, run)
        })?;
        let Some(parts) = crate::json::parse(&returned?).and_then(Json::into_array) else {
            return Err(PLUGIN_PROTOCOL_ERROR.to_vec().into());
        };
        let [shown, suppressed, deprecated] = &parts[..] else {
            return Err(PLUGIN_PROTOCOL_ERROR.to_vec().into());
        };
        let mut deprecated_json = Vec::new();
        write_json(&mut deprecated_json, deprecated);
        Ok(Linted {
            messages: read_messages(shown, file.text, find_rule).0,
            suppressed: read_messages(suppressed, file.text, find_rule).1,
            deprecated: deprecated_json,
        })
    }
}
