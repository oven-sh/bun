//! ESLint's `processor`: it extracts blocks of code from a file and maps the reports about them back. See
//! `worker/processor.js`.
//!
//! [`Host::process`] calls the processor's two functions, and its caller lints the blocks in between. Messages are
//! passed as ESLint's JSON: [`write_messages`], [`read_messages`].

use super::engine::Vm;
use super::host::{Host, number};
use super::wire::{self, result};
use crate::context::Severity;
use crate::fix::{Fix, SuggestionKind};
use crate::linter::{
    Data, LintMessage, NotNumbers, RuleId, Suggestion, Suppression, SuppressionKind, Utf16Offsets,
    write_json,
};
use crate::options::Json;
use crate::span::Span;
use bun_core::strings::Utf16OffsetTable;
use std::borrow::Cow;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

/// Call kinds, numbered after those in [`wire::call`].
mod call {
    /// The [`Processor`](super::Processor)'s id, the path's length, the path, the text.
    pub(super) const PREPROCESS: u32 = 10;
    /// The same, with JSON instead of the text: each block's messages.
    pub(super) const POSTPROCESS: u32 = 11;
    /// JSON: `[id, location]`.
    pub(super) const LOAD_PROCESSOR: u32 = 12;
}

/// A first byte of a call's result, numbered after those in [`wire::result`].
const NEEDS_PROCESSOR: u8 = b'3';

const PLUGIN_PROTOCOL_ERROR: &[u8] =
    b"Internal error while running JavaScript plugins. This is a bug in Bun.";

static NEXT_ID: AtomicU32 = AtomicU32::new(0);

/// How a file covered by an `eslint.config.js` is linted.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Route {
    /// It's plain JavaScript or TypeScript.
    Native,
    /// It's in another [language](crate::languages) that Bun parses itself, and all the rules that are on are built in.
    Language,
    /// A processor extracts blocks from it, and each block gets its own route.
    Processor,
    /// The `Linter` of the project's installed `eslint` lints it. The file has a `language` that Bun can't parse, a
    /// rule for that language that isn't built in, or an unknown parser and a name that doesn't look like JavaScript.
    Eslint,
    /// It isn't linted. It needs a processor or `eslint`, but the config isn't ESLint's or the package isn't installed.
    Unsupported,
}

/// ESLint's `processor`.
#[derive(Debug)]
pub struct Processor {
    /// No module exports it, so a realm has to run the whole config file to get it.
    pub needs_config_file: bool,
    id: u32,
    /// `[id, location]`
    json: Box<[u8]>,
}

impl Processor {
    /// `location` is the `$processor` value, in which the script that evaluates an `eslint.config.js` records where the
    /// processor is.
    pub fn new(location: &Json) -> Arc<Processor> {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let mut json = format!("[{id},").into_bytes();
        write_json(&mut json, location);
        json.push(b']');
        let is_in_configuration = |it: &Json| it.get(b"config").is_some();
        Arc::new(Processor {
            needs_config_file: is_in_configuration(location)
                || location.get(b"plugin").is_some_and(is_in_configuration),
            id,
            json: json.into(),
        })
    }
}

/// A piece of code that a processor extracted from a file.
#[derive(Debug)]
pub enum Block {
    /// It's linted the way the file itself would be without the processor.
    Unnamed(Vec<u8>),
    /// `path` is the file's path, treated as a directory, followed by the block's number and the name that the
    /// processor gives it.
    Named { path: Vec<u8>, text: Vec<u8> },
}

/// Finds a rule by name.
pub(crate) type FindRule<'f> = dyn Fn(&[u8]) -> RuleId + 'f;

fn text_of(json: Option<&Json>) -> Option<String> {
    Some(std::str::from_utf8(json?.as_str()?).ok()?.to_owned())
}

