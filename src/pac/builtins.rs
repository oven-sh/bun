//! The methods of strings, arrays, patterns, numbers, functions and objects.

use core::ops::Range;
use std::sync::Arc;

use bun_core::fmt::FormatDouble;
use bun_core::strings;
use bun_yarr::{Compiled, NO_MATCH, flags};

use crate::machine::*;

const STEPS_OF_A_SEARCH: usize = 1 << 26;

static UNDEFINED: Value = Value::Undefined;

pub(crate) fn nth(arguments: &[Value], index: usize) -> &Value {
    arguments.get(index).unwrap_or(&UNDEFINED)
}

/// The match, and then its groups.
type Groups = Vec<Option<Range<usize>>>;

impl Pattern {
    fn has(&self, flag: u8) -> bool {
        strings::contains_char(&self.flags, flag)
    }

    pub(crate) fn property(&self, name: &[u8]) -> Option<Value> {
        Some(match name {
            b"source" => Value::String(Arc::clone(&self.source)),
            b"flags" => Value::String(Arc::clone(&self.flags)),
            b"global" => self.has(b'g').into(),
            b"ignoreCase" => self.has(b'i').into(),
            b"multiline" => self.has(b'm').into(),
            b"lastIndex" => self.last_index.into(),
            _ => return None,
        })
    }
}

fn count_groups(source: &[u8]) -> usize {
    let (mut rest, mut count, mut is_in_class) = (source, 0, false);
    while let [first, after @ ..] = rest {
        rest = after;
        match (first, after) {
            (b'\\', [_, after @ ..]) => rest = after,
            (b'[' | b']', _) => is_in_class = *first == b'[',
            (b'(', [b'?', b'<', b'=' | b'!', ..]) => {}
            (b'(', [b'?', b'<', ..]) => count += usize::from(!is_in_class),
            (b'(', [b'?', ..]) => {}
            (b'(', _) => count += usize::from(!is_in_class),
            _ => {}
        }
    }
    count
}

fn index_from(text: &[u8], wanted: &[u8], from: usize) -> Option<usize> {
    if wanted.is_empty() {
        Some(from)
    } else {
        strings::index_of(&text[from..], wanted).map(|it| from + it)
    }
}

