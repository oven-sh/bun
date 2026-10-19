use bun_lint_oxlint::ast_util::{get_declaration_of_variable, static_name};
use crate::jsx::{AttributeValue, get_prop_value};
use crate::react::{is_create_element_call, is_jsx};
use crate::util_is_create_element::is_create_element;
use crate::util_pragma::get_from_context;
use crate::util_variable::{Found, find_variable_by_name};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::IdMap;
use smallvec::SmallVec;
use std::cell::OnceCell;

/// Enforce style prop value is an object
pub struct StylePropObject {
    allow: Vec<Box<[u8]>>,
}

const STYLE_PROP_NOT_OBJECT: Message = Message::new("stylePropNotObject", "Style prop value must be an object");
const STYLE_PROP_OBJECT: Message = Message::new("", "`style` prop value must be an object.");

#[derive(Default)]
pub struct State<'a> {
    /// For oxlint: true if the variable's declaration shows it isn't an object.
    invalid_variables: IdMap<Symbol<'a>, bool>,
    /// The pragma. oxlint doesn't use one.
    pragma: OnceCell<&'a [u8]>,
}

impl Rule for StylePropObject {
    const META: Meta = Meta::plugin(Plugin::React, "style-prop-object", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        StylePropObject {
            allow: options.object(0).strings("allow").into_iter().map(|it| it.as_bytes().into()).collect(),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]);
        // Upstream treats `React.#createElement()` as a `createElement` call.
        match file.mentions("createElement") || (!file.language().is_oxlint && file.mentions("#createElement")) {
            true => on.calls_named(&["createElement"]),
            false => on,
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        // oxlint doesn't run the rule on files that can't contain JSX.
        if !file.mentions("style") || (file.language().is_oxlint && !is_jsx(file)) {
            return None;
        }
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => self.jsx(e, cx),
            ExprTag::Call => self.call(e, cx),
            _ => {}
        }
    }
}

impl StylePropObject {
    fn jsx<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        for attribute in jsx.attrs().iter().filter(|it| it.key().is_some_and(|key| key.is("style"))) {
            let Some(value) = get_prop_value(attribute) else {
                continue;
            };
            // oxlint reports at the value.
            let whole = if is_oxlint { value.span() } else { attribute.span() };
            let report_span = match value {
                AttributeValue::StringLiteral(_) => Some(whole),
                AttributeValue::ExpressionContainer(_) => {
                    value.as_expression().and_then(|it| invalid_value_span(it, whole, cx))
                }
                // oxlint allows an element.
                AttributeValue::Element(_) | AttributeValue::Fragment(_) => (!is_oxlint).then_some(whole),
            };
            let Some(report_span) = report_span else {
                continue;
            };
            let name = match jsx.tag().map(Expr::kind) {
                Some(ExprKind::Ident(name) | ExprKind::String(name)) => {
                    Some(name.bytes()).filter(|it| !strings::contains_char(it, b':'))
                }
                Some(ExprKind::This) if !is_oxlint => Some(&b"this"[..]),
                _ => None,
            };
            // oxlint doesn't check `<a.b>`, `<a:b>` or `<this>`.
            if !name.map_or(is_oxlint, |name| self.allows(name)) {
                cx.report(report_span, message(is_oxlint));
            }
        }
    }

    fn call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // oxlint has nodes for parentheses, so it doesn't match a parenthesized argument.
        let is_seen = |it: &Expr<'a>| !is_oxlint || !it.is_parenthesized();
        let arguments = call.args();
        let Some(ExprKind::Object(properties)) = arguments.get(1).filter(is_seen).map(Expr::kind) else {
            return;
        };
        let name = match arguments.first().filter(is_seen).map(Expr::kind) {
            Some(ExprKind::Ident(name)) => Some(name),
            // Upstream only applies `allow` to an identifier.
            Some(ExprKind::String(name)) if is_oxlint => Some(name),
            _ => None,
        };
        // oxlint only checks calls whose first argument is an identifier or a string.
        if name.map_or(is_oxlint, |name| self.allows(name.bytes())) {
            return;
        }
        // oxlint accepts `createElement` on anything but `document`.
        let is_creation = match is_oxlint {
            true => is_create_element_call(call),
            false => is_create_element(e, cx.state.pragma.get_or_init(|| get_from_context(cx.file()))),
        };
        if !is_creation {
            return;
        }
        let is_style = |it: &Prop<'a>| {
            it.key().is_some_and(|key| match is_oxlint {
                // oxlint also matches `"style"` and `["style"]`.
                true => static_name(key).is_some_and(|name| name.is("style")),
                false => matches!(key.kind(), KeyKind::Ident(name) if name.is("style")),
            })
        };
        // Upstream only checks the first one.
        let check_limit = if is_oxlint { usize::MAX } else { 1 };
        for value in properties.iter().filter(is_style).take(check_limit).filter_map(Prop::value) {
            if let Some(report_span) = invalid_value_span(value, value.span(), cx) {
                cx.report(report_span, message(is_oxlint));
            }
        }
    }

    fn allows(&self, name: &[u8]) -> bool {
        self.allow.iter().any(|it| **it == *name)
    }
}

