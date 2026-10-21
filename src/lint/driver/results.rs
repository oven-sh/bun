//! The report for one file: ESLint's `LintResult`.

use bun_lint::context::Severity;
use bun_lint::linter::{LintMessage, ResolvedConfig};
use bun_lint::source::LineStarts;
use std::sync::Arc;

/// ESLint's `calculateStatsPerFile`.
#[derive(Copy, Clone, Default, PartialEq, Eq, Debug)]
pub(crate) struct Counts {
    pub(crate) errors: usize,
    pub(crate) fatal_errors: usize,
    pub(crate) warnings: usize,
    pub(crate) fixable_errors: usize,
    pub(crate) fixable_warnings: usize,
}

impl Counts {
    pub(crate) fn of(messages: &[LintMessage]) -> Counts {
        let mut counts = Counts::default();
        for message in messages {
            let is_fixable = usize::from(message.fix.is_some());
            if message.is_fatal || message.severity == Severity::Error {
                counts.errors += 1;
                counts.fatal_errors += usize::from(message.is_fatal);
                counts.fixable_errors += is_fixable;
            } else {
                counts.warnings += 1;
                counts.fixable_warnings += is_fixable;
            }
        }
        counts
    }

    pub(crate) fn add(&mut self, other: Counts) {
        self.errors += other.errors;
        self.fatal_errors += other.fatal_errors;
        self.warnings += other.warnings;
        self.fixable_errors += other.fixable_errors;
        self.fixable_warnings += other.fixable_warnings;
    }
}

/// Extra state for a file that was linted.
pub(crate) struct Linted {
    pub(crate) config: Arc<ResolvedConfig>,
    /// [`FileResult::text`] is ESLint's `source`.
    pub(crate) has_source: bool,
}

pub(crate) struct FileResult {
    /// The path as printed: absolute, or `<text>`.
    pub(crate) path: Vec<u8>,
    pub(crate) messages: Vec<LintMessage>,
    pub(crate) suppressed: Vec<LintMessage>,
    /// The error ESLint throws while linting the file. If set, nothing else is printed.
    pub(crate) thrown: Option<Vec<u8>>,
    /// True if it was linted with types.
    pub(crate) had_types: bool,
    pub(crate) counts: Counts,
    /// The text the messages refer to: the file's, or `output` if there is one. Only kept if there's something to
    /// report about the file and the format reads it.
    pub(crate) text: Option<Vec<u8>>,
    /// The line starts of `text`, if they were computed during linting.
    pub(crate) line_starts: Option<Vec<u32>>,
    /// [`LintResult::run_keys`](bun_lint::linter::LintResult::run_keys), for when the file is linted again.
    pub(crate) run_keys: Vec<(u64, u128)>,
    /// Fixes changed the text, so `text` is ESLint's `output`.
    pub(crate) is_fixed: bool,
    /// Number of fixes applied.
    pub(crate) fixes: usize,
    /// The fixed text, if it isn't `text`. oxlint fixes once and reports the remaining problems at their original
    /// locations.
    pub(crate) fixed_text: Option<Vec<u8>>,
    /// `None` is ESLint's `createIgnoreResult`: the file isn't linted, and the only message explains why.
    pub(crate) linted: Option<Linted>,
    /// ESLint's `usedDeprecatedRules` as JSON, if ESLint itself linted the file.
    pub(crate) deprecated: Option<Vec<u8>>,
}

impl FileResult {
    /// Returns the line starts of `text`, using the line breaks of the file's language.
    pub(crate) fn lines(&self) -> LineStarts {
        if let Some(starts) = &self.line_starts {
            return LineStarts::at(starts.clone());
        }
        let config = self.linted.as_ref().map(|it| &it.config);
        let breaks = config.map_or_else(Default::default, |it| it.line_breaks);
        breaks.line_starts(self.text.as_deref().unwrap_or_default())
    }

    /// ESLint's `createIgnoreResult`.
    pub(crate) fn ignored(path: Vec<u8>, message: &[u8]) -> FileResult {
        FileResult::about(path, Severity::Warn, message)
    }

    /// oxlint's error for the file at `path`, which it can't open. It then continues with the next file. `error` is
    /// formatted like Rust prints it. For oxlint the problem belongs to no file, so `belongs_to_file` is false.
    pub(crate) fn unopened(path: Vec<u8>, error: &[u8], belongs_to_file: bool) -> FileResult {
        let start: &[u8] = b"Failed to open file ";
        let message = [start, &path, b" with error \"", error, b"\""].concat();
        let path = if belongs_to_file { path } else { Vec::new() };
        FileResult::about(path, Severity::Error, &message)
    }

    /// A problem with no rule and no location, about the file at `path`, which isn't linted.
    fn about(path: Vec<u8>, severity: Severity, message: &[u8]) -> FileResult {
        let messages = vec![LintMessage {
            rule_id: None,
            severity,
            message: message.to_vec(),
            message_id: None,
            line: 0,
            column: 0,
            end: None,
            is_fatal: false,
            fix: None,
            suggestions: Vec::new(),
            suppressions: Vec::new(),
            ..LintMessage::default()
        }];
        FileResult {
            path,
            counts: Counts::of(&messages),
            messages,
            suppressed: Vec::new(),
            thrown: None,
            had_types: false,
            text: None,
            line_starts: None,
            run_keys: Vec::new(),
            is_fixed: false,
            fixes: 0,
            fixed_text: None,
            linted: None,
            deprecated: None,
        }
    }

    /// The text that `--fix` writes.
    pub(crate) fn text_to_write(&self) -> Option<&[u8]> {
        self.fixed_text.as_deref().or(self.text.as_deref())
    }

    /// ESLint's `getErrorResults` for one result: drops everything that `--quiet` hides.
    pub(crate) fn keep_errors_only(&mut self) {
        self.messages.retain(|it| it.severity == Severity::Error);
        self.suppressed.retain(|it| it.severity == Severity::Error);
        self.counts.errors = self.messages.len();
        self.counts.warnings = 0;
        self.counts.fixable_warnings = 0;
    }
}
