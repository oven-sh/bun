//! oxlint 1.80's `react/rules-of-hooks`. It reports each call once, for the first reason that applies, and decides from
//! the function's surroundings whether to look at control flow at all.

use crate::rules::react_hooks_rules_of_hooks::{
    CALLBACK, CLASS, EFFECT_EVENT_FUNCTION, EFFECT_EVENT_PASSED_DOWN, FUNCTION, LOOP, Memo, Ranges,
    TOP_LEVEL, TRY_CATCH,
};
use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::static_property_name;

const CALLED_HERE: &str = "Hook is called here";

const CONDITIONAL: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" is called conditionally. React Hooks must be called in the exact same order in every component render.",
);
const ASYNC: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" cannot be called in an async function. ",
);

/// The results of code path analysis for a call.
#[derive(Copy, Clone)]
pub(crate) struct Flow {
    pub(crate) is_reachable: bool,
    /// True if it can be reached from itself.
    pub(crate) is_cyclic: bool,
    /// True if some path through the function skips it.
    pub(crate) is_conditional: bool,
}

fn is_component_or_hook_name(name: &[u8]) -> bool {
    name.first().is_some_and(u8::is_ascii_uppercase)
        || crate::rules::react_hooks_rules_of_hooks::is_hook_name(name)
}

fn callee_name(call: Call) -> Option<Name> {
    let callee = call.callee();
    match callee.kind() {
        _ if callee.is_parenthesized() => None,
        ExprKind::Ident(name) => Some(name),
        ExprKind::Dot { name, .. } if !name.bytes().starts_with(b"#") => Some(name.name()),
        ExprKind::Index { index, .. } => index.as_string(),
        _ => None,
    }
}

/// `name(..)`, `React.name(..)`
fn is_react_function_call(call: Call, name: &str) -> bool {
    callee_name(call).is_some_and(|it| it.is(name))
        && match call.callee().kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                obj.skip_type_wrappers().is_ident("React")
            }
            _ => true,
        }
}

/// `Function` or `ArrowFunctionExpression`
fn is_function_like(func: &Func) -> bool {
    func.has_body() && func.kind() != FnKind::StaticBlock
}

fn enclosing_function_of<'a>(node: Node<'a>, memo: &mut Memo<'a>) -> Option<Func<'a>> {
    memo.enclosing_function
        .find(node, |_, parent| parent.as_func().filter(is_function_like))
}

/// The function's expression, if it isn't parenthesized.
fn bare_expression(func: Func) -> Option<Expr> {
    func.owner().as_expr().filter(|it| !it.is_parenthesized())
}

/// The name of a function declaration or a named function expression.
fn own_name(func: Func) -> Option<Name> {
    func.name()
        .filter(|_| matches!(func.kind(), FnKind::Decl | FnKind::Expr))
        .map(|it| it.name())
}

fn get_declaration_identifier(func: Func) -> Option<Name> {
    if let Some(name) = own_name(func) {
        return Some(name);
    }
    let e = bare_expression(func)?;
    match e.parent() {
        Node::VarDecl(declarator) => declarator.pat().as_ident(),
        Node::Expr(parent) => match parent.kind() {
            // Not a default in a destructuring assignment: `({ a = () => {} } = {})`.
            ExprKind::Assign {
                op: None,
                target,
                value,
            } if value == e && !parent.is_assignment_target() => match target.as_ident() {
                Some(name) => (!target.is_parenthesized()).then_some(name),
                // The `b` in `a.b = () => {}`.
                None => static_property_name(target),
            },
            _ => None,
        },
        Node::PatElem(element) => element.pat()?.as_ident(),
        Node::PatProp(prop) if prop.default() == Some(e) => prop.value().as_ident(),
        Node::Prop(prop) if !prop.is_jsx_attribute() && prop.value() == Some(e) => {
            prop.key()?.name()
        }
        _ => None,
    }
}

