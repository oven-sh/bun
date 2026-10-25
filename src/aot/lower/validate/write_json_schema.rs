//! Writes the validation nodes of a type as the JSON Schema that `new Bun.Validator(schema)` reads: draft 2020-12, plus
//! the keyword `x-bun` for what JSON Schema cannot say.

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;

use smallvec::SmallVec;

use crate::ir::generated::{
    TemplatePart, TemplatePlaceholder, TextFormat, UndeclaredMembers, ValidatedPrimitive,
    ValidationMember, ValidationNode, ValidationRule, ValidationShape,
};
use crate::ir::{PropertyKeyTable, StringId, StringTable};
use crate::validation_plans::Json;

const ROOT: u32 = 0;
/// A schema nested deeper than this moves to `$defs`, so that no reader of the schema has to recurse far.
const MAX_NESTED_NODES: u32 = 32;

type Members = Vec<(Box<[u8]>, Json)>;

/// `nodes[0]` is the root.
pub fn write_json_schema(
    strings: &StringTable,
    property_keys: &PropertyKeyTable,
    nodes: &[ValidationNode],
) -> Json {
    let mut writer = SchemaWriter {
        strings,
        property_keys,
        nodes,
        use_counts: count_uses(nodes),
        is_leaf: (nodes.iter().map(|node| children_of(node).is_empty())).collect(),
        is_definition: vec![false; nodes.len()],
        pending_definitions: Vec::new(),
    };
    let mut root = writer.write_node(ROOT, 0);
    if root.is_false() {
        return Json::Boolean(false);
    }
    root.add_extension("source", text("typescript"));
    let mut definitions = BTreeMap::new();
    while let Some(node) = writer.pending_definitions.pop() {
        definitions.insert(node, writer.write_node(node, 0).into_json());
    }
    let definitions = definitions.into_iter();
    root.definitions = definitions
        .map(|(node, schema)| (node.to_string().into_bytes().into(), schema))
        .collect();
    root.into_json()
}

fn text(value: &str) -> Json {
    Json::String(value.as_bytes().into())
}

fn count(value: u32) -> Json {
    Json::Number(f64::from(value))
}

fn object<const N: usize>(members: [(&str, Json); N]) -> Json {
    let members = members.map(|(key, value)| (key.as_bytes().into(), value));
    Json::Object(members.into())
}

fn reference(target: &str) -> Json {
    object([("$ref", text(target))])
}

fn find_member(members: &Members, key: &[u8]) -> Option<usize> {
    members.iter().position(|(known, _)| **known == *key)
}

fn format_name(format: TextFormat) -> &'static str {
    match format {
        TextFormat::Email => "email",
        TextFormat::Uuid => "uuid",
        TextFormat::Ipv4 => "ipv4",
        TextFormat::Ipv6 => "ipv6",
        TextFormat::Date => "date",
        TextFormat::DateTime => "date-time",
        TextFormat::Url => "url",
        TextFormat::Time => "time",
        TextFormat::Duration => "duration",
        TextFormat::Hostname => "hostname",
        TextFormat::Uri => "uri",
        TextFormat::UriReference => "uri-reference",
        TextFormat::Regex => "regex",
        TextFormat::JsonPointer => "json-pointer",
        TextFormat::RelativeJsonPointer => "relative-json-pointer",
    }
}

fn placeholder_name(placeholder: TemplatePlaceholder) -> &'static str {
    match placeholder {
        TemplatePlaceholder::String => "string",
        TemplatePlaceholder::Number => "number",
        TemplatePlaceholder::BigInt => "bigint",
    }
}

