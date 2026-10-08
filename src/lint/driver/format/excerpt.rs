//! The formats that `bun check` has too: `pretty`, which shows the code around each problem the way
//! Bun prints its own errors, `agent`, the same in tags and without colors, and `github`, the
//! workflow commands that GitHub Actions turns into annotations.

use super::Meta;
use crate::paths;
use crate::results::FileResult;
use bstr::BStr;
use bun_core::strings;
use bun_lint::context::Severity;
use bun_lint::linter::LintMessage;
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
        self.message.rule_id.as_ref().map(|id| id.to_vec()).unwrap_or_default()
    }
}

/// Relative to the working directory, or absolute when that would need two or more `../`.
fn display_path(path: &[u8], cwd: &[u8]) -> Vec<u8> {
    if !paths::is_absolute(path) {
        return path.to_vec();
    }
    let relative = paths::relative(cwd, path);
    if relative.starts_with(b"../../") { path.to_vec() } else { relative }
}

/// The lines `from..=to` of `text`, counted from 1 as ESLint counts them, without their ends.
fn lines(text: &[u8], from: u32, to: u32) -> Vec<&[u8]> {
    let text = strings::without_utf8_bom(text);
    let (mut found, mut line, mut at) = (Vec::new(), 1, 0);
    while line <= to && at <= text.len() {
        let rest = &text[at..];
        let mut end = rest.len();
        let mut next = rest.len() + 1;
        let mut from_here = 0;
        // U+2028 and U+2029 start with 0xE2.
        while let Some(found) = strings::index_of_any(&rest[from_here..], b"\n\r\xE2") {
            let candidate = from_here + found;
            let len = match &rest[candidate..] {
                [b'\r', b'\n', ..] => 2,
                [b'\r' | b'\n', ..] => 1,
                [0xE2, 0x80, 0xA8 | 0xA9, ..] => 3,
                _ => 0,
            };
            if len > 0 {
                (end, next) = (candidate, candidate + len);
                break;
            }
            from_here = candidate + 1;
        }
        if line >= from {
            found.push(&rest[..end]);
        }
        line += 1;
        at += next;
    }
    found
}

fn all<'r>(results: &'r [FileResult]) -> Vec<Problem<'r>> {
    let problems = results.iter().flat_map(|result| result.messages.iter().map(move |message| Problem { result, message }));
    problems.collect()
}

/// The groups of problems with the same rule and message, the largest first.
fn grouped<'r>(problems: &[Problem<'r>]) -> Vec<Vec<Problem<'r>>> {
    let mut index: FxHashMap<(Vec<u8>, &[u8]), usize> = FxHashMap::default();
    let mut groups: Vec<Vec<Problem>> = Vec::new();
    for problem in problems {
        let at = *index.entry((problem.rule(), &problem.message.message[..])).or_insert_with(|| {
            groups.push(Vec::new());
            groups.len() - 1
        });
        groups[at].push(*problem);
    }
    groups.sort_by_key(|group| std::cmp::Reverse(group.len()));
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
    files.sort_by_key(|it| std::cmp::Reverse(it.1));
    files
}

fn write_pretty_problem(out: &mut Vec<u8>, problem: Problem, meta: &Meta) {
    let Problem { result, message } = problem;
    let mut text = message.message.clone();
    let rule = problem.rule();
    if !rule.is_empty() {
        pretty!(&mut text, meta.color, "<r>  <d>{}", BStr::new(&rule));
    }
    let shown = match (&result.text, message.line) {
        (Some(text), line @ 1..) => lines(text, line.saturating_sub(2).max(1), line),
        _ => Vec::new(),
    };
    // Not lines that nobody has written, which fill the screen.
    let is_hidden = shown.last().is_none_or(|line| line.trim_ascii().is_empty()) || shown.iter().any(|line| line.len() > 1000);
    let shown = if is_hidden { Vec::new() } else { shown };
    let blank = shown.iter().take_while(|line| line.trim_ascii().is_empty()).count();
    let data = bun_ast::Data {
        text: text.into(),
        location: Some(bun_ast::Location {
            file: display_path(&result.path, meta.cwd).into(),
            line: message.line as i32,
            column: message.column as i32,
            line_text: Some(strings::replace_owned(&shown[blank..].join(&b'\n'), b"\t", b" ").into()),
            ..Default::default()
        }),
    };
    let message = bun_ast::Msg {
        kind: if problem.is_error() { bun_ast::Kind::Err } else { bun_ast::Kind::Warn },
        data,
        ..Default::default()
    };
    let to = &mut bun_core::fmt::VecWriter(out);
    let _ = match meta.color {
        true => message.write_format::<true>(to),
        false => message.write_format::<false>(to),
    };
    out.push(b'\n');
}

