use bun_lint_oxlint::ast_util::is_method_call;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow all usage of `process.exit()`.
pub struct NoProcessExit;

const NO_PROCESS_EXIT: Message = Message::new("", "Don't use `process.exit()`");

#[derive(Default)]
pub struct State<'a> {
    /// What is in a call of `process.on()` or `process.once()`.
    process_event_handlers: AncestorMemo<'a, ()>,
    is_worker_threads_imported: Option<bool>,
}

impl Rule for NoProcessExit {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-process-exit", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoProcessExit
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        // Not in what has a hashbang.
        if file.mentions("exit") && file.mentions("process") && !file.text().starts_with(b"#!") {
            on.exprs([ExprTag::Call], |_, e, cx| {
                if !e.as_call().is_some_and(|it| is_method_call(it, Some(&["process"]), Some(&["exit"]), None, None)) {
                    return;
                }
                let file = cx.file();
                if !*cx.state.is_worker_threads_imported.get_or_insert_with(|| is_worker_threads_imported(file))
                    && cx.state.process_event_handlers.find(Node::Expr(e), is_process_event_handler).is_none()
                {
                    cx.report(e, NO_PROCESS_EXIT);
                }
            });
        }
        State::default()
    }
}

fn is_process_event_handler<'a>(_: Node<'a>, parent: Node<'a>) -> Option<()> {
    let call = parent.as_expr()?.as_call()?;
    is_method_call(call, Some(&["process"]), Some(&["on", "once"]), Some(1), None).then_some(())
}

/// Something is imported from it, not only the module.
fn is_worker_threads_imported<'a>(file: &'a File<'a>) -> bool {
    file.mentions_any(&["worker_threads", "node:worker_threads"])
        && file.body().iter().any(|it| {
            matches!(it.kind(), StmtKind::Import(import)
                if import.spec().is_any(&["worker_threads", "node:worker_threads"])
                    && (import.default().is_some() || import.namespace().is_some() || !import.named().is_empty()))
        })
}
