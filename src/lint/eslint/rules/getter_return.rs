use bun_lint::prelude::*;
use smallvec::SmallVec;

/// Enforce `return` statements in getters.
pub struct GetterReturn {
    allows_implicit: bool,
}

const EXPECTED: Message = Message::new("expected", "Expected to return a value in {{name}}.");
const EXPECTED_ALWAYS: Message = Message::new(
    "expectedAlways",
    "Expected {{name}} to always return a value.",
);

/// ESLint's `isGetter`
fn is_getter(func: Func) -> bool {
    if !matches!(func.body(), FnBody::Block(_)) {
        return false;
    }
    match func.kind() {
        FnKind::Getter => true,
        FnKind::Expr | FnKind::Arrow | FnKind::Method | FnKind::Setter => {
            let parent = match func.owner() {
                Node::Expr(e) => e.parent(),
                owner => owner,
            };
            let Node::Prop(prop) = parent else {
                return false;
            };
            let Node::Expr(object) = prop.parent() else {
                return false;
            };
            object.tag() == ExprTag::Object
                && ast_utils::get_static_property_name(prop).is_some_and(|name| &*name == b"get")
                && ast_utils::is_property_descriptor(object)
        }
        _ => false,
    }
}

/// A call of one of the methods that take property descriptors, whatever `Object` and `Reflect` are there.
fn is_watched_call(e: Expr) -> bool {
    const METHODS_TO_WATCH_FOR: [(&str, &str); 4] = [
        ("Object", "defineProperty"),
        ("Reflect", "defineProperty"),
        ("Object", "create"),
        ("Object", "defineProperties"),
    ];
    let Some(callee) = e.as_call().map(|it| it.callee()) else {
        return false;
    };
    let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = callee.kind() else {
        return false;
    };
    ast_utils::get_static_property_name(callee)
        .is_some_and(|name| METHODS_TO_WATCH_FOR.iter().any(|it| obj.is_ident(it.0) && *name == *it.1.as_bytes()))
}

/// A node that oxc has above an expression.
#[derive(Copy, Clone)]
enum Level<'a> {
    /// A pair of parentheses, with what is in it and in those in it.
    Parentheses(Expr<'a>),
    Expr(Expr<'a>),
    /// A `ChainExpression`, a property.
    Other,
}

/// The three nodes above `e`, or fewer if not all of them are expressions and properties of object literals.
fn levels_above(e: Expr) -> SmallVec<[Level; 8]> {
    let mut levels = SmallVec::new();
    let mut at = e;
    while levels.len() < 3 && at.jsx_container_span().is_none() {
        if at.is_chain_root() {
            levels.push(Level::Other);
        }
        levels.extend(at.parens().take(3).map(|_| Level::Parentheses(at)));
        at = match at.parent() {
            Node::Expr(parent) if parent.tag() != ExprTag::TaggedTemplate => parent,
            Node::Prop(prop) => match prop.parent() {
                Node::Expr(object) if object.tag() == ExprTag::Object => {
                    levels.push(Level::Other);
                    object
                }
                _ => break,
            },
            // `() => e`
            Node::Func(func) if matches!(func.body(), FnBody::Expr(body) if body == at) => match func.owner() {
                Node::Expr(arrow) => arrow,
                _ => break,
            },
            _ => break,
        };
        // `a, b, c` is one node.
        while at.binary_op() == Some(BinOp::Comma)
            && !at.is_parenthesized()
            && let Node::Expr(outer) = at.parent()
            && outer.binary_op() == Some(BinOp::Comma)
        {
            at = outer;
        }
        levels.push(Level::Expr(at));
    }
    levels
}

/// oxlint's `is_wanted_node`. What has the name `get`, or a name that is computed, is a getter if the object literal is
/// one or three nodes below a call of one of the methods, as which argument ever.
fn is_getter_for_oxlint(func: Func) -> bool {
    if !matches!(func.body(), FnBody::Block(_)) {
        return false;
    }
    if func.kind() == FnKind::Getter {
        return true;
    }
    let Node::Expr(function) = func.owner() else {
        return false;
    };
    let Node::Prop(prop) = function.parent() else {
        return false;
    };
    let Node::Expr(object) = prop.parent() else {
        return false;
    };
    if function.is_parenthesized()
        || object.tag() != ExprTag::Object
        || ast_utils::get_static_property_name(prop).is_some_and(|name| &*name != b"get")
    {
        return false;
    }
    let levels = levels_above(object);
    matches!(levels.first(), Some(Level::Expr(call)) if is_watched_call(*call))
        || match levels.get(2) {
            Some(Level::Expr(call)) => is_watched_call(*call),
            Some(Level::Parentheses(call)) => !call.is_chain_root() && is_watched_call(*call),
            _ => false,
        }
}

impl GetterReturn {
    /// oxlint reports a function once, and points at it.
    fn check_as_oxlint<'a>(&self, func: Func<'a>, cx: &Cx<'a, Self>) {
        let returns_nothing = |it: Stmt| matches!(it.kind(), StmtKind::Return(None));
        if func.is_end_reachable() || !self.allows_implicit && func.returns().any(returns_nothing) {
            cx.report(func.estree_span(), EXPECTED).data("name", ast_utils::get_function_name_with_kind(func));
        }
    }
}

impl Rule for GetterReturn {
    const META: Meta = Meta::eslint("getter-return", Kind::Problem).recommended().reports_on_exit();
    const ON: On = On::new().funcs();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        GetterReturn {
            allows_implicit: options.object(0).bool_or("allowImplicit", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.has_classes() || file.has_exprs([ExprTag::Object])).then_some(())
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if cx.language().is_oxlint {
            if is_getter_for_oxlint(func) {
                self.check_as_oxlint(func, cx);
            }
            return;
        }
        if !is_getter(func) {
            return;
        }
        if !self.allows_implicit {
            for statement in func.returns() {
                if matches!(statement.kind(), StmtKind::Return(None)) {
                    cx.report(statement, EXPECTED)
                        .data("name", ast_utils::get_function_name_with_kind(func));
                }
            }
        }
        if func.is_end_reachable() {
            let has_return = func.returns().next().is_some();
            cx.report(
                ast_utils::get_function_head_loc(func),
                if has_return { EXPECTED_ALWAYS } else { EXPECTED },
            )
            .data("name", ast_utils::get_function_name_with_kind(func));
        }
    }
}
