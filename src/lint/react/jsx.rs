//! The half of oxlint's `utils/react.rs` that is about the names and the attributes of JSX elements, on the handles. Each function
//! has the name that it has there.
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
//! Text is bytes. The value of `a="b"` and the text between tags are as they are written: oxc does not replace `&amp;` in them.

use bun_lint::prelude::*;
use smallvec::SmallVec;
use std::borrow::Cow;

/// The element that `e` is: what a rule of oxlint gets as `AstKind::JSXElement` or `AstKind::JSXOpeningElement`. `None` for
/// `<>..</>` and for anything else.
pub(crate) fn as_jsx_element(e: Expr<'_>) -> Option<Jsx<'_>> {
    match e.kind() {
        ExprKind::Jsx(jsx) if !jsx.is_fragment() => Some(jsx),
        _ => None,
    }
}

/// The `"b"` of `a="b"`.
#[derive(Copy, Clone)]
pub(crate) struct StringLiteral<'a> {
    /// What is between the quotes, as it is written.
    pub(crate) value: &'a [u8],
    /// With the quotes.
    pub(crate) span: Span,
}

/// `JSXAttributeValue`
#[derive(Copy, Clone)]
pub(crate) enum AttributeValue<'a> {
    /// `a="b"`
    StringLiteral(StringLiteral<'a>),
    /// `a={b}`: the `b`, which can be in parentheses, where oxc has a `ParenthesizedExpression`. For `a={}`, where oxc has a
    /// `JSXEmptyExpression`, it is `Missing`: see [`AttributeValue::as_expression`].
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

    /// The `container.expression.as_expression()` of an `ExpressionContainer`: the `b` of `a={b}`. `None` for `a={}`.
    pub(crate) fn as_expression(self) -> Option<Expr<'a>> {
        match self {
            AttributeValue::ExpressionContainer(e) if !e.is_missing() => Some(e),
            _ => None,
        }
    }

    /// With the quotes or the braces.
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
    /// The text as it is written, with all its whitespace. It is never empty.
    Text(&'a [u8]),
    Element(Jsx<'a>),
    Fragment(Jsx<'a>),
    /// `{e}`: the `e`, which can be in parentheses. It is `Missing` for `{}`.
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

/// The first attribute that is named `target_prop`. A name with a namespace (`a:b`) is never found.
pub(crate) fn has_jsx_prop<'a>(node: Jsx<'a>, target_prop: &str) -> Option<Prop<'a>> {
    let is_it = |name: &[u8]| name == target_prop.as_bytes() && is_identifier(name);
    node.attrs()
        .iter()
        .find(|attr| get_jsx_attribute_name(*attr).is_some_and(is_it))
}

/// The same, where `onClick` is also `onclick`: ASCII letters compare without their case.
pub(crate) fn has_jsx_prop_ignore_case<'a>(node: Jsx<'a>, target_prop: &str) -> Option<Prop<'a>> {
    has_jsx_prop_ignore_case_bytes(node, target_prop.as_bytes())
}

fn has_jsx_prop_ignore_case_bytes<'a>(node: Jsx<'a>, target_prop: &[u8]) -> Option<Prop<'a>> {
    node.attrs()
        .iter()
        .find(|attr| is_identifier_ignore_case(*attr, target_prop))
}

/// `JSXAttribute::is_identifier_ignore_case`: whether the attribute is named `name`, but for the case of ASCII letters. Never for
/// `{...a}` and `a:b`.
pub(crate) fn is_identifier_ignore_case(attr: Prop, name: &[u8]) -> bool {
    get_jsx_attribute_name(attr)
        .is_some_and(|it| it.eq_ignore_ascii_case(name) && is_identifier(it))
}

/// What is after the `=` of an attribute. `None` for `a` alone and for `{...a}`.
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

/// The name of an attribute: `a`, `a-b`, `a:b`, the last without blanks around the colon. `None` for `{...a}`.
pub(crate) fn get_jsx_attribute_name(attr: Prop<'_>) -> Option<&[u8]> {
    Some(attr.key()?.name()?.bytes())
}

/// The `b` of `a="b"`. `None` for `a={"b"}`.
pub(crate) fn get_string_literal_prop_value(item: Prop<'_>) -> Option<&[u8]> {
    Some(get_prop_value(item)?.as_string_literal()?.value)
}

/// The name in the tag: `Foo`, `a-b`, `Foo.Bar.baz`, `this`, `this.Foo`, `a:b`. Empty for a fragment.
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
    // Nearly always it is written without blanks and comments.
    let written = member.text();
    if written.len() + 1 == parts.iter().map(|it| it.len() + 1).sum::<usize>() {
        return Cow::Borrowed(written);
    }
    parts.reverse();
    Cow::Owned(parts.join(&b"."[..]))
}

/// `settings["jsx-a11y"]`
fn jsx_a11y_settings<'a>(file: &'a File<'a>) -> Option<&'a Json> {
    file.settings().get(b"jsx-a11y")
}

/// `settings["jsx-a11y"].attributes[name]`: the names that the attribute `name` of the DOM goes by, which are strings.
pub(crate) fn get_attribute_names_of_settings<'a>(
    file: &'a File<'a>,
    name: &str,
) -> Option<&'a [Json]> {
    jsx_a11y_settings(file)?
        .get(b"attributes")?
        .get(name.as_bytes())?
        .as_array()
}

/// What kind of element it is for the rules of `jsx-a11y`. That is [its name](get_jsx_element_name), or if
/// `settings["jsx-a11y"].polymorphicPropName` is `as`, the `b` of its `as="b"`; and if `settings["jsx-a11y"].components` has that as
/// a key, what it has for it.
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

/// The number that the value of an attribute is: `"1"`, `{1}`, `{-1}`, `{"1"}`, `` {`1`} ``, `{a ? 1 : 2}`, of which it is the `1`
/// unless `a` is known to be falsy. A string is read as Rust's `str::parse::<f64>` reads it. `None` where oxlint has `Err(())`.
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

/// `oxc_ecmascript`'s `ToBoolean::to_boolean(&WithoutGlobalReferenceInformation {})`: whether a literal is truthy. `None` for
/// everything else, also for `undefined`, `NaN`, and for what is in parentheses.
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
        // The last of a sequence is no sequence, unless it is in parentheses.
        ExprKind::Binary {
            op: BinOp::Comma,
            right,
            ..
        } => to_boolean(right),
        _ => None,
    }
}

/// `raw`: a `BigInt` as it is written.
pub(crate) fn is_zero_bigint(raw: &[u8]) -> bool {
    let digits = match raw {
        [b'0', b'x' | b'X' | b'o' | b'O' | b'b' | b'B', rest @ ..] => rest,
        _ => raw,
    };
    digits.iter().all(|b| matches!(b, b'0' | b'_' | b'n'))
}

/// `JSXExpression::is_undefined`, `Expression::is_undefined`: the identifier `undefined`, not in parentheses.
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
