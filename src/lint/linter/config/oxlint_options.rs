//! oxlint's errors for invalid rule options, in its wording.
//!
//! Each oxlint rule deserializes its options with serde from a `serde_json::Value` into its own struct.
//! `oxlint_fields.rs` describes those structs in a notation that [`Reader`] parses, and [`check`] does to a value what
//! serde does. The messages are those of serde, of serde_json and of the few rules that have their own.
//!
//! One thing can't be detected here: serde_json doesn't treat `1.0` as an integer.

use super::oxlint_fields::OPTIONS;
use super::rust_regex;
use crate::options::Json;
use bun_core::strings;
use std::io::Write;

/// The Rust type's name, minimum and maximum.
const INTEGERS: [(&str, f64, f64); 7] = [
    ("u8", 0.0, u8::MAX as f64),
    ("u16", 0.0, u16::MAX as f64),
    ("u32", 0.0, u32::MAX as f64),
    ("u64", 0.0, u64::MAX as f64),
    ("usize", 0.0, u64::MAX as f64),
    ("i32", i32::MIN as f64, i32::MAX as f64),
    ("i64", i64::MIN as f64, i64::MAX as f64),
];

enum Type {
    Any,
    Bool,
    /// Only this value. It's in an untagged enum, so there's no message for the other value.
    Only(bool),
    Null,
    Str,
    Char,
    Float,
    /// Its index in [`INTEGERS`].
    Integer(usize),
    /// A pattern for Rust's `regex`, with what the rule puts before and after it.
    Regex(Vec<u8>, Vec<u8>),
    Optional(Box<Type>),
    /// With the expected-type text, if it isn't "a sequence".
    Seq(Box<Type>, Option<Vec<u8>>),
    /// With the expected-type text, if it isn't "a map".
    Map(Box<Type>, Option<Vec<u8>>),
    /// An enum whose variants have no fields.
    Enum(Vec<&'static [u8]>),
    /// A string that's one of these. Any other string fails with the text, where `$` is replaced by the string.
    Words(Vec<&'static [u8]>, Vec<u8>),
    Struct(Struct),
    /// Trailing elements can be missing.
    Tuple(Vec<Type>),
    /// With the message for when no variant matches.
    Untagged(Vec<u8>, Vec<Type>),
    /// The first type that matches, or else the last type's error.
    OneOf(Vec<Type>),
    /// The type chosen by the value's kind. A map gets the struct's error, and anything else fails with the text.
    ByKind(Vec<u8>, Vec<Type>),
    /// `memberSyntaxSortOrder` in `sort-imports`
    SortOrder,
    /// `AllowWarnDeny`, where it isn't a rule's severity.
    Severity,
    /// `true` matches the type but is rejected with the text.
    NotTrue(Vec<u8>, Box<Type>),
    /// Checks the first type, then the second.
    Both(Box<Type>, Box<Type>),
    /// A number outside the range from the first to the second is rejected with the text. Anything that isn't a number
    /// passes.
    Range(f64, f64, Vec<u8>),
    /// The strings in a list are function names with `*` and `**`, which Jest's rules turn into patterns. An invalid
    /// pattern fails with the text, where `$` is replaced by the string, followed by the pattern's error. Everything
    /// else passes.
    FunctionNames(Vec<u8>),
}

struct Field {
    name: &'static [u8],
    ty: Type,
    is_required: bool,
    /// It's a field of a struct that's flattened into this one.
    is_flattened: bool,
    /// A sequence that the struct is read from has to have an element for it.
    is_needed_in_sequence: bool,
    /// It's an alias of the field this many positions further on.
    alias_of: isize,
}

struct Struct {
    name: Vec<u8>,
    fields: Vec<Field>,
    ignores_unknown_fields: bool,
    /// When read from a sequence, it needs an element for every field.
    has_no_defaults: bool,
    /// Another struct is flattened into it. So it can't be read from a sequence, the other struct's fields are read
    /// after its own, and a field only counts as unknown after that.
    has_flattened: bool,
}

/// The text after `key` and a space in the table.
fn row(key: &[u8]) -> Option<&'static [u8]> {
    let table = OPTIONS.as_bytes();
    let start = [b"\n", key, b" "].concat();
    let rest = table.get(strings::index_of(table, &start)? + start.len()..)?;
    rest.get(..strings::index_of_char_usize(rest, b'\n')?)
}

/// Returns `MaxLines` for `max-lines` and for `eslint/max-lines`.
fn in_pascal_case(key: &[u8]) -> Vec<u8> {
    let name = strings::last_index_of_char(key, b'/').map_or(key, |slash| &key[slash + 1..]);
    let mut out = Vec::with_capacity(name.len());
    for word in strings::split(name, b"-") {
        out.extend(word.first().map(u8::to_ascii_uppercase));
        out.extend_from_slice(word.get(1..).unwrap_or_default());
    }
    out
}

/// Parses the table's notation. See `generate-oxlint-fields.mjs`.
struct Reader<'r> {
    text: &'static [u8],
    at: usize,
    /// The expansion of `&` in a struct's name.
    rule: &'r [u8],
}

