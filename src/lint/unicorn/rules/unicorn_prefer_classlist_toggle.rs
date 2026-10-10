use bun_lint_oxlint::ast_util::{get_inner_expression, get_member_expr, plain, static_property_name};
use bun_lint_oxlint::same_expression::is_same_inner_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefers the use of `element.classList.toggle(className, condition)` over conditional add/remove patterns.
pub struct PreferClasslistToggle;

const PREFER_CLASSLIST_TOGGLE: Message =
    Message::new("", "Prefer `classList.toggle()` over `classList.add()` and `classList.remove()`");

impl Rule for PreferClasslistToggle {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "prefer-classlist-toggle", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().exprs(&[ExprTag::Cond]).stmts(&[StmtTag::If]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferClasslistToggle
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.mentions("classList") || !file.mentions("add") || !file.mentions("remove") {
            return None;
        }
        Some(())
    }

    fn stmt<'a>(&self, if_stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::If { test, yes, no: Some(no) } = if_stmt.kind()
            && let Some(consequent) = extract_single_expression_from_statement(yes)
            && let Some(alternate) = extract_single_expression_from_statement(no)
            && let Some((add_call, is_add_first)) = identify_add_remove_pair(consequent, alternate)
        {
            cx.report(if_stmt, PREFER_CLASSLIST_TOGGLE).fix(|fixer| {
                Some(
                    fixer.replace(
                        if_stmt,
                        toggle(get_member_expr(add_call.callee())?, add_call, test, is_add_first, ";")?,
                    ),
                )
            });
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Cond { test, yes: consequent, no: alternate } = e.kind() else {
            return;
        };
        if let Some((add_call, is_add_first)) = identify_add_remove_pair(consequent, alternate) {
            cx.report(consequent.outer_span().to(alternate.outer_span()), PREFER_CLASSLIST_TOGGLE).fix(|fixer| {
                Some(fixer.replace(e, toggle(get_member_expr(add_call.callee())?, add_call, test, is_add_first, "")?))
            });
        }
        // `a.classList[b ? "add" : "remove"](c)`
        if let Some(Node::Expr(parent)) = plain(e).map(Expr::parent)
            && parent.tag() == ExprTag::Index
            && let Some(Node::Expr(grand_parent)) = plain(parent).map(Expr::parent)
        {
            check_computed_member_call(grand_parent, cx);
        }
    }
}

/// `object.toggle(class, test)`, where `member` is `object.add`, and `!(test)` if `add` is not what `test` is for.
fn toggle(member: Expr, call: Call, test: Expr, is_add_first: bool, end: &str) -> Option<Vec<u8>> {
    fn source(it: Expr<'_>) -> &[u8] {
        it.file().slice(it.outer_span())
    }
    let (not, close): (&[u8], &[u8]) = if is_add_first { (b"", b")") } else { (b"!(", b"))") };
    let class_name_arg = call.args().first()?;
    Some(
        [
            source(member.object()?),
            b".toggle(",
            source(class_name_arg),
            b", ",
            not,
            source(test),
            close,
            end.as_bytes(),
        ]
        .concat(),
    )
}

/// The `e` of `e;` and of `{ e; }`.
fn extract_single_expression_from_statement(stmt: Stmt<'_>) -> Option<Expr<'_>> {
    let stmt = match stmt.kind() {
        StmtKind::Block(body) if body.len() == 1 => body.first()?,
        _ => stmt,
    };
    match stmt.kind() {
        StmtKind::Expr(e) => Some(e),
        _ => None,
    }
}

/// The `a.classList` and the name of `a.classList.name(b)`, with the call.
fn as_classlist_call(expr: Expr<'_>) -> Option<(Call<'_>, Expr<'_>, Name<'_>)> {
    fn as_static_member(it: Expr<'_>) -> Option<Expr<'_>> {
        Some(get_inner_expression(it)).filter(|it| !it.is_chain_root() && !it.is_private_member())
    }
    let call = Some(expr).filter(|it| !it.is_parenthesized())?.as_call()?;
    let member = as_static_member(call.callee())?;
    let ExprKind::Dot { obj, name, .. } = member.kind() else {
        return None;
    };
    let classlist = as_static_member(obj)?;
    let is_one = call.args().len() == 1
        && !call.is_optional()
        && !member.is_optional()
        && call.args().first()?.tag() != ExprTag::Spread
        && matches!(classlist.kind(), ExprKind::Dot { name, .. } if name.name().is("classList"));
    is_one.then_some((call, classlist, name.name()))
}

/// The call of `add`, and whether it is the first.
fn identify_add_remove_pair<'a>(first: Expr<'a>, second: Expr<'a>) -> Option<(Call<'a>, bool)> {
    let (first, first_classlist, first_name) = as_classlist_call(first)?;
    let (second, second_classlist, second_name) = as_classlist_call(second)?;
    let is_add_first = match (first_name.bytes(), second_name.bytes()) {
        (b"add", b"remove") => true,
        (b"remove", b"add") => false,
        _ => return None,
    };
    (is_same_inner_expression(first.args().first()?, second.args().first()?)
        && is_same_inner_expression(first_classlist.object()?, second_classlist.object()?))
    .then_some((if is_add_first { first } else { second }, is_add_first))
}

fn check_computed_member_call<'a>(e: Expr<'a>, cx: &Cx<'a, PreferClasslistToggle>) {
    let Some(call_expr) = e.as_call().filter(|it| it.args().len() == 1 && !it.is_optional()) else {
        return;
    };
    let Some(computed) = get_member_expr(call_expr.callee()).filter(|it| !it.is_optional()) else {
        return;
    };
    let ExprKind::Index { obj, index, .. } = computed.kind() else {
        return;
    };
    let ExprKind::Cond { test, yes, no } = index.kind() else {
        return;
    };
    let string = |it: Expr<'a>| get_inner_expression(it).as_string().map(Name::bytes);
    let is_add_first = match (string(yes), string(no)) {
        (Some(b"add"), Some(b"remove")) => true,
        (Some(b"remove"), Some(b"add")) => false,
        _ => return,
    };
    // `a.classList`, `(a?.["classList"])`
    let classlist = get_inner_expression(obj);
    if index.is_parenthesized()
        || call_expr.args().first().is_some_and(|it| it.tag() == ExprTag::Spread)
        || !(classlist.tag() == ExprTag::Dot || classlist.is_chain_root())
        || !static_property_name(classlist).is_some_and(|it| it.is("classList"))
    {
        return;
    }
    cx.report(e, PREFER_CLASSLIST_TOGGLE)
        .fix(|fixer| Some(fixer.replace(e, toggle(computed, call_expr, test, is_add_first, "")?)));
}
