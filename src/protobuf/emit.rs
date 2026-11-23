use core::fmt::Write as _;
use std::collections::{BTreeMap, BTreeSet};

use bun_core::fmt::format_json_string_utf8;
use bun_core::strings;

use crate::parser::bool_of;
use crate::program::{Declaration, Origin, Program, ROOT, Symbol, qualify, take_unique};
use crate::schema::*;
use crate::{Error, Failure, Options, Target};

const WIRE_HELPERS: &str = include_str!("wire.ts");

/// Keywords, the types that TypeScript builds in, and the other names without `$` that the module uses.
const RESERVED_IDENTIFIERS: &[&str] = &[
    "Array",
    "ArrayBuffer",
    "AsyncGenerator",
    "BigInt",
    "Client",
    "DataView",
    "Error",
    "Infinity",
    "Init",
    "JSON",
    "Math",
    "NaN",
    "Number",
    "Object",
    "Promise",
    "RangeError",
    "Routes",
    "Server",
    "String",
    "Symbol",
    "TextDecoder",
    "TextEncoder",
    "TypeError",
    "URL",
    "Uint8Array",
    "any",
    "arguments",
    "as",
    "async",
    "await",
    "bigint",
    "boolean",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "eval",
    "export",
    "exports",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "globalThis",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "interface",
    "let",
    "module",
    "never",
    "new",
    "null",
    "number",
    "object",
    "options",
    "package",
    "private",
    "protected",
    "public",
    "request",
    "requests",
    "require",
    "return",
    "server",
    "static",
    "string",
    "super",
    "switch",
    "symbol",
    "this",
    "throw",
    "true",
    "try",
    "type",
    "typeof",
    "undefined",
    "unknown",
    "var",
    "void",
    "while",
    "with",
    "yield",
];

/// What every object inherits, and what the language calls by itself.
const RESERVED_PROPERTIES: &[&str] = &[
    "__proto__",
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "then",
    "toJSON",
    "toLocaleString",
    "toString",
    "valueOf",
];

macro_rules! line {
    ($out:expr, $($format:tt)*) => {{
        let _ = writeln!($out, $($format)*);
    }};
}

fn quote(text: &[u8]) -> String {
    format_json_string_utf8(text, Default::default()).to_string()
}

fn property_names() -> BTreeSet<String> {
    RESERVED_PROPERTIES
        .iter()
        .map(|&it| it.to_owned())
        .collect()
}

/// `ToJsonName` in protobuf's descriptor.cc.
fn camel_case(name: &str) -> String {
    let mut result = String::with_capacity(name.len());
    let mut follows_underscore = false;
    for character in name.chars() {
        if character == '_' {
            follows_underscore = true;
            continue;
        }
        result.push(match follows_underscore {
            true => character.to_ascii_uppercase(),
            false => character,
        });
        follows_underscore = false;
    }
    match result.starts_with(|first: char| first.is_ascii_alphabetic()) {
        true => result,
        false => name.to_owned(),
    }
}

fn write_doc(out: &mut String, indent: &str, doc: &Doc) {
    if doc.lines.is_empty() && !doc.is_deprecated {
        return;
    }
    line!(out, "{indent}/**");
    for text in &doc.lines {
        let escaped = strings::replace_owned(text.as_bytes(), b"*/", b"*\\/");
        let escaped = core::str::from_utf8(&escaped).expect("ASCII was inserted into UTF-8");
        let space = if escaped.starts_with(' ') { "" } else { " " };
        line!(out, "{indent} *{space}{escaped}");
    }
    if doc.is_deprecated {
        line!(out, "{indent} * @deprecated");
    }
    line!(out, "{indent} */");
}

#[derive(Clone, Copy)]
enum WireType {
    Varint = 0,
    Fixed64 = 1,
    Length = 2,
    StartGroup = 3,
    EndGroup = 4,
    Fixed32 = 5,
}

fn tag(number: u32, wire_type: WireType) -> u32 {
    number << 3 | wire_type as u32
}

/// As `$readTag` returns it.
fn read_tag(number: u32, wire_type: WireType) -> i32 {
    tag(number, wire_type).cast_signed()
}

impl Scalar {
    fn wire_type(self) -> WireType {
        match self {
            Scalar::Double | Scalar::Fixed64 | Scalar::Sfixed64 => WireType::Fixed64,
            Scalar::Float | Scalar::Fixed32 | Scalar::Sfixed32 => WireType::Fixed32,
            Scalar::String | Scalar::Bytes => WireType::Length,
            _ => WireType::Varint,
        }
    }

    /// What follows `$read` and `$write` in wire.ts.
    fn helper_suffix(self) -> &'static str {
        match self {
            Scalar::Double => "Double",
            Scalar::Float => "Float",
            Scalar::Int32 => "Int32",
            Scalar::Int64 => "Int64",
            Scalar::Uint32 => "Uint32",
            Scalar::Uint64 => "Uint64",
            Scalar::Sint32 => "Sint32",
            Scalar::Sint64 => "Sint64",
            Scalar::Fixed32 => "Fixed32",
            Scalar::Fixed64 => "Fixed64",
            Scalar::Sfixed32 => "Sfixed32",
            Scalar::Sfixed64 => "Sfixed64",
            Scalar::Bool => "Bool",
            Scalar::String => "String",
            Scalar::Bytes => "Bytes",
        }
    }

    fn integer_range(self) -> Option<(i128, i128)> {
        Some(match self {
            Scalar::Int32 | Scalar::Sint32 | Scalar::Sfixed32 => (i32::MIN.into(), i32::MAX.into()),
            Scalar::Uint32 | Scalar::Fixed32 => (0, u32::MAX.into()),
            Scalar::Int64 | Scalar::Sint64 | Scalar::Sfixed64 => (i64::MIN.into(), i64::MAX.into()),
            Scalar::Uint64 | Scalar::Fixed64 => (0, u64::MAX.into()),
            _ => return None,
        })
    }

    fn is_bigint(self) -> bool {
        (self.integer_range()).is_some_and(|(_, most)| most > i128::from(u32::MAX))
    }
}