impl Machine<'_> {
    pub(crate) fn new_pattern(&mut self, source: &Text, given: &Text) -> Outcome {
        let bits = given.iter().try_fold(0, |all, it| {
            Some(all | 1 << strings::index_of_char_usize(b"dgimsuvy", *it)?)
        });
        let properties = strings::count(source, b"\\p") + strings::count(source, b"\\P");
        let steps = 256 + 8 * source.len() + (properties << 18);
        self.spend(steps)?;
        match bits.and_then(|it| {
            Compiled::within(bun_yarr::Text::Latin1(source), it & !flags::GLOBAL, 1 << 17).ok()
        }) {
            Some(compiled) => {
                let pattern = Pattern {
                    compiled: compiled.into(),
                    source: Arc::clone(source),
                    flags: Arc::clone(given),
                    last_index: 0,
                    steps,
                };
                Ok(Value::Object(
                    self.allocate(Kind::Pattern(pattern.into()), Some(PATTERNS)),
                ))
            }
            None => self.throw("SyntaxError", "Invalid regular expression"),
        }
    }

    pub(crate) fn pattern(&self, value: &Value) -> Option<&Pattern> {
        match self.kind(value) {
            Some(Kind::Pattern(pattern)) => Some(pattern),
            _ => None,
        }
    }

    pub(crate) fn set_last_index(&mut self, pattern: Id, index: usize) {
        if let Kind::Pattern(pattern) = &mut self.object(pattern).kind {
            pattern.last_index = index;
        }
    }

    /// For a pattern, or for a string.
    fn search(&mut self, wanted: &Value, text: &[u8], from: usize) -> Outcome<Option<Groups>> {
        self.spend(1 + text.len() / 16)?;
        if from > text.len() {
            return Ok(None);
        }
        let Some(pattern) = self.pattern(wanted) else {
            let wanted = self.text(wanted)?;
            return Ok(index_from(text, &wanted, from).map(|it| vec![Some(it..it + wanted.len())]));
        };
        let mut offsets = vec![0; pattern.compiled.offsets_len()];
        let mut left = STEPS_OF_A_SEARCH;
        let is_found = pattern.compiled.exec_within(
            bun_yarr::Text::Latin1(text),
            from as u32,
            &mut offsets,
            Some(&mut left),
        );
        if left == 0 {
            return Err(Abrupt::Abort);
        }
        let groups = offsets
            .as_chunks::<2>()
            .0
            .iter()
            .take(1 + count_groups(&pattern.source));
        let found: Option<Groups> = is_found.then(|| {
            groups
                .map(|[start, end]| (*start != NO_MATCH).then_some(*start as usize..*end as usize))
                .collect()
        });
        self.check_time()?;
        self.spend(
            found
                .iter()
                .flatten()
                .map(|it| 1 + it.as_ref().map_or(0, |it| it.len() / 8))
                .sum(),
        )
        .map(|()| found)
    }

    fn search_all(&mut self, wanted: &Value, text: &[u8], is_global: bool) -> Outcome<Vec<Groups>> {
        let (mut all, mut from) = (Vec::new(), 0);
        while let Some(found) = self.search(wanted, text, from)? {
            let whole = found[0].clone().unwrap_or_default();
            from = whole.end + usize::from(whole.is_empty());
            all.push(found);
            if !is_global {
                break;
            }
        }
        Ok(all)
    }

    fn exec(&mut self, pattern: &Value, text: &[u8]) -> Outcome<Option<Groups>> {
        let from = self
            .pattern(pattern)
            .filter(|it| it.has(b'g') || it.has(b'y'))
            .map(|it| it.last_index);
        let found = self.search(pattern, text, from.unwrap_or(0))?;
        if let (Value::Object(id), Some(_)) = (pattern, from) {
            self.set_last_index(
                *id,
                found
                    .as_ref()
                    .and_then(|it| it[0].clone())
                    .map_or(0, |it| it.end),
            );
        }
        Ok(found)
    }

    fn match_array(&mut self, found: Option<Groups>, text: &Text) -> Outcome {
        let Some(found) = found else {
            return Ok(Value::Null);
        };
        let array = self.new_array(values_of(&found, text).collect())?;
        self.set(
            &array,
            &b"index"[..].into(),
            found[0].clone().unwrap_or_default().start.into(),
        )?;
        self.set(
            &array,
            &b"input"[..].into(),
            Value::String(Arc::clone(text)),
        )?;
        Ok(array)
    }

    fn as_pattern(&mut self, value: &Value) -> Outcome {
        if self.pattern(value).is_some() {
            return Ok(value.clone());
        }
        let source = value
            .given()
            .map_or_else(|| Ok(Text::default()), |it| self.text(it))?;
        self.new_pattern(&source, &Text::default())
    }

    fn replace(
        &mut self,
        text: &Text,
        wanted: &Value,
        with: &Value,
        replaces_all: bool,
    ) -> Outcome {
        let is_global = self.pattern(wanted).map_or(replaces_all, |it| it.has(b'g'));
        let template = if self.is_callable(with) {
            None
        } else {
            Some(self.text(with)?)
        };
        let (mut out, mut copied) = (Vec::new(), 0);
        for found in self.search_all(wanted, text, is_global)? {
            let whole = found[0].clone().unwrap_or_default();
            out.extend_from_slice(&text[copied..whole.start]);
            copied = whole.end;
            match &template {
                Some(template) => expand(&mut out, template, &found, text),
                None => {
                    let arguments: Vec<_> = values_of(&found, text)
                        .chain([whole.start.into(), Value::String(Arc::clone(text))])
                        .collect();
                    let result = self.call(with, &Value::Undefined, &arguments)?;
                    out.extend_from_slice(&self.text(&result)?);
                }
            }
            self.check_length(out.len(), usize::MAX)?;
        }
        out.extend_from_slice(&text[copied..]);
        self.new_string(&out)
    }

    fn split(&mut self, text: &Text, separator: &Value, limit: &Value) -> Outcome {
        let (mut parts, mut start) = (Vec::new(), 0);
        let all = if separator.given().is_some() {
            self.search_all(separator, text, true)?
        } else {
            Vec::new()
        };
        let is_all_separator = text.is_empty() && !all.is_empty();
        for found in all {
            let whole = found[0].clone().unwrap_or_default();
            if whole.end > start && whole.start < text.len() {
                parts.push(text[start..whole.start].into());
                parts.extend(values_of(&found, text).skip(1));
                start = whole.end;
            }
        }
        parts.extend((!is_all_separator).then(|| text[start..].into()));
        if let Some(limit) = limit.given() {
            parts.truncate(int32_of(self.number(limit)?) as u32 as usize);
        }
        self.new_array(parts)
    }

    pub(crate) fn integer(&mut self, value: &Value, otherwise: f64) -> Outcome<f64> {
        let number = value.given().map_or(Ok(otherwise), |it| self.number(it))?;
        Ok(if number.is_nan() { 0.0 } else { number.trunc() })
    }

    fn clamped(&mut self, value: &Value, otherwise: usize, limit: usize) -> Outcome<usize> {
        Ok((self.integer(value, otherwise as f64)? as usize).min(limit))
    }

    /// From the end if it is negative.
    fn relative(&mut self, value: &Value, otherwise: usize, len: usize) -> Outcome<usize> {
        let index = self.integer(value, otherwise as f64)?;
        Ok((if index < 0.0 {
            index + len as f64
        } else {
            index
        } as usize)
            .min(len))
    }

    fn join(&mut self, items: &[Value], separator: &[u8]) -> Outcome {
        let mut out = Vec::new();
        for (index, item) in items.iter().enumerate() {
            out.extend_from_slice(if index == 0 { b"" } else { separator });
            if !item.is_nullish() {
                out.extend_from_slice(&self.text(item)?);
            }
            self.check_length(out.len(), usize::MAX)?;
        }
        self.new_string(&out)
    }

    fn sorted(&mut self, mut items: Vec<Value>, compare: &Value) -> Outcome<Vec<Value>> {
        if items.len() < 2 {
            return Ok(items);
        }
        let second = items.split_off(items.len() / 2);
        let (first, second) = (self.sorted(items, compare)?, self.sorted(second, compare)?);
        let (mut merged, mut first, mut second) = (
            Vec::with_capacity(first.len() + second.len()),
            &first[..],
            &second[..],
        );
        while let ([a, ..], [b, ..]) = (first, second) {
            self.spend(0)?;
            let is_after = match (a.given(), b.given(), compare.given()) {
                (None, ..) | (_, None, _) => b.given().is_some(),
                (.., None) => self.text(a)? > self.text(b)?,
                _ => {
                    let order = self.call(compare, &Value::Undefined, &[a.clone(), b.clone()])?;
                    self.number(&order)? > 0.0
                }
            };
            merged.extend(
                if is_after {
                    second.split_off_first()
                } else {
                    first.split_off_first()
                }
                .cloned(),
            );
        }
        merged.extend(first.iter().chain(second).cloned());
        Ok(merged)
    }

    pub(crate) fn incompatible<T>(&mut self) -> Outcome<T> {
        self.throw("TypeError", "Called on an incompatible receiver")
    }
}

