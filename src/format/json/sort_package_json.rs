//! oxfmt's `sortPackageJson`: the fields of a `package.json` in the conventional order.
//!
//! oxfmt does it with the crate [`sort-package-json`](https://crates.io/crates/sort-package-json)
//! (MIT license, VoidZero Inc. and contributors), which this is a port of, before it formats the
//! result. The crate reads the text with `serde_json` and writes it with `serde_json`, so this also
//! does what that round trip does to the spelling of strings and numbers.

use crate::text::BOM;
use bun_lint::utils::text::{number_to_string, push_code_point};
use std::borrow::Cow;

#[derive(Debug, Default, Copy, Clone, PartialEq, Eq)]
pub struct SortPackageJson {
    /// `scripts`, `betterScripts` and `wireit` are sorted by name too.
    pub sort_scripts: bool,
}

type Object<'a> = Vec<(Cow<'a, [u8]>, Value<'a>)>;

enum Value<'a> {
    /// `null`, `true`, `false`
    Literal(&'a [u8]),
    /// As it is written.
    Number(Vec<u8>),
    /// Its value.
    String(Cow<'a, [u8]>),
    Array(Vec<Value<'a>>),
    Object(Object<'a>),
}

impl Value<'_> {
    fn as_string(&self) -> Option<&[u8]> {
        match self {
            Value::String(value) => Some(value),
            _ => None,
        }
    }
}

/// Appends `text` with its fields sorted to `out`, on one line. Returns `false`, and appends nothing,
/// if `text` is not JSON in the strict sense: it is formatted as it is then.
pub fn sort_package_json(text: &[u8], options: SortPackageJson, out: &mut Vec<u8>) -> bool {
    let body = text.strip_prefix(BOM).unwrap_or(text);
    let mut reader = Reader { text: body, at: 0 };
    let Some(value) = reader.value(0) else {
        return false;
    };
    reader.skip_whitespace();
    if reader.at != body.len() {
        return false;
    }
    let value = match value {
        Value::Object(object) => Value::Object(sort_fields(object, options)),
        other => other,
    };
    out.reserve(text.len());
    out.extend_from_slice(&text[..text.len() - body.len()]);
    write_value(&value, out);
    true
}

// ───────────────────────────── reading, as serde_json does ─────────────────────────────

struct Reader<'a> {
    text: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn peek(&self) -> Option<u8> {
        self.text.get(self.at).copied()
    }

    fn skip_whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.at += 1;
        }
    }

    fn eat(&mut self, byte: u8) -> Option<()> {
        (self.peek() == Some(byte)).then(|| self.at += 1)
    }

    /// `depth`: the number of containers around. `serde_json` gives up at 128.
    fn value(&mut self, depth: u32) -> Option<Value<'a>> {
        self.skip_whitespace();
        match self.peek()? {
            b'{' if depth < 127 => {
                self.at += 1;
                let mut object = Vec::new();
                self.skip_whitespace();
                if self.eat(b'}').is_some() {
                    return Some(Value::Object(object));
                }
                loop {
                    self.skip_whitespace();
                    let key = self.string()?;
                    self.skip_whitespace();
                    self.eat(b':')?;
                    object.push((key, self.value(depth + 1)?));
                    self.skip_whitespace();
                    if self.eat(b',').is_none() {
                        self.eat(b'}')?;
                        return Some(Value::Object(object));
                    }
                }
            }
            b'[' if depth < 127 => {
                self.at += 1;
                let mut array = Vec::new();
                self.skip_whitespace();
                if self.eat(b']').is_some() {
                    return Some(Value::Array(array));
                }
                loop {
                    array.push(self.value(depth + 1)?);
                    self.skip_whitespace();
                    if self.eat(b',').is_none() {
                        self.eat(b']')?;
                        return Some(Value::Array(array));
                    }
                }
            }
            b'"' => self.string().map(Value::String),
            b'-' | b'0'..=b'9' => self.number().map(Value::Number),
            _ => {
                let rest = self.text.get(self.at..)?;
                let literal = [&b"null"[..], b"true", b"false"]
                    .into_iter()
                    .find(|it| rest.starts_with(it))?;
                self.at += literal.len();
                rest.get(..literal.len()).map(Value::Literal)
            }
        }
    }

    fn hex4(&mut self) -> Option<u32> {
        let digits = self.text.get(self.at..self.at + 4)?;
        self.at += 4;
        digits.iter().try_fold(0, |value, digit| {
            Some(value * 16 + (*digit as char).to_digit(16)?)
        })
    }

    /// The value of the string at the cursor.
    fn string(&mut self) -> Option<Cow<'a, [u8]>> {
        self.eat(b'"')?;
        let start = self.at;
        let mut owned: Option<Vec<u8>> = None;
        loop {
            match self.peek()? {
                b'"' => {
                    let end = self.at;
                    self.at += 1;
                    return Some(match owned {
                        Some(owned) => Cow::Owned(owned),
                        None => Cow::Borrowed(self.text.get(start..end)?),
                    });
                }
                b'\\' => {
                    let value = owned.get_or_insert_with(|| self.text[start..self.at].to_vec());
                    let escaped = *self.text.get(self.at + 1)?;
                    self.at += 2;
                    match escaped {
                        b'"' | b'\\' | b'/' => value.push(escaped),
                        b'b' => value.push(0x08),
                        b'f' => value.push(0x0C),
                        b'n' => value.push(b'\n'),
                        b'r' => value.push(b'\r'),
                        b't' => value.push(b'\t'),
                        b'u' => {
                            let mut value = std::mem::take(value);
                            let c = match self.hex4()? {
                                0xDC00..=0xDFFF => return None,
                                high @ 0xD800..=0xDBFF => {
                                    self.eat(b'\\')?;
                                    self.eat(b'u')?;
                                    match self.hex4()? {
                                        low @ 0xDC00..=0xDFFF => {
                                            0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00)
                                        }
                                        _ => return None,
                                    }
                                }
                                c => c,
                            };
                            push_code_point(&mut value, c);
                            owned = Some(value);
                        }
                        _ => return None,
                    }
                }
                0..0x20 => return None,
                byte => {
                    if let Some(value) = &mut owned {
                        value.push(byte);
                    }
                    self.at += 1;
                }
            }
        }
    }

    fn digit(&self) -> Option<u64> {
        self.peek()
            .filter(u8::is_ascii_digit)
            .map(|digit| u64::from(digit - b'0'))
    }

    /// The number at the cursor, as `serde_json` writes it: an integer that fits in 64 bits as it
    /// is, anything else as a `f64`. Without its feature `float_roundtrip`, that is the digits that
    /// fit in a `u64`, multiplied or divided by a power of ten, which is not always the nearest.
    fn number(&mut self) -> Option<Vec<u8>> {
        let is_positive = self.eat(b'-').is_none();
        let push_digit =
            |significand: u64, digit: u64| significand.checked_mul(10)?.checked_add(digit);
        let mut significand = self.digit()?;
        self.at += 1;
        let mut exponent = 0i32;
        let mut is_float = false;
        if significand == 0 {
            // Only one leading zero.
            if self.digit().is_some() {
                return None;
            }
        } else {
            while let Some(digit) = self.digit() {
                self.at += 1;
                match push_digit(significand, digit).filter(|_| !is_float) {
                    Some(next) => significand = next,
                    // The digits that do not fit only count.
                    None => {
                        is_float = true;
                        exponent = exponent.saturating_add(1);
                    }
                }
            }
        }
        if self.eat(b'.').is_some() {
            is_float = true;
            self.digit()?;
            let mut is_full = false;
            while let Some(digit) = self.digit() {
                self.at += 1;
                match push_digit(significand, digit).filter(|_| !is_full) {
                    Some(next) => {
                        significand = next;
                        exponent -= 1;
                    }
                    None => is_full = true,
                }
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            is_float = true;
            self.at += 1;
            let is_positive_exponent = match self.peek() {
                Some(b'-') => {
                    self.at += 1;
                    false
                }
                Some(b'+') => {
                    self.at += 1;
                    true
                }
                _ => true,
            };
            self.digit()?;
            let mut written: Option<i32> = Some(0);
            while let Some(digit) = self.digit() {
                self.at += 1;
                written = written.and_then(|it| it.checked_mul(10)?.checked_add(digit as i32));
            }
            match written {
                Some(written) if is_positive_exponent => {
                    exponent = exponent.saturating_add(written)
                }
                Some(written) => exponent = exponent.saturating_sub(written),
                None if significand != 0 && is_positive_exponent => return None,
                None => {
                    return Some(if is_positive {
                        b"0.0".to_vec()
                    } else {
                        b"-0.0".to_vec()
                    });
                }
            }
        }

        if !is_float {
            if is_positive {
                return Some(significand.to_string().into_bytes());
            }
            if significand != 0 && significand <= 1 << 63 {
                return Some(format!("-{significand}").into_bytes());
            }
            return Some(write_f64(-(significand as f64)));
        }
        let mut value = significand as f64;
        loop {
            if exponent.unsigned_abs() <= 308 {
                // The nearest `f64`, which multiplying tens does not give.
                let power = format!("1e{}", exponent.unsigned_abs())
                    .parse::<f64>()
                    .unwrap_or(f64::INFINITY);
                if exponent >= 0 {
                    value *= power;
                    if value.is_infinite() {
                        return None;
                    }
                } else {
                    value /= power;
                }
                break;
            }
            if value == 0.0 {
                break;
            }
            if exponent >= 0 {
                return None;
            }
            value /= 1e308;
            exponent += 308;
        }
        Some(write_f64(if is_positive { value } else { -value }))
    }
}

