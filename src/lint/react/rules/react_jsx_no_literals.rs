use bun_lint_oxlint::ast_util::is_react_component_name;
use crate::jsx::{AttributeValue, get_prop_value};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};

/// What the configuration and each entry of `elementOverrides` have.
struct JsxNoLiteralsOptions {
    no_strings: bool,
    /// Without the blanks around them.
    allowed_strings: Vec<Box<[u8]>>,
    ignore_props: bool,
    no_attribute_strings: bool,
    restricted_attributes: Vec<Box<[u8]>>,
}

struct ElementOverrideOptions {
    element: Box<[u8]>,
    options: JsxNoLiteralsOptions,
    allow_element: bool,
    apply_to_nested_elements: bool,
}

/// Disallows usage of unwrapped string literals inside JSX, such as text children of a JSX element or string-valued
/// props.
pub struct JsxNoLiterals {
    options: JsxNoLiteralsOptions,
    /// The last for an element counts.
    element_overrides: Vec<ElementOverrideOptions>,
}

const LITERAL_TEXT: Message = Message::new("", "Disallow literal text as JSX children");
const LITERAL_ATTRIBUTE: Message = Message::new("", "Disallow string literals in JSX attributes");
const RESTRICTED_ATTRIBUTE: Message = Message::new("", "Disallow string literals on restricted JSX attributes");

impl JsxNoLiteralsOptions {
    fn new(options: Object) -> Self {
        JsxNoLiteralsOptions {
            no_strings: options.bool_or("noStrings", false),
            allowed_strings: options
                .strings("allowedStrings")
                .into_iter()
                .map(|it| strings::trim_unicode_whitespace(it.as_bytes()).into())
                .collect(),
            ignore_props: options.bool_or("ignoreProps", false),
            no_attribute_strings: options.bool_or("noAttributeStrings", false),
            restricted_attributes: options
                .strings("restrictedAttributes")
                .into_iter()
                .map(|it| it.as_bytes().into())
                .collect(),
        }
    }

    fn is_allowed_string(&self, str_literal: &[u8]) -> bool {
        let trimmed = strings::trim_unicode_whitespace(str_literal);
        !self.allowed_strings.is_empty() && self.allowed_strings.iter().any(|allowed| **allowed == *trimmed)
    }
}

/// The name under which a variable is exported where it is from, if that is another.
type ExportedNames<'a> = FxHashMap<Symbol<'a>, Option<&'a [u8]>>;

#[derive(Default)]
pub struct State<'a> {
    /// For each element and fragment that it is in: which of the `elementOverrides` holds for the closest element, and
    /// which for the elements in that.
    scopes: Vec<(Option<usize>, Option<usize>)>,
    exported_names: ExportedNames<'a>,
}

