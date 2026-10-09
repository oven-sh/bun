use bun_lint_oxlint::ast_util::{get_inner_expression, plain, static_property_name};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// Enforce throwing a `TypeError` instead of a generic `Error` after a type-checking if statement.
pub struct PreferTypeError;

const PREFER_TYPE_ERROR: Message =
    Message::new("", "Prefer throwing a `TypeError` over a generic `Error` after a type checking if-statement");

impl Rule for PreferTypeError {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-type-error", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferTypeError
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("Error") {
            return;
        }
        on.stmts([StmtTag::Throw], |_, throw_stmt, cx| {
            if let StmtKind::Throw(argument) = throw_stmt.kind()
                && let ExprKind::New(new_expr) = argument.kind()
                && get_inner_expression(new_expr.callee()).is_ident("Error")
                && let Node::Stmt(block_stmt) = throw_stmt.parent()
                && matches!(block_stmt.kind(), StmtKind::Block(body) if body.len() == 1)
                && let Node::Stmt(if_stmt) = block_stmt.parent()
                && let StmtKind::If { test, .. } = if_stmt.kind()
                && is_type_checking_expr(test)
            {
                let callee = new_expr.callee().outer_span();
                cx.report(callee, PREFER_TYPE_ERROR).fix(|fixer| fixer.replace(callee, "TypeError"));
            }
        });
    }
}

/// What is still to be looked at, if what is on the left of it does not decide.
enum Rest<'a> {
    /// `left + right`: one of them.
    Or(Expr<'a>),
    /// `left && right`, `left || right`: both.
    And(Expr<'a>),
}

fn is_type_checking_expr(expr: Expr) -> bool {
    let mut rest: SmallVec<[Rest; 8]> = SmallVec::new();
    let mut expr = expr;
    loop {
        let is_type_checking = match plain(expr).map(Expr::kind) {
            Some(ExprKind::Dot { .. } | ExprKind::Index { .. }) => is_type_checking_member_expr(expr),
            Some(ExprKind::Call(call_expr)) => is_typechecking_call_expr(call_expr),
            Some(ExprKind::Unary { op: UnOp::Typeof, .. } | ExprKind::Binary { op: BinOp::Instanceof, .. }) => true,
            Some(ExprKind::Unary { op: UnOp::Not, operand }) => {
                expr = operand;
                continue;
            }
            Some(ExprKind::Binary { op, left, right })
                if op != BinOp::Comma && left.tag() != ExprTag::PrivateIdentifier =>
            {
                let is_logical = matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish);
                rest.push(if is_logical { Rest::And(right) } else { Rest::Or(right) });
                expr = left;
                continue;
            }
            _ => false,
        };
        expr = loop {
            match rest.pop() {
                None => return is_type_checking,
                Some(Rest::Or(right)) if !is_type_checking => break right,
                Some(Rest::And(right)) if is_type_checking => break right,
                Some(_) => {}
            }
        };
    }
}

fn is_typechecking_call_expr(call_expr: Call) -> bool {
    let callee = call_expr.callee();
    !call_expr.args().is_empty()
        && match plain(callee).map(Expr::kind) {
            Some(ExprKind::Ident(name)) => name.is_any(&["isFinite", "isNaN"]),
            Some(_) => is_type_checking_member_expr(callee),
            None => false,
        }
}

fn is_type_checking_member_expr(member_expr: Expr) -> bool {
    static_property_name(member_expr).is_some_and(|ident| {
        ident.bytes().starts_with(b"is")
            && ident.is_any(&[
                "isArray",
                "isArrayBuffer",
                "isArrayLike",
                "isArrayLikeObject",
                "isBigInt",
                "isBoolean",
                "isBuffer",
                "isDate",
                "isElement",
                "isError",
                "isFinite",
                "isFunction",
                "isInteger",
                "isLength",
                "isMap",
                "isNaN",
                "isNative",
                "isNil",
                "isNull",
                "isNumber",
                "isObject",
                "isObjectLike",
                "isPlainObject",
                "isPrototypeOf",
                "isRegExp",
                "isSafeInteger",
                "isSet",
                "isString",
                "isSymbol",
                "isTypedArray",
                "isUndefined",
                "isView",
                "isWeakMap",
                "isWeakSet",
                "isWindow",
                "isXMLDoc",
            ])
    })
}