fn is_memo_or_forward_ref_call(node: Node) -> bool {
    match node.as_expr().map(Expr::kind) {
        Some(ExprKind::Call(call)) => {
            callee_name(call).is_some_and(|it| it.is_any(&["forwardRef", "memo"]))
        }
        _ => false,
    }
}

fn is_memo_or_forward_ref_callback<'a>(func: Func<'a>, memo: &mut Memo<'a>) -> bool {
    memo.in_memo_or_forward_ref
        .find(Node::Func(func), |_, parent| {
            is_memo_or_forward_ref_call(parent).then_some(())
        })
        .is_some()
}

fn is_named_like_component_or_hook(func: Func) -> bool {
    let name = if func.is_arrow() {
        get_declaration_identifier(func)
    } else {
        own_name(func)
    };
    name.is_some_and(|it| is_component_or_hook_name(it.bytes()))
}

/// True if a function enclosing `node` is named like a component or a hook, or is inside a `memo` or `forwardRef` call.
fn is_somewhere_inside_component_or_hook<'a>(node: Node<'a>, memo: &mut Memo<'a>) -> bool {
    // Start at the innermost function, whose ancestors include every outer function's.
    let Some(innermost) = enclosing_function_of(node, memo) else {
        return false;
    };
    let is_component_or_hook = |it: Node<'a>| match it.as_func().filter(is_function_like) {
        Some(func) => is_named_like_component_or_hook(func),
        None => is_memo_or_forward_ref_call(it),
    };
    memo.inside_component_or_hook
        .find(Node::Func(innermost), |it, _| {
            is_component_or_hook(it).then_some(())
        })
        .is_some()
}

/// True if the function is passed to a call (other than `memo` and `forwardRef`), a constructor or a JSX element.
fn is_non_react_func_arg(func: Func) -> bool {
    let Some(e) = bare_expression(func) else {
        return false;
    };
    if e.jsx_container_span().is_some() {
        return true;
    }
    match e.parent().as_expr().map(Expr::kind) {
        Some(ExprKind::Call(call)) => {
            !is_react_function_call(call, "forwardRef") && !is_react_function_call(call, "memo")
        }
        Some(ExprKind::New(_)) => true,
        _ => false,
    }
}

fn is_effect_or_effect_event_call(call: Call, additional_effect_hooks: Option<&Regex>) -> bool {
    [
        "useEffect",
        "useLayoutEffect",
        "useInsertionEffect",
        "useEffectEvent",
    ]
    .iter()
    .any(|it| is_react_function_call(call, it))
        || additional_effect_hooks.is_some_and(|hooks| {
            callee_name(call).is_some_and(|name| {
                hooks.test(name.bytes())
                    && std::str::from_utf8(name.bytes())
                        .is_ok_and(|it| is_react_function_call(call, it))
            })
        })
}

fn check_use_effect_event_usage<'a, R: Rule>(cx: &Cx<'a, R>, node: Expr<'a>, memo: &mut Memo<'a>) {
    let declarator = match node.parent() {
        Node::VarDecl(declarator) if !node.is_parenthesized() => declarator,
        Node::Stmt(stmt)
            if stmt.tag() == StmtTag::Expr && !stmt.is_wrapper() && !node.is_parenthesized() =>
        {
            return;
        }
        _ => {
            cx.report(node, EFFECT_EVENT_PASSED_DOWN)
                .first_label("Effect Event is passed directly instead of being assigned locally.");
            return;
        }
    };
    if !is_somewhere_inside_component_or_hook(Node::Expr(node), memo) {
        return;
    }
    let Some(symbol) = declarator
        .pat()
        .symbol()
        .filter(|_| declarator.pat().tag() == PatTag::Ident)
    else {
        return;
    };
    let effects = memo.effects.get_or_init(|| {
        let settings = cx
            .settings()
            .get(b"react-hooks")
            .and_then(|it| it.get(b"additionalEffectHooks")?.as_str());
        let additional_effect_hooks = settings.and_then(|it| Regex::from_bytes(it, b"").ok());
        let is_effect = |it: &Expr| {
            it.as_call().is_some_and(|it| {
                is_effect_or_effect_event_call(it, additional_effect_hooks.as_ref())
            })
        };
        Ranges::new(
            cx.file()
                .exprs_of_kind(ExprTag::Call)
                .filter(is_effect)
                .map(Expr::span),
        )
    });
    for e in symbol.references().filter_map(Reference::expr) {
        if effects.contains(e.span().start) {
            continue;
        }
        let is_called = matches!(e.parent().as_expr().map(Expr::kind), Some(ExprKind::Call(call)) if call.callee().outer_span() == e.span());
        let hint = if is_called {
            ""
        } else {
            " It cannot be assigned to a variable or passed down."
        };
        cx.report(e, EFFECT_EVENT_FUNCTION)
            .data("function", e.text())
            .data("hint", hint)
            .first_label("Effect Event escapes its component or custom Hook.");
    }
}