impl Rule for JsxNoLiterals {
    const META: Meta = Meta::oxlint(Plugin::React, "jsx-no-literals", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let element_override = |(element, value): &(Vec<u8>, Json)| {
            let value = Object::of(Some(value));
            ElementOverrideOptions {
                element: element.as_slice().into(),
                options: JsxNoLiteralsOptions::new(value),
                allow_element: value.bool_or("allowElement", false),
                apply_to_nested_elements: value.bool_or("applyToNestedElements", true),
            }
        };
        JsxNoLiterals {
            options: JsxNoLiteralsOptions::new(options),
            element_overrides: options.object("elementOverrides").entries().iter().map(element_override).collect(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if self.element_overrides.is_empty() {
            on.exprs([ExprTag::Jsx], |rule, e, cx| {
                if let ExprKind::Jsx(jsx) = e.kind() {
                    rule.check(jsx, None, cx);
                }
            });
            return State::default();
        }
        if !file.has_exprs([ExprTag::Jsx]) {
            return State::default();
        }
        // An override holds for all that is in the element, in `{..}` and in attributes as well.
        on.enter(ExprTag::Jsx, |rule, node, cx| {
            let (current_element_opts, inherited_opts) = cx.state.scopes.last().copied().unwrap_or_default();
            let scope = match node.as_expr().map(Expr::kind) {
                Some(ExprKind::Jsx(jsx)) if !jsx.is_fragment() => {
                    let own_opts = rule.get_element_override_opts(jsx, &mut cx.state.exported_names);
                    let element_opts = own_opts.or(inherited_opts);
                    rule.check(jsx, element_opts, cx);
                    let applies_to_nested_elements =
                        |it: &usize| rule.element_overrides.get(*it).is_some_and(|it| it.apply_to_nested_elements);
                    (element_opts, own_opts.filter(applies_to_nested_elements).or(inherited_opts))
                }
                // A fragment is part of the element that it is in.
                Some(ExprKind::Jsx(fragment)) => {
                    rule.check(fragment, current_element_opts, cx);
                    (current_element_opts, inherited_opts)
                }
                _ => (current_element_opts, inherited_opts),
            };
            cx.state.scopes.push(scope);
        });
        on.exit(ExprTag::Jsx, |_, _, cx| {
            cx.state.scopes.pop();
        });
        State::default()
    }
}

impl JsxNoLiterals {
    /// `element_override_opts`: which of the `elementOverrides` holds for the element or the fragment.
    fn check<'a>(&self, jsx: Jsx<'a>, element_override_opts: Option<usize>, cx: &Cx<'a, Self>) {
        let element_override_opts = element_override_opts.and_then(|it| self.element_overrides.get(it));
        if element_override_opts.is_some_and(|it| it.allow_element) {
            return;
        }
        let options = element_override_opts.map_or(&self.options, |it| &it.options);
        inspect_element_literals(jsx, options, cx);
        inspect_element_attributes(jsx, options, cx);
    }

    /// Which of the `elementOverrides` is for the element.
    fn get_element_override_opts<'a>(
        &self,
        jsx: Jsx<'a>,
        exported_names: &mut ExportedNames<'a>,
    ) -> Option<usize> {
        let get = |name: &[u8]| self.element_overrides.iter().rposition(|it| *it.element == *name);
        let name = jsx.tag()?;
        match name.kind() {
            ExprKind::Ident(_) => {
                Some(resolve_element_name(name, exported_names)).filter(|it| is_react_component_name(it)).and_then(get)
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
                    ExprTag::Ident => resolve_element_name(object, exported_names),
                    _ => b"this",
                });
                names.reverse();
                let resolved = names.join(&b"."[..]);
                if !is_react_component_name(&resolved) {
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

/// The name under which what `id_ref` refers to is exported, if it is imported under another: `import { a as b }`,
/// `const { a: b } = require(..)`.
fn resolve_element_name<'a>(id_ref: Expr<'a>, exported_names: &mut ExportedNames<'a>) -> &'a [u8] {
    let exported_name = |symbol: Symbol<'a>| *exported_names.entry(symbol).or_insert_with(|| exported_name(symbol));
    id_ref.symbol().and_then(exported_name).unwrap_or_else(|| id_ref.text())
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

fn inspect_element_literals<'a>(jsx: Jsx<'a>, options: &JsxNoLiteralsOptions, cx: &Cx<'a, JsxNoLiterals>) {
    for child in jsx.children() {
        let is_literal = if child.is_jsx_text() {
            let value = child.text();
            !strings::trim_unicode_whitespace(value).is_empty() && !options.is_allowed_string(value)
        } else {
            options.no_strings
                && child.jsx_container_span().is_some()
                && !child.is_parenthesized()
                && match child.kind() {
                    ExprKind::String(value) => !options.is_allowed_string(value.bytes()),
                    ExprKind::Template(_) => true,
                    _ => false,
                }
        };
        if is_literal {
            cx.report(child, LITERAL_TEXT);
        }
    }
}

/// One report for each string in `"a" + b + "c"`.
fn inspect_jsx_expression<'a>(
    expr: Expr<'a>,
    options: &JsxNoLiteralsOptions,
    attr: Prop<'a>,
    cx: &Cx<'a, JsxNoLiterals>,
) {
    let mut pending: SmallVec<[Expr<'a>; 8]> = smallvec![expr];
    while let Some(expr) = pending.pop().filter(|_| !cx.has_reported_too_much()) {
        if expr.is_parenthesized() {
            continue;
        }
        match expr.kind() {
            ExprKind::String(value) if options.is_allowed_string(value.bytes()) => {}
            ExprKind::String(_) | ExprKind::Template(_) => drop(cx.report(attr, LITERAL_ATTRIBUTE)),
            ExprKind::Binary { op, left, right }
                if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma) =>
            {
                pending.extend([left, right]);
            }
            _ => {}
        }
    }
}

fn inspect_element_attributes<'a>(jsx: Jsx<'a>, options: &JsxNoLiteralsOptions, cx: &Cx<'a, JsxNoLiterals>) {
    let looks_at_strings = !options.restricted_attributes.is_empty()
        || !options.ignore_props && (options.no_attribute_strings || options.no_strings);
    if !looks_at_strings {
        return;
    }
    for attr in jsx.attrs() {
        match get_prop_value(attr) {
            Some(AttributeValue::StringLiteral(str_literal)) => {
                if options.is_allowed_string(str_literal.value) {
                    continue;
                }
                // Of `a:b` it is `b`.
                let name = attr.key().and_then(Key::name).map(Name::bytes).unwrap_or_default();
                let attr_name = strings::split_once_char(name, b':').map_or(name, |it| it.1);
                if options.restricted_attributes.iter().any(|restricted| **restricted == *attr_name) {
                    cx.report(attr, RESTRICTED_ATTRIBUTE);
                } else if !options.ignore_props && (options.no_attribute_strings || options.no_strings) {
                    cx.report(attr, LITERAL_ATTRIBUTE);
                }
            }
            Some(AttributeValue::ExpressionContainer(expr)) if options.no_strings && !options.ignore_props => {
                inspect_jsx_expression(expr, options, attr, cx);
            }
            _ => {}
        }
    }
}
