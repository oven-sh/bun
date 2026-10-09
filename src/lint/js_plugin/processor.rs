//! ESLint's `processor`: it takes blocks of code out of a file, and maps what is reported about them back. See
//! `worker/processor.js`.
//!
//! [`Host::process`] calls the two functions of the processor. Whoever calls it lints the blocks in between. Messages cross as
//! ESLint's JSON: [`write_messages`], [`read_messages`].

use super::engine::Vm;
use super::host::{Host, number};
use super::offsets::Offsets;
use super::wire::{self, result};
use crate::context::Severity;
use crate::fix::{Fix, SuggestionKind};
use crate::linter::{
    LintMessage, RuleId, Suggestion, Suppression, SuppressionKind, Utf16Offsets, write_json,
};
use crate::options::Json;
use crate::span::Span;
use std::borrow::Cow;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

/// What the program is called with, after those of [`wire::call`].
mod call {
    /// The id of the [`Processor`](super::Processor), the length of the path, the path, the text.
    pub(super) const PREPROCESS: u32 = 10;
    /// The same with JSON for the text: for each block the messages.
    pub(super) const POSTPROCESS: u32 = 11;
    /// JSON: `[id, location]`.
    pub(super) const LOAD_PROCESSOR: u32 = 12;
}

/// The first byte of what a call returns, after those of [`wire::result`].
const NEEDS_PROCESSOR: u8 = b'3';

const OUT_OF_STEP: &[u8] = b"The program for JavaScript plugins is out of step.";

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

/// How a file that an `eslint.config.js` is for is linted.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Route {
    /// It is JavaScript or TypeScript as it is.
    Native,
    /// A processor takes blocks out of it, each of which goes its own way.
    Processor,
    /// By the `Linter` of the `eslint` that the project has installed: it has a `language` other than JavaScript, or a parser that
    /// is not known here is to read what is not called like JavaScript.
    Eslint,
    /// Not at all: it is for a processor or for `eslint`, and the configuration is not ESLint's or the package is not installed.
    Unsupported,
}

/// ESLint's `processor`.
#[derive(Debug)]
pub struct Processor {
    /// No module exports it: a realm has to run the whole configuration file to get at it.
    pub needs_the_configuration: bool,
    id: u32,
    /// `[id, location]`
    json: Box<[u8]>,
}

impl Processor {
    /// `location`: what the script that evaluates an `eslint.config.js` says about where the processor is, in `$processor`.
    pub fn new(location: &Json) -> Arc<Processor> {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let mut json = format!("[{id},").into_bytes();
        write_json(&mut json, location);
        json.push(b']');
        let is_in_configuration = |it: &Json| it.get(b"config").is_some();
        Arc::new(Processor {
            needs_the_configuration: is_in_configuration(location)
                || location.get(b"plugin").is_some_and(is_in_configuration),
            id,
            json: json.into(),
        })
    }
}

/// A piece of code that a processor has found in a file.
#[derive(Debug)]
pub enum Block {
    /// It is linted as the file itself would be without the processor.
    Unnamed(Vec<u8>),
    /// `path`: that of the file, as if that were a directory, and in it the number of the block and the name that the processor
    /// gives it.
    Named { path: Vec<u8>, text: Vec<u8> },
}

/// Finds the rule that is called so.
pub(crate) type FindRule<'f> = dyn Fn(&[u8]) -> RuleId + 'f;

fn text_of(json: Option<&Json>) -> Option<String> {
    Some(std::str::from_utf8(json?.as_str()?).ok()?.to_owned())
}

/// `{ range, text }`
fn fix_of(json: Option<&Json>, offsets: &Offsets) -> Option<Fix> {
    let json = json?;
    let [start, end] = json.get(b"range")?.as_array()? else {
        return None;
    };
    // The byte order mark is at -1.
    let at = |it: &Json| match it {
        Json::Number(n) if *n < 0.0 => Some(0),
        it => Some(offsets.to_bytes(number(Some(it))?)),
    };
    Some(Fix {
        span: Span::new(at(start)?, at(end)?),
        text: json.get(b"text")?.as_str()?.to_vec(),
    })
}

