//! Sorts a run of imports while it's formatted.

use super::super::compare::natord;
use super::super::sort::stable_sort_by;
use super::super::{How, SortImports};
use super::options::{Modifier, Options, Selector};
use crate::ir::element::{Interned, LineMode};
use crate::pragma::{has_ignore_pragma, has_pragma};
use crate::prelude::*;
use crate::write;
use bun_core::strings;
use bun_lint::fix::is_file_level_comment;
use bun_lint::linter::is_flow_file;
use std::sync::Arc;

impl SortImports {
    fn as_oxfmt(&self) -> Option<&Options> {
        match &self.how {
            How::Oxfmt(options) | How::Native(options) => Some(options),
            _ => None,
        }
    }
}

/// oxc's `SourceLine`. The ranges index the formatter's pool.
#[derive(Copy, Clone)]
enum Line {
    /// An import, with the comments before and after it on its line. `index` is its position in the run.
    Import {
        range: Interned,
        index: u32,
    },
    Empty,
    /// Only comments.
    Comment(Interned),
}

impl Line {
    fn write(self, out: &mut Vec<FormatElement>, preserves_empty_line: bool) {
        match self {
            Line::Empty if preserves_empty_line => out.push(FormatElement::Line(LineMode::Empty)),
            Line::Empty => {}
            Line::Import { range, .. } | Line::Comment(range) => {
                out.push(FormatElement::Interned(range));
                out.push(FormatElement::Line(LineMode::Hard));
            }
        }
    }
}

/// An import, and how oxc reads its output: it goes by the text in the document, where a comment is text like any
/// other.
#[derive(Copy, Clone)]
struct PrintedImport<'a> {
    import: Import<'a>,
    /// The first text after the `from`, or after the `import` if there's no `from`.
    source: &'a [u8],
    /// There's text before the `*`.
    has_comment_for_default: bool,
}

impl<'a> PrintedImport<'a> {
    fn new(statement: Stmt<'a>, import: Import<'a>, f: &Formatter<'a>) -> Self {
        let source = import.spec_span().unwrap_or_default();
        let mut printed = PrintedImport {
            import,
            source: f.file().slice(source),
            has_comment_for_default: false,
        };
        let before_source = Span::new(statement.span().start, source.start);
        if f.comments().has_comment_in_span(before_source) {
            let keyword_end = statement.span().start + "import".len() as u32;
            // Without a `from`, everything counts as after it.
            let mut is_after_from = import.is_side_effect();
            let mut position = if is_after_from {
                keyword_end
            } else {
                import.clause_span().end
            };
            let comment = f
                .comments()
                .comments_in_span(Span::before(position, source))
                .iter()
                .find(|comment| {
                    is_after_from |= bun_core::strings::contains(
                        f.file().slice(Span::before(position, comment.span())),
                        b"from",
                    );
                    position = comment.span().end;
                    is_after_from
                });
            if let Some(comment) = comment {
                let text = f.file().slice(comment.span());
                printed.source = bun_core::strings::index_of_char_usize(text, b'\n')
                    .map_or(text, |end| text[..end].trim_ascii_end());
            }
            let star = import
                .namespace_span()
                .filter(|_| import.default().is_none());
            printed.has_comment_for_default = star.is_some_and(|star| {
                !f.comments()
                    .comments_in_span(Span::before(keyword_end, star))
                    .is_empty()
            });
        }
        printed
    }
}

/// oxc's `SortableImport`
struct Unit<'a> {
    /// The comments directly before it, with no empty line between: a range of the lines.
    leading: std::ops::Range<usize>,
    line: Line,
    group: usize,
    source: &'a [u8],
    is_side_effect: bool,
    /// It stays in place.
    is_ignored: bool,
}

/// Comments that an empty line separates from the next import. They stay in place.
struct Orphan {
    lines: Vec<Line>,
    /// The import it follows. `None` means before the first.
    after_slot: Option<usize>,
}

/// `extract_source_path`: `"./a.js?b"` becomes `./a.js`.
fn source_path(raw_source: &[u8]) -> &[u8] {
    let mut source = raw_source;
    for quote in *b"\"'" {
        while let [first, rest @ ..] = source
            && *first == quote
        {
            source = rest;
        }
        while let [rest @ .., last] = source
            && *last == quote
        {
            source = rest;
        }
    }
    bun_core::strings::index_of_char_usize(source, b'?').map_or(source, |at| &source[..at])
}