impl Reader<'_> {
    fn peek(&self) -> u8 {
        self.text.get(self.at).copied().unwrap_or_default()
    }

    fn next(&mut self) -> u8 {
        self.at += 1;
        self.text.get(self.at - 1).copied().unwrap_or_default()
    }

    /// Reads up to the first byte that's in `ends`.
    fn until(&mut self, ends: &[u8]) -> &'static [u8] {
        let rest = self.text.get(self.at..).unwrap_or_default();
        let len = strings::index_of_any(rest, ends).unwrap_or(rest.len());
        self.at += len;
        &rest[..len]
    }

    /// Reads the number before `end`.
    fn number(&mut self, end: &[u8]) -> f64 {
        f64::from(bun_core::fmt::parse_decimal::<u32>(self.until(end)).unwrap_or(0))
    }

    /// Reads `"text"`, if that's next. Quotes and backslashes are escaped with a backslash.
    fn quoted(&mut self) -> Option<Vec<u8>> {
        if self.peek() != b'"' {
            return None;
        }
        self.at += 1;
        let mut text = Vec::new();
        while self.at < self.text.len() {
            match self.next() {
                b'"' => break,
                b'\\' => text.push(self.next()),
                byte => text.push(byte),
            }
        }
        Some(text)
    }

    /// Reads types up to a `;`.
    fn list(&mut self) -> Vec<Type> {
        let mut all = Vec::new();
        while self.at < self.text.len() && self.peek() != b';' {
            all.push(self.ty());
        }
        self.at += 1;
        all
    }

    fn words(&mut self) -> Vec<&'static [u8]> {
        let inside = self.until(b">");
        self.at += 1;
        (strings::split(inside, b",").filter(|it| !it.is_empty())).collect()
    }

    fn structure(&mut self) -> Struct {
        let struct_name = self.until(b"~!^ )");
        let mut it = Struct {
            name: match struct_name.strip_prefix(b"&") {
                Some(rest) => [self.rule, rest].concat(),
                None => struct_name.to_vec(),
            },
            fields: Vec::new(),
            ignores_unknown_fields: false,
            has_no_defaults: false,
            has_flattened: false,
        };
        loop {
            match self.next() {
                b'~' => it.ignores_unknown_fields = true,
                b'!' => it.has_no_defaults = true,
                b'^' => it.has_flattened = true,
                b' ' => {
                    let mut field = Field {
                        name: self.until(b"!^+@$:"),
                        ty: Type::Any,
                        is_required: false,
                        is_flattened: false,
                        is_needed_in_sequence: false,
                        alias_of: 0,
                    };
                    loop {
                        match self.next() {
                            b'!' => field.is_required = true,
                            b'^' => field.is_flattened = true,
                            b'+' => field.is_needed_in_sequence = true,
                            b'@' => field.alias_of -= 1,
                            b'$' => field.alias_of += 1,
                            _ => break,
                        }
                    }
                    field.ty = self.ty();
                    it.fields.push(field);
                }
                _ => return it,
            }
        }
    }

    fn ty(&mut self) -> Type {
        match self.next() {
            b'b' => Type::Bool,
            b'T' => Type::Only(true),
            b'F' => Type::Only(false),
            b'_' => Type::Null,
            b's' => Type::Str,
            b'c' => Type::Char,
            b'f' => Type::Float,
            b'n' => Type::Integer(usize::from(self.next().wrapping_sub(b'0'))),
            b'r' => {
                let before = self.quoted().unwrap_or_default();
                Type::Regex(before, self.quoted().unwrap_or_default())
            }
            b'?' => Type::Optional(Box::new(self.ty())),
            b'[' => {
                let item = Box::new(self.ty());
                self.at += 1;
                Type::Seq(item, self.quoted())
            }
            b'{' => {
                let value = Box::new(self.ty());
                self.at += 1;
                Type::Map(value, self.quoted())
            }
            b'<' => {
                let words = self.words();
                match self.quoted() {
                    Some(text) => Type::Words(words, text),
                    None => Type::Enum(words),
                }
            }
            b'(' => Type::Struct(self.structure()),
            b'#' => Type::Tuple(self.list()),
            b'|' => {
                let text = self.quoted().unwrap_or_else(|| {
                    let name = self.until(b" ");
                    self.at += 1;
                    [b"data did not match any variant of untagged enum ", name].concat()
                });
                Type::Untagged(text, self.list())
            }
            b'/' => Type::OneOf(self.list()),
            b'%' => Type::ByKind(self.quoted().unwrap_or_default(), self.list()),
            b'+' => {
                let first = Box::new(self.ty());
                Type::Both(first, Box::new(self.ty()))
            }
            b'R' => {
                let least = self.number(b",");
                self.at += 1;
                let greatest = self.number(b"\"");
                Type::Range(least, greatest, self.quoted().unwrap_or_default())
            }
            b'J' => Type::FunctionNames(self.quoted().unwrap_or_default()),
            b'Q' => Type::SortOrder,
            b'A' => Type::Severity,
            b'!' => {
                let text = self.quoted().unwrap_or_default();
                Type::NotTrue(text, Box::new(self.ty()))
            }
            // A type shared by several rows.
            b'=' => {
                let name = self.until(b";");
                self.at += 1;
                let shared = row(&[b"=", name].concat()).unwrap_or(b"*");
                let (text, at, rule) = (shared, 0, self.rule);
                Reader { text, at, rule }.ty()
            }
            _ => Type::Any,
        }
    }
}

