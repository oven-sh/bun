use bun_lint_oxlint::ast_util::{is_decorator_expression, is_global_reference_name};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Enforces having one or more empty lines after the last top-level import statement or require call.
pub struct NewlineAfterImport {
    count: usize,
    exact_count: bool,
    consider_comments: bool,
}

const NEWLINE_AFTER_IMPORT: Message = Message::new(
    "",
    "Expected {{count}} empty line{{line_suffix}} after {{keyword}} statement not followed by another {{keyword}}.",
);

#[derive(Default)]
pub struct State<'a> {
    /// Where the statements at the top level start that have a `require("a")` which counts.
    with_require: Vec<u32>,
    /// That something is in a function, a block, an object literal or a decorator.
    hidden: AncestorMemo<'a, ()>,
}

impl Rule for NewlineAfterImport {
    const META: Meta = Meta::oxlint(Plugin::Import, "newline-after-import", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NewlineAfterImport {
            count: options.usize("count").unwrap_or(1),
            exact_count: options.bool_or("exactCount", false),
            consider_comments: options.bool_or("considerComments", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        let mentions_require = file.mentions("require");
        if mentions_require {
            on.exprs([ExprTag::Call], |_, e, cx| {
                if is_top_level_static_require_call(e, &mut cx.state.hidden)
                    && let Some(stmt) = cx.file().body().around(e.span().start)
                {
                    cx.state.with_require.push(stmt.span().start);
                }
            });
        }
        if mentions_require || file.has_stmts([StmtTag::Import, StmtTag::ImportEquals]) {
            on.finish(Self::check_all);
        }
        State::default()
    }
}

fn is_import_statement(stmt: Stmt) -> bool {
    stmt.tag() == StmtTag::Import || stmt.tag() == StmtTag::ImportEquals && !stmt.is_exported()
}

/// `require("a")`, where nothing declares `require`, that is in no function, block, object literal or decorator.
fn is_top_level_static_require_call<'a>(e: Expr<'a>, hidden: &mut AncestorMemo<'a, ()>) -> bool {
    let Some(call) = e.as_call() else {
        return false;
    };
    if call.args().len() != 1
        || !call.args().first().is_some_and(|it| it.tag() == ExprTag::String && !it.is_parenthesized())
        || !call.callee().is_ident("require")
    {
        return false;
    }
    let hides = |child: Node<'a>, parent: Node<'a>| match parent {
        Node::Func(func) => func.kind() != FnKind::StaticBlock,
        Node::Stmt(stmt) => matches!(stmt.kind(), StmtKind::Block(_)),
        Node::Expr(e) => e.tag() == ExprTag::Object,
        Node::Class(_) | Node::Member(_) => matches!(child, Node::Expr(e) if is_decorator_expression(e)),
        _ => false,
    };
    hidden.find(Node::Expr(e), |child, parent| hides(child, parent).then_some(())).is_none()
        && is_global_reference_name(call.callee(), "require")
}

/// Where what counts of `stmt` starts: its first decorator, which can be after the `export`.
fn next_statement_start(stmt: Stmt) -> u32 {
    let first_decorator = match stmt.kind() {
        StmtKind::Class(class) => class.modifiers().iter().find(|it| it.decorator().is_some()),
        _ => None,
    };
    first_decorator.map_or_else(|| stmt.span().start, |it| it.span().start)
}

impl NewlineAfterImport {
    fn check_all<'a>(&self, cx: &mut Cx<'a, Self>) {
        let body = cx.file().body();
        let mut previous_import = None;
        for next in body {
            if let Some(import) = previous_import {
                self.check(import, "import", next, is_import_statement(next), cx);
            }
            previous_import = is_import_statement(next).then_some(next);
        }
        let mut with_require = std::mem::take(&mut cx.state.with_require);
        with_require.sort_unstable();
        with_require.dedup();
        for &start in &with_require {
            if let (Some(stmt), Some(next)) = (body.around(start), body.after(start)) {
                self.check(stmt, "require", next, with_require.binary_search(&next.span().start).is_ok(), cx);
            }
        }
    }

    fn check<'a>(&self, stmt: Stmt<'a>, keyword: &'static str, next: Stmt<'a>, next_is_same_kind: bool, cx: &Cx<'a, Self>) {
        if next_is_same_kind && !self.consider_comments {
            return;
        }
        let (file, next_start) = (cx.file(), next_statement_start(next));
        let line_difference = |to: u32| strings::count_char(file.slice(Span::after(stmt.span(), to)), b'\n');
        let expected_line_diff = self.count + 1;
        // The first: the others are further away.
        let comment = (self.consider_comments.then(|| file.comments_in(Span::after(stmt.span(), next_start))).into_iter().flatten())
            .map(|it| it.start())
            .next()
            .filter(|&start| line_difference(start) <= expected_line_diff);
        if comment.is_none() && next_is_same_kind {
            return;
        }
        let line_diff = line_difference(comment.unwrap_or(next_start));
        if line_diff >= expected_line_diff && (line_diff == expected_line_diff || !self.exact_count || comment.is_some()) {
            return;
        }
        let report = cx
            .report(stmt, NEWLINE_AFTER_IMPORT)
            .data("count", self.count)
            .data("line_suffix", if self.count == 1 { "" } else { "s" })
            .data("keyword", keyword);
        if line_diff < expected_line_diff {
            report.fix(|fixer| fixer.insert_after(stmt, "\n".repeat(expected_line_diff - line_diff)));
        }
    }
}
