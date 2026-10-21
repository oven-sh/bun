use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;
use std::cell::OnceCell;
use std::cmp::Ordering;

/// Ensure all imports appear before other statements. `OLD_NAME`: registered under the deprecated name `imports-first`.
pub struct First<const OLD_NAME: bool = false> {
    absolute_first: bool,
}

const IN_BODY: Message = Message::new("", "Import in body of module; reorder to top.");
const ABSOLUTE_AFTER_RELATIVE: Message = Message::new("", "Absolute imports should come before relative imports.");
const FIRST: Message = Message::new("", "Import statements must come first");
const ABSOLUTE_FIRST: Message = Message::new("", "Relative imports before absolute imports are prohibited");

fn is_relative_path(path: &[u8]) -> bool {
    path.starts_with(b"./") || path.starts_with(b"../") || path.starts_with(b"/")
}

/// An import that comes after a non-import statement.
struct ErrorInfo<'a> {
    node: Stmt<'a>,
    /// Starts at the end of the previous statement.
    range: Span,
}

impl<const OLD_NAME: bool> Rule for First<OLD_NAME> {
    const META: Meta = match OLD_NAME {
        true => Meta::plugin(Plugin::Import, "imports-first", Kind::Suggestion).fixable(Fixable::Code).deprecated(),
        false => Meta::plugin(Plugin::Import, "first", Kind::Suggestion).fixable(Fixable::Code),
    };
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        First { absolute_first: options.str(0) == Some("absolute-first") }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.has_stmts([StmtTag::Import, StmtTag::ImportEquals]).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let is_oxlint = file.language().is_oxlint;
        let (mut any_expressions, mut has_non_import, mut any_relative) = (false, false, false);
        let (mut last_legal_imp, mut previous) = (None, Span::default());
        let mut error_infos: SmallVec<[ErrorInfo; 4]> = SmallVec::new();
        for stmt in file.body() {
            let range = Span::after(std::mem::replace(&mut previous, stmt.span()), stmt.span().end);
            let source = match stmt.kind() {
                StmtKind::Import(import) => Some(import.spec()),
                StmtKind::ImportEquals(import) if !stmt.is_exported() => match import.target() {
                    ImportEqualsTarget::Require(Some(source)) => Some(source),
                    _ => None,
                },
                // oxlint doesn't treat a parenthesized string as a directive.
                StmtKind::Expr(e)
                    if !any_expressions && e.as_string().is_some() && !(is_oxlint && e.is_parenthesized()) =>
                {
                    continue;
                }
                _ => {
                    (any_expressions, has_non_import) = (true, true);
                    continue;
                }
            };
            any_expressions = true;
            // oxlint skips `import a = b.c`.
            if is_oxlint && source.is_none() {
                continue;
            }
            if self.absolute_first && let Some(source) = source {
                // oxlint treats `.a` as absolute and `/a` as relative.
                let source = source.bytes();
                let is_relative = if is_oxlint { is_relative_path(source) } else { source.starts_with(b".") };
                // oxlint reports the string even in `import a = require("a")`.
                let report_span = || match stmt.kind() {
                    StmtKind::ImportEquals(import) if !is_oxlint => import.require_span(),
                    _ => stmt.module_specifier_span(),
                };
                if is_relative {
                    any_relative = true;
                } else if any_relative && let Some(span) = report_span() {
                    cx.report(span, if is_oxlint { ABSOLUTE_FIRST } else { ABSOLUTE_AFTER_RELATIVE });
                }
            }
            if has_non_import {
                error_infos.push(ErrorInfo { node: stmt, range });
            } else {
                last_legal_imp = Some(stmt);
            }
        }
        let sorted = OnceCell::new();
        for (index, info) in error_infos.iter().enumerate() {
            // oxlint has no fix.
            if is_oxlint {
                cx.report(info.node.span(), FIRST);
                continue;
            }
            cx.report(info.node.span(), IN_BODY).fix(|fixer| {
                let (last, fix) = sorted.get_or_init(|| {
                    let last = ErrorInfo::last_to_sort(&error_infos);
                    (last, ErrorInfo::sort(error_infos.get(..=last).unwrap_or_default(), last_legal_imp, fixer))
                });
                let fix = fix.as_ref()?;
                match index.cmp(last) {
                    Ordering::Less => Some(fixer.insert_after(info.node, "")),
                    Ordering::Equal => Some(fix.clone()),
                    Ordering::Greater => None,
                }
            });
        }
    }
}

/// Returns the end of `import` including its trailing comments, and true if nothing may follow on that line, because
/// the import has no `;` or its last comment is a `//`. A `;` on a later line isn't part of the import. It's there to
/// keep that line from continuing the previous one, as in `;[a].map(b)`.
fn end_with_comments<'a>(import: Stmt<'a>, fixer: Fixer<'a>) -> (u32, bool) {
    let file = fixer.file();
    let mut tokens = file.tokens_in(import).rev();
    let (code_end, has_semicolon) = match (tokens.next(), tokens.next()) {
        (Some(last), Some(before)) if last.is(";") => match ast_utils::is_token_on_same_line(file, before, last) {
            true => (last.end(), true),
            false => (before.end(), false),
        },
        _ => (import.span().end, false),
    };
    let end = fixer.end_with_trailing_comments(code_end);
    (end, !has_semicolon || is_end_of_line_comment(file, end))
}

fn is_end_of_line_comment<'a>(file: &'a File<'a>, at: u32) -> bool {
    let comment = at.checked_sub(1).and_then(|it| file.comment_containing(it));
    comment.is_some_and(|it| it.kind() == TokenKind::Line)
}