enum Kind<'a> {
    Scalar(Scalar),
    Enum {
        local: String,
        declaration: &'a Enum,
        is_closed: bool,
    },
    Message {
        local: String,
        prefix: String,
        is_delimited: bool,
    },
}

impl Kind<'_> {
    fn wire_type(&self) -> WireType {
        match self {
            Kind::Scalar(scalar) => scalar.wire_type(),
            Kind::Enum { .. } => WireType::Varint,
            Kind::Message { is_delimited, .. } => match is_delimited {
                true => WireType::StartGroup,
                false => WireType::Length,
            },
        }
    }

    fn is_packable(&self) -> bool {
        !matches!(self.wire_type(), WireType::Length | WireType::StartGroup)
    }

    fn decoded_type(&self) -> &str {
        match self {
            Kind::Scalar(Scalar::Bool) => "boolean",
            Kind::Scalar(Scalar::String) => "string",
            Kind::Scalar(Scalar::Bytes) => "Uint8Array<ArrayBuffer>",
            Kind::Scalar(scalar) if scalar.is_bigint() => "bigint",
            Kind::Scalar(_) => "number",
            Kind::Enum { local, .. } | Kind::Message { local, .. } => local,
        }
    }

    fn init_type(&self) -> String {
        match self {
            Kind::Scalar(Scalar::Bytes) => "Uint8Array".to_owned(),
            Kind::Scalar(scalar) if scalar.is_bigint() => "bigint | number".to_owned(),
            Kind::Message { local, .. } => format!("{local}.Init"),
            _ => self.decoded_type().to_owned(),
        }
    }

    fn zero(&self) -> String {
        match self {
            Kind::Scalar(Scalar::Bool) => "false".to_owned(),
            Kind::Scalar(Scalar::String) => "\"\"".to_owned(),
            Kind::Scalar(Scalar::Bytes) => "$noBytes".to_owned(),
            Kind::Scalar(scalar) if scalar.is_bigint() => "0n".to_owned(),
            Kind::Scalar(_) => "0".to_owned(),
            Kind::Enum { declaration, .. } => declaration.values[0].number.to_string(),
            Kind::Message { .. } => "undefined".to_owned(),
        }
    }

    fn differs_from_zero(&self, value: &str) -> String {
        match self {
            Kind::Scalar(Scalar::Bytes) => format!("{value}.length !== 0"),
            Kind::Scalar(Scalar::Double | Scalar::Float) => format!("!Object.is({value}, 0)"),
            Kind::Scalar(scalar) if scalar.is_bigint() => {
                format!("{value} !== 0n && {value} !== 0")
            }
            // The compiler refuses to compare where an enum has one value.
            Kind::Enum { .. } => format!("({value} as number) !== 0"),
            _ => format!("{value} !== {}", self.zero()),
        }
    }

    /// A condition on `value`, if a number can be none of the values of this type.
    fn is_known(&self, value: &str) -> Option<String> {
        let Kind::Enum {
            declaration,
            is_closed: true,
            ..
        } = self
        else {
            return None;
        };
        let numbers = declaration.values.iter().map(|it| i64::from(it.number));
        let mut numbers: Vec<i64> = numbers.collect();
        numbers.sort_unstable();
        let mut runs: Vec<(i64, i64)> = Vec::new();
        for number in numbers {
            match runs.last_mut() {
                Some((_, last)) if number <= *last + 1 => *last = number,
                _ => runs.push((number, number)),
            }
        }
        let tests = runs.iter().map(|(first, last)| match first == last {
            true => format!("{value} === {first}"),
            false => format!("({value} >= {first} && {value} <= {last})"),
        });
        Some(tests.collect::<Vec<_>>().join(" || "))
    }
}

struct ResolvedField<'a> {
    field: &'a Field,
    property: String,
    kind: Kind<'a>,
    presence: Presence,
    is_packed: bool,
    verifies_utf8: bool,
    default: Option<String>,
}

fn write_value(kind: &Kind<'_>, number: u32, value: &str) -> String {
    let start = format!("$tag($w, {});", tag(number, kind.wire_type()));
    match kind {
        Kind::Scalar(scalar) => format!("{start} $write{}($w, {value});", scalar.helper_suffix()),
        Kind::Enum { .. } => format!("{start} $writeInt32($w, {value});"),
        Kind::Message {
            prefix,
            is_delimited: true,
            ..
        } => {
            let end = tag(number, WireType::EndGroup);
            format!("{start} {prefix}$write($w, {value}); $tag($w, {end});")
        }
        Kind::Message { prefix, .. } => format!(
            "{start} const $start = $fork($w); {prefix}$write($w, {value}); $join($w, $start, 1);"
        ),
    }
}

fn read_scalar(scalar: Scalar, verifies_utf8: bool) -> String {
    match scalar == Scalar::String && !verifies_utf8 {
        true => "$readLooseString($r)".to_owned(),
        false => format!("$read{}($r)", scalar.helper_suffix()),
    }
}

