//! What the functions in upstream's `callAllowed` return.

use super::builtins::{Builtin, Member, get_member, set_property};
use super::js_number::{
    parse_float, parse_int, to_exponential, to_fixed, to_int32, to_precision, to_radix_string, to_uint32,
};
use super::js_string::{self, from_utf16, to_utf16};
use super::static_value::{
    Eval, IteratorKind, MAX_LEN, PropertyKey, StaticSymbol, StaticValue, Stop, join, string_to_bigint,
};
use crate::regex::{Ignore, Mode, Options, validate_pattern};
use crate::utils::text;
use bun_core::strings;
use std::borrow::Cow;

type Args<'v, 'a> = &'v [StaticValue<'a>];

fn arg<'v, 'a>(args: Args<'v, 'a>, i: usize) -> &'v StaticValue<'a> {
    args.get(i).unwrap_or(&StaticValue::Undefined)
}

fn number<'a>(n: f64) -> Eval<StaticValue<'a>> {
    Ok(StaticValue::Number(n))
}

fn boolean<'a>(b: bool) -> Eval<StaticValue<'a>> {
    Ok(StaticValue::Bool(b))
}

fn index_or_minus_one<'a>(index: Option<usize>) -> Eval<StaticValue<'a>> {
    number(index.map_or(-1.0, |index| index as f64))
}

fn text_of_units<'a>(units: &[u16]) -> Eval<StaticValue<'a>> {
    Ok(StaticValue::string(from_utf16(units)))
}

/// An index that counts from the end if it is negative, within `0..=len`.
fn relative_index(index: f64, len: usize) -> usize {
    match index < 0.0 {
        true => (len as f64 + index).max(0.0) as usize,
        false => index.min(len as f64) as usize,
    }
}

/// `relative_index` of an argument, or `default` if that is `undefined`.
fn relative_arg(value: &StaticValue<'_>, len: usize, default: usize) -> Eval<usize> {
    match value {
        StaticValue::Undefined => Ok(default),
        _ => Ok(relative_index(value.to_integer()?, len)),
    }
}

/// An index within `0..=len`.
fn clamped_index(value: &StaticValue<'_>, len: usize) -> Eval<usize> {
    Ok(value.to_integer()?.clamp(0.0, len as f64) as usize)
}

/// The index that `at(index)` is about.
fn at_index(index: &StaticValue<'_>, len: usize) -> Eval<Option<usize>> {
    let index = index.to_integer()?;
    let index = if index < 0.0 { len as f64 + index } else { index };
    Ok((index >= 0.0 && index < len as f64).then_some(index as usize))
}

/// An element of an array as it is read: a hole is `undefined`.
fn element<'a>(item: &StaticValue<'a>) -> StaticValue<'a> {
    match item {
        StaticValue::Hole => StaticValue::Undefined,
        item => item.clone(),
    }
}

fn pair<'a>(a: StaticValue<'a>, b: StaticValue<'a>) -> StaticValue<'a> {
    StaticValue::Array(vec![a, b])
}

/// What `[...value]` consists of.
pub(super) fn iterate<'a>(value: &StaticValue<'a>) -> Eval<Vec<StaticValue<'a>>> {
    Ok(match value {
        StaticValue::Array(items) => items.iter().map(element).collect(),
        StaticValue::Set(items) | StaticValue::Iterator(_, items) => items.clone(),
        StaticValue::Map(entries) => entries.iter().map(|(key, value)| pair(key.clone(), value.clone())).collect(),
        StaticValue::String(text) => js_string::code_points_of(&to_utf16(text))
            .map(|c| {
                let mut text = Vec::with_capacity(4);
                js_string::push_code_point(&mut text, c);
                StaticValue::string(text)
            })
            .collect(),
        _ => return Err(Stop::Abort),
    })
}

/// The own enumerable properties of `ToObject(value)` that are named by strings.
pub(super) fn own_enumerable<'a>(value: &StaticValue<'a>) -> Eval<Vec<(Cow<'a, [u8]>, StaticValue<'a>)>> {
    let index = |i: usize| Cow::Owned(i.to_string().into_bytes());
    Ok(match value {
        StaticValue::Undefined | StaticValue::Null | StaticValue::Hole => return Err(Stop::Abort),
        StaticValue::String(text) => (to_utf16(text).iter().enumerate())
            .map(|(i, &unit)| (index(i), StaticValue::string(from_utf16(&[unit]))))
            .collect(),
        StaticValue::Array(items) => (items.iter().enumerate())
            .filter(|(_, item)| **item != StaticValue::Hole)
            .map(|(i, item)| (index(i), item.clone()))
            .collect(),
        StaticValue::Object(properties) => (properties.iter())
            .filter_map(|(key, value)| match key {
                PropertyKey::String(name) => Some((name.clone(), value.clone())),
                PropertyKey::Symbol(_) => None,
            })
            .collect(),
        _ => Vec::new(),
    })
}

