//! The half of oxlint's `utils/react.rs` that deals with JSX element names and attributes, ported to this linter's AST
//! handles. Each function keeps oxlint's name.
//!
//! | oxc | here |
//! |---|---|
//! | `JSXElement`, `JSXOpeningElement` | [`Jsx`], from [`as_jsx_element`]. Their spans: `e.span()`, `jsx.opening_span()` |
//! | `JSXFragment` | the same with `jsx.is_fragment()`. No function here is meant to be called with one |
//! | `JSXAttributeItem` | [`Prop`]. `SpreadAttribute`: `prop.kind() == PropKind::Spread` |
//! | `JSXAttribute::name` | [`get_jsx_attribute_name`], its span `prop.key()?.span(file)` |
//! | `JSXAttributeValue` | [`AttributeValue`], from [`get_prop_value`] |
//! | `JSXChild` | [`Child`], from [`children`] |
//!
//! Text is bytes. The value of `a="b"` and the text between tags are kept as written, because oxc doesn't decode
//! `&amp;` in them.

use bun_lint::prelude::*;
use smallvec::SmallVec;
use std::borrow::Cow;

/// Returns `e` as an element: what an oxlint rule gets as `AstKind::JSXElement` or `AstKind::JSXOpeningElement`. `None`
/// for `<>..</>` and anything else.
pub(crate) fn as_jsx_element(e: Expr<'_>) -> Option<Jsx<'_>> {
    match e.kind() {
        ExprKind::Jsx(jsx) if !jsx.is_fragment() => Some(jsx),
        _ => None,
    }
}

/// The `"b"` in `a="b"`.
#[derive(Copy, Clone)]
pub(crate) struct StringLiteral<'a> {
    /// The text between the quotes, as written.
    pub(crate) value: &'a [u8],
    /// Includes the quotes.
    pub(crate) span: Span,
}

/// `JSXAttributeValue`
#[derive(Copy, Clone)]
pub(crate) enum AttributeValue<'a> {
    /// `a="b"`
    StringLiteral(StringLiteral<'a>),
    /// `a={b}`: the `b`, which can be parenthesized, where oxc has a `ParenthesizedExpression`. For `a={}`, where oxc
    /// has a `JSXEmptyExpression`, it's `Missing`: see [`AttributeValue::as_expression`].
    ExpressionContainer(Expr<'a>),
    /// `a=<b />`
    Element(Expr<'a>),
    /// `a=<></>`
    Fragment(Expr<'a>),
}

impl<'a> AttributeValue<'a> {
    /// `JSXAttributeValue::as_string_literal`
    pub(crate) fn as_string_literal(self) -> Option<StringLiteral<'a>> {
        match self {
            AttributeValue::StringLiteral(literal) => Some(literal),
            _ => None,
        }
    }

    /// An `ExpressionContainer`'s `container.expression.as_expression()`: the `b` in `a={b}`. `None` for `a={}`.
    pub(crate) fn as_expression(self) -> Option<Expr<'a>> {
        match self {
            AttributeValue::ExpressionContainer(e) if !e.is_missing() => Some(e),
            _ => None,
        }
    }

    /// Includes the quotes or the braces.
    pub(crate) fn span(self) -> Span {
        match self {
            AttributeValue::StringLiteral(literal) => literal.span,
            AttributeValue::ExpressionContainer(e) => {
                e.jsx_container_span().unwrap_or_else(|| e.outer_span())
            }
            AttributeValue::Element(e) | AttributeValue::Fragment(e) => e.span(),
        }
    }
}

/// `JSXChild`
#[derive(Copy, Clone)]
pub(crate) enum Child<'a> {
    /// The text as written, with all its whitespace. Never empty.
    Text(&'a [u8]),
    Element(Jsx<'a>),
    Fragment(Jsx<'a>),
    /// `{e}`: the `e`, which can be parenthesized. It's `Missing` for `{}`.
    ExpressionContainer(Expr<'a>),
    /// `{...e}`
    Spread,
}

/// `JSXElement::children`, `JSXFragment::children`
pub(crate) fn children<'a>(file: &'a File<'a>, jsx: Jsx<'a>) -> impl Iterator<Item = Child<'a>> {
    jsx.children_with_whitespace()
        .map(move |child| match child {
            JsxChild::Whitespace(span) => Child::Text(file.slice(span)),
            JsxChild::Expr(e) => match e.kind() {
                ExprKind::Spread(_) if e.jsx_container_span().is_some() => Child::Spread,
                _ if e.jsx_container_span().is_some() => Child::ExpressionContainer(e),
                ExprKind::Jsx(jsx) if jsx.is_fragment() => Child::Fragment(jsx),
                ExprKind::Jsx(jsx) => Child::Element(jsx),
                _ => Child::Text(e.text()),
            },
        })
}

/// `JSXAttributeName::Identifier`, as opposed to `a:b`.
fn is_identifier(name: &[u8]) -> bool {
    !bun_core::strings::contains_char(name, b':')
}

/// Returns the first attribute named `target_prop`. Never matches a namespaced name (`a:b`).
pub(crate) fn has_jsx_prop<'a>(node: Jsx<'a>, target_prop: &str) -> Option<Prop<'a>> {
    let is_target = |name: &[u8]| name == target_prop.as_bytes() && is_identifier(name);
    node.attrs()
        .iter()
        .find(|attr| get_jsx_attribute_name(*attr).is_some_and(is_target))
}

