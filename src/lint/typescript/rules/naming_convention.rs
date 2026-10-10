use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::types::{NameOf, Type};
use bun_lint::utils::ts_scope::{UsedMarks, VariableAnalysis, collect_variables};
use bun_lint::utils::ts_utils::requires_quoting;
use std::cell::OnceCell;
use std::cmp::Reverse;

/// Enforce naming conventions for everything across a codebase.
pub struct NamingConvention {
    options: Vec<NormalizedOption>,
    /// By [`Selector`].
    validators: [Validator; Selector::COUNT],
}

const DOES_NOT_MATCH_FORMAT: Message = Message::new(
    "doesNotMatchFormat",
    "{{type}} name `{{name}}` must match one of the following formats: {{formats}}",
);
const DOES_NOT_MATCH_FORMAT_TRIMMED: Message = Message::new(
    "doesNotMatchFormatTrimmed",
    "{{type}} name `{{name}}` trimmed as `{{processedName}}` must match one of the following formats: {{formats}}",
);
const MISSING_AFFIX: Message = Message::new(
    "missingAffix",
    "{{type}} name `{{name}}` must have one of the following {{position}}es: {{affixes}}",
);
const MISSING_UNDERSCORE: Message = Message::new(
    "missingUnderscore",
    "{{type}} name `{{name}}` must have {{count}} {{position}} underscore(s).",
);
const SATISFY_CUSTOM: Message =
    Message::new("satisfyCustom", "{{type}} name `{{name}}` must {{regexMatch}} the RegExp: {{regex}}");
const UNEXPECTED_UNDERSCORE: Message = Message::new(
    "unexpectedUnderscore",
    "{{type}} name `{{name}}` must not have a {{position}} underscore.",
);

// ───────────────────────────── enums ─────────────────────────────

/// Upstream's `Selectors`: `1 << selector` is the value there.
#[derive(Copy, Clone, PartialEq, Eq)]
#[repr(u8)]
enum Selector {
    Variable,
    Function,
    Parameter,
    ParameterProperty,
    ClassicAccessor,
    EnumMember,
    ClassMethod,
    ObjectLiteralMethod,
    TypeMethod,
    ClassProperty,
    ObjectLiteralProperty,
    TypeProperty,
    AutoAccessor,
    Class,
    Interface,
    TypeAlias,
    Enum,
    TypeParameter,
    Import,
}

/// The name of each [`Selector`] in the options, and what `selectorTypeToMessageString` makes of it.
const SELECTORS: [(&str, &str); Selector::COUNT] = [
    ("variable", "Variable"),
    ("function", "Function"),
    ("parameter", "Parameter"),
    ("parameterProperty", "Parameter Property"),
    ("classicAccessor", "Classic Accessor"),
    ("enumMember", "Enum Member"),
    ("classMethod", "Class Method"),
    ("objectLiteralMethod", "Object Literal Method"),
    ("typeMethod", "Type Method"),
    ("classProperty", "Class Property"),
    ("objectLiteralProperty", "Object Literal Property"),
    ("typeProperty", "Type Property"),
    ("autoAccessor", "Auto Accessor"),
    ("class", "Class"),
    ("interface", "Interface"),
    ("typeAlias", "Type Alias"),
    ("enum", "Enum"),
    ("typeParameter", "Type Parameter"),
    ("import", "Import"),
];

impl Selector {
    const COUNT: usize = 19;

    const fn bit(self) -> i32 {
        1 << self as u8
    }

    fn message_string(self) -> &'static str {
        SELECTORS[self as usize].1
    }
}

const METHOD: i32 =
    Selector::ClassMethod.bit() | Selector::ObjectLiteralMethod.bit() | Selector::TypeMethod.bit();
const PROPERTY: i32 =
    Selector::ClassProperty.bit() | Selector::ObjectLiteralProperty.bit() | Selector::TypeProperty.bit();
const ACCESSOR: i32 = Selector::ClassicAccessor.bit() | Selector::AutoAccessor.bit();

/// Upstream's `MetaSelectors`.
const META_SELECTORS: [(&str, i32); 7] = [
    ("default", -1),
    (
        "variableLike",
        Selector::Variable.bit() | Selector::Function.bit() | Selector::Parameter.bit(),
    ),
    (
        "memberLike",
        PROPERTY | METHOD | ACCESSOR | Selector::ParameterProperty.bit() | Selector::EnumMember.bit(),
    ),
    (
        "typeLike",
        Selector::Class.bit()
            | Selector::Interface.bit()
            | Selector::TypeAlias.bit()
            | Selector::Enum.bit()
            | Selector::TypeParameter.bit(),
    ),
    ("method", METHOD),
    ("property", PROPERTY),
    ("accessor", ACCESSOR),
];

const SELECTORS_ALLOWED_TO_HAVE_TYPES: i32 = Selector::Variable.bit()
    | Selector::Parameter.bit()
    | PROPERTY
    | Selector::ParameterProperty.bit()
    | Selector::ClassicAccessor.bit();