/// True if `Path::new(source).extension()` is a style sheet's.
fn is_style(source: &[u8]) -> bool {
    let trimmed = source.len()
        - source
            .iter()
            .rev()
            .take_while(|byte| **byte == b'/')
            .count();
    let path = &source[..trimmed];
    let name =
        bun_core::strings::last_index_of_char(path, b'/').map_or(path, |slash| &path[slash + 1..]);
    match bun_core::strings::last_index_of_char(name, b'.') {
        Some(dot) if dot > 0 && name != b".." => {
            matches!(
                &name[dot + 1..],
                b"css" | b"scss" | b"sass" | b"less" | b"styl" | b"pcss" | b"sss"
            )
        }
        _ => false,
    }
}

/// `compute_import_metadata`: the group, and true if the import stays in place.
fn classify(printed: PrintedImport, source: &[u8], options: &Options) -> (usize, bool) {
    let import = printed.import;
    let (is_side_effect, is_style) = (import.is_side_effect(), is_style(source));
    let mut selectors = Selector::Import.bit();
    let mut add =
        |selector: Selector, applies: bool| selectors |= if applies { selector.bit() } else { 0 };
    add(Selector::SideEffectStyle, is_side_effect && is_style);
    add(Selector::SideEffect, is_side_effect);
    add(Selector::Style, is_style);
    add(Selector::Type, import.is_type_only());
    add(Selector::Subpath, source.starts_with(b"#"));
    // `to_path_kind`
    add(
        if source.starts_with(b"node:")
            || source.starts_with(b"bun:")
            || bun_lint::utils::node::is_builtin_module(source)
        {
            Selector::Builtin
        } else if matches!(
            source,
            b"." | b"./"
                | b"./index"
                | b"./index.js"
                | b"./index.ts"
                | b"./index.d.ts"
                | b"./index.d.js"
        ) {
            Selector::Index
        } else if source.starts_with(b"..") {
            Selector::Parent
        } else if source.starts_with(b".") {
            Selector::Sibling
        } else if options
            .internal_pattern
            .iter()
            .any(|prefix| source.starts_with(prefix))
        {
            Selector::Internal
        } else {
            Selector::External
        },
        true,
    );

    let mut modifiers = if import.is_type_only() {
        Modifier::Type.bit()
    } else {
        Modifier::Value.bit()
    };
    let mut add =
        |modifier: Modifier, applies: bool| modifiers |= if applies { modifier.bit() } else { 0 };
    add(Modifier::SideEffect, is_side_effect);
    add(
        Modifier::Default,
        import.default().is_some() || printed.has_comment_for_default,
    );
    add(Modifier::Wildcard, import.namespace().is_some());
    add(Modifier::Named, !import.named().is_empty());

    let is_ignored = !options.sort_side_effects
        && is_side_effect
        && !options.regroups_side_effect
        && !(is_style && options.regroups_side_effect_style);
    (options.group_of(source, selectors, modifiers), is_ignored)
}

/// `sort_within_group`
fn sort_within_group(indices: &mut [usize], units: &[Unit], options: &Options) {
    let by_source = |indices: &mut [usize]| {
        stable_sort_by(indices, |a, b| {
            let order = natord(units[*a].source, units[*b].source, options.ignore_case);
            if options.is_descending {
                order.reverse()
            } else {
                order
            }
        });
    };
    if options.sort_side_effects {
        return by_source(indices);
    }
    // Side-effect imports keep their positions among the others.
    let mut others: Vec<usize> = indices
        .iter()
        .copied()
        .filter(|index| !units[*index].is_side_effect)
        .collect();
    by_source(&mut others);
    let mut others = others.into_iter();
    for index in indices
        .iter_mut()
        .filter(|index| !units[**index].is_side_effect)
    {
        *index = others.next().unwrap_or(*index);
    }
}

