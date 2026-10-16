//! The formats that `bun check` has too: `pretty`, which shows the code around each problem the way
//! Bun prints its own errors, `agent`, the same in tags and without colors, and `github`, the
//! workflow commands that GitHub Actions turns into annotations.

use super::{Meta, linked};
use crate::paths;
use crate::results::{Counts, FileResult};
use bstr::BStr;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::linter::{LintMessage, RuleId};
use bun_lint::rule::Plugin;
use bun_lint::source::LineStarts;
use bun_sema::util::FxHashMap;
use std::io::Write;

macro_rules! pretty {
    ($($arg:tt)*) => {
        let _ = bun_core::write_pretty!($($arg)*);
    };
}

/// Above this many problems, identical ones are grouped instead of printed one by one.
const GROUP_THRESHOLD: usize = 50;
/// Groups printed with a source excerpt. The others take a line each.
const MAX_GROUPS: usize = 12;
const MAX_COMPACT_GROUPS: usize = 30;
/// Files listed under a group.
const MAX_FILES: usize = 8;

/// A problem, and the file that has it.
#[derive(Copy, Clone)]
struct Problem<'r> {
    result: &'r FileResult,
    message: &'r LintMessage,
}

impl Problem<'_> {
    fn is_error(&self) -> bool {
        self.message.is_fatal || self.message.severity == Severity::Error
    }

    fn rule(&self) -> Vec<u8> {
        self.message
            .rule_id
            .as_ref()
            .map(|id| id.to_vec())
            .unwrap_or_default()
    }
}

/// Relative to the working directory, or absolute when that would need two or more `../`.
fn display_path(path: &[u8], cwd: &[u8]) -> Vec<u8> {
    let path = paths::from_native(path);
    if !paths::is_absolute(&path) {
        return path;
    }
    let relative = paths::relative(cwd, &path);
    if relative.starts_with(b"../../") {
        path
    } else {
        relative
    }
}

/// What is kept for the next problem, which is in the same file as a rule.
#[derive(Default)]
struct Place<'r> {
    /// The file that was asked about last, where its lines start, and [`display_path`] of it.
    file: Option<(&'r FileResult, LineStarts, Vec<u8>)>,
    /// The file that [`with_help`] has asked about last, and the answer.
    helped: Option<(&'r FileResult, Vec<LintMessage>)>,
    /// The rules of the problems that are written, if those are few.
    written: Option<Vec<&'r RuleId>>,
}

impl<'r> Place<'r> {
    fn of(
        &mut self,
        result: &'r FileResult,
        meta: &Meta,
    ) -> &(&'r FileResult, LineStarts, Vec<u8>) {
        self.file.take_if(|it| !std::ptr::eq(it.0, result));
        self.file.get_or_insert_with(|| {
            let starts = match &result.line_starts {
                Some(starts) => LineStarts::at(starts.clone()),
                None => LineStarts::new(result.text.as_deref().unwrap_or_default()),
            };
            (result, starts, display_path(&result.path, meta.cwd))
        })
    }
}

/// The message of `problem` with what oxlint says besides it, if that was not made when the file was linted: [`Meta::help`]. It is
/// what the same rule says at the same place in the same words.
fn with_help<'r>(problem: Problem<'r>, meta: &Meta, place: &mut Place<'r>) -> Option<LintMessage> {
    let (lint, Problem { result, message }) = (meta.help?, problem);
    if !(place.helped.as_ref()).is_some_and(|it| std::ptr::eq(it.0, result)) {
        place.helped = Some((result, lint(result, place.written.as_deref())));
    }
    let rule = |it: &LintMessage| it.rule_id.as_ref().map(|id| id.to_vec());
    let is_same = |it: &&LintMessage| {
        (it.line, it.column, it.end) == (message.line, message.column, message.end)
            && it.message == message.message
            && rule(it) == rule(message)
    };
    let found = place.helped.as_ref()?.1.iter().find(is_same)?;
    Some(LintMessage {
        details: found.details.clone(),
        constant_help: found.constant_help,
        ..message.clone()
    })
}

