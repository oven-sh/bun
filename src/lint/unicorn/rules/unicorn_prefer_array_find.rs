use bun_lint_oxlint::ast_util::{is_method_call, static_property_info, static_property_name};
use crate::unicorn::outermost_wrapper;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Encourages using `Array.prototype.find` and `Array.prototype.findLast` instead of taking the first or last matching
/// element from `filter(...)`.
pub struct PreferArrayFind;

const PREFER_ARRAY_FIND: Message = Message::new("", "Prefer `find` over filtering and accessing the first result.");

impl Rule for PreferArrayFind {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-array-find", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferArrayFind
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("filter") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            if let Some(call) = e.as_call()
                && is_filter_call(call)
                && is_only_first_or_last_used(e)
            {
                // The name `filter`.
                let callee = call.callee();
                let property = static_property_info(callee).filter(|_| !callee.is_parenthesized());
                cx.report(property.map_or_else(|| e.span(), |it| it.0), PREFER_ARRAY_FIND);
            }
        });
    }
}

fn is_filter_call(call: Call) -> bool {
    is_method_call(call, None, Some(&["filter"]), Some(1), Some(2))
        && call.args().first().is_some_and(|it| it.tag() != ExprTag::Spread)
}

fn is_number_value(e: Expr, value: f64) -> bool {
    !e.is_parenthesized() && matches!(e.kind(), ExprKind::Number(n) if (n - value).abs() < f64::EPSILON)
}

fn is_number_0(e: Expr) -> bool {
    !e.is_parenthesized() && matches!(e.kind(), ExprKind::Number(n) if n == 0.0)
}

/// `[a]`, `[a = 1]`: not `[]`, `[,]`, `[...a]`, `[a, b]`.
fn is_array_pattern_of_one(pat: Pat) -> bool {
    matches!(pat.kind(), PatKind::Array(elements)
        if elements.len() == 1 && elements.first().is_some_and(|it| it.pat().is_some() && !it.is_rest()))
}

/// The same for the target of an assignment.
fn is_array_target_of_one(target: Expr) -> bool {
    matches!(target.kind(), ExprKind::Array(elements) if elements.len() == 1
        && elements.first().is_some_and(|it| !matches!(it.tag(), ExprTag::Missing | ExprTag::Spread)))
}

/// `filter_call`: `a.filter(f)`
fn is_only_first_or_last_used(filter_call: Expr) -> bool {
    if !filter_call.is_parenthesized() && !filter_call.is_chain_root() {
        match filter_call.parent() {
            Node::VarDecl(declarator) => return is_first_declared(declarator),
            Node::Expr(parent) => {
                if let ExprKind::Assign { target, .. } = parent.kind() {
                    return is_array_target_of_one(target) && !parent.is_assignment_target();
                }
            }
            _ => {}
        }
    }
    let Some(object) = outermost_wrapper(filter_call) else {
        return false;
    };
    let Node::Expr(member) = object.parent() else {
        return false;
    };
    if member.object() != Some(object) {
        return false;
    }
    if member.index().is_some_and(is_number_0) {
        return !is_left_hand_side(member);
    }
    // `.shift()`, `.pop()`, `.at(0)`, `.at(-1)`
    let (Some(method), Some(callee)) = (static_property_name(member), outermost_wrapper(member)) else {
        return false;
    };
    let Node::Expr(parent) = callee.parent() else {
        return false;
    };
    let Some(args) = parent.as_call().filter(|it| it.callee() == callee).map(Call::args) else {
        return false;
    };
    match (method.bytes(), args.first()) {
        (b"shift" | b"pop", None) => true,
        (b"at", Some(index)) if args.len() == 1 && !index.is_parenthesized() => match index.kind() {
            ExprKind::Unary { op: UnOp::Minus, operand } => is_number_value(operand, 1.0),
            _ => is_number_value(index, 0.0),
        },
        _ => false,
    }
}

/// `declarator`: `.. = a.filter(f)`
fn is_first_declared(declarator: VarDecl) -> bool {
    let pat = declarator.pat();
    if pat.tag() != PatTag::Ident {
        return is_array_pattern_of_one(pat);
    }
    if matches!(declarator.parent(), Node::Stmt(declaration) if declaration.is_exported()) {
        return false;
    }
    // `const foo = a.filter(f); foo[0]; [bar] = foo;`
    let Some(symbol) = pat.symbol() else {
        return false;
    };
    let mut is_first_used = false;
    for reference in symbol.references() {
        let Some(ident) = reference.expr().filter(|it| !it.is_parenthesized()) else {
            // The name in a declaration is none for oxlint.
            if matches!(reference.node(), Node::Pat(_)) {
                continue;
            }
            return false;
        };
        match ident.parent() {
            Node::VarDecl(other) => is_first_used |= is_array_pattern_of_one(other.pat()),
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Index { index, .. } if is_number_0(index) => is_first_used = true,
                ExprKind::Assign { target, .. } if target != ident && !parent.is_assignment_target() => {
                    is_first_used |= is_array_target_of_one(target);
                }
                _ => return false,
            },
            _ => return false,
        }
    }
    is_first_used
}

/// `member`: `a.filter(f)[0]`
fn is_left_hand_side(member: Expr) -> bool {
    let Node::Expr(parent) = member.parent() else {
        return false;
    };
    match parent.kind() {
        ExprKind::Assign { target, .. } => {
            target == member || !member.is_parenthesized() && parent.is_assignment_target()
        }
        ExprKind::Unary { op: UnOp::Delete, .. } => !member.is_parenthesized(),
        ExprKind::Unary { op, .. } => matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec),
        ExprKind::Array(_) => parent.is_assignment_target(),
        _ => false,
    }
}