/// `SortSortableImports::sort`: the order of `units`.
fn sorted_order(units: &[Unit], options: &Options) -> Vec<usize> {
    let mut sortable: Vec<usize> = (0..units.len())
        .filter(|index| !units[*index].is_ignored)
        .collect();
    crate::sort::sort_by_key(&mut sortable[..], |index| units[*index].group);
    let mut start = 0;
    while start < sortable.len() {
        let group = units[sortable[start]].group;
        let end = start
            + sortable[start..]
                .iter()
                .take_while(|index| units[**index].group == group)
                .count();
        sort_within_group(&mut sortable[start..end], units, options);
        start = end;
    }
    let mut sortable = sortable.into_iter();
    (0..units.len())
        .map(|index| {
            if units[index].is_ignored {
                index
            } else {
                sortable.next().unwrap_or(index)
            }
        })
        .collect()
}

/// `should_insert_newline_between`
fn should_insert_newline_between(
    options: &Options,
    previous: usize,
    current: usize,
    slot_had_leading_blank: bool,
) -> bool {
    if previous > current {
        return slot_had_leading_blank;
    }
    if options.newline_boundary_overrides.is_empty() {
        return options.newlines_between;
    }
    (previous..current).any(|at| {
        options
            .newline_boundary_overrides
            .get(at)
            .copied()
            .flatten()
            .unwrap_or(options.newlines_between)
    })
}

/// Writes the lines of a chunk, which has no boundary in it, with its imports sorted.
fn write_sorted<'a>(
    lines: &[Line],
    imports: &[PrintedImport<'a>],
    options: &Options,
    is_before_boundary: bool,
    out: &mut Vec<FormatElement>,
) {
    // `into_sorted_import_units`
    let mut units: Vec<Unit<'a>> = Vec::with_capacity(imports.len());
    let mut orphans: Vec<Orphan> = Vec::new();
    let mut slot_had_leading_blank: Vec<bool> = Vec::with_capacity(imports.len());
    // The lines since the last import up to the last empty line, and the index where the lines after it start.
    let mut orphan_pending: Vec<Line> = Vec::new();
    let mut current_pending = 0;
    for (at, &line) in lines.iter().enumerate() {
        match line {
            Line::Import { index, .. } => {
                slot_had_leading_blank
                    .push(orphan_pending.iter().any(|it| matches!(it, Line::Empty)));
                let after_slot = units.len().checked_sub(1);
                let mut orphan = std::mem::take(&mut orphan_pending);
                if after_slot.is_some() {
                    orphan.retain(|it| matches!(it, Line::Comment(_)));
                }
                if !orphan.is_empty() {
                    orphans.push(Orphan {
                        lines: orphan,
                        after_slot,
                    });
                }
                let Some(&printed) = imports.get(index as usize) else {
                    continue;
                };
                let (import, source) = (printed.import, source_path(printed.source));
                let (group, is_ignored) = classify(printed, source, options);
                units.push(Unit {
                    leading: current_pending..at,
                    line,
                    group,
                    source,
                    is_side_effect: import.is_side_effect(),
                    is_ignored,
                });
                current_pending = at + 1;
            }
            Line::Empty => {
                orphan_pending.extend_from_slice(&lines[current_pending..=at]);
                current_pending = at + 1;
            }
            Line::Comment(_) => {}
        }
    }
    orphan_pending.extend_from_slice(&lines[current_pending..]);
    let trailing = orphan_pending;
    let order = sorted_order(&units, options);

    for orphan in orphans.iter().filter(|it| it.after_slot.is_none()) {
        orphan.lines.iter().for_each(|line| line.write(out, true));
    }
    let (mut previous_group, mut has_seen_not_ignored) = (None, false);
    for (slot, unit) in order
        .iter()
        .filter_map(|index| units.get(*index))
        .enumerate()
    {
        if let Some(previous) = previous_group
            && previous != unit.group
            && has_seen_not_ignored
            && should_insert_newline_between(
                options,
                previous,
                unit.group,
                slot_had_leading_blank.get(slot).copied().unwrap_or(false),
            )
        {
            out.push(FormatElement::Line(LineMode::Empty));
        }
        previous_group = Some(unit.group);
        has_seen_not_ignored |= !unit.is_ignored;
        lines[unit.leading.clone()]
            .iter()
            .for_each(|line| line.write(out, options.partition_by_newline));
        unit.line.write(out, false);
        for orphan in orphans.iter().filter(|it| it.after_slot == Some(slot)) {
            orphan.lines.iter().for_each(|line| line.write(out, false));
        }
    }
    for (at, line) in trailing.iter().enumerate() {
        let is_last_empty_line = at + 1 == trailing.len() && matches!(line, Line::Empty);
        line.write(out, !is_last_empty_line || is_before_boundary);
    }
}

