use bun_lint_oxlint::ast_util::{get_inner_expression, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule applies when an array method is called on the arguments object itself.
pub struct BadArrayMethodOnArguments;

const BAD_ARRAY_METHOD_ON_ARGUMENTS: Message = Message::new("", "Bad array method on `arguments`.");

impl Rule for BadArrayMethodOnArguments {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "bad-array-method-on-arguments", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        BadArrayMethodOnArguments
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("arguments") {
            return;
        }
        on.exprs([ExprTag::Dot, ExprTag::Index], |_, member, cx| {
            if !member.object().is_some_and(|object| get_inner_expression(object).is_ident("arguments")) {
                return;
            }
            // It is what is called or an argument. Parentheses and the whole of an optional chain are nodes in between for oxlint.
            if !matches!(member.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Call)
                || member.is_parenthesized()
                || member.is_chain_root()
            {
                return;
            }
            if static_property_name(member).is_some_and(|name| ARRAY_METHODS.binary_search(&name.bytes()).is_ok()) {
                cx.report(member, BAD_ARRAY_METHOD_ON_ARGUMENTS);
            }
        });
    }
}

/// Sorted.
const ARRAY_METHODS: [&[u8]; 38] = [
    b"@@iterator",
    b"at",
    b"concat", b"copyWithin",
    b"entries", b"every",
    b"fill", b"filter", b"find", b"findIndex", b"findLast", b"findLastIndex", b"flat", b"flatMap", b"forEach",
    b"groupBy",
    b"includes", b"indexOf",
    b"join",
    b"keys",
    b"lastIndexOf",
    b"map",
    b"pop", b"push",
    b"reduce", b"reduceRight", b"reverse",
    b"shift", b"slice", b"some", b"sort", b"splice",
    b"toReversed", b"toSorted", b"toSpliced",
    b"unshift",
    b"values",
    b"with",
];
