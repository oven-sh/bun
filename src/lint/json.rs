//! Reads JSON, with comments and trailing commas allowed, JSON5, TOML and YAML: the values of Bun's
//! parsers as [`Json`].

use crate::linter::write_json;
use crate::options::Json;
use crate::utils::text::{number_to_string, string_from_code_points};
use bun_ast::E::JsonValue;
use bun_ast::expr::Data;
use bun_ast::{ASTMemoryAllocator, Expr, Log, Source};
use bun_parsers::json::ParsedJson;
use bun_parsers::json5::JSON5Parser;
use bun_parsers::toml::TOML;
use bun_parsers::yaml::{CyclicAliases, YAML};

/// How deep arrays and objects can be nested.
const MAX_DEPTH: usize = 512;

/// `None` if `text` is not JSON.
pub fn parse(text: &[u8]) -> Option<Json> {
    // Which the parser takes for `{}`.
    if text.is_empty() {
        return None;
    }
    let mut allocator = ASTMemoryAllocator::default();
    let _scope = allocator.enter();
    let source = Source::init_path_string(b"".as_slice(), text);
    let parsed = ParsedJson::parse_jsonc_document(&source, &mut Log::init()).ok()?;
    let root = match parsed.root.data {
        Data::ENull(_) => JsonValue::Null,
        Data::EBoolean(it) => JsonValue::Boolean(it.value),
        Data::ENumber(it) => JsonValue::Number(it),
        Data::EString(it) => JsonValue::String(it.get().data),
        Data::EArrayJSON(it) => JsonValue::Array(it),
        Data::EObjectJSON(it) => JsonValue::Object(it),
        _ => return None,
    };
    convert(&root, 0)
}

/// Compiled into the test harness only, and only as long as there are two parsers of JSON: all that
/// can be seen of a parse, as text, and a parse that is dropped, for measuring.
#[cfg(bun_sema_mimalloc)]
pub mod comparison {
    use super::{ASTMemoryAllocator, Data, JsonValue, Log, Source};
    use bun_ast::Loc;
    use bun_parsers::json::{JSONOptions, ParsedJson, parse_rows_for_comparison};
    use std::io::Write as _;

    /// `json`, `jsonc`, `document` (JSONC and nothing behind it), `manifest` (no warnings), `locs`
    /// (JSONC with the places of the values), `env`.
    fn options(name: &str) -> (JSONOptions, bool) {
        let lenient = JSONOptions {
            allow_comments: true,
            allow_trailing_commas: true,
            ..JSONOptions::DEFAULT
        };
        match name {
            "json" => (JSONOptions::DEFAULT, false),
            "strict-document" => (JSONOptions::DEFAULT, true),
            "jsonc" => (lenient, false),
            "document" => (lenient, true),
            "locs" => {
                let options = JSONOptions {
                    record_value_locs: true,
                    guess_indentation: true,
                    ..lenient
                };
                (options, false)
            }
            "env" => {
                let options = JSONOptions {
                    allow_trailing_commas: true,
                    ignore_leading_escape_sequences: true,
                    ..JSONOptions::DEFAULT
                };
                (options, false)
            }
            _ => {
                let options = JSONOptions {
                    json_warn_duplicate_keys: false,
                    ..JSONOptions::DEFAULT
                };
                (options, false)
            }
        }
    }

    fn parse(
        name: &str,
        is_one_pass: bool,
        source: &Source,
        log: &mut Log,
    ) -> Result<ParsedJson, &'static str> {
        let (options, check_len) = options(name);
        parse_rows_for_comparison(source, log, options, check_len, is_one_pass)
            .map_err(|error| error.name())
    }

    /// Returns whether `text` is taken.
    pub fn read_and_drop(name: &str, is_one_pass: bool, text: &[u8]) -> bool {
        let mut allocator = ASTMemoryAllocator::default();
        let _scope = allocator.enter();
        let source = Source::init_path_string(b"".as_slice(), text);
        parse(name, is_one_pass, &source, &mut Log::init()).is_ok()
    }

    fn write_value(out: &mut Vec<u8>, value: &JsonValue, loc: Option<Loc>, depth: usize) {
        if let Some(loc) = loc {
            let _ = write!(out, "@{} ", loc.start);
        }
        match value {
            JsonValue::Null => out.extend_from_slice(b"null"),
            JsonValue::Boolean(it) => {
                let _ = write!(out, "{it}");
            }
            JsonValue::Number(it) => {
                let _ = write!(out, "{:016x}", it.value().to_bits());
            }
            JsonValue::String(it) => {
                let _ = write!(out, "{:?}", bstr::BStr::new(it.slice()));
            }
            _ if depth > 400 => out.extend_from_slice(b"deep"),
            JsonValue::Array(it) => {
                let it = it.get();
                let _ = write!(
                    out,
                    "[{} {} ",
                    it.is_single_line, it.close_bracket_loc.start
                );
                let locs = it.item_locs();
                for (index, item) in it.items().iter().enumerate() {
                    write_value(out, item, locs.map(|locs| locs[index]), depth + 1);
                    out.push(b',');
                }
                out.push(b']');
            }
            JsonValue::Object(it) => {
                let it = it.get();
                let _ = write!(out, "{{{} {} ", it.is_single_line, it.close_brace_loc.start);
                let locs = it.value_locs();
                for (index, property) in it.properties().iter().enumerate() {
                    let key = bstr::BStr::new(property.key.slice());
                    let _ = write!(out, "@{} {key:?}:", property.key_loc.start);
                    write_value(
                        out,
                        &property.value,
                        locs.map(|locs| locs[index]),
                        depth + 1,
                    );
                    out.push(b',');
                }
                out.push(b'}');
            }
        }
    }

    /// The error or the rows, with all their places, and every message with its place.
    pub fn describe(name: &str, is_one_pass: bool, text: &[u8]) -> Vec<u8> {
        let mut allocator = ASTMemoryAllocator::default();
        let _scope = allocator.enter();
        let source = Source::init_path_string(b"".as_slice(), text);
        let mut log = Log::init();
        let mut out = Vec::new();
        match parse(name, is_one_pass, &source, &mut log) {
            Err(error) => out.extend_from_slice(error.as_bytes()),
            Ok(parsed) => {
                let root = match parsed.root.data {
                    Data::ENull(_) => JsonValue::Null,
                    Data::EBoolean(it) => JsonValue::Boolean(it.value),
                    Data::ENumber(it) => JsonValue::Number(it),
                    Data::EString(it) => JsonValue::String(it.get().data),
                    Data::EArrayJSON(it) => JsonValue::Array(it),
                    Data::EObjectJSON(it) => JsonValue::Object(it),
                    _ => JsonValue::Null,
                };
                write_value(&mut out, &root, Some(parsed.root.loc), 0);
            }
        }
        let _ = write!(out, " | {} errors {} warnings", log.errors, log.warnings);
        for message in &log.msgs {
            let text = bstr::BStr::new(&message.data.text);
            let _ = write!(out, " | {:?} {text:?}", message.kind);
            if let Some(it) = &message.data.location {
                let _ = write!(
                    out,
                    " {}+{} {}:{}",
                    it.offset, it.length, it.line, it.column
                );
            }
        }
        out
    }
}