// ───────────────────────────── writing, as serde_json does ─────────────────────────────

/// The shortest digits that give `value` back, with an exponent from `1e16` on and below `1e-5`.
fn write_f64(value: f64) -> Vec<u8> {
    if value == 0.0 {
        return if value.is_sign_negative() {
            b"-0.0".to_vec()
        } else {
            b"0.0".to_vec()
        };
    }
    // The digits of JavaScript. Where two numbers of the same length are as close, `serde_json` takes
    // the even one, as JavaScript does. `{:e}` takes the greater one.
    let text = number_to_string(value.abs());
    let (mantissa, exponent) =
        bun_core::strings::split_once_char(&text, b'e').unwrap_or((&text, b"0"));
    let (integer, fraction) =
        bun_core::strings::split_once_char(mantissa, b'.').unwrap_or((mantissa, b""));
    let exponent = std::str::from_utf8(exponent)
        .ok()
        .and_then(|it| it.parse::<i32>().ok())
        .unwrap_or(0);
    let all = [integer, fraction].concat();
    let leading_zeros = all.iter().take_while(|digit| **digit == b'0').count();
    let digits = &all[leading_zeros..];
    let digits = &digits[..digits.len()
        - digits
            .iter()
            .rev()
            .take_while(|digit| **digit == b'0')
            .count()];
    // Where the decimal point is, counted from the first digit.
    let point = integer.len() as i32 + exponent - leading_zeros as i32;
    let len = digits.len() as i32;
    let mut out = Vec::with_capacity(24);
    if value < 0.0 {
        out.push(b'-');
    }
    if len <= point && point <= 16 {
        out.extend_from_slice(digits);
        out.extend(std::iter::repeat_n(b'0', (point - len) as usize));
        out.extend_from_slice(b".0");
    } else if 0 < point && point <= 16 {
        out.extend_from_slice(&digits[..point as usize]);
        out.push(b'.');
        out.extend_from_slice(&digits[point as usize..]);
    } else if -5 < point && point <= 0 {
        out.extend_from_slice(b"0.");
        out.extend(std::iter::repeat_n(b'0', (-point) as usize));
        out.extend_from_slice(digits);
    } else if let Some((first, rest)) = digits.split_first() {
        out.push(*first);
        if !rest.is_empty() {
            out.push(b'.');
            out.extend_from_slice(rest);
        }
        out.push(b'e');
        if point > 0 {
            out.push(b'+');
        }
        out.extend_from_slice((point - 1).to_string().as_bytes());
    }
    out
}

