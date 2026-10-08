//! Sorting a run of imports while it is written.

use super::super::compare::natord;
use super::super::sort::stable_sort_by;
use super::super::{How, SortImports};
use super::options::{Modifier, Options, Selector};
use crate::ir::element::{Interned, LineMode};
use crate::prelude::*;
use crate::write;
use std::sync::Arc;

impl SortImports {
    fn as_oxfmt(&self) -> Option<&Options> {
        match &self.how {
            How::Oxfmt(options) => Some(options),
            _ => None,
        }
    }
}

/// oxc's `SourceLine`. The ranges are of the formatter's pool.
#[derive(Copy, Clone)]
enum Line {
    /// An import, with the comments before and after it on its line. `index`: which of the run.
    Import { range: Interned, index: u32 },
    Empty,
    /// Nothing but comments.
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

/// An import, and what oxc makes of what is written for it: it goes by the text in the document,
/// where a comment is text like any other.
#[derive(Copy, Clone)]
struct Written<'a> {
    import: Import<'a>,
    /// The first text after the `from`, or after the `import` if there is none.
    source: &'a [u8],
    /// There is text before the `*`.
    has_comment_for_default: bool,
}

impl<'a> Written<'a> {
    fn new(statement: Stmt<'a>, import: Import<'a>, f: &Formatter<'a>) -> Self {
        let source = import.spec_span().unwrap_or_default();
        let mut written = Written {
            import,
            source: f.file().slice(source),
            has_comment_for_default: false,
        };
        if f.comments().has_comment_before(source.start) {
            let keyword_end = statement.span().start + "import".len() as u32;
            // Without a `from`, everything is after it.
            let mut is_after_from = import.is_side_effect();
            let mut position = if is_after_from { keyword_end } else { import.clause_span().end };
            let comment = f.comments().comments_in_range(position, source.start).iter().find(|comment| {
                is_after_from |= bun_core::strings::contains(f.file().slice(Span::new(position, comment.span.start)), b"from");
                position = comment.span.end;
                is_after_from
            });
            if let Some(comment) = comment {
                let text = f.file().slice(comment.span);
                written.source = bun_core::strings::index_of_char_usize(text, b'\n').map_or(text, |end| text[..end].trim_ascii_end());
            }
            let star = import.namespace_span().filter(|_| import.default().is_none());
            written.has_comment_for_default = star.is_some_and(|star| !f.comments().comments_in_range(keyword_end, star.start).is_empty());
        }
        written
    }
}

/// oxc's `SortableImport`
struct Unit<'a> {
    /// The comments directly before it, without an empty line between: a range of the lines.
    leading: std::ops::Range<usize>,
    line: Line,
    group: usize,
    source: &'a [u8],
    is_side_effect: bool,
    /// It stays where it is.
    is_ignored: bool,
}

/// Comments that an empty line separates from the next import. They stay where they are.
struct Orphan {
    lines: Vec<Line>,
    /// After which import. `None`: before the first.
    after_slot: Option<usize>,
}

/// `extract_source_path`: `"./a.js?b"` is `./a.js`.
fn source_path(written: &[u8]) -> &[u8] {
    let mut source = written;
    for quote in [b'"', b'\''] {
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

/// `Path::new(source).extension()` is that of a style sheet.
fn is_style(source: &[u8]) -> bool {
    let trimmed = source.len() - source.iter().rev().take_while(|byte| **byte == b'/').count();
    let path = &source[..trimmed];
    let name = bun_core::strings::last_index_of_char(path, b'/').map_or(path, |slash| &path[slash + 1..]);
    match bun_core::strings::last_index_of_char(name, b'.') {
        Some(dot) if dot > 0 && name != b".." => {
            matches!(&name[dot + 1..], b"css" | b"scss" | b"sass" | b"less" | b"styl" | b"pcss" | b"sss")
        }
        _ => false,
    }
}

/// `compute_import_metadata`: the group, and whether the import stays where it is.
fn classify(written: Written, source: &[u8], options: &Options) -> (usize, bool) {
    let import = written.import;
    let (is_side_effect, is_style) = (import.is_side_effect(), is_style(source));
    let mut selectors = Selector::Import.bit();
    let mut add = |selector: Selector, is_one: bool| selectors |= if is_one { selector.bit() } else { 0 };
    add(Selector::SideEffectStyle, is_side_effect && is_style);
    add(Selector::SideEffect, is_side_effect);
    add(Selector::Style, is_style);
    add(Selector::Type, import.is_type_only());
    add(Selector::Subpath, source.starts_with(b"#"));
    // `to_path_kind`
    add(
        if source.starts_with(b"node:") || source.starts_with(b"bun:") || super::super::builtins::is_builtin_module(source) {
            Selector::Builtin
        } else if matches!(source, b"." | b"./" | b"./index" | b"./index.js" | b"./index.ts" | b"./index.d.ts" | b"./index.d.js") {
            Selector::Index
        } else if source.starts_with(b"..") {
            Selector::Parent
        } else if source.starts_with(b".") {
            Selector::Sibling
        } else if options.internal_pattern.iter().any(|prefix| source.starts_with(prefix)) {
            Selector::Internal
        } else {
            Selector::External
        },
        true,
    );

    let mut modifiers = if import.is_type_only() { Modifier::Type.bit() } else { Modifier::Value.bit() };
    let mut add = |modifier: Modifier, is_one: bool| modifiers |= if is_one { modifier.bit() } else { 0 };
    add(Modifier::SideEffect, is_side_effect);
    add(Modifier::Default, import.default().is_some() || written.has_comment_for_default);
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
            if options.is_descending { order.reverse() } else { order }
        });
    };
    if options.sort_side_effects {
        return by_source(indices);
    }
    // Those with side effects keep their places among the others.
    let mut others: Vec<usize> = indices.iter().copied().filter(|index| !units[*index].is_side_effect).collect();
    by_source(&mut others);
    let mut others = others.into_iter();
    for index in indices.iter_mut().filter(|index| !units[**index].is_side_effect) {
        *index = others.next().unwrap_or(*index);
    }
}

