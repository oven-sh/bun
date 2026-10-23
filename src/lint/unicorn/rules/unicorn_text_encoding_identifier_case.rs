use bun_lint_oxlint::ast_util::{get_identifier_name, get_inner_expression};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::visible::{is_global, visible_module};

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
    /// `s` is the source text, which equals the value unless it has an escape.
    fn check<'a>(&self, s: &'a [u8], span: Span, node: Node<'a>, cx: &Cx<'a, Self>) {
        let replacement = if s.eq_ignore_ascii_case(b"utf8") || s.eq_ignore_ascii_case(b"utf-8") {
            if self.with_dash || should_enforce_dash(node) { "utf-8" } else { "utf8" }
        } else if s.eq_ignore_ascii_case(b"ascii") {
            "ascii"
        } else {
            return;
        };
        if replacement.as_bytes() != s {
            // The fix skips the first and last character, even for JSX text, which has no quotes.
            cx.report(span, TEXT_ENCODING_IDENTIFIER_CASE)
                .data("good_encoding", replacement)
                .data("bad_encoding", s)
                .fix_where_safe(|| is_read_as_label(node), |fixer| fixer.replace(span.shrink(1, 1), replacement));
        }
    }
}

/// True where both spellings behave the same: `fs.readFile(path, "utf-8")`, `new TextDecoder("utf8")`. Anywhere else
/// the string could be compared with `decoder.encoding`, which is always `"utf-8"`, or sent as a `charset`. oxlint
/// rewrites it everywhere.
fn is_read_as_label(node: Node) -> bool {
    const METHODS: [&str; 2] = ["readFile", "readFileSync"];
    const MODULES: [&str; 4] = ["fs", "node:fs", "fs/promises", "node:fs/promises"];
    let Node::Expr(e) = node else {
        return false;
    };
    let Node::Expr(parent) = e.parent() else {
        return false;
    };
    match parent.kind() {
        ExprKind::New(call) => call.args().first() == Some(e) && is_global(call.callee(), "TextDecoder"),
        ExprKind::Call(call) if call.args().get(1) == Some(e) && call.args().first().is_some_and(|it| it.tag() != ExprTag::Spread) => {
            let callee = call.callee();
            match callee.kind() {
                ExprKind::Dot { obj, name, .. } => {
                    name.name().is_any(&METHODS) && visible_module(obj).is_some_and(|it| it.is_any(&MODULES))
                }
                _ => matches!(callee.symbol().and_then(|it| it.declarations().next()), Some(Declaration::ImportSpec(it))
                    if it.imported().name().is_any(&METHODS) && it.import().spec().is_any(&MODULES)),
            }
        }
        _ => false,
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
