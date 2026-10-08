//! The `oxlint-disable` and `eslint-disable` comments of a file as oxlint applies them (`disable_directives.rs`), which is not
//! how ESLint does:
//!
//! - A comment of either form, `//` or `/* */`, can be any of them.
//! - What a comment disables is a range of the text. A message is suppressed if it overlaps the range. With `-line` and
//!   `-next-line` it has to start in it, and `-line` is about what is before the comment.
//! - A comment that enables ends what was disabled in the same words: all rules, or a rule by its name as it is written. All
//!   rules stay disabled after `enable a`, and `a` stays disabled after `enable`.
//! - Names are separated by commas or by white space. A name means the rule whatever plugin it is written with.

use super::directives::{ConfigComment, Label};
use super::message::{LintMessage, Locator, RuleId, Suggestion, Suppression};
use super::space::{space_len, trim_end, trim_start};
use crate::ast::File;
use crate::context::Severity;
use crate::fix::Fix;
use crate::span::Span;
use bun_core::strings;
use smallvec::SmallVec;
use std::borrow::Cow;

pub(crate) struct Input<'i, 'a> {
    pub(crate) file: &'a File<'a>,
    pub(crate) report_unused: Severity,
    pub(crate) wants_fixes: bool,
    /// The rules that are enabled and did not run. What disables them is not reported.
    pub(crate) rules_to_ignore: &'i [RuleId],
    /// There are more of them, which have no name here.
    pub(crate) has_skipped_rules: bool,
    /// Whether it is known what the rule that a comment names reports: not if it is one that oxlint has and that does not
    /// exist here. Nothing can be said about a comment that disables such a rule.
    pub(crate) can_tell: &'i dyn Fn(&[u8]) -> bool,
}

/// `eslint` or `oxlint`
type Prefix<'a> = &'a [u8];

/// A comment that disables, as far as the one that ends its range needs to know it.
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
    /// As it is written. `None`: all rules.
    name: Option<&'a [u8]>,
    name_span: Span,
    prefix: Prefix<'a>,
    /// The comment that is reported if the range suppresses nothing, with its delimiters: the one that ends the range, if
    /// one does.
    comment: Span,
    /// `-line` or `-next-line`
    is_about_a_line: bool,
    justification: &'a [u8],
    is_used: bool,
}

type Names<'a> = SmallVec<[(&'a [u8], Span); 4]>;

/// `collect_rule_names`. `offset`: where `text` starts.
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

/// Whether a comment that names `name` is about the rule `id`.
fn is_name_of(name: &[u8], id: &RuleId) -> bool {
    match id {
        RuleId::Known(meta) if !strings::contains_char(meta.name.as_bytes(), b'/') => {
            let short = strings::last_index_of_char(name, b'/').map_or(name, |it| &name[it + 1..]);
            short == meta.name.as_bytes()
        }
        RuleId::Known(meta) => (name.strip_suffix(meta.name.as_bytes()))
            .and_then(|it| it.strip_suffix(b"/"))
            .is_some_and(|it| it == meta.plugin.prefix().as_bytes()),
        RuleId::Js(rule) => name == &rule.id[..],
        RuleId::Unknown(_) => false,
    }
}

/// `compute_comment_fix_span`: the whole line, if nothing else is on it.
fn removal_of(text: &[u8], comment: Span) -> Span {
    let (start, end) = (comment.start as usize, comment.end as usize);
    let line_start = strings::last_index_of_char(&text[..start], b'\n').map_or(0, |it| it + 1);
    let line_end =
        strings::index_of_char_usize(&text[end..], b'\n').map_or(text.len(), |it| end + it + 1);
    let is_alone =
        trim_end(&text[line_start..start]).is_empty() && trim_end(&text[end..line_end]).is_empty();
    match is_alone {
        true => Span::new(line_start as u32, line_end as u32),
        false => comment,
    }
}