/// `SortSortableImports::sort`: the order of `units`.
fn sorted_order(units: &[Unit], options: &Options) -> Vec<usize> {
    let mut sortable: Vec<usize> = (0..units.len()).filter(|index| !units[*index].is_ignored).collect();
    sortable.sort_by_key(|index| units[*index].group);
    let mut start = 0;
    while start < sortable.len() {
        let group = units[sortable[start]].group;
        let end = start + sortable[start..].iter().take_while(|index| units[**index].group == group).count();
        sort_within_group(&mut sortable[start..end], units, options);
        start = end;
    }
    let mut sortable = sortable.into_iter();
    (0..units.len()).map(|index| if units[index].is_ignored { index } else { sortable.next().unwrap_or(index) }).collect()
}

/// `should_insert_newline_between`
fn should_insert_newline_between(options: &Options, previous: usize, current: usize, slot_had_leading_blank: bool) -> bool {
    if previous > current {
        return slot_had_leading_blank;
    }
    if options.newline_boundary_overrides.is_empty() {
        return options.newlines_between;
    }
    (previous..current).any(|at| options.newline_boundary_overrides.get(at).copied().flatten().unwrap_or(options.newlines_between))
}

/// Writes the lines of a chunk, in which nothing is a boundary, with its imports sorted.
fn write_sorted<'a>(
    lines: &[Line],
    imports: &[Written<'a>],
    options: &Options,
    is_before_boundary: bool,
    out: &mut Vec<FormatElement>,
) {
    // `into_sorted_import_units`
    let mut units: Vec<Unit<'a>> = Vec::with_capacity(imports.len());
    let mut orphans: Vec<Orphan> = Vec::new();
    let mut slot_had_leading_blank: Vec<bool> = Vec::with_capacity(imports.len());
    // The lines since the last import up to the last empty line, and where those after it start.
    let mut orphan_pending: Vec<Line> = Vec::new();
    let mut current_pending = 0;
    for (at, &line) in lines.iter().enumerate() {
        match line {
            Line::Import { index, .. } => {
                slot_had_leading_blank.push(orphan_pending.iter().any(|it| matches!(it, Line::Empty)));
                let after_slot = units.len().checked_sub(1);
                let mut orphan = std::mem::take(&mut orphan_pending);
                if after_slot.is_some() {
                    orphan.retain(|it| matches!(it, Line::Comment(_)));
                }
                if !orphan.is_empty() {
                    orphans.push(Orphan { lines: orphan, after_slot });
                }
                let Some(&written) = imports.get(index as usize) else {
                    continue;
                };
                let (import, source) = (written.import, source_path(written.source));
                let (group, is_ignored) = classify(written, source, options);
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
    for (slot, unit) in order.iter().filter_map(|index| units.get(*index)).enumerate() {
        if let Some(previous) = previous_group
            && previous != unit.group
            && has_seen_not_ignored
            && should_insert_newline_between(options, previous, unit.group, slot_had_leading_blank.get(slot).copied().unwrap_or(false))
        {
            out.push(FormatElement::Line(LineMode::Empty));
        }
        previous_group = Some(unit.group);
        has_seen_not_ignored |= !unit.is_ignored;
        lines[unit.leading.clone()].iter().for_each(|line| line.write(out, options.partition_by_newline));
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
fn transform<'a>(lines: &[Line], imports: &[Written<'a>], options: &Options, out: &mut Vec<FormatElement>) {
    let is_boundary = |line: &Line| match line {
        Line::Import { .. } => false,
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
        let end = start + lines[start..].iter().take_while(|line| !is_boundary(line)).count();
        write_sorted(&lines[start..end], imports, options, end < lines.len(), out);
        start = end;
    }
    // Every line is written with a line break after it. What comes after the run writes its own.
    out.pop();
}

/// Sorts the runs of imports in a list of statements. Whoever writes the list says what it is
/// about to write.
pub(crate) struct ImportRun<'a> {
    /// `None`: imports are not sorted this way, and nothing here does anything.
    how: Option<Arc<SortImports>>,
    /// Where the capture of the run that is being written starts.
    slot: Option<usize>,
    /// Whether the next statement can be part of a run, if that is known.
    is_next_sortable: Option<bool>,
    lines: Vec<Line>,
    imports: Vec<Written<'a>>,
    /// Where the line that is being written starts.
    line_start: usize,
}

impl<'a> ImportRun<'a> {
    #[inline]
    pub(crate) fn new(f: &Formatter<'a>) -> Self {
        ImportRun {
            how: f.options().sort_imports.as_ref().filter(|how| how.as_oxfmt().is_some()).map(Arc::clone),
            slot: None,
            is_next_sortable: None,
            lines: Vec::new(),
            imports: Vec::new(),
            line_start: 0,
        }
    }

    /// An import that is written as it is in the source ends a run.
    fn is_sortable(statement: Stmt<'a>, f: &Formatter<'a>) -> bool {
        let span = statement.span();
        matches!(statement.kind(), StmtKind::Import(_))
            && !f.comments().is_suppressed(span.start)
            && !f.comments().has_trailing_suppression_comment(span.end)
    }

    /// To be called before the line break between the previous statement and `next` is written.
    /// `is_plain`: all comments between the two are written with `next`.
    #[inline]
    pub(crate) fn before_separator(&mut self, next: Stmt<'a>, is_plain: bool, f: &mut Formatter<'a>) {
        if self.how.is_some() {
            self.end_statement(Some(next).filter(|_| is_plain), f);
        }
    }

    /// To be called before `statement` and the comments before it are written.
    #[inline]
    pub(crate) fn before_statement(&mut self, statement: Stmt<'a>, f: &mut Formatter<'a>) {
        if self.how.is_some() {
            self.start_statement(statement, f);
        }
    }

    /// To be called after the last statement.
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
        if let (true, Some(options)) = (self.imports.len() >= 2, self.how.as_deref().and_then(SortImports::as_oxfmt)) {
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
        let is_sortable = self.is_next_sortable.take().unwrap_or_else(|| Self::is_sortable(statement, f));
        let StmtKind::Import(import) = statement.kind() else {
            return;
        };
        if !is_sortable {
            return;
        }
        match self.slot {
            None => self.slot = Some(f.start_capture()),
            Some(_) if f.elements().last() == Some(&FormatElement::Line(LineMode::Empty)) => self.lines.push(Line::Empty),
            Some(_) => {}
        }
        self.imports.push(Written::new(statement, import, f));
        self.line_start = f.elements().len();

        // One line at a time. What is left for the statement to write is its own line.
        let mut comments = f.comments().comments_before(statement.span().start);
        while let Some(first) = comments.first() {
            // Comments without anything between them belong together.
            let mut end = first.span.end;
            let count = 1 + comments[1..].iter().take_while(|next| std::mem::replace(&mut end, next.span.end) == next.span.start).count();
            let (now, later) = comments.split_at(count);
            comments = later;
            write!(f, FormatLeadingComments::Comments(now));
            // oxc does not see the line break after a block comment that the file starts with.
            let starts_file = |it: &Comment| it.is_block() && f.file().text()[..it.span.start as usize].trim_ascii().is_empty();
            if f.elements().last() == Some(&FormatElement::Line(LineMode::Hard)) && now.last().is_some_and(starts_file) {
                continue;
            }
            if let Some(&FormatElement::Line(mode @ (LineMode::Hard | LineMode::Empty))) = f.elements().last() {
                self.lines.push(Line::Comment(self.line_until(f.elements().len() - 1)));
                if mode == LineMode::Empty {
                    self.lines.push(Line::Empty);
                }
                self.line_start = f.elements().len();
            }
        }
    }
}
