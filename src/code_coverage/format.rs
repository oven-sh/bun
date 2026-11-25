//! Writing to a `Vec` cannot fail.

use std::io::Write;

use bun_core::fmt::{ItoaBuf, itoa};
use bun_core::printer::json_stringify;
use bun_core::strings::visible::width::exclude_ansi_colors::utf8 as width_of;
use bun_core::write_pretty;
use bun_options_types::code_coverage_options::Thresholds;

use crate::report::{Report, Summary, Total};

trait Part {
    fn put(&self, out: &mut Vec<u8>);
}

impl Part for &str {
    fn put(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(self.as_bytes());
    }
}

impl Part for u64 {
    fn put(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(itoa(&mut ItoaBuf::new(), *self));
    }
}

impl Part for usize {
    fn put(&self, out: &mut Vec<u8>) {
        (*self as u64).put(out);
    }
}

macro_rules! put {
    ($out:expr, $($part:expr),+) => {{ $(Part::put(&$part, $out);)+ }};
}

pub(crate) fn write_lcov(out: &mut Vec<u8>, name: &[u8], report: &Report<'_>, summary: &Summary) {
    put!(out, "TN:\nSF:");
    // Or a path could add records.
    out.extend(name.iter().map(|&it| match it {
        b'\n' | b'\r' => b'?',
        _ => it,
    }));
    for it in &report.functions {
        put!(out, "\nFN:", report.line_of(it.declaration.0), ",");
        out.extend_from_slice(&it.name);
    }
    put!(out, "\nFNF:", summary.functions.total);
    put!(out, "\nFNH:", summary.functions.covered);
    for it in &report.functions {
        put!(out, "\nFNDA:", it.body.count, ",");
        out.extend_from_slice(&it.name);
    }
    for (line, count) in report.lines() {
        put!(out, "\nDA:", line, ",", count);
    }
    put!(out, "\nLF:", summary.lines.total);
    put!(out, "\nLH:", summary.lines.covered);
    for (number, branch) in report.branches() {
        let line = report.line_of(branch.decision.0);
        for (index, arm) in branch.arms.iter().enumerate() {
            put!(
                out, "\nBRDA:", line, ",", number, ",", index, ",", arm.count
            );
        }
    }
    put!(out, "\nBRF:", summary.branches.total);
    put!(out, "\nBRH:", summary.branches.covered, "\nend_of_record\n");
}