fn parse_selector(name: &[u8]) -> Option<i32> {
    match SELECTORS.iter().position(|it| it.0.as_bytes() == name) {
        Some(index) => Some(1 << index),
        None => META_SELECTORS.iter().find(|it| it.0.as_bytes() == name).map(|it| it.1),
    }
}

/// Upstream's `Modifiers`: the one at `i` has the value `1 << i`.
const MODIFIERS: [&str; 17] = [
    "const",
    "readonly",
    "static",
    "public",
    "protected",
    "private",
    "#private",
    "abstract",
    "destructured",
    "global",
    "exported",
    "unused",
    "requiresQuotes",
    "override",
    "async",
    "default",
    "namespace",
];
const CONST: u32 = 1 << 0;
const READONLY: u32 = 1 << 1;
const STATIC: u32 = 1 << 2;
const PUBLIC: u32 = 1 << 3;
const PROTECTED: u32 = 1 << 4;
const PRIVATE: u32 = 1 << 5;
const HASH_PRIVATE: u32 = 1 << 6;
const ABSTRACT: u32 = 1 << 7;
const DESTRUCTURED: u32 = 1 << 8;
const GLOBAL: u32 = 1 << 9;
const EXPORTED: u32 = 1 << 10;
const UNUSED: u32 = 1 << 11;
const REQUIRES_QUOTES: u32 = 1 << 12;
const OVERRIDE: u32 = 1 << 13;
const ASYNC: u32 = 1 << 14;
const DEFAULT: u32 = 1 << 15;
const NAMESPACE: u32 = 1 << 16;

/// Upstream's `TypeModifiers`, whose values follow those of [`MODIFIERS`].
const TYPE_MODIFIERS: [&str; 5] = ["boolean", "string", "number", "function", "array"];
const BOOLEAN: u32 = 1 << 17;
const STRING: u32 = 1 << 18;
const NUMBER: u32 = 1 << 19;
const FUNCTION: u32 = 1 << 20;
const ARRAY: u32 = 1 << 21;

/// The values of those of `names` that are in `all`, where the first has the value `first`.
fn parse_flags(names: &[&str], all: &[&str], first: u32) -> u32 {
    names.iter().fold(0, |flags, name| match all.iter().position(|it| it == name) {
        Some(index) => flags | (first << index),
        None => flags,
    })
}

#[derive(Copy, Clone)]
enum UnderscoreOption {
    Forbid,
    Allow,
    Require,
    RequireDouble,
    AllowDouble,
    AllowSingleOrDouble,
}

impl UnderscoreOption {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "forbid" => UnderscoreOption::Forbid,
            "allow" => UnderscoreOption::Allow,
            "require" => UnderscoreOption::Require,
            "requireDouble" => UnderscoreOption::RequireDouble,
            "allowDouble" => UnderscoreOption::AllowDouble,
            "allowSingleOrDouble" => UnderscoreOption::AllowSingleOrDouble,
            _ => return None,
        })
    }
}

// ───────────────────────────── formats ─────────────────────────────

#[derive(Copy, Clone)]
enum PredefinedFormat {
    CamelCase,
    StrictCamelCase,
    PascalCase,
    StrictPascalCase,
    SnakeCase,
    UpperCase,
}

/// `is_in_case(name[0])`. Half of a surrogate pair has no case.
fn is_first_in_case(name: &[u8], is_in_case: fn(&[u8]) -> bool) -> bool {
    let mut points = strings::wtf8_codepoints(name);
    match points.next() {
        Some((_, c)) if c <= 0xFFFF => {
            let end = points.next().map_or(name.len(), |next| next.0);
            is_in_case(name.get(..end).unwrap_or_default())
        }
        _ => true,
    }
}

fn has_strict_camel_humps(name: &[u8], mut is_upper: bool) -> bool {
    if name.starts_with(b"_") {
        return false;
    }
    let mut points = strings::wtf8_codepoints(name).peekable();
    let mut is_first = true;
    while let Some((at, c)) = points.next() {
        let end = points.peek().map_or(name.len(), |next| next.0);
        let is_uppercase_char = match c > 0xFFFF {
            // Upstream goes by UTF-16 code units from the second on.
            true => false,
            false if is_first => {
                is_first = false;
                continue;
            }
            false => {
                let unit = name.get(at..end).unwrap_or_default();
                if unit == b"_" {
                    return false;
                }
                text::is_upper_case(unit) && !text::is_lower_case(unit)
            }
        };
        is_first = false;
        if is_upper != is_uppercase_char {
            is_upper = !is_upper;
        } else if is_upper {
            return false;
        }
    }
    true
}

/// No leading, trailing or adjacent underscores.
fn validate_underscores(name: &[u8]) -> bool {
    !name.starts_with(b"_") && !name.ends_with(b"_") && !strings::contains(name, b"__")
}