fn values_of(found: &Groups, text: &[u8]) -> impl Iterator<Item = Value> {
    found
        .iter()
        .map(|it| it.clone().map_or(Value::Undefined, |it| text[it].into()))
}

fn expand(out: &mut Vec<u8>, mut template: &[u8], found: &Groups, text: &[u8]) {
    let whole = found[0].clone().unwrap_or_default();
    while let Some((before, after)) =
        strings::split_once_char(template, b'$').filter(|_| out.len() <= MAX_LENGTH)
    {
        out.extend_from_slice(before);
        let group = |len: usize| {
            let number: usize = bun_core::fmt::parse_unsigned(
                after
                    .get(..len)
                    .filter(|it| it.iter().all(u8::is_ascii_digit))?,
                10,
            )
            .ok()?;
            Some((
                &text[found
                    .get(number)
                    .filter(|_| number > 0)?
                    .clone()
                    .unwrap_or_default()],
                len,
            ))
        };
        let (expanded, len) = match after.first() {
            Some(b'$') => (&b"$"[..], 1),
            Some(b'&') => (&text[whole.clone()], 1),
            Some(b'`') => (&text[..whole.start], 1),
            Some(b'\'') => (&text[whole.end..], 1),
            _ => group(2).or_else(|| group(1)).unwrap_or((b"$", 0)),
        };
        out.extend_from_slice(expanded);
        template = &after[len..];
    }
    out.extend_from_slice(template);
}

