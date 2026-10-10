//! `.editorconfig`, as the two tools read it, which is not the same way.
//!
//! - Prettier 3.9: the package `editorconfig-without-wasm` 3.0.2, and Prettier's `editorConfigToPrettier`.
//! - oxfmt 0.72: the crate `editorconfig-parser` 0.0.4, and oxfmt's `apply_editorconfig`.
//!
//! Neither knows a comment behind a section or behind a value.

use crate::{fs, paths};
use bun_core::strings;
use bun_glob::{Candidate, How, Options, Pattern};
use bun_lint::options::Json;

/// What a property is set to.
#[derive(Clone, PartialEq)]
enum Value {
    Text(Vec<u8>),
    /// For Prettier: what `JSON.parse` makes of it.
    Number(f64),
    Bool(bool),
    /// For oxfmt: a `usize`.
    Whole(u64),
    /// For oxfmt: `unset`.
    Unset,
    /// For oxfmt: nothing that the property can be. It takes the place of what the section had before.
    Nothing,
}

/// `[*.js]` and what follows it.
struct Section {
    name: Vec<u8>,
    /// For Prettier for an absolute path, for oxfmt for one from the directory of the file. `None`: it is for no file.
    glob: Option<Pattern>,
    properties: Vec<(Vec<u8>, Value)>,
}

impl Section {
    fn new(name: &[u8], glob: Option<Pattern>) -> Section {
        Section {
            name: name.to_vec(),
            glob,
            properties: Vec::new(),
        }
    }

    fn set(&mut self, key: &[u8], value: Value) {
        match self.properties.iter_mut().find(|it| it.0 == key) {
            Some(property) => property.1 = value,
            None => self.properties.push((key.to_vec(), value)),
        }
    }
}

/// An `.editorconfig`.
pub(crate) struct File {
    /// What the patterns are relative to.
    directory: Vec<u8>,
    /// `root = true`: the files above it do not count.
    pub(crate) is_root: bool,
    sections: Vec<Section>,
}

/// `buildFullGlob`: the name of a section in the `.editorconfig` of `directory`, as a pattern for an absolute path.
fn full_glob(directory: &[u8], pattern: &[u8]) -> Vec<u8> {
    let glob = match strings::index_of_char_usize(pattern, b'/') {
        None => [b"**/", pattern].concat(),
        Some(0) => pattern[1..].to_vec(),
        Some(_) => pattern.to_vec(),
    };
    let glob = strings::replace_owned(&glob, b"\\\\", b"\\\\\\\\");
    let glob = strings::replace_owned(&glob, b"**", b"{*,**/**/**}");
    let mut full = Vec::with_capacity(directory.len() + 1 + glob.len());
    // `escape(directory, { windowsPathsNoEscape: true })` of minimatch
    for &byte in directory {
        match byte {
            b'?' | b'*' | b'(' | b')' | b'[' | b']' => full.extend_from_slice(&[b'[', byte, b']']),
            byte => full.push(byte),
        }
    }
    full.push(b'/');
    full.extend_from_slice(&glob);
    full
}

/// A number of JSON.
fn json_number(text: &[u8]) -> Option<f64> {
    let digits = |text: &[u8]| text.iter().take_while(|it| it.is_ascii_digit()).count();
    let whole = text.strip_prefix(b"-").unwrap_or(text);
    let mut rest = match digits(whole) {
        0 => return None,
        1 => &whole[1..],
        _ if whole[0] == b'0' => return None,
        count => &whole[count..],
    };
    if let Some(fraction) = rest.strip_prefix(b".") {
        rest = match digits(fraction) {
            0 => return None,
            count => &fraction[count..],
        };
    }
    if let [b'e' | b'E', exponent @ ..] = rest {
        let exponent = match exponent {
            [b'+' | b'-', exponent @ ..] => exponent,
            exponent => exponent,
        };
        rest = match digits(exponent) {
            0 => return None,
            count => &exponent[count..],
        };
    }
    match rest {
        [] => std::str::from_utf8(text).ok()?.parse().ok(),
        _ => None,
    }
}

/// Whether `text` is `"`, what has no `"` that is not escaped, and `"`.
fn is_one_string(text: &[u8]) -> bool {
    let [b'"', inner @ .., b'"'] = text else {
        return false;
    };
    let mut is_escaped = false;
    inner.iter().all(|&byte| {
        let ends_it = byte == b'"' && !is_escaped;
        is_escaped = byte == b'\\' && !is_escaped;
        !ends_it
    }) && !is_escaped
}

