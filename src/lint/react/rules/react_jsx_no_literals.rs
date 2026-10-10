use bun_lint_oxlint::ast_util::is_react_component_name;
use crate::jsx::{AttributeValue, get_prop_value};
use crate::util_ast::name_of_key;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};

/// What the configuration and each entry of `elementOverrides` have.
struct JsxNoLiteralsOptions {
    no_strings: bool,
    /// As they are given: which blanks around them do not count is for the flavour to say.
    allowed_strings: Vec<Box<[u8]>>,
    ignore_props: bool,
    no_attribute_strings: bool,
    /// Only oxlint has it.
    restricted_attributes: Vec<Box<[u8]>>,
}

struct ElementOverrideOptions {
    element: Box<[u8]>,
    /// `/^[A-Z][\w.]*$/`: upstream drops the entry of any other name.
    is_overridable: bool,
    options: JsxNoLiteralsOptions,
    allow_element: bool,
    apply_to_nested_elements: bool,
}

/// Disallow usage of string literals in JSX
pub struct JsxNoLiterals {
    options: JsxNoLiteralsOptions,
    /// The last for an element counts.
    element_overrides: Vec<ElementOverrideOptions>,
}

// Each with what it is where an entry of `elementOverrides` holds.
const INVALID_PROP_VALUE: [Message; 2] = [
    Message::new("invalidPropValue", "Invalid prop value: \"{{text}}\""),
    Message::new("invalidPropValueInElement", "Invalid prop value: \"{{text}}\" in {{element}}"),
];
const NO_STRINGS_IN_ATTRIBUTES: [Message; 2] = [
    Message::new("noStringsInAttributes", "Strings not allowed in attributes: \"{{text}}\""),
    Message::new("noStringsInAttributesInElement", "Strings not allowed in attributes: \"{{text}}\" in {{element}}"),
];
const NO_STRINGS_IN_JSX: [Message; 2] = [
    Message::new("noStringsInJSX", "Strings not allowed in JSX files: \"{{text}}\""),
    Message::new("noStringsInJSXInElement", "Strings not allowed in JSX files: \"{{text}}\" in {{element}}"),
];
const LITERAL_NOT_IN_JSX_EXPRESSION: [Message; 2] = [
    Message::new("literalNotInJSXExpression", "Missing JSX expression container around literal string: \"{{text}}\""),
    Message::new(
        "literalNotInJSXExpressionInElement",
        "Missing JSX expression container around literal string: \"{{text}}\" in {{element}}",
    ),
];
const LITERAL_TEXT: Message = Message::new("", "Disallow literal text as JSX children");
const LITERAL_ATTRIBUTE: Message = Message::new("", "Disallow string literals in JSX attributes");
const RESTRICTED_ATTRIBUTE: Message = Message::new("", "Disallow string literals on restricted JSX attributes");

impl JsxNoLiteralsOptions {
    fn new(options: Object) -> Self {
        let strings = |key| options.strings(key).into_iter().map(|it| it.as_bytes().into()).collect();
        JsxNoLiteralsOptions {
            no_strings: options.bool_or("noStrings", false),
            allowed_strings: strings("allowedStrings"),
            ignore_props: options.bool_or("ignoreProps", false),
            no_attribute_strings: options.bool_or("noAttributeStrings", false),
            restricted_attributes: strings("restrictedAttributes"),
        }
    }
}

#[derive(Default)]
pub struct State<'a> {
    /// For each element and fragment that it is in: which of the `elementOverrides` holds for the closest element, and
    /// which for the elements in that.
    scopes: Vec<(Option<usize>, Option<usize>)>,
    /// oxlint: the name under which a variable is exported where it is from, if that is another.
    exported_names: FxHashMap<Symbol<'a>, Option<&'a [u8]>>,
    /// Upstream: the same by the name alone, of the declarations so far. `None`: it is exported under a string.
    renamed_import_map: FxHashMap<&'a [u8], Option<&'a [u8]>>,
}

const JSX: NodeTags = NodeTags::new().exprs(&[ExprTag::Jsx]);
const JSX_AND_DECLARATIONS: NodeTags = JSX.union(NodeTags::new().stmts(&[StmtTag::Import, StmtTag::Var]));