pub(crate) const STRING_METHODS: &[&str] = &[
    "charAt",
    "charCodeAt",
    "concat",
    "endsWith",
    "includes",
    "indexOf",
    "lastIndexOf",
    "localeCompare",
    "match",
    "padEnd",
    "padStart",
    "repeat",
    "replace",
    "replaceAll",
    "search",
    "slice",
    "split",
    "startsWith",
    "substr",
    "substring",
    "toLowerCase",
    "toString",
    "toUpperCase",
    "trim",
    "trimEnd",
    "trimStart",
    "valueOf",
];

pub(crate) fn string_method(
    it: &mut Machine<'_>,
    name: &str,
    this: &Value,
    arguments: &[Value],
) -> Outcome {
    if this.is_nullish() || matches!(this, Value::Object(_)) {
        return it.incompatible();
    }
    let text = it.text(this)?;
    let (len, first, second) = (text.len(), nth(arguments, 0), nth(arguments, 1));
    it.spend(len / 16)?;
    let part = match name {
        "toString" | "valueOf" => return Ok(Value::String(text)),
        "charAt" | "charCodeAt" => {
            let index = it.integer(first, 0.0)?;
            let unit = text
                .get(index as usize..=index as usize)
                .filter(|_| index >= 0.0);
            return Ok(if name == "charAt" {
                unit.unwrap_or_default().into()
            } else {
                unit.map_or(f64::NAN, |it| it[0].into()).into()
            });
        }
        "concat" => {
            let parts = arguments
                .iter()
                .map(|argument| it.text(argument).map(Value::String));
            let parts = core::iter::once(Ok(Value::String(text)))
                .chain(parts)
                .collect::<Outcome<Vec<_>>>()?;
            return it.join(&parts, b"");
        }
        "repeat" => {
            let count = it.integer(first, 0.0)? as usize;
            return it
                .check_length(len.saturating_mul(count), 8)
                .map(|()| text.repeat(count)[..].into());
        }
        "padStart" | "padEnd" => {
            let (missing, filler) = (
                (it.integer(first, 0.0)? as usize).saturating_sub(len),
                second
                    .given()
                    .map_or_else(|| Ok(b" "[..].into()), |second| it.text(second))?,
            );
            it.check_length(missing, 8)?;
            let padding: Vec<_> = filler.iter().copied().cycle().take(missing).collect();
            return it.new_string(
                &if name == "padEnd" {
                    [&*text, &padding]
                } else {
                    [&*padding, &text]
                }
                .concat(),
            );
        }
        "match" => {
            let pattern = it.as_pattern(first)?;
            if !it.pattern(&pattern).is_some_and(|it| it.has(b'g')) {
                let found = it.exec(&pattern, &text)?;
                return it.match_array(found, &text);
            }
            let all = it.search_all(&pattern, &text, true)?;
            return if all.is_empty() {
                Ok(Value::Null)
            } else {
                it.new_array(
                    all.iter()
                        .filter_map(|it| values_of(it, &text).next())
                        .collect(),
                )
            };
        }
        "search" => {
            let pattern = it.as_pattern(first)?;
            return Ok(it
                .search(&pattern, &text, 0)?
                .and_then(|it| Some(it[0].clone()?.start))
                .into());
        }
        "replace" | "replaceAll" => return it.replace(&text, first, second, name == "replaceAll"),
        "split" => return it.split(&text, first, second),
        "toLowerCase" => return it.new_string(&text.to_ascii_lowercase()),
        "toUpperCase" => return it.new_string(&text.to_ascii_uppercase()),
        "trim" => trim(&text),
        "trimStart" => strings::trim_left(&text, SPACES),
        "trimEnd" => strings::trim_right(&text, SPACES),
        "slice" => text
            .get(it.relative(first, 0, len)?..it.relative(second, len, len)?)
            .unwrap_or_default(),
        "substr" => {
            let start = it.relative(first, 0, len)?;
            &text[start..start + it.clamped(second, len, len - start)?]
        }
        "substring" => {
            let (start, end) = (it.clamped(first, 0, len)?, it.clamped(second, len, len)?);
            &text[start.min(end)..start.max(end)]
        }
        _ => {
            let other = it.text(first)?;
            return Ok(match name {
                "localeCompare" => f64::from(text.cmp(&other) as i8).into(),
                "startsWith" => text[it.clamped(second, 0, len)?..]
                    .starts_with(&other)
                    .into(),
                "endsWith" => text[..it.clamped(second, len, len)?]
                    .ends_with(&other)
                    .into(),
                "includes" => index_from(&text, &other, it.clamped(second, 0, len)?)
                    .is_some()
                    .into(),
                "indexOf" => index_from(&text, &other, it.clamped(second, 0, len)?).into(),
                _ => {
                    let end = (it.clamped(second, len, len)? + other.len()).min(len);
                    if other.is_empty() {
                        end.into()
                    } else {
                        strings::last_index_of(&text[..end], &other).into()
                    }
                }
            });
        }
    };
    it.new_string(part)
}