impl Value {
    /// `normalizeProps`. `key`: in lower case.
    fn for_prettier(key: &[u8], written: &[u8]) -> Value {
        let is_known = matches!(
            key,
            b"charset"
                | b"end_of_line"
                | b"indent_size"
                | b"indent_style"
                | b"insert_final_newline"
                | b"trim_trailing_whitespace"
        );
        // `JSON.parse(value)`. An array or an object is nothing that a property is compared with, like its text.
        match written {
            b"true" => Value::Bool(true),
            b"false" => Value::Bool(false),
            // `String(value)`
            b"null" => Value::Text(written.to_vec()),
            _ => {
                let string = || match is_one_string(written).then(|| bun_lint::json::parse(written))
                {
                    Some(Some(Json::String(text))) => Some(Value::Text(text)),
                    _ => None,
                };
                let as_written = || match is_known {
                    true => Value::Text(written.to_ascii_lowercase()),
                    false => Value::Text(written.to_vec()),
                };
                (json_number(written).map(Value::Number))
                    .or_else(string)
                    .unwrap_or_else(as_written)
            }
        }
    }

    /// `Boolean(value)`
    fn is_truthy(&self) -> bool {
        match self {
            Value::Text(text) => !text.is_empty(),
            Value::Number(number) => *number != 0.0,
            Value::Bool(value) => *value,
            Value::Whole(_) | Value::Unset | Value::Nothing => false,
        }
    }

    /// `isPositiveInteger(value)`
    fn positive_integer(&self) -> Option<u64> {
        match *self {
            Value::Number(number)
                if number > 0.0 && number.fract() == 0.0 && number <= 9_007_199_254_740_991.0 =>
            {
                Some(number as u64)
            }
            _ => None,
        }
    }

    fn is(&self, word: &[u8]) -> bool {
        matches!(self, Value::Text(text) if text == word)
    }

    /// The `parse` of the property `key` in `editorconfig-parser`. `None`: it has no such property.
    fn for_oxfmt(key: &[u8], written: &[u8]) -> Option<Value> {
        let words: &[&[u8]] = match key {
            b"indent_style" => &[b"tab", b"space"],
            b"end_of_line" => &[b"lf", b"cr", b"crlf"],
            b"insert_final_newline" => &[b"true", b"false"],
            b"quote_type" => &[b"single", b"double", b"auto"],
            b"max_line_length" => &[b"off"],
            b"indent_size" | b"tab_width" => &[],
            _ => return None,
        };
        let takes_number = matches!(key, b"indent_size" | b"tab_width" | b"max_line_length");
        // `str::parse::<usize>`
        let digits = written.strip_prefix(b"+").unwrap_or(written);
        let is_number = takes_number && digits.iter().all(u8::is_ascii_digit);
        let number = || bun_core::fmt::parse_decimal::<u64>(digits).filter(|_| is_number);
        Some(
            match words.iter().find(|it| it.eq_ignore_ascii_case(written)) {
                Some(word) => Value::Text(word.to_vec()),
                None if written.eq_ignore_ascii_case(b"unset") => Value::Unset,
                None => number().map_or(Value::Nothing, Value::Whole),
            },
        )
    }
}

impl File {
    fn empty(directory: &[u8]) -> File {
        File {
            directory: directory.to_vec(),
            is_root: false,
            sections: Vec::new(),
        }
    }

    /// `parse` of `ini-simple-parser`, and `processFileContents`. `None`: it throws, and nothing of the file counts.
    fn parse(directory: &[u8], text: &[u8]) -> Option<File> {
        let mut file = File::empty(directory);
        // The section that is open.
        let mut at = None;
        for line in strings::split_any(text, b"\r\n") {
            match strings::trim_js_whitespace(line) {
                [] | [b'#' | b';', ..] => {}
                // What a name has been seen with goes on.
                [b'[', name @ .., b']'] => {
                    let known = file.sections.iter().position(|it| it.name == name);
                    at = Some(known.unwrap_or_else(|| {
                        // `new Minimatch(glob, { matchBase: true, dot: true })`. It has a slash, so `matchBase` says
                        // nothing. A section without a name has no pattern.
                        let glob =
                            || Pattern::new(&full_glob(directory, name), Options::MINIMATCH_DOT);
                        let glob = (!name.is_empty()).then(glob);
                        file.sections.push(Section::new(name, glob));
                        file.sections.len() - 1
                    }));
                }
                [b'[', ..] => return None,
                line => {
                    let equals = strings::index_of_char_usize(line, b'=')?;
                    let key = strings::trim_js_whitespace(&line[..equals]).to_ascii_lowercase();
                    let value = strings::trim_js_whitespace(&line[equals + 1..]);
                    let value = Value::for_prettier(&key, value);
                    match at.and_then(|at: usize| file.sections.get_mut(at)) {
                        Some(section) => section.set(&key, value),
                        None if key == b"root" => file.is_root = value.is_truthy(),
                        None => {}
                    }
                }
            }
        }
        Some(file)
    }

