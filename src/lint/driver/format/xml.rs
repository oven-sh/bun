//! `checkstyle` and `junit`.

use super::Meta;
use super::info::Source;
use crate::results::FileResult;
use bun_core::strings::xml_escape_entity;
use std::io::Write;

/// The parts of a problem that get printed.
struct Problem<'a> {
    line: usize,
    column: usize,
    message: &'a [u8],
    /// `eslint(no-debugger)`, or nothing.
    code: Vec<u8>,
    is_error: bool,
}

/// A file's problems, already printed.
#[derive(Default)]
struct File {
    name: Vec<u8>,
    problems: Vec<u8>,
    all: usize,
    errors: usize,
}

/// Returns the files that have problems. `write_problem` prints one problem.
///
/// Names, locations and texts come from oxlint's `Info`, so everything without a location ends up in one file without a
/// name. The files are sorted by name, like in oxlint's `junit`.
fn group(
    results: &[FileResult],
    meta: &Meta,
    write_problem: &dyn Fn(&mut Vec<u8>, &Problem),
) -> Vec<File> {
    let mut files = Vec::new();
    let mut nameless = File::default();
    for result in results.iter().filter(|it| !it.messages.is_empty()) {
        let mut file = File::default();
        let mut add = |name: &[u8], problem: &Problem| {
            let to = if name.is_empty() {
                &mut nameless
            } else {
                &mut file
            };
            if to.all == 0 {
                to.name = name.to_vec();
            }
            to.all += 1;
            to.errors += usize::from(problem.is_error);
            write_problem(&mut to.problems, problem);
        };
        let source = Source::new(result, meta);
        for message in &result.messages {
            let info = source.info(message);
            let problem = Problem {
                line: info.start.line,
                column: info.start.column,
                message: info.message,
                code: info.code.unwrap_or_default(),
                is_error: info.is_error,
            };
            add(info.filename, &problem);
        }
        if file.all > 0 {
            files.push(file);
        }
    }
    if nameless.all > 0 {
        files.push(nameless);
    }
    bun_lint::utils::sort::sort_by(&mut files, |a, b| a.name.cmp(&b.name));
    files
}

/// Every value in the document is escaped here. oxlint prints file and rule names unescaped, so a file named
/// `a"><x y=".js` can change the structure of its report.
fn write_xml_escaped(out: &mut Vec<u8>, text: &[u8]) {
    for &byte in text {
        match xml_escape_entity(byte) {
            Some(entity) => out.extend_from_slice(entity),
            None => out.push(byte),
        }
    }
}

pub(super) fn write_checkstyle(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    let files = group(results, meta, &|out, problem| {
        let severity = if problem.is_error { "error" } else { "warning" };
        let _ = write!(
            out,
            "<error line=\"{}\" column=\"{}\" severity=\"{severity}\" message=\"",
            problem.line, problem.column
        );
        write_xml_escaped(out, problem.message);
        out.extend_from_slice(b"\" source=\"");
        write_xml_escaped(out, &problem.code);
        out.extend_from_slice(b"\" />");
    });
    out.extend_from_slice(
        b"<?xml version=\"1.0\" encoding=\"utf-8\"?><checkstyle version=\"4.3\">",
    );
    for (i, file) in files.iter().enumerate() {
        out.extend_from_slice(if i > 0 {
            b" <file name=\""
        } else {
            b"<file name=\""
        });
        write_xml_escaped(out, &file.name);
        out.extend_from_slice(b"\">");
        out.extend_from_slice(&file.problems);
        out.extend_from_slice(b"</file>");
    }
    out.extend_from_slice(b"</checkstyle>\n");
}

pub(super) fn write_junit(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    let files = group(results, meta, &|out, problem| {
        let tag = if problem.is_error { "error" } else { "failure" };
        out.extend_from_slice(b"\n        <testcase name=\"");
        write_xml_escaped(out, &problem.code);
        let _ = write!(out, "\">\n            <{tag} message=\"");
        write_xml_escaped(out, problem.message);
        let _ = write!(out, "\">line {}, column {}, ", problem.line, problem.column);
        write_xml_escaped(out, problem.message);
        let _ = write!(out, "</{tag}>\n        </testcase>");
    });
    let all: usize = files.iter().map(|it| it.all).sum();
    let errors: usize = files.iter().map(|it| it.errors).sum();
    let name = if meta.is_oxlint { "Oxlint" } else { "bun lint" };
    let _ = write!(
        out,
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<testsuites name=\"{name}\" tests=\"{all}\" failures=\"{}\" errors=\"{errors}\">\n",
        all - errors,
    );
    for (i, file) in files.iter().enumerate() {
        out.extend_from_slice(if i > 0 {
            b"\n    <testsuite name=\""
        } else {
            b"    <testsuite name=\""
        });
        write_xml_escaped(out, &file.name);
        let (all, errors) = (file.all, file.errors);
        let _ = write!(
            out,
            "\" tests=\"{all}\" disabled=\"0\" errors=\"{errors}\" failures=\"{}\">",
            all - errors
        );
        out.extend_from_slice(&file.problems);
        out.extend_from_slice(b"\n    </testsuite>");
    }
    out.extend_from_slice(b"\n</testsuites>\n");
}