/// The lines `from..=to` of the text of `result`, counted from 1 as ESLint counts them, without their ends.
fn lines<'r>(
    result: &'r FileResult,
    (from, to): (u32, u32),
    meta: &Meta,
    place: &mut Place<'r>,
) -> Vec<&'r [u8]> {
    let Some(text) = result.text.as_deref() else {
        return Vec::new();
    };
    let starts = &place.of(result, meta).1;
    let mut found = Vec::with_capacity(4);
    for line in from.max(1)..=to {
        let Some(start) = starts.start_of(line) else {
            break;
        };
        let whole = match starts.start_of(line + 1) {
            Some(next) => match &text[start as usize..next as usize] {
                [line @ .., b'\r', b'\n'] | [line @ .., 0xE2, 0x80, 0xA8 | 0xA9] => line,
                [line @ .., _] | line => line,
            },
            None => &text[start as usize..],
        };
        found.push(match line {
            1 => strings::without_utf8_bom(whole),
            _ => whole,
        });
    }
    found
}

/// `lines`, one after the other, with a space for each tab.
fn without_tabs(lines: &[&[u8]]) -> Vec<u8> {
    let mut text = Vec::with_capacity(lines.iter().map(|it| it.len() + 1).sum());
    for (i, line) in lines.iter().enumerate() {
        if i > 0 {
            text.push(b'\n');
        }
        text.extend_from_slice(line);
    }
    // Every byte is written, so that many are at a time.
    for byte in &mut text {
        *byte = match *byte {
            b'\t' => b' ',
            other => other,
        };
    }
    text
}

/// What is printed is appended. A space is written at a time in front of a `^`.
struct Appender<'o>(&'o mut Vec<u8>);

impl std::fmt::Write for Appender<'_> {
    #[inline]
    fn write_str(&mut self, text: &str) -> std::fmt::Result {
        self.0.extend_from_slice(text.as_bytes());
        Ok(())
    }

    #[inline]
    fn write_char(&mut self, character: char) -> std::fmt::Result {
        match character.is_ascii() {
            true => self.0.push(character as u8),
            false => (self.0).extend_from_slice(character.encode_utf8(&mut [0; 4]).as_bytes()),
        }
        Ok(())
    }
}

/// As `{}` prints a `BStr`.
fn push_lossy(out: &mut Vec<u8>, text: &[u8]) {
    match text.is_ascii() {
        true => out.extend_from_slice(text),
        false => {
            let _ = write!(out, "{}", BStr::new(text));
        }
    }
}

fn all<'r>(results: &'r [FileResult]) -> Vec<Problem<'r>> {
    let problems = results.iter().flat_map(|result| {
        result
            .messages
            .iter()
            .map(move |message| Problem { result, message })
    });
    problems.collect()
}

/// What is the same for two problems if [`Problem::rule`] is, and is not written anew for each.
#[derive(PartialEq, Eq, Hash)]
enum Rule<'r> {
    None,
    BuiltIn(Plugin, &'static str),
    Written(&'r [u8]),
}

impl<'r> Rule<'r> {
    fn of(problem: &Problem<'r>) -> Rule<'r> {
        match &problem.message.rule_id {
            None => Rule::None,
            Some(RuleId::Known(meta)) => Rule::BuiltIn(meta.plugin, meta.name),
            Some(RuleId::Js(rule)) => Rule::Written(&rule.id),
            Some(RuleId::Named(_, id)) => Rule::Written(id),
            Some(RuleId::Unknown(id)) => Rule::Written(id),
        }
    }
}

fn rules_of<'r>(problems: impl Iterator<Item = Problem<'r>>) -> Option<Vec<&'r RuleId>> {
    Some(
        problems
            .filter_map(|it| it.message.rule_id.as_ref())
            .collect(),
    )
}