/// `String.raw({ raw }, ...substitutions)`
pub(super) fn string_raw<'a>(raw: &[Cow<'a, [u8]>], substitutions: Args<'_, 'a>) -> Eval<StaticValue<'a>> {
    let mut text = Vec::new();
    for (i, piece) in raw.iter().enumerate() {
        js_string::push_str(&mut text, piece);
        if i + 1 < raw.len()
            && let Some(substitution) = substitutions.get(i)
        {
            js_string::push_str(&mut text, &substitution.to_string()?);
        }
        if text.len() > MAX_LEN {
            return Err(Stop::Abort);
        }
    }
    Ok(StaticValue::string(text))
}

/// `function.call(this, ...args)` for any value of `function`, as the standard library calls a
/// callback.
fn call_value<'a>(function: &StaticValue<'a>, this: &StaticValue<'a>, args: Args<'_, 'a>) -> Eval<StaticValue<'a>> {
    match function {
        StaticValue::Builtin(builtin) if builtin.member() == Member::Call => call(*builtin, this, args),
        StaticValue::Builtin(builtin) if builtin.member() == Member::PassThrough => Ok(arg(args, 0).clone()),
        _ => Err(Stop::Abort),
    }
}

/// `function.call(this, ...args)` for a function in `callAllowed`.
pub(super) fn call<'a>(function: Builtin, this: &StaticValue<'a>, args: Args<'_, 'a>) -> Eval<StaticValue<'a>> {
    let path = function.name();
    if let Some(name) = path.strip_prefix("Math.") {
        return math(name, args);
    }
    if let Some((owner, name)) = strings::split_once(path.as_bytes(), b".prototype.") {
        return match (owner, this) {
            (b"String", StaticValue::String(text)) => string_method(name, text, args),
            (b"String", this) if !this.is_nullish() && name != b"toString" => string_method(name, &this.to_string()?, args),
            (b"Number", StaticValue::Number(n)) => number_method(name, *n, args),
            (b"Array", StaticValue::Array(items)) => array_method(name, items, args),
            (b"Map", StaticValue::Map(entries)) => map_method(name, entries, args),
            (b"Set", StaticValue::Set(items)) => set_method(name, items, args),
            _ => Err(Stop::Abort),
        };
    }
    let first = arg(args, 0);
    match path {
        "Array.isArray" => boolean(matches!(first, StaticValue::Array(_))),
        "Array.of" => Ok(StaticValue::Array(args.to_vec())),
        "BigInt" => to_bigint(first),
        "Boolean" => boolean(first.is_truthy()),
        "Number" => match first.to_primitive()? {
            _ if args.is_empty() => number(0.0),
            StaticValue::BigInt(n) => number(n as f64),
            primitive => number(primitive.to_number()?),
        },
        "Number.isFinite" => boolean(first.as_number().is_some_and(f64::is_finite)),
        "Number.isNaN" => boolean(first.as_number().is_some_and(f64::is_nan)),
        "Object" => construct(function, args),
        "Object.entries" => Ok(StaticValue::Array(
            (own_enumerable(first)?.into_iter()).map(|(key, value)| pair(StaticValue::String(key), value)).collect(),
        )),
        "Object.keys" => Ok(StaticValue::Array(
            own_enumerable(first)?.into_iter().map(|(key, _)| StaticValue::String(key)).collect(),
        )),
        "Object.values" => Ok(StaticValue::Array(own_enumerable(first)?.into_iter().map(|(_, value)| value).collect())),
        "Object.is" => boolean(first.same_value(arg(args, 1))?),
        // Nothing here is frozen: `Object.freeze(a)` has the value of `a`.
        "Object.isExtensible" => boolean(first.is_object()),
        "Object.isFrozen" | "Object.isSealed" => boolean(!first.is_object()),
        "RegExp" => construct(function, args),
        "String" => match args.is_empty() {
            true => Ok(StaticValue::string(&b""[..])),
            false => first.to_js_string().map(StaticValue::String).ok_or(Stop::Abort),
        },
        "String.fromCharCode" => {
            let units: Eval<Vec<u16>> = args.iter().map(|it| Ok(to_uint32(it.to_number()?) as u16)).collect();
            text_of_units(&units?)
        }
        "String.fromCodePoint" => {
            let mut text = Vec::new();
            for code_point in args {
                let c = code_point.to_number()?;
                if c.fract() != 0.0 || !(0.0..=1_114_111.0).contains(&c) {
                    return Err(Stop::Abort);
                }
                let mut one = Vec::with_capacity(4);
                js_string::push_code_point(&mut one, c as u32);
                js_string::push_str(&mut text, &one);
            }
            Ok(StaticValue::string(text))
        }
        "String.raw" => {
            let raw = get_member(first, &PropertyKey::String(Cow::Borrowed(b"raw")))?;
            let pieces: Eval<Vec<_>> = match &raw {
                StaticValue::Array(items) => items.iter().map(StaticValue::to_string).collect(),
                StaticValue::String(text) => to_utf16(text).iter().map(|&unit| Ok(Cow::Owned(from_utf16(&[unit])))).collect(),
                _ => return Err(Stop::Abort),
            };
            string_raw(&pieces?, args.get(1..).unwrap_or_default())
        }
        "Symbol.for" => Ok(StaticValue::Symbol(StaticSymbol::Registered(first.to_string()?))),
        "Symbol.keyFor" => match first {
            StaticValue::Symbol(StaticSymbol::Registered(key)) => Ok(StaticValue::String(key.clone())),
            StaticValue::Symbol(StaticSymbol::WellKnown(_)) => Ok(StaticValue::Undefined),
            _ => Err(Stop::Abort),
        },
        "decodeURI" => decode_uri(&first.to_string()?, b";/?:@&=+$,#"),
        "decodeURIComponent" => decode_uri(&first.to_string()?, b""),
        "encodeURI" => encode_uri(&first.to_string()?, b";/?:@&=+$,#-_.!~*'()"),
        "encodeURIComponent" => encode_uri(&first.to_string()?, b"-_.!~*'()"),
        "escape" => Ok(escape(&first.to_string()?)),
        "unescape" => text_of_units(&unescape(&to_utf16(&first.to_string()?))),
        "isFinite" => boolean(first.to_number()?.is_finite()),
        "isNaN" => boolean(first.to_number()?.is_nan()),
        // Nothing that is made by evaluating an expression is the prototype of anything.
        "isPrototypeOf" if !first.is_object() || (this.is_object() && !matches!(this, StaticValue::Builtin(_))) => {
            boolean(false)
        }
        "parseFloat" => number(parse_float(&first.to_string()?)),
        "parseInt" => {
            let text = first.to_string()?;
            number(parse_int(&text, to_int32(arg(args, 1).to_number()?)).ok_or(Stop::Abort)?)
        }
        // `Date`, whose results depend on the time and the time zone, and what throws without `new`.
        _ => Err(Stop::Abort),
    }
}

