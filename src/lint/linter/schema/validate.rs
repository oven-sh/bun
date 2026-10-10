//! Validates JSON against a JSON schema the way Ajv 6 does with ESLint's options (draft-04,
//! `useDefaults`, `verbose`, not `allErrors`): the same errors in the same order, with the same
//! messages. Only the keywords that the schemas of rules use are implemented.

use crate::linter::message::write_json;
use crate::options::Json;
use crate::regex::Regex;
use bun_core::strings;
use rustc_hash::FxHashMap;

const MAX_DEPTH: usize = 128;

/// An error object of Ajv.
#[derive(Clone, Debug)]
pub(super) struct SchemaError {
    /// `error.data`
    pub(super) data: Json,
    /// `error.message`
    pub(super) message: Vec<u8>,
    /// For `additionalProperties: false`: the property, and the properties that the schema has.
    pub(super) additional_property: Option<(Vec<u8>, Vec<Vec<u8>>)>,
}

pub(super) struct Validator<'s> {
    pub(super) root: &'s Json,
    pub(super) errors: Vec<SchemaError>,
}

#[derive(Copy, Clone)]
struct Context {
    /// Inside `anyOf`, `oneOf` or `not`: defaults are not assigned.
    is_composite: bool,
    /// Inside `not`: no errors are made.
    makes_errors: bool,
    depth: usize,
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

/// `fast-deep-equal`
fn is_equal(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Array(a), Json::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| is_equal(a, b))
        }
        (Json::Object(a), Json::Object(_)) => {
            a.len() == b.as_object().map_or(0, <[_]>::len)
                && a.iter()
                    .all(|(key, a)| b.get(key).is_some_and(|b| is_equal(a, b)))
        }
        _ => a == b,
    }
}

fn number_of(schema: &Json, key: &[u8]) -> Option<f64> {
    match schema.get(key) {
        Some(Json::Number(n)) => Some(*n),
        _ => None,
    }
}

/// The types that have keywords of their own, in the order in which Ajv checks them, and these
/// keywords.
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

/// Whether there is a `$ref` anywhere in a schema.
fn has_reference(schema: &Json, depth: usize) -> bool {
    match schema {
        _ if depth > MAX_DEPTH => false,
        Json::Array(items) => items.iter().any(|it| has_reference(it, depth + 1)),
        Json::Object(entries) => entries
            .iter()
            .any(|it| it.0 == b"$ref" || has_reference(&it.1, depth + 1)),
        _ => false,
    }
}

/// `schemaHasRules`: whether a schema has a keyword that validates.
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

fn written(number: f64) -> Vec<u8> {
    let mut out = Vec::new();
    write_json(&mut out, &Json::Number(number));
    out
}

impl<'s> Validator<'s> {
    fn error(&mut self, cx: Context, data: &Json, message: &[&[u8]]) -> bool {
        if cx.makes_errors {
            self.errors.push(SchemaError {
                data: data.clone(),
                message: message.concat(),
                additional_property: None,
            });
        }
        false
    }

    /// The schema at a reference like `#/definitions/value`.
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

    /// Whether `data` is valid. If not, the errors are added.
    pub(super) fn validate(&mut self, schema: &'s Json, data: &mut Json) -> bool {
        let cx = Context {
            is_composite: false,
            makes_errors: true,
            depth: 0,
        };
        self.check(schema, data, cx)
    }

    fn check(&mut self, schema: &'s Json, data: &mut Json, cx: Context) -> bool {
        if cx.depth > MAX_DEPTH || schema.as_object().is_none() {
            return true;
        }
        let cx = Context {
            depth: cx.depth + 1,
            ..cx
        };
        // Next to `$ref`, other keywords are ignored.
        if let Some(reference) = schema.get(b"$ref").and_then(Json::as_str) {
            let Some(target) = self.resolve(reference) else {
                return true;
            };
            // What has references itself is compiled to a function of its own, which does not know
            // what it is called from.
            let is_composite = cx.is_composite && !has_reference(target, 0);
            return self.check(target, data, Context { is_composite, ..cx });
        }
        let types: Vec<&[u8]> = match schema.get(b"type") {
            // ajv has no code for a type that it does not know: `"any"`. Among several it is one that nothing has.
            Some(Json::String(name)) if !TYPES.contains(&&name[..]) => Vec::new(),
            Some(Json::String(name)) => vec![name],
            Some(Json::Array(names)) => names.iter().filter_map(Json::as_str).collect(),
            _ => Vec::new(),
        };
        if !types.is_empty() && !types.iter().any(|name| has_type(data, name)) {
            self.error(cx, data, &[b"should be ", &types.join(&b',')]);
            // The type is checked before everything else unless it is one type that has keywords of
            // its own in the schema. Nothing stops the keywords of the first group from being
            // checked after that, where an error does not end the validation.
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

    /// The keywords for the values of one type, if `data` is one.
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
            return self.error(cx, data, &[b"should be <= ", &written(limit)]);
        }
        if let Some(limit) = number_of(schema, b"minimum")
            && (value < limit || value.is_nan())
        {
            return self.error(cx, data, &[b"should be >= ", &written(limit)]);
        }
        true
    }