fn write_string(value: &[u8], out: &mut Vec<u8>) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    out.push(b'"');
    for &byte in value {
        match byte {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            0x08 => out.extend_from_slice(b"\\b"),
            0x0C => out.extend_from_slice(b"\\f"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            0..0x20 => out.extend_from_slice(&[
                b'\\',
                b'u',
                b'0',
                b'0',
                HEX[usize::from(byte >> 4)],
                HEX[usize::from(byte & 15)],
            ]),
            _ => out.push(byte),
        }
    }
    out.push(b'"');
}

/// The nesting is limited by [`Reader::value`].
fn write_value(value: &Value<'_>, out: &mut Vec<u8>) {
    match value {
        Value::Literal(text) => out.extend_from_slice(text),
        Value::Number(text) => out.extend_from_slice(text),
        Value::String(value) => write_string(value, out),
        Value::Array(values) => {
            out.push(b'[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    out.push(b',');
                }
                write_value(value, out);
            }
            out.push(b']');
        }
        Value::Object(entries) => {
            out.push(b'{');
            for (index, (key, value)) in entries.iter().enumerate() {
                if index > 0 {
                    out.push(b',');
                }
                write_string(key, out);
                out.push(b':');
                write_value(value, out);
            }
            out.push(b'}');
        }
    }
}