/// `{ range, text }`
fn fix_of(json: Option<&Json>, offsets: &Utf16OffsetTable) -> Option<Fix> {
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

fn suggestion_of(json: &Json, offsets: &Utf16OffsetTable) -> Option<Suggestion> {
    let data = json.get(b"data").map_or(Data::None, |data| {
        let mut data_json = Vec::new();
        write_json(&mut data_json, data);
        Data::Json(data_json)
    });
    Some(Suggestion {
        message_id: text_of(json.get(b"messageId")).map_or(Cow::Borrowed(""), Cow::Owned),
        message: json.get(b"desc")?.as_str()?.to_vec(),
        data,
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

fn message_of(json: &Json, offsets: &Utf16OffsetTable, find_rule: &FindRule) -> LintMessage {
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
        not_numbers: NotNumbers {
            line: matches!(json.get(b"line"), Some(Json::Null)),
            column: matches!(json.get(b"column"), Some(Json::Null)),
        },
        ..LintMessage::default()
    }
}

/// ESLint's `_distinguishSuppressedMessages` for `messages`, an array of its messages about `text`. Returns the shown
/// messages and the suppressed ones.
pub fn read_messages(
    messages: &Json,
    text: &[u8],
    find_rule: &FindRule,
) -> (Vec<LintMessage>, Vec<LintMessage>) {
    let offsets = Utf16OffsetTable::without_bom(text);
    messages
        .as_array()
        .unwrap_or_default()
        .iter()
        .map(|it| message_of(it, &offsets, find_rule))
        .partition(|it| it.suppressions.is_empty())
}

/// Appends what ESLint has before `_distinguishSuppressedMessages`: `shown` and `suppressed` merged into one array.
/// Both are about `text` and sorted by position.
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
    /// ESLint's `_verifyWithFlatConfigArrayAndProcessor` for the file at `path`. `lint` gets whether the processor has
    /// `supportsAutofix` and the blocks. It returns JSON with what [`write_messages`] writes for each block, or the
    /// thrown error. Returns ESLint's messages about `text`, for [`read_messages`].
    pub fn process(
        &self,
        processor: &Processor,
        path: &[u8],
        text: &[u8],
        lint: &mut (dyn FnMut(bool, Vec<Block>) -> Result<Vec<u8>, Vec<u8>> + Send),
    ) -> Result<Json, Vec<u8>> {
        let mut outcome = Err(PLUGIN_PROTOCOL_ERROR.to_vec());
        // Both calls have to go to the same realm, because a processor remembers a file's blocks.
        self.engine.with_vm(text.len(), &mut |vm| {
            outcome = self.process_in(vm, processor, path, text, lint);
        })?;
        outcome
    }

    /// Calls `vm` with `rest` for the file at `path`, loading the processor first if the realm doesn't have it yet.
    /// Returns JSON.
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
        let mut serve = |request: u32, details: &[u8], out: &mut Vec<u8>| {
            self.serve_common(request, details, out);
        };
        for _ in 0..2 {
            let returned = vm.call(kind, &message, &mut serve)?;
            match returned.split_first() {
                Some((&result::DONE, json)) => {
                    return crate::json::parse(json).ok_or_else(|| PLUGIN_PROTOCOL_ERROR.to_vec());
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
        Err(PLUGIN_PROTOCOL_ERROR.to_vec())
    }

    fn process_in(
        &self,
        vm: &mut dyn Vm,
        processor: &Processor,
        path: &[u8],
        text: &[u8],
        lint: &mut (dyn FnMut(bool, Vec<Block>) -> Result<Vec<u8>, Vec<u8>> + Send),
    ) -> Result<Json, Vec<u8>> {
        let returned = self.call_processor(vm, call::PREPROCESS, processor, path, text)?;
        let Some(mut parts) = returned.into_array() else {
            return Err(PLUGIN_PROTOCOL_ERROR.to_vec());
        };
        let (Some(found), Some(supports_autofix)) = (parts.pop(), parts.pop()) else {
            return Err(PLUGIN_PROTOCOL_ERROR.to_vec());
        };
        // The processor threw, so that error is the file's only message.
        let Some(supports_autofix) = supports_autofix.as_bool() else {
            return Ok(Json::Array(vec![found]));
        };
        let Some(found) = found.into_array() else {
            return Err(PLUGIN_PROTOCOL_ERROR.to_vec());
        };
        let mut blocks = Vec::with_capacity(found.len());
        for mut block in found {
            blocks.push(match &mut block {
                Json::String(text) => Block::Unnamed(std::mem::take(text)),
                Json::Array(parts) => match &mut parts[..] {
                    [Json::String(path), Json::String(text)] => Block::Named {
                        path: std::mem::take(path),
                        text: std::mem::take(text),
                    },
                    _ => return Err(PLUGIN_PROTOCOL_ERROR.to_vec()),
                },
                _ => return Err(PLUGIN_PROTOCOL_ERROR.to_vec()),
            });
        }
        let lists = lint(supports_autofix, blocks)?;
        self.call_processor(vm, call::POSTPROCESS, processor, path, &lists)
    }
}