fn write_range(out: &mut Vec<u8>, report: &Report<'_>, start: u32, end: u32) {
    if start == end {
        return put!(out, r#"{"start":{},"end":{}}"#);
    }
    for (key, offset) in [(r#"{"start":"#, start), (r#","end":"#, end)] {
        let (line, column) = report.positions.line_and_column_of(offset);
        put!(out, key, r#"{"line":"#, line + 1);
        put!(out, r#","column":"#, u64::from(column), "}");
    }
    put!(out, "}");
}

fn write_list<T>(
    out: &mut Vec<u8>,
    items: impl Iterator<Item = T>,
    write: &dyn Fn(&mut Vec<u8>, T),
) {
    for (index, item) in items.enumerate() {
        if index > 0 {
            put!(out, ",");
        }
        write(out, item);
    }
}

/// A member of Istanbul's `coverage-final.json`.
pub(crate) fn write_json(out: &mut Vec<u8>, path: &[u8], report: &Report<'_>) {
    let statements = || report.statements.iter().map(|it| it.1).enumerate();
    let functions = || report.functions.iter().enumerate();
    json_stringify(path, out);
    put!(out, r#": {"path":"#);
    json_stringify(path, out);
    put!(out, r#","statementMap":{"#);
    write_list(out, statements(), &|out, (number, it)| {
        put!(out, "\"", number, "\":");
        write_range(out, report, it.start, it.end);
    });
    put!(out, r#"},"fnMap":{"#);
    write_list(out, functions(), &|out, (number, it)| {
        put!(out, "\"", number, r#"":{"name":"#);
        json_stringify(&it.name, out);
        put!(out, r#","decl":"#);
        write_range(out, report, it.declaration.0, it.declaration.1);
        put!(out, r#","loc":"#);
        write_range(out, report, it.body.start, it.body.end);
        put!(out, r#","line":"#, report.line_of(it.body.start), "}");
    });
    put!(out, r#"},"branchMap":{"#);
    write_list(out, report.branches(), &|out, (number, it)| {
        put!(out, "\"", number, r#"":{"loc":"#);
        write_range(out, report, it.decision.0, it.decision.1);
        put!(out, r#","type":""#, it.kind, r#"","locations":["#);
        write_list(out, it.arms.iter(), &|out, arm| {
            write_range(out, report, arm.start, arm.end);
        });
        put!(out, r#"],"line":"#, report.line_of(it.decision.0), "}");
    });
    put!(out, r#"},"s":{"#);
    write_list(out, statements(), &|out, (number, it)| {
        put!(out, "\"", number, "\":", it.count);
    });
    put!(out, r#"},"f":{"#);
    write_list(out, functions(), &|out, (number, it)| {
        put!(out, "\"", number, "\":", it.body.count);
    });
    put!(out, r#"},"b":{"#);
    write_list(out, report.branches(), &|out, (number, it)| {
        put!(out, "\"", number, "\":[");
        write_list(out, it.arms.iter(), &|out, arm| put!(out, arm.count));
        put!(out, "]");
    });
    put!(out, "}}\n");
}

/// A member of Istanbul's `coverage-summary.json`. `of`: `None` if there are no files.
pub(crate) fn write_json_summary(out: &mut Vec<u8>, key: &[u8], of: Option<&Summary>) {
    json_stringify(key, out);
    put!(out, ": {");
    let metrics = metrics(&of.copied().unwrap_or_default(), &Thresholds::default());
    write_list(out, metrics.into_iter(), &|out, (name, it, _)| {
        put!(out, "\"", name, r#"":{"total":"#, it.total);
        put!(out, r#","covered":"#, it.covered, r#","skipped":0,"pct":"#);
        match of {
            Some(_) => _ = write!(out, "{}}}", it.percent()),
            None => put!(out, r#""Unknown"}"#),
        }
    });
    put!(out, "}\n");
}

/// In the order of the columns.
pub(crate) fn metrics(
    summary: &Summary,
    thresholds: &Thresholds,
) -> [(&'static str, Total, Option<f64>); 4] {
    [
        ("functions", summary.functions, thresholds.functions),
        ("lines", summary.lines, thresholds.lines),
        ("statements", summary.statements, thresholds.statements),
        ("branches", summary.branches, thresholds.branches),
    ]
}

/// The lines that did not run. If all did, those on which something did not.
pub(crate) fn write_uncovered_lines(out: &mut Vec<u8>, report: &Report<'_>, has_colors: bool) {
    let mut lines: Vec<usize> = (report.lines().filter(|it| it.1 == 0).map(|it| it.0)).collect();
    let have_all_run = lines.is_empty();
    if have_all_run {
        let parts = (report.branches.iter().flat_map(|it| &it.arms))
            .chain(report.statements.iter().map(|it| &it.1))
            .chain(report.functions.iter().map(|it| &it.body));
        lines.extend((parts.filter(|it| it.count == 0)).map(|it| report.line_of(it.start)));
        lines.sort_unstable();
    }
    for (index, range) in lines.chunk_by(|a, b| b - a <= 1).enumerate() {
        if index > 0 {
            let _ = write_pretty!(out, has_colors, "<r><d>,<r>");
        }
        let _ = match have_all_run {
            true => write_pretty!(out, has_colors, "<yellow>"),
            false => write_pretty!(out, has_colors, "<red>"),
        };
        match *range {
            [first, .., last] if first < last => put!(out, first, "-", last),
            _ => put!(out, range[0]),
        }
    }
}

pub(crate) struct Row {
    pub(crate) name: Box<[u8]>,
    pub(crate) summary: Summary,
    /// For the colors.
    pub(crate) thresholds: Thresholds,
    pub(crate) uncovered_lines: Vec<u8>,
}

pub(crate) struct Table {
    pub(crate) width_of_names: usize,
    pub(crate) has_colors: bool,
}

impl Table {
    pub(crate) const ALL_FILES: &'static [u8] = b"All files";

    pub(crate) fn write_rule(&self, out: &mut Vec<u8>) {
        let _ = write_pretty!(out, self.has_colors, "<r><d>");
        out.resize(out.len() + self.width_of_names + 2, b'-');
        let _ = write_pretty!(
            out,
            self.has_colors,
            "|---------|---------|---------|----------|-------------------<r>\n"
        );
    }

    /// `all`: `None` if there are no files.
    pub(crate) fn write_head(&self, out: &mut Vec<u8>, all: Option<&Summary>, by: &Thresholds) {
        self.write_rule(out);
        put!(out, "File");
        out.resize(out.len() + self.width_of_names - "File".len() + 1, b' ');
        let _ = write_pretty!(
            out,
            self.has_colors,
            " <d>|<r> % Funcs <d>|<r> % Lines <d>|<r> % Stmts <d>|<r> % Branch <d>|<r> Uncovered Line #s\n"
        );
        self.write_rule(out);
        self.write_numbers(out, "", Self::ALL_FILES, all, by);
        let _ = write_pretty!(out, self.has_colors, "<r><d> |<r>\n");
    }

    pub(crate) fn write_row(&self, out: &mut Vec<u8>, row: &Row) {
        self.write_numbers(out, " ", &row.name, Some(&row.summary), &row.thresholds);
        let _ = write_pretty!(out, self.has_colors, "<r><d> | <r>");
        out.extend_from_slice(&row.uncovered_lines);
    }

    fn write_color(&self, out: &mut Vec<u8>, is_low: bool) {
        let _ = match is_low {
            true => write_pretty!(out, self.has_colors, "<r><b><red>"),
            false => write_pretty!(out, self.has_colors, "<r><b><green>"),
        };
    }

    fn write_numbers(
        &self,
        out: &mut Vec<u8>,
        indent: &str,
        name: &[u8],
        of: Option<&Summary>,
        thresholds: &Thresholds,
    ) {
        let metrics = metrics(&of.copied().unwrap_or_default(), thresholds);
        let are_low = metrics.map(|(_, it, threshold)| it.misses(threshold.unwrap_or(0.9)));
        self.write_color(out, are_low != [false; 4]);
        put!(out, indent);
        out.extend_from_slice(name);
        let padding = self.width_of_names + 1 - indent.len() - width_of(name);
        out.resize(out.len() + padding, b' ');
        for (((_, it, _), is_low), width) in metrics.into_iter().zip(are_low).zip([7, 7, 7, 8]) {
            let percent = of.map_or(0.0, |_| it.percent());
            let _ = write_pretty!(out, self.has_colors, "<r><d> | ");
            self.write_color(out, is_low);
            let _ = write!(out, "{percent:>width$.2}");
        }
    }
}
