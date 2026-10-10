//! `react/rules-of-hooks` of oxlint 1.80. It reports a call once, for the first of its reasons, and decides from what is around the
//! function whether it looks at the flow of control at all.

use crate::rules::react_hooks_rules_of_hooks::{Memo, Ranges};
use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::static_property_name;

const CALLED_HERE: &str = "Hook is called here";

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
            } if value == e && !parent.is_assignment_target() => match target.as_ident() {
                Some(name) => (!target.is_parenthesized()).then_some(name),
                // The `b` of `a.b = () => {}`.
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
        _ => {
            cx.report(node, EFFECT_EVENT_INLINE)
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
        cx.report(e, EFFECT_EVENT_REFERENCE)
            .data("function", e.text())
            .data("hint", hint)
            .first_label("Effect Event escapes its component or custom Hook.");
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
    let report = |message: Message, first_label: &'static str| {
        cx.report(node, message)
            .data("hook", hook)
            .first_label(first_label)
    };
    let is_use = is_react_function_call(call, "use");
    let Some(func) = root
        .as_func()
        .filter(is_function_like)
        .or_else(|| function_around(root, memo))
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
        // oxlint does not look for loops and conditions in a callback. The plugin reports a hook in a loop wherever it is.
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
            if has_name_of_component_or_hook(func) || is_memo_or_forward_ref_callback(func, memo) {
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
    // More of them are around the call than around the function.
    let is_within = |statements: &Ranges| {
        statements.count_around(node.span().start) > statements.count_around(func.span().start)
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

/// What is around `hook` in `func`.
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

/// The nearest condition by which `hook` can be skipped, and what oxlint says there. What is in a condition is evaluated before it
/// decides.
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