impl PredefinedFormat {
    fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "camelCase" => PredefinedFormat::CamelCase,
            "strictCamelCase" => PredefinedFormat::StrictCamelCase,
            "PascalCase" => PredefinedFormat::PascalCase,
            "StrictPascalCase" => PredefinedFormat::StrictPascalCase,
            "snake_case" => PredefinedFormat::SnakeCase,
            "UPPER_CASE" => PredefinedFormat::UpperCase,
            _ => return None,
        })
    }

    fn name(self) -> &'static str {
        match self {
            PredefinedFormat::CamelCase => "camelCase",
            PredefinedFormat::StrictCamelCase => "strictCamelCase",
            PredefinedFormat::PascalCase => "PascalCase",
            PredefinedFormat::StrictPascalCase => "StrictPascalCase",
            PredefinedFormat::SnakeCase => "snake_case",
            PredefinedFormat::UpperCase => "UPPER_CASE",
        }
    }

    /// Upstream's `PredefinedFormatToCheckFunction`.
    fn check(self, name: &[u8]) -> bool {
        name.is_empty()
            || match self {
                PredefinedFormat::CamelCase => {
                    is_first_in_case(name, text::is_lower_case) && !strings::contains_char(name, b'_')
                }
                PredefinedFormat::StrictCamelCase => {
                    is_first_in_case(name, text::is_lower_case) && has_strict_camel_humps(name, false)
                }
                PredefinedFormat::PascalCase => {
                    is_first_in_case(name, text::is_upper_case) && !strings::contains_char(name, b'_')
                }
                PredefinedFormat::StrictPascalCase => {
                    is_first_in_case(name, text::is_upper_case) && has_strict_camel_humps(name, true)
                }
                PredefinedFormat::SnakeCase => text::is_lower_case(name) && validate_underscores(name),
                PredefinedFormat::UpperCase => text::is_upper_case(name) && validate_underscores(name),
            }
    }
}

// ───────────────────────────── options ─────────────────────────────

struct NormalizedMatchRegex {
    is_match: bool,
    regex: Regex,
}

impl NormalizedMatchRegex {
    /// `None` if the pattern is invalid.
    fn parse(value: &Json) -> Option<Self> {
        let (pattern, is_match) = match value {
            Json::String(pattern) => (&pattern[..], true),
            _ => {
                let object = Object::of(Some(value));
                (object.str("regex")?.as_bytes(), object.bool("match")?)
            }
        };
        Some(NormalizedMatchRegex {
            is_match,
            regex: Regex::from_bytes(pattern, b"u").ok()?,
        })
    }
}

/// Upstream's `NormalizedSelector` without the `selector`.
#[derive(Default)]
struct NormalizedOption {
    custom: Option<NormalizedMatchRegex>,
    filter: Option<NormalizedMatchRegex>,
    format: Vec<PredefinedFormat>,
    leading_underscore: Option<UnderscoreOption>,
    trailing_underscore: Option<UnderscoreOption>,
    modifiers: u32,
    modifier_weight: u32,
    prefix: Vec<Vec<u8>>,
    suffix: Vec<Vec<u8>>,
    types: Option<u32>,
}

/// Upstream's `normalizeOption`: the selectors, and what applies to all of them.
fn normalize_option(option: &Json) -> Option<(Vec<i32>, NormalizedOption)> {
    let object = Object::of(Some(option));
    let selectors = match object.get("selector")? {
        Json::Array(names) => names.iter().filter_map(|name| parse_selector(name.as_str()?)).collect(),
        name => vec![parse_selector(name.as_str()?)?],
    };
    let match_regex = |key: &str| match object.get(key) {
        None | Some(Json::Null) => Some(None),
        Some(value) => NormalizedMatchRegex::parse(value).map(Some),
    };
    let affixes = |key: &str| -> Vec<Vec<u8>> {
        object.strings(key).into_iter().map(|it| it.as_bytes().to_vec()).collect()
    };
    let filter = match_regex("filter")?;
    let modifiers = parse_flags(&object.strings("modifiers"), &MODIFIERS, CONST);
    let types = (object.get("types").and_then(Json::as_array))
        .map(|_| parse_flags(&object.strings("types"), &TYPE_MODIFIERS, BOOLEAN));
    // A selector with a filter has the highest priority.
    let filter_weight = if filter.is_some() { 1 << 30 } else { 0 };
    let normalized = NormalizedOption {
        custom: match_regex("custom")?,
        filter,
        format: object.strings("format").into_iter().filter_map(PredefinedFormat::parse).collect(),
        leading_underscore: object.str("leadingUnderscore").and_then(UnderscoreOption::parse),
        trailing_underscore: object.str("trailingUnderscore").and_then(UnderscoreOption::parse),
        modifiers,
        modifier_weight: modifiers | types.unwrap_or(0) | filter_weight,
        prefix: affixes("prefix"),
        suffix: affixes("suffix"),
        types,
    };
    Some((selectors, normalized))
}

/// Upstream's `defaultCamelCaseAllTheThingsConfig`.
fn default_options() -> Vec<(Vec<i32>, NormalizedOption)> {
    let option = |selector: &str, format: &[PredefinedFormat], underscore: Option<UnderscoreOption>| {
        let normalized = NormalizedOption {
            format: format.to_vec(),
            leading_underscore: underscore,
            trailing_underscore: underscore,
            ..NormalizedOption::default()
        };
        (parse_selector(selector.as_bytes()).into_iter().collect(), normalized)
    };
    use PredefinedFormat::{CamelCase, PascalCase, UpperCase};
    vec![
        option("default", &[CamelCase], Some(UnderscoreOption::Allow)),
        option("import", &[CamelCase, PascalCase], None),
        option("variable", &[CamelCase, UpperCase], Some(UnderscoreOption::Allow)),
        option("typeLike", &[PascalCase], None),
    ]
}