impl ResolvedField<'_> {
    /// `existing` is the message that a second occurrence of the field is merged into.
    fn read_value(&self, end: &str, existing: &str) -> String {
        match &self.kind {
            Kind::Scalar(scalar) => read_scalar(*scalar, self.verifies_utf8),
            Kind::Enum { local, .. } => format!("$readInt32($r) as {local}"),
            Kind::Message {
                prefix,
                is_delimited: true,
                ..
            } => {
                let end_tag = read_tag(self.field.number, WireType::EndGroup);
                format!("{prefix}$read($r, {end}, {end_tag}, {existing})")
            }
            Kind::Message { prefix, .. } => {
                format!("{prefix}$read($r, $readEnd($r), -1, {existing})")
            }
        }
    }

    /// `store` receives an expression for the value.
    fn read_and_store(&self, existing: &str, store: impl Fn(&str) -> String) -> String {
        match self.kind.is_known("$value") {
            None => store(&self.read_value("$end", existing)),
            Some(is_known) => format!(
                "const $value = $readInt32($r); if ({is_known}) {}",
                store(&format!("$value as {}", self.kind.decoded_type()))
            ),
        }
    }

    fn decoded_type(&self) -> String {
        let element = self.kind.decoded_type();
        match self.field.cardinality {
            Cardinality::Repeated => format!("{element}[]"),
            Cardinality::Map { .. } => format!("{{ [key: string]: {element} }}"),
            Cardinality::Single => match self.presence {
                Presence::Explicit if self.default.is_none() => format!("{element} | undefined"),
                _ => element.to_owned(),
            },
        }
    }

    fn init_type(&self) -> String {
        let element = self.kind.init_type();
        match self.field.cardinality {
            Cardinality::Repeated => format!("readonly ({element})[]"),
            Cardinality::Map { .. } => format!("{{ readonly [key: string]: {element} }}"),
            Cardinality::Single => element,
        }
    }

    fn initial_value(&self) -> String {
        match self.field.cardinality {
            Cardinality::Repeated => "[]".to_owned(),
            Cardinality::Map { .. } => "Object.create(null)".to_owned(),
            Cardinality::Single => match self.presence {
                Presence::Implicit => self.kind.zero(),
                Presence::Required => "undefined!".to_owned(),
                Presence::Explicit => (self.default.as_deref().unwrap_or("undefined")).to_owned(),
            },
        }
    }

    fn write_statement(&self, full_name: &str) -> String {
        let (kind, number) = (&self.kind, self.field.number);
        let load = format!("const $value = $m.{};", self.property);
        match self.field.cardinality {
            Cardinality::Single => {
                let write = write_value(kind, number, "$value");
                match self.presence {
                    Presence::Explicit => format!("{load} if ($value != null) {{ {write} }}"),
                    Presence::Implicit => {
                        let differs = kind.differs_from_zero("$value");
                        format!("{load} if ($value != null && {differs}) {{ {write} }}")
                    }
                    Presence::Required => {
                        let name = quote(qualify(full_name, &self.field.name.text).as_bytes());
                        format!("{load} if ($value == null) throw $missingField({name}); {write}")
                    }
                }
            }
            Cardinality::Repeated if self.is_packed => {
                let suffix = match kind {
                    Kind::Scalar(scalar) => scalar.helper_suffix(),
                    _ => "Int32",
                };
                format!(
                    "{load} if ($value != null && $lengthOf($value) !== 0) {{ $tag($w, {}); const $start = $fork($w); \
                     for (let $i = 0; $i < $value.length; $i++) {{ $reserve($w, 10); $write{suffix}($w, $value[$i]!); }} \
                     $join($w, $start, 1); }}",
                    tag(number, WireType::Length),
                )
            }
            Cardinality::Repeated => format!(
                "{load} if ($value != null && $lengthOf($value) !== 0) for (let $i = 0; $i < $value.length; $i++) {{ {} }}",
                write_value(kind, number, "$value[$i]!"),
            ),
            Cardinality::Map { key } => {
                let parsed_key = match key {
                    Scalar::String => "$key",
                    Scalar::Bool => "$boolKey($key)",
                    _ if key.is_bigint() => "$int64Key($key)",
                    _ => "$int32Key($key)",
                };
                format!(
                    "{load} if ($value != null) for (const $key of $keysOf($value)) {{ $tag($w, {}); \
                     const $entry = $fork($w); {} {} $join($w, $entry, 1); }}",
                    tag(number, WireType::Length),
                    write_value(&Kind::Scalar(key), 1, parsed_key),
                    write_value(kind, 2, "$value[$key]!"),
                )
            }
        }
    }

    fn write_read_cases(&self, out: &mut String, oneof_property: Option<&str>) {
        let (kind, number, property) = (&self.kind, self.field.number, &self.property);
        let mut case = |wire_type: WireType, body: String| {
            let tag = read_tag(number, wire_type);
            line!(out, "      case {tag}: {{ {body} continue; }}");
        };
        match self.field.cardinality {
            Cardinality::Single => case(
                kind.wire_type(),
                match oneof_property {
                    None => self.read_and_store(&format!("$m.{property}"), |value| {
                        format!("$m.{property} = {value};")
                    }),
                    Some(oneof) => {
                        let existing = format!(
                            "$m.{oneof}?.case === \"{property}\" ? $m.{oneof}.value : undefined"
                        );
                        self.read_and_store(&existing, |value| {
                            format!("$m.{oneof} = {{ case: \"{property}\", value: {value} }};")
                        })
                    }
                },
            ),
            Cardinality::Repeated => {
                let push = |value: &str| format!("$m.{property}.push({value});");
                let element = self.read_and_store("undefined", push);
                if kind.is_packable() {
                    case(
                        WireType::Length,
                        format!(
                            "const $packedEnd = $readEnd($r); while ($r.pos < $packedEnd) {{ {element} }} \
                             $expectEnd($r, $packedEnd);"
                        ),
                    );
                }
                case(kind.wire_type(), element);
            }
            Cardinality::Map { key } => {
                let key_kind = Kind::Scalar(key);
                let (value_type, value) = match kind {
                    Kind::Message { local, prefix, .. } => (
                        format!("{local} | undefined"),
                        format!("$value ?? {prefix}$read($r, $entryEnd, -1, undefined)"),
                    ),
                    _ => (kind.decoded_type().to_owned(), "$value".to_owned()),
                };
                let key_text = if key == Scalar::String {
                    "$key"
                } else {
                    "String($key)"
                };
                let condition = kind.is_known("($value as number)");
                let condition = condition.map_or_else(String::new, |it| format!("if ({it}) "));
                case(
                    WireType::Length,
                    format!(
                        "const $entryEnd = $readEnd($r); let $key: {} = {}; let $value: {value_type} = {}; \
                         while ($r.pos < $entryEnd) {{ const $entryTag = $readTag($r); \
                         if ($entryTag === {}) $key = {}; else if ($entryTag === {}) $value = {}; \
                         else $skip($r, $entryTag); }} \
                         $expectEnd($r, $entryEnd); {condition}$m.{property}[{key_text}] = {value};",
                        key_kind.decoded_type(),
                        key_kind.zero(),
                        kind.zero(),
                        read_tag(1, key.wire_type()),
                        read_scalar(key, self.verifies_utf8),
                        read_tag(2, kind.wire_type()),
                        self.read_value("$entryEnd", "$value"),
                    ),
                );
            }
        }
    }
}

