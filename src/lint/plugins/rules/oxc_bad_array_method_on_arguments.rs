use bun_lint_oxlint::ast_util::{get_inner_expression, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule applies when an array method is called on the arguments object itself.
pub struct BadArrayMethodOnArguments;

const BAD_ARRAY_METHOD_ON_ARGUMENTS: Message = Message::new("", "Bad array method on `arguments`.");

impl Rule for BadArrayMethodOnArguments {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "bad-array-method-on-arguments", Kind::Problem);
    const ON: On = On::new().members_named(&ARRAY_METHODS).exprs(&[ExprTag::Index]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        BadArrayMethodOnArguments
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("arguments") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, member: Expr<'a>, cx: &mut Cx<'a, Self>) {
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
        let is_array_method = |name: &Name| ARRAY_METHODS.binary_search_by(|it| it.as_bytes().cmp(name.bytes())).is_ok();
        if let Some(method_name) = static_property_name(member).filter(is_array_method) {
            cx.report(member, BAD_ARRAY_METHOD_ON_ARGUMENTS).data("method_name", method_name);
        }
    }
}

/// Sorted.
const ARRAY_METHODS: [&str; 38] = [
    "@@iterator",
    "at",
    "concat", "copyWithin",
    "entries", "every",
    "fill", "filter", "find", "findIndex", "findLast", "findLastIndex", "flat", "flatMap", "forEach",
    "groupBy",
    "includes", "indexOf",
    "join",
    "keys",
    "lastIndexOf",
    "map",
    "pop", "push",
    "reduce", "reduceRight", "reverse",
    "shift", "slice", "some", "sort", "splice",
    "toReversed", "toSorted", "toSpliced",
    "unshift",
    "values",
    "with",
];
