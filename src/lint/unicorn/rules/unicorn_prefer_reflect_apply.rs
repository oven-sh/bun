use bun_lint_oxlint::ast_util::{as_member_expression, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows the use of `Function.prototype.apply()` and suggests using `Reflect.apply()` instead.
pub struct PreferReflectApply;

const PREFER_REFLECT_APPLY: Message = Message::new("", "Prefer `Reflect.apply()` over `Function#apply()`.");
const LESS_VERBOSE: Message = Message::new("", "`Reflect.apply()` is less verbose and easier to understand.");

/// `(this, [..])`, `(null, arguments)`
fn is_apply_signature(first: Expr, second: Expr) -> bool {
    matches!(first.tag(), ExprTag::This | ExprTag::Null)
        && (second.tag() == ExprTag::Array || second.is_ident("arguments"))
        && !first.is_parenthesized()
        && !second.is_parenthesized()
}

/// The `a` of `a.name`.
fn object_of_member<'a>(e: Expr<'a>, name: &str) -> Option<Expr<'a>> {
    as_member_expression(e).filter(|it| static_property_name(*it).is_some_and(|it| it.is(name)))?.object()
}

fn is_literal_or_array_or_object(e: Expr) -> bool {
    !e.is_parenthesized()
        && matches!(
            e.tag(),
            ExprTag::Array
                | ExprTag::Object
                | ExprTag::True
                | ExprTag::False
                | ExprTag::Null
                | ExprTag::Number
                | ExprTag::BigInt
                | ExprTag::Regex
                | ExprTag::String
        )
}

impl Rule for PreferReflectApply {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-reflect-apply", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferReflectApply
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("apply") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call) = e.as_call().filter(|it| matches!(it.args().len(), 2 | 3) && !it.is_optional()) else {
                return;
            };
            let (callee, args) = (call.callee(), call.args());
            let (Some(first), Some(second)) = (args.first(), args.get(1)) else {
                return;
            };
            // The function, what is `this` in it, its arguments.
            let (function, this_argument, arguments) = match args.get(2) {
                None => match object_of_member(callee, "apply") {
                    Some(function) if !is_literal_or_array_or_object(function) => (function, first, second),
                    _ => return,
                },
                Some(third) => {
                    let prototype = object_of_member(callee, "call").and_then(|it| object_of_member(it, "apply"));
                    match prototype.and_then(|it| object_of_member(it, "prototype")) {
                        Some(it) if it.is_ident("Function") && !it.is_parenthesized() => (first, second, third),
                        _ => return,
                    }
                }
            };
            if !is_apply_signature(this_argument, arguments) {
                return;
            }
            cx.report(e, PREFER_REFLECT_APPLY).suggest(LESS_VERBOSE, |fixer| {
                let text = |it: Expr| fixer.file().slice(it.outer_span());
                let arguments = [text(function), text(this_argument), text(arguments)].join(&b", "[..]);
                fixer.replace(e, [&b"Reflect.apply("[..], &arguments, b")"].concat())
            });
        });
    }
}