pub(crate) const ARRAY_METHODS: &[&str] = &[
    "concat",
    "includes",
    "indexOf",
    "join",
    "lastIndexOf",
    "pop",
    "push",
    "reverse",
    "shift",
    "slice",
    "sort",
    "splice",
    "toString",
    "unshift",
];

pub(crate) fn array_method(
    it: &mut Machine<'_>,
    name: &str,
    this: &Value,
    arguments: &[Value],
) -> Outcome {
    let Some(len) = it.items(this).map(|it| it.len()) else {
        return it.incompatible();
    };
    let (first, second) = (nth(arguments, 0), nth(arguments, 1));
    it.spend(match (name, first) {
        ("push" | "pop", _) => arguments.len(),
        ("includes" | "indexOf" | "lastIndexOf", Value::String(wanted)) => {
            len / 4 + len * (wanted.len() / 256)
        }
        _ => len / 4 + arguments.len(),
    })?;
    let range = match name {
        "slice" => it.relative(first, 0, len)?..it.relative(second, len, len)?,
        "splice" => {
            let start = it.relative(first, 0, len)?;
            start
                ..start
                    + if arguments.len() == 1 {
                        len - start
                    } else {
                        it.clamped(second, 0, len - start)?
                    }
        }
        "includes" | "indexOf" => it.relative(second, 0, len)?..len,
        "push" => len..len,
        _ => 0..0,
    };
    let Some(items) = it.items(this).filter(|it| it.len() == len) else {
        return Err(Abrupt::Abort);
    };
    match name {
        "pop" => Ok(items.pop().unwrap_or_default()),
        "shift" => Ok(if len > 0 { items.remove(0) } else { Value::Undefined }),
        "push" | "unshift" => {
            items.splice(range, arguments.iter().cloned());
            it.check_length(len + arguments.len(), usize::MAX).map(|()| (len + arguments.len()).into())
        }
        "reverse" => {
            items.reverse();
            Ok(this.clone())
        }
        "slice" => {
            let part = items.get(range).unwrap_or_default().to_vec();
            it.new_array(part)
        }
        "splice" => {
            let removed = items.splice(range, arguments.iter().skip(2).cloned()).collect();
            it.check_length(len + arguments.len(), usize::MAX)?;
            it.new_array(removed)
        }
        "includes" => Ok(items[range].iter().any(|it| it.is_same(first) || matches!((it, first), (Value::Number(a), Value::Number(b)) if a.is_nan() && b.is_nan())).into()),
        "indexOf" => Ok(items[range.clone()].iter().position(|it| it.is_same(first)).map(|it| range.start + it).into()),
        "lastIndexOf" => Ok(items.iter().rposition(|it| it.is_same(first)).into()),
        _ => {
            let mut items = items.clone();
            match name {
                "concat" => {
                    for argument in arguments {
                        items.extend_from_slice(it.items(argument).map_or_else(|| core::slice::from_ref(argument), |it| it));
                        it.check_length(items.len(), usize::MAX)?;
                    }
                    it.new_array(items)
                }
                "sort" => {
                    it.spend(len * 8)?;
                    let sorted = it.sorted(items, first)?;
                    it.items(this).into_iter().for_each(|it| it.clone_from(&sorted));
                    Ok(this.clone())
                }
                _ => {
                    let separator = first.given().map_or_else(|| Ok(b","[..].into()), |first| it.text(first))?;
                    it.join(&items, &separator)
                }
            }
        }
    }
}

