use bun_lint::prelude::*;
use bun_lint::utils::oxlint::is_global_by_name;

/// Require calls to `isNaN()` when checking for `NaN`.
pub struct UseIsnan {
    enforce_for_switch_case: bool,
    enforce_for_index_of: bool,
}

const COMPARISON_WITH_NAN: Message =
    Message::new("comparisonWithNaN", "Use the isNaN function to compare with NaN.");
/// What oxlint says instead.
const INEQUALITY_WITH_NAN: Message =
    Message::new("comparisonWithNaN", "Checking inequality with NaN will always return true");
const EQUALITY_WITH_NAN: Message =
    Message::new("comparisonWithNaN", "Checking equality with NaN will always return false");
const ORDER_WITH_NAN: Message = Message::new("comparisonWithNaN", "Comparison with NaN will always return false");
const SWITCH_NAN: Message = Message::new(
    "switchNaN",
    "'switch(NaN)' can never match a case clause. Use Number.isNaN instead of the switch.",
);
const CASE_NAN: Message =
    Message::new("caseNaN", "'case NaN' can never match. Use Number.isNaN before the switch.");
const INDEX_OF_NAN: Message =
    Message::new("indexOfNaN", "Array prototype method '{{ methodName }}' cannot find NaN.");
const REPLACE_WITH_IS_NAN: Message = Message::new("replaceWithIsNaN", "Replace with Number.isNaN.");
const REPLACE_WITH_CASTING_AND_IS_NAN: Message = Message::new(
    "replaceWithCastingAndIsNaN",
    "Replace with Number.isNaN and cast to a Number.",
);
const REPLACE_WITH_FIND_INDEX: Message =
    Message::new("replaceWithFindIndex", "Replace with Array.prototype.{{ methodName }}.");

fn is_sequence(e: Expr) -> bool {
    matches!(e.kind(), ExprKind::Binary { op: BinOp::Comma, .. })
}

/// ESLint's `isNaNIdentifier`: the global `NaN` or `Number.NaN`, or a sequence that ends with it.
fn is_nan_identifier(e: Expr) -> bool {
    let to_check = match e.kind() {
        ExprKind::Binary {
            op: BinOp::Comma,
            right,
            ..
        } => right,
        _ => e,
    };
    match to_check.kind() {
        ExprKind::Ident(name) => name.is("NaN") && is_global_by_name(to_check),
        ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
            ast_utils::is_specific_member_access(to_check, Some("Number"), Some("NaN"))
                && is_global_by_name(obj)
        }
        _ => false,
    }
}

/// `Number.isNaN(compared)` in place of the comparison `e`.
fn fix_comparison<'a>(fixer: Fixer<'a>, e: Expr<'a>, compared: Expr<'a>, negates: bool, casts: bool) -> Fix {
    let wraps = is_sequence(compared);
    let text = [
        if negates { &b"!"[..] } else { b"" },
        if casts { &b"Number.isNaN(Number("[..] } else { b"Number.isNaN(" },
        if wraps { &b"("[..] } else { b"" },
        compared.text(),
        if wraps { &b")"[..] } else { b"" },
        if casts { &b"))"[..] } else { b")" },
    ]
    .concat();
    fixer.replace(e, text)
}

/// [`is_nan_identifier`] for what is compared. There oxlint does not look at the end of a sequence.
fn is_compared_nan(e: Expr) -> bool {
    is_nan_identifier(e) && !(is_sequence(e) && e.file().language().is_oxlint)
}