fn default_value(kind: &Kind<'_>, constant: &Constant) -> Result<String, Failure> {
    let sign = if constant.is_negative { "-" } else { "" };
    let text = match (kind, &constant.value) {
        (Kind::Scalar(Scalar::Bool), _) => Some(bool_of(constant)?.to_string()),
        (Kind::Scalar(scalar @ (Scalar::Double | Scalar::Float)), value) => {
            let magnitude = match value {
                ConstantValue::Integer(value) => Some(*value as f64),
                ConstantValue::Float(value) => Some(*value),
                ConstantValue::Identifier(name) if name == "inf" => Some(f64::INFINITY),
                ConstantValue::Identifier(name) if name == "nan" => Some(f64::NAN),
                _ => None,
            };
            let magnitude = magnitude.map(|value| match scalar {
                Scalar::Float => f64::from(value as f32),
                _ => value,
            });
            magnitude.map(|value| match value.is_infinite() {
                true => format!("{sign}Infinity"),
                false => format!("{sign}{value:?}"),
            })
        }
        (Kind::Scalar(Scalar::String), ConstantValue::String(bytes)) => {
            core::str::from_utf8(bytes).is_ok().then(|| quote(bytes))
        }
        (Kind::Scalar(Scalar::Bytes), ConstantValue::String(bytes)) => {
            Some(format!("new Uint8Array({bytes:?})"))
        }
        (Kind::Scalar(scalar), ConstantValue::Integer(magnitude)) => {
            let value = i128::from(*magnitude) * if constant.is_negative { -1 } else { 1 };
            let suffix = if scalar.is_bigint() { "n" } else { "" };
            (scalar.integer_range())
                .filter(|&(least, most)| least <= value && value <= most)
                .map(|_| format!("{value}{suffix}"))
        }
        (Kind::Enum { declaration, .. }, ConstantValue::Identifier(name)) => {
            let mut values = declaration.values.iter();
            (values.find(|value| value.name.text == *name)).map(|value| value.number.to_string())
        }
        _ => None,
    };
    let message = "This default value does not match the type of the field";
    text.ok_or_else(|| Failure::new(constant.span, message))
}

#[derive(Default)]
struct Use {
    local: String,
    /// What `$read` and `$write` follow.
    prefix: String,
    as_type: bool,
    as_codec: bool,
    as_value: bool,
    in_call: bool,
    in_request_stream: bool,
}

struct ResolvedMethod<'a> {
    method: &'a Method,
    name: String,
    path: String,
    request: (String, String),
    response: (String, String),
}

#[derive(Default)]
struct ServiceParts {
    method_types: String,
    methods: String,
    client: String,
    server: String,
    route_types: String,
    routes: String,
}

impl ServiceParts {
    fn add(&mut self, resolved: &ResolvedMethod<'_>) {
        let ResolvedMethod {
            method,
            name,
            path,
            request: (request, request_prefix),
            response: (response, response_prefix),
        } = resolved;
        let (request_stream, response_stream) = (method.streams_requests, method.streams_responses);
        line!(
            self.method_types,
            "    readonly {name}: {{ readonly path: {path}; readonly request: typeof {request}; readonly response: typeof {response}; \
             readonly requestStream: {request_stream}; readonly responseStream: {response_stream} }};"
        );
        line!(
            self.methods,
            "    {name}: {{ path: {path}, request: {request}, response: {response}, \
             requestStream: {request_stream}, responseStream: {response_stream} }},"
        );

        let (to_send, send, received, receive) = match request_stream {
            true => (
                format!("requests: $grpc.Messages<{request}.Init>"),
                format!("{{ messages: requests, frame: {request_prefix}$frame }}"),
                format!("requests: AsyncGenerator<{request}, void, void>"),
                "allReceived",
            ),
            false => (
                format!("request: {request}.Init"),
                format!("{request_prefix}$frame(request)"),
                format!("request: {request}"),
                "received",
            ),
        };
        write_doc(&mut self.client, "  ", &method.doc);
        match response_stream {
            true => line!(
                self.client,
                "  async *{name}({to_send}, options?: $grpc.CallOptions): AsyncGenerator<{response}, void, void> {{ \
                 for await (const $bytes of this.#channel.stream({path}, {send}, options)) yield {response_prefix}$received($bytes); }}"
            ),
            false => line!(
                self.client,
                "  async {name}({to_send}, options?: $grpc.CallOptions): Promise<{response}> {{ \
                 return {response_prefix}$received(await this.#channel.call({path}, {send}, options)); }}"
            ),
        }

        let answer = match response_stream {
            true => format!("$grpc.Messages<{response}.Init>"),
            false => format!("{response}.Init"),
        };
        write_doc(&mut self.server, "    ", &method.doc);
        line!(
            self.server,
            "    {name}?({received}, context: $grpc.CallContext): {answer} | Promise<{answer}>;"
        );
        line!(self.route_types, "    {path}: $grpc.Route;");
        line!(
            self.routes,
            "    {path}: $grpc.route({request_stream}, {response_stream}, server.{name} === undefined ? undefined : \
             ($request, $context) => server.{name}!({request_prefix}${receive}($request), $context), \
             {response_prefix}$frame, options),"
        );
    }
}

