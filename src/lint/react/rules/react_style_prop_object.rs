use bun_lint_oxlint::ast_util::{get_declaration_of_variable, static_name};
use crate::jsx::{AttributeValue, get_prop_value};
use crate::react::{is_create_element_call, is_jsx};
use crate::util_is_create_element::is_create_element;
use crate::util_pragma::get_from_context;
use crate::util_variable::{Found, find_variable_by_name};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
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
    /// For oxlint: whether a variable is declared with something that is not an object.
    invalid_variables: FxHashMap<Symbol<'a>, bool>,
    /// The pragma. oxlint knows none.
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
        // For upstream `React.#createElement()` is a call of `createElement`.
        match file.mentions("createElement") || (!file.language().is_oxlint && file.mentions("#createElement")) {
            true => on.exprs(&[ExprTag::Call]),
            false => on,
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        // oxlint does not run the rule on a file that cannot have JSX.
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
            // oxlint points at the value.
            let whole = if is_oxlint { value.span() } else { attribute.span() };
            let place = match value {
                AttributeValue::StringLiteral(_) => Some(whole),
                AttributeValue::ExpressionContainer(_) => {
                    value.as_expression().and_then(|it| place_of_invalid(it, whole, cx))
                }
                // oxlint lets an element pass.
                AttributeValue::Element(_) | AttributeValue::Fragment(_) => (!is_oxlint).then_some(whole),
            };
            let Some(place) = place else {
                continue;
            };
            let name = match jsx.tag().map(Expr::kind) {
                Some(ExprKind::Ident(name) | ExprKind::String(name)) => {
                    Some(name.bytes()).filter(|it| !strings::contains_char(it, b':'))
                }
                Some(ExprKind::This) if !is_oxlint => Some(&b"this"[..]),
                _ => None,
            };
            // oxlint does not look at `<a.b>`, `<a:b>` and `<this>`.
            if !name.map_or(is_oxlint, |name| self.allows(name)) {
                cx.report(place, message(is_oxlint));
            }
        }
    }

    fn call<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // oxlint has a node for parentheses.
        let is_seen = |it: &Expr<'a>| !is_oxlint || !it.is_parenthesized();
        let arguments = call.args();
        let Some(ExprKind::Object(properties)) = arguments.get(1).filter(is_seen).map(Expr::kind) else {
            return;
        };
        let name = match arguments.first().filter(is_seen).map(Expr::kind) {
            Some(ExprKind::Ident(name)) => Some(name),
            // For upstream what is allowed is a name.
            Some(ExprKind::String(name)) if is_oxlint => Some(name),
            _ => None,
        };
        // oxlint looks at nothing but a name and a string.
        if name.map_or(is_oxlint, |name| self.allows(name.bytes())) {
            return;
        }
        // oxlint takes the `createElement` of everything but `document`.
        let is_creation = match is_oxlint {
            true => is_create_element_call(call),
            false => is_create_element(e, cx.state.pragma.get_or_init(|| get_from_context(cx.file()))),
        };
        if !is_creation {
            return;
        }
        let is_style = |it: &Prop<'a>| {
            it.key().is_some_and(|key| match is_oxlint {
                // oxlint: also `"style"` and `["style"]`.
                true => static_name(key).is_some_and(|name| name.is("style")),
                false => matches!(key.kind(), KeyKind::Ident(name) if name.is("style")),
            })
        };
        // Upstream looks at the first.
        let looked_at = if is_oxlint { usize::MAX } else { 1 };
        for value in properties.iter().filter(is_style).take(looked_at).filter_map(Prop::value) {
            if let Some(place) = place_of_invalid(value, value.span(), cx) {
                cx.report(place, message(is_oxlint));
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

/// upstream's `isNonNullaryLiteral`
fn is_non_nullary_literal(expression: Expr) -> bool {
    ast_utils::is_literal(expression) && expression.tag() != ExprTag::Null
}

/// Where `value`, which is in braces or the value of a property, is reported if it is no object: a literal at `whole`.
fn place_of_invalid<'a>(value: Expr<'a>, whole: Span, cx: &mut Cx<'a, StylePropObject>) -> Option<Span> {
    if cx.language().is_oxlint {
        return is_invalid_expression(value, &mut cx.state).then_some(whole);
    }
    let Some(name) = value.as_ident() else {
        return is_non_nullary_literal(value).then_some(whole);
    };
    // upstream's `checkIdentifiers`: one step, and the variable is reported where it is used.
    matches!(find_variable_by_name(Node::Expr(value), name), Some(Found::Init(init)) if is_non_nullary_literal(init))
        .then(|| value.span())
}

fn is_invalid_type(ty: TypeNode) -> bool {
    let is_invalid_keyword = |ty: TypeNode| {
        matches!(ty.kind(), TypeKind::Keyword(Keyword::Number | Keyword::String | Keyword::Boolean))
            && !ty.is_parenthesized()
    };
    // What is in parentheses is not looked into, so there is nothing but keywords in an intersection, and nothing but
    // these two in a union.
    let is_invalid_intersection = |ty: TypeNode| {
        matches!(ty.kind(), TypeKind::Intersection(types)
            if !ty.is_parenthesized() && types.iter().any(is_invalid_keyword))
    };
    is_invalid_keyword(ty)
        || is_invalid_intersection(ty)
        || matches!(ty.kind(), TypeKind::Union(types)
            if !ty.is_parenthesized() && types.iter().any(|it| is_invalid_keyword(it) || is_invalid_intersection(it)))
}

/// For oxlint: a string, a boolean, a template, or a variable that is declared with one of these or such a variable.
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
        // Until it is known, a variable that is declared with itself is valid.
        if let Some(&known) = state.invalid_variables.get(&symbol) {
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