/// Groups problems that have the same rule and message, largest group first. With `by_rule`, the message is ignored and
/// groups of errors come before groups of warnings.
fn grouped<'r>(problems: &[Problem<'r>], by_rule: bool) -> Vec<Vec<Problem<'r>>> {
    // A number for each rule, and that of a rule that is built in by where the rule is: its name is read once, not for each problem.
    let mut numbers: FxHashMap<Rule, u32> = FxHashMap::default();
    let mut numbers_by_address: FxHashMap<usize, u32> = FxHashMap::default();
    let mut index: FxHashMap<(u32, &[u8]), usize> = FxHashMap::default();
    let mut groups: Vec<Vec<Problem>> = Vec::new();
    for problem in problems {
        let mut number_of = || {
            let next = numbers.len() as u32;
            *numbers.entry(Rule::of(problem)).or_insert(next)
        };
        let rule = match &problem.message.rule_id {
            Some(RuleId::Known(meta)) => {
                let address = std::ptr::from_ref(*meta).addr();
                match numbers_by_address.get(&address) {
                    Some(number) => *number,
                    None => {
                        let number = number_of();
                        numbers_by_address.insert(address, number);
                        number
                    }
                }
            }
            _ => number_of(),
        };
        let key = match by_rule && problem.message.rule_id.is_some() {
            true => (rule, &b""[..]),
            false => (rule, &problem.message.message[..]),
        };
        let at = match index.get(&key) {
            Some(at) => *at,
            None => {
                groups.push(Vec::new());
                index.insert(key, groups.len() - 1);
                groups.len() - 1
            }
        };
        groups[at].push(*problem);
    }
    bun_lint::utils::sort::sort_by_key(&mut groups, |group| {
        let is_first = by_rule && group[0].is_error();
        std::cmp::Reverse((is_first, group.len()))
    });
    groups
}

fn plural(count: usize, noun: &str) -> String {
    format!("{count} {noun}{}", if count == 1 { "" } else { "s" })
}

/// How many of `group` each file has, the most first.
fn by_file<'r>(group: &[Problem<'r>]) -> Vec<(Problem<'r>, usize)> {
    let mut files: Vec<(Problem, usize)> = Vec::new();
    for problem in group {
        // They are in the order of the files.
        match files.last_mut() {
            Some(last) if std::ptr::eq(last.0.result, problem.result) => last.1 += 1,
            _ => files.push((*problem, 1)),
        }
    }
    bun_lint::utils::sort::sort_by_key(&mut files, |it| std::cmp::Reverse(it.1));
    files
}

/// How many columns stay visible to the left of the reported place when the start of its line is cut off.
const LEFT_OF_THE_PLACE: usize = 30;

/// Fits `lines` into `room` terminal columns. Lines that are too wide are cut down to the part around the reported place,
/// which is at `column` in the last line. Returns the text and the place's new column. Both columns count like ESLint's:
/// from 1, in UTF-16 code units. A `room` of 0 means no limit.
fn fitted(lines: &[&[u8]], column: u32, room: usize) -> (Vec<u8>, u32) {
    use strings::visible::width::exclude_ansi_colors::{utf8 as width, utf8_index_at_width};
    let text = without_tabs(lines);
    if room == 0 || text.len() <= room || strings::split(&text, b"\n").all(|it| width(it) <= room) {
        return (text, column);
    }
    const MARK: &[u8] = "\u{2026}".as_bytes();
    let last = strings::split(&text, b"\n").last().unwrap_or_default();
    let place = strings::wtf8_offset_of_utf16_index(last, column.saturating_sub(1));
    let skipped = match width(&last[..place]) {
        before if before + LEFT_OF_THE_PLACE / 2 < room => 0,
        before => before - LEFT_OF_THE_PLACE.min(room / 2),
    };
    let (mut cut, mut column) = (Vec::with_capacity(text.len()), column);
    // Once the start of the line is cut off, the lines above it aren't useful context any more. Only show the last one.
    let first = if skipped > 0 { lines.len() - 1 } else { 0 };
    for (i, line) in strings::split(&text, b"\n").enumerate().skip(first) {
        if i > first {
            cut.push(b'\n');
        }
        let start = utf8_index_at_width(line, skipped);
        let (rest, mut room) = (&line[start..], room);
        if start > 0 {
            cut.extend_from_slice(MARK);
            room -= 1;
        }
        match utf8_index_at_width(rest, room) {
            end if end == rest.len() => cut.extend_from_slice(rest),
            _ => {
                cut.extend_from_slice(&rest[..utf8_index_at_width(rest, room - 1)]);
                cut.extend_from_slice(MARK);
            }
        }
        if i + 1 == lines.len() {
            let before = line.get(start..place).unwrap_or_default();
            column = 1 + u32::from(start > 0) + strings::wtf8_len_utf16(before);
        }
    }
    (cut, column)
}