/// `node` is a call whose callee is named like a hook. `root` is the node that starts the code path it's in.
pub(crate) fn check<'a, R: Rule>(
    cx: &Cx<'a, R>,
    node: Expr<'a>,
    root: Node<'a>,
    flow: Flow,
    memo: &mut Memo<'a>,
) {
    let ExprKind::Call(call) = node.kind() else {
        return;
    };
    let Some(hook) = callee_name(call) else {
        return;
    };
    let report = |message: Message, first_label: &'static str| {
        cx.report(node, message)
            .data("hook", hook)
            .first_label(first_label)
    };
    let is_use = is_react_function_call(call, "use");
    let Some(func) = root
        .as_func()
        .filter(is_function_like)
        .or_else(|| enclosing_function_of(root, memo))
    else {
        report(
            TOP_LEVEL,
            "This Hook call is outside a component or custom Hook.",
        );
        return;
    };
    if is_react_function_call(call, "useEffectEvent") {
        check_use_effect_event_usage(cx, node, memo);
    }
    let is_in_class = match func.owner() {
        Node::Member(_) => true,
        Node::Expr(e) => {
            !e.is_parenthesized()
                && matches!(e.parent(), Node::Member(member) if !member.flags().contains(Flags::ACCESSOR))
        }
        _ => false,
    };
    if is_in_class {
        report(CLASS, CALLED_HERE).labels_with(|labels| {
            if let Some(class) = Node::Func(func).enclosing_class() {
                let span = class
                    .name()
                    .map_or_else(|| class.keyword_span(), Ident::span);
                labels.push(span, "Class component is defined here.");
            }
        });
        return;
    }
    let function_error = |name: &'a [u8], outer_function: Span| {
        cx.report(call.callee(), FUNCTION)
            .data("hook", hook)
            .data("function", name)
            .first_label(CALLED_HERE)
            .label(outer_function, "Outer function");
    };
    let is_declared_as_something_else = || {
        get_declaration_identifier(func).is_some_and(|it| !is_component_or_hook_name(it.bytes()))
    };
    match own_name(func) {
        Some(name) if !is_component_or_hook_name(name.bytes()) => {
            let outer_function = func.name().map(Ident::span).unwrap_or_default();
            return function_error(name.bytes(), outer_function);
        }
        // oxlint doesn't look for loops and conditions in a callback. The plugin reports a hook in a loop anywhere.
        None if is_non_react_func_arg(func) => {
            if !is_use && is_somewhere_inside_component_or_hook(Node::Func(func), memo) {
                report(CALLBACK, "This Hook call is inside a nested callback.");
            }
            return;
        }
        None if !(func.is_arrow() && func.is_async()) => {
            if is_declared_as_something_else() {
                return function_error(b"Anonymous", func.estree_span());
            }
        }
        _ if func.is_async() => {
            if is_named_like_component_or_hook(func) || is_memo_or_forward_ref_callback(func, memo)
            {
                let start = func.estree_span().start;
                report(ASYNC, CALLED_HERE)
                    .label(Span::new(start, start + 5), "This function is async.");
                return;
            }
            if is_declared_as_something_else() {
                return function_error(b"Anonymous", func.estree_span());
            }
        }
        _ => {}
    }
    // True if more of the statements enclose the call than enclose the function.
    let is_within = |statements: &Ranges| {
        statements.count_containing(node.span().start)
            > statements.count_containing(func.span().start)
    };
    let is_inside_try_catch = is_within(memo.try_statements(cx.file()));
    if is_use {
        if is_inside_try_catch {
            report(TRY_CATCH, "This Hook call is inside a try/catch block.");
        }
        return;
    }
    let is_cyclic = flow.is_cyclic || is_within(memo.do_while_loops(cx.file()));
    if !is_inside_try_catch && !flow.is_reachable {
        return;
    }
    if is_cyclic {
        report(LOOP, CALLED_HERE).labels_with(|labels| {
            if let Some(keyword) = loop_keyword_span(node, func) {
                labels.push(keyword, "This loop may execute the Hook more than once.");
            }
        });
    } else if is_inside_try_catch || flow.is_conditional {
        report(
            CONDITIONAL,
            "This Hook call is not reachable on every render path.",
        )
        .labels_with(|labels| {
            if let Some((span, text)) = conditional_context(node, func) {
                labels.push(span, text);
            }
        });
    }
}