/// What upstream's `createValidator` computes for a [`Selector`].
struct Validator {
    /// Indices in `NamingConvention::options`, the highest priority first.
    configs: Vec<usize>,
    /// The modifiers that any of them asks for.
    modifiers: u32,
}

// ───────────────────────────── validation ─────────────────────────────

/// What `getTypeAtLocation` is asked about for a name.
#[derive(Copy, Clone)]
enum TypedNode<'a> {
    Pat(Pat<'a>),
    Member(Member<'a>),
    Prop(Prop<'a>),
    /// Of a selector that is not allowed to have types.
    None,
}

/// The `Identifier`, `PrivateIdentifier` or `Literal` that a validator is called with.
#[derive(Copy, Clone)]
struct Identifier<'a> {
    /// `node.name`, or `${node.value}`
    name: &'a [u8],
    span: Span,
    node: TypedNode<'a>,
}

impl<'a> Identifier<'a> {
    fn new(ident: Ident<'a>) -> Self {
        Identifier {
            name: ident.bytes(),
            span: ident.span(),
            node: TypedNode::None,
        }
    }

    fn of_key(key: Key<'a>, file: &'a File<'a>, node: TypedNode<'a>) -> Self {
        let span = key.inner_span(file);
        let name: &'a [u8] = match key.kind() {
            KeyKind::Ident(name)
            | KeyKind::String(name)
            | KeyKind::Number(name)
            | KeyKind::ComputedNumber(name) => name.bytes(),
            KeyKind::Private(name) => name.bytes().get(1..).unwrap_or_default(),
            // A `TemplateLiteral` has no `value`, like any other expression.
            KeyKind::ComputedString(_) if file.slice(span).starts_with(b"`") => b"undefined",
            KeyKind::ComputedString(name) => name.bytes(),
            KeyKind::Computed(e) => match e.kind() {
                ExprKind::Ident(name) => name.bytes(),
                ExprKind::True => b"true",
                ExprKind::False => b"false",
                ExprKind::Null => b"null",
                _ => b"undefined",
            },
        };
        Identifier { name, span, node }
    }
}

/// Upstream's `isAllTypesMatch`.
fn is_all_types_match<'a>(ty: Type<'a>, cb: impl Fn(Type<'a>) -> bool) -> bool {
    match ty.is_union() {
        true => ty.types().iter().all(cb),
        false => cb(ty),
    }
}

/// Upstream's `isCorrectType`.
fn is_correct_type(types: Option<u32>, selector: Selector, node: TypedNode) -> bool {
    let Some(types) = types else {
        return true;
    };
    if SELECTORS_ALLOWED_TO_HAVE_TYPES & selector.bit() == 0 {
        return true;
    }
    let ty = match node {
        TypedNode::Pat(pat) => pat.ty(),
        TypedNode::Member(member) => NameOf(member).ty(),
        TypedNode::Prop(prop) => NameOf(prop).ty(),
        TypedNode::None => return false,
    };
    let ty = ty.get_non_nullable_type();
    if types & ARRAY != 0 && is_all_types_match(ty, |it| it.is_array_type() || it.is_tuple_type()) {
        return true;
    }
    if types & FUNCTION != 0 && is_all_types_match(ty, |it| !it.get_call_signatures().is_empty()) {
        return true;
    }
    if types & (BOOLEAN | NUMBER | STRING) == 0 {
        return false;
    }
    let allowed = match &ty.get_base_type_of_literal_type().get_widened_type().to_text()[..] {
        b"boolean" => BOOLEAN,
        b"number" => NUMBER,
        b"string" => STRING,
        _ => 0,
    };
    types & allowed != 0
}

/// Upstream's `validateUnderscore`: the name without the underscore, or the message and its `count`.
fn validate_underscore(
    option: Option<UnderscoreOption>,
    is_leading: bool,
    name: &[u8],
) -> Result<&[u8], (Message, &'static str)> {
    let Some(option) = option else {
        return Ok(name);
    };
    let trim = |underscores: &[u8]| match is_leading {
        true => name.strip_prefix(underscores),
        false => name.strip_suffix(underscores),
    };
    match option {
        UnderscoreOption::Allow => Ok(trim(b"_").unwrap_or(name)),
        UnderscoreOption::AllowDouble => Ok(trim(b"__").unwrap_or(name)),
        UnderscoreOption::AllowSingleOrDouble => Ok(trim(b"__").or_else(|| trim(b"_")).unwrap_or(name)),
        UnderscoreOption::Forbid => match trim(b"_") {
            Some(_) => Err((UNEXPECTED_UNDERSCORE, "one")),
            None => Ok(name),
        },
        UnderscoreOption::Require => trim(b"_").ok_or((MISSING_UNDERSCORE, "one")),
        UnderscoreOption::RequireDouble => trim(b"__").ok_or((MISSING_UNDERSCORE, "two")),
    }
}

