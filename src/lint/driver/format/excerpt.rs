//! The formats shared with `bun check`. `pretty` shows the code around each problem the way Bun prints its own errors.
//! `agent` is the same in tags and without colors. `github` prints the workflow commands that GitHub Actions turns into
//! annotations.

use super::{Meta, display_position, linked};
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
/// How many groups are printed with a source excerpt. The rest get one line each.
const MAX_GROUPS: usize = 12;
const MAX_COMPACT_GROUPS: usize = 30;
/// How many files are listed under a group.
const MAX_FILES: usize = 8;

/// A problem and the file it's in.
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

/// Returns the path relative to the working directory, or the absolute path if that would need two or more `../`.
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

/// State cached for the next problem, which is usually in the same file.
#[derive(Default)]
struct FileCache<'r> {
    /// The last file looked up, its line starts, and its [`display_path`].
    file: Option<(&'r FileResult, LineStarts, Vec<u8>)>,
    /// The last file that [`with_help`] linted again, and the resulting messages.
    relinted: Option<(&'r FileResult, Vec<LintMessage>)>,
    /// The rules of the problems that get printed, if only a few do.
    printed_rules: Option<Vec<&'r RuleId>>,
}

impl<'r> FileCache<'r> {
    fn entry_for(
        &mut self,
        result: &'r FileResult,
        meta: &Meta,
    ) -> &(&'r FileResult, LineStarts, Vec<u8>) {
        self.file.take_if(|it| !std::ptr::eq(it.0, result));
        self.file
            .get_or_insert_with(|| (result, result.lines(), display_path(&result.path, meta.cwd)))
    }
}

/// Returns `problem`'s message with oxlint's help text added, if that wasn't generated when the file was linted. See
/// [`Meta::help`]. The help comes from the second lint's message with the same rule, location and text.
fn with_help<'r>(
    problem: Problem<'r>,
    meta: &Meta,
    cache: &mut FileCache<'r>,
) -> Option<LintMessage> {
    let (lint, Problem { result, message }) = (meta.help?, problem);
    if !(cache.relinted.as_ref()).is_some_and(|it| std::ptr::eq(it.0, result)) {
        cache.relinted = Some((result, lint(result, cache.printed_rules.as_deref())));
    }
    let rule = |it: &LintMessage| it.rule_id.as_ref().map(|id| id.to_vec());
    let is_same = |it: &&LintMessage| {
        (it.line, it.column, it.end) == (message.line, message.column, message.end)
            && it.message == message.message
            && rule(it) == rule(message)
    };
    let found = cache.relinted.as_ref()?.1.iter().find(is_same)?;
    Some(LintMessage {
        details: found.details.clone(),
        constant_help: found.constant_help,
        ..message.clone()
    })
}

/// Returns lines `from..=to` of `result`'s text, without line terminators. Lines count from 1, like ESLint's.
fn lines<'r>(
    result: &'r FileResult,
    (from, to): (u32, u32),
    meta: &Meta,
    cache: &mut FileCache<'r>,
) -> Vec<&'r [u8]> {
    let Some(text) = result.text.as_deref() else {
        return Vec::new();
    };
    let starts = &cache.entry_for(result, meta).1;
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

/// Joins `lines` with newlines and replaces each tab with a space.
fn without_tabs(lines: &[&[u8]]) -> Vec<u8> {
    let mut text = Vec::with_capacity(lines.iter().map(|it| it.len() + 1).sum());
    for (i, line) in lines.iter().enumerate() {
        if i > 0 {
            text.push(b'\n');
        }
        text.extend_from_slice(line);
    }
    // Storing every byte unconditionally lets the compiler vectorize the loop.
    for byte in &mut text {
        *byte = match *byte {
            b'\t' => b' ',
            other => other,
        };
    }
    text
}

/// Appends formatted output to a `Vec`. `write_char` has a fast path because the padding before a `^` is written one
/// space at a time.
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

/// Appends `text` the way `{}` prints a `BStr`.
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