/// The file, line and column of a place, and the source lines to show. The place is in the last line.
type Spot<'s> = ((&'s [u8], u32, u32), &'s [&'s [u8]]);

/// Prints `text` the way Bun prints its own errors.
fn write_said(
    out: &mut Vec<u8>,
    meta: &Meta,
    kind: bun_ast::Kind,
    text: Vec<u8>,
    spot: Option<Spot>,
) {
    let location = |line: u32, column: u32| bun_ast::Location {
        line: line as i32,
        column: column as i32,
        ..Default::default()
    };
    let code = spot.map(|((_, line, column), lines)| {
        let gutter = bun_core::fmt::digit_count(line) + " | ".len();
        let room =
            Some(meta.width.saturating_sub(gutter)).filter(|it| *it >= 2 * LEFT_OF_THE_PLACE);
        let (text, column) = fitted(lines, column, room.unwrap_or(0));
        bun_ast::Location {
            line_text: Some(text.into()),
            ..location(line, column)
        }
    });
    let message = bun_ast::Msg {
        kind,
        data: bun_ast::Data {
            text: text.into(),
            location: code,
        },
        ..Default::default()
    };
    let place = spot.map_or_else(bun_ast::Location::default, |((file, line, column), _)| {
        bun_ast::Location {
            file: file.to_vec().into(),
            ..location(line, column)
        }
    });
    let to = &mut Appender(out);
    let _ =
        match meta.color {
            true => (message.write_format::<true>(to))
                .and_then(|()| place.write_place::<true>(to, kind)),
            false => (message.write_format::<false>(to))
                .and_then(|()| place.write_place::<false>(to, kind)),
        };
}

/// Returns true if it printed notes below the problem, not only its location.
fn write_pretty_problem<'r>(
    out: &mut Vec<u8>,
    problem: Problem<'r>,
    meta: &Meta,
    place: &mut Place<'r>,
) -> bool {
    let helped = with_help(problem, meta, place);
    let (result, message) = (problem.result, helped.as_ref().unwrap_or(problem.message));
    let rule = problem.rule();
    let mut text = Vec::with_capacity(message.message.len() + rule.len() + 16);
    text.extend_from_slice(&message.message);
    if !rule.is_empty() {
        text.extend_from_slice(match meta.color {
            true => bun_core::pretty_fmt!("<r>  <d>", true).as_bytes(),
            false => bun_core::pretty_fmt!("<r>  <d>", false).as_bytes(),
        });
        push_lossy(&mut text, &linked(&rule, message, meta));
    }
    let shown = match message.line {
        line @ 1.. => lines(result, (line.saturating_sub(2).max(1), line), meta, place),
        0 => Vec::new(),
    };
    // Not lines that nobody has written, which fill the screen.
    let is_hidden = shown.last().is_none_or(|line| line.trim_ascii().is_empty())
        || shown.iter().any(|line| line.len() > 1000);
    let shown = if is_hidden { Vec::new() } else { shown };
    let blank = shown
        .iter()
        .take_while(|line| line.trim_ascii().is_empty())
        .count();
    let kind = if problem.is_error() {
        bun_ast::Kind::Err
    } else {
        bun_ast::Kind::Warn
    };
    let file = place.of(result, meta).2.clone();
    let at = (&file[..], message.line, message.column);
    write_said(out, meta, kind, text, Some((at, &shown[blank..])));
    let texts = [message.first_label(), message.help(), message.note()];
    let texts = texts.iter().filter(|it| !it.is_empty());
    let labels = message.details.iter().flat_map(|it| &it.labels);
    let labels = labels.filter(|it| !it.2.is_empty());
    let has_notes = texts.clone().next().is_some() || labels.clone().next().is_some();
    if has_notes {
        out.push(b'\n');
    }
    for text in texts {
        out.push(b'\n');
        write_said(
            out,
            meta,
            bun_ast::Kind::Note,
            text.as_bytes().to_vec(),
            None,
        );
    }
    for ((line, column), _, text) in labels {
        let shown = lines(result, (*line, *line), meta, place);
        let shown = shown.first().filter(|it| it.len() <= 1000);
        let spot = (
            (&file[..], *line, *column),
            shown.map_or(&[][..], std::slice::from_ref),
        );
        out.push(b'\n');
        write_said(
            out,
            meta,
            bun_ast::Kind::Note,
            text.as_bytes().to_vec(),
            Some(spot),
        );
    }
    out.push(b'\n');
    has_notes
}