/// Upstream's `validateAffix`: the name without the affix. `None` if it has none of them.
fn validate_affix<'n>(affixes: &[Vec<u8>], is_prefix: bool, name: &'n [u8]) -> Option<&'n [u8]> {
    if affixes.is_empty() {
        return Some(name);
    }
    affixes.iter().find_map(|affix| match is_prefix {
        true => name.strip_prefix(&affix[..]),
        false => name.strip_suffix(&affix[..]),
    })
}

// ───────────────────────────── modifiers ─────────────────────────────

/// Upstream's `getMemberModifiers`.
fn get_member_modifiers(flags: Flags, is_private_identifier: bool) -> u32 {
    let mut modifiers = if is_private_identifier {
        HASH_PRIVATE
    } else if flags.contains(Flags::PRIVATE) {
        PRIVATE
    } else if flags.contains(Flags::PROTECTED) {
        PROTECTED
    } else {
        PUBLIC
    };
    for (flag, modifier) in [
        (Flags::STATIC, STATIC),
        (Flags::READONLY, READONLY),
        (Flags::OVERRIDE, OVERRIDE),
        (Flags::ABSTRACT, ABSTRACT),
    ] {
        if flags.contains(flag) {
            modifiers |= modifier;
        }
    }
    modifiers
}

/// Upstream's `isDestructured`: `{ x }` and `{ x = 2 }`, not `{ x: y }`.
fn is_destructured(id: Pat) -> bool {
    matches!(id.parent(), Node::PatProp(property) if property.is_shorthand())
}

/// Whether `owner` is a function or a class expression after `export default`.
fn is_default_export(owner: Node) -> bool {
    matches!(
        owner,
        Node::Expr(e) if matches!(e.parent(), Node::Stmt(parent) if parent.tag() == StmtTag::ExportDefault)
    )
}

/// The second half of upstream's `isExported`: `export { name }` or `export default name`.
fn has_export_reference<'a>(name: Name<'a>, scope: Option<Scope<'a>>) -> bool {
    let Some(variable) = scope.and_then(|it| it.get_name(name)) else {
        return false;
    };
    variable.references().any(|reference| match reference.node() {
        Node::ExportSpec(_) => true,
        node => is_default_export(node),
    })
}

/// Upstream's `isUnused`.
fn is_unused<'a>(cx: &Cx<'a, NamingConvention>, name: Name<'a>, scope: Option<Scope<'a>>) -> bool {
    let Some(variable) = scope.and_then(|it| it.resolve_name(name)) else {
        return false;
    };
    let analysis = &cx.state.analysis;
    analysis.get_or_init(|| collect_variables(cx.file(), UsedMarks::default())).is_unused(variable)
}

/// ESTree's `FunctionDeclaration`, `TSDeclareFunction`, `TSEmptyBodyFunctionExpression`,
/// `FunctionExpression` and `ArrowFunctionExpression`.
fn is_function_node(func: Func) -> bool {
    match func.kind() {
        FnKind::Decl | FnKind::Expr | FnKind::Arrow => true,
        FnKind::Method | FnKind::Getter | FnKind::Setter | FnKind::Constructor => {
            !matches!(func.owner(), Node::Member(member) if member.is_signature())
        }
        _ => false,
    }
}

#[derive(Default)]
pub struct State<'a> {
    /// Upstream's `collectVariables(context)`, if a selector asks for `unused`.
    analysis: OnceCell<VariableAnalysis<'a>>,
}

/// Those of the modifiers `global`, `exported` and `unused` that are among `wanted` and that `name` has in `scope`.
fn modifiers_in_scope<'a>(
    cx: &Cx<'a, NamingConvention>,
    name: Name<'a>,
    wanted: u32,
    scope: Option<Scope<'a>>,
) -> u32 {
    let mut modifiers = 0;
    if wanted & GLOBAL != 0 && matches!(scope.map(Scope::kind), Some(ScopeKind::Global | ScopeKind::Module)) {
        modifiers |= GLOBAL;
    }
    if wanted & EXPORTED != 0 && has_export_reference(name, scope) {
        modifiers |= EXPORTED;
    }
    if wanted & UNUSED != 0 && is_unused(cx, name, scope) {
        modifiers |= UNUSED;
    }
    modifiers
}

impl NamingConvention {
    #[inline]
    fn validator(&self, selector: Selector) -> &Validator {
        &self.validators[selector as usize]
    }

