//! Validates JSON against a JSON schema the way Ajv 6 does with ESLint's options (draft-04, `useDefaults`, `verbose`,
//! not `allErrors`). It produces the same errors in the same order with the same messages. Only the keywords that rule
//! schemas use are implemented.

use crate::linter::message::write_json;
use crate::options::Json;
use crate::regex::Regex;
use bun_core::strings;
use rustc_hash::FxHashMap;

/// One step of a path into nested arrays and objects.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Step {
    Index(usize),
    Key(Vec<u8>),
}

/// The quantity that a minimum or maximum limits.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Of {
    /// The number itself.
    Value,
    Characters,
    Items,
    Properties,
}

/// The reason a schema keyword rejected the data.
#[derive(Clone, Debug)]
pub(super) enum Why {
    /// `type`
    Type(Vec<Vec<u8>>),
    /// `enum`, `const`
    Allowed(Vec<Json>),
    Most(f64, Of),
    Least(f64, Of),
    Pattern(Vec<u8>),
    Duplicates,
    /// `required`
    Missing(Vec<u8>),
    /// `additionalProperties: false`. Holds the unknown property and the properties the schema has.
    Unknown(Vec<u8>, Vec<Vec<u8>>),
    /// `anyOf`, `oneOf`, `not`, `then` or `else` failed. The errors before this one have the details.
    Composite,
}

/// An Ajv error object.
#[derive(Clone, Debug)]
pub(super) struct SchemaError {
    /// Path from the root to `data`.
    pub(super) path: Vec<Step>,
    pub(super) why: Why,
    /// `error.data`
    pub(super) data: Json,
    /// `error.message`
    pub(super) message: Vec<u8>,
    /// For `additionalProperties: false`: the unknown property and the properties the schema has.
    pub(super) additional_property: Option<(Vec<u8>, Vec<Vec<u8>>)>,
}

pub(super) struct Validator<'s> {
    pub(super) root: &'s Json,
    pub(super) errors: Vec<SchemaError>,
    /// True if the data is nested too deeply for the stack. The validator's other results are meaningless then.
    pub(super) is_out_of_stack: bool,
}

#[derive(Copy, Clone)]
struct Context {
    /// True inside `anyOf`, `oneOf` or `not`, where defaults aren't assigned.
    is_composite: bool,
    /// False inside `not`, where errors aren't recorded.
    makes_errors: bool,
}

/// `!(value % 1) && !isNaN(value)`
fn is_integer(value: f64) -> bool {
    let rest = value % 1.0;
    !value.is_nan() && (rest == 0.0 || rest.is_nan())
}

const TYPES: [&[u8]; 7] = [
    b"number", b"integer", b"string", b"array", b"object", b"boolean", b"null",
];

fn has_type(data: &Json, name: &[u8]) -> bool {
    match (name, data) {
        (b"null", Json::Null) | (b"boolean", Json::Bool(_)) | (b"string", Json::String(_)) => true,
        (b"array", Json::Array(_)) | (b"object", Json::Object(_)) => true,
        (b"number", Json::Number(_)) => true,
        (b"integer", Json::Number(n)) => is_integer(*n),
        _ => false,
    }
}

/// `fast-deep-equal`, and the opposite of ESLint's `containsDifferentProperty`. Key order doesn't matter.
pub(in crate::linter) fn is_equal(a: &Json, b: &Json) -> bool {
    let mut unseen = Vec::new();
    let mut pair = (a, b);
    loop {
        match pair {
            (Json::Array(a), Json::Array(b)) if a.len() == b.len() => {
                unseen.extend(a.iter().zip(b));
            }
            (Json::Object(a), Json::Object(entries)) if a.len() == entries.len() => {
                for (key, a) in a {
                    match pair.1.get(key) {
                        Some(b) => unseen.push((a, b)),
                        None => return false,
                    }
                }
            }
            (Json::Array(_) | Json::Object(_), _) => return false,
            (a, b) if a != b => return false,
            _ => {}
        }
        match unseen.pop() {
            Some(next) => pair = next,
            None => return true,
        }
    }
}

fn number_of(schema: &Json, key: &[u8]) -> Option<f64> {
    match schema.get(key) {
        Some(Json::Number(n)) => Some(*n),
        _ => None,
    }
}

