//! Shows a [`Report`].
//!
//! For a person at a terminal: the lines of source around each error with what is wrong underlined, as Bun shows its own errors.
//! For everything else: TypeScript's plain format, which editors, continuous integration and other tools already read.

use crate::{Category, Diagnostic, Report};
use bun_core::output::ansi::{BLUE, BOLD, CYAN, DIM, GREEN, RED, RESET, YELLOW};
use std::fmt::Write;
use std::time::Duration;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Layout {
    /// Source lines, underlines and a summary.
    Pretty,
    /// `file(line,column): error TS1234: message`, as `tsc --pretty false` prints it.
    Plain,
    /// A tag for each error with the source around it inside, so that whoever reads it does not have to open the file.
    Agent,
}

#[derive(Copy, Clone)]
pub struct Style<'a> {
    pub layout: Layout,
    pub color: bool,
    /// What paths are shown relative to, as the checker names it.
    pub cwd: &'a str,
    /// Also print `::error` workflow commands, which GitHub Actions turns into annotations.
    pub github_annotations: bool,
}

/// `ConvertToRelativePath`
pub fn relative_path(path: &str, cwd: &str) -> String {
    let (mut from, mut to) = (
        cwd.split('/').filter(|p| !p.is_empty()).peekable(),
        path.split('/').filter(|p| !p.is_empty()).peekable(),
    );
    // On Windows what is on another drive has no relative path.
    if cfg!(windows) && from.peek() != to.peek() {
        return crate::host::to_native(path).to_string();
    }
    while from.peek().is_some() && from.peek() == to.peek() {
        from.next();
        to.next();
    }
    let mut out: Vec<&str> = from.map(|_| "..").collect();
    out.extend(to);
    out.join("/")
}

struct Paint {
    on: bool,
}

impl Paint {
    fn put(&self, out: &mut String, codes: &[&str], text: &str) {
        if !self.on || text.is_empty() {
            out.push_str(text);
            return;
        }
        for code in codes {
            out.push_str(code);
        }
        out.push_str(text);
        out.push_str(RESET);
    }
}

fn category_color(category: Category) -> &'static str {
    match category {
        Category::Error => RED,
        Category::Warning => YELLOW,
        Category::Suggestion => DIM,
        Category::Message => BLUE,
    }
}

