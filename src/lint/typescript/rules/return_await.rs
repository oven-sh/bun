use bun_lint::prelude::*;
use bun_lint::types::utils::{Awaitable, is_higher_precedence_than_await, needs_to_be_awaited};
use bun_lint::utils::ts_utils::{
    FixOrSuggest, get_await_token_removal_range, get_fix_or_suggest,
    is_start_of_arrow_function_body_needing_parentheses,
};
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};

/// Enforce consistent awaiting of returned promises.
pub struct ReturnAwait {
    error_handling_context: WhetherToAwait,
    ordinary_context: WhetherToAwait,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum WhetherToAwait {
    DontCare,
    Await,
    NoAwait,
}

const DISALLOWED_PROMISE_AWAIT: Message = Message::new(
    "disallowedPromiseAwait",
    "Returning an awaited promise is not allowed in this context.",
);
const DISALLOWED_PROMISE_AWAIT_SUGGESTION: Message = Message::new(
    "disallowedPromiseAwaitSuggestion",
    "Remove `await` before the expression. Use caution as this may impact control flow.",
);
const NON_PROMISE_AWAIT: Message = Message::new(
    "nonPromiseAwait",
    "Returning an awaited value that is not a promise is not allowed.",
);
const REQUIRED_PROMISE_AWAIT: Message = Message::new(
    "requiredPromiseAwait",
    "Returning an awaited promise is required in this context.",
);
const REQUIRED_PROMISE_AWAIT_SUGGESTION: Message = Message::new(
    "requiredPromiseAwaitSuggestion",
    "Add `await` before the expression. Use caution as this may impact control flow.",
);

/// Where the first `using` declaration of `statement` ends.
fn end_of_first_resource(statement: Stmt) -> Option<u32> {
    let StmtKind::Var(declarations) = statement.kind() else {
        return None;
    };
    let resources =
        declarations.iter().filter(|declarator| matches!(declarator.var_kind(), VarKind::Using | VarKind::AwaitUsing));
    resources.map(|declarator| declarator.span().end).min()
}

/// For each function, block, loop and `switch` statement that has `using` declarations directly in it: where the first ends.
type Resources<'a> = FxHashMap<Node<'a>, u32>;

fn resources_of<'a>(file: &'a File<'a>) -> Resources<'a> {
    let mut resources = Resources::default();
    for statement in file.stmts_of_kind(StmtTag::Var) {
        let Some(end) = end_of_first_resource(statement) else {
            continue;
        };
        let owner = match statement.parent() {
            Node::Case(case) => case.parent(),
            owner => owner,
        };
        resources.entry(owner).and_modify(|first| *first = end.min(*first)).or_insert(end);
    }
    resources
}

/// Whether a `using` declaration that comes before `node` is in scope, up to the function.
fn affects_explicit_resource_management<'a>(node: Expr<'a>, resources: &Resources<'a>) -> bool {
    if resources.is_empty() {
        return false;
    }
    for ancestor in Node::Expr(node).ancestors() {
        let has_scope = match ancestor {
            Node::Func(_) => true,
            Node::Stmt(statement) => matches!(
                statement.tag(),
                StmtTag::Block | StmtTag::Switch | StmtTag::For | StmtTag::ForIn | StmtTag::ForOf
            ),
            _ => false,
        };
        if has_scope && resources.get(&ancestor).is_some_and(|&end| end < node.span().start) {
            return true;
        }
        if matches!(ancestor, Node::Func(_)) {
            return false;
        }
    }
    false
}

/// Whether `node` is in a `try` statement of its function in such a way that an exception has an
/// impact on the control flow: in a `try` block, or in a `catch` block that a `finally` follows.
fn affects_explicit_error_handling(node: Expr<'_>) -> bool {
    let mut child = Node::Expr(node);
    for ancestor in child.ancestors() {
        match ancestor {
            Node::Func(_) => return false,
            Node::Stmt(statement) => {
                if let StmtKind::Try {
                    block,
                    handler,
                    finalizer,
                    ..
                } = statement.kind()
                    && (child == Node::Stmt(block)
                        || finalizer.is_some() && handler.map(Node::Stmt) == Some(child))
                {
                    return true;
                }
            }
            _ => {}
        }
        child = ancestor;
    }
    false
}

