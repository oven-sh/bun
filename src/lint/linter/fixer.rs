//! Applies the fixes of messages: ESLint's `SourceCodeFixer.applyFixes` and `Linter.verifyAndFix`.

use super::{LintMessage, LintResult, RuleId};
use crate::context::Severity;

/// ESLint's `MAX_AUTOFIX_PASSES`.
pub const MAX_AUTOFIX_PASSES: usize = 10;

/// A text that fixes have made larger than this, and than [`MAX_GROWTH`] times what it was, is given up: see [`max_fixed_len`].
const MAX_FIXED_BYTES: usize = 64 << 20;
const MAX_GROWTH: usize = 64;

/// How large fixes can make a text of `original` bytes. To indent n things that are in each other takes room in proportion to
/// n², and each pass parses the whole of it: 87 KB of nested `if` become 370 MB. ESLint has no such limit.
pub fn max_fixed_len(original: usize) -> usize {
    MAX_FIXED_BYTES.max(original.saturating_mul(MAX_GROWTH))
}

/// What is said about a file of `original` bytes that fixes would make larger than [`max_fixed_len`]. It is reported with what
/// is wrong with the file as it is, which is not changed.
pub fn grows_too_much(original: usize) -> LintMessage {
    let size = |bytes: usize| match bytes {
        0..1024 => format!("{bytes} bytes"),
        1024..0x10_0000 => format!("{} KB", bytes >> 10),
        _ => format!("{} MB", bytes >> 20),
    };
    let (from, to) = (size(original), size(max_fixed_len(original)));
    LintMessage {
        severity: Severity::Warn,
        message: format!(
            "Fixes would grow this file from {from} to more than {to}. It is left as it is."
        )
        .into_bytes(),
        line: 1,
        column: 1,
        ..LintMessage::default()
    }
}

/// What [`apply_fixes`] returns.
pub struct Fixed {
    /// Whether any message had a fix that was to be applied.
    pub is_fixed: bool,
    pub output: Vec<u8>,
    /// The messages that are not fixed, sorted by position.
    pub remaining: Vec<LintMessage>,
    /// The rules whose fixes are in `output`.
    pub applied: Vec<RuleId>,
}

/// ESLint's `SourceCodeFixer.applyFixes`. A fix that overlaps or touches one that is applied before
/// it is left for the next pass. `should_fix`: ESLint's `fix` option as a function.
pub fn apply_fixes(
    text: &[u8],
    messages: Vec<LintMessage>,
    should_fix: &dyn Fn(&LintMessage) -> bool,
) -> Fixed {
    let (mut fixable, mut remaining): (Vec<_>, Vec<_>) =
        messages.into_iter().partition(|it| it.fix.is_some());
    if fixable.is_empty() {
        return Fixed {
            is_fixed: false,
            output: text.to_vec(),
            remaining,
            applied: Vec::new(),
        };
    }
    crate::utils::sort::sort_by_key(&mut fixable, |it| {
        it.fix.as_ref().map(|fix| (fix.span.start, fix.span.end))
    });
    let mut output = Vec::with_capacity(text.len());
    let mut last: Option<usize> = None;
    let mut is_fixed = false;
    let mut applied: Vec<RuleId> = Vec::new();
    for message in fixable {
        let Some(fix) = message.fix.as_ref().filter(|_| should_fix(&message)) else {
            remaining.push(message);
            continue;
        };
        is_fixed = true;
        let (start, end) = (fix.span.start as usize, fix.span.end as usize);
        if last.is_some_and(|last| last >= start) || start > end {
            remaining.push(message);
            continue;
        }
        // A range can go beyond the text, as for `String.prototype.slice`.
        output.extend_from_slice(&text[last.unwrap_or(0).min(text.len())..start.min(text.len())]);
        output.extend_from_slice(&fix.text);
        last = Some(end);
        if let Some(rule) = message.rule_id
            && !applied.contains(&rule)
        {
            applied.push(rule);
        }
    }
    output.extend_from_slice(&text[last.unwrap_or(0).min(text.len())..]);
    LintMessage::sort(&mut remaining);
    Fixed {
        is_fixed,
        output,
        remaining,
        applied,
    }
}

