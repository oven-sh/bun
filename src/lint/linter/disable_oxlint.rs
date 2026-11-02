//! A file's `oxlint-disable` and `eslint-disable` comments as oxlint applies them (`disable_directives.rs`), which
//! differs from ESLint:
//!
//! - Either comment form, `//` or `/* */`, works for every directive.
//! - A comment disables a range of the text. A message is suppressed if it overlaps the range. With `-line` and
//!   `-next-line` it has to start in the range, and `-line` covers the text before the comment.
//! - An enabling comment only ends what was disabled in the same words: all rules, or a rule by its name as written.
//!   All rules stay disabled after `enable a`, and `a` stays disabled after `enable`.
//! - Names are separated by commas or whitespace. A name matches the rule no matter which plugin prefix it's written
//!   with.
//! - Whitespace is what Rust's `char::is_whitespace` accepts: U+0085 counts, U+FEFF doesn't.

use super::directives::{ConfigComment, Label};
use super::message::{Data, LintMessage, Locator, RuleId, Suggestion, Suppression};
use crate::ast::File;
use crate::context::Severity;
use crate::fix::{Fix, SuggestionKind};
use crate::span::Span;
use bun_core::strings;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::borrow::Cow;

pub(crate) struct Input<'i, 'a> {
    pub(crate) file: &'a File<'a>,
    pub(crate) report_unused: Severity,
    pub(crate) wants_fixes: bool,
    /// The enabled rules that didn't run. Comments that disable them aren't reported.
    pub(crate) rules_to_ignore: &'i [RuleId],
    /// True if there are more such rules, whose names aren't known here. Only called for a comment that suppresses
    /// nothing.
    pub(crate) has_skipped_rules: &'i dyn Fn() -> bool,
    /// True if Bun knows what the rule named in a comment reports. It doesn't for a rule that oxlint has and Bun lacks,
    /// so a comment that disables such a rule is never reported.
    pub(crate) knows_rule: &'i dyn Fn(&[u8]) -> bool,
}

/// `eslint` or `oxlint`
type Prefix<'a> = &'a [u8];

/// The parts of a disabling comment that the comment ending its range needs.
#[derive(Copy, Clone)]
struct Open<'a> {
    start: u32,
    prefix: Prefix<'a>,
    name_span: Span,
    comment: Span,
    justification: &'a [u8],
}

/// `Interval<u32, DisabledRule>`
struct Range<'a> {
    start: u32,
    stop: u32,
    /// As written. `None` means all rules.
    name: Option<&'a [u8]>,
    name_span: Span,
    prefix: Prefix<'a>,
    /// The comment that's reported if the range suppresses nothing, with its delimiters. It's the one that ends the
    /// range, if there is one.
    comment: Span,
    /// `-line` or `-next-line`
    is_single_line: bool,
    justification: &'a [u8],
    is_used: bool,
}

type Names<'a> = SmallVec<[(&'a [u8], Span); 4]>;

/// The number of whitespace bytes at the start of `text`.
fn space_len(text: &[u8]) -> usize {
    text.len() - strings::trim_unicode_whitespace_start(text).len()
}

/// `collect_rule_names`. `offset` is where `text` starts.
fn names(text: &[u8], offset: u32) -> Names<'_> {
    let mut found = Names::new();
    let mut emit = |start: usize, end: usize| {
        let span = Span::new(offset + start as u32, offset + end as u32);
        found.push((&text[start..end], span));
    };
    let (mut start, mut end) = (None, text.len());
    let (mut at, mut is_after_space) = (0, false);
    while let Some(&byte) = text.get(at) {
        let space = space_len(&text[at..]);
        // ` -- why`, ` - why`
        let next = &text[at + 1..];
        if byte == b'-' && (next.first() == Some(&b'-') || is_after_space && space_len(next) > 0) {
            end = at;
            break;
        }
        if byte == b',' || space > 0 {
            if let Some(start) = start.take() {
                emit(start, at);
            }
        } else if start.is_none() {
            start = Some(at);
        }
        is_after_space = space > 0;
        at += space.max(1);
    }
    if let Some(start) = start {
        emit(start, end);
    }
    found
}