fn message(is_oxlint: bool) -> Message {
    if is_oxlint { STYLE_PROP_OBJECT } else { STYLE_PROP_NOT_OBJECT }
}

fn is_non_nullary_literal(expression: Expr) -> bool {
    ast_utils::is_literal(expression) && expression.tag() != ExprTag::Null
}

/// Returns where to report `value` (an expression in braces or a property value) if it isn't an object. A literal is
/// reported at `whole`.
fn invalid_value_span<'a>(value: Expr<'a>, whole: Span, cx: &mut Cx<'a, StylePropObject>) -> Option<Span> {
    if cx.language().is_oxlint {
        return is_invalid_expression(value, &mut cx.state).then_some(whole);
    }
    let Some(name) = value.as_ident() else {
        return is_non_nullary_literal(value).then_some(whole);
    };
    // Upstream's `checkIdentifiers` follows one level of variables, and reports at the use.
    matches!(find_variable_by_name(Node::Expr(value), name), Some(Found::Init(init)) if is_non_nullary_literal(init))
        .then(|| value.span())
}

fn is_invalid_type(ty: TypeNode) -> bool {
    let is_invalid_keyword = |ty: TypeNode| {
        matches!(ty.kind(), TypeKind::Keyword(Keyword::Number | Keyword::String | Keyword::Boolean))
            && !ty.is_parenthesized()
    };
    // Parenthesized types aren't looked into, so an intersection only needs its keywords checked, and a union only its
    // keywords and intersections.
    let is_invalid_intersection = |ty: TypeNode| {
        matches!(ty.kind(), TypeKind::Intersection(types)
            if !ty.is_parenthesized() && types.iter().any(is_invalid_keyword))
    };
    is_invalid_keyword(ty)
        || is_invalid_intersection(ty)
        || matches!(ty.kind(), TypeKind::Union(types)
            if !ty.is_parenthesized() && types.iter().any(|it| is_invalid_keyword(it) || is_invalid_intersection(it)))
}

/// For oxlint: true for a string, a boolean, a template, or a variable initialized with one of these or with another
/// such variable.
fn is_invalid_expression<'a>(expression: Expr<'a>, state: &mut State<'a>) -> bool {
    let mut passed: SmallVec<[Symbol<'a>; 4]> = SmallVec::new();
    let mut at = expression;
    let is_invalid = loop {
        if at.is_parenthesized() {
            break false;
        }
        match at.tag() {
            ExprTag::String | ExprTag::True | ExprTag::False | ExprTag::Template => break true,
            ExprTag::Ident => {}
            _ => break false,
        }
        let Some(symbol) = at.symbol() else {
            break false;
        };
        // A variable counts as valid until its result is known, which ends the loop for one that's initialized with
        // itself.
        if let Some(&known) = state.invalid_variables.get(symbol) {
            break known;
        }
        state.invalid_variables.insert(symbol, false);
        passed.push(symbol);
        let Some(Node::VarDecl(declarator)) = get_declaration_of_variable(at).and_then(Declaration::node) else {
            break false;
        };
        if let Some(ty) = declarator.ty() {
            break is_invalid_type(ty);
        }
        match declarator.init() {
            Some(init) => at = init,
            None => break false,
        }
    };
    if is_invalid {
        state.invalid_variables.extend(passed.into_iter().map(|symbol| (symbol, true)));
    }
    is_invalid
}
