use bun_lint_oxlint::ast_util::{get_inner_expression, is_method_call, iter_outer_expressions, plain};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;
use std::cell::RefCell;

/// Disallow the use of the `null` literal, to encourage using `undefined` instead.
pub struct NoNull {
    check_strict_equality: bool,
    check_arguments: bool,
}

const NO_NULL: Message = Message::new("", "Do not use `null` literals");

impl Rule for NoNull {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-null", Kind::Suggestion).fixable(Fixable::Code);
    /// Whether a `switch` has a `case undefined`, by where it starts.
    type State<'a> = RefCell<FxHashMap<u32, bool>>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoNull {
            check_strict_equality: options.bool_or("checkStrictEquality", false),
            check_arguments: options.bool_or("checkArguments", true),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        on.exprs([ExprTag::Null], |rule, null_literal, cx| {
            let fix_null = |fixer: Fixer<'a>| Some(fixer.replace(null_literal, "undefined"));
            let parent = iter_outer_expressions(null_literal).next();
            match parent {
                Some(Node::Expr(parent)) => match parent.kind() {
                    ExprKind::Call(call_expr) if match_call_expression_pass_case(null_literal, call_expr) => return,
                    ExprKind::Call(call) | ExprKind::New(call)
                        if !rule.check_arguments && get_inner_expression(call.callee()) != null_literal =>
                    {
                        return;
                    }
                    // `foo === null`
                    ExprKind::Binary { op: BinOp::EqEqEq | BinOp::NotEqEq, .. } if !rule.check_strict_equality => {
                        return;
                    }
                    _ => {}
                },
                // `let foo = null;`
                Some(Node::VarDecl(declarator))
                    if declarator.init() == Some(null_literal)
                        && !null_literal.is_parenthesized()
                        && declarator.var_kind() != VarKind::Const =>
                {
                    let span = Span::new(declarator.pat().span().end, null_literal.span().end);
                    cx.report(null_literal, NO_NULL).fix_dangerously(|fixer| fixer.remove(span));
                    return;
                }
                Some(Node::Stmt(statement)) if statement.tag() == StmtTag::Return => {
                    cx.report(null_literal, NO_NULL).fix_dangerously(|fixer| {
                        // With the outermost `as T` or `!`.
                        let wrappers = Node::Expr(null_literal).ancestors().map_while(Node::as_expr);
                        let is_wrapper =
                            |it: &Expr| matches!(it.tag(), ExprTag::As | ExprTag::AsConst | ExprTag::NonNull);
                        fixer.remove(wrappers.filter(is_wrapper).last().unwrap_or(null_literal))
                    });
                    return;
                }
                Some(Node::Case(case)) => {
                    cx.report(null_literal, NO_NULL).fix_dangerously(|fixer| {
                        let switch = case.parent().as_stmt()?;
                        let StmtKind::Switch { cases, .. } = switch.kind() else {
                            return None;
                        };
                        let is_undefined =
                            |it: Case| it.test().is_some_and(|test| get_inner_expression(test).is_ident("undefined"));
                        let mut known = cx.state.borrow_mut();
                        let has_undefined =
                            *known.entry(switch.span().start).or_insert_with(|| cases.iter().any(is_undefined));
                        if has_undefined { None } else { fix_null(fixer) }
                    });
                    return;
                }
                _ => {}
            }
            cx.report(null_literal, NO_NULL).fix_dangerously(fix_null);
        });
        RefCell::default()
    }
}

fn match_call_expression_pass_case<'a>(null_literal: Expr<'a>, call_expr: Call<'a>) -> bool {
    if call_expr.is_optional() {
        return false;
    }
    let match_null_arg = |index: usize| call_expr.args().get(index).map(get_inner_expression) == Some(null_literal);
    let is_computed = plain(call_expr.callee()).is_some_and(|it| it.tag() == ExprTag::Index);
    // `Object.create(null)`, `Object.create(null, foo)`
    is_method_call(call_expr, Some(&["Object"]), Some(&["create"]), Some(1), Some(2))
        && !is_computed
        && match_null_arg(0)
        // `useRef(null)`
        || call_expr.args().len() == 1 && plain(call_expr.callee()).is_some_and(|it| it.is_ident("useRef"))
        // `React.useRef(null)`
        || is_method_call(call_expr, Some(&["React"]), Some(&["useRef"]), Some(1), Some(1))
        // `foo.insertBefore(bar, null)`
        || is_method_call(call_expr, None, Some(&["insertBefore"]), Some(2), Some(2))
            && !is_computed
            && match_null_arg(1)
            && call_expr.args().first().is_some_and(|it| it.tag() != ExprTag::Spread)
}
