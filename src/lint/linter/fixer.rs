//! Applies the fixes of messages: ESLint's `SourceCodeFixer.applyFixes` and `Linter.verifyAndFix`.

use super::{LintMessage, LintResult, RuleId};

/// ESLint's `MAX_AUTOFIX_PASSES`.
pub const MAX_AUTOFIX_PASSES: usize = 10;

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

/// The byte order mark.
const MARK: &[u8] = b"\xEF\xBB\xBF";

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
        // ESLint's "Remove BOM": the mark that the fix brings replaces the one that is there.
        if start == MARK.len() && text.starts_with(MARK) && fix.text.starts_with(MARK) {
            output.clear();
        }
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

/// The text cannot be parsed. What is said about a comment with a configuration that cannot be read is fatal, too.
pub fn is_parse_error(message: &LintMessage) -> bool {
    message.is_fatal && message.message.starts_with(b"Parsing error: ")
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
/// `lint` parses and lints the text that it is given. Unlike ESLint, it takes back the fixes of a pass after which the text cannot
/// be parsed.
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
        if is_fatal
            && result.messages.iter().all(is_parse_error)
            && let (Some(before), Some(pass)) = (previous.take(), last_pass.take())
        {
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
                    && result.messages.iter().all(is_parse_error)
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
