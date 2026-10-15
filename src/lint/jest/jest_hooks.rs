//! What the rules of `jest` and of `vitest` about hooks do: `beforeEach(..)` and the like. Each module is a file of oxlint's
//! `rules/shared/jest_vitest`. See [`jest`](crate::jest).

use crate::jest::{
    Arguments, Ctx, JestFnKind, JestGeneralFnKind, PossibleJestNode, Runner, Scopes,
    first_identifier_of_chain, for_each_call_named_like, get_node_name_vec,
    is_type_of_jest_fn_call, iter_possible_jest_call_node, mention_bits, mentions_any,
    parse_general_jest_fn_call,
};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::is_null_or_undefined;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

pub(crate) const HOOKS: [&str; 4] = ["beforeAll", "beforeEach", "afterEach", "afterAll"];

/// Whether the file can have a hook, under whatever name.
pub(crate) fn mentions_hook(file: &File) -> bool {
    mentions_any(file, &const { mention_bits(HOOKS) })
}

pub(crate) mod no_duplicate_hooks {
    use super::*;

    const NO_DUPLICATE_HOOKS: Message =
        Message::new("", "Duplicate \"{{hook_name}}\" in describe block.");

    pub(crate) fn run_once<'a>(ctx: &Ctx<'a, '_>) {
        type HookNames<'a> = SmallVec<[&'a [u8]; 4]>;
        // The file, and then the calls of `describe` around, each with its hooks.
        let mut hook_contexts: Vec<(Span, HookNames<'a>)> =
            vec![(Span::new(0, u32::MAX), HookNames::new())];
        for possible_jest_node in iter_possible_jest_call_node(ctx.file, ctx.runner) {
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
        // What a hook starts with.
        let names: SmallVec<[Name<'a>; 4]> = (HOOKS.iter())
            .filter_map(|it| ctx.file.find_name(it))
            .collect();
        let is_name = |it: &Name<'a>| names.contains(it);
        if names.is_empty()
            || !(ctx.file.exprs_of_kind(ExprTag::Ident))
                .any(|it| it.as_ident().is_some_and(|it| is_name(&it)))
        {
            return;
        }
        // Every call counts: one that is no hook ends a run of hooks.
        let mut calls: Vec<Expr<'a>> = ctx.file.exprs_of_kind(ExprTag::Call).collect();
        utils::sort::sort_unstable_by_key(&mut calls, |it| {
            (it.span().start, std::cmp::Reverse(it.span().end))
        });
        let mut scopes = Scopes::default();
        let mut previous_hook_orders: FxHashMap<Option<Node<'a>>, (usize, Span)> =
            FxHashMap::default();
        for node in calls {
            let hook_name = (node.callee().and_then(first_identifier_of_chain))
                .filter(is_name)
                .and_then(|_| {
                    parse_general_jest_fn_call(ctx.file, PossibleJestNode::new(node, ctx.runner))
                })
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
            if let Some(&(previous_hook_order, previous_hook_span)) = previous_hook_orders
                .get(&scope)
                .filter(|previous| hook_order < previous.0)
            {
                let name = |order: usize| HOOKS.get(order).copied().unwrap_or_default();
                let (hook, previous) = (name(hook_order), name(previous_hook_order));
                ctx.report(node, REORDER_HOOKS)
                    .data("hook", hook_name)
                    .data("previous_hook", previous)
                    .labels_with(|labels| {
                        labels.first(format!(
                            "this should be moved to before the {previous:?} hook"
                        ));
                        labels.push(
                            previous_hook_span,
                            format!("{hook:?} hook should be called before this"),
                        );
                    });
            } else {
                previous_hook_orders.insert(scope, (hook_order, node.span()));
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
        for possible_jest_node in iter_possible_jest_call_node(ctx.file, ctx.runner) {
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
            self.check_block_body(file.body(), Node::File(file), ctx);
            for_each_call_named_like(file, &[JestGeneralFnKind::Describe], &mut |node| {
                if let Some(callback) =
                    (node.as_call()).and_then(|it| Arguments::of(it.args(), ctx.runner).callback)
                    && !callback.is_parenthesized()
                    && let Some(statements) = callback.as_fn().and_then(Func::body_statements)
                    && is_type_of_jest_fn_call(
                        file,
                        PossibleJestNode::new(node, ctx.runner),
                        &[JestFnKind::General(JestGeneralFnKind::Describe)],
                    )
                {
                    self.check_block_body(statements, Node::Expr(node), ctx);
                }
            });
        }

        /// `around`: the program, or the call of `describe`, which oxlint's rule is called with.
        fn check_block_body<'a>(
            &self,
            statements: List<'a, Stmt<'a>>,
            around: Node<'a>,
            ctx: &Ctx<'a, '_>,
        ) {
            let report = |at: Span| drop(ctx.report(at, USE_HOOK).called_with(around));
            for stmt in statements {
                if let Some(expr) = stmt.as_expr() {
                    if let Some(call_expr) = expr.as_call()
                        && !expr.is_parenthesized()
                        && !expr.is_chain_root()
                        && !self.is_allowed(&get_node_name_vec(call_expr.callee()), ctx.runner)
                    {
                        report(expr.span());
                    }
                } else if let Some(declarations) = stmt.as_var()
                    && !stmt.is_exported()
                    && declarations
                        .first()
                        .is_some_and(|it| it.var_kind() != VarKind::Const)
                    && declarations
                        .iter()
                        .filter_map(VarDecl::init)
                        .any(|it| !is_null_or_undefined(it))
                {
                    report(stmt.span());
                }
            }
        }

        /// `names`: the names of what is called, which are looked at with dots between them.
        fn is_allowed(&self, names: &[&[u8]], runner: Runner) -> bool {
            let first = names.first().copied().unwrap_or_default();
            let is_member_of = |object: &[u8]| match first.strip_prefix(object) {
                Some(rest) => rest.first().map_or(names.len() > 1, |it| *it == b'.'),
                None => false,
            };
            matches!(
                strings::split(first, b".").next(),
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
            ) || is_member_of(b"jest")
                || is_member_of(b"vi")
                || runner == Runner::Bun
                    && (matches!(
                        first,
                        b"expectTypeOf" | b"setDefaultTimeout" | b"xdescribe" | b"xit" | b"xtest"
                    ) || is_member_of(b"expect")
                        || is_member_of(b"mock"))
                || !self.allowed_function_calls.is_empty() && {
                    let name = names.join(&b"."[..]);
                    self.allowed_function_calls
                        .iter()
                        .any(|it| it.as_bytes() == name)
                }
        }
    }
}