fn convert(value: &JsonValue, depth: usize) -> Option<Json> {
    if depth > MAX_DEPTH {
        return None;
    }
    Some(match value {
        JsonValue::Null => Json::Null,
        JsonValue::Boolean(it) => Json::Bool(*it),
        JsonValue::Number(it) => Json::Number(it.value()),
        JsonValue::String(it) => Json::String(it.slice().to_vec()),
        JsonValue::Array(it) => {
            let items = it.get().items().iter();
            Json::Array(
                items
                    .map(|item| convert(item, depth + 1))
                    .collect::<Option<_>>()?,
            )
        }
        JsonValue::Object(it) => {
            let properties = it.get().properties().iter();
            Json::Object(
                properties
                    .map(|it| Some((it.key.slice().to_vec(), convert(&it.value, depth + 1)?)))
                    .collect::<Option<_>>()?,
            )
        }
    })
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Notation {
    Json5,
    Toml,
    Yaml,
}

/// The value that `text` is in `notation`, as `JSON.stringify` writes it: what is not a finite number
/// is `null`, a date of TOML is a string, as it is written. No document of YAML is `null`, several are
/// an array. A repeated key is there as often as it is written. `Err`: what is wrong with `text`.
pub fn parse_as(notation: Notation, text: &[u8]) -> Result<Json, Vec<u8>> {
    let arena = bun_alloc::Arena::new();
    let mut allocator = ASTMemoryAllocator::borrowing(&arena);
    let _scope = allocator.enter();
    let text = bun_core::strings::without_utf8_bom(text);
    let source = Source::init_path_string(b"".as_slice(), text);
    let mut log = Log::init();
    let root = match notation {
        Notation::Json5 => JSON5Parser::parse(&source, &mut log, &arena).ok(),
        Notation::Toml => TOML::parse(&source, &mut log, &arena, false).ok(),
        Notation::Yaml => YAML::parse(&source, &mut log, &arena, CyclicAliases::Reject).ok(),
    };
    let Some(root) = root else {
        let message = log.msgs.first().map(|it| it.data.text.to_vec());
        return Err(message.unwrap_or_else(|| b"Syntax error".to_vec()));
    };
    // An alias of YAML is a value once more: a short text can stand for any number of them.
    let mut left = text.len().saturating_mul(64).clamp(1 << 10, 1 << 23);
    from_expr(&root, 0, &mut left).ok_or_else(|| b"It has too many values".to_vec())
}

/// `left`: how many more values there can be.
fn from_expr(expr: &Expr, depth: usize, left: &mut usize) -> Option<Json> {
    *left = left.checked_sub(1)?;
    if depth > MAX_DEPTH {
        return None;
    }
    Some(match &expr.data {
        Data::EBoolean(it) => Json::Bool(it.value),
        Data::ENumber(it) if it.value().is_finite() => Json::Number(it.value()),
        Data::EString(it) if it.is_utf16 => Json::String(string_from_code_points(
            it.slice16().iter().map(|unit| u32::from(*unit)),
        )),
        Data::EString(it) => Json::String(it.slice8().to_vec()),
        Data::EArray(it) => {
            let mut items = it.slice().iter();
            Json::Array(items.try_fold(Vec::new(), |mut items, item| {
                items.push(from_expr(item, depth + 1, left)?);
                Some(items)
            })?)
        }
        Data::EObject(it) => {
            let mut entries = Vec::with_capacity(it.properties.len());
            for property in it.properties.iter() {
                let (Some(key), Some(value)) = (&property.key, &property.value) else {
                    continue;
                };
                // `String(key)`, but for a key that is an array or an object.
                let key = match from_expr(key, depth + 1, left)? {
                    Json::String(key) => key,
                    Json::Number(key) => number_to_string(key),
                    key => {
                        let mut text = Vec::new();
                        write_json(&mut text, &key);
                        text
                    }
                };
                entries.push((key, from_expr(value, depth + 1, left)?));
            }
            Json::Object(entries)
        }
        _ => Json::Null,
    })
}