/// True if serde_json stores it as an integer: it's written without a decimal point or an exponent, and fits in 64
/// bits.
pub(super) fn is_integer(value: f64) -> bool {
    value.fract() == 0.0
        && !(value == 0.0 && value.is_sign_negative())
        && (i64::MIN as f64..u64::MAX as f64).contains(&value)
}

/// Writes it the way serde_json prints it.
#[optimize(size)]
pub(super) fn write_number(out: &mut Vec<u8>, value: f64) {
    if is_integer(value) {
        let _ = match value < 0.0 {
            true => write!(out, "{}", value as i64),
            false => write!(out, "{}", value as u64),
        };
        return;
    }
    let scientific = format!("{value:e}");
    let (mantissa, exponent) =
        strings::split_once_char(scientific.as_bytes(), b'e').unwrap_or((b"0", b"0"));
    let is_small = exponent.starts_with(b"-");
    let digits = exponent.strip_prefix(b"-").unwrap_or(exponent);
    let size = bun_core::fmt::parse_decimal::<u32>(digits).unwrap_or(0);
    if (is_small && size <= 5) || (!is_small && size < 16) {
        let start = out.len();
        let _ = write!(out, "{value}");
        if !strings::contains_char(&out[start..], b'.') {
            out.extend_from_slice(b".0");
        }
        return;
    }
    let sign: &[u8] = if is_small { b"e-" } else { b"e+" };
    out.extend_from_slice(&[mantissa, sign, digits].concat());
}

/// `{:?}` for a `str`.
#[optimize(size)]
pub(super) fn write_debug(out: &mut Vec<u8>, text: &[u8]) {
    let _ = match std::str::from_utf8(text) {
        Ok(text) => write!(out, "{text:?}"),
        Err(_) => write!(out, "{:?}", bstr::BStr::new(text)),
    };
}