/// The ancestors of `hook` inside `func`.
fn within<'a>(hook: Expr<'a>, func: Func<'a>) -> impl Iterator<Item = Node<'a>> {
    Node::Expr(hook)
        .ancestors()
        .take_while(move |it| *it != Node::Func(func))
}

fn loop_keyword_span<'a>(hook: Expr<'a>, func: Func<'a>) -> Option<Span> {
    let statement = within(hook, func).find_map(|it| it.as_stmt().filter(|it| it.is_loop()))?;
    let start = statement.span().start;
    let len = match statement.tag() {
        StmtTag::DoWhile => 2,
        StmtTag::While => 5,
        _ => 3,
    };
    Some(Span::new(start, start + len))
}

/// The nearest condition that can skip `hook`, and the text of oxlint's label there. A hook inside the condition itself
/// doesn't count, because it's evaluated before the branch is taken.
fn conditional_context<'a>(hook: Expr<'a>, func: Func<'a>) -> Option<(Span, &'static str)> {
    within(hook, func).find_map(|ancestor| {
        let (condition, text) = match ancestor {
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::If { test, no, .. } => (
                    test.outer_span(),
                    match no.is_some_and(|it| it.span().contains(hook.span())) {
                        true => "When this condition is true, this Hook is skipped.",
                        false => "When this condition is false, this Hook is skipped.",
                    },
                ),
                _ => return None,
            },
            Node::Expr(e) => match e.kind() {
                ExprKind::Cond { test, .. } => (
                    test.outer_span(),
                    "Only one side of this conditional expression calls the Hook.",
                ),
                ExprKind::Binary { op, left, .. } => (
                    left.outer_span(),
                    match op {
                        BinOp::And => "This short-circuits when falsy, skipping the Hook call.",
                        BinOp::Or => "This short-circuits when truthy, skipping the Hook call.",
                        BinOp::Nullish => {
                            "This short-circuits when not nullish, skipping the Hook call."
                        }
                        _ => return None,
                    },
                ),
                _ => return None,
            },
            Node::Case(case) => {
                let start = case.span().start;
                let default = Span::new(start, start + 7);
                (
                    case.test().map_or(default, Expr::outer_span),
                    "Only this switch case calls the Hook.",
                )
            }
            _ => return None,
        };
        (!condition.contains(hook.span())).then_some((condition, text))
    })
}