/// `RuleCommentRule::create_fix`: removes one name of several.
fn removal_from_list(text: &[u8], comment: Span, name: Span, prefix: Prefix) -> Option<Span> {
    let before = text.get(comment.start as usize..name.start as usize)?;
    let before_trimmed = trim_end(before);
    if before_trimmed.ends_with(b",") {
        return Some(Span::new(
            comment.start + before_trimmed.len() as u32 - 1,
            name.end,
        ));
    }
    let after = text.get(name.end as usize..comment.end as usize)?;
    let after_trimmed = trim_start(after);
    let space_after = (after.len() - after_trimmed.len()) as u32;
    if let Some(after_comma) = after_trimmed.strip_prefix(b",") {
        let space_after_comma = (after_comma.len() - trim_start(after_comma).len()) as u32;
        return Some(Span::new(
            name.start,
            name.end + space_after + 1 + space_after_comma,
        ));
    }
    if space_after > 0 && !matches!(after_trimmed, [] | [b'-', ..] | [b'*', b'/', ..]) {
        return Some(Span::new(name.start, name.end + space_after));
    }
    // After another name, not after the word that makes the comment a directive.
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

/// The length of `line` without the `\n` and `\r` at its end.
fn len_without_line_end(line: &[u8]) -> usize {
    line.len()
        - line
            .iter()
            .rev()
            .take_while(|it| matches!(it, b'\n' | b'\r'))
            .count()
}

/// What is in `comment`, without its delimiters.
fn content_of(text: &[u8], comment: Span) -> Span {
    let is_line = text.get(comment.start as usize + 1) == Some(&b'/');
    comment.shrink(2, if is_line { 0 } else { 2 })
}

/// `DisableDirectivesBuilder::build_impl`. Also returns the comments that enable what is not disabled: the prefix, the name, and
/// what is reported.
fn ranges<'a>(
    file: &'a File<'a>,
    comments: impl Iterator<Item = &'a ConfigComment>,
) -> (Vec<Range<'a>>, Vec<(Prefix<'a>, Option<&'a [u8]>, Span)>) {
    let text = file.text();
    let (mut ranges, mut unused_enables) = (Vec::new(), Vec::new());
    let mut all: Option<Open<'a>> = None;
    let mut by_name: Vec<(&'a [u8], Open<'a>)> = Vec::new();
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
                is_about_a_line: true,
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
                    if !by_name.iter().any(|it| it.0 == name) {
                        by_name.push((name, open(content.end, span)));
                    }
                }
            }
            Label::DisableNextLine => {
                // To the end of the next line.
                let rest = &text[content.end as usize..];
                let this_line =
                    strings::index_of_char_usize(rest, b'\n').map_or(rest.len(), |it| it + 1);
                let next = &rest[this_line..];
                let next_line =
                    strings::index_of_char_usize(next, b'\n').map_or(next.len(), |it| it + 1);
                let stop = this_line + len_without_line_end(&next[..next_line]);
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
                        is_about_a_line: false,
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
                    match by_name.iter().position(|it| it.0 == name) {
                        Some(at) => close(by_name.swap_remove(at).1, Some(name), span),
                        None => unused_enables.push((prefix, Some(name), span)),
                    }
                }
            }
            _ => {}
        }
    }
    // To the end of the file.
    let open = (all.into_iter().map(|it| (None, it)))
        .chain(by_name.into_iter().map(|it| (Some(it.0), it.1)));
    ranges.extend(open.map(|(name, it)| Range {
        start: it.start,
        stop: text.len() as u32,
        name,
        name_span: it.name_span,
        prefix: it.prefix,
        comment: it.comment,
        is_about_a_line: false,
        justification: it.justification,
        is_used: false,
    }));
    ranges.sort_by_key(|it| (it.start, it.stop));
    (ranges, unused_enables)
}

/// Marks the messages that comments suppress, and adds a message for each comment that does nothing. `comments`: those that
/// disable and enable, in the order of the source.
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
    let places: Vec<((u32, u32), (u32, u32))> = (ranges
        .iter()
        .map(|it| (locator.position(it.start), locator.position(it.stop))))
    .collect();
    for problem in problems.iter_mut().filter(|it| !it.is_fatal) {
        let Some(id) = &problem.rule_id else {
            continue;
        };
        let shown = (problem.line, problem.column);
        let (start, end) =
            (problem.comments_apply_at).unwrap_or_else(|| (shown, problem.end.unwrap_or(shown)));
        for (range, &(from, to)) in ranges.iter_mut().zip(&places) {
            let overlaps = from < end && to > start;
            if overlaps
                && (!range.is_about_a_line || from <= start && start < to)
                && range.name.is_none_or(|name| is_name_of(name, id))
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
                None => input.rules_to_ignore.is_empty() && !input.has_skipped_rules,
                Some(name) => {
                    (input.can_tell)(name)
                        && !input.rules_to_ignore.iter().any(|id| is_name_of(name, id))
                }
            }
    };
    let mut report = |span: Span, message: Vec<u8>, removal: Option<Span>| {
        let mut problem = locator.problem(span, input.report_unused, None, message);
        if let Some(span) = removal.filter(|_| input.wants_fixes) {
            problem.suggestions.push(Suggestion {
                message_id: Cow::Borrowed(""),
                message: b"remove unused disable directive".to_vec(),
                data: Vec::new(),
                fix: Fix {
                    span,
                    text: Vec::new(),
                },
            });
        }
        problems.push(problem);
    };
    // The ranges of one comment are next to each other, unless those of another one start in between.
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
