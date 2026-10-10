use bun_core::strings;
use bun_lint_oxlint::ast_util::{get_member_expr, is_method_call, static_string};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Warns when a single-character string access is compared with a string of length greater than 1.
pub struct BadCharAtComparison;

const BAD_CHAR_AT_COMPARISON: Message = Message::new("", "Invalid character comparison");

impl Rule for BadCharAtComparison {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "bad-char-at-comparison", Kind::Problem);
    const ON: On = On::new().binaries(&[BinOp::EqEq, BinOp::NotEq, BinOp::EqEqEq, BinOp::NotEqEq]);
    no_state!();

    fn new(_: &Options) -> Self {
        BadCharAtComparison
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { left, right, .. } = e.kind() else {
            return;
        };
        let (character_access, compared_string) = if is_bad_char_at_comparison(left, right) {
            (left, right)
        } else if is_bad_char_at_comparison(right, left) {
            (right, left)
        } else {
            return;
        };
        cx.report(character_access, BAD_CHAR_AT_COMPARISON).labels_with(|labels| {
            let len = static_string(compared_string).map_or(0, |value| strings::wtf8_len_utf16(value.bytes()));
            labels.first("A single character is accessed here");
            labels.push(compared_string, format!("And compared with a string of length {len} here"));
        });
    }
}

fn is_bad_char_at_comparison(character_access: Expr, compared_string: Expr) -> bool {
    is_invalid_comparison_string(compared_string) && is_single_character_access(character_access)
}

fn is_invalid_comparison_string(e: Expr) -> bool {
    static_string(e).is_some_and(|value| strings::wtf8_len_utf16(value.bytes()) > 1)
}

fn is_single_character_access(e: Expr) -> bool {
    // An optional chain is neither a call nor a member expression for oxlint.
    if e.chain() != Chain::No {
        return false;
    }
    match e.kind() {
        ExprKind::Call(call) => {
            is_method_call(call, None, Some(&["charAt"]), Some(1), Some(1))
                || is_method_call(call, None, Some(&["at"]), Some(1), Some(1))
                    && get_member_expr(call.callee())
                        .is_some_and(|member| !member.is_optional() && member.object().is_some_and(is_definitely_string))
        }
        ExprKind::Index { obj, index, .. } => is_static_string_index(index) && is_definitely_string(obj),
        _ => false,
    }
}

fn is_definitely_string(e: Expr) -> bool {
    match e.tag() {
        ExprTag::String => true,
        ExprTag::Ident => match e.symbol().and_then(|symbol| symbol.declarations().next()) {
            Some(declaration @ Declaration::Var(_)) if !declaration.is_catch_parameter() => {
                matches!(declaration.node(), Some(Node::VarDecl(declarator)) if is_definitely_string_declarator(declarator))
            }
            _ => false,
        },
        _ => false,
    }
}

fn is_definitely_string_declarator(declarator: VarDecl) -> bool {
    if declarator.ty().is_some_and(|ty| ty.is_keyword(Keyword::String) && !ty.is_parenthesized()) {
        return true;
    }
    declarator.var_kind() == VarKind::Const
        && declarator.pat().tag() == PatTag::Ident
        && declarator.init().is_some_and(|init| init.tag() == ExprTag::String)
}

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

fn is_static_string_index(e: Expr) -> bool {
    match e.kind() {
        ExprKind::Number(_) => true,
        ExprKind::String(value) => {
            let value = value.bytes();
            value == b"0"
                || !value.starts_with(b"0")
                    && value.iter().all(u8::is_ascii_digit)
                    && std::str::from_utf8(value).ok().and_then(|it| it.parse::<u64>().ok()).is_some_and(|it| it <= MAX_SAFE_INTEGER)
        }
        _ => false,
    }
}