pub(crate) const ITERATING_METHODS: &[&str] = &[
    "every",
    "filter",
    "find",
    "findIndex",
    "forEach",
    "map",
    "reduce",
    "some",
];

pub(crate) fn iterating_method(
    it: &mut Machine<'_>,
    name: &str,
    this: &Value,
    arguments: &[Value],
) -> Outcome {
    let Some(len) = it.items(this).map(|it| it.len()) else {
        return it.incompatible();
    };
    let (callback, mut kept, mut total) =
        (nth(arguments, 0), Vec::new(), arguments.get(1).cloned());
    for index in 0..len {
        let Some(item) = it.items(this).and_then(|it| it.get(index).cloned()) else {
            break;
        };
        if name == "reduce" {
            total = Some(match total {
                Some(total) => it.call(
                    callback,
                    &Value::Undefined,
                    &[total, item, index.into(), this.clone()],
                )?,
                None => item,
            });
            continue;
        }
        let result = it.call(
            callback,
            nth(arguments, 1),
            &[item.clone(), index.into(), this.clone()],
        )?;
        match (name, result.is_truthy()) {
            ("map", _) => kept.push(result),
            ("filter", true) => kept.push(item),
            ("find", true) => return Ok(item),
            ("findIndex", true) => return Ok(index.into()),
            ("some", true) | ("every", false) => return Ok((name == "some").into()),
            _ => {}
        }
    }
    match name {
        "map" | "filter" => it.new_array(kept),
        "some" | "every" => Ok((name == "every").into()),
        "findIndex" => Ok(None.into()),
        "reduce" => total.map_or_else(
            || {
                it.throw(
                    "TypeError",
                    "Reduce of an empty array with no initial value",
                )
            },
            Ok,
        ),
        _ => Ok(Value::Undefined),
    }
}

/// The same for values that are the same.
fn identity_of(value: &Value) -> Vec<u8> {
    match value {
        Value::String(text) => [b"s", &**text].concat(),
        Value::Number(number) => [
            &b"n"[..],
            &if number.is_nan() {
                f64::NAN
            } else {
                number + 0.0
            }
            .to_ne_bytes(),
        ]
        .concat(),
        Value::Object(id) => [&b"o"[..], &id.to_ne_bytes()].concat(),
        Value::Bool(it) => vec![u8::from(*it)],
        Value::Null => vec![2],
        Value::Undefined => vec![3],
    }
}

pub(crate) fn new_collection(
    it: &mut Machine<'_>,
    name: &str,
    _: &Value,
    arguments: &[Value],
) -> Outcome {
    let collection = Value::Object(it.allocate(
        Kind::Entries(Default::default()),
        Some(if name == "Map" { MAPS } else { SETS }),
    ));
    for item in if nth(arguments, 0).is_nullish() {
        Vec::new()
    } else {
        it.iterate(&arguments[0])?
    } {
        let entry = if name == "Map" {
            it.iterate(&item)?
        } else {
            vec![item]
        };
        collection_method(
            it,
            if name == "Map" { "set" } else { "add" },
            &collection,
            &entry,
        )?;
    }
    Ok(collection)
}

pub(crate) fn items_of_collection(it: &mut Machine<'_>, collection: &Value) -> Outcome<Vec<Value>> {
    let is_set = matches!(collection, Value::Object(id) if it.object(*id).prototype == Some(SETS));
    let items = collection_method(it, if is_set { "keys" } else { "entries" }, collection, &[])?;
    it.iterate(&items)
}