/// The types that have type-specific keywords, each with those keywords, in the order Ajv checks them.
const GROUPS: [(&[u8], &[&[u8]]); 4] = [
    (
        b"number",
        &[b"maximum", b"minimum", b"multipleOf", b"format"],
    ),
    (
        b"string",
        &[b"maxLength", b"minLength", b"pattern", b"format"],
    ),
    (
        b"array",
        &[
            b"maxItems",
            b"minItems",
            b"items",
            b"contains",
            b"uniqueItems",
        ],
    ),
    (
        b"object",
        &[
            b"maxProperties",
            b"minProperties",
            b"required",
            b"dependencies",
            b"propertyNames",
            b"properties",
            b"additionalProperties",
            b"patternProperties",
        ],
    ),
];

fn uses_group(schema: &Json, keywords: &[&[u8]]) -> bool {
    keywords.iter().any(|keyword| schema.get(keyword).is_some())
}

/// True if there's a `$ref` anywhere in the schema.
fn has_reference(schema: &Json) -> bool {
    match schema {
        _ if !bun_core::StackCheck::init().is_safe_to_recurse() => false,
        Json::Array(items) => items.iter().any(has_reference),
        Json::Object(entries) => entries
            .iter()
            .any(|it| it.0 == b"$ref" || has_reference(&it.1)),
        _ => false,
    }
}

/// `schemaHasRules`: true if the schema has a keyword that validates.
fn has_rules(schema: &Json) -> bool {
    schema
        .as_object()
        .unwrap_or_default()
        .iter()
        .any(|(key, _)| {
            !matches!(
                &key[..],
                b"default"
                    | b"definitions"
                    | b"$defs"
                    | b"description"
                    | b"title"
                    | b"id"
                    | b"$id"
                    | b"$schema"
                    | b"examples"
            )
        })
}

/// `new RegExp(pattern)`
fn regex_of(pattern: &[u8]) -> Option<Regex> {
    Regex::new(std::str::from_utf8(pattern).ok()?, "").ok()
}

fn format_number(number: f64) -> Vec<u8> {
    let mut out = Vec::new();
    write_json(&mut out, &Json::Number(number));
    out
}

impl<'s> Validator<'s> {
    fn error(&mut self, cx: Context, data: &Json, why: Why, message: &[&[u8]]) -> bool {
        if cx.makes_errors {
            self.errors.push(SchemaError {
                path: Vec::new(),
                why,
                // Under `anyOf`, every level of the data records an error, and most of them are discarded. So
                // `validate` copies arrays and objects only at the end. Ajv stores a reference here too.
                data: match data {
                    Json::Array(_) => Json::Array(Vec::new()),
                    Json::Object(_) => Json::Object(Vec::new()),
                    data => data.clone(),
                },
                message: message.concat(),
                additional_property: None,
            });
        }
        false
    }