struct Emitter<'p, 'a> {
    program: &'p Program<'a>,
    target: Target,
    identifiers: BTreeSet<String>,
    /// By index in `program.symbols`.
    uses: BTreeMap<usize, Use>,
    /// Symbols of well-known files that are used and not written yet.
    pending: Vec<usize>,
    helpers: BTreeSet<&'static str>,
    out: String,
}

fn helper_declarations() -> impl Iterator<Item = (&'static str, &'static str)> {
    strings::split(WIRE_HELPERS.as_bytes(), b"\n\n").filter_map(|block| {
        let text = core::str::from_utf8(block).expect("split at ASCII");
        let code = match text.starts_with("//") {
            true => &text[strings::index_of_char_usize(block, b'\n')? + 1..],
            false => text,
        };
        Some((dollar_names(code).next()?, code))
    })
}

fn dollar_names(code: &str) -> impl Iterator<Item = &str> {
    let bytes = code.as_bytes();
    let mut position = 0;
    core::iter::from_fn(move || {
        loop {
            let start = position + strings::index_of_char_usize(&bytes[position..], b'$')?;
            let rest = bytes[start + 1..].iter();
            position = start + 1 + rest.take_while(|it| it.is_ascii_alphanumeric()).count();
            let continues_name = start > 0
                && matches!(bytes[start - 1], b'$' | b'_' | b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z');
            if !continues_name {
                return Some(&code[start..position]);
            }
        }
    })
}

impl<'p, 'a> Emitter<'p, 'a> {
    fn symbol(&self, index: usize) -> &'p Symbol<'a> {
        &self.program.symbols[index]
    }

    fn use_of(&mut self, index: usize) -> &mut Use {
        let symbol = self.symbol(index);
        self.uses.entry(index).or_insert_with(|| {
            if let Origin::WellKnown(_) = self.program.files[symbol.file].origin {
                self.pending.push(index);
            }
            let local = take_unique(&mut self.identifiers, symbol.export_name.clone());
            Use {
                prefix: match symbol.file {
                    ROOT => symbol.export_name.clone(),
                    _ => local.clone(),
                },
                local,
                ..Default::default()
            }
        })
    }

    /// Text that has no string or comment of the schema in it.
    fn code(&mut self, code: &str) {
        let names: BTreeSet<&str> = dollar_names(code).collect();
        let used = helper_declarations().filter(|(name, _)| names.contains(name));
        self.helpers.extend(used.map(|(name, _)| name));
        self.out.push_str(code);
    }

    fn resolve_field(
        &mut self,
        owner: &Symbol<'a>,
        message: &'a Message,
        field: &'a Field,
        property: String,
    ) -> Result<ResolvedField<'a>, Error> {
        let inherited = match field.oneof {
            Some(oneof) => message.oneofs[oneof].features.inside(owner.features),
            None => owner.features,
        };
        let features = field.features.inside(inherited);
        let kind = match &field.r#type {
            FieldType::Scalar(scalar) => Kind::Scalar(*scalar),
            FieldType::Named(name) => {
                let index = self.program.resolve(owner.file, &owner.full_name, name)?;
                let symbol = self.symbol(index);
                let is_message = matches!(symbol.declaration, Declaration::Message(_));
                let used = self.use_of(index);
                used.as_type = true;
                used.as_codec |= is_message;
                let local = used.local.clone();
                match symbol.declaration {
                    Declaration::Message(_) => Kind::Message {
                        local,
                        prefix: used.prefix.clone(),
                        is_delimited: features.is_delimited == Some(true)
                            && !matches!(field.cardinality, Cardinality::Map { .. }),
                    },
                    Declaration::Enum(declaration) => Kind::Enum {
                        local,
                        declaration,
                        is_closed: symbol.features.is_enum_closed == Some(true),
                    },
                    Declaration::Service => {
                        let message = format!("\"{}\" is a service, not a type", name.text);
                        let failure = Failure::new(name.span, message);
                        return Err(self.program.error(owner.file, failure));
                    }
                }
            }
        };
        let presence = match (features.presence, &kind) {
            (Some(Presence::Required), _) => Presence::Required,
            (Some(Presence::Implicit), Kind::Scalar(_) | Kind::Enum { .. }) => Presence::Implicit,
            _ => Presence::Explicit,
        };
        if let Kind::Enum { is_closed, .. } = kind
            && is_closed
            && presence == Presence::Implicit
            && field.oneof.is_none()
            && matches!(field.cardinality, Cardinality::Single)
        {
            let message = "A field of a closed enum must track presence. Mark it \"optional\"";
            let failure = Failure::new(field.name.span, message);
            return Err(self.program.error(owner.file, failure));
        }
        let default = field.default.as_ref().map(|it| default_value(&kind, it));
        Ok(ResolvedField {
            field,
            property,
            presence,
            is_packed: features.is_packed == Some(true) && kind.is_packable(),
            verifies_utf8: features.verifies_utf8 == Some(true),
            default: (default.transpose()).map_err(|it| self.program.error(owner.file, it))?,
            kind,
        })
    }

    fn export_keyword(&self, index: usize) -> &'static str {
        let symbol = self.symbol(index);
        match symbol.file == ROOT && self.uses[&index].local == symbol.export_name {
            true => "export ",
            false => "",
        }
    }

    fn export_if_renamed(&mut self, index: usize) {
        let (symbol, local) = (self.symbol(index), &self.uses[&index].local);
        if symbol.file == ROOT && *local != symbol.export_name {
            line!(self.out, "export {{ {local} as {} }};", symbol.export_name);
        }
    }

    fn r#enum(&mut self, index: usize, declaration: &Enum) -> Result<(), Error> {
        let symbol = self.symbol(index);
        let first = &declaration.values[0];
        if first.number != 0 && symbol.features.is_enum_closed != Some(true) {
            let message = "The first value of an open enum must be 0";
            let failure = Failure::new(first.name.span, message);
            return Err(self.program.error(symbol.file, failure));
        }
        let local = self.use_of(index).local.clone();
        let export = self.export_keyword(index);
        let numbers: BTreeSet<i32> = declaration.values.iter().map(|it| it.number).collect();
        let numbers: Vec<String> = numbers.iter().map(i32::to_string).collect();
        write_doc(&mut self.out, "", &declaration.doc);
        line!(self.out, "{export}type {local} = {};", numbers.join(" | "));
        if symbol.file == ROOT {
            write_doc(&mut self.out, "", &declaration.doc);
            line!(self.out, "{export}const {local} = {{");
            let mut names = property_names();
            for value in &declaration.values {
                write_doc(&mut self.out, "  ", &value.doc);
                let name = take_unique(&mut names, value.name.text.clone());
                line!(self.out, "  {name}: {},", value.number);
            }
            line!(self.out, "}} as const;");
        }
        Ok(())
    }

    fn message(&mut self, index: usize, message: &'a Message) -> Result<(), Error> {
        let symbol = self.symbol(index);
        let mut names = property_names();
        let mut fields = Vec::with_capacity(message.fields.len());
        for field in &message.fields {
            let property = take_unique(&mut names, camel_case(&field.name.text));
            fields.push(self.resolve_field(symbol, message, field, property)?);
        }
        let oneofs: Vec<String> = (message.oneofs.iter())
            .map(|oneof| take_unique(&mut names, camel_case(&oneof.name.text)))
            .collect();
        let used = self.use_of(index);
        let (local, prefix) = (used.local.clone(), used.prefix.clone());
        let export = self.export_keyword(index);

        let mut decoded = String::new();
        let mut init = String::new();
        let mut initial_values = Vec::new();
        for it in fields.iter().filter(|it| it.field.oneof.is_none()) {
            let (property, init_type) = (&it.property, it.init_type());
            write_doc(&mut decoded, "  ", &it.field.doc);
            line!(decoded, "  {property}: {};", it.decoded_type());
            write_doc(&mut init, "    ", &it.field.doc);
            match (&it.field.cardinality, it.presence) {
                (Cardinality::Single, Presence::Required) => {
                    line!(init, "    {property}: {init_type};")
                }
                _ => line!(init, "    {property}?: {init_type} | undefined;"),
            }
            initial_values.push(format!("{property}: {}", it.initial_value()));
        }
        for (oneof, property) in oneofs.iter().enumerate() {
            write_doc(&mut decoded, "  ", &message.oneofs[oneof].doc);
            line!(decoded, "  {property}:");
            write_doc(&mut init, "    ", &message.oneofs[oneof].doc);
            line!(init, "    {property}?:");
            for it in fields.iter().filter(|it| it.field.oneof == Some(oneof)) {
                let (case, kind) = (&it.property, &it.kind);
                let (decoded_type, init_type) = (kind.decoded_type(), kind.init_type());
                line!(
                    decoded,
                    "    | {{ case: \"{case}\"; value: {decoded_type} }}"
                );
                line!(init, "      | {{ case: \"{case}\"; value: {init_type} }}");
            }
            line!(decoded, "    | undefined;");
            line!(init, "      | undefined;");
            initial_values.push(format!("{property}: undefined"));
        }
        write_doc(&mut self.out, "", &message.doc);
        line!(self.out, "{export}interface {local} {{\n{decoded}}}");
        line!(self.out, "{export}declare namespace {local} {{");
        line!(self.out, "  interface Init {{\n{init}  }}\n}}");

        fields.sort_unstable_by_key(|it| it.field.number);
        let export = if symbol.file == ROOT { "export " } else { "" };
        // `noUnusedParameters` lets a name that starts with `_` pass.
        let unused = if fields.is_empty() { "_" } else { "" };
        let mut code = String::new();
        line!(
            code,
            "{export}function {prefix}$write({unused}$w: $Writer, $m: {local}.Init): void {{"
        );
        line!(code, "  $expectMessage($m);");
        for (oneof, property) in oneofs.iter().enumerate() {
            line!(code, "  const $oneof{oneof} = $m.{property};");
            line!(code, "  let $isUnknown{oneof} = $oneof{oneof} != null;");
        }
        for it in &fields {
            let Some(oneof) = it.field.oneof else {
                line!(code, "  {{ {} }}", it.write_statement(&symbol.full_name));
                continue;
            };
            line!(
                code,
                "  if ($oneof{oneof}?.case === \"{}\") {{ $isUnknown{oneof} = false; {} }}",
                it.property,
                write_value(&it.kind, it.field.number, &format!("$oneof{oneof}.value")),
            );
        }
        for (oneof, declaration) in message.oneofs.iter().enumerate() {
            line!(
                code,
                "  if ($isUnknown{oneof}) throw $invalidValue(\"a case of {}.{}\", $oneof{oneof}!.case);",
                symbol.full_name,
                declaration.name.text,
            );
        }
        line!(code, "}}");
        line!(
            code,
            "{export}function {prefix}$read($r: $Reader, $end: number, $endGroup: number, $existing: {local} | undefined): {local} {{"
        );
        line!(code, "  $enter($r);");
        self.code(&code);
        if fields.iter().any(|it| it.initial_value() == "$noBytes") {
            self.helpers.insert("$noBytes");
        }
        let initial_values = initial_values.join(", ");
        line!(
            self.out,
            "  const $m: {local} = $existing ?? {{ {initial_values} }};"
        );

        code.clear();
        line!(code, "  while ($r.pos < $end) {{");
        line!(code, "    const $fieldTag = $readTag($r);");
        if !fields.is_empty() {
            line!(code, "    switch ($fieldTag) {{");
            for it in &fields {
                let oneof = it.field.oneof.map(|oneof| oneofs[oneof].as_str());
                it.write_read_cases(&mut code, oneof);
            }
            line!(code, "    }}");
        }
        line!(
            code,
            "    if ($fieldTag === $endGroup && $endGroup !== -1) {{ $endGroup = -1; $end = $r.pos; break; }}"
        );
        line!(code, "    $skip($r, $fieldTag);\n  }}");
        line!(code, "  $leave($r, $end, $endGroup);");
        for it in &fields {
            if let (Cardinality::Single, Presence::Required, None) =
                (&it.field.cardinality, it.presence, it.field.oneof)
            {
                line!(
                    code,
                    "  if ($m.{} === undefined) throw $malformed(\"missing required field {}.{}\");",
                    it.property,
                    symbol.full_name,
                    it.field.name.text,
                );
            }
        }
        line!(code, "  return $m;\n}}");
        self.code(&code);
        Ok(())
    }

    fn message_value(&mut self, index: usize, message: &Message) {
        let Use { local, prefix, .. } = &self.uses[&index];
        let code = format!(
            "{}const {local} = {{\n  \
             typeName: \"{}\",\n  \
             encode($m: {local}.Init): Uint8Array<ArrayBuffer> {{ const $w = $writer(); {prefix}$write($w, $m); return $finish($w); }},\n  \
             decode($bytes: Uint8Array): {local} {{ const $r = $reader($bytes); return {prefix}$read($r, $r.buf.length, -1, undefined); }},\n\
             }} as const;\n",
            self.export_keyword(index),
            self.symbol(index).full_name,
        );
        write_doc(&mut self.out, "", &message.doc);
        self.code(&code);
    }

    /// Its local name and its prefix.
    fn message_of_method(
        &mut self,
        scope: &str,
        name: &Name,
        is_request_stream: bool,
    ) -> Result<(String, String), Error> {
        let index = self.program.resolve(ROOT, scope, name)?;
        if !matches!(self.symbol(index).declaration, Declaration::Message(_)) {
            let message = format!("\"{}\" is not a message", name.text);
            return Err(self.program.error(ROOT, Failure::new(name.span, message)));
        }
        let target = self.target;
        let used = self.use_of(index);
        used.as_value = true;
        if target == Target::Bun {
            used.as_codec = true;
            used.in_call = true;
            used.in_request_stream |= is_request_stream;
        }
        Ok((used.local.clone(), used.prefix.clone()))
    }

    /// Between messages and the bytes that `bun:grpc` sends and receives.
    fn framing(&mut self) {
        let mut code = String::new();
        for used in self.uses.values().filter(|it| it.in_call) {
            let Use { local, prefix, .. } = used;
            line!(
                code,
                "function {prefix}$frame($m: {local}.Init): Uint8Array<ArrayBuffer> {{ \
                 const $w = $framer(); {prefix}$write($w, $m); return $finishFrame($w); }}"
            );
            line!(
                code,
                "function {prefix}$received($bytes: Uint8Array): {local} {{ \
                 try {{ const $r = $reader($bytes); return {prefix}$read($r, $r.buf.length, -1, undefined); }} \
                 catch ($cause) {{ throw new $grpc.GrpcError(13, ($cause as RangeError).message, {{ cause: $cause }}); }} }}"
            );
            if used.in_request_stream {
                line!(
                    code,
                    "async function* {prefix}$allReceived($stream: AsyncGenerator<Uint8Array, void, void>): AsyncGenerator<{local}, void, void> {{ \
                     for await (const $bytes of $stream) yield {prefix}$received($bytes); }}"
                );
            }
        }
        self.code(&code);
    }

    fn service(&mut self, index: usize, service: &Service) -> Result<String, Error> {
        let full_name = &self.symbol(index).full_name;
        let mut parts = ServiceParts::default();
        let mut names = property_names();
        for method in &service.methods {
            let mut name = camel_case(&method.name.text);
            name[..1].make_ascii_lowercase();
            let (request, response) = (&method.request, &method.response);
            parts.add(&ResolvedMethod {
                method,
                name: take_unique(&mut names, name),
                path: format!("\"/{full_name}/{}\"", method.name.text),
                request: self.message_of_method(full_name, request, method.streams_requests)?,
                response: self.message_of_method(full_name, response, false)?,
            });
        }
        let (export, Use { local, prefix, .. }) = (self.export_keyword(index), &self.uses[&index]);
        let mut out = String::new();
        let (types, values) = match self.target {
            Target::Bun => {
                line!(out, "class {prefix}$Client {{");
                line!(out, "  #channel: $grpc.Channel;");
                line!(
                    out,
                    "  constructor(url: string | URL, options?: $grpc.ClientOptions) {{ this.#channel = new $grpc.Channel(url, options); }}"
                );
                line!(out, "{}}}", parts.client);
                line!(
                    out,
                    "function {prefix}$routes(server: {local}.Server, options?: $grpc.RoutesOptions): {local}.Routes {{"
                );
                line!(out, "  return {{\n{}  }};\n}}", parts.routes);
                line!(out, "{export}declare namespace {local} {{");
                line!(out, "  type Client = {prefix}$Client;");
                line!(out, "  interface Server {{\n{}  }}", parts.server);
                line!(out, "  type Routes = {{\n{}  }};\n}}", parts.route_types);
                (
                    format!(
                        "readonly Client: typeof {prefix}$Client;\n  readonly routes: typeof {prefix}$routes;"
                    ),
                    format!("Client: {prefix}$Client,\n  routes: {prefix}$routes,"),
                )
            }
            Target::Other => {
                let getter = |name: &str| {
                    format!(
                        "get {name}(): never {{ throw new Error(\"{full_name}.{name} requires --target=bun\"); }},"
                    )
                };
                (
                    "readonly Client: never;\n  readonly routes: never;".to_owned(),
                    format!("{}\n  {}", getter("Client"), getter("routes")),
                )
            }
        };
        write_doc(&mut out, "", &service.doc);
        line!(out, "{export}const {local}: {{");
        line!(out, "  readonly typeName: \"{full_name}\";");
        line!(out, "  readonly methods: {{\n{}  }};", parts.method_types);
        line!(out, "  {types}");
        line!(out, "}} = {{\n  typeName: \"{full_name}\",");
        line!(out, "  methods: {{\n{}  }},", parts.methods);
        line!(out, "  {values}\n}};");
        Ok(out)
    }

    fn declaration(&mut self, index: usize) -> Result<(), Error> {
        match self.symbol(index).declaration {
            Declaration::Message(message) => self.message(index, message),
            Declaration::Enum(declaration) => self.r#enum(index, declaration),
            Declaration::Service => Ok(()),
        }
    }

    fn imports(&self, options: &Options<'_>) -> String {
        let source_of = |file: usize| {
            let specifier = quote(&self.program.specifier_of(file)?);
            Some(match &self.program.files[file].origin {
                Origin::Disk(path) if !(options.is_schema_by_name)(path) => {
                    format!("{specifier} with {{ type: \"proto\" }}")
                }
                _ => specifier,
            })
        };
        let mut by_file: BTreeMap<usize, Vec<String>> = BTreeMap::new();
        for (&index, used) in &self.uses {
            let symbol = self.symbol(index);
            let (names, export) = (by_file.entry(symbol.file).or_default(), &symbol.export_name);
            let only_type = if used.as_value { "" } else { "type " };
            names.push(format!("{only_type}{export} as {}", used.local));
            if used.as_codec {
                names.push(format!("{export}$read as {}$read", used.prefix));
                names.push(format!("{export}$write as {}$write", used.prefix));
            }
        }
        by_file.remove(&ROOT);
        let mut out = String::new();
        if self.target == Target::Bun && !self.program.files[ROOT].schema.services.is_empty() {
            line!(out, "import * as $grpc from \"bun:grpc\";");
        }
        for (file, names) in by_file {
            if let Some(source) = source_of(file) {
                line!(out, "import {{ {} }} from {source};", names.join(", "));
                // An import of types alone is removed, and `--watch` would not see the file.
                line!(out, "import {source};");
            }
        }
        let of_file = |file| (self.program.symbols.iter()).filter(move |it| it.file == file);
        let mut exported: BTreeSet<&str> = of_file(ROOT).map(|it| &it.export_name[..]).collect();
        for file in self.program.public_imports() {
            let names = of_file(file).map(|it| &it.export_name[..]);
            let names: Vec<&str> = names.filter(|&name| exported.insert(name)).collect();
            if let Some(source) = source_of(file) {
                // `export ... from` drops its attributes.
                for name in &names {
                    line!(out, "import {{ {name} as $public${name} }} from {source};");
                    line!(out, "export {{ $public${name} as {name} }};");
                }
                line!(out, "import {source};");
            }
        }
        out
    }

    fn helpers(&self) -> String {
        let declarations: Vec<(&str, &str)> = helper_declarations().collect();
        let mut needed = self.helpers.clone();
        let mut pending: Vec<&str> = needed.iter().copied().collect();
        while let Some(name) = pending.pop() {
            if let Some((_, code)) = declarations.iter().find(|(it, _)| *it == name) {
                pending.extend(dollar_names(code).filter(|&it| needed.insert(it)));
            }
        }
        let mut out = String::new();
        for (_, code) in declarations.iter().filter(|(it, _)| needed.contains(it)) {
            line!(out, "{}", code.trim_end());
        }
        out
    }
}

