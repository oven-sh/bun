//! Extra steps for `sortImports` from bunfig.toml's `[fmt]` or `--sort-imports`, on top of oxfmt's sorter. Sorts the names
//! inside braces and merges imports from the same module.
//!
//! This is a text-to-text pass, like the Prettier plugins. The caller parses and formats the returned text instead of the
//! original file. Pieces of source text move around verbatim. A file that is already tidy returns `None` and isn't parsed
//! twice, which is the common case after the first run.
//!
//! - A comment inside the braces moves with its name. That covers comments before the name and comments after it that end
//!   the line. Comments right outside the braces move with the first or last name, because that's where the formatter puts
//!   them anyway.
//! - An import with its own comment (above it or after it on the same line) is never merged away. Other imports can merge
//!   into it.
//! - Nothing merges across a side-effect import, a `prettier-ignore`d import, or any other statement.

use super::compare::natord;
use bun_core::strings;
use bun_lint::ast::{File, Import, ImportSpec, Stmt, StmtKind};
use bun_lint::span::Span;
use bun_lint::tokens::TokenKind;
use std::cmp::Ordering;

/// One name inside the braces, plus the source text that moves with it.
#[derive(Copy, Clone)]
struct Chunk<'a> {
    spec: ImportSpec<'a>,
    /// Starts where the previous chunk ends. Covers whitespace, leading comments, the name, and anything before its comma.
    before_comma: Span,
    /// Trailing comments after the comma.
    after_comma: Span,
    /// Regions outside this chunk (before the `{`, after the last name). Only the comments in them move with the name.
    lead: Span,
    trail: Span,
}

/// An import's `{ .. }`.
struct Braces<'a> {
    open: u32,
    close: u32,
    chunks: Vec<Chunk<'a>>,
    /// Everything between the last chunk and the `}`.
    tail: Span,
    /// `lead` ends at the `{`, and its comments belong to the first name. `trail` runs from the `}` to `from`.
    lead: Span,
    trail: Span,
}

/// Output buffer that never lets a line comment swallow the next piece.
#[derive(Default)]
struct Pieces {
    text: Vec<u8>,
    ends_in_line_comment: bool,
}

impl Pieces {
    fn push(&mut self, text: &[u8], ends_in_line_comment: bool) {
        if text.is_empty() {
            return;
        }
        if self.ends_in_line_comment && !matches!(text.first(), Some(b'\n' | b'\r')) {
            self.text.push(b'\n');
        }
        self.text.extend_from_slice(text);
        self.ends_in_line_comment = ends_in_line_comment;
    }
}

struct Tidy<'a> {
    file: &'a File<'a>,
    text: &'a [u8],
    /// Replacements to apply to the source text.
    changes: Vec<(Span, Vec<u8>)>,
}

/// One import in a run of consecutive imports.
struct Entry<'a> {
    statement: Stmt<'a>,
    import: Import<'a>,
    braces: Option<Braces<'a>>,
    /// Other imports can merge into this one.
    can_grow: bool,
    /// This import can be merged into another one and removed.
    can_go: bool,
}

/// Strips the quotes from `"a"` or `'a'`.
fn without_quotes(text: &[u8]) -> &[u8] {
    match text {
        [b'"' | b'\'', inner @ .., b'"' | b'\''] => inner,
        _ => text,
    }
}

