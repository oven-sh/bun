//! The flags of a regular expression that is written as a literal or made by `RegExp`: `resolve_regex_flags` and
//! `extract_regex_flags` of oxlint's `ast_util.rs`, `is_regexp_callee` of its `utils/regex.rs`.
//!
//! And the regular expressions that oxlint makes of options with the crate `regex`: [`rust_regex`], [`regex_of_option`].

use crate::ast_util::{
    get_inner_expression, get_member_expr, is_global_reference, is_global_reference_name,
    is_method_call, static_property_info, static_property_name,
};
use bun_lint::prelude::*;

/// Where the name `method` is written, and where the regular expression is, if `e` calls that method with one that is known not to
/// have the flag `g`.
pub fn method_called_without_global_flag(e: Expr, method: &str) -> Option<(Span, Span)> {
    let call = e.as_call()?;
    if !is_method_call(call, None, Some(&[method]), Some(1), None) {
        return None;
    }
    let regexp_argument = call
        .args()
        .first()
        .filter(|it| it.tag() != ExprTag::Spread)?;
    let callee = call.callee();
    let (flags, regex_span) = resolve_regex_flags(regexp_argument)?;
    if flags.is_global || callee.is_parenthesized() {
        return None;
    }
    static_property_info(callee).map(|it| (it.0, regex_span))
}

struct RegExpFlags {
    is_global: bool,
}

/// The flags of the regular expression that `e` is, or is a variable for, and where it is. `None` if that is not known.
fn resolve_regex_flags(e: Expr) -> Option<(RegExpFlags, Span)> {
    let mut at = e;
    // Not further than anybody writes it: `const a = b, b = a` goes in a circle, and of `const b = a, c = b ..` each can be asked about.
    for _ in 0..32 {
        let flags = match at.kind() {
            ExprKind::Regex(regex) => Some(RegExpFlags {
                is_global: bun_core::strings::contains_char(regex.flags(), b'g'),
            }),
            ExprKind::New(call) if is_regexp_callee(call.callee()) => {
                extract_regex_flags(call.args())
            }
            ExprKind::Call(call)
                if call.chain() == Chain::No && is_regexp_callee(call.callee()) =>
            {
                extract_regex_flags(call.args())
            }
            ExprKind::Ident(_) => {
                let declaration = at
                    .symbol()?
                    .declarations()
                    .next()
                    .filter(|it| !it.is_catch_parameter())?;
                let (Declaration::Var(_), Some(Node::VarDecl(declarator))) =
                    (declaration, declaration.node())
                else {
                    return None;
                };
                at = declarator.init()?;
                continue;
            }
            _ => None,
        };
        return flags.map(|it| (it, at.span()));
    }
    None
}

fn extract_regex_flags<'a>(args: List<'a, Expr<'a>>) -> Option<RegExpFlags> {
    let Some(flag_arg) = args.get(1) else {
        return Some(RegExpFlags { is_global: false });
    };
    let flags = match flag_arg.kind() {
        _ if flag_arg.is_parenthesized() => return None,
        ExprKind::String(value) => value,
        ExprKind::Template(template) => template.as_static()?,
        _ => return None,
    };
    let flags = flags.bytes();
    flags
        .iter()
        .all(|flag| matches!(flag, b'g' | b'i' | b'm' | b's' | b'u' | b'y' | b'd' | b'v'))
        .then(|| RegExpFlags {
            is_global: bun_core::strings::contains_char(flags, b'g'),
        })
}

/// `RegExp`, `globalThis.RegExp`, `window["RegExp"]`, `global.RegExp`
pub fn is_regexp_callee(callee: Expr) -> bool {
    if is_global_reference_name(callee, "RegExp") {
        return true;
    }
    get_member_expr(callee).is_some_and(|member| {
        static_property_name(member).is_some_and(|name| name.is("RegExp"))
            && member
                .object()
                .map(get_inner_expression)
                .is_some_and(|object| {
                    object
                        .as_ident()
                        .is_some_and(|name| name.is_any(&["globalThis", "window", "global"]))
                        && is_global_reference(object)
                })
    })
}

/// A regular expression of the crate `regex`, which knows Unicode, as far as one of JavaScript does the same.
pub fn rust_regex(pattern: &str, ignores_case: bool) -> Option<Regex> {
    let (unicode, plain) = if ignores_case { ("iu", "i") } else { ("u", "") };
    // With the `u` flag JavaScript refuses escapes that mean nothing, such as `\-`.
    Regex::new(pattern, unicode)
        .or_else(|_| Regex::new(pattern, plain))
        .ok()
}

/// A pattern of an option that oxlint compiles with the crate `regex`. `None` if it is none for JavaScript either.
pub fn regex_of_option(pattern: &str) -> Option<Regex> {
    // The crate has `(?i)`, JavaScript has not.
    match pattern.strip_prefix("(?i)") {
        Some(pattern) => rust_regex(pattern, true),
        None => rust_regex(pattern, false),
    }
}
