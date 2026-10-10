use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow `typeof` comparisons with `undefined`.
pub struct NoTypeofUndefined {
    check_global_variables: bool,
}

const NO_TYPEOF_UNDEFINED: Message = Message::new("", "Compare with `undefined` directly instead of using `typeof`.");

impl Rule for NoTypeofUndefined {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "no-typeof-undefined", Kind::Suggestion).fixable(Fixable::Code).has_suggestions();
    const ON: On = On::new().binaries(&[BinOp::EqEqEq, BinOp::NotEqEq, BinOp::EqEq, BinOp::NotEq]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoTypeofUndefined { check_global_variables: options.object(0).bool_or("checkGlobalVariables", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("undefined") {
            return None;
        }
        Some(())
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left, right } = e.kind() else {
            return;
        };
        let ExprKind::Unary { op: UnOp::Typeof, operand: argument } = left.kind() else {
            return;
        };
        if left.is_parenthesized()
            || right.is_parenthesized()
            || !right.as_string().is_some_and(|it| it.is("undefined"))
        {
            return;
        }
        let is_global_variable =
            argument.tag() == ExprTag::Ident && !argument.is_parenthesized() && argument.symbol().is_none();
        if is_global_variable && !self.check_global_variables {
            return;
        }
        let generate_fix = |fixer: Fixer<'a>| {
            let op: &[u8] =
                if matches!(op, BinOp::EqEqEq | BinOp::EqEq) { b" === undefined" } else { b" !== undefined" };
            fixer.replace(e, [fixer.file().slice(argument.outer_span()), op].concat())
        };
        match is_global_variable {
            true => cx.report(e, NO_TYPEOF_UNDEFINED).suggest(NO_TYPEOF_UNDEFINED, generate_fix),
            false => cx.report(e, NO_TYPEOF_UNDEFINED).fix(generate_fix),
        };
    }
}
