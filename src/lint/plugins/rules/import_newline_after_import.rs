use crate::module_visitor::static_require;
use bun_lint_oxlint::ast_util::{is_decorator_expression, is_global_reference_name};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Enforce a newline after import statements.
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
    is_oxlint: bool,
    /// Of each `require("a")` which counts: where its statement at the top level starts, and where the call ends.
    requires: Vec<(u32, u32)>,
    /// That something is in a function, a block, an object literal or a decorator.
    hidden: AncestorMemo<'a, ()>,
}

impl Rule for NewlineAfterImport {
    const META: Meta = Meta::plugin(Plugin::Import, "newline-after-import", Kind::Layout).fixable(Fixable::Whitespace);
    const ON: On = On::new().exprs(&[ExprTag::Call]).stmts(&[StmtTag::Import, StmtTag::ImportEquals]).finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NewlineAfterImport {
            count: options.usize("count").unwrap_or(1),
            exact_count: options.bool_or("exactCount", false),
            consider_comments: options.bool_or("considerComments", false),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().stmts(&[StmtTag::Import, StmtTag::ImportEquals]);
        if file.mentions("require") { on.exprs(&[ExprTag::Call]).finish() } else { on }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        Some(State { is_oxlint: file.language().is_oxlint, ..State::default() })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if is_top_level_static_require_call(e, cx.state.is_oxlint, &mut cx.state.hidden)
            && let Some(stmt) = cx.file().body().around(e.span().start)
        {
            cx.state.requires.push((stmt.span().start, e.span().end));
        }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if !is_import_statement(stmt) {
            return;
        }
        // Only the program has `comments`.
        let (siblings, comments_from) = match stmt.parent() {
            Node::File(file) => (file.body(), Some(stmt.span().end)),
            // oxlint looks at the statements of the program only.
            Node::Stmt(parent) if !cx.state.is_oxlint => match parent.kind() {
                StmtKind::Module(module) => (module.innermost().body(), None),
                _ => return,
            },
            _ => return,
        };
        let next = siblings.after(stmt.span().start);
        self.check(stmt, "import", next, next.is_some_and(is_import_statement), comments_from, cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let body = cx.file().body();
        let mut requires = std::mem::take(&mut cx.state.requires);
        requires.sort_unstable();
        // Of each statement the last call.
        requires.dedup_by(|call, kept| {
            let is_in_same_statement = call.0 == kept.0;
            if is_in_same_statement {
                kept.1 = call.1;
            }
            is_in_same_statement
        });
        for (index, &(start, call_end)) in requires.iter().enumerate() {
            let (Some(stmt), Some(next)) = (body.around(start), body.after(start)) else {
                continue;
            };
            let next_is_same_kind = requires.get(index + 1).is_some_and(|it| it.0 == next.span().start);
            // oxlint looks for a comment between two statements that require.
            if !next_is_same_kind || cx.state.is_oxlint {
                self.check(stmt, "require", Some(next), next_is_same_kind, Some(call_end), cx);
            }
        }
    }
}

fn is_import_statement(stmt: Stmt) -> bool {
    stmt.tag() == StmtTag::Import || stmt.tag() == StmtTag::ImportEquals && !stmt.is_exported()
}

/// `require("a")` that is in no function, block, object literal or decorator.
fn is_top_level_static_require_call<'a>(e: Expr<'a>, is_oxlint: bool, hidden: &mut AncestorMemo<'a, ()>) -> bool {
    let Some((call, argument)) = e.as_call().and_then(|call| Some((call, static_require(call)?))) else {
        return false;
    };
    // oxlint takes nothing in parentheses, and no `require` that is declared.
    if is_oxlint && argument.is_parenthesized() {
        return false;
    }
    // oxlint counts a function without a body, and an object that is assigned to.
    let hides = |child: Node<'a>, parent: Node<'a>| match parent {
        Node::Func(func) => func.kind() != FnKind::StaticBlock && (is_oxlint || func.has_body()),
        Node::Stmt(stmt) => matches!(stmt.kind(), StmtKind::Block(_)),
        Node::Expr(e) => e.tag() == ExprTag::Object && (is_oxlint || !e.is_assignment_target()),
        Node::Class(_) | Node::Member(_) => matches!(child, Node::Expr(e) if is_decorator_expression(e)),
        _ => false,
    };
    hidden.find(Node::Expr(e), |child, parent| hides(child, parent).then_some(())).is_none()
        && (!is_oxlint || is_global_reference_name(call.callee(), "require"))
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
    /// `comments_from`: the end of the import or of the call, if comments can count.
    fn check<'a>(
        &self,
        stmt: Stmt<'a>,
        keyword: &'static str,
        next: Option<Stmt<'a>>,
        next_is_same_kind: bool,
        comments_from: Option<u32>,
        cx: &Cx<'a, Self>,
    ) {
        let (file, is_oxlint) = (cx.file(), cx.state.is_oxlint);
        // ESLint's node starts at the `export`, after the decorators.
        let node = stmt.export_span().filter(|_| !is_oxlint).unwrap_or_else(|| stmt.span());
        let next_start = next.map(next_statement_start);
        let line_difference = |to: u32| match is_oxlint {
            // oxlint counts the line feeds.
            true => strings::count_char(file.slice(Span::after(node, to)), b'\n') as i64,
            false => i64::from(file.line_of(to)) - i64::from(file.line_of(node.end)),
        };
        let expected_line_diff = (self.count as i64).saturating_add(1);
        // The first: the others are further away.
        let comment = comments_from.filter(|_| self.consider_comments).and_then(|from| {
            if is_oxlint {
                // oxlint looks between the two statements.
                let first = file.comments_in(Span::after(node, next_start?)).next()?.start();
                return (line_difference(first) <= expected_line_diff).then_some(first);
            }
            let line = file.line_of(from);
            let first = file.comments_in(file.line_span(line).to(file.span())).next()?.start();
            (i64::from(file.line_of(first) - line) <= expected_line_diff).then_some(first)
        });
        let Some(to) = comment.or_else(|| next_start.filter(|_| !next_is_same_kind)) else {
            return;
        };
        let line_diff = line_difference(to);
        let is_too_far = self.exact_count && comment.is_none() && line_diff > expected_line_diff;
        if line_diff >= expected_line_diff && !is_too_far {
            return;
        }
        let report = match is_oxlint {
            true => cx.report(node, NEWLINE_AFTER_IMPORT),
            // ESLint is given the line on which it ends, and the column at which it starts if it starts there, else 0.
            false => cx.report_at(node.start.max(file.line_span(file.line_of(node.end)).start), NEWLINE_AFTER_IMPORT),
        };
        let mut report = report
            .data("count", self.count)
            .data("line_suffix", if self.count == 1 { "" } else { "s" })
            .data("keyword", keyword);
        if line_diff >= expected_line_diff {
            return;
        }
        if is_oxlint {
            // What oxlint calls its fix.
            report = report.help(match keyword {
                "import" => "Add empty line(s) after import",
                _ => "Add empty line(s) after require",
            });
        }
        // The calls of `require` are looked at when the program ends.
        let at = if keyword == "require" { Span::empty(0) } else { node };
        let Some(missing) = cx.repeat_count((expected_line_diff - line_diff) as f64, at) else {
            return;
        };
        report.fix(|fixer| Some(fixer.insert_after(node, fixer.repeat(b'\n', missing)?)));
    }
}