/// Equal for two problems exactly when their [`Problem::rule`] is, without allocating the name for each problem.
#[derive(PartialEq, Eq, Hash)]
enum Rule<'r> {
    None,
    BuiltIn(Plugin, &'static str),
    ById(&'r [u8]),
}

impl<'r> Rule<'r> {
    fn of(problem: &Problem<'r>) -> Rule<'r> {
        match &problem.message.rule_id {
            None => Rule::None,
            Some(RuleId::Known(meta)) => Rule::BuiltIn(meta.plugin, meta.name),
            Some(RuleId::Js(rule)) => Rule::ById(&rule.id),
            Some(RuleId::Named(_, id)) => Rule::ById(id),
            Some(RuleId::Unknown(id)) => Rule::ById(id),
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
    // Each rule gets a number. A built-in rule's number is also cached by the address of its `Meta`, so its name is
    // hashed once instead of once per problem.
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

/// Counts the problems of `group` in each file, highest count first.
fn by_file<'r>(group: &[Problem<'r>]) -> Vec<(Problem<'r>, usize)> {
    let mut files: Vec<(Problem, usize)> = Vec::new();
    for problem in group {
        // Problems are already ordered by file.
        match files.last_mut() {
            Some(last) if std::ptr::eq(last.0.result, problem.result) => last.1 += 1,
            _ => files.push((*problem, 1)),
        }
    }
    bun_lint::utils::sort::sort_by_key(&mut files, |it| std::cmp::Reverse(it.1));
    files
}

/// How many columns stay visible to the left of the reported location when the start of its line is cut off.
const COLUMNS_LEFT_OF_LOCATION: usize = 30;

/// Fits `lines` into `room` terminal columns. Lines that are too wide are cut down to the part around the reported
/// location, which is at `column` in the last line. Returns the text and the location's new column. Both columns count
/// like ESLint's: from 1, in UTF-16 code units. A `room` of 0 means no limit.
fn fitted(lines: &[&[u8]], column: u32, room: usize) -> (Vec<u8>, u32) {
    use strings::visible::width::exclude_ansi_colors::{utf8 as width, utf8_index_at_width};
    let text = without_tabs(lines);
    if room == 0 || text.len() <= room || strings::split(&text, b"\n").all(|it| width(it) <= room) {
        return (text, column);
    }
    const MARK: &[u8] = "\u{2026}".as_bytes();
    let last = strings::split(&text, b"\n").last().unwrap_or_default();
    let column_offset = strings::wtf8_offset_of_utf16_index(last, column.saturating_sub(1));
    let skipped = match width(&last[..column_offset]) {
        before if before + COLUMNS_LEFT_OF_LOCATION / 2 < room => 0,
        before => before - COLUMNS_LEFT_OF_LOCATION.min(room / 2),
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
            let before = line.get(start..column_offset).unwrap_or_default();
            column = 1 + u32::from(start > 0) + strings::wtf8_len_utf16(before);
        }
    }
    (cut, column)
}

/// The file, line and column of a location, and the source lines to show. The location is in the last line.
type Spot<'s> = ((&'s [u8], u32, u32), &'s [&'s [u8]]);

/// Prints `text` the way Bun prints its own errors.
fn write_like_bun_error(
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
        let room = Some(meta.width.saturating_sub(gutter))
            .filter(|it| *it >= 2 * COLUMNS_LEFT_OF_LOCATION);
        // A rule written in JavaScript can give a column far past the end of the line.
        let end = lines.last().map_or(0, |it| strings::wtf8_len_utf16(it));
        let (text, column) = fitted(lines, column.min(end + 1), room.unwrap_or(0));
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
    let position = spot.map_or_else(bun_ast::Location::default, |((file, line, column), _)| {
        bun_ast::Location {
            file: file.to_vec().into(),
            ..location(line, column)
        }
    });
    let to = &mut Appender(out);
    let _ = match meta.color {
        true => {
            (message.write_format::<true>(to)).and_then(|()| position.write_place::<true>(to, kind))
        }
        false => (message.write_format::<false>(to))
            .and_then(|()| position.write_place::<false>(to, kind)),
    };
}