/// `1234` as `1,234`.
fn with_commas(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

fn duration(d: Duration) -> String {
    let ms = d.as_secs_f64() * 1000.0;
    if ms < 1000.0 {
        format!("{ms:.0}ms")
    } else {
        format!("{:.2}s", ms / 1000.0)
    }
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{} {}", with_commas(n), if n == 1 { one } else { many })
}

/// How many columns of a terminal `text` takes up to its UTF-16 offset `units`. Tabs have been made spaces by then.
fn columns_before(text: &str, units: u32) -> usize {
    let mut seen = 0;
    let mut columns = 0;
    for c in text.chars() {
        if seen >= units {
            break;
        }
        seen += c.len_utf16() as u32;
        columns += 1;
    }
    columns
}

/// The lines the error is on with what is wrong underlined, and up to `before` lines before and `after` lines after them.
fn write_source(out: &mut String, d: &Diagnostic, paint: &Paint, before: usize, after: usize) {
    if d.source.is_empty() {
        return;
    }
    let first_error_index = (d.line - d.source_line) as usize;
    let error_lines = (d.end_line - d.line) as usize + 1;
    let is_blank = |i: usize| d.source[i].trim().is_empty();
    // Blank lines at either end show nothing.
    let first_shown = (first_error_index.saturating_sub(before)..first_error_index)
        .find(|&i| !is_blank(i))
        .unwrap_or(first_error_index);
    let after_error = first_error_index + error_lines;
    let end_shown = (after_error..d.source.len().min(after_error + after))
        .rev()
        .find(|&i| !is_blank(i))
        .map_or(after_error, |i| i + 1)
        .min(d.source.len());
    let gutter = (d.source_line as usize + end_shown - 1).to_string().len();
    for (i, line) in d
        .source
        .iter()
        .enumerate()
        .take(end_shown)
        .skip(first_shown)
    {
        let in_error = i >= first_error_index && i < after_error;
        let nth = i.wrapping_sub(first_error_index);
        // Of an error that goes over five lines or more, the first two and the last two.
        if in_error && error_lines >= 5 && nth >= 2 && nth < error_lines - 2 {
            if nth == 2 {
                paint.put(out, &[DIM], &format!("{:>gutter$} |", "..."));
                out.push('\n');
            }
            continue;
        }
        let line = line.replace('\t', " ");
        let line = line.trim_end();
        let number = format!("{:>gutter$} | ", d.source_line as usize + i);
        paint.put(out, &[if in_error { BOLD } else { DIM }], &number);
        let _ = write!(
            out,
            "{}",
            bun_core::fmt::fmt_javascript(
                line.as_bytes(),
                bun_core::fmt::HighlighterOptions {
                    enable_colors: paint.on,
                    ..Default::default()
                },
            )
        );
        out.push('\n');
        if !in_error {
            continue;
        }
        let width = line.chars().count();
        let from = if nth == 0 {
            columns_before(line, d.column - 1)
        } else {
            line.chars().take_while(|c| c.is_whitespace()).count()
        };
        let to = if nth + 1 == error_lines {
            columns_before(line, d.end_column - 1)
        } else {
            width
        };
        // An error without a length points at one character.
        let carets = to.saturating_sub(from).max(usize::from(error_lines == 1));
        if carets == 0 {
            continue;
        }
        for _ in 0..gutter + 3 + from {
            out.push(' ');
        }
        paint.put(
            out,
            &[BOLD, category_color(d.category)],
            &"^".repeat(carets),
        );
        out.push('\n');
    }
}

fn write_location(out: &mut String, d: &Diagnostic, style: &Style, paint: &Paint) {
    paint.put(out, &[CYAN], &relative_path(&d.path, style.cwd));
    paint.put(out, &[DIM], ":");
    paint.put(out, &[YELLOW], &d.line.to_string());
    paint.put(out, &[DIM], ":");
    paint.put(out, &[YELLOW], &d.column.to_string());
}

fn write_pretty(out: &mut String, d: &Diagnostic, style: &Style, paint: &Paint) {
    write_source(out, d, paint, 2, 0);
    paint.put(out, &[category_color(d.category)], d.category.name());
    // What is Bun's own to say has no code.
    match d.code {
        0 => paint.put(out, &[DIM], ": "),
        code => paint.put(out, &[DIM], &format!(" TS{code}: ")),
    }
    let mut lines = d.text.split('\n');
    paint.put(out, &[BOLD], lines.next().unwrap_or(""));
    out.push('\n');
    for reason in lines {
        out.push_str("  ");
        out.push_str(reason);
        out.push('\n');
    }
    if !d.path.is_empty() {
        out.push_str("    ");
        paint.put(out, &[DIM], "at ");
        write_location(out, d, style, paint);
        out.push('\n');
    }
}

/// `WriteFormatDiagnostic`
fn write_plain(out: &mut String, d: &Diagnostic, style: &Style) {
    if !d.path.is_empty() {
        let _ = write!(
            out,
            "{}({},{}): ",
            relative_path(&d.path, style.cwd),
            d.line,
            d.column
        );
    }
    match d.code {
        0 => {
            let _ = writeln!(out, "{}: {}", d.category.name(), d.text);
        }
        code => {
            let _ = writeln!(out, "{} TS{code}: {}", d.category.name(), d.text);
        }
    }
}

/// What is between the quotes of an attribute.
fn attribute(text: &str) -> String {
    text.replace('&', "&amp;").replace('"', "&quot;")
}

fn write_agent(out: &mut String, d: &Diagnostic, style: &Style) {
    let _ = write!(out, "<{}", d.category.name());
    if !d.path.is_empty() {
        let _ = write!(
            out,
            " file=\"{}\" line=\"{}\" column=\"{}\"",
            attribute(&relative_path(&d.path, style.cwd)),
            d.line,
            d.column
        );
    }
    if d.code != 0 {
        let _ = write!(out, " code=\"TS{}\"", d.code);
    }
    out.push_str(">\n");
    out.push_str(&d.text);
    out.push('\n');
    if !d.source.is_empty() {
        out.push_str("<source>\n");
        write_source(out, d, &Paint { on: false }, 3, 2);
        out.push_str("</source>\n");
    }
    let _ = writeln!(out, "</{}>", d.category.name());
}

/// The data of a workflow command: `%`, carriage returns and line feeds are escaped, and in a property `:` and `,` too.
fn github_escape(text: &str, is_property: bool) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '%' => out.push_str("%25"),
            '\r' => out.push_str("%0D"),
            '\n' => out.push_str("%0A"),
            ':' if is_property => out.push_str("%3A"),
            ',' if is_property => out.push_str("%2C"),
            c => out.push(c),
        }
    }
    out
}

