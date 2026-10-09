use bstr::ByteSlice;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// Checks if the `if` and `else` blocks contain shared code that can be moved out of the blocks.
pub struct BranchesSharingCode;

const AT_START: Message = Message::new("", "All `if` blocks contain the same code at the start");
const AT_END: Message = Message::new("", "All `if` blocks contain the same code at the end");
const MOVE_BEFORE: Message = Message::new("", "Move the shared statements before the `if` statement.");
const MOVE_AFTER: Message = Message::new("", "Move the shared statements after the `if` statement.");

/// The statements of each block of `if {} else if {} else {}`.
type Bodies<'a> = SmallVec<[List<'a, Stmt<'a>>; 4]>;

impl Rule for BranchesSharingCode {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "branches-sharing-code", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        BranchesSharingCode
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::If], |_, if_stmt, cx| {
            let Some(bodies) = extract_if_sequence(if_stmt) else {
                return;
            };
            let (start_eq, end_eq) = scan_blocks_for_eq(cx.file(), &bodies);
            let start = if_stmt.span().start;
            let if_span = Span::new(start, start + 2);
            if let Some(count) = start_eq.filter(|&count| !duplicated_stmts_are_empty(count, &bodies, false)) {
                let report = cx.report(if_span, AT_START).labels_with(|labels| label(labels, count, &bodies, false));
                if count == 1 {
                    report.suggest(MOVE_BEFORE, |fixer| {
                        let indent = get_preceding_indent_str(fixer.file().text(), start)?;
                        let moved_code = bodies.first()?.first()?.text();
                        let mut fix = vec![fixer.insert_before(if_stmt, [moved_code, &b"\n"[..], indent].concat())];
                        for body in &bodies {
                            let duplicated = body.first()?.span();
                            fix.push(fixer.remove(Span::new(duplicated.start, body.get(1).map_or(duplicated.end, |it| it.span().start))));
                        }
                        Some(fix)
                    });
                }
            }
            if let Some(count) = end_eq.filter(|&count| !duplicated_stmts_are_empty(count, &bodies, true)) {
                let report = cx.report(if_span, AT_END).labels_with(|labels| label(labels, count, &bodies, true));
                if count == 1 {
                    report.suggest(MOVE_AFTER, |fixer| {
                        let indent = get_preceding_indent_str(fixer.file().text(), start)?;
                        if bodies.iter().any(|body| duplicated_end_references_branch_locals(*body)) {
                            return None;
                        }
                        let moved_code = bodies.first()?.last()?.text();
                        let mut fix = vec![fixer.insert_after(if_stmt, [&b"\n"[..], indent, moved_code].concat())];
                        for body in &bodies {
                            let duplicated = body.last()?.span();
                            let before = body.len().checked_sub(2).and_then(|it| body.get(it));
                            fix.push(fixer.remove(Span::new(before.map_or(duplicated.start, |it| it.span().end), duplicated.end)));
                        }
                        Some(fix)
                    });
                }
            }
        });
    }
}

/// The blocks, if `if_stmt` is not itself after an `else`, there is an `else` at the end, and nothing but blocks in between. In a
/// statement that is not a block oxlint sees no statements, so that nothing is shared.
fn extract_if_sequence(if_stmt: Stmt<'_>) -> Option<Bodies<'_>> {
    let StmtKind::If { no: Some(_), .. } = if_stmt.kind() else {
        return None;
    };
    if matches!(if_stmt.parent(), Node::Stmt(parent) if matches!(parent.kind(), StmtKind::If { no, .. } if no == Some(if_stmt))) {
        return None;
    }
    let mut bodies = Bodies::new();
    let mut current = if_stmt;
    while let StmtKind::If { yes, no, .. } = current.kind() {
        bodies.push(yes.as_block()?);
        current = no?;
    }
    bodies.push(current.as_block()?);
    Some(bodies)
}

/// The statement at `offset` from the start, or from the end, where the last is at 1.
fn statement_at<'a>(body: List<'a, Stmt<'a>>, offset: usize, reverse: bool) -> Option<Stmt<'a>> {
    body.get(if reverse { body.len().checked_sub(offset)? } else { offset })
}

/// oxlint compares the syntax trees. Here it is the tokens, but for the `;` at the end.
fn content_eq<'a>(file: &'a File<'a>, left: Stmt<'a>, right: Stmt<'a>) -> bool {
    let without_semicolon = |it: Stmt<'a>| Span::new(it.span().start, it.semicolon().map_or_else(|| it.span().end, |it| it.start));
    left.tag() == right.tag() && ast_utils::equal_tokens(file, without_semicolon(left), without_semicolon(right))
}

