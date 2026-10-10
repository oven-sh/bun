use bun_lint_oxlint::ast_util::could_be_asi_hazard;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow `new Array()`.
pub struct NoNewArray;

const NO_NEW_ARRAY: Message = Message::new("", "Do not use `new Array(singleArgument)`.");
const REPLACE_WITH_ARRAY_FROM: Message = Message::new("", "Replace with Array.from({ length: argument })");
const REPLACE_WITH_ARRAY: Message = Message::new("", "Replace with [argument]");

impl Rule for NoNewArray {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-new-array", Kind::Problem).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewArray
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("Array") {
            return None;
        }
        Some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::New(new) = e.kind() else {
            return;
        };
        let (callee, args) = (new.callee(), new.args());
        let Some(argument) = args.first().filter(|_| args.len() == 1) else {
            return;
        };
        if !callee.is_ident("Array") || callee.is_parenthesized() {
            return;
        }
        let before = Span::before(e.span().start, argument.outer_span());
        let after = Span::after(argument.outer_span(), e.span().end);
        cx.report(e, NO_NEW_ARRAY)
            .suggest_dangerously(REPLACE_WITH_ARRAY_FROM, |fixer| {
                (argument.tag() != ExprTag::Spread)
                    .then(|| [fixer.replace(before, "Array.from({length: "), fixer.replace(after, "})")])
            })
            .suggest_dangerously(REPLACE_WITH_ARRAY, |fixer| {
                let open = if could_be_asi_hazard(e) { ";[" } else { "[" };
                [fixer.replace(before, open), fixer.replace(after, "]")]
            });
    }
}