/// `new function(...args)` for a function in `callAllowed`.
pub(super) fn construct<'a>(function: Builtin, args: Args<'_, 'a>) -> Eval<StaticValue<'a>> {
    let first = arg(args, 0);
    match function.name() {
        "Map" => {
            let mut entries: Vec<(StaticValue<'a>, StaticValue<'a>)> = Vec::new();
            if first.is_nullish() {
                return Ok(StaticValue::Map(entries));
            }
            for entry in iterate(first)? {
                if !entry.is_object() {
                    return Err(Stop::Abort);
                }
                let part = |name: &'static [u8]| get_member(&entry, &PropertyKey::String(Cow::Borrowed(name)));
                let (key, value) = (without_negative_zero(part(b"0")?), part(b"1")?);
                match find_same(entries.iter().map(|entry| &entry.0), &key)? {
                    Some(at) => entries[at].1 = value,
                    None => entries.push((key, value)),
                }
            }
            Ok(StaticValue::Map(entries))
        }
        "Set" => {
            let mut items = Vec::new();
            if first.is_nullish() {
                return Ok(StaticValue::Set(items));
            }
            for item in iterate(first)? {
                if find_same(items.iter(), &item)?.is_none() {
                    items.push(without_negative_zero(item));
                }
            }
            Ok(StaticValue::Set(items))
        }
        "Object" => match first {
            _ if first.is_nullish() => Ok(StaticValue::Object(Vec::new())),
            _ if first.is_object() => Ok(first.clone()),
            _ => Err(Stop::Abort),
        },
        "RegExp" => {
            let flags = arg(args, 1);
            let (pattern, flags) = match (first, flags) {
                (StaticValue::Regex { .. }, StaticValue::Undefined) => return Ok(first.clone()),
                (StaticValue::Regex { pattern, .. }, flags) => (pattern.clone(), flags.to_string()?),
                (pattern, flags) => {
                    let text_or_empty = |value: &StaticValue<'a>| match value {
                        StaticValue::Undefined => Ok(Cow::Borrowed(&b""[..])),
                        value => value.to_string(),
                    };
                    (text_or_empty(pattern)?, text_or_empty(flags)?)
                }
            };
            new_regex(pattern, &flags).ok_or(Stop::Abort)
        }
        // Objects that wrap a primitive value, `Date`, and what is not a constructor.
        _ => Err(Stop::Abort),
    }
}

/// `regex.flags` for a regular expression that is made with `flags`. `None` if they are not valid.
pub(super) fn sorted_flags(flags: &[u8]) -> Option<Cow<'_, [u8]>> {
    const ORDER: &[u8] = b"dgimsuvy";
    let sorted: Vec<u8> = ORDER.iter().copied().filter(|&flag| strings::contains_char(flags, flag)).collect();
    if sorted.len() != flags.len() || (strings::contains_char(flags, b'u') && strings::contains_char(flags, b'v')) {
        return None;
    }
    Some(if sorted == flags { Cow::Borrowed(flags) } else { Cow::Owned(sorted) })
}

