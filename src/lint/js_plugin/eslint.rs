//! ESLint's own `Linter`, for files whose tree is not ours: those for which an `eslint.config.js` has a `language` other than
//! JavaScript, or a parser that is not known here. See `worker/eslint.js`.
//!
//! The `Linter` is that of the `eslint` which the project has installed. It is given a configuration that is made of what is
//! configured for the file ([`Configuration`]), and of the objects which that names, each from the module that exports it. The
//! configuration file is run again only for what JSON cannot say.

use super::engine::Vm;
use super::host::{Host, realms_for};
use super::processor::{FindRule, read_messages};
use super::wire::{self, result};
use crate::linter::{LintMessage, write_json};
use crate::options::Json;
use std::sync::atomic::{AtomicU32, Ordering};

/// What the program is called with, after those of `processor.rs`.
mod call {
    /// `flags`, the id of the [`Configuration`](super::Configuration), the length of the path, the length of what it starts with
    /// that is the path of the file on disk, the path, the text.
    pub(super) const LINT: u32 = 20;
    /// JSON: `[id, run, configuration]`.
    pub(super) const CONFIGURE: u32 = 21;
}

/// The first byte of what a call returns, after those of `processor.rs`.
const NEEDS_CONFIGURATION: u8 = b'4';
const NOT_INSTALLED: u8 = b'5';

const OUT_OF_STEP: &[u8] = b"The program for JavaScript plugins is out of step.";

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

/// What is configured for a file.
#[derive(Debug)]
pub struct Configuration {
    id: u32,
    /// `{ object, parser, plugins }`, as `builtConfiguration` in `worker/eslint.js` reads it. `null`: see [`Configuration::whole`].
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

    /// Whatever the configuration file has for a file: a realm runs all of it.
    pub fn whole() -> Configuration {
        Configuration::new(&Json::Null)
    }

    fn is_whole(&self) -> bool {
        *self.json == *b"null"
    }
}

/// Text to lint.
#[derive(Copy, Clone)]
pub struct Text<'t> {
    /// ESLint's `filename`.
    pub path: &'t [u8],
    /// How much of `path` is ESLint's `physicalFilename`: all of it, unless this is a block that a processor has found.
    pub physical_path_len: usize,
    pub text: &'t [u8],
    /// ESLint's `disableFixes`.
    pub without_fixes: bool,
}

/// What ESLint's `Linter` says about a text.
#[derive(Default, Debug)]
pub struct Linted {
    pub messages: Vec<LintMessage>,
    pub suppressed: Vec<LintMessage>,
    /// JSON: ESLint's `usedDeprecatedRules`.
    pub deprecated: Vec<u8>,
}

/// Why ESLint's `Linter` says nothing.
#[derive(Clone, Debug)]
pub enum Refusal {
    /// The project has no `eslint`.
    NotInstalled,
    /// What was thrown.
    Thrown(Vec<u8>),
}

impl From<Vec<u8>> for Refusal {
    fn from(message: Vec<u8>) -> Refusal {
        Refusal::Thrown(message)
    }
}

impl Host<'_> {
    /// Calls `vm` with `message`, after it has been told the configuration if it has not yet. Returns JSON.
    fn lint_in(
        &self,
        vm: &mut dyn Vm,
        message: &[u8],
        configuration: &Configuration,
        run: &[u8],
    ) -> Result<Vec<u8>, Refusal> {
        let mut serve = |asked: u32, details: &[u8], out: &mut Vec<u8>| {
            self.serve_any(asked, details, out);
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
                Some((&NOT_INSTALLED, _)) => return Err(Refusal::NotInstalled),
                Some((&result::FAILED, why)) => return Err(why.to_vec().into()),
                _ => break,
            }
        }
        Err(OUT_OF_STEP.to_vec().into())
    }

    /// ESLint's `Linter.verify`. `run`: JSON, what is the same for all files of a configuration file: `from`, `basePath`,
    /// `allowInlineConfig`, `onlyErrors`, and for [`Configuration::whole`] `file`, `ignores` and `added`.
    pub fn lint_with_eslint(
        &self,
        configuration: &Configuration,
        run: &[u8],
        file: Text,
        find_rule: &FindRule,
    ) -> Result<Linted, Refusal> {
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
        let mut returned = Err(OUT_OF_STEP.to_vec().into());
        self.engine
            .with_vm(realms_for(configuration.is_whole()), &mut |vm| {
                returned = self.lint_in(vm, &message, configuration, run)
            })?;
        let Some(Json::Array(parts)) = crate::json::parse(&returned?) else {
            return Err(OUT_OF_STEP.to_vec().into());
        };
        let [shown, suppressed, deprecated] = &parts[..] else {
            return Err(OUT_OF_STEP.to_vec().into());
        };
        let mut written = Vec::new();
        write_json(&mut written, deprecated);
        Ok(Linted {
            messages: read_messages(shown, file.text, find_rule).0,
            suppressed: read_messages(suppressed, file.text, find_rule).1,
            deprecated: written,
        })
    }
}