/// Like [`has_jsx_prop`], but ASCII case-insensitive: `onClick` also matches `onclick`.
pub(crate) fn has_jsx_prop_ignore_case<'a>(node: Jsx<'a>, target_prop: &str) -> Option<Prop<'a>> {
    has_jsx_prop_ignore_case_bytes(node, target_prop.as_bytes())
}

fn has_jsx_prop_ignore_case_bytes<'a>(node: Jsx<'a>, target_prop: &[u8]) -> Option<Prop<'a>> {
    node.attrs()
        .iter()
        .find(|attr| is_identifier_ignore_case(*attr, target_prop))
}

/// `JSXAttribute::is_identifier_ignore_case`: true if the attribute is named `name`, ignoring ASCII case. Never true
/// for `{...a}` or `a:b`.
pub(crate) fn is_identifier_ignore_case(attr: Prop, name: &[u8]) -> bool {
    get_jsx_attribute_name(attr)
        .is_some_and(|it| it.eq_ignore_ascii_case(name) && is_identifier(it))
}

/// Returns what follows an attribute's `=`. `None` for a bare `a` and for `{...a}`.
pub(crate) fn get_prop_value(item: Prop<'_>) -> Option<AttributeValue<'_>> {
    if item.kind() == PropKind::Spread {
        return None;
    }
    let value = item.value()?;
    if value.jsx_container_span().is_some() {
        return Some(AttributeValue::ExpressionContainer(value));
    }
    Some(match value.kind() {
        ExprKind::Jsx(jsx) if jsx.is_fragment() => AttributeValue::Fragment(value),
        ExprKind::Jsx(_) => AttributeValue::Element(value),
        _ => {
            let span = value.span();
            AttributeValue::StringLiteral(StringLiteral {
                value: item.file().slice(span.shrink(1, 1)),
                span,
            })
        }
    })
}

/// Returns an attribute's name: `a`, `a-b`, `a:b`, the last without whitespace around the colon. `None` for `{...a}`.
pub(crate) fn get_jsx_attribute_name(attr: Prop<'_>) -> Option<&[u8]> {
    Some(attr.key()?.name()?.bytes())
}

/// Returns the `b` in `a="b"`. `None` for `a={"b"}`.
pub(crate) fn get_string_literal_prop_value(item: Prop<'_>) -> Option<&[u8]> {
    Some(get_prop_value(item)?.as_string_literal()?.value)
}

/// Returns the tag name: `Foo`, `a-b`, `Foo.Bar.baz`, `this`, `this.Foo`, `a:b`. Empty for a fragment.
pub(crate) fn get_jsx_element_name(node: Jsx<'_>) -> Cow<'_, [u8]> {
    let Some(tag) = node.tag() else {
        return Cow::Borrowed(b"".as_slice());
    };
    match tag.kind() {
        ExprKind::Ident(name) | ExprKind::String(name) => Cow::Borrowed(name.bytes()),
        ExprKind::Dot { .. } => get_jsx_mem_expr_name(tag),
        _ => Cow::Borrowed(b"this".as_slice()),
    }
}

fn get_jsx_mem_expr_name(member: Expr<'_>) -> Cow<'_, [u8]> {
    let mut parts: SmallVec<[&[u8]; 4]> = SmallVec::new();
    let mut at = member;
    while let ExprKind::Dot { obj, name, .. } = at.kind() {
        parts.push(name.bytes());
        at = obj;
    }
    parts.push(at.as_ident().map_or(b"this".as_slice(), Name::bytes));
    // Fast path: it's nearly always written without whitespace or comments.
    let source_text = member.text();
    if source_text.len() + 1 == parts.iter().map(|it| it.len() + 1).sum::<usize>() {
        return Cow::Borrowed(source_text);
    }
    parts.reverse();
    Cow::Owned(parts.join(&b"."[..]))
}

/// `settings["jsx-a11y"]`
fn jsx_a11y_settings<'a>(file: &'a File<'a>) -> Option<&'a Json> {
    file.settings().get(b"jsx-a11y")
}

/// `settings["jsx-a11y"].attributes[name]`: the names that stand for the DOM attribute `name`. Only strings are
/// returned.
pub(crate) fn get_attribute_names_from_settings<'a>(
    file: &'a File<'a>,
    name: &str,
) -> Option<&'a [Json]> {
    jsx_a11y_settings(file)?
        .get(b"attributes")?
        .get(name.as_bytes())?
        .as_array()
}

/// Returns the element's type for the `jsx-a11y` rules. That's [its name](get_jsx_element_name), or, if
/// `settings["jsx-a11y"].polymorphicPropName` is `as`, the `b` in its `as="b"`. If `settings["jsx-a11y"].components`
/// has that as a key, the mapped value is used instead.
pub(crate) fn get_element_type<'a>(file: &'a File<'a>, element: Jsx<'a>) -> Cow<'a, [u8]> {
    let Some(settings) = jsx_a11y_settings(file) else {
        return get_jsx_element_name(element);
    };
    let polymorphic_prop = (settings.get(b"polymorphicPropName").and_then(Json::as_str))
        .and_then(|name| has_jsx_prop_ignore_case_bytes(element, name))
        .and_then(get_string_literal_prop_value);
    let raw_type = polymorphic_prop.map_or_else(|| get_jsx_element_name(element), Cow::Borrowed);
    match settings
        .get(b"components")
        .and_then(|it| it.get(&raw_type)?.as_str())
    {
        Some(component) => Cow::Borrowed(component),
        None => raw_type,
    }
}