// ───────────────────────────── sorting ─────────────────────────────

/// What is done to the value of a field.
#[derive(Copy, Clone)]
enum Transform {
    None,
    /// The names of the object are sorted.
    Alphabetically,
    /// And those of the objects in it.
    Recursively,
    /// These names first, in this order. The others follow, sorted.
    KeyOrder(&'static [&'static str]),
    /// Of an array, the strings are kept, sorted, each once.
    SortedUnique,
    /// Of an array, the strings are kept, each once, in their order.
    Unique,
    /// Like the document.
    Fields,
    /// [`Transform::Alphabetically`], if that is asked for.
    Scripts,
    DevEngines,
}

use Transform::{Alphabetically, Recursively, SortedUnique};

const TYPE_URL: Transform = Transform::KeyOrder(&["type", "url"]);
const DEV_ENGINE: Transform = Transform::KeyOrder(&["name", "version", "onFail"]);

/// The known fields, in their order.
const FIELDS: &[(&str, Transform)] = &[
    // Core package metadata
    ("$schema", Transform::None),
    ("name", Transform::None),
    ("displayName", Transform::None),
    ("version", Transform::None),
    ("stableVersion", Transform::None),
    ("gitHead", Transform::None),
    ("private", Transform::None),
    ("description", Transform::None),
    ("categories", SortedUnique),
    ("keywords", SortedUnique),
    ("homepage", Transform::None),
    ("bugs", Transform::KeyOrder(&["url", "email"])),
    // License and people
    ("license", Transform::None),
    ("author", Transform::KeyOrder(&["name", "email", "url"])),
    ("maintainers", Transform::None),
    ("contributors", Transform::None),
    // Repository and funding
    ("repository", TYPE_URL),
    ("funding", TYPE_URL),
    ("donate", TYPE_URL),
    ("sponsor", TYPE_URL),
    ("qna", Transform::None),
    ("publisher", Transform::None),
    // Package content and distribution
    ("man", Transform::None),
    ("style", Transform::None),
    ("example", Transform::None),
    ("examplestyle", Transform::None),
    ("assets", Transform::None),
    ("bin", Alphabetically),
    ("source", Transform::None),
    (
        "directories",
        Transform::KeyOrder(&["lib", "bin", "man", "doc", "example", "test"]),
    ),
    ("workspaces", Transform::None),
    (
        "binary",
        Transform::KeyOrder(&[
            "module_name",
            "module_path",
            "remote_path",
            "package_name",
            "host",
        ]),
    ),
    ("files", Transform::Unique),
    ("os", Transform::None),
    ("cpu", Transform::None),
    ("libc", SortedUnique),
    // Package entry points
    ("type", Transform::None),
    ("sideEffects", Transform::None),
    ("main", Transform::None),
    ("module", Transform::None),
    ("browser", Transform::None),
    ("types", Transform::None),
    ("typings", Transform::None),
    ("typesVersions", Transform::None),
    ("typeScriptVersion", Transform::None),
    ("typesPublisherContentHash", Transform::None),
    ("react-native", Transform::None),
    ("svelte", Transform::None),
    ("unpkg", Transform::None),
    ("jsdelivr", Transform::None),
    ("jsnext:main", Transform::None),
    ("umd", Transform::None),
    ("umd:main", Transform::None),
    ("es5", Transform::None),
    ("esm5", Transform::None),
    ("fesm5", Transform::None),
    ("es2015", Transform::None),
    ("esm2015", Transform::None),
    ("fesm2015", Transform::None),
    ("es2020", Transform::None),
    ("esm2020", Transform::None),
    ("fesm2020", Transform::None),
    ("esnext", Transform::None),
    ("imports", Transform::None),
    ("exports", Transform::None),
    ("publishConfig", Transform::Fields),
    // Scripts
    ("scripts", Transform::Scripts),
    ("betterScripts", Transform::Scripts),
    ("wireit", Transform::Scripts),
    // Dependencies
    ("dependencies", Alphabetically),
    ("devDependencies", Alphabetically),
    ("dependenciesMeta", Transform::None),
    ("peerDependencies", Alphabetically),
    ("peerDependenciesMeta", Transform::None),
    ("optionalDependencies", Alphabetically),
    ("bundledDependencies", SortedUnique),
    ("bundleDependencies", SortedUnique),
    ("resolutions", Alphabetically),
    ("overrides", Alphabetically),
    // Git hooks and commit tools
    ("husky", Recursively),
    ("simple-git-hooks", Transform::None),
    ("vite-staged", Transform::None),
    ("lint-staged", Transform::None),
    ("nano-staged", Transform::None),
    ("pre-commit", Transform::None),
    ("commitlint", Recursively),
    // Extensions of VS Code
    ("l10n", Transform::None),
    ("contributes", Transform::None),
    ("activationEvents", SortedUnique),
    ("extensionPack", SortedUnique),
    ("extensionDependencies", SortedUnique),
    ("extensionKind", SortedUnique),
    ("icon", Transform::None),
    ("badges", Transform::None),
    ("galleryBanner", Transform::None),
    ("preview", Transform::None),
    ("markdown", Transform::None),
    // Configuration of build tools. Where the order of what is nested means something, only the top
    // level is sorted.
    ("napi", Alphabetically),
    ("flat", Transform::None),
    ("config", Alphabetically),
    ("nodemonConfig", Recursively),
    ("browserify", Recursively),
    ("babel", Recursively),
    ("browserslist", Transform::None),
    ("xo", Recursively),
    ("prettier", Recursively),
    ("eslintConfig", Recursively),
    ("eslintIgnore", Transform::None),
    ("standard", Recursively),
    ("npmpkgjsonlint", Transform::None),
    ("npmPackageJsonLintConfig", Transform::None),
    ("npmpackagejsonlint", Transform::None),
    ("release", Transform::None),
    ("auto-changelog", Alphabetically),
    ("remarkConfig", Alphabetically),
    ("stylelint", Recursively),
    ("typescript", Recursively),
    ("typedoc", Recursively),
    ("tshy", Alphabetically),
    ("tsdown", Recursively),
    ("size-limit", Transform::None),
    // Testing
    ("ava", Recursively),
    ("jest", Alphabetically),
    ("jest-junit", Transform::None),
    ("jest-stare", Transform::None),
    ("mocha", Recursively),
    ("nyc", Recursively),
    ("c8", Recursively),
    ("tap", Transform::None),
    ("tsd", Recursively),
    ("typeCoverage", Recursively),
    ("oclif", Recursively),
    // Runtime and package manager
    ("languageName", Transform::None),
    ("preferGlobal", Transform::None),
    ("devEngines", Transform::DevEngines),
    ("engines", Alphabetically),
    ("engineStrict", Transform::None),
    ("volta", Recursively),
    ("packageManager", Transform::None),
    ("pnpm", Transform::None),
];