/// Writes a string the way serde_json prints it.
#[optimize(size)]
fn write_string(out: &mut Vec<u8>, text: &[u8]) {
    out.push(b'"');
    for &byte in text {
        match byte {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            0x08 => out.extend_from_slice(b"\\b"),
            0x0C => out.extend_from_slice(b"\\f"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            0..0x20 => _ = write!(out, "\\u{byte:04x}"),
            _ => out.push(byte),
        }
    }
    out.push(b'"');
}

/// `is_spaced` puts spaces where `serde_json::to_string_pretty` has line breaks.
#[optimize(size)]
fn write_value(out: &mut Vec<u8>, value: &Json, is_spaced: bool) {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return;
    }
    let (open, comma, colon): (&[u8], &[u8], &[u8]) = match is_spaced {
        true => (b" ", b", ", b": "),
        false => (b"", b",", b":"),
    };
    match value {
        Json::Null => out.extend_from_slice(b"null"),
        Json::Bool(true) => out.extend_from_slice(b"true"),
        Json::Bool(false) => out.extend_from_slice(b"false"),
        Json::Number(it) => write_number(out, *it),
        Json::String(it) => write_string(out, it),
        Json::Array(items) if items.is_empty() => out.extend_from_slice(b"[]"),
        Json::Object(entries) if entries.is_empty() => out.extend_from_slice(b"{}"),
        Json::Array(items) => {
            out.push(b'[');
            for (at, item) in items.iter().enumerate() {
                out.extend_from_slice(if at == 0 { open } else { comma });
                write_value(out, item, is_spaced);
            }
            out.extend_from_slice(open);
            out.push(b']');
        }
        Json::Object(entries) => {
            out.push(b'{');
            for (at, (key, item)) in entries.iter().enumerate() {
                out.extend_from_slice(if at == 0 { open } else { comma });
                write_string(out, key);
                out.extend_from_slice(colon);
                write_value(out, item, is_spaced);
            }
            out.extend_from_slice(open);
            out.push(b'}');
        }
    }
}

/// `value` the way oxlint shows what it received: pretty-printed, then with every run of whitespace collapsed to one
/// space, even inside strings.
#[optimize(size)]
fn displayed_value(value: &Json) -> Vec<u8> {
    let mut printed = Vec::new();
    write_value(&mut printed, value, true);
    let Ok(text) = std::str::from_utf8(&printed) else {
        return printed;
    };
    let words: Vec<&[u8]> = text.split_whitespace().map(str::as_bytes).collect();
    words.join(&b" "[..])
}

/// `value` as serde_json prints it on one line.
pub(super) fn compact(value: &Json) -> Vec<u8> {
    let mut printed = Vec::new();
    write_value(&mut printed, value, false);
    printed
}

/// serde's `Unexpected`, as serde_json prints it.
fn unexpected(value: &Json) -> Vec<u8> {
    let mut out = Vec::new();
    match value {
        Json::Null => out.extend_from_slice(b"null"),
        Json::Bool(it) => _ = write!(out, "boolean `{it}`"),
        Json::Number(it) => {
            out.extend_from_slice(match is_integer(*it) {
                true => b"integer `",
                false => b"floating point `",
            });
            write_number(&mut out, *it);
            out.push(b'`');
        }
        Json::String(it) => {
            out.extend_from_slice(b"string ");
            write_debug(&mut out, it);
        }
        Json::Array(_) => out.extend_from_slice(b"sequence"),
        Json::Object(_) => out.extend_from_slice(b"map"),
    }
    out
}

pub(super) type Checked = Result<(), Vec<u8>>;

/// serde's `invalid_type`
#[optimize(size)]
pub(super) fn wrong_type(value: &Json, expected: &[u8]) -> Vec<u8> {
    let found = unexpected(value);
    [b"invalid type: ", &found[..], b", expected ", expected].concat()
}

fn invalid_type(value: &Json, expected: &[u8]) -> Checked {
    Err(wrong_type(value, expected))
}

fn too_long(len: usize) -> Checked {
    Err(format!("invalid length {len}, expected fewer elements in array").into_bytes())
}

/// serde's `OneOf`. `none` is the text for an empty list of names.
#[optimize(size)]
fn expected_one_of(names: &[&[u8]], none: &str) -> Vec<u8> {
    let names: Vec<Vec<u8>> = (names.iter().map(|it| [b"`", *it, b"`"].concat())).collect();
    match &names[..] {
        [] => none.as_bytes().to_vec(),
        [one] => [b"expected ", &one[..]].concat(),
        [one, other] => [b"expected ", &one[..], b" or ", other].concat(),
        all => [&b"expected one of "[..], &all.join(&b", "[..])].concat(),
    }
}