pub(super) fn write_pretty(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    let problems = all(results);
    if problems.len() <= GROUP_THRESHOLD || meta.shows_all {
        for (i, problem) in problems.into_iter().enumerate() {
            if i > 0 {
                out.push(b'\n');
            }
            write_pretty_problem(out, problem, meta);
        }
        return;
    }
    let groups = grouped(&problems);
    let shown = groups.len().min(MAX_GROUPS);
    for group in &groups[..shown] {
        write_pretty_problem(out, group[0], meta);
        if group.len() > 1 {
            let files = by_file(group);
            pretty!(out, meta.color, "    <b><yellow>{} times<r><d> in {}<r>\n", group.len(), plural(files.len(), "file"));
            for (first, count) in files.iter().take(MAX_FILES) {
                let path = display_path(&first.result.path, meta.cwd);
                pretty!(out, meta.color, "      {:>4}  <cyan>{}<r><d>:{}<r>\n", count, BStr::new(&path), first.message.line);
            }
            if files.len() > MAX_FILES {
                pretty!(out, meta.color, "      <d>and {}<r>\n", plural(files.len() - MAX_FILES, "more file"));
            }
        }
        out.push(b'\n');
    }
    let compact = (groups.len() - shown).min(MAX_COMPACT_GROUPS);
    for group in &groups[shown..shown + compact] {
        let first_line = strings::split(&group[0].message.message, b"\n").next().unwrap_or_default();
        pretty!(out, meta.color, "  {:>4}  {}  <d>{}<r>\n", group.len(), BStr::new(first_line), BStr::new(&group[0].rule()));
    }
    let rest: usize = groups[shown + compact..].iter().map(Vec::len).sum();
    if rest > 0 {
        pretty!(out, meta.color, "  <d>and {} of {}<r>\n", plural(rest, "more problem"), plural(groups.len() - shown - compact, "other kind"));
    }
    pretty!(out, meta.color, "\n<cyan>bun lint --all<r><d>  show every problem<r>");
}

/// An attribute value, without the quotes.
fn attribute(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    for byte in text {
        out.extend_from_slice(strings::xml_escape_entity(*byte).unwrap_or_else(|| std::slice::from_ref(byte)));
    }
    out
}

fn write_agent_problem(out: &mut Vec<u8>, group: &[Problem], meta: &Meta) {
    let Some(&problem) = group.first() else {
        return;
    };
    let Problem { result, message } = problem;
    let tag = if problem.is_error() { "error" } else { "warning" };
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
    if let (Some(text), line @ 1..) = (&result.text, message.line) {
        let first = line.saturating_sub(2).max(1);
        let mut shown = lines(text, first, line + 1);
        // A blank line after it says nothing.
        if shown.len() as u32 > line - first + 1 && shown.last().is_some_and(|it| it.trim_ascii().is_empty()) {
            shown.pop();
        }
        if shown.iter().all(|line| line.len() <= 1000) && !shown.is_empty() {
            out.extend_from_slice(b"<source>\n");
            let gutter = bun_core::fmt::digit_count(first as usize + shown.len() - 1);
            for (number, text) in (first..).zip(&shown) {
                let text = strings::replace_owned(text, b"\t", b" ");
                let _ = writeln!(out, "{number:>gutter$} | {}", BStr::new(text.trim_ascii_end()));
                if number == line {
                    let from = message.column.saturating_sub(1) as usize;
                    let to = match message.end {
                        Some((end_line, end_column)) if end_line == line => end_column.saturating_sub(1) as usize,
                        _ => text.len(),
                    };
                    let _ = writeln!(out, "{:1$}{2}", "", gutter + 3 + from, "^".repeat(to.saturating_sub(from).max(1)));
                }
            }
            out.extend_from_slice(b"</source>\n");
        }
    }
    for suggestion in &message.suggestions {
        let _ = writeln!(out, "<suggestion>{}</suggestion>", BStr::new(&suggestion.message));
    }
    if group.len() > 1 {
        const MAX_LOCATIONS: usize = 10;
        out.extend_from_slice(b"<also>");
        for (i, other) in group[1..].iter().take(MAX_LOCATIONS).enumerate() {
            let path = display_path(&other.result.path, meta.cwd);
            let space = if i > 0 { " " } else { "" };
            let _ = write!(out, "{space}{}:{}:{}", BStr::new(&path), other.message.line, other.message.column);
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
    if problems.len() <= GROUP_THRESHOLD || meta.shows_all {
        problems.iter().for_each(|problem| write_agent_problem(out, std::slice::from_ref(problem), meta));
    } else {
        let groups = grouped(&problems);
        let shown = groups.len().min(MAX_GROUPS + MAX_COMPACT_GROUPS);
        groups[..shown].iter().for_each(|group| write_agent_problem(out, group, meta));
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
        let path = if paths::is_absolute(&result.path) { paths::relative(from, &result.path) } else { result.path.clone() };
        let (end_line, end_column) = message.end.unwrap_or((message.line, message.column));
        let _ = write!(
            out,
            "::{} file={},line={},col={},endLine={end_line},endColumn={end_column},title={}::",
            if problem.is_error() { "error" } else { "warning" },
            bun_core::fmt::github_action_property(&path),
            message.line.max(1),
            message.column.max(1),
            bun_core::fmt::github_action_property(&match problem.rule() {
                rule if rule.is_empty() => b"bun lint".to_vec(),
                rule => rule,
            }),
        );
        let text = strings::replace_owned(&strings::replace_owned(&message.message, b"%", b"%25"), b"\r", b"%0D");
        out.extend_from_slice(&strings::replace_owned(&text, b"\n", b"%0A"));
    }
}