/// oxc's `transform`
fn transform<'a>(
    lines: &[Line],
    imports: &[PrintedImport<'a>],
    options: &Options,
    out: &mut Vec<FormatElement>,
) {
    let is_boundary = |line: &Line| match line {
        Line::Import { index, .. } => {
            options.stops_at_side_effects
                && (imports.get(*index as usize)).is_some_and(|it| it.import.is_side_effect())
        }
        Line::Empty => options.partition_by_newline,
        Line::Comment(_) => options.partition_by_comment,
    };
    let mut start = 0;
    while start < lines.len() {
        if is_boundary(&lines[start]) {
            lines[start].write(out, true);
            start += 1;
            continue;
        }
        let end = start
            + lines[start..]
                .iter()
                .take_while(|line| !is_boundary(line))
                .count();
        write_sorted(&lines[start..end], imports, options, end < lines.len(), out);
        start = end;
    }
    // Every line is written with a line break after it. Whatever follows the run writes its own.
    out.pop();
}

/// Wraps [`is_file_level_comment`]. `// eslint-disable-next-line`, `// @ts-ignore` and `// @ts-expect-error` apply
/// to the next statement, so they don't count.
fn is_about_the_file(comment: Comment<'_>) -> bool {
    let text = comment.text();
    is_file_level_comment(text, comment.content())
        // These pragmas decide how Prettier parses the file. It matches them loosely: `// @flow.` counts too.
        || (strings::contains_char(text, b'@')
            && (is_flow_file(text, b"") || has_pragma(text) || has_ignore_pragma(text)))
}

/// Sorts the runs of imports in a list of statements. The caller that prints the list announces each thing it's about
/// to print.
pub(crate) struct ImportRun<'a> {
    /// `None` if imports aren't sorted this way. Everything here is then a no-op.
    how: Option<Arc<SortImports>>,
    /// Where the capture of the current run starts.
    slot: Option<usize>,
    /// True if the next statement can be part of a run, if that's known yet.
    is_next_sortable: Option<bool>,
    has_seen_import: bool,
    lines: Vec<Line>,
    imports: Vec<PrintedImport<'a>>,
    /// Where the current line starts.
    line_start: usize,
}

impl<'a> ImportRun<'a> {
    #[inline]
    pub(crate) fn new(f: &Formatter<'a>) -> Self {
        ImportRun {
            how: f
                .options()
                .sort_imports
                .as_ref()
                .filter(|how| how.as_oxfmt().is_some())
                .map(Arc::clone),
            slot: None,
            is_next_sortable: None,
            has_seen_import: false,
            lines: Vec::new(),
            imports: Vec::new(),
            line_start: 0,
        }
    }

    /// An import that's copied verbatim from the source ends a run.
    fn is_sortable(statement: Stmt<'a>, f: &Formatter<'a>) -> bool {
        matches!(statement.kind(), StmtKind::Import(_))
            && !f.comments().is_ignored(statement.as_ast_nodes())
    }

    /// Call this before printing the line break between the previous statement and `next`. `is_plain` means all
    /// comments between the two are printed with `next`.
    #[inline]
    pub(crate) fn before_separator(
        &mut self,
        next: Stmt<'a>,
        is_plain: bool,
        f: &mut Formatter<'a>,
    ) {
        if self.how.is_some() {
            self.end_statement(is_plain.then_some(next), f);
        }
    }

    /// Call this before printing `statement` and the comments before it.
    #[inline]
    pub(crate) fn before_statement(&mut self, statement: Stmt<'a>, f: &mut Formatter<'a>) {
        if self.how.is_some() {
            self.start_statement(statement, f);
        }
    }