impl<'a> Tidy<'a> {
    fn slice(&self, span: Span) -> &'a [u8] {
        self.text
            .get(span.start as usize..span.end as usize)
            .unwrap_or_default()
    }

    fn has_comments(&self, span: Span) -> bool {
        self.file.comments_in(span).next().is_some()
    }

    /// Finds the first `byte` in `span` that isn't inside a comment.
    fn find(&self, span: Span, byte: u8) -> Option<u32> {
        let mut from = span.start;
        let find_until = |from: u32, end: u32| {
            Some(
                from + strings::index_of_char_usize(self.slice(Span::new(from, end)), byte)? as u32,
            )
        };
        for comment in self.file.comments_in(span) {
            if let Some(found) = find_until(from, comment.span().start) {
                return Some(found);
            }
            from = comment.span().end;
        }
        find_until(from, span.end)
    }

    /// Sort key: the exported name, so `a as z` sorts under `a`.
    fn key_of(&self, spec: ImportSpec<'a>) -> &'a [u8] {
        without_quotes(self.slice(spec.imported().span()))
    }

    fn compare(&self, a: ImportSpec<'a>, b: ImportSpec<'a>) -> Ordering {
        let local = |it: ImportSpec<'a>| self.slice(it.local().span());
        natord(self.key_of(a), self.key_of(b), true)
            .then_with(|| self.key_of(a).cmp(self.key_of(b)))
            .then_with(|| local(a).cmp(local(b)))
    }

    fn is_same_name(&self, a: ImportSpec<'a>, b: ImportSpec<'a>) -> bool {
        self.compare(a, b) == Ordering::Equal && a.is_type_only() == b.is_type_only()
    }

    fn braces_of(&self, statement: Stmt<'a>, import: Import<'a>) -> Option<Braces<'a>> {
        if !import.has_named_imports() {
            return None;
        }
        // Everything between `import` and the module specifier.
        let keyword_end = statement.span().start + "import".len() as u32;
        let clause = Span::before(keyword_end, import.spec_span()?);
        let named = import.named();
        let first = (named.first()).map_or_else(|| Span::empty(clause.end), |it| it.span());
        let open = self.find(Span::before(clause.start, first), b'{')?;
        let last = (named.iter().last()).map_or_else(|| Span::empty(open + 1), |it| it.span());
        let close = self.find(Span::after(last, clause.end), b'}')?;
        let mut chunks = Vec::with_capacity(named.len());
        let mut from = open + 1;
        for (index, spec) in named.iter().enumerate() {
            let next = named.get(index + 1).map(|next| next.span().start);
            let limit = next.unwrap_or(close);
            let comma = self.find(Span::after(spec.span(), limit), b',');
            let after = comma.map_or_else(|| spec.span().end, |comma| comma + 1);
            // Comments on the rest of the line trail this name, but only if nothing else follows them on that line.
            let mut reached = after;
            for comment in self.file.comments_in(Span::new(after, limit)) {
                let gap = self.slice(Span::before(reached, comment.span()));
                if strings::contains_js_line_break(gap) {
                    break;
                }
                reached = comment.span().end;
            }
            let rest = self.slice(Span::new(reached, limit));
            let blanks = rest.len() - rest.trim_ascii_start().len();
            if next.is_some() && !strings::contains_js_line_break(&rest[..blanks]) {
                reached = after;
            }
            chunks.push(Chunk {
                spec,
                before_comma: Span::new(from, comma.unwrap_or(after)),
                after_comma: Span::new(after, reached),
                lead: Span::default(),
                trail: Span::default(),
            });
            from = reached;
        }
        // `lead` starts after `type` or after the default import.
        let kind = import.clause_span();
        let letters = self
            .slice(kind)
            .iter()
            .take_while(|it| it.is_ascii_alphabetic());
        let lead_start = match import.default() {
            Some(default) => default.span().end,
            None if import.is_type_only() => kind.start + letters.count() as u32,
            None => clause.start,
        };
        let keyword = self.find(Span::new(close + 1, clause.end), b'f')?;
        Some(Braces {
            open,
            close,
            chunks,
            tail: Span::new(from, close),
            lead: Span::new(lead_start, open),
            trail: Span::new(close + 1, keyword),
        })
    }

    /// Returns the chunks with the comments around the braces attached. `with_tail` also attaches comments before the `}`.
    fn chunks_of(&self, braces: &Braces<'a>, with_tail: bool) -> Vec<Chunk<'a>> {
        let mut chunks = braces.chunks.clone();
        if let Some(first) = chunks.first_mut() {
            first.lead = braces.lead;
        }
        if let Some(last) = chunks.last_mut() {
            last.trail = match with_tail {
                true => braces.tail.to(braces.trail),
                false => braces.trail,
            };
        }
        chunks
    }

    fn has_comments_of_its_own(&self, chunk: &Chunk<'a>) -> bool {
        [
            chunk.lead,
            chunk.before_comma.to(chunk.after_comma),
            chunk.trail,
        ]
        .iter()
        .any(|it| self.has_comments(*it))
    }

    /// The rest of the line after `statement`, capped at `limit`.
    fn rest_of_line(&self, statement: Span, limit: u32) -> Span {
        let rest = Span::after(statement, limit);
        let len = strings::index_of_any(self.slice(rest), b"\n\r");
        len.map_or(rest, |len| Span::after(statement, rest.start + len as u32))
    }

    /// Returns true if `spans` contain a `prettier-ignore` or `oxfmt-ignore` comment.
    fn is_left_alone(&self, spans: [Span; 2]) -> bool {
        let is_ignore = |span: Span| {
            let text = self.slice(span);
            let text = text.strip_prefix(b"//").unwrap_or_else(|| {
                (text.strip_prefix(b"/*"))
                    .and_then(|it| it.strip_suffix(b"*/"))
                    .unwrap_or(text)
            });
            matches!(text.trim_ascii(), b"prettier-ignore" | b"oxfmt-ignore")
        };
        spans
            .iter()
            .any(|span| self.file.comments_in(*span).any(|it| is_ignore(it.span())))
    }

    /// `before` starts after the previous statement's line. `behind` is the rest of this statement's line.
    fn entry(
        &self,
        statement: Stmt<'a>,
        import: Import<'a>,
        [before, behind]: [Span; 2],
    ) -> Entry<'a> {
        let span = statement.span();
        let braces = self.braces_of(statement, import);
        // Comments inside the statement that no name can carry along.
        let has_comments_inside = match &braces {
            Some(braces) if braces.chunks.is_empty() => self.has_comments(span),
            Some(braces) => {
                self.has_comments(Span::before(span.start, braces.lead))
                    || self.has_comments(Span::after(braces.trail, span.end))
            }
            None => self.has_comments(span),
        };
        // A comment directly above, with no blank line in between.
        let leads = self.file.comments_in(before).last().is_some_and(|it| {
            let gap = self.slice(it.span().between(span));
            strings::count_char(gap, b'\n').max(strings::count_char(gap, b'\r')) < 2
        });
        let can_grow = import.namespace().is_none()
            && import.phase().is_none()
            && braces.is_some() == import.has_named_imports()
            // Leave `import {} from "a"` alone.
            && (import.default().is_some() || !import.named().is_empty())
            // `import type a, { b }` is a syntax error.
            && !(import.is_type_only() && import.default().is_some());
        Entry {
            statement,
            import,
            braces,
            can_grow,
            can_go: can_grow && !has_comments_inside && !leads && !self.has_comments(behind),
        }
    }

    /// Same module, same `type` keyword, same import attributes.
    fn is_same_kind(&self, a: &Entry<'a>, b: &Entry<'a>) -> bool {
        // `type`, or Flow's `typeof`.
        let kind = |it: &Entry<'a>| {
            let clause = self.slice(it.import.clause_span());
            let word = clause.iter().take_while(|it| it.is_ascii_alphabetic());
            (it.import.is_type_only()).then(|| clause.get(..word.count()).unwrap_or_default())
        };
        let attributes = |it: &Entry<'a>| {
            let attributes = it.import.attributes()?;
            let texts = attributes.entries().iter().map(|entry| {
                let key = entry.key().map(|key| key.span(self.file));
                let value = entry.value().map(|value| value.span());
                [key, value].map(|it| without_quotes(self.slice(it.unwrap_or_default())))
            });
            let keyword = self.slice(attributes.keyword_span());
            Some((keyword, texts.collect::<Vec<_>>()))
        };
        a.import.spec() == b.import.spec() && kind(a) == kind(b) && attributes(a) == attributes(b)
    }

    fn is_line_comment_at_end(&self, span: Span) -> bool {
        self.file.comments_in(span).last().is_some_and(|it| {
            it.kind() == TokenKind::Line
                && !strings::contains_js_line_break(self.slice(Span::after(it.span(), span.end)))
        })
    }

    fn push(&self, span: Span, out: &mut Pieces) {
        out.push(self.slice(span), self.is_line_comment_at_end(span));
    }

    /// Writes the comments in `span`. `leads` means they belong to the name that follows.
    fn push_comments(&self, span: Span, leads: bool, out: &mut Pieces) {
        for comment in self.file.comments_in(span) {
            let is_line = comment.kind() == TokenKind::Line;
            // A leading line comment needs its own line, or it would attach to the previous name.
            out.push(if leads && is_line { b"\n" } else { b" " }, false);
            out.push(self.slice(comment.span()), is_line);
        }
    }

    /// Writes `chunks` as the contents of the braces.
    fn write_names(&self, chunks: &[Chunk<'a>], out: &mut Pieces) {
        for chunk in chunks {
            self.push_comments(chunk.lead, true, out);
            self.push(chunk.before_comma, out);
            // A block comment after the comma would attach to the next name, so the comma goes after it.
            let is_line = |it: Span| {
                self.file
                    .comments_in(it)
                    .any(|it| it.kind() == TokenKind::Line)
            };
            let comma_is_first = is_line(chunk.after_comma) || is_line(chunk.trail);
            if comma_is_first {
                out.push(b",", false);
            }
            self.push(chunk.after_comma, out);
            self.push_comments(chunk.trail, false, out);
            if !comma_is_first {
                out.push(b",", false);
            }
        }
    }

    /// Sorts `chunks` and drops exact duplicates. Returns true if anything changed.
    fn sort(&self, chunks: &mut Vec<Chunk<'a>>) -> bool {
        let before: Vec<u32> = chunks.iter().map(|it| it.before_comma.start).collect();
        crate::sort::sort_by(&mut chunks[..], |a, b| self.compare(a.spec, b.spec));
        chunks.dedup_by(|later, earlier| {
            !self.has_comments_of_its_own(later) && self.is_same_name(later.spec, earlier.spec)
        });
        !chunks.iter().map(|it| it.before_comma.start).eq(before)
    }

    /// Deletes `statement`, and the whole line if nothing else is on it.
    fn remove(&mut self, statement: Stmt<'a>) {
        let mut span = statement.span();
        let (before, after) = (
            self.slice(Span::before(0, span)),
            self.slice(Span::after(span, self.text.len() as u32)),
        );
        let line_start = strings::last_index_of_any(before, b"\n\r").map_or(0, |at| at + 1);
        let line_len = strings::index_of_any(after, b"\n\r").unwrap_or(after.len());
        let (on_line_before, on_line_after) = (&before[line_start..], &after[..line_len]);
        if on_line_before.trim_ascii().is_empty() && on_line_after.trim_ascii().is_empty() {
            let line_break = match &after[line_len..] {
                [b'\r', b'\n', ..] => 2,
                [_, ..] => 1,
                [] => 0,
            };
            span = Span::new(line_start as u32, span.end + (line_len + line_break) as u32);
        }
        self.changes.push((span, Vec::new()));
    }

    /// Rewrites `target` to import `default` and `chunks`.
    fn rewrite(&mut self, target: &Entry<'a>, default: Option<Span>, chunks: &[Chunk<'a>]) {
        let mut names = Pieces::default();
        match (&target.braces, target.import.default()) {
            (Some(braces), own_default) => {
                // These comments are part of `chunks` now.
                if !braces.chunks.is_empty() {
                    let comments = [braces.lead, braces.trail].map(|it| self.file.comments_in(it));
                    let comments = comments.into_iter().flatten();
                    (self.changes).extend(comments.map(|it| (it.span(), Vec::new())));
                }
                if let Some(default) = default.filter(|_| own_default.is_none()) {
                    let text = [self.slice(default), b", "].concat();
                    self.changes.push((Span::empty(braces.open), text));
                }
                self.write_names(chunks, &mut names);
                self.push(braces.tail, &mut names);
                if names.ends_in_line_comment {
                    names.text.push(b'\n');
                }
                let inside = Span::new(braces.open + 1, braces.close);
                self.changes.push((inside, names.text));
            }
            (None, Some(default)) if !chunks.is_empty() => {
                // Insert after any comments that belong to the default import.
                let default = default.span();
                let source = target.import.spec_span().unwrap_or_default();
                let from = self.find(default.between(source), b'f');
                let about_default = Span::after(default, from.unwrap_or(default.end));
                let last = self.file.comments_in(about_default).last();
                names.ends_in_line_comment = last.is_some_and(|it| it.kind() == TokenKind::Line);
                names.push(b", {", false);
                self.write_names(chunks, &mut names);
                names.push(b" }", false);
                let at = last.map_or(default.end, |it| it.span().end);
                self.changes.push((Span::empty(at), names.text));
            }
            _ => {}
        }
    }

    /// Tidies one run of imports with no barrier in it.
    fn tidy(&mut self, entries: &[Entry<'a>]) {
        let mut is_seen = vec![false; entries.len()];
        for (at, first) in entries.iter().enumerate() {
            if is_seen[at] {
                continue;
            }
            // All imports that could merge with `first`.
            let group: Vec<usize> = (at..entries.len())
                .filter(|&other| {
                    other == at || (!is_seen[other] && self.is_same_kind(first, &entries[other]))
                })
                .collect();
            group.iter().for_each(|&it| is_seen[it] = true);
            // Prefer a target that can't be removed, then one whose `}` has a comment before it, so that comment stays put.
            let can_grow = || group.iter().copied().filter(|&it| entries[it].can_grow);
            let has_tail_comment = |it: &usize| {
                let braces = entries[*it].braces.as_ref();
                braces.is_some_and(|braces| self.has_comments(braces.tail))
            };
            let target = can_grow()
                .find(|&it| !entries[it].can_go)
                .or_else(|| can_grow().find(has_tail_comment))
                .or_else(|| can_grow().next());
            let mut default = target.and_then(|it| Some(entries[it].import.default()?.span()));
            let mut merged: Vec<Chunk<'a>> = Vec::new();
            for &index in &group {
                let entry = &entries[index];
                let own = |with_tail: bool| {
                    (entry.braces.as_ref())
                        .map_or_else(Vec::new, |it| self.chunks_of(it, with_tail))
                };
                if Some(index) == target {
                    merged.extend(own(false));
                    continue;
                }
                let fits = match (default, entry.import.default()) {
                    (Some(one), Some(other)) => self.slice(one) == self.slice(other.span()),
                    _ => true,
                };
                if target.is_some() && entry.can_go && fits {
                    default = default.or_else(|| Some(entry.import.default()?.span()));
                    merged.extend(own(true));
                    self.remove(entry.statement);
                    continue;
                }
                let mut own = own(false);
                if self.sort(&mut own) {
                    self.rewrite(entry, None, &own);
                }
            }
            if let Some(target) = target.map(|it| &entries[it]) {
                let own_names = target.braces.as_ref().map_or(0, |it| it.chunks.len());
                let has_grown = merged.len() > own_names
                    || default.is_some() != target.import.default().is_some();
                if self.sort(&mut merged) || has_grown {
                    self.rewrite(target, default, &merged);
                }
            }
        }
    }

    /// Cheap check for unsorted names or a module that is imported twice. False positives are fine.
    fn may_be_untidy(&self) -> bool {
        let mut modules: Vec<&[u8]> = Vec::new();
        for statement in self.file.body().iter() {
            let StmtKind::Import(import) = statement.kind() else {
                continue;
            };
            let named = import.named();
            if (named.iter().zip(named.iter().skip(1)))
                .any(|(a, b)| self.compare(a, b) != Ordering::Less)
            {
                return true;
            }
            if !import.is_side_effect() {
                modules.push(import.spec().bytes());
            }
        }
        crate::sort::sort(&mut modules[..]);
        modules
            .iter()
            .zip(modules.iter().skip(1))
            .any(|(a, b)| a == b)
    }
}