fn sort_by_key(object: &mut Object<'_>) {
    crate::sort::sort_by(&mut object[..], |(a, _), (b, _)| a.cmp(b));
}

fn sort_recursively(object: &mut Object<'_>) {
    for (_, value) in object.iter_mut() {
        if let Value::Object(nested) = value {
            sort_recursively(nested);
        }
    }
    sort_by_key(object);
}

fn sort_by_key_order<'a>(object: Object<'a>, order: &[&str]) -> Object<'a> {
    let mut known: Vec<Option<(Cow<'a, [u8]>, Value<'a>)>> = order.iter().map(|_| None).collect();
    let mut others = Vec::new();
    for (key, value) in object {
        match known
            .iter_mut()
            .zip(order)
            .find(|(_, name)| name.as_bytes() == &*key)
        {
            Some((slot, _)) => *slot = Some((key, value)),
            None => others.push((key, value)),
        }
    }
    sort_by_key(&mut others);
    known.into_iter().flatten().chain(others).collect()
}

fn transform<'a>(value: Value<'a>, kind: Transform, options: SortPackageJson) -> Value<'a> {
    match (kind, value) {
        (Transform::Scripts, Value::Object(mut object)) => {
            if options.sort_scripts {
                sort_by_key(&mut object);
            }
            Value::Object(object)
        }
        (Alphabetically, Value::Object(mut object)) => {
            sort_by_key(&mut object);
            Value::Object(object)
        }
        (Recursively, Value::Object(mut object)) => {
            sort_recursively(&mut object);
            Value::Object(object)
        }
        (Transform::KeyOrder(order), Value::Object(object)) => {
            Value::Object(sort_by_key_order(object, order))
        }
        (Transform::Fields, Value::Object(object)) => Value::Object(sort_fields(object, options)),
        (Transform::DevEngines, Value::Object(object)) => {
            let mut object: Object<'a> = object
                .into_iter()
                .map(|(key, value)| match value {
                    Value::Array(engines) => {
                        let engines = engines
                            .into_iter()
                            .map(|engine| transform(engine, DEV_ENGINE, options));
                        (key, Value::Array(engines.collect()))
                    }
                    engine => (key, transform(engine, DEV_ENGINE, options)),
                })
                .collect();
            sort_by_key(&mut object);
            Value::Object(object)
        }
        (SortedUnique, Value::Array(mut array)) => {
            array.retain(|it| it.as_string().is_some());
            crate::sort::sort_by(&mut array[..], |a, b| a.as_string().cmp(&b.as_string()));
            array.dedup_by(|a, b| a.as_string() == b.as_string());
            Value::Array(array)
        }
        (Transform::Unique, Value::Array(array)) => {
            let mut unique: Vec<Value<'a>> = Vec::with_capacity(array.len());
            for value in array {
                if value
                    .as_string()
                    .is_some_and(|it| !unique.iter().any(|seen| seen.as_string() == Some(it)))
                {
                    unique.push(value);
                }
            }
            Value::Array(unique)
        }
        (_, value) => value,
    }
}

/// The known fields in their order, then the others by name, those that start with `_` last.
fn sort_fields<'a>(object: Object<'a>, options: SortPackageJson) -> Object<'a> {
    let mut known: Vec<(usize, Cow<'a, [u8]>, Value<'a>)> = Vec::new();
    let mut unknown: Object<'a> = Vec::new();
    for (key, value) in object {
        match FIELDS
            .iter()
            .enumerate()
            .find(|(_, (name, _))| name.as_bytes() == &*key)
        {
            Some((index, (_, field))) => {
                known.push((index, key, transform(value, *field, options)))
            }
            None => unknown.push((key, value)),
        }
    }
    crate::sort::sort_by_key(&mut known[..], |(index, ..)| *index);
    crate::sort::sort_by(&mut unknown[..], |(a, _), (b, _)| {
        a.starts_with(b"_")
            .cmp(&b.starts_with(b"_"))
            .then_with(|| a.cmp(b))
    });
    known
        .into_iter()
        .map(|(_, key, value)| (key, value))
        .chain(unknown)
        .collect()
}