impl Rule for JsxNoLiterals {
    const META: Meta = Meta::plugin(Plugin::React, "jsx-no-literals", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]).enter(JSX_AND_DECLARATIONS).exit(JSX);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let element_override = |(element, value): &(Vec<u8>, Json)| {
            let value = Object::of(Some(value));
            let is_name_part = |it: &u8| strings::is_regexp_word_byte(*it) || *it == b'.';
            ElementOverrideOptions {
                element: element.as_slice().into(),
                is_overridable: matches!(element.as_slice(), [b'A'..=b'Z', rest @ ..] if rest.iter().all(is_name_part)),
                options: JsxNoLiteralsOptions::new(value),
                allow_element: value.get("allowElement").is_some_and(Json::is_truthy),
                apply_to_nested_elements: value.bool_or("applyToNestedElements", true),
            }
        };
        JsxNoLiterals {
            options: JsxNoLiteralsOptions::new(options),
            element_overrides: options.object("elementOverrides").entries().iter().map(element_override).collect(),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if self.element_overrides.is_empty() {
            return On::new().exprs(&[ExprTag::Jsx]);
        }
        // oxlint asks the variable where it is from.
        On::new().enter(if file.language().is_oxlint { JSX } else { JSX_AND_DECLARATIONS }).exit(JSX)
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        file.has_exprs([ExprTag::Jsx]).then(State::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Jsx(jsx) = e.kind() {
            self.check(jsx, None, cx);
        }
    }

    // An override holds for all that is in the element, in `{..}` and in attributes as well.
    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if let Node::Stmt(declaration) = node {
            cx.state.add_renamed_imports(declaration);
            return;
        }
        let is_oxlint = cx.language().is_oxlint;
        let (current_element_opts, inherited_opts) = cx.state.scopes.last().copied().unwrap_or_default();
        let scope = match node.as_expr().map(Expr::kind) {
            Some(ExprKind::Jsx(jsx)) if !jsx.is_fragment() => {
                let own_opts = self.get_element_override_opts(jsx, &mut cx.state, is_oxlint);
                let element_opts = own_opts.or(inherited_opts);
                self.check(jsx, element_opts, cx);
                let applies_to_nested_elements =
                    |it: &usize| self.element_overrides.get(*it).is_some_and(|it| it.apply_to_nested_elements);
                (element_opts, own_opts.filter(applies_to_nested_elements).or(inherited_opts))
            }
            // A fragment is part of the element that it is in.
            Some(ExprKind::Jsx(fragment)) => {
                self.check(fragment, current_element_opts, cx);
                (current_element_opts, inherited_opts)
            }
            _ => (current_element_opts, inherited_opts),
        };
        cx.state.scopes.push(scope);
    }

    fn exit<'a>(&self, _: Node<'a>, cx: &mut Cx<'a, Self>) {
        cx.state.scopes.pop();
    }
}