/// Returns the text of `file` with sorted names and merged imports, or `None` if nothing changes.
pub(super) fn preprocess<'a>(file: &'a File<'a>) -> Option<Vec<u8>> {
    let text = file.text();
    let mut tidy = Tidy {
        file,
        text,
        changes: Vec::new(),
    };
    if !tidy.may_be_untidy() {
        return None;
    }
    let body = file.body();
    let mut entries = Vec::new();
    let mut previous_end = 0;
    for (index, statement) in body.iter().enumerate() {
        let span = statement.span();
        let next_start = (body.get(index + 1)).map_or(text.len() as u32, |it| it.span().start);
        let around = [
            Span::before(previous_end, span),
            tidy.rest_of_line(span, next_start),
        ];
        previous_end = around[1].end;
        match statement.kind() {
            StmtKind::Import(import) if !import.is_side_effect() && !tidy.is_left_alone(around) => {
                entries.push(tidy.entry(statement, import, around));
            }
            _ => {
                tidy.tidy(&entries);
                entries.clear();
            }
        }
    }
    tidy.tidy(&entries);
    let mut changes = tidy.changes;
    if changes.is_empty() {
        return None;
    }
    crate::sort::sort_by_key(&mut changes[..], |it| it.0.start);
    let mut out = Vec::with_capacity(text.len());
    let mut from = 0;
    for (span, new) in &changes {
        out.extend_from_slice(text.get(from..span.start as usize)?);
        out.extend_from_slice(new);
        from = span.end as usize;
    }
    out.extend_from_slice(text.get(from..)?);
    Some(out)
}