/// Prints `12 problems (3 errors, 9 warnings)` and how many of them `--fix` can fix. The last line gets no newline.
fn write_pretty_summary(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    let mut counts = Counts::default();
    results.iter().for_each(|it| counts.add(it.counts));
    let (errors, warnings) = (
        plural(counts.errors, "error"),
        plural(counts.warnings, "warning"),
    );
    let problems = plural(counts.errors + counts.warnings, "problem");
    pretty!(out, meta.color, "<b>{}<r> <d>(<r>", problems);
    match counts.errors {
        0 => {
            pretty!(out, meta.color, "<d>{}<r>", errors);
        }
        _ => {
            pretty!(out, meta.color, "<red>{}<r>", errors);
        }
    }
    match counts.warnings {
        0 => {
            pretty!(out, meta.color, "<d>, {})<r>", warnings);
        }
        _ => {
            pretty!(out, meta.color, "<d>,<r> <yellow>{}<r><d>)<r>", warnings);
        }
    }
    let fixable = counts.fixable_errors + counts.fixable_warnings;
    if fixable > 0 {
        pretty!(
            out,
            meta.color,
            "\n<d>{} can be fixed with<r> <cyan>--fix<r>",
            fixable
        );
    }
}

pub(super) fn write_pretty(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    write_pretty_problems(out, results, meta);
    if meta.is_native && !out.is_empty() {
        out.extend_from_slice(if out.ends_with(b"\n") { b"\n" } else { b"\n\n" });
        write_pretty_summary(out, results, meta);
    }
}