/// `new RegExp(pattern, flags)`. `None` if that throws.
fn new_regex<'a>(pattern: Cow<'a, [u8]>, flags: &[u8]) -> Option<StaticValue<'a>> {
    let flags: Cow<'a, [u8]> = Cow::Owned(sorted_flags(flags)?.into_owned());
    validate_pattern(&pattern, Mode::of_flags(&flags), Options::default(), &mut Ignore).ok()?;
    Some(StaticValue::Regex {
        pattern: escape_regex_source(pattern),
        flags,
    })
}

/// `EscapeRegExpPattern`: what `regex.source` is for the pattern `text`.
fn escape_regex_source(text: Cow<'_, [u8]>) -> Cow<'_, [u8]> {
    if text.is_empty() {
        return Cow::Borrowed(b"(?:)");
    }
    if strings::index_of_any(&text, b"/\n\r\xE2").is_none() {
        return text;
    }
    let mut source = Vec::with_capacity(text.len() + 4);
    let (mut is_escaped, mut is_in_class) = (false, false);
    let mut rest = &text[..];
    while let [byte, after @ ..] = rest {
        let line_terminator: Option<(&[u8], usize)> = match rest {
            [b'\n', ..] => Some((b"n", 1)),
            [b'\r', ..] => Some((b"r", 1)),
            [0xE2, 0x80, 0xA8, ..] => Some((b"u2028", 3)),
            [0xE2, 0x80, 0xA9, ..] => Some((b"u2029", 3)),
            _ => None,
        };
        if let Some((escape, len)) = line_terminator {
            if !is_escaped {
                source.push(b'\\');
            }
            source.extend_from_slice(escape);
            is_escaped = false;
            rest = &rest[len..];
            continue;
        }
        if !is_escaped {
            match byte {
                b'/' if !is_in_class => source.push(b'\\'),
                b'[' => is_in_class = true,
                b']' => is_in_class = false,
                _ => {}
            }
        }
        is_escaped = !is_escaped && *byte == b'\\';
        source.push(*byte);
        rest = after;
    }
    Cow::Owned(source)
}

/// The keys of a `Map` and the elements of a `Set` have no `-0`.
fn without_negative_zero(value: StaticValue<'_>) -> StaticValue<'_> {
    match value {
        StaticValue::Number(n) if n == 0.0 => StaticValue::Number(0.0),
        value => value,
    }
}

/// Where in `items` the `SameValueZero` of `value` is.
fn find_same<'v, 'a: 'v>(
    items: impl Iterator<Item = &'v StaticValue<'a>>,
    value: &StaticValue<'a>,
) -> Eval<Option<usize>> {
    for (i, item) in items.enumerate() {
        if item.same_value_zero(value)? {
            return Ok(Some(i));
        }
    }
    Ok(None)
}

/// `BigInt(value)`
fn to_bigint<'a>(value: &StaticValue<'a>) -> Eval<StaticValue<'a>> {
    Ok(StaticValue::BigInt(match value.to_primitive()? {
        StaticValue::BigInt(n) => n,
        StaticValue::Bool(b) => i128::from(b),
        StaticValue::Number(n) if n.fract() == 0.0 && n.abs() < 1.7e38 => n as i128,
        StaticValue::String(text) => string_to_bigint(&text)?.ok_or(Stop::Abort)?,
        _ => return Err(Stop::Abort),
    }))
}

