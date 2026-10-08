//! `react/rules-of-hooks` of oxlint 1.80. It reports a call once, for the first of its reasons, and decides from what is around the
//! function whether it looks at the flow of control at all.

use crate::rules::react_hooks_rules_of_hooks::{Memo, Ranges};
use bun_lint::prelude::*;

const FUNCTION: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" is called in function \"{{function}}\" that is neither a React function component nor a custom React Hook function. React component names must start with an uppercase letter. React Hook names must start with the word \"use\".",
);
const CONDITIONAL: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" is called conditionally. React Hooks must be called in the exact same order in every component render.",
);
const LOOP: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" may be executed more than once. Possibly because it is called in a loop. React Hooks must be called in the exact same order in every component render.",
);
const TOP_LEVEL: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" cannot be called at the top level. React Hooks must be called in a React function component or a custom React Hook function.",
);
const ASYNC: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" cannot be called in an async function. ",
);
const TRY_CATCH: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" cannot be called in a try/catch block.",
);
const CLASS: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" cannot be called in a class component. React Hooks must be called in a React function component or a custom React Hook function.",
);
const CALLBACK: Message = Message::new(
    "",
    "React Hook \"{{hook}}\" cannot be called inside a callback. React Hooks must be called in a React function component or a custom React Hook function.",
);
const EFFECT_EVENT_REFERENCE: Message = Message::new(
    "",
    "`{{function}}` is a function created with React Hook \"useEffectEvent\", and can only be called from Effects and Effect Events in the same component.{{hint}}",
);
const EFFECT_EVENT_INLINE: Message = Message::new(
    "",
    "React Hook \"useEffectEvent\" can only be called at the top level of your component. It cannot be passed down.",
);

/// What the code path says about a call.
#[derive(Copy, Clone)]
pub(crate) struct Flow {
    pub(crate) is_reachable: bool,
    /// It can be reached from itself.
    pub(crate) is_cyclic: bool,
    /// There is a way through the function that does not lead through it.
    pub(crate) is_conditional: bool,
}

fn is_component_or_hook_name(name: &[u8]) -> bool {
    name.first().is_some_and(u8::is_ascii_uppercase)
        || crate::rules::react_hooks_rules_of_hooks::is_hook_name(name)
}

/// oxc's `callee_name`
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

fn function_around<'a>(node: Node<'a>, memo: &mut Memo<'a>) -> Option<Func<'a>> {
    memo.function_around
        .find(node, |_, parent| parent.as_func().filter(is_function_like))
}

/// The expression that the function is, if nothing is around it.
fn bare_expression(func: Func) -> Option<Expr> {
    func.owner().as_expr().filter(|it| !it.is_parenthesized())
}

/// The name of a function declaration or of a named function expression.
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
            // Not the default of what is assigned to: `({ a = () => {} } = {})`.
            ExprKind::Assign {
                op: None,
                target,
                value,
            } if value == e && !parent.is_assignment_target() => {
                target.as_ident().filter(|_| !target.is_parenthesized())
            }
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

fn has_name_of_component_or_hook(func: Func) -> bool {
    let name = if func.is_arrow() {
        get_declaration_identifier(func)
    } else {
        own_name(func)
    };
    name.is_some_and(|it| is_component_or_hook_name(it.bytes()))
}

/// A function around `node` has the name of a component or of a hook, or is in a call of `memo` or `forwardRef`.
fn is_somewhere_inside_component_or_hook<'a>(node: Node<'a>, memo: &mut Memo<'a>) -> bool {
    // All that is around an outer function is around the innermost one.
    let Some(innermost) = function_around(node, memo) else {
        return false;
    };
    let is_one = |it: Node<'a>| match it.as_func().filter(is_function_like) {
        Some(func) => has_name_of_component_or_hook(func),
        None => is_memo_or_forward_ref_call(it),
    };
    memo.inside_component_or_hook
        .find(Node::Func(innermost), |it, _| is_one(it).then_some(()))
        .is_some()
}

/// It is passed to a call, other than of `memo` and `forwardRef`, to a constructor, or to an element.
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
        _ => return drop(cx.report(node, EFFECT_EVENT_INLINE)),
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
        cx.report(e, EFFECT_EVENT_REFERENCE)
            .data("function", e.text())
            .data("hint", hint);
    }
}

/// `node`: a call of what has the name of a hook. `root`: what the code path that it is in starts with.
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
    let report = |at: Span, message: Message| drop(cx.report(at, message).data("hook", hook));
    let is_use = is_react_function_call(call, "use");
    let Some(func) = root
        .as_func()
        .filter(is_function_like)
        .or_else(|| function_around(root, memo))
    else {
        return report(node.span(), TOP_LEVEL);
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
        return report(node.span(), CLASS);
    }
    let function_error = |name: &'a [u8]| {
        drop(
            cx.report(call.callee(), FUNCTION)
                .data("hook", hook)
                .data("function", name),
        )
    };
    let is_declared_as_something_else = || {
        get_declaration_identifier(func).is_some_and(|it| !is_component_or_hook_name(it.bytes()))
    };
    match own_name(func) {
        Some(name) if !is_component_or_hook_name(name.bytes()) => {
            return function_error(name.bytes());
        }
        // oxlint does not look for loops and conditions in a callback. The plugin reports a hook in a loop wherever it is.
        None if is_non_react_func_arg(func) => {
            if !is_use && is_somewhere_inside_component_or_hook(Node::Func(func), memo) {
                report(node.span(), CALLBACK);
            }
            return;
        }
        None if !(func.is_arrow() && func.is_async()) => {
            if is_declared_as_something_else() {
                return function_error(b"Anonymous");
            }
        }
        _ if func.is_async() => {
            if has_name_of_component_or_hook(func) || is_memo_or_forward_ref_callback(func, memo) {
                return report(node.span(), ASYNC);
            }
            if is_declared_as_something_else() {
                return function_error(b"Anonymous");
            }
        }
        _ => {}
    }
    // More of them are around the call than around the function.
    let is_within = |statements: &Ranges| {
        statements.count_around(node.span().start) > statements.count_around(func.span().start)
    };
    let is_inside_try_catch = is_within(memo.try_statements(cx.file()));
    if is_use {
        if is_inside_try_catch {
            report(node.span(), TRY_CATCH);
        }
        return;
    }
    let is_cyclic = flow.is_cyclic || is_within(memo.do_while_loops(cx.file()));
    if is_inside_try_catch {
        return report(node.span(), if is_cyclic { LOOP } else { CONDITIONAL });
    }
    if !flow.is_reachable {
        return;
    }
    if is_cyclic {
        report(node.span(), LOOP);
    } else if flow.is_conditional {
        report(node.span(), CONDITIONAL);
    }
}
