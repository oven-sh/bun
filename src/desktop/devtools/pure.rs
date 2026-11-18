//! Expressions that are known to change nothing. JavaScriptCore cannot tell while it runs them.

use crate::prelude::*;
use crate::realm::Realm;
use crate::value::Value;

unsafe extern "C" {
    safe fn Bun__Inspector__peek(
        realm: &Realm,
        base: JSValue,
        key: &bun_core::String,
        must_exist: bool,
    ) -> JSValue;
    safe fn Bun__Inspector__isNative(function: JSValue, name: &bun_core::String) -> bool;
}

const HARMLESS: &[&str] = &[
    "closest",
    "getAttribute",
    "getBoundingClientRect",
    "getElementById",
    "getElementsByClassName",
    "getElementsByName",
    "getElementsByTagName",
    "getItem",
    "hasAttribute",
    "item",
    "matches",
    "querySelector",
    "querySelectorAll",
];

fn peek(realm: &Realm, base: JSValue, key: &str, must_exist: bool) -> Option<JSValue> {
    let key = bun_core::String::clone_utf8(key.as_bytes());
    Some(Bun__Inspector__peek(realm, base, &key, must_exist)).filter(|it| !it.is_empty())
}

pub(super) fn member(realm: &Realm, base: JSValue, key: &str) -> Option<JSValue> {
    peek(realm, base, key, false)
}

pub(super) fn variable_in(realm: &Realm, scope: JSValue, name: &str) -> Option<JSValue> {
    peek(realm, scope, name, true)
}

pub(super) fn global_variable(realm: &Realm, window: JSValue, name: &str) -> Option<JSValue> {
    variable_in(realm, JSValue::ZERO, name).or_else(|| variable_in(realm, window, name))
}

/// Arithmetic on numbers, or a literal.
pub(super) fn is_constant(source: &str) -> bool {
    let is_arithmetic = |it: u8| it.is_ascii_digit() || b" +-*/%().".contains(&it);
    source.bytes().all(is_arithmetic) || literal(source.trim()).is_some_and(|it| it.1.is_empty())
}

fn name(source: &str) -> Option<(&str, &str)> {
    let is_part = |it: char| it.is_alphanumeric() || matches!(it, '_' | '$');
    let (name, rest) = source.split_at(source.len() - source.trim_start_matches(is_part).len());
    (name.starts_with(|it: char| !it.is_ascii_digit())).then_some((name, rest.trim_start()))
}

/// A whole number, or a string without escapes.
fn literal(source: &str) -> Option<(Value, &str)> {
    let digits = source.len()
        - source
            .trim_start_matches(|it: char| it.is_ascii_digit())
            .len();
    if digits > 0 {
        let number = source[..digits].parse::<u32>().ok()?;
        return Some((number.into(), source[digits..].trim_start()));
    }
    let quote = source.get(..1).filter(|it| matches!(*it, "'" | "\""))?;
    let (text, rest) = crate::text::split_once(&source[1..], quote)?;
    (!crate::text::contains(text, "\\")).then(|| (text.into(), rest.trim_start()))
}

/// `a.b["c"].d(1)`, as long as no function of the page takes part.
pub(super) fn follow(
    realm: &Realm,
    source: &str,
    variable: &dyn Fn(&str) -> Option<JSValue>,
) -> JsResult<Option<JSValue>> {
    let Some((mut key, mut rest)) = name(source.trim().trim_end_matches(';')) else {
        return Ok(None);
    };
    let (mut this, mut value) = (JSValue::UNDEFINED, variable(key));
    while let (Some(base), false) = (value, rest.is_empty()) {
        let after_dot = rest.strip_prefix("?.").or_else(|| rest.strip_prefix('.'));
        let enclosed = |[open, close]: [char; 2]| {
            let (inside, rest) = literal(rest.strip_prefix(open)?.trim_start())?;
            Some((inside, rest.strip_prefix(close)?.trim_start()))
        };
        if let Some(next) = after_dot.and_then(|it| name(it.trim_start())) {
            (key, rest) = next;
            value = member(realm, base, key);
        } else if let Some((index, after)) = enclosed(['[', ']']) {
            (key, rest, value) = ("", after, member(realm, base, &index.display()));
        } else if HARMLESS.contains(&key)
            && Bun__Inspector__isNative(base, &bun_core::String::clone_utf8(key.as_bytes()))
        {
            let without = rest
                .strip_prefix("()")
                .map(|it| (Value::Undefined, it.trim_start()));
            let Some((given, after)) = without.or_else(|| enclosed(['(', ')'])) else {
                return Ok(None);
            };
            value = catch(base.call(realm, this, &[js(&given)?]))?.ok();
            (key, rest) = ("", after);
        } else {
            return Ok(None);
        }
        this = base;
    }
    Ok(value)
}