fn suggestion_of(json: &Json, offsets: &Offsets) -> Option<Suggestion> {
    let data = json
        .get(b"data")
        .and_then(Json::as_object)
        .unwrap_or_default();
    let data = data.iter().filter_map(|(key, value)| {
        Some((
            Cow::Owned(std::str::from_utf8(key).ok()?.to_owned()),
            value.as_str()?.to_vec(),
        ))
    });
    Some(Suggestion {
        message_id: text_of(json.get(b"messageId")).map_or(Cow::Borrowed(""), Cow::Owned),
        message: json.get(b"desc")?.as_str()?.to_vec(),
        data: data.collect(),
        fix: fix_of(json.get(b"fix"), offsets)?,
        kind: SuggestionKind::Suggestion,
    })
}

fn suppression_of(json: &Json) -> Suppression {
    Suppression {
        kind: match json.get(b"kind").and_then(Json::as_str) {
            Some(b"file") => SuppressionKind::File,
            _ => SuppressionKind::Directive,
        },
        justification: json
            .get(b"justification")
            .and_then(Json::as_str)
            .unwrap_or_default()
            .into(),
    }
}

fn message_of(json: &Json, offsets: &Offsets, find_rule: &FindRule) -> LintMessage {
    let list = |key: &[u8]| json.get(key).and_then(Json::as_array).unwrap_or_default();
    LintMessage {
        rule_id: json.get(b"ruleId").and_then(Json::as_str).map(find_rule),
        severity: match number(json.get(b"severity")) {
            Some(1) => Severity::Warn,
            _ => Severity::Error,
        },
        message: json
            .get(b"message")
            .and_then(Json::as_str)
            .unwrap_or_default()
            .to_vec(),
        message_id: text_of(json.get(b"messageId")).map(Cow::Owned),
        line: number(json.get(b"line")).unwrap_or(0),
        column: number(json.get(b"column")).unwrap_or(0),
        end: number(json.get(b"endLine")).zip(number(json.get(b"endColumn"))),
        is_fatal: json.get(b"fatal").and_then(Json::as_bool) == Some(true),
        fix: fix_of(json.get(b"fix"), offsets),
        suggestions: list(b"suggestions")
            .iter()
            .filter_map(|it| suggestion_of(it, offsets))
            .collect(),
        suppressions: list(b"suppressions").iter().map(suppression_of).collect(),
        ..LintMessage::default()
    }
}

/// ESLint's `_distinguishSuppressedMessages` for `messages`, an array of its messages about `text`: those that are shown, and
/// those that are not.
pub fn read_messages(
    messages: &Json,
    text: &[u8],
    find_rule: &FindRule,
) -> (Vec<LintMessage>, Vec<LintMessage>) {
    let offsets = Offsets::new(text);
    messages
        .as_array()
        .unwrap_or_default()
        .iter()
        .map(|it| message_of(it, &offsets, find_rule))
        .partition(|it| it.suppressions.is_empty())
}

/// Appends what ESLint has before `_distinguishSuppressedMessages`: `shown` and `suppressed`, which are about `text` and
/// sorted by position, as one array.
pub fn write_messages(
    out: &mut Vec<u8>,
    shown: &[LintMessage],
    suppressed: &[LintMessage],
    text: &[u8],
) {
    let mut offsets = Utf16Offsets::new(text);
    let (mut shown, mut suppressed) = (shown.iter().peekable(), suppressed.iter().peekable());
    out.push(b'[');
    let mut is_first = true;
    loop {
        let next = match (shown.peek(), suppressed.peek()) {
            (Some(a), Some(b)) if (b.line, b.column) < (a.line, a.column) => suppressed.next(),
            (Some(_), _) => shown.next(),
            (None, _) => suppressed.next(),
        };
        let Some(next) = next else {
            break;
        };
        if !std::mem::take(&mut is_first) {
            out.push(b',');
        }
        next.write_json(out, &mut offsets);
    }
    out.push(b']');
}