fn string_method<'a>(name: &[u8], text: &Cow<'a, [u8]>, args: Args<'_, 'a>) -> Eval<StaticValue<'a>> {
    let (first, second) = (arg(args, 0), arg(args, 1));
    // The part of `text` that `part` returns.
    let borrowed = |part: fn(&[u8]) -> &[u8]| {
        Ok(StaticValue::String(match text {
            Cow::Borrowed(text) => Cow::Borrowed(part(*text)),
            Cow::Owned(text) => Cow::Owned(part(text).to_vec()),
        }))
    };
    let mapped = |map: fn(&[u8]) -> Cow<'_, [u8]>| {
        Ok(StaticValue::String(match map(text) {
            Cow::Borrowed(_) => text.clone(),
            Cow::Owned(mapped) => Cow::Owned(mapped),
        }))
    };
    match name {
        b"toString" => return Ok(StaticValue::String(text.clone())),
        b"trim" => return borrowed(text::trim),
        b"trimStart" => return borrowed(text::trim_start),
        b"trimEnd" => return borrowed(text::trim_end),
        b"toLowerCase" => return mapped(text::to_lower_case),
        b"toUpperCase" => return mapped(text::to_upper_case),
        b"concat" => {
            let mut all = text.clone();
            for more in args {
                all = js_string::concat(all, more.to_string()?);
                if all.len() > MAX_LEN {
                    return Err(Stop::Abort);
                }
            }
            return Ok(StaticValue::String(all));
        }
        b"normalize" => {
            let is_form = match first {
                StaticValue::Undefined => true,
                form => matches!(&*form.to_string()?, b"NFC" | b"NFD" | b"NFKC" | b"NFKD"),
            };
            return match is_form && strings::first_non_ascii(text).is_none() {
                true => Ok(StaticValue::String(text.clone())),
                false => Err(Stop::Abort),
            };
        }
        _ => {}
    }

    let units = to_utf16(text);
    let len = units.len();
    // The argument of the methods that throw if they are given a regular expression.
    let search_text = || match first {
        StaticValue::Regex { .. } => Err(Stop::Abort),
        _ => Ok(to_utf16(&first.to_string()?)),
    };
    match name {
        b"at" => match at_index(first, len)? {
            Some(index) => text_of_units(&units[index..=index]),
            None => Ok(StaticValue::Undefined),
        },
        b"charAt" => {
            let index = first.to_integer()?;
            match index >= 0.0 && index < len as f64 {
                true => text_of_units(&units[index as usize..=index as usize]),
                false => text_of_units(&[]),
            }
        }
        b"charCodeAt" => {
            let index = first.to_integer()?;
            number(if index >= 0.0 { units.get(index as usize).map_or(f64::NAN, |&unit| f64::from(unit)) } else { f64::NAN })
        }
        b"codePointAt" => {
            let index = first.to_integer()?;
            let rest = if index >= 0.0 { units.get(index as usize..).unwrap_or_default() } else { &[] };
            Ok(js_string::code_points_of(rest).next().map_or(StaticValue::Undefined, |c| StaticValue::Number(f64::from(c))))
        }
        b"endsWith" => {
            let search = search_text()?;
            let end = match second {
                StaticValue::Undefined => len,
                position => clamped_index(position, len)?,
            };
            boolean(units[..end].ends_with(&search))
        }
        b"startsWith" => {
            let search = search_text()?;
            boolean(units[clamped_index(second, len)?..].starts_with(&search))
        }
        b"includes" => {
            let search = search_text()?;
            boolean(js_string::index_of(&units, &search, clamped_index(second, len)?).is_some())
        }
        b"indexOf" => {
            let search = to_utf16(&first.to_string()?);
            index_or_minus_one(js_string::index_of(&units, &search, clamped_index(second, len)?))
        }
        b"lastIndexOf" => {
            let search = to_utf16(&first.to_string()?);
            let position = second.to_number()?;
            let from = if position.is_nan() { len } else { position.trunc().clamp(0.0, len as f64) as usize };
            index_or_minus_one(js_string::last_index_of(&units, &search, from))
        }
        b"padEnd" | b"padStart" => {
            let target = first.to_integer()?.max(0.0);
            let filler = match second {
                StaticValue::Undefined => vec![u16::from(b' ')],
                filler => to_utf16(&filler.to_string()?),
            };
            if target <= len as f64 || filler.is_empty() {
                return Ok(StaticValue::String(text.clone()));
            }
            if target > MAX_LEN as f64 {
                return Err(Stop::Abort);
            }
            let padding = filler.iter().copied().cycle().take(target as usize - len);
            let padded: Vec<u16> = match name {
                b"padEnd" => units.iter().copied().chain(padding).collect(),
                _ => padding.chain(units.iter().copied()).collect(),
            };
            text_of_units(&padded)
        }
        b"slice" => {
            let (from, to) = (relative_arg(first, len, 0)?, relative_arg(second, len, len)?);
            text_of_units(units.get(from..to).unwrap_or_default())
        }
        b"substr" => {
            let from = relative_arg(first, len, 0)?;
            let count = match second {
                StaticValue::Undefined => len as f64,
                count => count.to_integer()?,
            };
            let to = (from as f64 + count).clamp(0.0, len as f64) as usize;
            text_of_units(units.get(from..to).unwrap_or_default())
        }
        b"substring" => {
            let from = clamped_index(first, len)?;
            let to = match second {
                StaticValue::Undefined => len,
                end => clamped_index(end, len)?,
            };
            text_of_units(&units[from.min(to)..from.max(to)])
        }
        _ => Err(Stop::Abort),
    }
}

fn number_method<'a>(name: &[u8], n: f64, args: Args<'_, 'a>) -> Eval<StaticValue<'a>> {
    let first = arg(args, 0);
    let digits = first.to_integer()?;
    let is_given = *first != StaticValue::Undefined;
    let text = match name {
        b"toExponential" if !n.is_finite() => text::number_to_string(n),
        b"toExponential" if (0.0..=100.0).contains(&digits) => to_exponential(n, is_given.then_some(digits as usize)),
        b"toFixed" if (0.0..=100.0).contains(&digits) => to_fixed(n, digits as usize),
        b"toPrecision" if !is_given || !n.is_finite() => text::number_to_string(n),
        b"toPrecision" if (1.0..=100.0).contains(&digits) => to_precision(n, digits as usize),
        b"toString" if !is_given => text::number_to_string(n),
        b"toString" if (2.0..=36.0).contains(&digits) => to_radix_string(n, digits as u32),
        _ => return Err(Stop::Abort),
    };
    Ok(StaticValue::string(text))
}