    /// `EditorConfig::parse`
    fn parse_as_oxfmt(directory: &[u8], text: &[u8]) -> File {
        let mut file = File::empty(directory);
        // `str::lines`
        for line in strings::split(text, b"\n") {
            let line = strings::trim_unicode_whitespace(line.strip_suffix(b"\r").unwrap_or(line));
            if matches!(line, [] | [b'#' | b';', ..]) {
                continue;
            }
            if let [b'[', name @ .., b']'] = line {
                file.sections
                    .push(Section::new(name, Pattern::of_globset(name)));
            }
            // What follows a section that is not closed is of the one before.
            if let Some(section) = file.sections.last_mut()
                && let Some(equals) = strings::index_of_char_usize(line, b'=')
            {
                let key = strings::trim_unicode_whitespace_end(&line[..equals]);
                let value = strings::trim_unicode_whitespace_start(&line[equals + 1..]);
                if let Some(value) = Value::for_oxfmt(key, value) {
                    section.set(key, value);
                }
            }
        }
        file
    }

    /// The `.editorconfig` in `directory`, if there is one, for Prettier.
    pub(crate) fn read(directory: &[u8]) -> Option<File> {
        let text = fs::read(&paths::join(directory, b".editorconfig")).ok()?;
        Some(File::parse(directory, &text).unwrap_or_else(|| File::empty(directory)))
    }

    /// The same for oxfmt.
    pub(crate) fn read_as_oxfmt(directory: &[u8]) -> Option<File> {
        let text = fs::read(&paths::join(directory, b".editorconfig")).ok()?;
        Some(File::parse_as_oxfmt(directory, &text))
    }
}

type Found = Vec<(&'static [u8], Vec<u8>)>;

fn text_of(value: bool) -> Vec<u8> {
    match value {
        true => b"true".to_vec(),
        false => b"false".to_vec(),
    }
}

/// The options of Prettier that `files` have for the file at `path`. `files`: from the farthest to
/// the nearest.
pub(crate) fn options_for<'f>(files: impl Iterator<Item = &'f File>, path: &[u8]) -> Found {
    // `combine`. `unset` is a value like any other: Prettier does not ask for anything else.
    let candidate = Candidate::new(path);
    let mut properties: Vec<(&[u8], &Value)> = Vec::new();
    for file in files.filter(|it| paths::inside(&it.directory, path).is_some()) {
        let is_for_it = |it: &&Section| {
            let glob = it.glob.as_ref();
            glob.is_some_and(|it| it.matches_candidate(&candidate, How::default()))
        };
        for section in file.sections.iter().filter(is_for_it) {
            for (key, value) in &section.properties {
                properties.retain(|it| it.0 != &key[..]);
                properties.push((key, value));
            }
        }
    }
    let get = |key: &[u8]| properties.iter().find(|it| it.0 == key).map(|it| it.1);
    let is = |value: Option<&Value>, word: &[u8]| value.is_some_and(|it| it.is(word));
    // `processMatches`
    let tab = Value::Text(b"tab".to_vec());
    let indent_style = get(b"indent_style");
    let mut indent_size = get(b"indent_size");
    let mut tab_width = get(b"tab_width");
    if is(indent_style, b"tab") && indent_size.is_none() {
        indent_size = Some(&tab);
    }
    if tab_width.is_none() && !is(indent_size, b"tab") {
        tab_width = indent_size;
    }
    if is(indent_size, b"tab") && tab_width.is_some() {
        indent_size = tab_width;
    }

    // `editorConfigToPrettier`
    let mut options: Found = Vec::new();
    let use_tabs = match is(indent_style, b"space") {
        true => Some(false),
        false => (is(indent_style, b"tab") || is(indent_size, b"tab")).then_some(true),
    };
    options.extend(use_tabs.map(|it| (&b"useTabs"[..], text_of(it))));
    // More than that is as good as that.
    let shown = |number: u64| number.min(65535).to_string().into_bytes();
    let size = indent_size.filter(|_| use_tabs == Some(false));
    let width = (size.and_then(Value::positive_integer))
        .or_else(|| tab_width.and_then(Value::positive_integer));
    options.extend(width.map(|it| (&b"tabWidth"[..], shown(it))));
    let max_line_length = get(b"max_line_length");
    let print_width = match is(max_line_length, b"off") {
        true => Some(u64::MAX),
        false => max_line_length.and_then(Value::positive_integer),
    };
    options.extend(print_width.map(|it| (&b"printWidth"[..], shown(it))));
    let quote_type = get(b"quote_type");
    let single_quote = match is(quote_type, b"single") {
        true => Some(true),
        false => is(quote_type, b"double").then_some(false),
    };
    options.extend(single_quote.map(|it| (&b"singleQuote"[..], text_of(it))));
    // For a configuration file of oxfmt further down than where a run like Prettier has started.
    if let Some(Value::Bool(value)) = get(b"insert_final_newline") {
        options.push((b"insertFinalNewline", text_of(*value)));
    }
    if let Some(Value::Text(end)) = get(b"end_of_line")
        && matches!(&end[..], b"lf" | b"crlf" | b"cr")
    {
        options.push((b"endOfLine", end.clone()));
    }
    options
}