impl Host<'_> {
    /// ESLint's `_verifyWithFlatConfigArrayAndProcessor` for the file at `path`. `lint`: given whether the processor
    /// has `supportsAutofix`, and the blocks, returns JSON: for each block what [`write_messages`] writes. Or what is thrown.
    /// Returns ESLint's messages about `text`, for [`read_messages`].
    pub fn process(
        &self,
        processor: &Processor,
        path: &[u8],
        text: &[u8],
        lint: &mut dyn FnMut(bool, Vec<Block>) -> Result<Vec<u8>, Vec<u8>>,
    ) -> Result<Json, Vec<u8>> {
        let mut outcome = Err(OUT_OF_STEP.to_vec());
        // Both calls are for the same realm: a processor remembers the blocks of a file.
        self.engine.with_vm(&mut |vm| {
            outcome = self.process_in(vm, processor, path, text, lint);
        })?;
        outcome
    }

    /// Calls `vm` with `rest` for the file at `path`, after it has loaded the processor if it has not yet. Returns JSON.
    fn call_processor(
        &self,
        vm: &mut dyn Vm,
        kind: u32,
        processor: &Processor,
        path: &[u8],
        rest: &[u8],
    ) -> Result<Json, Vec<u8>> {
        let mut message = Vec::with_capacity(8 + path.len() + rest.len());
        wire::words(&mut message, &[processor.id, path.len() as u32]);
        message.extend_from_slice(path);
        message.extend_from_slice(rest);
        let mut serve = |asked: u32, details: &[u8], out: &mut Vec<u8>| {
            self.serve_any(asked, details, out);
        };
        for _ in 0..2 {
            let returned = vm.call(kind, &message, &mut serve)?;
            match returned.split_first() {
                Some((&result::DONE, json)) => {
                    return crate::json::parse(json).ok_or_else(|| OUT_OF_STEP.to_vec());
                }
                Some((&result::FAILED, why)) => return Err(why.to_vec()),
                Some((&NEEDS_PROCESSOR, _)) => {}
                _ => break,
            }
            let loaded = vm.call(call::LOAD_PROCESSOR, &processor.json, &mut serve)?;
            match loaded.split_first() {
                Some((&result::DONE, _)) => {}
                Some((&result::FAILED, why)) => return Err(why.to_vec()),
                _ => break,
            }
        }
        Err(OUT_OF_STEP.to_vec())
    }

    fn process_in(
        &self,
        vm: &mut dyn Vm,
        processor: &Processor,
        path: &[u8],
        text: &[u8],
        lint: &mut dyn FnMut(bool, Vec<Block>) -> Result<Vec<u8>, Vec<u8>>,
    ) -> Result<Json, Vec<u8>> {
        let Json::Array(mut parts) =
            self.call_processor(vm, call::PREPROCESS, processor, path, text)?
        else {
            return Err(OUT_OF_STEP.to_vec());
        };
        let (Some(found), Some(supports_autofix)) = (parts.pop(), parts.pop()) else {
            return Err(OUT_OF_STEP.to_vec());
        };
        // The processor has thrown: that is all there is to say about the file.
        let Some(supports_autofix) = supports_autofix.as_bool() else {
            return Ok(Json::Array(vec![found]));
        };
        let Json::Array(found) = found else {
            return Err(OUT_OF_STEP.to_vec());
        };
        let mut blocks = Vec::with_capacity(found.len());
        for block in found {
            blocks.push(match block {
                Json::String(text) => Block::Unnamed(text),
                Json::Array(parts) => match <[Json; 2]>::try_from(parts) {
                    Ok([Json::String(path), Json::String(text)]) => Block::Named { path, text },
                    _ => return Err(OUT_OF_STEP.to_vec()),
                },
                _ => return Err(OUT_OF_STEP.to_vec()),
            });
        }
        let lists = lint(supports_autofix, blocks)?;
        self.call_processor(vm, call::POSTPROCESS, processor, path, &lists)
    }
}