/// True if `text` starts with whitespace that contains a line break.
fn starts_on_a_new_line(text: &[u8]) -> bool {
    let blank = text.len() - strings::trim_js_whitespace_start(text).len();
    strings::contains_js_line_break(text.get(..blank).unwrap_or_default())
}

/// True if deleting `removed`, whose first token is an `import`, would make the next statement continue the statement
/// before `removed`, or become part of a `//` comment there.
fn joins_statements<'a>(file: &'a File<'a>, removed: Span) -> bool {
    let (Some(before), Some(import), Some(after)) =
        (file.token_before(removed), file.first_token(removed), file.token_after(removed))
    else {
        return false;
    };
    let follows_on_the_line = ast_utils::is_on_one_line(file, removed.between(after.span()));
    if follows_on_the_line && is_end_of_line_comment(file, removed.start) {
        return true;
    }
    if before.is(";") {
        return false;
    }
    match follows_on_the_line && ast_utils::is_on_one_line(file, before.span().between(removed)) {
        // If an import follows `before` on the same line, `before` ends its statement without a `;` or a line break, so
        // another statement can follow it too.
        true => !ast_utils::is_token_on_same_line(file, before, import),
        false => ast_utils::continues_statement(file, before, after),
    }
}

impl<'a> ErrorInfo<'a> {
    /// True if a binding it declares is referenced before the import ends.
    fn is_used_before(&self) -> bool {
        let is_before = |it: Reference| it.ident().start() < self.range.end;
        Node::Stmt(self.node).declared_symbols().iter().any(|it| it.references().any(is_before))
    }

    /// `lastSortNodesIndex`: the index of the last import before the first one that can't be moved. The very first
    /// import is always moved.
    fn last_to_sort(error_infos: &[ErrorInfo]) -> usize {
        error_infos.iter().take_while(|it| !it.is_used_before()).count().saturating_sub(1)
    }

    /// Moves all of `sort_nodes` after the last import that's already at the top, or to the start of the file's first
    /// statement if there is none. Comments above and beside an import move with it. Returns `None` if the move would
    /// change the program's behavior.
    #[cold]
    #[inline(never)]
    fn sort(sort_nodes: &[ErrorInfo<'a>], last_legal_imp: Option<Stmt<'a>>, fixer: Fixer<'a>) -> Option<Fix> {
        let file = fixer.file();
        // The plugin inserts at the end of the import itself, or before the first statement, which can be
        // `"use client"`.
        let (insert_at, mut is_open) = match last_legal_imp {
            Some(import) => end_with_comments(import, fixer),
            None => (fixer.start_of_first_statement(), false),
        };
        let mut insert_source_code = Vec::new();
        let mut removed: SmallVec<[Span; 4]> = SmallVec::new();
        for info in sort_nodes {
            let (end, ends_open) = end_with_comments(info.node, fixer);
            let range = Span::new(fixer.end_with_trailing_comments(info.range.start), end);
            let node_source_code = file.slice(range);
            let is_blank_first = strings::js_whitespace_len(node_source_code) > 0;
            match !is_blank_first || is_open && !starts_on_a_new_line(node_source_code) {
                true => {
                    insert_source_code.push(b'\n');
                    insert_source_code.extend_from_slice(strings::trim_js_whitespace_start(node_source_code));
                }
                false => insert_source_code.extend_from_slice(node_source_code),
            }
            is_open = ends_open;
            match removed.last_mut() {
                Some(last) if last.end == range.start => last.end = range.end,
                _ => removed.push(range),
            }
        }
        let (first, last) = (removed.first()?, removed.last()?);
        // Modules are evaluated in source order, and `export .. from` loads a module too, so an import can't move past
        // one.
        let names_module = |it: Stmt| {
            matches!(it.tag(), StmtTag::ExportNamed | StmtTag::ExportStar) && it.module_specifier_span().is_some()
        };
        let mut crossed_statements = file.body().iter().filter(|it| Span::empty(insert_at).between(*last).contains(it.span()));
        if crossed_statements.any(names_module) || removed.iter().any(|it| joins_statements(file, *it)) {
            return None;
        }
        if last_legal_imp.is_none() {
            let without_start = strings::trim_js_whitespace_start(&insert_source_code);
            let start_len = insert_source_code.len() - without_start.len();
            let end_len = without_start.len() - strings::trim_js_whitespace_end(without_start).len();
            insert_source_code.truncate(insert_source_code.len() - end_len);
            insert_source_code.rotate_left(start_len);
            let code_len = insert_source_code.len() - start_len;
            let (code, blank) = insert_source_code.split_at_checked(code_len)?;
            if (is_open || strings::contains_js_line_break(code)) && !strings::contains_js_line_break(blank) {
                insert_source_code.truncate(code_len);
                insert_source_code.push(b'\n');
            }
        } else if is_open && !starts_on_a_new_line(file.slice(Span::empty(insert_at).between(*first))) {
            insert_source_code.push(b'\n');
        }
        let start_of_text = if file.has_bom() { 3 } else { 0 };
        let mut replace_source_code = file.slice(Span::new(start_of_text, insert_at)).to_vec();
        replace_source_code.append(&mut insert_source_code);
        let mut retained_from = insert_at;
        for range in &removed {
            replace_source_code.extend_from_slice(file.slice(Span::before(retained_from, *range)));
            retained_from = range.end;
        }
        Some(fixer.replace(Span::new(start_of_text, retained_from), replace_source_code))
    }
}