/// True if a comment that lists `name` applies to the rule `id`.
fn name_matches_rule(name: &[u8], id: &RuleId) -> bool {
    match id {
        RuleId::Known(meta) if !strings::contains_char(meta.name.as_bytes(), b'/') => {
            let short = strings::last_index_of_char(name, b'/').map_or(name, |it| &name[it + 1..]);
            short == meta.name.as_bytes()
        }
        RuleId::Known(meta) => (name.strip_suffix(meta.name.as_bytes()))
            .and_then(|it| it.strip_suffix(b"/"))
            .is_some_and(|it| it == meta.plugin.prefix().as_bytes()),
        RuleId::Js(rule) => name == &rule.id[..],
        RuleId::Named(_, id) => name == &id[..],
        RuleId::Unknown(_) => false,
    }
}

/// `compute_comment_fix_span`: the whole line, if nothing else is on it.
fn removal_of(text: &[u8], comment: Span) -> Span {
    let (start, end) = (comment.start as usize, comment.end as usize);
    let line_start = strings::last_index_of_char(&text[..start], b'\n').map_or(0, |it| it + 1);
    let line_end =
        strings::index_of_char_usize(&text[end..], b'\n').map_or(text.len(), |it| end + it + 1);
    let is_only_on_line = strings::trim_unicode_whitespace_end(&text[line_start..start]).is_empty()
        && strings::trim_unicode_whitespace_end(&text[end..line_end]).is_empty();
    match is_only_on_line {
        true => Span::new(line_start as u32, line_end as u32),
        false => comment,
    }
}

/// `RuleCommentRule::create_fix`: removes one of several names.
fn removal_from_list(text: &[u8], comment: Span, name: Span, prefix: Prefix) -> Option<Span> {
    let before = text.get(comment.start as usize..name.start as usize)?;
    let before_trimmed = strings::trim_unicode_whitespace_end(before);
    if before_trimmed.ends_with(b",") {
        return Some(Span::new(
            comment.start + before_trimmed.len() as u32 - 1,
            name.end,
        ));
    }
    let after = text.get(name.end as usize..comment.end as usize)?;
    let after_trimmed = strings::trim_unicode_whitespace_start(after);
    let space_after = (after.len() - after_trimmed.len()) as u32;
    if let Some(after_comma) = after_trimmed.strip_prefix(b",") {
        let space_after_comma =
            (after_comma.len() - strings::trim_unicode_whitespace_start(after_comma).len()) as u32;
        return Some(Span::new(
            name.start,
            name.end + space_after + 1 + space_after_comma,
        ));
    }
    if space_after > 0 && !matches!(after_trimmed, [] | [b'-', ..] | [b'*', b'/', ..]) {
        return Some(Span::new(name.start, name.end + space_after));
    }
    // It has to follow another name, not the word that makes the comment a directive.
    let space_before = (before.len() - before_trimmed.len()) as u32;
    let word_start = (0..before_trimmed.len())
        .rev()
        .find(|&i| before_trimmed[i] == b',' || space_len(&before_trimmed[i..]) > 0)
        .map_or(0, |it| it + 1);
    let rest = (before_trimmed[word_start..].strip_prefix(prefix))
        .and_then(|it| it.strip_prefix(b"-disable"));
    let is_rule = !matches!(rest, Some(b"" | b"-next-line" | b"-line"));
    (space_before > 0 && is_rule).then(|| Span::new(name.start - space_before, name.end))
}

/// The contents of `comment`, without its delimiters.
fn content_of(text: &[u8], comment: Span) -> Span {
    match text.get(comment.start as usize..).unwrap_or_default() {
        [b'/', b'*', ..] => comment.shrink(2, 2),
        [b'<', ..] => comment.shrink(4, 0),
        [b'-', ..] => comment.shrink(3, 0),
        _ => comment.shrink(2, 0),
    }
}