/// How many statements all blocks start with, and how many they end with.
fn scan_blocks_for_eq<'a>(file: &'a File<'a>, bodies: &Bodies<'a>) -> (Option<usize>, Option<usize>) {
    let Some((&first_stmts, others)) = bodies.split_first() else {
        return (None, None);
    };
    let min_stmt_count = bodies.iter().map(|body| body.len()).min().unwrap_or(0);
    let is_shared = |offset: usize, reverse: bool| {
        statement_at(first_stmts, offset, reverse).is_some_and(|stmt| {
            others.iter().all(|body| statement_at(*body, offset, reverse).is_some_and(|it| content_eq(file, it, stmt)))
        })
    };
    let start_end_eq = (0..min_stmt_count).take_while(|&offset| is_shared(offset, false)).count();
    if start_end_eq >= min_stmt_count {
        return (None, None);
    }
    let end_begin_eq = (1..=min_stmt_count - start_end_eq).take_while(|&offset| is_shared(offset, true)).count();
    let has_remaining_code_for_end = bodies.iter().any(|body| body.len().saturating_sub(end_begin_eq) > start_end_eq);
    (Some(start_end_eq).filter(|&it| it > 0), Some(end_begin_eq).filter(|&it| it > 0 && has_remaining_code_for_end))
}

/// The `if`, and in each block the statements that all have.
fn label(labels: &mut Details, count: usize, bodies: &Bodies<'_>, reverse: bool) {
    labels.first("`if` statement declared here");
    for body in bodies {
        let skipped = if reverse { body.len().saturating_sub(count) } else { 0 };
        let mut duplicated = body.iter().skip(skipped).take(count).map(Stmt::span);
        let first = duplicated.next().unwrap_or_default();
        labels.push(Span::new(first.start, duplicated.last().unwrap_or(first).end), "");
    }
}

fn duplicated_stmts_are_empty(count: usize, bodies: &Bodies<'_>, reverse: bool) -> bool {
    bodies.iter().all(|body| {
        let skipped = if reverse { body.len().saturating_sub(count) } else { 0 };
        body.iter().skip(skipped).take(count).all(|it| it.tag() == StmtTag::Empty)
    })
}

/// Whether the last statement of the block refers to what a `let`, `const` or `using` before it in the block declares.
fn duplicated_end_references_branch_locals<'a>(body: List<'a, Stmt<'a>>) -> bool {
    let Some(duplicated) = body.last().map(Stmt::span) else {
        return false;
    };
    let mut is_referenced = false;
    for statement in body.iter().take(body.len() - 1) {
        let StmtKind::Var(declarations) = statement.kind() else {
            continue;
        };
        for declarator in declarations.iter().filter(|it| it.var_kind() != VarKind::Var) {
            declarator.pat().for_each_binding(&mut |pat| {
                is_referenced |= pat.symbol().is_some_and(|it| it.references().any(|it| duplicated.contains(it.span())));
            });
        }
    }
    is_referenced
}

/// The last line of what is before `start`, as `str::lines` has it, if it is blank.
fn get_preceding_indent_str(text: &[u8], start: u32) -> Option<&[u8]> {
    let before = text.get(..start as usize).filter(|it| !it.is_empty())?;
    // A line break at the end does not start another line.
    let line = match before.strip_suffix(b"\n") {
        Some(lines) => {
            let line = lines.get(bun_core::strings::last_index_of_char(lines, b'\n').map_or(0, |it| it + 1)..)?;
            line.strip_suffix(b"\r").unwrap_or(line)
        }
        None => before.get(bun_core::strings::last_index_of_char(before, b'\n').map_or(0, |it| it + 1)..)?,
    };
    line.chars().all(char::is_whitespace).then_some(line)
}