    /// The function that upstream's `createValidator` returns.
    fn validate<'a>(&self, cx: &Cx<'a, Self>, selector: Selector, id: Identifier<'a>, modifiers: u32) {
        let report = |message: Message| {
            cx.report(id.span, message).data("type", selector.message_string()).data("name", id.name)
        };
        for config in self.validator(selector).configs.iter().filter_map(|&index| self.options.get(index)) {
            if config.filter.as_ref().is_some_and(|filter| filter.regex.test(id.name) != filter.is_match)
                || config.modifiers & !modifiers != 0
                || !is_correct_type(config.types, selector, id.node)
            {
                continue;
            }

            let mut name = id.name;
            for (option, position) in
                [(config.leading_underscore, "leading"), (config.trailing_underscore, "trailing")]
            {
                name = match validate_underscore(option, position == "leading", name) {
                    Ok(name) => name,
                    Err((message, count)) => {
                        report(message).data("count", count).data("position", position);
                        return;
                    }
                };
            }
            for (affixes, position) in [(&config.prefix, "prefix"), (&config.suffix, "suffix")] {
                name = match validate_affix(affixes, position == "prefix", name) {
                    Some(name) => name,
                    None => {
                        report(MISSING_AFFIX).data("position", position).data("affixes", affixes.join(&b", "[..]));
                        return;
                    }
                };
            }
            if let Some(custom) = &config.custom
                && custom.regex.test(name) != custom.is_match
            {
                report(SATISFY_CUSTOM)
                    .data("regexMatch", if custom.is_match { "match" } else { "not match" })
                    .data("regex", custom.regex.to_string());
                return;
            }
            if !config.format.is_empty()
                && (modifiers & REQUIRES_QUOTES != 0 || !config.format.iter().any(|format| format.check(name)))
            {
                let formats: Vec<&str> = config.format.iter().map(|format| format.name()).collect();
                let is_trimmed = name.len() != id.name.len();
                report(if is_trimmed { DOES_NOT_MATCH_FORMAT_TRIMMED } else { DOES_NOT_MATCH_FORMAT })
                    .data("processedName", name)
                    .data("formats", formats.join(", "));
            }
            return;
        }
    }

    /// Those of the modifiers `global`, `exported` and `unused` that are among `kinds`, that a
    /// configuration for `selector` asks for, and that `name` has. `scope`: where upstream looks it up.
    fn scope_modifiers<'a>(
        &self,
        cx: &Cx<'a, Self>,
        selector: Selector,
        name: Name<'a>,
        has_export_keyword: bool,
        kinds: u32,
        scope: impl FnOnce() -> Option<Scope<'a>>,
    ) -> u32 {
        let modifiers = if has_export_keyword { EXPORTED } else { 0 };
        let wanted = self.validator(selector).modifiers & kinds & !modifiers;
        if wanted == 0 {
            return modifiers;
        }
        modifiers | modifiers_in_scope(cx, name, wanted, scope())
    }

    fn check_function<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        let cx = &*cx;
        if let Some(id) = func.name() {
            let has_export_keyword = func.flags().contains(Flags::EXPORT) || is_default_export(func.owner());
            let mut modifiers = self.scope_modifiers(
                cx,
                Selector::Function,
                id.name(),
                has_export_keyword,
                GLOBAL | EXPORTED | UNUSED,
                || func.scope()?.parent(),
            );
            if func.is_async() {
                modifiers |= ASYNC;
            }
            self.validate(cx, Selector::Function, Identifier::new(id), modifiers);
        }

        if !is_function_node(func) {
            return;
        }
        for param in func.params_with_this() {
            // With a keyword before it, it is a `TSParameterProperty`.
            let keywords = param.modifiers().iter().fold(Flags::empty(), |all, it| all | it.flag());
            let selector = match keywords.is_empty() {
                true => Selector::Parameter,
                false => Selector::ParameterProperty,
            };
            param.pat().for_each_binding(&mut |pat| {
                let Some(name) = pat.as_ident() else {
                    return;
                };
                let modifiers = match selector {
                    Selector::Parameter => {
                        let destructured = if is_destructured(pat) { DESTRUCTURED } else { 0 };
                        destructured | self.scope_modifiers(cx, selector, name, false, UNUSED, || func.scope())
                    }
                    _ => get_member_modifiers(keywords, false),
                };
                // The type annotation of `...a: T` is part of the `RestElement`.
                let span = match pat == param.pat() && !param.is_rest() {
                    true => param.binding_span(),
                    false => pat.span(),
                };
                let id = Identifier {
                    name: name.bytes(),
                    span,
                    node: TypedNode::Pat(pat),
                };
                self.validate(cx, selector, id, modifiers);
            });
        }
    }

    fn check_variable_declarator<'a>(&self, declarator: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        let cx = &*cx;
        // The parameter of a `catch` is none.
        let Node::Stmt(parent) = declarator.parent() else {
            return;
        };
        if parent.tag() != StmtTag::Var {
            return;
        }
        let is_const = matches!(declarator.var_kind(), VarKind::Const);
        let is_async = declarator.init().and_then(Expr::as_fn).is_some_and(Func::is_async);
        declarator.pat().for_each_binding(&mut |pat| {
            let Some(name) = pat.as_ident() else {
                return;
            };
            let is_whole = pat == declarator.pat();
            let mut modifiers = self.scope_modifiers(
                cx,
                Selector::Variable,
                name,
                parent.is_exported(),
                GLOBAL | EXPORTED | UNUSED,
                || Some(Node::VarDecl(declarator).scope()),
            );
            if is_const {
                modifiers |= CONST;
            }
            if is_destructured(pat) {
                modifiers |= DESTRUCTURED;
            }
            if is_whole && is_async {
                modifiers |= ASYNC;
            }
            let id = Identifier {
                name: name.bytes(),
                span: if is_whole { declarator.binding_span() } else { pat.span() },
                node: TypedNode::Pat(pat),
            };
            self.validate(cx, Selector::Variable, id, modifiers);
        });
    }

    fn check_member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        let (flags, is_signature) = (member.flags(), member.is_signature());
        let function_value = member.init().and_then(Expr::as_fn);
        let selector = match member.kind() {
            MemberKind::Property if is_signature => match member.ty().map(TypeNode::kind) {
                Some(TypeKind::Fn(func)) if func.kind() == FnKind::FunctionType => Selector::TypeMethod,
                _ => Selector::TypeProperty,
            },
            MemberKind::Property if flags.contains(Flags::ACCESSOR) => Selector::AutoAccessor,
            MemberKind::Property if function_value.is_some() => Selector::ClassMethod,
            MemberKind::Property => Selector::ClassProperty,
            MemberKind::Method | MemberKind::Getter | MemberKind::Setter if is_signature => Selector::TypeMethod,
            MemberKind::Method => Selector::ClassMethod,
            MemberKind::Getter | MemberKind::Setter => Selector::ClassicAccessor,
            // `static constructor() {}` is a method.
            MemberKind::Constructor if flags.contains(Flags::STATIC) => Selector::ClassMethod,
            _ => return,
        };
        if self.validator(selector).configs.is_empty() {
            return;
        }
        let key = member.key();
        let id = match (key, member.constructor_keyword()) {
            // Upstream does not ask whether the key of an `AccessorProperty` is computed.
            (Some(key), _) if key.is_computed() && selector != Selector::AutoAccessor => return,
            (Some(key), _) => Identifier::of_key(key, cx.file(), TypedNode::Member(member)),
            (None, Some(keyword)) => Identifier {
                name: b"constructor",
                span: keyword.span(),
                node: TypedNode::None,
            },
            (None, None) => return,
        };
        let mut modifiers = match is_signature {
            true if selector == Selector::TypeProperty && flags.contains(Flags::READONLY) => PUBLIC | READONLY,
            true => PUBLIC,
            false => get_member_modifiers(flags, key.is_some_and(Key::is_private)),
        };
        if selector == Selector::ClassMethod && member.func().or(function_value).is_some_and(Func::is_async) {
            modifiers |= ASYNC;
        }
        if requires_quoting(id.name) {
            modifiers |= REQUIRES_QUOTES;
        }
        self.validate(cx, selector, id, modifiers);
    }

    fn check_property<'a>(&self, property: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if property.is_jsx_attribute() {
            return;
        }
        let function_value = property.value().and_then(Expr::as_fn);
        let selector = match property.kind() {
            PropKind::Spread => return,
            PropKind::Getter | PropKind::Setter => Selector::ClassicAccessor,
            PropKind::Method => Selector::ObjectLiteralMethod,
            PropKind::Init if function_value.is_some() => Selector::ObjectLiteralMethod,
            PropKind::Init | PropKind::Shorthand => Selector::ObjectLiteralProperty,
        };
        if self.validator(selector).configs.is_empty() {
            return;
        }
        let Some(key) = property.key().filter(|key| !key.is_computed()) else {
            return;
        };
        // `:not(ObjectPattern) > Property`
        if selector == Selector::ObjectLiteralProperty
            && matches!(property.parent(), Node::Expr(object) if object.is_assignment_target())
        {
            return;
        }
        let id = Identifier::of_key(key, cx.file(), TypedNode::Prop(property));
        let mut modifiers = PUBLIC;
        if selector == Selector::ObjectLiteralMethod && function_value.is_some_and(Func::is_async) {
            modifiers |= ASYNC;
        }
        if requires_quoting(id.name) {
            modifiers |= REQUIRES_QUOTES;
        }
        self.validate(cx, selector, id, modifiers);
    }

    fn check_class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        let Some(id) = class.name() else {
            return;
        };
        let has_export_keyword = class.flags().contains(Flags::EXPORT) || is_default_export(class.owner());
        let mut modifiers =
            self.scope_modifiers(cx, Selector::Class, id.name(), has_export_keyword, EXPORTED | UNUSED, || {
                class.scope()?.parent()
            });
        if class.flags().contains(Flags::ABSTRACT) {
            modifiers |= ABSTRACT;
        }
        self.validate(cx, Selector::Class, Identifier::new(id), modifiers);
    }

    fn check_import<'a>(&self, import: Import<'a>, cx: &Cx<'a, Self>) {
        if let Some(local) = import.default() {
            self.validate(cx, Selector::Import, Identifier::new(local), DEFAULT);
        }
        if let Some(local) = import.namespace() {
            self.validate(cx, Selector::Import, Identifier::new(local), NAMESPACE);
        }
        for specifier in import.named() {
            // `import { default as Foo }`. As upstream, also a name that is written as a string.
            let imported = specifier.imported();
            if imported.is_string() || imported.name().is("default") {
                self.validate(cx, Selector::Import, Identifier::new(specifier.local()), DEFAULT);
            }
        }
    }

    fn check_statement<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let (selector, id, flags) = match statement.kind() {
            StmtKind::Enum(it) => (Selector::Enum, it.name(), it.flags()),
            StmtKind::Interface(it) => (Selector::Interface, it.name(), it.flags()),
            StmtKind::TypeAlias(it) => (Selector::TypeAlias, it.name(), it.flags()),
            StmtKind::Import(import) => return self.check_import(import, cx),
            _ => return,
        };
        let has_export_keyword = flags.contains(Flags::EXPORT);
        let modifiers = self.scope_modifiers(cx, selector, id.name(), has_export_keyword, EXPORTED | UNUSED, || {
            let scope = Node::Stmt(statement).scope();
            match selector {
                // "enums create their own nested scope"
                Selector::Enum => scope.parent(),
                _ => Some(scope),
            }
        });
        self.validate(cx, selector, Identifier::new(id), modifiers);
    }

    fn check_enum_member<'a>(&self, member: EnumMember<'a>, cx: &mut Cx<'a, Self>) {
        let Some(key) = member.key() else {
            return;
        };
        let id = Identifier::of_key(key, cx.file(), TypedNode::None);
        let modifiers = if requires_quoting(id.name) { REQUIRES_QUOTES } else { 0 };
        self.validate(cx, Selector::EnumMember, id, modifiers);
    }

    fn check_type_parameter<'a>(&self, param: TypeParam<'a>, cx: &mut Cx<'a, Self>) {
        // `TSTypeParameterDeclaration > TSTypeParameter`: not that of an `infer` or a mapped type.
        if matches!(param.parent(), Node::Type(_)) {
            return;
        }
        let id = param.name();
        let modifiers = self.scope_modifiers(cx, Selector::TypeParameter, id.name(), false, UNUSED, || {
            Some(Node::TypeParam(param).scope())
        });
        self.validate(cx, Selector::TypeParameter, Identifier::new(id), modifiers);
    }
}