impl UseIsnan {
    fn check_binary_expression<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left, right } = e.kind() else {
            return;
        };
        let (nan, compared) = if is_compared_nan(left) {
            (left, right)
        } else if is_compared_nan(right) {
            (right, left)
        } else {
            return;
        };
        // oxlint points at the `NaN`, with its parentheses.
        let report = match (cx.language().is_oxlint, op) {
            (false, _) => cx.report(e, COMPARISON_WITH_NAN),
            (true, BinOp::NotEq | BinOp::NotEqEq) => cx.report(nan.outer_span(), INEQUALITY_WITH_NAN),
            (true, BinOp::EqEq | BinOp::EqEqEq) => cx.report(nan.outer_span(), EQUALITY_WITH_NAN),
            (true, _) => cx.report(nan.outer_span(), ORDER_WITH_NAN),
        };
        let is_fixable = matches!(op, BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq);
        if !is_fixable || is_sequence(nan) {
            return;
        }
        let negates = matches!(op, BinOp::NotEq | BinOp::NotEqEq);
        // oxlint has a fix, and suggests nothing.
        if cx.language().is_oxlint {
            report.fix(|fixer| {
                let call: &[u8] = if negates { b"!isNaN(" } else { b"isNaN(" };
                fixer.replace(e, [call, fixer.file().slice(compared.outer_span()), b")"].concat())
            });
            return;
        }
        let report = report.suggest(REPLACE_WITH_IS_NAN, |fixer| fix_comparison(fixer, e, compared, negates, false));
        if matches!(op, BinOp::EqEq | BinOp::NotEq) {
            report.suggest(REPLACE_WITH_CASTING_AND_IS_NAN, |fixer| {
                fix_comparison(fixer, e, compared, negates, true)
            });
        }
    }

    fn check_switch_statement<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Switch { expr, cases } = statement.kind() else {
            return;
        };
        if is_compared_nan(expr) {
            cx.report(if cx.language().is_oxlint { expr.outer_span() } else { statement.span() }, SWITCH_NAN);
        }
        for case in cases {
            if let Some(test) = case.test().filter(|&it| is_compared_nan(it)) {
                cx.report(if cx.language().is_oxlint { test.outer_span() } else { case.span() }, CASE_NAN);
            }
        }
    }

    fn check_call_expression<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        let callee = call.callee();
        let (property, is_computed) = match callee.kind() {
            ExprKind::Dot { name, .. } => (name.span(), false),
            ExprKind::Index { index, .. } => (index.span(), true),
            _ => return,
        };
        let (method_name, find_index_method) = match ast_utils::get_static_property_name(callee).as_deref() {
            Some(b"indexOf") => ("indexOf", "findIndex"),
            Some(b"lastIndexOf") => ("lastIndexOf", "findLastIndex"),
            _ => return,
        };
        let args = call.args();
        let Some(first) = args.first() else {
            return;
        };
        if args.len() > 2 || !is_nan_identifier(first) {
            return;
        }
        // oxlint points at the `NaN`, without parentheses.
        let place = match first.kind() {
            _ if !cx.language().is_oxlint => e.span(),
            ExprKind::Binary { op: BinOp::Comma, right, .. } => right.span(),
            _ => first.span(),
        };
        let report = cx.report(place, INDEX_OF_NAN).data("methodName", method_name);
        // `arr.findIndex(Number.isNaN)` would lose the side effects of what comes before the `NaN`.
        if is_sequence(first) || args.len() > 1 || cx.language().is_oxlint {
            return;
        }
        report.suggest_with(
            REPLACE_WITH_FIND_INDEX,
            &[("methodName", find_index_method.as_bytes())],
            |fixer| {
                let property_name = match is_computed {
                    true => format!("\"{find_index_method}\""),
                    false => find_index_method.to_owned(),
                };
                [fixer.replace(property, property_name), fixer.replace(first, "Number.isNaN")]
            },
        );
    }
}

impl Rule for UseIsnan {
    const META: Meta = Meta::eslint("use-isnan", Kind::Problem).has_suggestions().recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        UseIsnan {
            enforce_for_switch_case: options.bool_or("enforceForSwitchCase", true),
            enforce_for_index_of: options.bool_or("enforceForIndexOf", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("NaN") {
            return;
        }
        on.binaries(
            [BinOp::Lt, BinOp::Le, BinOp::Gt, BinOp::Ge, BinOp::EqEq, BinOp::NotEq, BinOp::EqEqEq, BinOp::NotEqEq],
            Self::check_binary_expression,
        );
        if self.enforce_for_switch_case {
            on.stmts([StmtTag::Switch], Self::check_switch_statement);
        }
        if self.enforce_for_index_of {
            on.exprs([ExprTag::Call], Self::check_call_expression);
        }
    }
}