impl JsxNoLiterals {
    /// `element_override_opts`: which of the `elementOverrides` holds for the element or the fragment.
    fn check<'a>(&self, jsx: Jsx<'a>, element_override_opts: Option<usize>, cx: &Cx<'a, Self>) {
        let element_override = element_override_opts.and_then(|it| self.element_overrides.get(it));
        let config = ResolvedConfig {
            options: element_override.map_or(&self.options, |it| &it.options),
            element_override,
            ignore_props_of_all: self.options.ignore_props,
            is_oxlint: cx.language().is_oxlint,
        };
        // oxlint looks at nothing of such an element.
        if config.is_oxlint && config.should_allow_element() {
            return;
        }
        config.inspect_element_literals(jsx, cx);
        config.inspect_element_attributes(jsx, cx);
    }

    /// Which of the `elementOverrides` is for the element.
    fn get_element_override_opts<'a>(&self, jsx: Jsx<'a>, state: &mut State<'a>, is_oxlint: bool) -> Option<usize> {
        let get = |name: &[u8]| {
            self.element_overrides.iter().rposition(|it| *it.element == *name && (is_oxlint || it.is_overridable))
        };
        let name = jsx.tag()?;
        match name.kind() {
            ExprKind::Ident(_) => {
                Some(state.resolve_element_name(name, is_oxlint)).filter(|it| is_react_component_name(it)).and_then(get)
            }
            ExprKind::String(name) => Some(name.bytes()).filter(|it| is_react_component_name(it)).and_then(get),
            ExprKind::Dot { name: property, .. } => {
                let mut names: SmallVec<[&[u8]; 8]> = SmallVec::new();
                let mut object = name;
                while let ExprKind::Dot { obj, name, .. } = object.kind() {
                    names.push(name.bytes());
                    object = obj;
                }
                names.push(match object.tag() {
                    ExprTag::Ident => state.resolve_element_name(object, is_oxlint),
                    _ => b"this",
                });
                names.reverse();
                let resolved = names.join(&b"."[..]);
                // For oxlint `a.B` is no component.
                if is_oxlint && !is_react_component_name(&resolved) {
                    return None;
                }
                // `React.Fragment`, then `Fragment`
                get(&resolved).or_else(|| get(property.bytes()))
            }
            _ => None,
        }
    }
}

/// `require(..)`, `require(..).a[b]`
fn is_require_statement(expr: Expr) -> bool {
    let mut at = expr;
    while !at.is_chain_root()
        && let Some(object) = at.object()
    {
        at = object;
    }
    !at.is_chain_root() && at.as_call().is_some_and(|call| call.callee().is_ident("require"))
}