/// Every node that the schema of `node` mentions, once for each mention.
fn children_of(node: &ValidationNode) -> SmallVec<[u32; 8]> {
    let mut children: SmallVec<[u32; 8]> = SmallVec::new();
    match &node.shape {
        ValidationShape::Unknown
        | ValidationShape::Never
        | ValidationShape::Undefined
        | ValidationShape::Null
        | ValidationShape::AnyObject
        | ValidationShape::Primitive { .. }
        | ValidationShape::BooleanLiteral { .. }
        | ValidationShape::NumberLiteral { .. }
        | ValidationShape::StringLiteral { .. } => {}
        ValidationShape::Array { element } => children.push(*element),
        ValidationShape::Tuple { elements, rest, .. } => {
            children.extend_from_slice(elements);
            children.extend(*rest);
        }
        ValidationShape::Dictionary { value } => children.push(*value),
        ValidationShape::Object {
            members,
            undeclared_value,
            ..
        } => {
            children.extend(members.iter().map(|member| member.node));
            children.extend(*undeclared_value);
        }
        ValidationShape::Union { arms } => children.extend_from_slice(arms),
    }
    for rule in &node.rules {
        match rule {
            ValidationRule::Contains { node, .. }
            | ValidationRule::Not { node }
            | ValidationRule::MemberNames { node }
            | ValidationRule::DependentNode { node, .. } => children.push(*node),
            ValidationRule::If {
                condition,
                then,
                otherwise,
            } => children.extend([*condition, *then, *otherwise]),
            ValidationRule::ExactlyOne { nodes }
            | ValidationRule::Every { nodes }
            | ValidationRule::PatternMembers { nodes, .. } => children.extend_from_slice(nodes),
            ValidationRule::Integer
            | ValidationRule::Minimum { .. }
            | ValidationRule::Maximum { .. }
            | ValidationRule::ExclusiveMinimum { .. }
            | ValidationRule::ExclusiveMaximum { .. }
            | ValidationRule::MultipleOf { .. }
            | ValidationRule::MinimumLength { .. }
            | ValidationRule::MaximumLength { .. }
            | ValidationRule::Pattern { .. }
            | ValidationRule::Format { .. }
            | ValidationRule::Template { .. }
            | ValidationRule::Message { .. }
            | ValidationRule::DefaultNull
            | ValidationRule::DefaultBoolean { .. }
            | ValidationRule::DefaultNumber { .. }
            | ValidationRule::DefaultString { .. }
            | ValidationRule::UniqueItems
            | ValidationRule::MinimumMembers { .. }
            | ValidationRule::MaximumMembers { .. }
            | ValidationRule::DependentMembers { .. } => {}
        }
    }
    children
}

/// How often the nodes that the root reaches mention each node.
fn count_uses(nodes: &[ValidationNode]) -> Vec<u32> {
    let mut use_counts = vec![0u32; nodes.len()];
    let mut is_reached = vec![false; nodes.len()];
    is_reached[ROOT as usize] = true;
    let mut pending = vec![ROOT];
    while let Some(node) = pending.pop() {
        for child in children_of(&nodes[node as usize]) {
            use_counts[child as usize] = use_counts[child as usize].saturating_add(1);
            if !std::mem::replace(&mut is_reached[child as usize], true) {
                pending.push(child);
            }
        }
    }
    use_counts
}

fn is_finite(value: &Json) -> bool {
    !matches!(value, Json::Number(number) if !number.is_finite())
}

fn is_list(shape: &ValidationShape) -> bool {
    matches!(
        shape,
        ValidationShape::Array { .. } | ValidationShape::Tuple { .. }
    )
}

/// The keywords of one schema while they are collected.
#[derive(Default)]
struct Schema {
    accepts_nothing: bool,
    keywords: Members,
    all_of: Vec<Json>,
    title: Option<Json>,
    extensions: Members,
    definitions: Members,
}

impl Schema {
    fn is_false(&self) -> bool {
        self.accepts_nothing
            && self.keywords.is_empty()
            && self.all_of.is_empty()
            && self.title.is_none()
            && self.extensions.is_empty()
    }

    fn add(&mut self, keyword: &str, value: Json) {
        self.add_group([(keyword, value)]);
    }

    /// Adds keywords that only mean something together. An object holds a keyword once, so a second rule of the same kind goes into `allOf`.
    fn add_group<const N: usize>(&mut self, group: [(&str, Json); N]) {
        let mut names = group.iter().map(|(keyword, _)| keyword.as_bytes());
        if names.any(|keyword| find_member(&self.keywords, keyword).is_some()) {
            return self.all_of.push(object(group));
        }
        for (keyword, value) in group {
            self.keywords.push((keyword.as_bytes().into(), value));
        }
    }

    /// Adds `key` to the object that `keyword` holds.
    fn add_entry(&mut self, keyword: &str, key: &[u8], value: Json) {
        let index = find_member(&self.keywords, keyword.as_bytes()).unwrap_or_else(|| {
            let entries = Json::Object(Vec::new());
            self.keywords.push((keyword.as_bytes().into(), entries));
            self.keywords.len() - 1
        });
        let Json::Object(entries) = &mut self.keywords[index].1 else {
            unreachable!("the keyword holds an object");
        };
        if find_member(entries, key).is_some() {
            let entry = Json::Object(vec![(key.into(), value)]);
            return self.all_of.push(object([(keyword, entry)]));
        }
        entries.push((key.into(), value));
    }