/// Checks the variant that `value` selects. `value` has to be a string, or a map with one key whose value is `null`.
fn check_enum(variants: &[&'static [u8]], value: &Json) -> Checked {
    let (name, content) = match value {
        Json::String(name) => (&name[..], None),
        Json::Object(entries) => match &entries[..] {
            [(name, content)] => (&name[..], Some(content)),
            _ => return Err(b"invalid value: map, expected map with a single key".to_vec()),
        },
        _ => return invalid_type(value, b"string or map"),
    };
    if !variants.contains(&name) {
        let known = expected_one_of(variants, "there are no variants");
        return Err([b"unknown variant `", name, b"`, ", &known].concat());
    }
    match content {
        None | Some(Json::Null) => Ok(()),
        Some(content) => invalid_type(content, b"unit"),
    }
}

fn check_struct(it: &Struct, value: &Json) -> Checked {
    let expected = || [b"struct ", &it.name[..]].concat();
    let entries = match value {
        // A sequence is read field by field.
        Json::Array(items) if !it.has_flattened => {
            let own = || it.fields.iter().filter(|field| field.alias_of == 0);
            for (at, field) in own().enumerate() {
                match items.get(at) {
                    Some(item) => check(&field.ty, item)?,
                    None if it.has_no_defaults || field.is_needed_in_sequence => {
                        let count = own().count();
                        let elements = if count == 1 { "element" } else { "elements" };
                        let mut text = format!("invalid length {at}, expected ").into_bytes();
                        text.extend_from_slice(&expected());
                        text.extend_from_slice(format!(" with {count} {elements}").as_bytes());
                        return Err(text);
                    }
                    None => {}
                }
            }
            return match items.len() > own().count() {
                true => too_long(items.len()),
                false => Ok(()),
            };
        }
        Json::Object(entries) => entries,
        _ => return invalid_type(value, &expected()),
    };
    let place_of = |key: &[u8]| it.fields.iter().position(|field| field.name == key);
    let mut seen: Vec<usize> = Vec::new();
    for is_flattened in [false, true] {
        for (key, item) in entries {
            let Some(at) = place_of(key) else {
                if it.ignores_unknown_fields || it.has_flattened {
                    continue;
                }
                let names: Vec<&[u8]> = it.fields.iter().map(|field| field.name).collect();
                let known = expected_one_of(&names, "there are no fields");
                return Err([b"unknown field `", &key[..], b"`, ", &known].concat());
            };
            let field = &it.fields[at];
            if field.is_flattened != is_flattened {
                continue;
            }
            let at = at.saturating_add_signed(field.alias_of);
            if seen.contains(&at) {
                let name = it.fields.get(at).map_or(field.name, |field| field.name);
                return Err([b"duplicate field `", name, b"`"].concat());
            }
            seen.push(at);
            check(&field.ty, item)?;
        }
        if !it.has_flattened {
            break;
        }
    }
    if it.has_flattened
        && !it.ignores_unknown_fields
        && let Some((key, _)) = entries.iter().find(|entry| place_of(&entry.0).is_none())
    {
        return Err([b"unknown field `", &key[..], b"`"].concat());
    }
    let mut fields = it.fields.iter().enumerate();
    match fields.find(|(at, field)| field.is_required && !seen.contains(at)) {
        Some((_, field)) => Err([b"missing field `", field.name, b"`"].concat()),
        None => Ok(()),
    }
}

const SORT_ORDER: [&[u8]; 4] = [b"none", b"all", b"multiple", b"single"];

fn check_sort_order(value: &Json) -> Checked {
    let Json::Array(items) = value else {
        return invalid_type(value, b"a sequence");
    };
    items
        .iter()
        .try_for_each(|it| check_enum(&SORT_ORDER, it))?;
    if items.len() != SORT_ORDER.len() {
        let text = format!(
            "memberSyntaxSortOrder must contain exactly 4 kinds, got {}",
            items.len()
        );
        return Err(text.into_bytes());
    }
    let name_of = |it: &Json| match it {
        Json::Object(entries) => entries.first().map(|it| it.0.clone()),
        it => it.as_str().map(<[u8]>::to_vec),
    };
    let is_listed = |name: &[u8]| items.iter().any(|it| name_of(it).as_deref() == Some(name));
    match SORT_ORDER.iter().all(|name| is_listed(name)) {
        true => Ok(()),
        false => Err(
            b"memberSyntaxSortOrder must contain 4 unique kinds, but duplicates were found"
                .to_vec(),
        ),
    }
}

/// oxlint's `convert_pattern`: `a.*.b*` is `a`, any name, and a name that starts with `b`. `**` matches any number of
/// names.
fn pattern_of_function_name(name: &[u8]) -> Vec<u8> {
    let parts: Vec<Vec<u8>> = strings::split(name, b".")
        .map(|part| match part {
            b"**" => br"[a-z\d\.]*".to_vec(),
            part => strings::replace_owned(part, b"*", br"[a-z\d]*"),
        })
        .collect();
    [&b"(?ui)^"[..], &parts.join(&br"\."[..]), br"(\.|$)"].concat()
}

/// Returns serde's error if `value` isn't a `ty`.
fn check(ty: &Type, value: &Json) -> Checked {
    let matches_type = |ty: &Type| check(ty, value).is_ok();
    match (ty, value) {
        (Type::Any, _)
        | (Type::Bool, Json::Bool(_))
        | (Type::Null | Type::Optional(_), Json::Null)
        | (Type::Str, Json::String(_))
        | (Type::Float, Json::Number(_)) => Ok(()),
        (Type::Bool, _) => invalid_type(value, b"a boolean"),
        (Type::Null, _) => invalid_type(value, b"unit"),
        (Type::Float, _) => invalid_type(value, b"f64"),
        (Type::Only(wanted), _) => match value.as_bool() == Some(*wanted) {
            true => Ok(()),
            false => invalid_type(value, b"a boolean"),
        },
        (Type::Char, Json::String(text)) => {
            if std::str::from_utf8(text).is_ok_and(|it| it.chars().count() == 1) {
                return Ok(());
            }
            let mut out = b"invalid value: string ".to_vec();
            write_debug(&mut out, text);
            out.extend_from_slice(b", expected a character");
            Err(out)
        }
        (Type::Char, _) => invalid_type(value, b"a character"),
        (Type::Integer(at), _) => {
            let (name, least, greatest) = INTEGERS.get(*at).copied().unwrap_or(INTEGERS[3]);
            match value {
                Json::Number(it) if is_integer(*it) && (least..=greatest).contains(it) => Ok(()),
                Json::Number(it) if is_integer(*it) => {
                    let mut out = b"invalid value: integer `".to_vec();
                    write_number(&mut out, *it);
                    out.extend_from_slice(&[b"`, expected ", name.as_bytes()].concat());
                    Err(out)
                }
                _ => invalid_type(value, name.as_bytes()),
            }
        }
        (Type::Regex(prefix, suffix), Json::String(pattern_text)) => {
            let pattern = [&prefix[..], pattern_text, suffix].concat();
            rust_regex::syntax_error(&pattern).map_or(Ok(()), Err)
        }
        (Type::Words(words, text), Json::String(word)) => match words.contains(&&word[..]) {
            true => Ok(()),
            false => Err(strings::replace_owned(text, b"$", word)),
        },
        (Type::Str | Type::Regex(..) | Type::Words(..), _) => invalid_type(value, b"a string"),
        (Type::Optional(inner), _) => check(inner, value),
        (Type::Seq(item, _), Json::Array(items)) => items.iter().try_for_each(|it| check(item, it)),
        (Type::Seq(_, expected), _) => {
            invalid_type(value, expected.as_deref().unwrap_or(b"a sequence"))
        }
        (Type::Map(item, _), Json::Object(entries)) => {
            entries.iter().try_for_each(|it| check(item, &it.1))
        }
        (Type::Map(_, expected), _) => invalid_type(value, expected.as_deref().unwrap_or(b"a map")),
        (Type::Enum(variants), _) => check_enum(variants, value),
        (Type::Struct(it), _) => check_struct(it, value),
        (Type::Tuple(types), Json::Array(items)) => {
            (types.iter().zip(items)).try_for_each(|(ty, item)| check(ty, item))?;
            match items.len() > types.len() {
                true => too_long(items.len()),
                false => Ok(()),
            }
        }
        (Type::Tuple(_), _) => invalid_type(value, b"a tuple"),
        (Type::Untagged(text, variants), _) => match variants.iter().any(matches_type) {
            true => Ok(()),
            false => Err(text.clone()),
        },
        (Type::OneOf(types), _) => {
            let mut last = Ok(());
            for ty in types {
                last = check(ty, value);
                if last.is_ok() {
                    break;
                }
            }
            last
        }
        (Type::ByKind(text, types), _) => {
            for ty in types {
                match ty {
                    Type::Struct(_) if matches!(value, Json::Object(_)) => return check(ty, value),
                    Type::Struct(_) => {}
                    ty if matches_type(ty) => return Ok(()),
                    _ => {}
                }
            }
            Err(text.clone())
        }
        (Type::SortOrder, _) => check_sort_order(value),
        (Type::Severity, Json::String(it)) => {
            if matches!(&it[..], b"allow" | b"off" | b"warn" | b"deny" | b"error") {
                return Ok(());
            }
            let mut out = b"invalid value: string ".to_vec();
            write_debug(&mut out, it);
            out.extend_from_slice(b", expected `allow`, `off`, `warn`, `deny` or `error`");
            Err(out)
        }
        (Type::Severity, Json::Number(it)) if is_integer(*it) && *it >= 0.0 => {
            if *it <= 2.0 {
                return Ok(());
            }
            let mut out = b"invalid value: integer `".to_vec();
            write_number(&mut out, *it);
            out.extend_from_slice(b"`, expected `0`, `1` or `2`");
            Err(out)
        }
        (Type::Severity, _) => {
            Err(b"data did not match any variant of untagged enum Repr".to_vec())
        }
        (Type::Both(first, second), _) => check(first, value).and_then(|()| check(second, value)),
        (Type::Range(least, greatest, text), Json::Number(it))
            if !(*least..=*greatest).contains(it) =>
        {
            Err(text.clone())
        }
        (Type::FunctionNames(text), Json::Array(items)) => (items.iter().filter_map(Json::as_str))
            .try_for_each(|name| {
                let why = rust_regex::syntax_error(&pattern_of_function_name(name));
                why.map_or(Ok(()), |why| {
                    Err([strings::replace_owned(text, b"$", name), why].concat())
                })
            }),
        (Type::Range(..) | Type::FunctionNames(_), _) => Ok(()),
        (Type::NotTrue(text, inner), _) => {
            check(inner, value)?;
            match value {
                Json::Bool(true) => Err(text.clone()),
                _ => Ok(()),
            }
        }
    }
}

/// Returns serde's error if `value` doesn't match `notation`, which is written like a type in the table.
pub(super) fn check_as(notation: &'static [u8], value: &Json) -> Checked {
    let (text, at, rule) = (notation, 0, &b""[..]);
    check(&Reader { text, at, rule }.ty(), value)
}

/// `logical-assignment-operators` checks the shape of its options itself.
fn check_logical_assignment_operators(options: &[Json]) -> Checked {
    let shape = || Err(br#"expected [], ["always"], ["never"], or ["always", options]"#.to_vec());
    let (mode, more) = match options {
        [mode @ Json::String(_)] => (mode, None),
        [mode @ Json::String(_), more @ Json::Object(_)] => (mode, Some(more)),
        _ => return shape(),
    };
    check_enum(&[b"always", b"never"], mode)?;
    match more {
        None => Ok(()),
        Some(_) if mode.as_str() == Some(b"never") => {
            Err(br#"options object is only valid with "always""#.to_vec())
        }
        Some(more) => check_as(b"(L enforceForIfStatements:b)", more),
    }
}

/// `no-unused-vars` reads its options by hand, in this order.
fn check_no_unused_vars(option: &Json) -> Checked {
    let invalid_option = |name: &str, why: &[&[u8]]| {
        let start: [&[u8]; 3] = [
            b"Invalid '",
            name.as_bytes(),
            b"' option for no-unused-vars: ",
        ];
        Err([&start[..], why].concat().concat())
    };
    let word = |name: &str, value: &Json, known: &[&[u8]], takes_booleans: bool| match value {
        Json::String(text) if known.contains(&&text[..]) => Ok(()),
        Json::String(text) => {
            let known = known.join(&b" or "[..]);
            invalid_option(name, &[b"Expected  or ", &known, b", got ", text])
        }
        Json::Bool(_) if takes_booleans => Ok(()),
        other => invalid_option(name, &[b"Expected a string, got ", &compact(other)]),
    };
    let vars: &[&[u8]] = &[b"all", b"local"];
    match option {
        Json::Null => return Ok(()),
        Json::String(_) => return word("vars", option, vars, false),
        Json::Object(_) => {}
        other => {
            let why: [&[u8]; 2] = [b"Expected a string or an object, got ", &compact(other)];
            return invalid_option("vars", &why);
        }
    }
    let steps: [(&str, &[&[u8]], bool); 7] = [
        ("vars", vars, false),
        ("varsIgnorePattern", &[], false),
        ("args", &[b"after-used", b"all", b"none"], false),
        ("argsIgnorePattern", &[], false),
        ("caughtErrors", &[b"all", b"none"], true),
        ("caughtErrorsIgnorePattern", &[], false),
        ("destructuredArrayIgnorePattern", &[], false),
    ];
    for (name, known, takes_booleans) in steps {
        match (option.get(name.as_bytes()), known) {
            (None, _) => {}
            (Some(value), []) => {
                if let Some(why) = value.as_str().and_then(rust_regex::syntax_error) {
                    return invalid_option(name, &[&why]);
                }
            }
            (Some(value), known) => word(name, value, known, takes_booleans)?,
        }
    }
    let fixes: &[&[u8]] = &[b"off", b"suggestion", b"fix", b"safe-fix"];
    for name in ["fix.imports", "fix.variables"] {
        let key = name.as_bytes().get(4..).unwrap_or_default();
        match option.get(b"fix").and_then(|it| it.get(key)) {
            None => {}
            Some(value @ Json::String(_)) => word(name, value, fixes, false)?,
            Some(other) => {
                let why: [&[u8]; 2] = [b"Expected a boolean or string, got ", &compact(other)];
                return invalid_option(name, &why);
            }
        }
    }
    Ok(())
}

/// The extra checks that `no-restricted-properties` runs on an entry after deserializing it.
fn check_restricted_property(entry: &Json) -> Checked {
    const NAMES: [&[u8]; 5] = [
        b"object",
        b"property",
        b"message",
        b"allowObjects",
        b"allowProperties",
    ];
    let has = |at: usize| {
        let value = match entry {
            Json::Array(items) => items.get(at),
            _ => entry.get(NAMES[at]),
        };
        value.is_some_and(|it| *it != Json::Null)
    };
    let (object, property, allow_objects, allow_properties) = (has(0), has(1), has(3), has(4));
    let property_error: &[u8] = match (object, property) {
        (false, false) => b"expected either `object` or `property`",
        (true, false) if allow_objects => b"`allowObjects` requires `property`",
        (true, true) if allow_objects => b"`allowObjects` cannot be used with `object`",
        (false, true) if allow_properties => b"`allowProperties` requires `object`",
        (true, true) if allow_properties => b"`allowProperties` cannot be used with `property`",
        _ => return Ok(()),
    };
    Err(property_error.to_vec())
}

/// oxlint's error for the `options` of the rule that `oxlint_rule_key` writes as `key`: the lines below "Invalid
/// configuration for rule". `None` if it accepts them.
pub(super) fn options_error(key: &[u8], options: &[Json]) -> Option<Vec<u8>> {
    let first = options.first()?;
    let Some((&how, text)) = row(key).and_then(<[u8]>::split_first) else {
        return Some(b"  This rule does not accept configuration options.".to_vec());
    };
    let rule = in_pascal_case(key);
    let (at, rule) = (0, &rule[..]);
    let ty = Reader { text, at, rule }.ty();
    let all = || Json::Array(options.to_vec());
    let checked = match how {
        // The first option.
        b'f' | b'F' => check(&ty, first),
        // The second.
        b'S' => options.get(1).map_or(Ok(()), |it| check(&ty, it)),
        // All of them.
        b'w' | b'W' => check(&ty, &all()),
        b'P' => {
            let Type::Seq(item, _) = &ty else {
                return None;
            };
            let mut entries = options.iter();
            entries.try_for_each(|it| check(item, it).and_then(|()| check_restricted_property(it)))
        }
        // One of two, or both.
        b'E' => {
            let Type::Tuple(types) = &ty else {
                return None;
            };
            let [one, other] = &types[..] else {
                return None;
            };
            let of = |which: &str, checked: Checked| {
                checked.map_err(|why| {
                    let start = format!("Error deserializing {which} tuple element: ");
                    [start.as_bytes(), &why].concat()
                })
            };
            match options {
                [only] if check(one, only).is_ok() || check(other, only).is_ok() => Ok(()),
                [_] => Err(
                    b"Expected configuration to match either the first or second tuple type"
                        .to_vec(),
                ),
                [first, second] => {
                    of("first", check(one, first)).and_then(|()| of("second", check(other, second)))
                }
                _ => Err(b"Expected at most 2 elements in the configuration array".to_vec()),
            }
        }
        b'L' => check_logical_assignment_operators(options),
        b'U' => check_no_unused_vars(first),
        _ => return None,
    };
    let why = checked.err()?;
    Some(match how {
        b'f' => [
            b"  ",
            &why[..],
            b"\n  received config: `",
            &displayed_value(first),
            b"`",
        ]
        .concat(),
        b'w' | b'L' => [
            b"  ",
            &why[..],
            b", received `",
            &displayed_value(&all()),
            b"`",
        ]
        .concat(),
        _ => [b"  ", &why[..]].concat(),
    })
}