/// Returns true if it printed notes below the problem, not only its location.
fn write_pretty_problem<'r>(
    out: &mut Vec<u8>,
    problem: Problem<'r>,
    meta: &Meta,
    cache: &mut FileCache<'r>,
) -> bool {
    let message_with_help = with_help(problem, meta, cache);
    let (result, message) = (
        problem.result,
        message_with_help.as_ref().unwrap_or(problem.message),
    );
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
    let (line, column) = display_position(message, meta.is_oxlint);
    let source_lines = match line {
        line @ 1.. => lines(result, (line.saturating_sub(2).max(1), line), meta, cache),
        0 => Vec::new(),
    };
    // No excerpt for a blank line, or for generated code, whose long lines would fill the screen.
    let is_hidden = source_lines
        .last()
        .is_none_or(|line| line.trim_ascii().is_empty())
        || source_lines.iter().any(|line| line.len() > 1000);
    let source_lines = if is_hidden { Vec::new() } else { source_lines };
    let blank = source_lines
        .iter()
        .take_while(|line| line.trim_ascii().is_empty())
        .count();
    let kind = if problem.is_error() {
        bun_ast::Kind::Err
    } else {
        bun_ast::Kind::Warn
    };
    let file = cache.entry_for(result, meta).2.clone();
    let at = (&file[..], line, column);
    write_like_bun_error(out, meta, kind, text, Some((at, &source_lines[blank..])));
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
        write_like_bun_error(
            out,
            meta,
            bun_ast::Kind::Note,
            text.as_bytes().to_vec(),
            None,
        );
    }
    for ((line, column), _, text) in labels {
        let source_lines = lines(result, (*line, *line), meta, cache);
        let source_lines = source_lines.first().filter(|it| it.len() <= 1000);
        let spot = (
            (&file[..], *line, *column),
            source_lines.map_or(&[][..], std::slice::from_ref),
        );
        out.push(b'\n');
        write_like_bun_error(
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
    let cache = &mut FileCache::default();
    if problems.len() <= GROUP_THRESHOLD || meta.shows_all {
        if problems.len() <= GROUP_THRESHOLD {
            cache.printed_rules = rules_of(problems.iter().copied());
        }
        for (i, problem) in problems.into_iter().enumerate() {
            if i > 0 {
                out.push(b'\n');
            }
            write_pretty_problem(out, problem, meta, cache);
        }
        return;
    }
    let groups = grouped(&problems, meta.is_native);
    let detailed_count = groups.len().min(MAX_GROUPS);
    cache.printed_rules = rules_of(groups[..detailed_count].iter().map(|it| it[0]));
    for group in &groups[..detailed_count] {
        let has_notes = write_pretty_problem(out, group[0], meta, cache);
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
                    display_position(first.message, meta.is_oxlint).0
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
    let compact = (groups.len() - detailed_count).min(MAX_COMPACT_GROUPS);
    for group in &groups[detailed_count..detailed_count + compact] {
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
    let rest: usize = groups[detailed_count + compact..]
        .iter()
        .map(Vec::len)
        .sum();
    if rest > 0 {
        pretty!(
            out,
            meta.color,
            "  <d>and {} of {}<r>\n",
            plural(rest, "more problem"),
            plural(groups.len() - detailed_count - compact, "other kind")
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
    cache: &mut FileCache<'r>,
) {
    let Some(&problem) = group.first() else {
        return;
    };
    let message_with_help = with_help(problem, meta, cache);
    let (result, message) = (
        problem.result,
        message_with_help.as_ref().unwrap_or(problem.message),
    );
    let tag = if problem.is_error() {
        "error"
    } else {
        "warning"
    };
    let (line, column) = display_position(message, meta.is_oxlint);
    let _ = write!(
        out,
        "<{tag} file=\"{}\" line=\"{line}\" column=\"{column}\"",
        BStr::new(&attribute(&display_path(&result.path, meta.cwd))),
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
    if let (Some(_), line @ 1..) = (&result.text, line) {
        let first = line.saturating_sub(2).max(1);
        let mut source_lines = lines(result, (first, line + 1), meta, cache);
        // A trailing blank line adds nothing.
        if source_lines.len() as u32 > line - first + 1
            && source_lines
                .last()
                .is_some_and(|it| it.trim_ascii().is_empty())
        {
            source_lines.pop();
        }
        if source_lines.iter().all(|line| line.len() <= 1000) && !source_lines.is_empty() {
            let from = column.saturating_sub(1) as usize;
            let to = (message.end.filter(|end| end.0 == line))
                .map(|(_, end_column)| end_column.saturating_sub(1) as usize);
            bun_sema_driver::format::write_agent_source(
                out,
                first,
                &source_lines,
                line,
                (from, to),
            );
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
            let (line, column) = display_position(other.message, meta.is_oxlint);
            let _ = write!(out, "{space}{}:{line}:{column}", BStr::new(&path));
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
    let cache = &mut FileCache::default();
    if problems.len() <= GROUP_THRESHOLD || meta.shows_all {
        if problems.len() <= GROUP_THRESHOLD {
            cache.printed_rules = rules_of(problems.iter().copied());
        }
        problems.iter().for_each(|problem| {
            write_agent_problem(out, std::slice::from_ref(problem), meta, cache)
        });
    } else {
        let groups = grouped(&problems, false);
        let listed_count = groups.len().min(MAX_GROUPS + MAX_COMPACT_GROUPS);
        cache.printed_rules = rules_of(groups[..listed_count].iter().map(|it| it[0]));
        groups[..listed_count]
            .iter()
            .for_each(|group| write_agent_problem(out, group, meta, cache));
        let rest: usize = groups[listed_count..].iter().map(Vec::len).sum();
        if rest > 0 {
            let _ = writeln!(
                out,
                "<not-shown>{} of {}. Run `bun lint --all` to list every problem, or `bun lint <path>` to lint one file or directory.</not-shown>",
                plural(rest, "more problem"),
                plural(groups.len() - listed_count, "other kind")
            );
        }
    }
    // The caller adds the last newline.
    if !problems.is_empty() {
        out.pop();
    }
}

/// `::error file=a.js,line=1,col=1,endLine=1,endColumn=10,title=no-var::Unexpected var.`
pub(super) fn write_github(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    // GitHub resolves the path from the repository root, wherever the step runs.
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
        let signed = |(line, column): (u32, u32)| (line as i32, column as i32);
        let (line, column) = signed(display_position(message, meta.is_oxlint));
        let start = (line.max(1), column.max(1));
        let end = message.end.map(signed).filter(|end| *end >= start);
        let (end_line, end_column) = end.unwrap_or(start);
        let _ = write!(
            out,
            "::{} file={},line={},col={},endLine={end_line},endColumn={end_column},title={}::",
            if problem.is_error() {
                "error"
            } else {
                "warning"
            },
            bun_core::fmt::github_action_property(&path),
            start.0,
            start.1,
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