/// Returns an attribute value as a number: `"1"`, `{1}`, `{-1}`, `{"1"}`, `` {`1`} ``, and `{a ? 1 : 2}`, which
/// evaluates to the `1` unless `a` is known to be falsy. A string is parsed like Rust's `str::parse::<f64>`. `None`
/// where oxlint has `Err(())`.
pub(crate) fn parse_jsx_value(value: AttributeValue) -> Option<f64> {
    match value {
        AttributeValue::StringLiteral(literal) => parse_number(literal.value),
        _ => parse_expression(value.as_expression()?),
    }
}

fn parse_number(text: &[u8]) -> Option<f64> {
    std::str::from_utf8(text).ok()?.parse().ok()
}

fn parse_expression(expression: Expr) -> Option<f64> {
    let mut at = expression;
    loop {
        if at.is_parenthesized() {
            return None;
        }
        return match at.kind() {
            ExprKind::String(value) => parse_number(value.bytes()),
            ExprKind::Template(template) => parse_number(template.raw(0)),
            ExprKind::Number(value) => Some(value),
            ExprKind::Unary { op, operand } if !operand.is_parenthesized() => {
                match (op, operand.kind()) {
                    (UnOp::Plus, ExprKind::Number(value)) => Some(value),
                    (UnOp::Minus, ExprKind::Number(value)) => Some(-value),
                    _ => None,
                }
            }
            ExprKind::Cond { test, yes, no } => {
                at = if to_boolean(test).unwrap_or(true) {
                    yes
                } else {
                    no
                };
                continue;
            }
            _ => None,
        };
    }
}

/// `oxc_ecmascript`'s `ToBoolean::to_boolean(&WithoutGlobalReferenceInformation {})`: whether a literal is truthy.
/// `None` for everything else, including `undefined`, `NaN` and anything parenthesized.
pub(crate) fn to_boolean(e: Expr) -> Option<bool> {
    if e.is_parenthesized() {
        return None;
    }
    match e.kind() {
        ExprKind::Regex(_)
        | ExprKind::Array(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::New(_)
        | ExprKind::Object(_) => Some(true),
        ExprKind::Null | ExprKind::False => Some(false),
        ExprKind::True => Some(true),
        ExprKind::Number(value) => Some(!value.is_nan() && value != 0.0),
        ExprKind::BigInt(_) => Some(!is_zero_bigint(e.text())),
        ExprKind::String(value) => Some(!value.bytes().is_empty()),
        ExprKind::Template(template) => template
            .as_static()
            .map(|cooked| !cooked.bytes().is_empty()),
        // The last operand of a sequence isn't itself a sequence unless it's parenthesized.
        ExprKind::Binary {
            op: BinOp::Comma,
            right,
            ..
        } => to_boolean(right),
        _ => None,
    }
}

/// `raw`: a `BigInt` literal as written.
pub(crate) fn is_zero_bigint(raw: &[u8]) -> bool {
    let digits = match raw {
        [b'0', b'x' | b'X' | b'o' | b'O' | b'b' | b'B', rest @ ..] => rest,
        _ => raw,
    };
    digits.iter().all(|b| matches!(b, b'0' | b'_' | b'n'))
}

/// `JSXExpression::is_undefined`, `Expression::is_undefined`: the identifier `undefined`, not parenthesized.
pub(crate) fn is_undefined(e: Expr) -> bool {
    e.is_ident("undefined") && !e.is_parenthesized()
}

/// `<Fragment>` or `<React.Fragment>`. Not `<>`.
pub(crate) fn is_jsx_fragment(elem: Jsx) -> bool {
    elem.tag().is_some_and(|tag| match tag.kind() {
        ExprKind::Ident(name) => name.is("Fragment"),
        ExprKind::Dot { obj, name, .. } => obj.is_ident("React") && name.name().is("Fragment"),
        _ => false,
    })
}
