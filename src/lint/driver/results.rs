//! What is reported about a file: ESLint's `LintResult`.

use bun_lint::context::Severity;
use bun_lint::linter::{LintMessage, ResolvedConfig};
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

pub(crate) struct FileResult {
    /// As it is printed: absolute, or `<text>`.
    pub(crate) path: Vec<u8>,
    pub(crate) messages: Vec<LintMessage>,
    pub(crate) suppressed: Vec<LintMessage>,
    /// What ESLint throws while it lints the file. Nothing is printed but this.
    pub(crate) thrown: Option<Vec<u8>>,
    /// It was linted with types.
    pub(crate) had_types: bool,
    pub(crate) counts: Counts,
    /// The text that the messages are about: that of the file, or `output` if there is one. Kept
    /// only if there is something to say about the file, and the format reads it.
    pub(crate) text: Option<Vec<u8>>,
    /// The text has been changed by fixes: `text` is ESLint's `output`.
    pub(crate) is_fixed: bool,
    /// `text` is ESLint's `source`.
    pub(crate) has_source: bool,
    /// ESLint's `createIgnoreResult`: the file is not linted, and the only message says why.
    pub(crate) is_ignored: bool,
    /// `None` for a file that is not linted.
    pub(crate) config: Option<Arc<ResolvedConfig>>,
}

impl FileResult {
    /// ESLint's `createIgnoreResult`.
    pub(crate) fn ignored(path: Vec<u8>, message: &[u8]) -> FileResult {
        let messages = vec![LintMessage {
            rule_id: None,
            severity: Severity::Warn,
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
            is_fixed: false,
            has_source: false,
            is_ignored: true,
            config: None,
        }
    }

    /// ESLint's `getErrorResults` for one result: what `--quiet` leaves of it.
    pub(crate) fn keep_errors_only(&mut self) {
        self.messages.retain(|it| it.severity == Severity::Error);
        self.suppressed.retain(|it| it.severity == Severity::Error);
        self.counts.errors = self.messages.len();
        self.counts.warnings = 0;
        self.counts.fixable_warnings = 0;
    }
}