/// `DisableDirectivesBuilder::build_impl`. Also returns the comments that enable something that isn't disabled: the
/// prefix, the name, and the span to report.
fn ranges<'a>(
    file: &'a File<'a>,
    comments: impl Iterator<Item = &'a ConfigComment>,
) -> (Vec<Range<'a>>, Vec<(Prefix<'a>, Option<&'a [u8]>, Span)>) {
    let text = file.text();
    let (mut ranges, mut unused_enables) = (Vec::new(), Vec::new());
    let mut all: Option<Open<'a>> = None;
    let mut by_name: FxHashMap<&'a [u8], Open<'a>> = FxHashMap::default();
    for comment in comments {
        let content = content_of(text, comment.span);
        let prefix: Prefix = file.slice(comment.label_span).get(..6).unwrap_or_default();
        let list = Span::new(comment.label_span.end.min(content.end), content.end);
        let names = names(file.slice(list), list.start);
        let open = |start: u32, name_span: Span| Open {
            start,
            prefix,
            name_span,
            comment: comment.span,
            justification: file.slice(comment.justification),
        };
        let mut about_a_line = |start: u32, stop: u32| {
            let range = |name: Option<&'a [u8]>, name_span: Span| Range {
                start,
                stop,
                name,
                name_span,
                prefix,
                comment: comment.span,
                is_single_line: true,
                justification: file.slice(comment.justification),
                is_used: false,
            };
            match names.is_empty() {
                true => ranges.push(range(None, comment.span)),
                false => ranges.extend(names.iter().map(|it| range(Some(it.0), it.1))),
            }
        };
        match comment.label {
            Label::Disable if names.is_empty() => {
                all.get_or_insert_with(|| open(content.end, comment.span));
            }
            Label::Disable => {
                for &(name, span) in &names {
                    by_name
                        .entry(name)
                        .or_insert_with(|| open(content.end, span));
                }
            }
            Label::DisableNextLine => {
                // Up to the end of the next line.
                let rest = &text[content.end as usize..];
                let this_line =
                    strings::index_of_char_usize(rest, b'\n').map_or(rest.len(), |it| it + 1);
                let next = &rest[this_line..];
                let next_line =
                    strings::index_of_char_usize(next, b'\n').map_or(next.len(), |it| it + 1);
                let stop = this_line + strings::trim_right(&next[..next_line], b"\r\n").len();
                about_a_line(content.end, content.end + stop as u32);
            }
            Label::DisableLine => {
                let before = &text[..content.start as usize];
                let line = strings::last_index_of_char(before, b'\n').map_or(0, |it| it + 1);
                about_a_line(line as u32, content.start);
            }
            Label::Enable => {
                let mut close = |it: Open<'a>, name: Option<&'a [u8]>, name_span: Span| {
                    ranges.push(Range {
                        start: it.start,
                        stop: content.start,
                        name,
                        name_span,
                        prefix: it.prefix,
                        comment: comment.span,
                        is_single_line: false,
                        justification: it.justification,
                        is_used: false,
                    });
                };
                if names.is_empty() {
                    match all.take() {
                        Some(it) => close(it, None, comment.span),
                        None => unused_enables.push((prefix, None, content)),
                    }
                }
                for &(name, span) in &names {
                    match by_name.remove(name) {
                        Some(it) => close(it, Some(name), span),
                        None => unused_enables.push((prefix, Some(name), span)),
                    }
                }
            }
            _ => {}
        }
    }
    // Up to the end of the file.
    let open = (all.into_iter().map(|it| (None, it)))
        .chain(by_name.into_iter().map(|it| (Some(it.0), it.1)));
    ranges.extend(open.map(|(name, it)| Range {
        start: it.start,
        stop: text.len() as u32,
        name,
        name_span: it.name_span,
        prefix: it.prefix,
        comment: it.comment,
        is_single_line: false,
        justification: it.justification,
        is_used: false,
    }));
    crate::utils::sort::sort_by_key(&mut ranges, |it| (it.start, it.stop, it.name_span.start));
    (ranges, unused_enables)
}