fn array_method<'a>(name: &[u8], items: &[StaticValue<'a>], args: Args<'_, 'a>) -> Eval<StaticValue<'a>> {
    let (first, second) = (arg(args, 0), arg(args, 1));
    let len = items.len();
    // Whether the callback accepts the element at `i`.
    let test = |i: usize, item: &StaticValue<'a>| -> Eval<bool> {
        let args = [element(item), StaticValue::Number(i as f64), StaticValue::Array(items.to_vec())];
        Ok(call_value(first, second, &args)?.is_truthy())
    };
    let present = || items.iter().enumerate().filter(|(_, item)| **item != StaticValue::Hole);
    let iterator = |items: Vec<StaticValue<'a>>| Ok(StaticValue::Iterator(IteratorKind::Array, items));
    // An array without elements still requires a function.
    if matches!(name, b"every" | b"some" | b"filter" | b"find" | b"findIndex")
        && !matches!(first, StaticValue::Builtin(builtin) if builtin.is_callable())
    {
        return Err(Stop::Abort);
    }
    match name {
        b"at" => Ok(at_index(first, len)?.map_or(StaticValue::Undefined, |index| element(&items[index]))),
        b"concat" => {
            let mut all = items.to_vec();
            for more in args {
                match more {
                    StaticValue::Array(more) => all.extend_from_slice(more),
                    // It may have a `Symbol.isConcatSpreadable`.
                    StaticValue::Object(properties) if properties.iter().any(|it| it.0.as_str().is_none()) => {
                        return Err(Stop::Abort);
                    }
                    more => all.push(more.clone()),
                }
                if all.len() > MAX_LEN {
                    return Err(Stop::Abort);
                }
            }
            Ok(StaticValue::Array(all))
        }
        b"entries" => iterator(
            (items.iter().enumerate()).map(|(i, item)| pair(StaticValue::Number(i as f64), element(item))).collect(),
        ),
        b"keys" => iterator((0..len).map(|i| StaticValue::Number(i as f64)).collect()),
        b"values" => iterator(items.iter().map(element).collect()),
        b"every" => {
            for (i, item) in present() {
                if !test(i, item)? {
                    return boolean(false);
                }
            }
            boolean(true)
        }
        b"some" => {
            for (i, item) in present() {
                if test(i, item)? {
                    return boolean(true);
                }
            }
            boolean(false)
        }
        b"filter" => {
            let mut kept = Vec::new();
            for (i, item) in present() {
                if test(i, item)? {
                    kept.push(item.clone());
                }
            }
            Ok(StaticValue::Array(kept))
        }
        b"find" | b"findIndex" => {
            for (i, item) in items.iter().enumerate() {
                if test(i, item)? {
                    return if name == b"find" { Ok(element(item)) } else { number(i as f64) };
                }
            }
            if name == b"find" { Ok(StaticValue::Undefined) } else { number(-1.0) }
        }
        b"flat" => {
            let depth = match first {
                StaticValue::Undefined => 1.0,
                depth => depth.to_integer()?,
            };
            let mut flat = Vec::new();
            flatten(items, depth, &mut flat);
            Ok(StaticValue::Array(flat))
        }
        b"includes" => {
            let from = relative_arg(second, len, 0)?;
            boolean(find_same(items[from..].iter(), first)?.is_some())
        }
        b"indexOf" => {
            let from = relative_arg(second, len, 0)?;
            for (i, item) in present().skip_while(|&(i, _)| i < from) {
                if item.strict_equals(first)? {
                    return number(i as f64);
                }
            }
            number(-1.0)
        }
        b"lastIndexOf" => {
            let from = match args.len() {
                0 | 1 => len as f64 - 1.0,
                _ => match second.to_integer()? {
                    from if from < 0.0 => len as f64 + from,
                    from => from.min(len as f64 - 1.0),
                },
            };
            for (i, item) in present().collect::<Vec<_>>().into_iter().rev() {
                if i as f64 <= from && item.strict_equals(first)? {
                    return number(i as f64);
                }
            }
            number(-1.0)
        }
        b"join" => match first {
            StaticValue::Undefined => Ok(StaticValue::String(join(items, b",")?)),
            separator => Ok(StaticValue::String(join(items, &separator.to_string()?)?)),
        },
        b"toString" => Ok(StaticValue::String(join(items, b",")?)),
        b"slice" => {
            let (from, to) = (relative_arg(first, len, 0)?, relative_arg(second, len, len)?);
            Ok(StaticValue::Array(items.get(from..to).unwrap_or_default().to_vec()))
        }
        _ => Err(Stop::Abort),
    }
}

fn flatten<'a>(items: &[StaticValue<'a>], depth: f64, into: &mut Vec<StaticValue<'a>>) {
    for item in items {
        match item {
            StaticValue::Hole => {}
            StaticValue::Array(inner) if depth >= 1.0 => flatten(inner, depth - 1.0, into),
            item => into.push(item.clone()),
        }
    }
}

