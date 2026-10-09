//! What the rules of `jest` and of `vitest` about hooks do: `beforeEach(..)` and the like. Each module is a file of oxlint's
//! `rules/shared/jest_vitest`. See [`jest`](crate::jest).

use crate::jest::{
    Ctx, JestFnKind, JestGeneralFnKind, PossibleJestNode, Scopes, get_node_name,
    is_type_of_jest_fn_call, iter_possible_jest_call_node, parse_general_jest_fn_call,
};
use bun_core::strings;
use bun_lint::prelude::*;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

pub(crate) const HOOKS: [&str; 4] = ["beforeAll", "beforeEach", "afterEach", "afterAll"];

pub(crate) mod no_duplicate_hooks {
    use super::*;

    const NO_DUPLICATE_HOOKS: Message =
        Message::new("", "Duplicate \"{{hook_name}}\" in describe block.");

    pub(crate) fn run_once<'a>(ctx: &Ctx<'a, '_>) {
        type HookNames<'a> = SmallVec<[&'a [u8]; 4]>;
        // The file, and then the calls of `describe` around, each with its hooks.
        let mut hook_contexts: Vec<(Span, HookNames<'a>)> =
            vec![(Span::new(0, u32::MAX), HookNames::new())];
        for possible_jest_node in iter_possible_jest_call_node(ctx.file) {
            let node = possible_jest_node.node;
            let Some(jest_fn_call) = parse_general_jest_fn_call(ctx.file, possible_jest_node)
            else {
                continue;
            };
            while hook_contexts
                .last()
                .is_some_and(|it| !it.0.contains(node.span()))
            {
                hook_contexts.pop();
            }
            if jest_fn_call.kind == JestFnKind::General(JestGeneralFnKind::Describe) {
                hook_contexts.push((node.span(), HookNames::new()));
            } else if jest_fn_call.kind == JestFnKind::General(JestGeneralFnKind::Hook)
                && let Some((_, hooks)) = hook_contexts.last_mut()
            {
                if hooks.contains(&jest_fn_call.name) {
                    ctx.report(node, NO_DUPLICATE_HOOKS)
                        .data("hook_name", jest_fn_call.name);
                } else {
                    hooks.push(jest_fn_call.name);
                }
            }
        }
    }
}

pub(crate) mod no_hooks {
    use super::*;

    const UNEXPECTED_HOOK: Message = Message::new("", "Do not use setup or teardown hooks.");

    pub(crate) struct NoHooksConfig {
        allow: Vec<String>,
    }

    impl NoHooksConfig {
        pub(crate) fn new(options: &Options) -> Self {
            NoHooksConfig {
                allow: options
                    .object(0)
                    .strings("allow")
                    .into_iter()
                    .map(String::from)
                    .collect(),
            }
        }

        pub(crate) fn run<'a>(&self, possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
            if let Some(callee) = possible_jest_node.node.callee()
                && let Some(name) = callee.as_ident()
                && is_type_of_jest_fn_call(
                    ctx.file,
                    possible_jest_node,
                    &[JestFnKind::General(JestGeneralFnKind::Hook)],
                )
                && !self.allow.iter().any(|it| name.is(it))
            {
                ctx.report(callee, UNEXPECTED_HOOK);
            }
        }
    }
}

pub(crate) mod prefer_hooks_in_order {
    use super::*;

    const REORDER_HOOKS: Message = Message::new("", "Test hooks are not in a consistent order.");

    pub(crate) fn run_once<'a>(ctx: &Ctx<'a, '_>) {
        // Every call counts: one that is no hook ends a run of hooks.
        let mut calls: Vec<Expr<'a>> = ctx.file.exprs_of_kind(ExprTag::Call).collect();
        utils::sort::sort_unstable_by_key(&mut calls, |it| {
            (it.span().start, std::cmp::Reverse(it.span().end))
        });
        let mut scopes = Scopes::default();
        let mut previous_hook_orders: FxHashMap<Option<Node<'a>>, usize> = FxHashMap::default();
        for node in calls {
            let hook_name = parse_general_jest_fn_call(ctx.file, PossibleJestNode::new(node))
                .filter(|it| it.kind == JestFnKind::General(JestGeneralFnKind::Hook))
                .map(|it| it.name);
            // Most calls are not in a scope that has a hook.
            if hook_name.is_none() && previous_hook_orders.is_empty() {
                continue;
            }
            let scope = scopes.of(Node::Expr(node));
            let Some(hook_name) = hook_name else {
                previous_hook_orders.remove(&scope);
                continue;
            };
            let Some(hook_order) = HOOKS.iter().position(|it| it.as_bytes() == hook_name) else {
                continue;
            };
            if previous_hook_orders
                .get(&scope)
                .is_some_and(|previous_hook_order| hook_order < *previous_hook_order)
            {
                ctx.report(node, REORDER_HOOKS);
            } else {
                previous_hook_orders.insert(scope, hook_order);
            }
        }
    }
}