/// `apply_editorconfig`. `use_tabs`: `useTabs` of the configuration of oxfmt, which counts more than `indent_style`.
fn apply_as_oxfmt<'v>(get: impl Fn(&[u8]) -> Option<&'v Value>, use_tabs: Option<bool>) -> Found {
    let whole = |key: &[u8]| match get(key) {
        Some(Value::Whole(number)) => Some(*number),
        _ => None,
    };
    let is = |key: &[u8], word: &[u8]| get(key).is_some_and(|it| it.is(word));
    let one_of = |key: &[u8], [yes, no]: [&[u8]; 2]| match is(key, yes) {
        true => Some(true),
        false => is(key, no).then_some(false),
    };
    let mut options: Found = Vec::new();
    // `as u16`, `as u8`
    let print_width = whole(b"max_line_length").map(|it| it as u16);
    options.extend(print_width.map(|it| (&b"printWidth"[..], it.to_string().into_bytes())));
    if let Some(Value::Text(end)) = get(b"end_of_line") {
        options.push((b"endOfLine", end.clone()));
    }
    let of_style = one_of(b"indent_style", [b"tab", b"space"]);
    options.extend(of_style.map(|it| (&b"useTabs"[..], text_of(it))));
    let size = whole(b"indent_size").filter(|_| use_tabs.or(of_style) == Some(false));
    let width = size.or_else(|| whole(b"tab_width")).map(|it| it as u8);
    options.extend(width.map(|it| (&b"tabWidth"[..], it.to_string().into_bytes())));
    let final_newline = one_of(b"insert_final_newline", [b"true", b"false"]);
    options.extend(final_newline.map(|it| (&b"insertFinalNewline"[..], text_of(it))));
    let single_quote = one_of(b"quote_type", [b"single", b"double"]);
    options.extend(single_quote.map(|it| (&b"singleQuote"[..], text_of(it))));
    options
}

/// The options of oxfmt that `file` has for the file at `path`: `EditorConfig::resolve`.
pub(crate) fn options_for_oxfmt(file: &File, path: &[u8], use_tabs: Option<bool>) -> Found {
    // `path.strip_prefix(cwd).unwrap_or(path)`
    let relative = paths::inside(&file.directory, path).unwrap_or(path);
    let is_for_it = |it: &&Section| it.glob.as_ref().is_some_and(|it| it.matches(relative));
    let mut properties: Vec<(&[u8], &Value)> = Vec::new();
    for section in file.sections.iter().filter(is_for_it) {
        for (key, value) in &section.properties {
            if *value != Value::Nothing {
                properties.retain(|it| it.0 != &key[..]);
            }
            if !matches!(value, Value::Nothing | Value::Unset) {
                properties.push((key, value));
            }
        }
    }
    let get = |key: &[u8]| properties.iter().find(|it| it.0 == key).map(|it| it.1);
    apply_as_oxfmt(get, use_tabs)
}

/// Those of `root_properties`: the first `[*]`, which oxfmt looks at before it looks at any file.
pub(crate) fn options_of_root_for_oxfmt(file: &File, use_tabs: Option<bool>) -> Found {
    let root = file.sections.iter().find(|it| it.name == b"*");
    let get = |key: &[u8]| {
        let mut properties = root.into_iter().flat_map(|it| &it.properties);
        properties.find(|it| it.0 == key).map(|it| &it.1)
    };
    apply_as_oxfmt(get, use_tabs)
}