/// A line and a column.
type Position = (u32, u32);

/// The part of a rule's name after the last `/`. Names that match the same rule share it.
fn last_part(name: &[u8]) -> &[u8] {
    strings::last_index_of_char(name, b'/').map_or(name, |it| &name[it + 1..])
}

/// The ranges grouped by the rule they apply to. Finding the ones that overlap a message takes time proportional to
/// their number plus the logarithm of the number of ranges.
struct Index<'a> {
    /// The last part of the name, which is empty for all rules, and the range's number. Sorted. So a name's ranges are
    /// ordered by start, and form a balanced search tree whose root is the middle one.
    entries: Vec<(&'a [u8], u32)>,
    /// For each entry: the last position where a range in its subtree stops.
    last_stop: Vec<Position>,
}

impl<'a> Index<'a> {
    fn new(ranges: &[Range<'a>], positions: &[(Position, Position)]) -> Self {
        let numbered = ranges.iter().zip(0u32..);
        let mut entries: Vec<_> = numbered
            .map(|(it, i)| (it.name.map_or(&b""[..], last_part), i))
            .collect();
        crate::utils::sort::sort_unstable(&mut entries);
        let mut index = Index {
            last_stop: vec![(0, 0); entries.len()],
            entries,
        };
        let mut start = 0;
        while let Some(&(name, _)) = index.entries.get(start) {
            let len = index.entries[start..].partition_point(|it| it.0 == name);
            index.note_stops(positions, start, start + len);
            start += len;
        }
        index
    }

    fn note_stops(
        &mut self,
        positions: &[(Position, Position)],
        start: usize,
        end: usize,
    ) -> Position {
        if start >= end {
            return (0, 0);
        }
        let middle = start + (end - start) / 2;
        let own = positions[self.entries[middle].1 as usize].1;
        let last = own
            .max(self.note_stops(positions, start, middle))
            .max(self.note_stops(positions, middle + 1, end));
        self.last_stop[middle] = last;
        last
    }

    /// Adds the numbers of the ranges with the key `name` that overlap `start..end`, in ascending order.
    fn overlapping(
        &self,
        name: &[u8],
        positions: &[(Position, Position)],
        (start, end): (Position, Position),
        found: &mut SmallVec<[u32; 8]>,
    ) {
        let first = self.entries.partition_point(|it| it.0 < name);
        let len = self.entries[first..].partition_point(|it| it.0 == name);
        self.search(positions, (first, first + len), (start, end), found);
    }

    fn search(
        &self,
        positions: &[(Position, Position)],
        (first, last): (usize, usize),
        (start, end): (Position, Position),
        found: &mut SmallVec<[u32; 8]>,
    ) {
        if first >= last {
            return;
        }
        let middle = first + (last - first) / 2;
        if self.last_stop[middle] <= start {
            return;
        }
        self.search(positions, (first, middle), (start, end), found);
        let number = self.entries[middle].1;
        let (from, to) = positions[number as usize];
        if from < end {
            if to > start {
                found.push(number);
            }
            self.search(positions, (middle + 1, last), (start, end), found);
        }
    }
}

/// Marks the messages that comments suppress, and adds a message for each unused comment. `comments` are the disabling
/// and enabling comments, in source order.
pub(crate) fn apply<'a>(
    input: &Input<'_, 'a>,
    comments: impl Iterator<Item = &'a ConfigComment>,
    problems: &mut Vec<LintMessage>,
) {
    let (file, locator) = (input.file, Locator::new(input.file));
    let (mut ranges, unused_enables) = ranges(file, comments);
    if ranges.is_empty() && unused_enables.is_empty() {
        return;
    }
    let positions: Vec<(Position, Position)> = (ranges
        .iter()
        .map(|it| (locator.position(it.start), locator.position(it.stop))))
    .collect();
    let index = Index::new(&ranges, &positions);
    let mut overlapping = SmallVec::new();
    for problem in problems.iter_mut().filter(|it| !it.is_fatal) {
        let Some(id) = &problem.rule_id else {
            continue;
        };
        let reported_start = (problem.line, problem.column);
        let (start, end) = (problem.comments_apply_at)
            .unwrap_or_else(|| (reported_start, problem.end.unwrap_or(reported_start)));
        overlapping.clear();
        index.overlapping(b"", &positions, (start, end), &mut overlapping);
        let for_all_rules = overlapping.len();
        match id {
            RuleId::Known(meta) => index.overlapping(
                last_part(meta.name.as_bytes()),
                &positions,
                (start, end),
                &mut overlapping,
            ),
            RuleId::Js(rule) => index.overlapping(
                last_part(&rule.id),
                &positions,
                (start, end),
                &mut overlapping,
            ),
            RuleId::Named(_, id) => {
                index.overlapping(last_part(id), &positions, (start, end), &mut overlapping)
            }
            RuleId::Unknown(_) => {}
        }
        if for_all_rules > 0 && overlapping.len() > for_all_rules {
            overlapping.sort_unstable();
        }
        for &number in &overlapping {
            let (range, (from, to)) = (&mut ranges[number as usize], positions[number as usize]);
            if (!range.is_single_line || from <= start && start < to)
                && range.name.is_none_or(|name| name_matches_rule(name, id))
            {
                range.is_used = true;
                problem
                    .suppressions
                    .push(Suppression::directive(range.justification));
            }
        }
    }
    if input.report_unused == Severity::Off {
        return;
    }
    let is_unused = |it: &Range| {
        !it.is_used
            && match it.name {
                None => input.rules_to_ignore.is_empty() && !(input.has_skipped_rules)(),
                Some(name) => {
                    (input.knows_rule)(name)
                        && !input
                            .rules_to_ignore
                            .iter()
                            .any(|id| name_matches_rule(name, id))
                }
            }
    };
    let mut report = |span: Span, message: Vec<u8>, removal: Option<Span>| {
        let mut problem = locator.problem(span, input.report_unused, None, message);
        problem.reported = u32::MAX;
        if let Some(span) = removal.filter(|_| input.wants_fixes) {
            problem.suggestions.push(Suggestion {
                message_id: Cow::Borrowed(""),
                message: b"remove unused disable directive".to_vec(),
                data: Data::None,
                fix: Fix {
                    span,
                    text: Vec::new(),
                },
                kind: SuggestionKind::Suggestion,
            });
        }
        problems.push(problem);
    };
    // One comment's ranges are adjacent, unless another comment's ranges start in between.
    for group in ranges.chunk_by(|a, b| a.comment == b.comment) {
        let unused = group.iter().filter(|it| is_unused(it));
        let Some(first) = group
            .first()
            .filter(|_| unused.clone().count() == group.len())
        else {
            for it in unused {
                let message = [
                    b"Unused ",
                    it.prefix,
                    b"-disable directive (no problems were reported from ",
                    it.name.unwrap_or(b"all"),
                    b").",
                ];
                let removal = removal_from_list(file.text(), it.comment, it.name_span, it.prefix);
                report(it.name_span, message.concat(), removal);
            }
            continue;
        };
        let message = [
            b"Unused ",
            first.prefix,
            b"-disable directive (no problems were reported).",
        ];
        report(
            first.comment,
            message.concat(),
            Some(removal_of(file.text(), first.comment)),
        );
    }
    for (prefix, name, span) in unused_enables {
        let mut message = [
            b"Unused ",
            prefix,
            b"-enable directive (no matching ",
            prefix,
        ]
        .concat();
        message.extend_from_slice(b"-disable directives were found");
        if let Some(name) = name {
            message.extend_from_slice(&[b" for ", name].concat());
        }
        message.extend_from_slice(b").");
        report(span, message, None);
    }
}