fn write_github_annotation(out: &mut String, d: &Diagnostic, style: &Style) {
    let level = match d.category {
        Category::Error => "error",
        Category::Warning => "warning",
        Category::Suggestion | Category::Message => "notice",
    };
    let _ = write!(out, "::{level} ");
    if !d.path.is_empty() {
        let _ = write!(
            out,
            "file={},line={},col={},endLine={},endColumn={},",
            github_escape(&relative_path(&d.path, style.cwd), true),
            d.line,
            d.column,
            d.end_line,
            d.end_column
        );
    }
    let _ = writeln!(out, "title=TS{}::{}", d.code, github_escape(&d.text, false));
}

/// The errors, one after the other.
pub fn write_diagnostics(out: &mut String, report: &Report, style: &Style) {
    let paint = Paint { on: style.color };
    for d in &report.diagnostics {
        match style.layout {
            Layout::Pretty => {
                write_pretty(out, d, style, &paint);
                out.push('\n');
            }
            Layout::Plain => write_plain(out, d, style),
            Layout::Agent => write_agent(out, d, style),
        }
    }
    if style.github_annotations {
        for d in &report.diagnostics {
            write_github_annotation(out, d, style);
        }
    }
}

/// How it went, in a line or a few.
pub fn write_summary(out: &mut String, report: &Report, style: &Style) {
    let paint = Paint { on: style.color };
    for path in &report.gave_up {
        paint.put(out, &[YELLOW], "warning");
        paint.put(out, &[DIM], ": ");
        let _ = writeln!(
            out,
            "gave up on {}, which took too long to check. This is a bug in Bun: nothing is reported for this file.",
            relative_path(path, style.cwd)
        );
    }
    let errors = report.error_count();
    let took = format!(" [{}]", duration(report.load_time + report.check_time));
    if errors == 0 {
        paint.put(out, &[GREEN], "\u{2713}");
        out.push_str(" No type errors");
        paint.put(
            out,
            &[DIM],
            &format!(
                " in {}{took}",
                plural(report.files_checked, "file", "files")
            ),
        );
        out.push('\n');
        return;
    }
    // In the order the errors are in: by path.
    let mut by_file: Vec<(&Diagnostic, usize)> = Vec::new();
    for d in &report.diagnostics {
        if d.category != Category::Error || d.path.is_empty() {
            continue;
        }
        match by_file.last_mut() {
            Some((first, count)) if first.path == d.path => *count += 1,
            _ => by_file.push((d, 1)),
        }
    }
    paint.put(
        out,
        &[BOLD, RED],
        &format!("Found {}", plural(errors, "error", "errors")),
    );
    if !by_file.is_empty() {
        let _ = write!(out, " in {}", plural(by_file.len(), "file", "files"));
    }
    paint.put(
        out,
        &[DIM],
        &format!(
            ", checked {}{took}",
            plural(report.files_checked, "file", "files")
        ),
    );
    out.push('\n');
    if by_file.len() < 2 {
        return;
    }
    out.push('\n');
    let width = by_file
        .iter()
        .map(|(_, count)| with_commas(*count).len())
        .max()
        .unwrap_or(1);
    for (first, count) in by_file {
        let _ = write!(out, "  {:>width$}  ", with_commas(count));
        paint.put(out, &[CYAN], &relative_path(&first.path, style.cwd));
        paint.put(out, &[DIM], &format!(":{}", first.line));
        out.push('\n');
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths() {
        assert_eq!(relative_path("/a/b/c.ts", "/a/b"), "c.ts");
        assert_eq!(relative_path("/a/b/d/c.ts", "/a/b"), "d/c.ts");
        assert_eq!(relative_path("/a/x/c.ts", "/a/b"), "../x/c.ts");
        assert_eq!(relative_path("/x/c.ts", "/a/b"), "../../x/c.ts");
    }

    #[test]
    fn numbers() {
        assert_eq!(with_commas(7), "7");
        assert_eq!(with_commas(1234), "1,234");
        assert_eq!(with_commas(1234567), "1,234,567");
        assert_eq!(duration(Duration::from_millis(412)), "412ms");
        assert_eq!(duration(Duration::from_millis(2412)), "2.41s");
    }

    #[test]
    fn workflow_commands_are_escaped() {
        assert_eq!(github_escape("a%b\nc:d,e", false), "a%25b%0Ac:d,e");
        assert_eq!(github_escape("a:b,c", true), "a%3Ab%2Cc");
    }
}