pub(crate) fn collection_method(
    it: &mut Machine<'_>,
    name: &str,
    this: &Value,
    arguments: &[Value],
) -> Outcome {
    let (Value::Object(id), key) = (this, nth(arguments, 0)) else {
        return it.incompatible();
    };
    it.spend(if let Value::String(text) = key {
        text.len() / 8
    } else {
        0
    })?;
    let Kind::Entries(entries) = &mut it.object(*id).kind else {
        return it.incompatible();
    };
    let len = entries.len();
    match name {
        "has" => Ok(entries.contains(&identity_of(key)).into()),
        "get" => Ok(entries
            .get(&identity_of(key))
            .map(|it| it[1].clone())
            .unwrap_or_default()),
        "add" | "set" => {
            entries.insert(
                &identity_of(key),
                [
                    key.clone(),
                    nth(arguments, usize::from(name == "set")).clone(),
                ],
            );
            it.spend(4).map(|()| this.clone())
        }
        "delete" => {
            let was_there = entries.ordered_remove(&identity_of(key).into());
            it.spend(len / 4).map(|()| was_there.into())
        }
        "clear" => Ok((entries.clear(), Value::Undefined).1),
        _ => {
            let (entries, mut items) = (entries.values().to_vec(), Vec::new());
            for [own_key, value] in entries {
                items.push(match name {
                    "keys" => own_key,
                    "values" => value,
                    "entries" => it.new_array(vec![own_key, value])?,
                    _ => it.call(key, nth(arguments, 1), &[value, own_key, this.clone()])?,
                });
            }
            if name == "forEach" {
                Ok(Value::Undefined)
            } else {
                it.new_array(items)
            }
        }
    }
}

pub(crate) fn pattern_method(
    it: &mut Machine<'_>,
    name: &str,
    this: &Value,
    arguments: &[Value],
) -> Outcome {
    let Some(pattern) = it.pattern(this) else {
        return it.incompatible();
    };
    if name == "toString" {
        let text = [b"/", &*pattern.source, b"/", &pattern.flags].concat();
        return it.new_string(&text);
    }
    let text = it.text(nth(arguments, 0))?;
    let found = it.exec(this, &text)?;
    if name == "test" {
        Ok(found.is_some().into())
    } else {
        it.match_array(found, &text)
    }
}

pub(crate) fn number_method(
    it: &mut Machine<'_>,
    name: &str,
    this: &Value,
    arguments: &[Value],
) -> Outcome {
    let Value::Number(number) = *this else {
        return it.incompatible();
    };
    let given = it.integer(
        nth(arguments, 0),
        if name == "toFixed" { 0.0 } else { 10.0 },
    )?;
    match name {
        "valueOf" => Ok(this.clone()),
        "toFixed" => Ok(FormatDouble::to_fixed(&mut [0; 124], number, given as u32).into()),
        _ if !(2.0..=36.0).contains(&given) => {
            it.throw("RangeError", "The radix must be between 2 and 36")
        }
        _ if given == 10.0 || !number.is_finite() => it.text(this).map(Value::String),
        _ => {
            let rests = core::iter::successors(Some(number.abs().trunc()), |it| {
                Some((it / given).trunc()).filter(|it| *it > 0.0)
            });
            let mut digits: Vec<u8> = rests
                .map(|it| b"0123456789abcdefghijklmnopqrstuvwxyz"[(it % given) as usize])
                .collect();
            digits.extend((number < 0.0).then_some(b'-'));
            digits.reverse();
            Ok(digits[..].into())
        }
    }
}

pub(crate) fn function_method(
    it: &mut Machine<'_>,
    name: &str,
    this: &Value,
    arguments: &[Value],
) -> Outcome {
    if name == "call" {
        return it.call(
            this,
            nth(arguments, 0),
            arguments.get(1..).unwrap_or_default(),
        );
    }
    let spread = it.items(nth(arguments, 1)).cloned().unwrap_or_default();
    it.spend(spread.len())?;
    it.call(this, nth(arguments, 0), &spread)
}

pub(crate) fn object_method(
    it: &mut Machine<'_>,
    name: &str,
    this: &Value,
    arguments: &[Value],
) -> Outcome {
    match name {
        "hasOwnProperty" => it.has_own(this, nth(arguments, 0)).map(Value::Bool),
        "valueOf" => Ok(this.clone()),
        _ if matches!(this, Value::Bool(_)) => it.text(this).map(Value::String),
        _ => Ok(if it.items(this).is_some() {
            &b"[object Array]"[..]
        } else {
            b"[object Object]"
        }
        .into()),
    }
}

pub(crate) fn error_method(it: &mut Machine<'_>, _: &str, this: &Value, _: &[Value]) -> Outcome {
    let parts = [
        it.get_named(this, b"name")?,
        it.get_named(this, b"message")?,
    ];
    it.join(&parts, b": ")
}
