use bun_lint_oxlint::ast_util::{get_identifier_name, get_inner_expression};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce consistent case for text encoding identifiers.
pub struct TextEncodingIdentifierCase {
    with_dash: bool,
}

const TEXT_ENCODING_IDENTIFIER_CASE: Message = Message::new("", "Prefer `{{good_encoding}}` over `{{bad_encoding}}`.");

impl Rule for TextEncodingIdentifierCase {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "text-encoding-identifier-case", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().string_literals().exprs(&[ExprTag::String]);
    no_state!();

    fn new(options: &Options) -> Self {
        TextEncodingIdentifierCase { with_dash: options.object(0).bool_or("withDash", false) }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new().string_literals();
        if file.has_exprs([ExprTag::Jsx]) {
            on = on.exprs(&[ExprTag::String]);
        }
        on
    }

    fn string_literal<'a>(&self, string_lit: Literal<'a>, cx: &mut Cx<'a, Self>) {
        let span = string_lit.span();
        if matches!(span.len(), 6 | 7) {
            self.check(cx.slice(span.shrink(1, 1)), span, string_lit.owner(), cx);
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if matches!(e.span().len(), 4 | 5) && e.is_jsx_text() {
            self.check(e.text(), e.span(), Node::Expr(e), cx);
        }
    }
}

impl TextEncodingIdentifierCase {
    /// `s`: as it is written, which is the value unless it has an escape.
    fn check<'a>(&self, s: &'a [u8], span: Span, node: Node<'a>, cx: &Cx<'a, Self>) {
        let replacement = if s.eq_ignore_ascii_case(b"utf8") || s.eq_ignore_ascii_case(b"utf-8") {
            if self.with_dash || should_enforce_dash(node) { "utf-8" } else { "utf8" }
        } else if s.eq_ignore_ascii_case(b"ascii") {
            "ascii"
        } else {
            return;
        };
        if replacement.as_bytes() != s {
            // Without the first and the last character, of the text between tags as well.
            cx.report(span, TEXT_ENCODING_IDENTIFIER_CASE)
                .data("good_encoding", replacement)
                .data("bad_encoding", s)
                .fix(|fixer| fixer.replace(span.shrink(1, 1), replacement));
        }
    }
}

/// `<meta charset="..">`, `<form acceptCharset="..">`, `new TextDecoder("..")`
fn should_enforce_dash(node: Node) -> bool {
    let Node::Expr(e) = node else {
        return false;
    };
    match e.parent() {
        Node::Prop(jsx_attr) if jsx_attr.is_jsx_attribute() && e.jsx_container_span().is_none() => {
            let Some(name) = jsx_attr.key().and_then(Key::name).map(Name::bytes) else {
                return false;
            };
            let element: &[u8] = if name.eq_ignore_ascii_case(b"charset") {
                b"meta"
            } else if name.eq_ignore_ascii_case(b"acceptcharset") || name.eq_ignore_ascii_case(b"accept-charset") {
                b"form"
            } else {
                return false;
            };
            matches!(jsx_attr.parent(), Node::Expr(it) if matches!(it.kind(), ExprKind::Jsx(jsx)
                if get_identifier_name(jsx).is_some_and(|tag_name| tag_name.bytes().eq_ignore_ascii_case(element))))
        }
        Node::Expr(parent) if !e.is_parenthesized() => matches!(parent.kind(), ExprKind::New(new_expr)
            if new_expr.args().first() == Some(e) && get_inner_expression(new_expr.callee()).is_ident("TextDecoder")),
        _ => false,
    }
}