    fn check_string(&mut self, schema: &'s Json, data: &Json, cx: Context) -> bool {
        let Json::String(value) = data else {
            return true;
        };
        // `ucs2length`: code points.
        let length = || bstr::ByteSlice::chars(&value[..]).count() as f64;
        if let Some(limit) = number_of(schema, b"maxLength")
            && length() > limit
        {
            return self.error(
                cx,
                data,
                &[
                    b"should NOT be longer than ",
                    &written(limit),
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
                &[
                    b"should NOT be shorter than ",
                    &written(limit),
                    b" characters",
                ],
            );
        }
        if let Some(pattern) = schema.get(b"pattern").and_then(Json::as_str)
            && regex_of(pattern).is_some_and(|regex| !regex.test(value))
        {
            return self.error(cx, data, &[b"should match pattern \"", pattern, b"\""]);
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
                &[b"should NOT have more than ", &written(limit), b" items"],
            );
        }
        if let Some(limit) = number_of(schema, b"minItems")
            && (len as f64) < limit
        {
            return self.error(
                cx,
                data,
                &[b"should NOT have fewer than ", &written(limit), b" items"],
            );
        }
        match items_schema {
            Some(Json::Array(schemas)) => {
                let additional = schema.get(b"additionalItems");
                if additional == Some(&Json::Bool(false)) && len > schemas.len() {
                    return self.error(
                        cx,
                        data,
                        &[
                            b"should NOT have more than ",
                            &written(schemas.len() as f64),
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
                        && !self.check(item_schema, item, cx)
                    {
                        return false;
                    }
                }
            }
            Some(item_schema @ Json::Object(_)) => {
                let Json::Array(items) = data else {
                    return true;
                };
                for item in items {
                    if !self.check(item_schema, item, cx) {
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
            return self.error(cx, data, &[message.as_bytes()]);
        }
        true
    }

    /// The two items that `uniqueItems` names, in the order it names them.
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
        // Items of simple types are looked up by what they print as, from the end: they are the keys of an object. With several
        // types, a string is told apart from what prints the same.
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
                &[
                    b"should NOT have more than ",
                    &written(limit),
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
                &[
                    b"should NOT have fewer than ",
                    &written(limit),
                    b" properties",
                ],
            );
        }
        // What has a schema in `properties` is looked for there.
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
                // Here Ajv names the property as it is accessed: `getProperty`.
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
        // A schema for the whole object, where it has the property. The other form, a list of
        // properties, no rule has.
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
            self.error(cx, data, &[b"should NOT have additional properties"]);
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
                if is_additional(key) && !self.check(additional, value, cx) {
                    return false;
                }
            }
        }
        for (key, property) in properties.iter().filter(|it| has_rules(&it.1)) {
            match entries.iter_mut().find(|it| it.0 == *key) {
                Some((_, value)) => {
                    if !self.check(property, value, cx) {
                        return false;
                    }
                }
                None if required.contains(&&key[..]) => {
                    let data = Json::Object(entries.clone());
                    return self.error(cx, &data, &[b"should have required property '", key, b"'"]);
                }
                None => {}
            }
        }
        for (regex, property) in &patterns {
            for (key, value) in entries.iter_mut() {
                if regex.as_ref().is_some_and(|regex| regex.test(key))
                    && !self.check(*property, value, cx)
                {
                    return false;
                }
            }
        }
        true
    }

    /// The keywords that are for all types.
    fn check_any(&mut self, schema: &'s Json, data: &mut Json, cx: Context) -> bool {
        if let Some(constant) = schema.get(b"const")
            && !is_equal(data, constant)
        {
            return self.error(cx, data, &[b"should be equal to constant"]);
        }
        if let Some(allowed) = schema.get(b"enum").and_then(Json::as_array)
            && !allowed.iter().any(|it| is_equal(data, it))
        {
            return self.error(cx, data, &[b"should be equal to one of the allowed values"]);
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
                return self.error(cx, data, &[b"should NOT be valid"]);
            }
        }
        let errors_before = self.errors.len();
        if let Some(alternatives) = schema.get(b"anyOf").and_then(Json::as_array) {
            if !alternatives
                .iter()
                .any(|it| self.check(it, data, composite))
            {
                return self.error(cx, data, &[b"should match some schema in anyOf"]);
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
                return self.error(cx, data, &[b"should match exactly one schema in oneOf"]);
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
                // Where the first error ends it all, that of the branch has.
                return cx.is_composite
                    && self.error(cx, data, &[b"should match \"", name, b"\" schema"]);
            }
        }
        true
    }
}
