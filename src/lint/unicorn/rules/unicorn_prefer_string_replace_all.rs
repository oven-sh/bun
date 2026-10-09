use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr};
use bun_lint_oxlint::codegen::print_string;
use crate::unicorn::static_string;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::regex::{self, ast::Kind as RegexKind};
use bun_lint::rule::Plugin;

/// Prefers `String#replaceAll()` over `String#replace()` when using a regex with the global flag.
pub struct PreferStringReplaceAll;

const STRING_LITERAL: Message = Message::new("", "This pattern can be replaced with `{{replacement}}`.");
const USE_REPLACE_ALL: Message = Message::new(
    "",
    "Prefer `String#replaceAll()` over `String#replace()` when using a regex with the global flag.",
);

fn generate_string_literal(value: &[u8]) -> Vec<u8> {
    let mut literal = Vec::with_capacity(value.len() + 2);
    print_string(&mut literal, value, b'\'');
    literal
}

/// `/a/g`, `new RegExp("a", "g")`
fn is_reg_exp_with_global_flag(e: Expr) -> bool {
    let flags = match e.kind() {
        _ if e.is_parenthesized() => return false,
        ExprKind::Regex(literal) => literal.flags(),
        ExprKind::New(new) if get_inner_expression(new.callee()).is_ident("RegExp") => {
            match new.args().get(1).filter(|it| !it.is_parenthesized()).and_then(static_string) {
                Some(flags) if flags.bytes().iter().all(|it| strings::contains_char(b"gimsuydv", *it)) => flags.bytes(),
                _ => return false,
            }
        }
        _ => return false,
    };
    strings::contains_char(flags, b'g')
}

/// The string that the regular expression `e` matches, if it is a literal that matches only one.
fn get_pattern_replacement(e: Expr) -> Option<Vec<u8>> {
    let ExprKind::Regex(literal) = e.kind() else {
        return None;
    };
    let (pattern, flags) = (literal.pattern(), literal.flags());
    if e.is_parenthesized()
        || !strings::contains_char(flags, b'g')
        || strings::index_of_any(flags, b"imsdy").is_some()
    {
        return None;
    }
    let ast = regex::parse_pattern(pattern, regex::Mode::of_flags(flags), regex::Options::default()).ok()?;
    let RegexKind::Pattern { alternatives } = ast.pattern().kind() else {
        return None;
    };
    let RegexKind::Alternative { elements } = alternatives.first().filter(|_| alternatives.len() == 1)?.kind() else {
        return None;
    };
    let mut result = String::with_capacity(pattern.len());
    for term in elements.iter() {
        let RegexKind::Character { value } = term.kind() else {
            return None;
        };
        match char::from_u32(value) {
            Some(c) => result.push(c),
            // Half of a surrogate pair: oxlint takes the pattern as it is written then.
            None => return Some(pattern.to_vec()),
        }
    }
    Some(result.into_bytes())
}

impl Rule for PreferStringReplaceAll {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "prefer-string-replace-all", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferStringReplaceAll
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["replace", "replaceAll"]) {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call) = e.as_call().filter(|it| it.args().len() == 2) else {
                return;
            };
            let Some(name) = get_member_expr(call.callee()).and_then(Expr::member_name) else {
                return;
            };
            let Some(pattern) = call.args().first() else {
                return;
            };
            match name.bytes() {
                b"replaceAll" => {
                    if let Some(replacement) = get_pattern_replacement(pattern) {
                        let literal = generate_string_literal(&replacement);
                        cx.report(pattern.outer_span(), STRING_LITERAL)
                            .data("replacement", replacement)
                            .fix(|fixer| fixer.replace(pattern.outer_span(), literal));
                    }
                }
                b"replace" if is_reg_exp_with_global_flag(pattern) => {
                    cx.report(name, USE_REPLACE_ALL).fix(|fixer| {
                        let mut fixes = vec![fixer.replace(name, "replaceAll")];
                        if let Some(replacement) = get_pattern_replacement(pattern) {
                            fixes.push(fixer.replace(pattern.outer_span(), generate_string_literal(&replacement)));
                        }
                        fixes
                    });
                }
                _ => {}
            }
        });
    }
}
