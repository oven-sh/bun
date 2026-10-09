//! What a run says to people that is not a problem in a file, and what oxlint calls `default`. ESLint's flavour has the former on
//! standard error. oxlint writes nothing there, so its `default` is `pretty` with all of it after the problems.

use super::{Format, Meta, excerpt};
use crate::results::{Counts, FileResult};
use bstr::BStr;
use bun_lint::linter::{Details, LintMessage};
use std::io::Write;

macro_rules! pretty {
    ($($arg:tt)*) => {
        let _ = bun_core::write_pretty!($($arg)*);
    };
}

const NO_FILES: &[u8] = b"No files found to lint. Please check your paths and ignore patterns.";

pub(crate) fn write_error(out: &mut Vec<u8>, colors: bool, text: &[u8]) {
    pretty!(out, colors, "<red>error<r><d>:<r> {}\n", BStr::new(text));
}

pub(crate) fn too_many_warnings(most: i64) -> Vec<u8> {
    format!("Found too many warnings (maximum: {most}).").into_bytes()
}

/// The last line. `fixed`: how many files were written.
pub(crate) fn write(
    out: &mut Vec<u8>,
    colors: bool,
    found: Counts,
    files: usize,
    fixed: usize,
    ms: f64,
) {
    let took = bun_core::output::Elapsed { colors, ms };
    let noun = if files == 1 { "file" } else { "files" };
    let fixed = if fixed > 0 {
        format!(", fixed {fixed}")
    } else {
        String::new()
    };
    if found.errors + found.warnings == 0 {
        pretty!(
            out,
            colors,
            "<green>\u{2713}<r> No problems<d> in {} {}{} {}<r>\n",
            files,
            noun,
            fixed,
            took
        );
    } else {
        pretty!(
            out,
            colors,
            "<d>Linted {} {}{} {}<r>\n",
            files,
            noun,
            fixed,
            took
        );
    }
}

/// With the end of the last line. It is never empty: oxlint's ends with two lines also when there is no problem, or `--silent`.
pub(super) fn write_default(out: &mut Vec<u8>, results: &[FileResult], meta: &Meta) {
    excerpt::write_pretty(out, results, meta);
    if !out.is_empty() {
        out.push(b'\n');
    }
    if let Some((most, _)) = meta.max_warnings_exceeded {
        write_error(out, meta.color, &too_many_warnings(most));
    }
    let run = &meta.run;
    write(
        out,
        meta.color,
        meta.found,
        run.files,
        meta.fixed,
        run.seconds * 1000.0,
    );
}

/// All that oxlint prints when it has found no file to lint. It asks no format for the problems then, so there is no document
/// without problems, only what a format prints at the very end of a run. `is_error`: not `--no-error-on-unmatched-pattern`.
pub(crate) fn without_files(format: Format, meta: &Meta, is_error: bool) -> Vec<u8> {
    let mut out = Vec::new();
    if is_error && format == Format::OxlintDefault {
        write_error(&mut out, meta.color, NO_FILES);
        return out;
    }
    if is_error {
        out.extend_from_slice(NO_FILES);
        out.push(b'\n');
    }
    if matches!(
        format,
        Format::OxlintDefault | Format::OxlintGithub | Format::OxlintJson
    ) {
        out.append(&mut super::format(format, &[], meta));
    }
    out
}

/// What oxlint reports about `oxlint-suppressions.json`: errors of no rule, at no place, in a file without a name.
pub(crate) fn about_suppressions(has_unused: bool, has_new: bool) -> Option<FileResult> {
    let error = |text: &[u8], help: &'static str| LintMessage {
        message: text.to_vec(),
        details: Some(Box::new(Details {
            help: help.into(),
            ..Details::default()
        })),
        ..LintMessage::default()
    };
    let unused = has_unused.then(|| {
        error(
            b"There are suppressions that do not occur anymore.",
            "Run `oxlint --prune-suppressions` to remove unused suppressions.",
        )
    });
    let new = has_new.then(|| {
        error(
            b"There are new violations not covered by the suppressions file.",
            "Run `oxlint --suppress-all` to update the suppressions file.",
        )
    });
    let messages: Vec<LintMessage> = unused.into_iter().chain(new).collect();
    (!messages.is_empty()).then(|| FileResult {
        path: Vec::new(),
        counts: Counts::of(&messages),
        messages,
        suppressed: Vec::new(),
        thrown: None,
        had_types: false,
        text: None,
        is_fixed: false,
        fixed_text: None,
        linted: None,
        deprecated: None,
    })
}