fn map_method<'a>(
    name: &[u8],
    entries: &[(StaticValue<'a>, StaticValue<'a>)],
    args: Args<'_, 'a>,
) -> Eval<StaticValue<'a>> {
    let found = || find_same(entries.iter().map(|entry| &entry.0), arg(args, 0));
    let iterator = |items: Vec<StaticValue<'a>>| Ok(StaticValue::Iterator(IteratorKind::Map, items));
    match name {
        b"get" => Ok(found()?.map_or(StaticValue::Undefined, |at| entries[at].1.clone())),
        b"has" => boolean(found()?.is_some()),
        b"entries" => iterator(entries.iter().map(|(key, value)| pair(key.clone(), value.clone())).collect()),
        b"keys" => iterator(entries.iter().map(|entry| entry.0.clone()).collect()),
        b"values" => iterator(entries.iter().map(|entry| entry.1.clone()).collect()),
        _ => Err(Stop::Abort),
    }
}

fn set_method<'a>(name: &[u8], items: &[StaticValue<'a>], args: Args<'_, 'a>) -> Eval<StaticValue<'a>> {
    match name {
        b"has" => boolean(find_same(items.iter(), arg(args, 0))?.is_some()),
        b"entries" => Ok(StaticValue::Iterator(
            IteratorKind::Set,
            items.iter().map(|item| pair(item.clone(), item.clone())).collect(),
        )),
        b"values" => Ok(StaticValue::Iterator(IteratorKind::Set, items.to_vec())),
        _ => Err(Stop::Abort),
    }
}

/// `base ** exponent`
pub(super) fn pow(base: f64, exponent: f64) -> f64 {
    if exponent.is_nan() || (base.abs() == 1.0 && exponent.is_infinite()) {
        return f64::NAN;
    }
    base.powf(exponent)
}

/// The nearest number that has 11 significant bits and an exponent of 5 bits.
fn round_to_half_precision(x: f64) -> f64 {
    if !x.is_finite() || x == 0.0 {
        return x;
    }
    let exponent = ((x.to_bits() >> 52 & 0x7FF) as i32 - 1023).max(-14);
    let unit = 2f64.powi(exponent - 10);
    let rounded = (x / unit).round_ties_even() * unit;
    if rounded.abs() > 65504.0 { f64::INFINITY.copysign(x) } else { rounded }
}

/// `Math[name](...args)`. The last digit of what is not rounded correctly by every implementation,
/// such as `Math.sin`, can differ from that of a JavaScript engine.
fn math<'a>(name: &str, args: Args<'_, 'a>) -> Eval<StaticValue<'a>> {
    let numbers: Vec<f64> = args.iter().map(StaticValue::to_number).collect::<Eval<_>>()?;
    let x = numbers.first().copied().unwrap_or(f64::NAN);
    let y = numbers.get(1).copied().unwrap_or(f64::NAN);
    let has_nan = numbers.iter().any(|n| n.is_nan());
    number(match name {
        "abs" => x.abs(),
        "acos" => x.acos(),
        "acosh" => x.acosh(),
        "asin" => x.asin(),
        "asinh" => x.asinh(),
        "atan" => x.atan(),
        "atan2" => x.atan2(y),
        "atanh" => x.atanh(),
        "cbrt" => x.cbrt(),
        "ceil" => x.ceil(),
        "clz32" => f64::from(to_uint32(x).leading_zeros()),
        "cos" => x.cos(),
        "cosh" => x.cosh(),
        "exp" => x.exp(),
        "expm1" => x.exp_m1(),
        "floor" => x.floor(),
        "f16round" => round_to_half_precision(x),
        "fround" => f64::from(x as f32),
        "hypot" => {
            let largest = numbers.iter().fold(0.0, |largest: f64, n| largest.max(n.abs()));
            if largest.is_infinite() {
                f64::INFINITY
            } else if has_nan {
                f64::NAN
            } else if largest == 0.0 {
                0.0
            } else {
                let (mut sum, mut compensation) = (0.0, 0.0);
                for n in &numbers {
                    let scaled = n / largest;
                    let summand = scaled * scaled - compensation;
                    let preliminary = sum + summand;
                    compensation = (preliminary - sum) - summand;
                    sum = preliminary;
                }
                sum.sqrt() * largest
            }
        }
        "imul" => f64::from(to_int32(x).wrapping_mul(to_int32(y))),
        "log" => x.ln(),
        "log10" => x.log10(),
        "log1p" => x.ln_1p(),
        "log2" => x.log2(),
        "max" | "min" if has_nan => f64::NAN,
        // `0 > -0`
        "max" => numbers.iter().fold(f64::NEG_INFINITY, |max, &n| {
            if n > max || (n == 0.0 && max == 0.0 && max.is_sign_negative()) { n } else { max }
        }),
        "min" => numbers.iter().fold(f64::INFINITY, |min, &n| {
            if n < min || (n == 0.0 && min == 0.0 && n.is_sign_negative()) { n } else { min }
        }),
        "pow" => pow(x, y),
        "round" => {
            let floor = x.floor();
            (if x - floor >= 0.5 { floor + 1.0 } else { floor }).copysign(x)
        }
        "sign" if x == 0.0 || x.is_nan() => x,
        "sign" => 1f64.copysign(x),
        "sin" => x.sin(),
        "sinh" => x.sinh(),
        "sqrt" => x.sqrt(),
        "tan" => x.tan(),
        "tanh" => x.tanh(),
        "trunc" => x.trunc(),
        _ => return Err(Stop::Abort),
    })
}