impl<'a> State<'a> {
    /// The name under which what `id_ref` refers to is exported, if it is imported under another: `import { a as b }`,
    /// `const { a: b } = require(..)`.
    fn resolve_element_name(&mut self, id_ref: Expr<'a>, is_oxlint: bool) -> &'a [u8] {
        let exported = if is_oxlint {
            let names = &mut self.exported_names;
            id_ref.symbol().and_then(|symbol| *names.entry(symbol).or_insert_with(|| exported_name(symbol)))
        } else {
            self.renamed_import_map.get(id_ref.text()).copied().flatten()
        };
        exported.unwrap_or_else(|| id_ref.text())
    }

    /// Upstream's listeners for `ImportDeclaration` and `VariableDeclaration`.
    fn add_renamed_imports(&mut self, declaration: Stmt<'a>) {
        match declaration.kind() {
            StmtKind::Import(import) => {
                for specifier in import.named() {
                    let imported = specifier.imported();
                    let exported = (!imported.is_string()).then(|| imported.bytes());
                    self.renamed_import_map.insert(specifier.local().bytes(), exported);
                }
            }
            StmtKind::Var(declarators) => {
                for declarator in declarators {
                    let PatKind::Object(properties) = declarator.pat().kind() else {
                        continue;
                    };
                    if !declarator.init().is_some_and(is_require_statement) {
                        continue;
                    }
                    for property in properties {
                        if property.default().is_none()
                            && let PatKind::Ident(local) = property.value().kind()
                            && let Some(key) = property.key().and_then(name_of_key)
                        {
                            self.renamed_import_map.insert(local.bytes(), Some(key));
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

fn exported_name(symbol: Symbol<'_>) -> Option<&[u8]> {
    match symbol.declarations().next()? {
        Declaration::ImportSpec(specifier) if !specifier.imported().is_string() => Some(specifier.imported().bytes()),
        Declaration::Var(local) => {
            if let Node::PatProp(property) = local.parent()
                && property.default().is_none()
                && let Some(KeyKind::Ident(key)) = property.key().map(Key::kind)
                && let Node::Pat(object) = property.parent()
                && let Node::VarDecl(declarator) = object.parent()
                && declarator.init().is_some_and(is_require_statement)
            {
                return Some(key.bytes());
            }
            None
        }
        _ => None,
    }
}

/// Where the braces around an expression are.
#[derive(Copy, Clone)]
enum Container<'a> {
    ChildOfElement,
    ChildOfFragment,
    Attribute(Prop<'a>),
}

/// What holds for an element or a fragment: upstream's `ResolvedConfig`.
struct ResolvedConfig<'r> {
    options: &'r JsxNoLiteralsOptions,
    /// The entry of `elementOverrides` that `options` is of.
    element_override: Option<&'r ElementOverrideOptions>,
    /// `ignoreProps` of the configuration itself, which is what upstream asks about a string in an attribute.
    ignore_props_of_all: bool,
    is_oxlint: bool,
}

impl ResolvedConfig<'_> {
    fn trim<'t>(&self, bytes: &'t [u8]) -> &'t [u8] {
        // oxlint goes by `White_Space` of Unicode.
        if self.is_oxlint { strings::trim_unicode_whitespace(bytes) } else { strings::trim_js_whitespace(bytes) }
    }

    /// `allowedStrings.has(trimmed)`
    fn has_allowed_string(&self, trimmed: &[u8]) -> bool {
        self.options.allowed_strings.iter().any(|allowed| self.trim(allowed) == trimmed)
    }

    fn is_allowed_string(&self, str_literal: &[u8]) -> bool {
        !self.options.allowed_strings.is_empty() && self.has_allowed_string(self.trim(str_literal))
    }

    /// What upstream's `isViableTextNode` asks about the node itself.
    fn is_viable_text(&self, raw: &[u8], value: &[u8]) -> bool {
        !self.is_allowed_string(raw)
            && !self.is_allowed_string(value)
            && (value.is_empty() || !self.trim(value).is_empty())
    }

    fn should_allow_element(&self) -> bool {
        self.element_override.is_some_and(|it| it.allow_element)
    }

    /// Upstream's `defaultMessageId`
    fn default_message_id(&self, ancestor_is_jsx_element: bool) -> &'static [Message; 2] {
        if self.options.no_attribute_strings && !ancestor_is_jsx_element {
            &NO_STRINGS_IN_ATTRIBUTES
        } else if self.options.no_strings {
            &NO_STRINGS_IN_JSX
        } else {
            &LITERAL_NOT_IN_JSX_EXPRESSION
        }
    }

    /// Upstream's `reportLiteralNode`
    fn report_literal_node(&self, at: Span, messages: &[Message; 2], cx: &Cx<'_, JsxNoLiterals>) {
        let [message, message_in_element] = *messages;
        let trimmed = strings::trim_js_whitespace(cx.file().slice(at));
        match self.element_override {
            Some(it) => cx.report(at, message_in_element).data("text", trimmed).data("element", it.element.to_vec()),
            None => cx.report(at, message).data("text", trimmed),
        };
    }

    fn inspect_element_literals<'a>(&self, jsx: Jsx<'a>, cx: &Cx<'a, JsxNoLiterals>) {
        // Upstream takes a fragment for an element in some places only.
        let is_fragment = !self.is_oxlint && jsx.is_fragment();
        for child in jsx.children() {
            if !child.is_jsx_text() {
                if child.jsx_container_span().is_some() {
                    let container = if is_fragment { Container::ChildOfFragment } else { Container::ChildOfElement };
                    self.inspect_jsx_expression(child, container, cx);
                }
                continue;
            }
            let raw = child.text();
            // oxlint reads `&nbsp;` as it is written.
            let value = if self.is_oxlint { None } else { child.jsx_text_value() };
            if !self.is_viable_text(raw, value.as_deref().unwrap_or(raw)) {
                continue;
            }
            if self.is_oxlint {
                cx.report(child, LITERAL_TEXT);
            } else if !self.should_allow_element() && !(is_fragment && self.options.no_attribute_strings) {
                self.report_literal_node(child.span(), self.default_message_id(true), cx);
            }
        }
    }

    /// One report for each string in `"a" + b + "c"`.
    fn inspect_jsx_expression<'a>(&self, expr: Expr<'a>, container: Container<'a>, cx: &Cx<'a, JsxNoLiterals>) {
        let (options, is_oxlint) = (self.options, self.is_oxlint);
        if !options.no_strings {
            return;
        }
        let is_in_attribute = matches!(container, Container::Attribute(_));
        let is_child_of_element = matches!(container, Container::ChildOfElement);
        let ignore_props = if is_oxlint { options.ignore_props } else { self.ignore_props_of_all };
        let mut pending: SmallVec<[Expr<'a>; 8]> = smallvec![expr];
        while let Some(expr) = pending.pop().filter(|_| !cx.has_reported_too_much()) {
            // oxlint has a node for parentheses.
            if is_oxlint && expr.is_parenthesized() {
                continue;
            }
            let is_literal = match expr.kind() {
                ExprKind::String(_) if is_in_attribute && ignore_props => false,
                ExprKind::String(value) if is_oxlint => !self.is_allowed_string(value.bytes()),
                ExprKind::String(value) => {
                    !options.no_attribute_strings
                        && self.is_viable_text(expr.text(), value.bytes())
                        && (is_in_attribute || !self.should_allow_element())
                }
                ExprKind::Template(_) => is_child_of_element || !options.ignore_props,
                // oxlint looks into the value of an attribute only.
                ExprKind::Binary { op, left, right }
                    if (is_in_attribute || !is_oxlint)
                        && !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma) =>
                {
                    pending.extend([left, right]);
                    false
                }
                _ => false,
            };
            if !is_literal {
                continue;
            }
            match container {
                _ if !is_oxlint => {
                    self.report_literal_node(expr.span(), self.default_message_id(is_child_of_element), cx);
                }
                // oxlint points at the attribute.
                Container::Attribute(attr) => drop(cx.report(attr, LITERAL_ATTRIBUTE)),
                _ => drop(cx.report(expr, LITERAL_TEXT)),
            }
        }
    }

    fn inspect_element_attributes<'a>(&self, jsx: Jsx<'a>, cx: &Cx<'a, JsxNoLiterals>) {
        let (options, is_oxlint) = (self.options, self.is_oxlint);
        let restricted_attributes = if is_oxlint { options.restricted_attributes.as_slice() } else { &[] };
        let ignore_props = options.ignore_props && (is_oxlint || self.ignore_props_of_all);
        let looks_at_strings =
            !restricted_attributes.is_empty() || !ignore_props && (options.no_attribute_strings || options.no_strings);
        if !looks_at_strings {
            return;
        }
        for attr in jsx.attrs() {
            match get_prop_value(attr) {
                Some(AttributeValue::StringLiteral(str_literal)) if !is_oxlint => {
                    self.inspect_string_attribute(attr, str_literal.span, cx);
                }
                Some(AttributeValue::StringLiteral(str_literal)) => {
                    if self.is_allowed_string(str_literal.value) {
                        continue;
                    }
                    // Of `a:b` it is `b`.
                    let name = attr.key().and_then(Key::name).map(Name::bytes).unwrap_or_default();
                    let attr_name = strings::split_once_char(name, b':').map_or(name, |it| it.1);
                    if restricted_attributes.iter().any(|restricted| **restricted == *attr_name) {
                        cx.report(attr, RESTRICTED_ATTRIBUTE);
                    } else if !options.ignore_props && (options.no_attribute_strings || options.no_strings) {
                        cx.report(attr, LITERAL_ATTRIBUTE);
                    }
                }
                Some(AttributeValue::ExpressionContainer(expr)) => {
                    self.inspect_jsx_expression(expr, Container::Attribute(attr), cx);
                }
                _ => {}
            }
        }
    }

    /// What upstream's listeners for `JSXAttribute` and for `Literal` say about `a="b"`.
    fn inspect_string_attribute<'a>(&self, attr: Prop<'a>, literal: Span, cx: &Cx<'a, JsxNoLiterals>) {
        let options = self.options;
        let Some(value) = attr.value().and_then(Expr::as_string).map(Name::bytes) else {
            return;
        };
        if options.no_strings && !options.ignore_props && !self.has_allowed_string(value) {
            self.report_literal_node(attr.span(), &INVALID_PROP_VALUE, cx);
        }
        let is_looked_at = options.no_attribute_strings && !self.ignore_props_of_all;
        if is_looked_at && self.is_viable_text(cx.file().slice(literal), value) {
            self.report_literal_node(literal, self.default_message_id(false), cx);
        }
    }
}