    /// Call this after the last statement.
    #[inline]
    pub(crate) fn finish(&mut self, f: &mut Formatter<'a>) {
        if self.how.is_some() {
            self.end_statement(None, f);
        }
    }

    #[cold]
    fn end_statement(&mut self, next: Option<Stmt<'a>>, f: &mut Formatter<'a>) {
        let is_next_sortable = next.is_some_and(|next| Self::is_sortable(next, f));
        self.is_next_sortable = Some(is_next_sortable);
        let Some(slot) = self.slot else {
            return;
        };
        self.lines.push(Line::Import {
            range: self.line_until(f.elements().len()),
            index: (self.imports.len() as u32).saturating_sub(1),
        });
        if is_next_sortable {
            return;
        }
        self.slot = None;
        let run = f.end_capture(slot);
        if let (true, Some(options)) = (
            self.imports.len() >= 2,
            self.how.as_deref().and_then(SortImports::as_oxfmt),
        ) {
            let mut out = f.take_vec();
            transform(&self.lines, &self.imports, options, &mut out);
            out.iter().for_each(|element| f.write_element(*element));
            f.recycle_vec(out);
        } else {
            f.write_element(FormatElement::Interned(run));
        }
        self.lines.clear();
        self.imports.clear();
    }

    fn line_until(&self, end: usize) -> Interned {
        Interned {
            start: self.line_start as u32,
            len: end.saturating_sub(self.line_start) as u32,
        }
    }

    #[cold]
    fn start_statement(&mut self, statement: Stmt<'a>, f: &mut Formatter<'a>) {
        let is_sortable = self
            .is_next_sortable
            .take()
            .unwrap_or_else(|| Self::is_sortable(statement, f));
        let StmtKind::Import(import) = statement.kind() else {
            return;
        };
        let is_first_of_file = !std::mem::replace(&mut self.has_seen_import, true)
            && matches!(statement.parent(), Node::File(_));
        if !is_sortable {
            return;
        }
        // In `// @ts-nocheck⏎import b from "b";⏎import a from "a";` oxfmt moves the comment along with `b`, and
        // TypeScript no longer reads it there. Here it stays at the top, along with every comment above it. They're
        // printed before the run starts.
        let mut comments = f.comments().of_node(statement.as_ast_nodes()).leading;
        if is_first_of_file {
            let count = comments.iter().rposition(is_about_the_file);
            let (about_the_file, others) = comments.split_at(count.map_or(0, |last| last + 1));
            write!(f, FormatLeadingComments::Comments(about_the_file));
            comments = others;
        }
        match self.slot {
            None => self.slot = Some(f.start_capture()),
            Some(_) if f.elements().last() == Some(&FormatElement::Line(LineMode::Empty)) => {
                self.lines.push(Line::Empty)
            }
            Some(_) => {}
        }
        self.imports.push(PrintedImport::new(statement, import, f));
        self.line_start = f.elements().len();

        // One line at a time. What's left for the statement to print is its own line.
        while let Some(first) = comments.first() {
            // Comments with nothing between them belong together.
            let mut end = first.span().end;
            let count = 1 + comments
                .slice(1, usize::MAX)
                .iter()
                .take_while(|next| {
                    std::mem::replace(&mut end, next.span().end) == next.span().start
                })
                .count();
            let (now, later) = comments.split_at(count);
            comments = later;
            write!(f, FormatLeadingComments::Comments(now));
            // oxc doesn't see the line break after a block comment at the start of the file.
            let starts_file = |it: Comment<'_>| {
                it.is_block()
                    && f.file().text()[..it.span().start as usize]
                        .trim_ascii()
                        .is_empty()
            };
            if f.elements().last() == Some(&FormatElement::Line(LineMode::Hard))
                && now.last().is_some_and(starts_file)
            {
                continue;
            }
            if let Some(&FormatElement::Line(mode @ (LineMode::Hard | LineMode::Empty))) =
                f.elements().last()
            {
                self.lines
                    .push(Line::Comment(self.line_until(f.elements().len() - 1)));
                if mode == LineMode::Empty {
                    self.lines.push(Line::Empty);
                }
                self.line_start = f.elements().len();
            }
        }
    }
}