fn push_hex(text: &mut Vec<u8>, byte: u8) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    text.extend_from_slice(&[HEX[usize::from(byte >> 4)], HEX[usize::from(byte & 15)]]);
}

fn push_percent_escape(text: &mut Vec<u8>, byte: u8) {
    text.push(b'%');
    push_hex(text, byte);
}

/// `Encode`: `encodeURI` and `encodeURIComponent`, which leave letters, digits and `unescaped` as
/// they are. It throws for half a surrogate pair.
fn encode_uri<'a>(text: &[u8], unescaped: &[u8]) -> Eval<StaticValue<'a>> {
    if std::str::from_utf8(text).is_err() {
        return Err(Stop::Abort);
    }
    let mut encoded = Vec::with_capacity(text.len());
    for &byte in text {
        match byte.is_ascii_alphanumeric() || strings::contains_char(unescaped, byte) {
            true => encoded.push(byte),
            false => push_percent_escape(&mut encoded, byte),
        }
    }
    Ok(StaticValue::string(encoded))
}

fn hex_value(digits: &[u16]) -> Option<u32> {
    digits.iter().try_fold(0u32, |value, &digit| Some(value << 4 | char::from_u32(u32::from(digit))?.to_digit(16)?))
}

/// `Decode`: `decodeURI` and `decodeURIComponent`. The escapes of the characters in `preserved`
/// stay. It throws for an escape that is incomplete or is not UTF-8.
fn decode_uri<'a>(text: &[u8], preserved: &[u8]) -> Eval<StaticValue<'a>> {
    let byte_at = |at: usize| match text.get(at..at + 3) {
        Some(&[b'%', high, low]) => hex_value(&[u16::from(high), u16::from(low)]).map(|byte| byte as u8),
        _ => None,
    };
    let mut decoded = Vec::with_capacity(text.len());
    let mut at = 0;
    while let Some(&byte) = text.get(at) {
        if byte != b'%' {
            decoded.push(byte);
            at += 1;
            continue;
        }
        let first = byte_at(at).ok_or(Stop::Abort)?;
        let len = match first {
            0..0x80 => 1,
            0xC0..0xE0 => 2,
            0xE0..0xF0 => 3,
            0xF0..0xF8 => 4,
            _ => return Err(Stop::Abort),
        };
        let bytes: Option<Vec<u8>> = (0..len).map(|i| byte_at(at + 3 * i)).collect();
        let bytes = bytes.ok_or(Stop::Abort)?;
        if std::str::from_utf8(&bytes).is_err() {
            return Err(Stop::Abort);
        }
        match strings::contains_char(preserved, first) {
            true => decoded.extend_from_slice(&text[at..at + 3]),
            false => decoded.extend_from_slice(&bytes),
        }
        at += 3 * len;
    }
    Ok(StaticValue::string(decoded))
}

fn escape<'a>(text: &[u8]) -> StaticValue<'a> {
    let mut escaped = Vec::with_capacity(text.len());
    for unit in to_utf16(text) {
        match u8::try_from(unit) {
            Ok(byte) if byte.is_ascii_alphanumeric() || strings::contains_char(b"@*_+-./", byte) => escaped.push(byte),
            Ok(byte) => push_percent_escape(&mut escaped, byte),
            Err(_) => {
                escaped.extend_from_slice(b"%u");
                push_hex(&mut escaped, (unit >> 8) as u8);
                push_hex(&mut escaped, unit as u8);
            }
        }
    }
    StaticValue::string(escaped)
}

fn unescape(units: &[u16]) -> Vec<u16> {
    let mut unescaped = Vec::with_capacity(units.len());
    let mut rest = units;
    while let [unit, after @ ..] = rest {
        let escape = match after {
            _ if *unit != u16::from(b'%') => None,
            [u, digits @ ..] if *u == u16::from(b'u') => digits.get(..4).and_then(hex_value).map(|value| (value, 5)),
            digits => digits.get(..2).and_then(hex_value).map(|value| (value, 2)),
        };
        match escape {
            Some((value, len)) => {
                unescaped.push(value as u16);
                rest = &after[len..];
            }
            None => {
                unescaped.push(*unit);
                rest = after;
            }
        }
    }
    unescaped
}

/// `Object.assign(properties, value)`
pub(super) fn assign<'a>(
    properties: &mut Vec<(PropertyKey<'a>, StaticValue<'a>)>,
    value: &StaticValue<'a>,
) -> Eval<()> {
    if value.is_nullish() {
        return Ok(());
    }
    if let StaticValue::Object(source) = value {
        return (source.iter()).try_for_each(|(key, value)| set_property(properties, key.clone(), value.clone()));
    }
    (own_enumerable(value)?.into_iter()).try_for_each(|(key, value)| set_property(properties, PropertyKey::String(key), value))
}