fn write_pretty_problems(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    let problems = all(results);
    let place = &mut Place::default();
    if problems.len() <= GROUP_THRESHOLD || meta.shows_all {
        if problems.len() <= GROUP_THRESHOLD {
            place.written = rules_of(problems.iter().copied());
        }
        for (i, problem) in problems.into_iter().enumerate() {
            if i > 0 {
                out.push(b'\n');
            }
            write_pretty_problem(out, problem, meta, place);
        }
        return;
    }
    let groups = grouped(&problems, meta.is_native);
    let shown = groups.len().min(MAX_GROUPS);
    place.written = rules_of(groups[..shown].iter().map(|it| it[0]));
    for group in &groups[..shown] {
        let has_notes = write_pretty_problem(out, group[0], meta, place);
        if group.len() > 1 {
            if has_notes && meta.is_native {
                out.push(b'\n');
            }
            let files = by_file(group);
            pretty!(
                out,
                meta.color,
                "    <b><yellow>{} times<r><d> in {}<r>\n",
                group.len(),
                plural(files.len(), "file")
            );
            for (first, count) in files.iter().take(MAX_FILES) {
                let path = display_path(&first.result.path, meta.cwd);
                pretty!(
                    out,
                    meta.color,
                    "      {:>4}  <cyan>{}<r><d>:{}<r>\n",
                    count,
                    BStr::new(&path),
                    first.message.line
                );
            }
            if files.len() > MAX_FILES {
                pretty!(
                    out,
                    meta.color,
                    "      <d>and {}<r>\n",
                    plural(files.len() - MAX_FILES, "more file")
                );
            }
        }
        out.push(b'\n');
    }
    let compact = (groups.len() - shown).min(MAX_COMPACT_GROUPS);
    for group in &groups[shown..shown + compact] {
        let first_line = strings::split(&group[0].message.message, b"\n")
            .next()
            .unwrap_or_default();
        pretty!(
            out,
            meta.color,
            "  {:>4}  {}  <d>{}<r>\n",
            group.len(),
            BStr::new(first_line),
            BStr::new(&linked(&group[0].rule(), group[0].message, meta))
        );
    }
    let rest: usize = groups[shown + compact..].iter().map(Vec::len).sum();
    if rest > 0 {
        pretty!(
            out,
            meta.color,
            "  <d>and {} of {}<r>\n",
            plural(rest, "more problem"),
            plural(groups.len() - shown - compact, "other kind")
        );
    }
    if compact > 0 {
        out.push(b'\n');
    }
    pretty!(
        out,
        meta.color,
        "<cyan>bun lint --all<r><d>  show every problem<r>"
    );
}

/// An attribute value, without the quotes.
fn attribute(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    for byte in text {
        out.extend_from_slice(
            strings::xml_escape_entity(*byte).unwrap_or_else(|| std::slice::from_ref(byte)),
        );
    }
    out
}

fn write_agent_problem<'r>(
    out: &mut Vec<u8>,
    group: &[Problem<'r>],
    meta: &Meta,
    place: &mut Place<'r>,
) {
    let Some(&problem) = group.first() else {
        return;
    };
    let helped = with_help(problem, meta, place);
    let (result, message) = (problem.result, helped.as_ref().unwrap_or(problem.message));
    let tag = if problem.is_error() {
        "error"
    } else {
        "warning"
    };
    let _ = write!(
        out,
        "<{tag} file=\"{}\" line=\"{}\" column=\"{}\"",
        BStr::new(&attribute(&display_path(&result.path, meta.cwd))),
        message.line,
        message.column
    );
    let rule = problem.rule();
    if !rule.is_empty() {
        let _ = write!(out, " rule=\"{}\"", BStr::new(&attribute(&rule)));
    }
    if message.fix.is_some() {
        out.extend_from_slice(b" fixable=\"true\"");
    }
    if group.len() > 1 {
        let _ = write!(out, " times=\"{}\"", group.len());
    }
    out.extend_from_slice(b">\n");
    out.extend_from_slice(&message.message);
    out.push(b'\n');
    if let (Some(_), line @ 1..) = (&result.text, message.line) {
        let first = line.saturating_sub(2).max(1);
        let mut shown = lines(result, (first, line + 1), meta, place);
        // A blank line after it says nothing.
        if shown.len() as u32 > line - first + 1
            && shown.last().is_some_and(|it| it.trim_ascii().is_empty())
        {
            shown.pop();
        }
        if shown.iter().all(|line| line.len() <= 1000) && !shown.is_empty() {
            let from = message.column.saturating_sub(1) as usize;
            let to = (message.end.filter(|end| end.0 == line))
                .map(|(_, end_column)| end_column.saturating_sub(1) as usize);
            bun_sema_driver::format::write_agent_source(out, first, &shown, line, (from, to));
        }
    }
    let first = ((message.line, message.column), message.first_label());
    let others = message.details.iter().flat_map(|it| &it.labels);
    for ((line, column), text) in std::iter::once(first).chain(others.map(|it| (it.0, &*it.2))) {
        if !text.is_empty() {
            let _ = writeln!(
                out,
                "<label line=\"{line}\" column=\"{column}\">{text}</label>"
            );
        }
    }
    for (tag, text) in [("help", message.help()), ("note", message.note())] {
        if !text.is_empty() {
            let _ = writeln!(out, "<{tag}>{text}</{tag}>");
        }
    }
    for suggestion in &message.suggestions {
        let _ = writeln!(
            out,
            "<suggestion>{}</suggestion>",
            BStr::new(&suggestion.message)
        );
    }
    if group.len() > 1 {
        const MAX_LOCATIONS: usize = 10;
        out.extend_from_slice(b"<also>");
        for (i, other) in group[1..].iter().take(MAX_LOCATIONS).enumerate() {
            let path = display_path(&other.result.path, meta.cwd);
            let space = if i > 0 { " " } else { "" };
            let _ = write!(
                out,
                "{space}{}:{}:{}",
                BStr::new(&path),
                other.message.line,
                other.message.column
            );
        }
        if group.len() - 1 > MAX_LOCATIONS {
            let _ = write!(out, " and {} more", group.len() - 1 - MAX_LOCATIONS);
        }
        out.extend_from_slice(b"</also>\n");
    }
    let _ = writeln!(out, "</{tag}>");
}

