use bun_lint_oxlint::ast_util::plain;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces a convention of using Unicode escapes instead of hexadecimal escapes for consistency and clarity.
pub struct NoHexEscape;

const NO_HEX_ESCAPE: Message = Message::new("", "Use Unicode escapes instead of hexadecimal escapes.");

impl Rule for NoHexEscape {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-hex-escape", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoHexEscape
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.string_literals(|_, literal, cx| {
            // The quotes are part of the place.
            check(literal.span().shrink(1, 1), literal.span(), cx);
        });
        on.exprs([ExprTag::Template], |_, e, cx| {
            let ExprKind::Template(lit) = e.kind() else {
                return;
            };
            // Its own text only: templates can be in each other.
            for i in 0..lit.quasi_count() {
                let start = lit.quasi_span(i).start + 1;
                let quasi = Span::new(start, start + lit.raw(i).len() as u32);
                if strings::contains(cx.slice(quasi), b"\\x") {
                    if is_string_raw_tagged_template_expression(e.parent()) {
                        return;
                    }
                    check(quasi, quasi, cx);
                }
            }
        });
        on.exprs([ExprTag::Regex], |_, e, cx| {
            let ExprKind::Regex(regex) = e.kind() else {
                return;
            };
            let (pattern, start) = (regex.pattern(), e.span().start + 1);
            let mut at = 0;
            while let Some(found) = pattern.get(at..).and_then(|rest| strings::index_of_char_usize(rest, b'\\')) {
                at += found;
                // `\x` without two digits is an `x`.
                if let Some([b'\\', b'x', digits @ ..]) = pattern.get(at..at + 4)
                    && digits.iter().all(u8::is_ascii_hexdigit)
                {
                    let span = Span::new(start + at as u32, start + at as u32 + 4);
                    cx.report(span, NO_HEX_ESCAPE).fix(|fixer| fixer.replace(span, [b"\\u00", digits].concat()));
                }
                at += 2;
            }
        });
    }
}

/// `escapes`: where the text with the escapes is.
fn check<'a>(escapes: Span, place: Span, cx: &Cx<'a, NoHexEscape>) {
    if let Some(fixed) = check_escape(cx.slice(escapes)) {
        // With the quotes, as oxlint replaces it.
        let (before, after) = (Span::new(place.start, escapes.start), Span::new(escapes.end, place.end));
        let fixed = [cx.slice(before), &fixed, cx.slice(after)].concat();
        cx.report(place, NO_HEX_ESCAPE).fix(|fixer| fixer.replace(place, fixed));
    }
}

/// `value` with `\u00` for each `\x`, if it has one.
fn check_escape(value: &[u8]) -> Option<Vec<u8>> {
    let mut fixed = Vec::new();
    let (mut at, mut last) = (0, 0);
    while let Some(found) = value.get(at..).and_then(|rest| strings::index_of_char_usize(rest, b'\\')) {
        at += found;
        if value.get(at + 1) == Some(&b'x') {
            fixed.extend_from_slice(value.get(last..at).unwrap_or_default());
            fixed.extend_from_slice(b"\\u00");
            last = at + 2;
        }
        at += 2;
    }
    fixed.extend_from_slice(value.get(last..).filter(|_| last > 0)?);
    Some(fixed)
}

/// ``String.raw`..` ``
fn is_string_raw_tagged_template_expression(node: Node) -> bool {
    matches!(node, Node::Expr(e) if matches!(e.kind(), ExprKind::TaggedTemplate(tagged)
        if matches!(plain(tagged.callee()).map(Expr::kind), Some(ExprKind::Dot { obj, name, .. })
            if name.name().is("raw") && plain(obj).is_some_and(|it| it.is_ident("String")))))
}
