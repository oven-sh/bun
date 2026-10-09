//! `checkstyle` and `junit`.

use super::Meta;
use super::info::Source;
use super::oxlint::{code, file_name, is_error};
use crate::results::FileResult;
use std::io::Write;

/// What is printed of a problem.
struct Problem<'a> {
    line: usize,
    column: usize,
    message: &'a [u8],
    /// `eslint(no-debugger)`, or nothing.
    code: Vec<u8>,
    is_error: bool,
    /// oxlint's `checkstyle` calls an error without a place a warning.
    is_error_in_checkstyle: bool,
}

/// The problems of a file, printed.
#[derive(Default)]
struct File {
    name: Vec<u8>,
    problems: Vec<u8>,
    all: usize,
    errors: usize,
}

/// The files that have problems. `write_problem` prints one problem.
///
/// `is_oxlint`: names, places and texts are those of oxlint's `Info`, so all that has no place is in one file without a name.
/// The files are sorted by name, as its `junit` sorts them.
fn group(
    results: &[FileResult],
    meta: &Meta,
    is_oxlint: bool,
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
        if is_oxlint {
            let source = Source::new(result, meta);
            for message in &result.messages {
                let info = source.info(message);
                let problem = Problem {
                    line: info.start.line,
                    column: info.start.column,
                    message: info.message,
                    code: info.code.unwrap_or_default(),
                    is_error: is_error(message),
                    is_error_in_checkstyle: info.is_error,
                };
                add(info.filename, &problem);
            }
        } else {
            let name = file_name(result, meta);
            for message in &result.messages {
                let problem = Problem {
                    line: message.line as usize,
                    column: message.column as usize,
                    message: &message.message,
                    code: code(message).unwrap_or_default(),
                    is_error: is_error(message),
                    is_error_in_checkstyle: is_error(message),
                };
                add(&name, &problem);
            }
        }
        if file.all > 0 {
            files.push(file);
        }
    }
    if nameless.all > 0 {
        files.push(nameless);
    }
    if is_oxlint {
        bun_lint::utils::sort::sort_by(&mut files, |a, b| a.name.cmp(&b.name));
    }
    files
}

/// Every value that goes into the document goes through here. oxlint prints the names of files and rules as they are, so that
/// a file called `a"><x y=".js` shapes its report.
fn write_xml_escaped(out: &mut Vec<u8>, text: &[u8]) {
    for byte in text {
        match byte {
            b'<' => out.extend_from_slice(b"&lt;"),
            b'>' => out.extend_from_slice(b"&gt;"),
            b'\'' => out.extend_from_slice(b"&apos;"),
            b'&' => out.extend_from_slice(b"&amp;"),
            b'"' => out.extend_from_slice(b"&quot;"),
            byte => out.push(*byte),
        }
    }
}

/// `is_oxlint`: the configuration is oxlint's.
pub(super) fn write_checkstyle(
    out: &mut Vec<u8>,
    results: &[FileResult],
    meta: &Meta,
    is_oxlint: bool,
) {
    let files = group(results, meta, is_oxlint, &|out, problem| {
        let severity = if problem.is_error_in_checkstyle {
            "error"
        } else {
            "warning"
        };
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

/// `is_oxlint`: the configuration is oxlint's.
pub(super) fn write_junit(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta, is_oxlint: bool) {
    let files = group(results, meta, is_oxlint, &|out, problem| {
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
    let _ = write!(
        out,
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<testsuites name=\"Oxlint\" tests=\"{all}\" failures=\"{}\" errors=\"{errors}\">\n",
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