fn remove_await<'a>(fixer: Fixer<'a>, node: Expr<'a>) -> Vec<Fix> {
    let ExprKind::Await(argument) = node.kind() else {
        return Vec::new();
    };
    let file = fixer.file();
    let start = node.span().start;
    let await_token = Span::new(start, start + "await".len() as u32);
    let await_removal_fix = fixer.remove(get_await_token_removal_range(file, await_token));
    let needs_parentheses = file.token_after(await_token).is_some_and(|first_operand_token| {
        is_start_of_arrow_function_body_needing_parentheses(node, &first_operand_token)
    });
    match needs_parentheses {
        true => vec![
            await_removal_fix,
            fixer.insert_before(argument, "("),
            fixer.insert_after(argument, ")"),
        ],
        false => vec![await_removal_fix],
    }
}

fn insert_await<'a>(fixer: Fixer<'a>, node: Expr<'a>) -> Vec<Fix> {
    match is_higher_precedence_than_await(node) {
        true => vec![fixer.insert_before(node, "await ")],
        false => vec![fixer.insert_before(node, "await ("), fixer.insert_after(node, ")")],
    }
}

impl ReturnAwait {
    /// `returned`: what `node` is, or is a branch of. `affects_error_handling`: of `returned`, once it is known. Nothing between
    /// the two makes a difference for it.
    fn test<'a>(
        &self,
        node: Expr<'a>,
        returned: Expr<'a>,
        affects_error_handling: &mut Option<bool>,
        cx: &mut Cx<'a, Self>,
    ) {
        let (is_await, child) = match node.kind() {
            ExprKind::Await(argument) => (true, argument),
            _ => (false, node),
        };
        let certainty = needs_to_be_awaited(node, child.ty());

        if certainty != Awaitable::Always {
            if is_await && certainty == Awaitable::Never {
                cx.report(node, NON_PROMISE_AWAIT).fix(|fixer| remove_await(fixer, node));
            }
            return;
        }

        // It is a thenable.
        let affects_error_handling = *affects_error_handling.get_or_insert_with(|| {
            let file = cx.file();
            affects_explicit_error_handling(returned)
                || affects_explicit_resource_management(returned, cx.state.get_or_insert_with(|| resources_of(file)))
        });
        let (should_await_in_current_context, fix_or_suggest) = match affects_error_handling {
            true => (self.error_handling_context, FixOrSuggest::Suggest),
            false => (self.ordinary_context, FixOrSuggest::Fix),
        };
        match should_await_in_current_context {
            WhetherToAwait::Await if !is_await => {
                get_fix_or_suggest(
                    cx.report(node, REQUIRED_PROMISE_AWAIT),
                    fix_or_suggest,
                    REQUIRED_PROMISE_AWAIT_SUGGESTION,
                    |fixer| insert_await(fixer, node),
                );
            }
            WhetherToAwait::NoAwait if is_await => {
                get_fix_or_suggest(
                    cx.report(node, DISALLOWED_PROMISE_AWAIT),
                    fix_or_suggest,
                    DISALLOWED_PROMISE_AWAIT_SUGGESTION,
                    |fixer| remove_await(fixer, node),
                );
            }
            _ => {}
        }
    }

    /// Upstream's `findPossiblyReturnedNodes`.
    fn test_possibly_returned_nodes<'a>(&self, returned: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let mut affects_error_handling = None;
        let mut rest: SmallVec<[Expr<'a>; 8]> = smallvec![returned];
        while let Some(node) = rest.pop() {
            match node.kind() {
                ExprKind::Cond { yes, no, .. } => rest.extend([yes, no]),
                _ => self.test(node, returned, &mut affects_error_handling, cx),
            }
        }
    }
}

impl Rule for ReturnAwait {
    const META: Meta = Meta::typescript("return-await", Kind::Problem)
        .fixable(Fixable::Code)
        .has_suggestions()
        .presets(Presets::STRICT_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new().funcs().stmts(&[StmtTag::Return]);
    /// Once it has been asked for.
    type State<'a> = Option<Resources<'a>>;

    fn new(options: &Options) -> Self {
        use WhetherToAwait::{Await, DontCare, NoAwait};
        let (error_handling_context, ordinary_context) = match options.str(0) {
            Some("always") => (Await, Await),
            Some("error-handling-correctness-only") => (Await, DontCare),
            Some("never") => (NoAwait, NoAwait),
            _ => (Await, NoAwait),
        };
        ReturnAwait {
            error_handling_context,
            ordinary_context,
        }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Option<Resources<'a>>> {
        Some(None)
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if func.is_async()
            && let FnBody::Expr(body) = func.body()
        {
            self.test_possibly_returned_nodes(body, cx);
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Return(Some(argument)) = statement.kind() else {
            return;
        };
        let mut functions = Node::Stmt(statement).ancestors().filter_map(Node::as_func);
        if functions
            .find(|func| func.kind() != FnKind::StaticBlock)
            .is_some_and(Func::is_async)
        {
            self.test_possibly_returned_nodes(argument, cx);
        }
    }
}