pub(super) fn write_agent(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    let problems = all(results);
    let place = &mut Place::default();
    if problems.len() <= GROUP_THRESHOLD || meta.shows_all {
        if problems.len() <= GROUP_THRESHOLD {
            place.written = rules_of(problems.iter().copied());
        }
        problems.iter().for_each(|problem| {
            write_agent_problem(out, std::slice::from_ref(problem), meta, place)
        });
    } else {
        let groups = grouped(&problems, false);
        let shown = groups.len().min(MAX_GROUPS + MAX_COMPACT_GROUPS);
        place.written = rules_of(groups[..shown].iter().map(|it| it[0]));
        groups[..shown]
            .iter()
            .for_each(|group| write_agent_problem(out, group, meta, place));
        let rest: usize = groups[shown..].iter().map(Vec::len).sum();
        if rest > 0 {
            let _ = writeln!(
                out,
                "<not-shown>{} of {}. Run `bun lint --all` to list every problem, or `bun lint <path>` to lint one file or directory.</not-shown>",
                plural(rest, "more problem"),
                plural(groups.len() - shown, "other kind")
            );
        }
    }
    // The caller adds the end of the last line.
    if !problems.is_empty() {
        out.pop();
    }
}

/// `::error file=a.js,line=1,col=1,endLine=1,endColumn=10,title=no-var::Unexpected var.`
pub(super) fn write_github(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    // GitHub takes the path from the root of the repository, wherever the step runs.
    let workspace = bun_core::env_var::GITHUB_WORKSPACE::get().map(paths::from_native);
    let from = workspace.as_deref().unwrap_or(meta.cwd);
    for (i, problem) in all(results).into_iter().enumerate() {
        if i > 0 {
            out.push(b'\n');
        }
        let Problem { result, message } = problem;
        let path = paths::from_native(&result.path);
        let path = if paths::is_absolute(&path) {
            paths::relative(from, &path)
        } else {
            path
        };
        let (end_line, end_column) = message.end.unwrap_or((message.line, message.column));
        let _ = write!(
            out,
            "::{} file={},line={},col={},endLine={end_line},endColumn={end_column},title={}::",
            if problem.is_error() {
                "error"
            } else {
                "warning"
            },
            bun_core::fmt::github_action_property(&path),
            message.line.max(1),
            message.column.max(1),
            bun_core::fmt::github_action_property(&match problem.rule() {
                rule if rule.is_empty() => b"bun lint".to_vec(),
                rule => rule,
            }),
        );
        let text = strings::replace_owned(
            &strings::replace_owned(&message.message, b"%", b"%25"),
            b"\r",
            b"%0D",
        );
        out.extend_from_slice(&strings::replace_owned(&text, b"\n", b"%0A"));
    }
}