    fn add_extension(&mut self, name: &str, value: Json) {
        if find_member(&self.extensions, name.as_bytes()).is_some() {
            let extension = object([(name, value)]);
            return self.all_of.push(object([("x-bun", extension)]));
        }
        self.extensions.push((name.as_bytes().into(), value));
    }

    fn set(&mut self, keyword: &str, value: Json) {
        match find_member(&self.keywords, keyword.as_bytes()) {
            Some(index) => self.keywords[index].1 = value,
            None => self.keywords.push((keyword.as_bytes().into(), value)),
        }
    }

    fn refuse_numbers(&mut self) {
        self.add("not", object([("type", text("number"))]));
    }

    /// No number is below `-Infinity`, and every number is above it.
    fn add_lower_bound(&mut self, keyword: &str, bound: f64) {
        if bound.is_finite() {
            self.add(keyword, Json::Number(bound));
        } else if bound != f64::NEG_INFINITY {
            self.refuse_numbers();
        }
    }

    fn add_upper_bound(&mut self, keyword: &str, bound: f64) {
        if bound.is_finite() {
            self.add(keyword, Json::Number(bound));
        } else if bound != f64::INFINITY {
            self.refuse_numbers();
        }
    }

    fn into_json(mut self) -> Json {
        if self.is_false() {
            return Json::Boolean(false);
        }
        if self.accepts_nothing {
            self.add("not", Json::Object(Vec::new()));
        }
        let mut members = self.keywords;
        let mut add = |keyword: &str, value: Json| members.push((keyword.as_bytes().into(), value));
        if !self.all_of.is_empty() {
            add("allOf", Json::Array(self.all_of));
        }
        if let Some(title) = self.title {
            add("title", title);
        }
        if !self.extensions.is_empty() {
            add("x-bun", Json::Object(self.extensions));
        }
        if !self.definitions.is_empty() {
            add("$defs", Json::Object(self.definitions));
        }
        Json::Object(members)
    }
}

struct SchemaWriter<'a> {
    strings: &'a StringTable,
    property_keys: &'a PropertyKeyTable,
    nodes: &'a [ValidationNode],
    use_counts: Vec<u32>,
    /// Whether the node mentions no other node.
    is_leaf: Vec<bool>,
    /// Whether `$defs` holds the node or will.
    is_definition: Vec<bool>,
    pending_definitions: Vec<u32>,
}

