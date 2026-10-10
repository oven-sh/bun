use crate::util_is_create_element::is_create_element;
use crate::util_pragma::get_from_context;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow adjacent inline elements not separated by whitespace.
pub struct NoAdjacentInlineElements;

const INLINE_ELEMENT: Message = Message::new(
    "inlineElement",
    "Child elements which render as inline HTML elements should be separated by a space or wrapped in block level \
     elements.",
);

/// `inlineNames.indexOf(name) > -1`
fn is_inline_name(name: Name<'_>) -> bool {
    matches!(
        name.bytes(),
        b"a" | b"b" | b"big" | b"i" | b"small" | b"tt" | b"abbr" | b"acronym" | b"cite" | b"code" | b"dfn" | b"em"
            | b"kbd" | b"strong" | b"samp" | b"time" | b"var" | b"bdo" | b"br" | b"img" | b"map" | b"object" | b"q"
            | b"script" | b"span" | b"sub" | b"sup" | b"button" | b"input" | b"label" | b"select" | b"textarea"
    )
}

/// Whether a call of `createElement` can be in the file: `a.#createElement()` is one.
fn mentions_create_element(file: &File) -> bool {
    file.mentions("createElement") || file.mentions("#createElement")
}

/// `isInline` of a `JSXElement`.
fn is_inline_element(node: Expr<'_>) -> bool {
    match (node.tag() == ExprTag::Jsx).then(|| node.kind()) {
        Some(ExprKind::Jsx(jsx)) => jsx.tag().and_then(Expr::as_ident).is_some_and(is_inline_name),
        _ => false,
    }
}

/// `isInline`, of an element of an array. `None` where upstream throws: a hole, a call without arguments.
fn is_inline(node: Expr<'_>) -> Option<bool> {
    Some(match node.kind() {
        ExprKind::Missing => return None,
        ExprKind::String(value) => {
            strings::js_whitespace_len(value.bytes()) == 0 && strings::js_whitespace_len_back(value.bytes()) == 0
        }
        // As a string none of these has white space at an end.
        ExprKind::Number(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex(_)
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Null => true,
        ExprKind::Jsx(_) => is_inline_element(node),
        ExprKind::Call(call) if !node.is_chain_root() => call.args().first()?.as_string().is_some_and(is_inline_name),
        _ => false,
    })
}

impl Rule for NoAdjacentInlineElements {
    const META: Meta = Meta::plugin(Plugin::React, "no-adjacent-inline-elements", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    /// The pragma.
    type State<'a> = &'a [u8];

    fn new(_: &Options) -> Self {
        NoAdjacentInlineElements
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]);
        if !mentions_create_element(file) {
            return on;
        }
        on.exprs(&[ExprTag::Call])
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<&'a [u8]> {
        Some(if mentions_create_element(file) { get_from_context(file) } else { &b"React"[..] })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.kind() {
            // Text, white space and braces are children that are not inline: two elements have to touch.
            ExprKind::Jsx(jsx) if !jsx.is_fragment() => {
                let children = jsx.children();
                let mut pairs = children.iter().zip(children.iter().skip(1));
                if pairs.any(|(previous, current)| {
                    is_inline_element(previous)
                        && is_inline_element(current)
                        && previous.span().end == current.span().start
                }) {
                    cx.report(e, INLINE_ELEMENT);
                }
            }
            ExprKind::Call(call) => {
                let Some(ExprKind::Array(children)) = call.args().get(2).map(Expr::kind) else {
                    return;
                };
                if !is_create_element(e, cx.state) {
                    return;
                }
                let mut previous_is_inline = false;
                for child in children.iter() {
                    let Some(current_is_inline) = is_inline(child) else {
                        return;
                    };
                    if previous_is_inline && current_is_inline {
                        cx.report(e, INLINE_ELEMENT);
                        return;
                    }
                    previous_is_inline = current_is_inline;
                }
            }
            _ => {}
        }
    }
}