/// Every binding `file` imports, plus all of its comments.
fn summary<'a>(file: &'a File<'a>) -> (Vec<Vec<u8>>, Vec<&'a [u8]>) {
    let mut names = Vec::new();
    for statement in file.body().iter() {
        let StmtKind::Import(import) = statement.kind() else {
            continue;
        };
        let attributes = import.attributes().map_or(&b""[..], |it| {
            file.slice(it.keyword_span().to(it.braces_span()))
        });
        let attributes: Vec<u8> = (attributes.iter().copied())
            .filter(|it| !it.is_ascii_whitespace() && !matches!(it, b'"' | b'\'' | b','))
            .collect();
        let mut add = |imported: &[u8], local: &[u8], is_type: bool| {
            let kind = [u8::from(import.is_type_only()), u8::from(is_type)];
            let parts = [import.spec().bytes(), &attributes, &kind, imported, local];
            names.push(parts.join(&0));
        };
        if import.default().is_none() && import.namespace().is_none() && import.named().is_empty() {
            add(b"", b"", false);
        }
        if let Some(default) = import.default() {
            add(b"default", file.slice(default.span()), false);
        }
        if let Some(namespace) = import.namespace() {
            add(b"*", file.slice(namespace.span()), false);
        }
        for spec in import.named().iter() {
            add(
                without_quotes(file.slice(spec.imported().span())),
                file.slice(spec.local().span()),
                spec.is_type_only(),
            );
        }
    }
    crate::sort::sort(&mut names[..]);
    names.dedup();
    let mut comments: Vec<&[u8]> = file.comments().map(|it| file.slice(it.span())).collect();
    crate::sort::sort(&mut comments[..]);
    (names, comments)
}

/// Checks that `after`, the parsed output of [`preprocess`], still imports the same bindings and has the same comments.
pub(super) fn keeps_imports<'a, 'b>(before: &'a File<'a>, after: &'b File<'b>) -> bool {
    !after.has_parse_errors() && summary(before) == summary(after)
}