pub(crate) fn emit(program: &Program<'_>, options: &Options<'_>) -> Result<String, Error> {
    let mut emitter = Emitter {
        program,
        target: options.target,
        identifiers: RESERVED_IDENTIFIERS
            .iter()
            .map(|&it| it.to_owned())
            .collect(),
        uses: BTreeMap::new(),
        pending: Vec::new(),
        helpers: BTreeSet::new(),
        out: String::new(),
    };
    let own_count = program.symbols.iter().take_while(|it| it.file == ROOT);
    let own = 0..own_count.count();
    for index in own.clone() {
        emitter.use_of(index).as_value = true;
    }
    let mut services = String::new();
    let mut service_schemas = program.files[ROOT].schema.services.iter();
    for index in own.clone() {
        emitter.declaration(index)?;
        if let Declaration::Service = program.symbols[index].declaration
            && let Some(service) = service_schemas.next()
        {
            services.push_str(&emitter.service(index, service)?);
        }
    }
    let mut written: Vec<usize> = own.clone().collect();
    while let Some(index) = emitter.pending.pop() {
        emitter.declaration(index)?;
        written.push(index);
    }
    for index in written {
        if let Declaration::Message(message) = program.symbols[index].declaration
            && emitter.uses[&index].as_value
        {
            emitter.message_value(index, message);
        }
    }
    emitter.framing();
    emitter.out.push_str(&services);
    own.for_each(|index| emitter.export_if_renamed(index));
    let (imports, helpers) = (emitter.imports(options), emitter.helpers());
    Ok(format!("{imports}{helpers}{}export {{}};\n", emitter.out))
}