pub(crate) mod prefer_hooks_on_top {
    use super::*;

    const NO_HOOK_ON_TOP: Message = Message::new("", "Suggest having hooks before any test cases.");

    pub(crate) fn run_once<'a>(ctx: &Ctx<'a, '_>) {
        let mut scopes = Scopes::default();
        // The scopes in which there has been a test.
        let mut hooks_context: FxHashSet<Option<Node<'a>>> = FxHashSet::default();
        for possible_jest_node in iter_possible_jest_call_node(ctx.file) {
            let node = possible_jest_node.node;
            match parse_general_jest_fn_call(ctx.file, possible_jest_node).map(|it| it.kind) {
                Some(JestFnKind::General(JestGeneralFnKind::Test)) => {
                    hooks_context.insert(scopes.of(Node::Expr(node)));
                }
                Some(JestFnKind::General(JestGeneralFnKind::Hook))
                    if hooks_context.contains(&scopes.of(Node::Expr(node))) =>
                {
                    ctx.report(node, NO_HOOK_ON_TOP);
                }
                _ => {}
            }
        }
    }
}

pub(crate) mod require_hook {
    use super::*;

    const USE_HOOK: Message =
        Message::new("", "Require setup and teardown code to be within a hook.");

    pub(crate) struct RequireHookConfig {
        allowed_function_calls: Vec<String>,
    }

    impl RequireHookConfig {
        pub(crate) fn new(options: &Options) -> Self {
            let names = options.object(0).strings("allowedFunctionCalls");
            RequireHookConfig {
                allowed_function_calls: names.into_iter().map(String::from).collect(),
            }
        }

        pub(crate) fn run_once<'a>(&self, ctx: &Ctx<'a, '_>) {
            let file = ctx.file;
            self.check_block_body(file.body(), ctx);
            if !file.mentions_any(&["describe", "fdescribe", "xdescribe", "suite"]) {
                return;
            }
            for node in file.exprs_of_kind(ExprTag::Call) {
                if let Some(callback) = node.as_call().and_then(|it| it.args().get(1))
                    && !callback.is_parenthesized()
                    && let Some(statements) = callback.as_fn().and_then(Func::body_statements)
                    && is_type_of_jest_fn_call(
                        file,
                        PossibleJestNode::new(node),
                        &[JestFnKind::General(JestGeneralFnKind::Describe)],
                    )
                {
                    self.check_block_body(statements, ctx);
                }
            }
        }

        fn check_block_body<'a>(&self, statements: List<'a, Stmt<'a>>, ctx: &Ctx<'a, '_>) {
            for stmt in statements {
                match stmt.kind() {
                    StmtKind::Expr(expr) if !expr.is_parenthesized() && !expr.is_chain_root() => {
                        if let Some(call_expr) = expr.as_call()
                            && !self.is_allowed(&get_node_name(call_expr.callee()))
                        {
                            ctx.report(expr, USE_HOOK);
                        }
                    }
                    StmtKind::Var(declarations) if !stmt.is_exported() => {
                        if declarations
                            .first()
                            .is_some_and(|it| it.var_kind() != VarKind::Const)
                            && declarations
                                .iter()
                                .filter_map(VarDecl::init)
                                .any(|it| !is_null_or_undefined(it))
                        {
                            ctx.report(stmt, USE_HOOK);
                        }
                    }
                    _ => {}
                }
            }
        }

        /// `name`: the names of what is called, with dots.
        fn is_allowed(&self, name: &[u8]) -> bool {
            matches!(
                strings::split(name, b".").next(),
                Some(
                    b"afterAll"
                        | b"afterEach"
                        | b"beforeAll"
                        | b"beforeEach"
                        | b"bench"
                        | b"describe"
                        | b"suite"
                        | b"it"
                        | b"test"
                )
            ) || name.starts_with(b"jest.")
                || name.starts_with(b"vi.")
                || self
                    .allowed_function_calls
                    .iter()
                    .any(|it| it.as_bytes() == name)
        }
    }

    fn is_null_or_undefined(e: Expr) -> bool {
        !e.is_parenthesized()
            && (e.tag() == ExprTag::Null
                || e.is_ident("undefined")
                || e.unary_op() == Some(UnOp::Void))
    }
}