    /// Resolves a reference like `#/definitions/value`.
    fn resolve(&self, reference: &[u8]) -> Option<&'s Json> {
        let mut at = self.root;
        for part in strings::split(reference.strip_prefix(b"#")?, b"/").skip(1) {
            let part =
                strings::replace_owned(&strings::replace_owned(part, b"~1", b"/"), b"~0", b"~");
            at = match at {
                Json::Array(items) => {
                    items.get(std::str::from_utf8(&part).ok()?.parse::<usize>().ok()?)?
                }
                at => at.get(&part)?,
            };
        }
        Some(at)
    }

    /// Returns true if `data` is valid. Otherwise adds the errors to `self.errors`.
    pub(super) fn validate(&mut self, schema: &'s Json, data: &mut Json) -> bool {
        let cx = Context {
            is_composite: false,
            makes_errors: true,
        };
        let is_valid = self.check(schema, data, cx);
        for error in &mut self.errors {
            error.path.reverse();
            let found = error.path.iter().try_fold(&*data, |at, step| match step {
                Step::Index(index) => at.as_array()?.get(*index),
                Step::Key(key) => at.get(key),
            });
            if let (Json::Array(_) | Json::Object(_), Some(found)) = (&error.data, found) {
                error.data = found.clone();
            }
        }
        is_valid
    }

    /// Runs [`Validator::check`] on a child value, one `step` below the current one. Each level appends its step to the
    /// new errors on the way up, so paths are built in reverse.
    fn check_in(&mut self, step: &Step, schema: &'s Json, data: &mut Json, cx: Context) -> bool {
        let errors_before = self.errors.len();
        let is_valid = self.check(schema, data, cx);
        for error in self.errors.iter_mut().skip(errors_before) {
            error.path.push(step.clone());
        }
        is_valid
    }

    fn check(&mut self, schema: &'s Json, data: &mut Json, cx: Context) -> bool {
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            self.is_out_of_stack = true;
            return true;
        }
        if schema.as_object().is_none() {
            return true;
        }
        // Keywords next to `$ref` are ignored.
        if let Some(reference) = schema.get(b"$ref").and_then(Json::as_str) {
            let Some(target) = self.resolve(reference) else {
                return true;
            };
            // Ajv compiles a target that itself has references to a separate function, which doesn't know its caller's
            // context.
            let is_composite = cx.is_composite && !has_reference(target);
            return self.check(target, data, Context { is_composite, ..cx });
        }
        let types: Vec<&[u8]> = match schema.get(b"type") {
            // Ajv generates no check for a single unknown type like `"any"`. In a list of types, an unknown one never
            // matches.
            Some(Json::String(name)) if !TYPES.contains(&&name[..]) => Vec::new(),
            Some(Json::String(name)) => vec![name],
            Some(Json::Array(names)) => names.iter().filter_map(Json::as_str).collect(),
            _ => Vec::new(),
        };
        if !types.is_empty() && !types.iter().any(|name| has_type(data, name)) {
            let names = types.iter().map(|it| it.to_vec()).collect();
            self.error(
                cx,
                data,
                Why::Type(names),
                &[b"should be ", &types.join(&b',')],
            );
            // Ajv checks `type` first, unless it's a single type whose own keywords appear in the schema. Inside a
            // composite, where an error doesn't stop validation, it still checks the first keyword group afterwards.
            let is_checked_first = schema
                .get(b"type")
                .is_some_and(|it| it.as_array().is_some())
                || GROUPS
                    .iter()
                    .find(|group| group.0 == types[0])
                    .is_none_or(|group| !uses_group(schema, group.1));
            if cx.is_composite && is_checked_first {
                match GROUPS.iter().find(|group| uses_group(schema, group.1)) {
                    Some(group) => self.check_typed(group.0, schema, data, cx),
                    None => self.check_any(schema, data, cx),
                };
            }
            return false;
        }
        GROUPS
            .iter()
            .all(|group| self.check_typed(group.0, schema, data, cx))
            && self.check_any(schema, data, cx)
    }

    /// Checks the keywords specific to one type, if `data` has that type.
    fn check_typed(
        &mut self,
        group: &[u8],
        schema: &'s Json,
        data: &mut Json,
        cx: Context,
    ) -> bool {
        match (group, &*data) {
            (b"number", Json::Number(_)) => self.check_number(schema, data, cx),
            (b"string", Json::String(_)) => self.check_string(schema, data, cx),
            (b"array", Json::Array(_)) => self.check_array(schema, data, cx),
            (b"object", Json::Object(_)) => self.check_object(schema, data, cx),
            _ => true,
        }
    }

    fn check_number(&mut self, schema: &'s Json, data: &Json, cx: Context) -> bool {
        let Json::Number(value) = *data else {
            return true;
        };
        if let Some(limit) = number_of(schema, b"maximum")
            && (value > limit || value.is_nan())
        {
            let why = Why::Most(limit, Of::Value);
            return self.error(cx, data, why, &[b"should be <= ", &format_number(limit)]);
        }
        if let Some(limit) = number_of(schema, b"minimum")
            && (value < limit || value.is_nan())
        {
            let why = Why::Least(limit, Of::Value);
            return self.error(cx, data, why, &[b"should be >= ", &format_number(limit)]);
        }
        true
    }

    fn check_string(&mut self, schema: &'s Json, data: &Json, cx: Context) -> bool {
        let Json::String(value) = data else {
            return true;
        };
        // `ucs2length` counts code points.
        let length = || bstr::ByteSlice::chars(&value[..]).count() as f64;
        if let Some(limit) = number_of(schema, b"maxLength")
            && length() > limit
        {
            return self.error(
                cx,
                data,
                Why::Most(limit, Of::Characters),
                &[
                    b"should NOT be longer than ",
                    &format_number(limit),
                    b" characters",
                ],
            );
        }
        if let Some(limit) = number_of(schema, b"minLength")
            && length() < limit
        {
            return self.error(
                cx,
                data,
                Why::Least(limit, Of::Characters),
                &[
                    b"should NOT be shorter than ",
                    &format_number(limit),
                    b" characters",
                ],
            );
        }
        if let Some(pattern) = schema.get(b"pattern").and_then(Json::as_str)
            && regex_of(pattern).is_some_and(|regex| !regex.test(value))
        {
            let why = Why::Pattern(pattern.to_vec());
            return self.error(cx, data, why, &[b"should match pattern \"", pattern, b"\""]);
        }
        true
    }

    fn check_array(&mut self, schema: &'s Json, data: &mut Json, cx: Context) -> bool {
        let items_schema = schema.get(b"items");
        if !cx.is_composite
            && let (Some(Json::Array(schemas)), Json::Array(items)) = (items_schema, &mut *data)
        {
            for (i, default) in schemas.iter().map(|it| it.get(b"default")).enumerate() {
                if let Some(default) = default
                    && i >= items.len()
                {
                    // Assigning past the end leaves holes, which print as `null`.
                    items.resize(i, Json::Null);
                    items.push(default.clone());
                }
            }
        }
        let len = data.as_array().map_or(0, <[_]>::len);
        if let Some(limit) = number_of(schema, b"maxItems")
            && len as f64 > limit
        {
            return self.error(
                cx,
                data,
                Why::Most(limit, Of::Items),
                &[
                    b"should NOT have more than ",
                    &format_number(limit),
                    b" items",
                ],
            );
        }
        if let Some(limit) = number_of(schema, b"minItems")
            && (len as f64) < limit
        {
            return self.error(
                cx,
                data,
                Why::Least(limit, Of::Items),
                &[
                    b"should NOT have fewer than ",
                    &format_number(limit),
                    b" items",
                ],
            );
        }
        match items_schema {
            Some(Json::Array(schemas)) => {
                let additional = schema.get(b"additionalItems");
                if additional == Some(&Json::Bool(false)) && len > schemas.len() {
                    return self.error(
                        cx,
                        data,
                        Why::Most(schemas.len() as f64, Of::Items),
                        &[
                            b"should NOT have more than ",
                            &format_number(schemas.len() as f64),
                            b" items",
                        ],
                    );
                }
                let Json::Array(items) = data else {
                    return true;
                };
                for (i, item) in items.iter_mut().enumerate() {
                    let item_schema = schemas
                        .get(i)
                        .or_else(|| additional.filter(|it| it.as_object().is_some()));
                    if let Some(item_schema) = item_schema
                        && !self.check_in(&Step::Index(i), item_schema, item, cx)
                    {
                        return false;
                    }
                }
            }
            Some(item_schema @ Json::Object(_)) => {
                let Json::Array(items) = data else {
                    return true;
                };
                for (i, item) in items.iter_mut().enumerate() {
                    if !self.check_in(&Step::Index(i), item_schema, item, cx) {
                        return false;
                    }
                }
            }
            _ => {}
        }
        if schema.get(b"uniqueItems") == Some(&Json::Bool(true))
            && let Some((j, i)) = Self::duplicate(items_schema, data.as_array().unwrap_or_default())
        {
            let message =
                format!("should NOT have duplicate items (items ## {j} and {i} are identical)");
            return self.error(cx, data, Why::Duplicates, &[message.as_bytes()]);
        }
        true
    }

    /// The two items that the `uniqueItems` error mentions, in the order it mentions them.
    fn duplicate(items_schema: Option<&Json>, items: &[Json]) -> Option<(usize, usize)> {
        let types: Vec<&[u8]> = match items_schema.and_then(|it| it.get(b"type")) {
            Some(Json::String(name)) => vec![name],
            Some(Json::Array(names)) => names.iter().filter_map(Json::as_str).collect(),
            _ => Vec::new(),
        };
        if types.is_empty() || types.iter().any(|it| matches!(*it, b"object" | b"array")) {
            for i in (0..items.len()).rev() {
                for j in (0..i).rev() {
                    if is_equal(&items[i], &items[j]) {
                        return Some((j, i));
                    }
                }
            }
            return None;
        }
        // Ajv walks items of simple types from the end and uses their string form as keys of an object. With several
        // types, it prefixes strings so they differ from other values that print the same.
        let key = |value: &Json| {
            let mut out = Vec::new();
            if types.len() > 1 && matches!(value, Json::String(_)) {
                out.push(b'"');
            }
            crate::linter::message::write_js_string(&mut out, value);
            out
        };
        let mut seen: FxHashMap<Vec<u8>, usize> = FxHashMap::default();
        for (i, item) in items.iter().enumerate().rev() {
            if types.iter().any(|name| has_type(item, name))
                && let Some(later) = seen.insert(key(item), i)
            {
                return Some((later, i));
            }
        }
        None
    }

    fn check_object(&mut self, schema: &'s Json, data: &mut Json, cx: Context) -> bool {
        let properties = schema
            .get(b"properties")
            .and_then(Json::as_object)
            .unwrap_or_default();
        if !cx.is_composite
            && let Json::Object(entries) = &mut *data
        {
            for (key, property) in properties {
                if let Some(default) = property.get(b"default")
                    && !entries.iter().any(|it| it.0 == *key)
                {
                    entries.push((key.clone(), default.clone()));
                }
            }
        }
        let count = data.as_object().map_or(0, <[_]>::len) as f64;
        if let Some(limit) = number_of(schema, b"maxProperties")
            && count > limit
        {
            return self.error(
                cx,
                data,
                Why::Most(limit, Of::Properties),
                &[
                    b"should NOT have more than ",
                    &format_number(limit),
                    b" properties",
                ],
            );
        }
        if let Some(limit) = number_of(schema, b"minProperties")
            && count < limit
        {
            return self.error(
                cx,
                data,
                Why::Least(limit, Of::Properties),
                &[
                    b"should NOT have fewer than ",
                    &format_number(limit),
                    b" properties",
                ],
            );
        }
        // A required property with a schema in `properties` is checked below, together with that schema.
        let required: Vec<&[u8]> = schema
            .get(b"required")
            .and_then(Json::as_array)
            .unwrap_or_default()
            .iter()
            .filter_map(Json::as_str)
            .collect();
        let has_schema = |name: &[u8]| properties.iter().any(|it| it.0 == name && has_rules(&it.1));
        for name in required.iter().filter(|name| !has_schema(name)) {
            if data.get(name).is_none() {
                // Here Ajv prints the property as an accessor (`getProperty`).
                let is_identifier = name
                    .first()
                    .is_some_and(|b| b.is_ascii_alphabetic() || matches!(b, b'$' | b'_'))
                    && name
                        .iter()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'$' | b'_'));
                let (before, after): (&[u8], &[u8]) = if is_identifier {
                    (b".", b"")
                } else {
                    (b"['", b"']")
                };
                return self.error(
                    cx,
                    data,
                    Why::Missing(name.to_vec()),
                    &[
                        b"should have required property '",
                        before,
                        name,
                        after,
                        b"'",
                    ],
                );
            }
        }
        // Each dependency is a schema for the whole object that applies if the object has the property. No rule uses
        // the other form, a list of properties.
        let dependencies = schema.get(b"dependencies").and_then(Json::as_object);
        for (key, dependent) in dependencies.unwrap_or_default() {
            if has_rules(dependent) && data.get(key).is_some() && !self.check(dependent, data, cx) {
                return false;
            }
        }
        let patterns: Vec<(Option<Regex>, &'s Json)> = (schema
            .get(b"patternProperties")
            .and_then(Json::as_object)
            .unwrap_or_default()
            .iter())
        .map(|(pattern, schema)| (regex_of(pattern), schema))
        .collect();
        let additional = schema.get(b"additionalProperties");
        let is_additional = |key: &[u8]| {
            !properties.iter().any(|it| it.0 == key)
                && !patterns
                    .iter()
                    .any(|it| it.0.as_ref().is_some_and(|regex| regex.test(key)))
        };
        if additional == Some(&Json::Bool(false))
            && let Some((key, _)) = data
                .as_object()
                .unwrap_or_default()
                .iter()
                .find(|it| is_additional(&it.0))
        {
            let key = key.clone();
            let known = properties.iter().map(|it| it.0.clone()).collect();
            self.error(
                cx,
                data,
                Why::Unknown(key.clone(), known),
                &[b"should NOT have additional properties"],
            );
            if cx.makes_errors
                && schema.get(b"properties").is_some()
                && let Some(error) = self.errors.last_mut()
            {
                error.additional_property =
                    Some((key, properties.iter().map(|it| it.0.clone()).collect()));
            }
            return false;
        }
        let Json::Object(entries) = data else {
            return true;
        };
        if let Some(additional @ Json::Object(_)) = additional {
            for (key, value) in entries.iter_mut() {
                if is_additional(key)
                    && !self.check_in(&Step::Key(key.clone()), additional, value, cx)
                {
                    return false;
                }
            }
        }
        for (key, property) in properties.iter().filter(|it| has_rules(&it.1)) {
            match entries.iter_mut().find(|it| it.0 == *key) {
                Some((_, value)) => {
                    if !self.check_in(&Step::Key(key.clone()), property, value, cx) {
                        return false;
                    }
                }
                None if required.contains(&&key[..]) => {
                    let data = Json::Object(entries.clone());
                    let why = Why::Missing(key.clone());
                    let message: [&[u8]; 3] = [b"should have required property '", key, b"'"];
                    return self.error(cx, &data, why, &message);
                }
                None => {}
            }
        }
        for (regex, property) in &patterns {
            for (key, value) in entries.iter_mut() {
                if regex.as_ref().is_some_and(|regex| regex.test(key))
                    && !self.check_in(&Step::Key(key.clone()), property, value, cx)
                {
                    return false;
                }
            }
        }
        true
    }

    /// Checks the keywords that apply to every type.
    fn check_any(&mut self, schema: &'s Json, data: &mut Json, cx: Context) -> bool {
        if let Some(constant) = schema.get(b"const")
            && !is_equal(data, constant)
        {
            let why = Why::Allowed(vec![constant.clone()]);
            return self.error(cx, data, why, &[b"should be equal to constant"]);
        }
        if let Some(allowed) = schema.get(b"enum").and_then(Json::as_array)
            && !allowed.iter().any(|it| is_equal(data, it))
        {
            let message: &[u8] = b"should be equal to one of the allowed values";
            return self.error(cx, data, Why::Allowed(allowed.to_vec()), &[message]);
        }
        let composite = Context {
            is_composite: true,
            ..cx
        };
        if let Some(not) = schema.get(b"not") {
            let silent = Context {
                makes_errors: false,
                ..composite
            };
            if self.check(not, data, silent) {
                return self.error(cx, data, Why::Composite, &[b"should NOT be valid"]);
            }
        }
        let errors_before = self.errors.len();
        if let Some(alternatives) = schema.get(b"anyOf").and_then(Json::as_array) {
            if !alternatives
                .iter()
                .any(|it| self.check(it, data, composite))
            {
                let message: &[u8] = b"should match some schema in anyOf";
                return self.error(cx, data, Why::Composite, &[message]);
            }
            self.errors.truncate(errors_before);
        }
        if let Some(alternatives) = schema.get(b"oneOf").and_then(Json::as_array) {
            let mut matching = 0;
            for alternative in alternatives {
                matching += usize::from(self.check(alternative, data, composite));
                if matching > 1 {
                    break;
                }
            }
            if matching != 1 {
                let message: &[u8] = b"should match exactly one schema in oneOf";
                return self.error(cx, data, Why::Composite, &[message]);
            }
            self.errors.truncate(errors_before);
        }
        for all in schema
            .get(b"allOf")
            .and_then(Json::as_array)
            .unwrap_or_default()
        {
            if !self.check(all, data, cx) {
                return false;
            }
        }
        if let Some(condition) = schema.get(b"if") {
            let silent = Context {
                makes_errors: false,
                ..composite
            };
            let name: &[u8] = match self.check(condition, data, silent) {
                true => b"then",
                false => b"else",
            };
            if let Some(branch) = schema.get(name)
                && !self.check(branch, data, cx)
            {
                // Outside a composite, the first error stops validation, and the branch already recorded it.
                let message: [&[u8]; 3] = [b"should match \"", name, b"\" schema"];
                return cx.is_composite && self.error(cx, data, Why::Composite, &message);
            }
        }
        true
    }
}