/// What [`verify_and_fix`] returns.
pub struct FixReport {
    /// Whether the text has changed.
    pub is_fixed: bool,
    pub output: Vec<u8>,
    /// What is left to report, about `output`.
    pub result: LintResult,
    /// The fixes undo each other, so fixing was given up. ESLint warns about it.
    pub is_circular: bool,
    /// The rules whose fixes, all in one pass, made a text that cannot be parsed. `output` is the text before that pass.
    pub broken_by: Option<Vec<RuleId>>,
}

fn is_fatal(result: &LintResult) -> bool {
    matches!(&result.messages[..], [only] if only.is_fatal)
}

/// What is reported if the fixes of a pass are taken back. `before`: the text before that pass. `was_fixed`: it is not the first text.
fn without_the_last_pass(
    before: Vec<u8>,
    (rules, was_fixed): (Vec<RuleId>, bool),
    lint: &mut dyn FnMut(&[u8]) -> LintResult,
) -> FixReport {
    FixReport {
        is_fixed: was_fixed,
        result: lint(&before),
        output: before,
        is_circular: false,
        broken_by: Some(rules),
    }
}

/// ESLint's `Linter.verifyAndFix`: lints and fixes until nothing is left to fix, ten times at most.
/// `lint` parses and lints the text that it is given. Unlike ESLint, it fixes nothing if the text [grows too much](max_fixed_len),
/// and takes back the fixes of a pass after which the text cannot be parsed.
pub fn verify_and_fix(
    text: &[u8],
    should_fix: &dyn Fn(&LintMessage) -> bool,
    lint: &mut dyn FnMut(&[u8]) -> LintResult,
) -> FixReport {
    let mut current = text.to_vec();
    let mut previous: Option<Vec<u8>> = None;
    let (mut is_fixed, mut is_circular) = (false, false);
    // The rules whose fixes the pass before has applied, and whether the text had changed before it.
    let mut last_pass: Option<(Vec<RuleId>, bool)> = None;
    let mut passes = 0;
    loop {
        passes += 1;
        let mut result = lint(&current);
        let is_fatal = is_fatal(&result);
        if is_fatal && let (Some(before), Some(pass)) = (previous.take(), last_pass.take()) {
            return without_the_last_pass(before, pass, lint);
        }
        let fixed = apply_fixes(&current, std::mem::take(&mut result.messages), should_fix);
        result.messages = fixed.remaining;
        if is_fatal {
            return FixReport {
                is_fixed,
                output: current,
                result,
                is_circular,
                broken_by: None,
            };
        }
        if fixed.output.len() > max_fixed_len(text.len()) {
            let mut result = lint(text);
            result.messages.insert(0, grows_too_much(text.len()));
            return FixReport {
                is_fixed: false,
                output: text.to_vec(),
                result,
                is_circular: false,
                broken_by: None,
            };
        }
        last_pass = Some((fixed.applied, is_fixed));
        is_fixed |= fixed.is_fixed;
        let second_previous = previous.take();
        previous = Some(std::mem::replace(&mut current, fixed.output));
        if passes > 1 && second_previous.as_ref() == Some(&current) {
            is_circular = true;
        }
        if is_circular || !fixed.is_fixed || passes >= MAX_AUTOFIX_PASSES {
            // The messages are about the text before the last fixes.
            if fixed.is_fixed {
                result = lint(&current);
                if self::is_fatal(&result)
                    && let (Some(before), Some(pass)) = (previous.take(), last_pass.take())
                {
                    return without_the_last_pass(before, pass, lint);
                }
            }
            return FixReport {
                is_fixed,
                output: current,
                result,
                is_circular,
                broken_by: None,
            };
        }
    }
}