impl<'a> SchemaWriter<'a> {
    fn bytes(&self, string: StringId) -> &'a [u8] {
        self.strings.get(string)
    }

    fn string(&self, string: StringId) -> Json {
        Json::String(self.bytes(string).into())
    }

    fn string_list(&self, strings: &[StringId]) -> Json {
        Json::Array(strings.iter().map(|&string| self.string(string)).collect())
    }

    fn key_of(&self, member: &ValidationMember) -> &'a [u8] {
        let key = self.property_keys.get(member.key).text;
        self.bytes(key.expect("a validated member has a string key"))
    }

    /// The schema of `node` where another schema mentions it: in place, or a reference.
    fn write_use(&mut self, node: u32, depth: u32) -> Json {
        if node == ROOT {
            return reference("#");
        }
        let is_shared = self.use_counts[node as usize] > 1 || depth >= MAX_NESTED_NODES;
        // A copy of a schema that mentions no other is about as short as a reference to it.
        if self.is_leaf[node as usize] || !is_shared {
            return self.write_node(node, depth + 1).into_json();
        }
        if !std::mem::replace(&mut self.is_definition[node as usize], true) {
            self.pending_definitions.push(node);
        }
        reference(&format!("#/$defs/{node}"))
    }

    fn write_uses(&mut self, nodes: &[u32], depth: u32) -> Json {
        let uses = nodes.iter().map(|&node| self.write_use(node, depth));
        Json::Array(uses.collect())
    }

    /// The value that a node accepts if it accepts exactly one, and says nothing else.
    fn find_enum_value(&self, node: u32) -> Option<Json> {
        let node = &self.nodes[node as usize];
        if !node.rules.is_empty() || node.text.is_some() {
            return None;
        }
        match node.shape {
            ValidationShape::Null => Some(Json::Null),
            ValidationShape::BooleanLiteral { value } => Some(Json::Boolean(value)),
            ValidationShape::NumberLiteral { value } => Some(Json::Number(value)),
            ValidationShape::StringLiteral { value } => Some(self.string(value)),
            _ => None,
        }
    }

    fn write_node(&mut self, index: u32, depth: u32) -> Schema {
        let nodes = self.nodes;
        let node = &nodes[index as usize];
        let mut schema = Schema::default();
        self.write_shape(&mut schema, node, depth);
        // The shape of a tuple has counted the first of these in.
        let mut is_counted_in = matches!(node.shape, ValidationShape::Tuple { .. });
        for rule in &node.rules {
            if matches!(rule, ValidationRule::MinimumLength { .. })
                && std::mem::replace(&mut is_counted_in, false)
            {
                continue;
            }
            self.write_rule(&mut schema, rule, is_list(&node.shape), depth);
        }
        schema.title = node.text.map(|title| self.string(title));
        schema
    }

    fn write_shape(&mut self, schema: &mut Schema, node: &ValidationNode, depth: u32) {
        match &node.shape {
            ValidationShape::Unknown => {}
            ValidationShape::Never => schema.accepts_nothing = true,
            ValidationShape::Undefined => schema.add_extension("type", text("undefined")),
            ValidationShape::Null => schema.add("type", text("null")),
            ValidationShape::AnyObject => schema.add_extension("type", text("object")),
            ValidationShape::Primitive { primitive } => match primitive {
                ValidatedPrimitive::String => schema.add("type", text("string")),
                ValidatedPrimitive::Number => schema.add("type", text("number")),
                ValidatedPrimitive::Boolean => schema.add("type", text("boolean")),
                ValidatedPrimitive::BigInt => schema.add_extension("type", text("bigint")),
            },
            ValidationShape::BooleanLiteral { value } => schema.add("const", Json::Boolean(*value)),
            // A schema holds finite numbers only, and no value that is validated equals `NaN` or `Infinity`.
            ValidationShape::NumberLiteral { value } if !value.is_finite() => {
                schema.accepts_nothing = true;
            }
            ValidationShape::NumberLiteral { value } => schema.add("const", Json::Number(*value)),
            ValidationShape::StringLiteral { value } => schema.add("const", self.string(*value)),
            ValidationShape::Array { element } => {
                schema.add("type", text("array"));
                schema.add("items", self.write_use(*element, depth));
            }
            ValidationShape::Tuple {
                elements,
                required,
                rest,
            } => {
                schema.add("type", text("array"));
                if !elements.is_empty() {
                    schema.add("prefixItems", self.write_uses(elements, depth));
                }
                let mut lengths = node.rules.iter().filter_map(|rule| match rule {
                    ValidationRule::MinimumLength { length } => Some(*length),
                    _ => None,
                });
                let min_items = lengths.next().unwrap_or(0).max(*required);
                if min_items > 0 {
                    schema.add("minItems", count(min_items));
                }
                let rest = rest.map(|rest| self.write_use(rest, depth));
                schema.add("items", rest.unwrap_or(Json::Boolean(false)));
            }
            ValidationShape::Dictionary { value } => {
                schema.add("type", text("object"));
                schema.add("additionalProperties", self.write_use(*value, depth));
            }
            ValidationShape::Object {
                members,
                undeclared,
                undeclared_value,
                ..
            } => {
                schema.add("type", text("object"));
                let mut properties = Vec::with_capacity(members.len());
                let mut required = Vec::new();
                for member in members {
                    let key = self.key_of(member);
                    properties.push((key.into(), self.write_use(member.node, depth)));
                    if !member.is_optional {
                        required.push(Json::String(key.into()));
                    }
                }
                if !properties.is_empty() {
                    schema.add("properties", Json::Object(properties));
                }
                if !required.is_empty() {
                    schema.add("required", Json::Array(required));
                }
                match undeclared {
                    UndeclaredMembers::Allowed => {}
                    UndeclaredMembers::Rejected => {
                        schema.add("additionalProperties", Json::Boolean(false));
                    }
                    UndeclaredMembers::Validated => {
                        let value = undeclared_value.expect("validated members have a node");
                        schema.add("additionalProperties", self.write_use(value, depth));
                    }
                }
            }
            ValidationShape::Union { arms } if arms.is_empty() => schema.accepts_nothing = true,
            ValidationShape::Union { arms } => {
                let values = arms.iter().map(|&arm| self.find_enum_value(arm));
                match values.collect::<Option<Vec<Json>>>() {
                    Some(mut values) => {
                        values.retain(is_finite);
                        match values.is_empty() {
                            true => schema.accepts_nothing = true,
                            false => schema.add("enum", Json::Array(values)),
                        }
                    }
                    None => schema.add("anyOf", self.write_uses(arms, depth)),
                }
            }
        }
    }

    fn write_rule(
        &mut self,
        schema: &mut Schema,
        rule: &ValidationRule,
        is_list: bool,
        depth: u32,
    ) {
        match rule {
            ValidationRule::Integer => schema.set("type", text("integer")),
            ValidationRule::Minimum { bound } => schema.add_lower_bound("minimum", *bound),
            ValidationRule::ExclusiveMinimum { bound } => {
                schema.add_lower_bound("exclusiveMinimum", *bound);
            }
            ValidationRule::Maximum { bound } => schema.add_upper_bound("maximum", *bound),
            ValidationRule::ExclusiveMaximum { bound } => {
                schema.add_upper_bound("exclusiveMaximum", *bound);
            }
            // JSON Schema takes no negative divisor, and the sign makes no difference.
            ValidationRule::MultipleOf { divisor } => {
                schema.add("multipleOf", Json::Number(divisor.abs()));
            }
            ValidationRule::MinimumLength { length } => {
                let keyword = if is_list { "minItems" } else { "minLength" };
                schema.add(keyword, count(*length));
            }
            ValidationRule::MaximumLength { length } => {
                let keyword = if is_list { "maxItems" } else { "maxLength" };
                schema.add(keyword, count(*length));
            }
            ValidationRule::Pattern { source, is_unicode } => {
                let source = self.string(*source);
                match is_unicode {
                    true => schema.add("pattern", source),
                    false => schema.add_extension("pattern", source),
                }
            }
            ValidationRule::Format { format } => schema.add("format", text(format_name(*format))),
            ValidationRule::Template { head, parts } => {
                schema.add_extension("template", self.write_template(*head, parts));
            }
            ValidationRule::Message { text: message } => {
                schema.add_extension("message", self.string(*message));
            }
            ValidationRule::DefaultNull => schema.add_extension("default", Json::Null),
            ValidationRule::DefaultBoolean { value } => {
                schema.add_extension("default", Json::Boolean(*value));
            }
            ValidationRule::DefaultNumber { value } => {
                if value.is_finite() {
                    schema.add_extension("default", Json::Number(*value));
                }
            }
            ValidationRule::DefaultString { value } => {
                schema.add_extension("default", self.string(*value));
            }
            ValidationRule::UniqueItems => schema.set("uniqueItems", Json::Boolean(true)),
            ValidationRule::Contains {
                node,
                minimum,
                maximum,
            } => {
                let contains = ("contains", self.write_use(*node, depth));
                let minimum = ("minContains", count(*minimum));
                match maximum {
                    Some(maximum) => {
                        schema.add_group([contains, minimum, ("maxContains", count(*maximum))]);
                    }
                    None => schema.add_group([contains, minimum]),
                }
            }
            ValidationRule::Not { node } => schema.add("not", self.write_use(*node, depth)),
            ValidationRule::If {
                condition,
                then,
                otherwise,
            } => schema.add_group([
                ("if", self.write_use(*condition, depth)),
                ("then", self.write_use(*then, depth)),
                ("else", self.write_use(*otherwise, depth)),
            ]),
            ValidationRule::ExactlyOne { nodes } => {
                schema.add("oneOf", self.write_uses(nodes, depth));
            }
            ValidationRule::Every { nodes } => {
                for &node in nodes {
                    schema.all_of.push(self.write_use(node, depth));
                }
            }
            ValidationRule::PatternMembers { sources, nodes } => {
                for (&source, &node) in sources.iter().zip(nodes) {
                    let value = self.write_use(node, depth);
                    schema.add_entry("patternProperties", self.bytes(source), value);
                }
            }
            ValidationRule::MemberNames { node } => {
                schema.add("propertyNames", self.write_use(*node, depth));
            }
            ValidationRule::MinimumMembers { count: members } => {
                schema.add("minProperties", count(*members));
            }
            ValidationRule::MaximumMembers { count: members } => {
                schema.add("maxProperties", count(*members));
            }
            ValidationRule::DependentMembers { key, names } => {
                let names = self.string_list(names);
                schema.add_entry("dependentRequired", self.bytes(*key), names);
            }
            ValidationRule::DependentNode { key, node } => {
                let value = self.write_use(*node, depth);
                schema.add_entry("dependentSchemas", self.bytes(*key), value);
            }
        }
    }

    fn write_template(&self, head: StringId, parts: &[TemplatePart]) -> Json {
        let mut texts = vec![self.string(head)];
        texts.extend(parts.iter().map(|part| self.string(part.text)));
        let placeholders = parts.iter().map(|part| placeholder_name(part.placeholder));
        object([
            ("texts", Json::Array(texts)),
            (
                "placeholders",
                Json::Array(placeholders.map(text).collect()),
            ),
        ])
    }
}