impl Rule for NamingConvention {
    // It needs types only for the `types` of a selector, and runs without them, as upstream.
    const META: Meta = Meta::typescript("naming-convention", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let parsed = match options.is_empty() {
            true => default_options(),
            false => options.all().iter().filter_map(normalize_option).collect(),
        };
        let all_configs: Vec<(i32, usize)> = (parsed.iter().enumerate())
            .flat_map(|(index, it)| it.0.iter().map(move |&selector| (selector, index)))
            .collect();
        let options: Vec<NormalizedOption> = parsed.into_iter().map(|it| it.1).collect();
        let weight = |index: usize| options.get(index).map_or(0, |it| it.modifier_weight);
        let validators = std::array::from_fn(|selector| {
            let mut configs: Vec<(i32, usize)> =
                all_configs.iter().copied().filter(|it| it.0 & (1 << selector) != 0).collect();
            // Selectors go ahead of meta selectors, of which `method` and `property` are the first.
            utils::sort::sort_by_key(&mut configs, |&(selector, index)| {
                (
                    META_SELECTORS.iter().any(|it| it.1 == selector),
                    selector != METHOD && selector != PROPERTY,
                    Reverse(selector),
                    Reverse(weight(index)),
                )
            });
            Validator {
                modifiers: configs.iter().fold(0, |all, it| all | options.get(it.1).map_or(0, |it| it.modifiers)),
                configs: configs.into_iter().map(|it| it.1).collect(),
            }
        });
        NamingConvention { options, validators }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> State<'a> {
        let has = |selectors: &[Selector]| selectors.iter().any(|&it| !self.validator(it).configs.is_empty());
        if has(&[Selector::Function, Selector::Parameter, Selector::ParameterProperty]) {
            on.funcs(Self::check_function);
        }
        if has(&[Selector::Variable]) {
            on.var_decls(Self::check_variable_declarator);
        }
        if has(&[
            Selector::ClassProperty,
            Selector::ClassMethod,
            Selector::ClassicAccessor,
            Selector::AutoAccessor,
            Selector::TypeProperty,
            Selector::TypeMethod,
        ]) {
            on.members(Self::check_member);
        }
        if has(&[Selector::ObjectLiteralProperty, Selector::ObjectLiteralMethod, Selector::ClassicAccessor]) {
            on.props(Self::check_property);
        }
        if has(&[Selector::Class]) {
            on.classes(Self::check_class);
        }
        for (selector, tag) in [
            (Selector::Enum, StmtTag::Enum),
            (Selector::Interface, StmtTag::Interface),
            (Selector::TypeAlias, StmtTag::TypeAlias),
            (Selector::Import, StmtTag::Import),
        ] {
            if has(&[selector]) {
                on.stmts([tag], Self::check_statement);
            }
        }
        if has(&[Selector::EnumMember]) {
            on.enum_members(Self::check_enum_member);
        }
        if has(&[Selector::TypeParameter]) {
            on.type_params(Self::check_type_parameter);
        }
        State::default()
    }
}
