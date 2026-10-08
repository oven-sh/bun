use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::{TokenOrText, can_tokens_be_adjacent};

/// Disallow `parseInt()` and `Number.parseInt()` in favor of binary, octal, and hexadecimal literals.
pub struct PreferNumericLiterals;

const USE_LITERAL: Message = Message::new(
    "useLiteral",
    "Use {{system}} literals instead of {{functionName}}().",
);

/// ESLint's `isParseInt`.
fn is_parse_int(callee: Expr) -> bool {
    match callee.kind() {
        ExprKind::Ident(name) => name.is("parseInt") && ast_utils::is_global_reference(callee),
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
            ast_utils::is_specific_member_access(callee, Some("Number"), Some("parseInt"))
                && ast_utils::is_global_reference(obj)
        }
        _ => false,
    }
}

/// `+(literalPrefix + text) === parseInt(text, radix)`, for a radix of 2, 8 or 16. The left side is
/// a number only if `text` is digits of that radix and then whitespace, and then the two agree.
fn is_same_as_literal(text: &[u8], radix: u32) -> bool {
    let digits = text::trim_end(text);
    !digits.is_empty() && digits.iter().all(|c| char::from(*c).is_digit(radix))
}

impl PreferNumericLiterals {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        let args = call.args();
        let (Some(string), Some(radix), None) = (args.first(), args.get(1), args.get(2)) else {
            return;
        };
        let ExprKind::Number(radix) = radix.kind() else {
            return;
        };
        let (radix, system, literal_prefix) = if radix == 2.0 {
            (2, "binary", "0b")
        } else if radix == 8.0 {
            (8, "octal", "0o")
        } else if radix == 16.0 {
            (16, "hexadecimal", "0x")
        } else {
            return;
        };
        let value = match string.kind() {
            ExprKind::String(value) => value,
            ExprKind::Template(template) => match template.as_static() {
                Some(value) => value,
                None => return,
            },
            _ => return,
        };
        if !is_parse_int(call.callee()) {
            return;
        }
        cx.report(e, USE_LITERAL)
            .data("system", system)
            .data("functionName", call.callee().text())
            .fix(|fixer| {
                let (file, span) = (fixer.file(), e.span());
                if file.comments_in(e).next().is_some() || !is_same_as_literal(value.bytes(), radix) {
                    return None;
                }
                let replacement = [literal_prefix.as_bytes(), value.bytes()].concat();
                let needs_space_before = file.token_before(e).is_some_and(|before| {
                    before.end() == span.start
                        && !can_tokens_be_adjacent(TokenOrText::Token(before.kind(), before.text()), &replacement)
                });
                let needs_space_after = file.token_after(e).is_some_and(|after| {
                    span.end == after.start()
                        && !can_tokens_be_adjacent(&replacement, TokenOrText::Token(after.kind(), after.text()))
                });
                let space = |is_needed: bool| -> &'static [u8] { if is_needed { b" " } else { b"" } };
                Some(fixer.replace(e, [space(needs_space_before), &replacement[..], space(needs_space_after)].concat()))
            });
    }
}

impl Rule for PreferNumericLiterals {
    const META: Meta = Meta::eslint("prefer-numeric-literals", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferNumericLiterals
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("parseInt") {
            return;
        }
        on.exprs([ExprTag::Call], Self::check);
    }
}
