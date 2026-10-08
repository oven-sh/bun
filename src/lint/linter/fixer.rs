//! Applies the fixes of messages: ESLint's `SourceCodeFixer.applyFixes` and `Linter.verifyAndFix`.

use super::{LintMessage, LintResult};

/// ESLint's `MAX_AUTOFIX_PASSES`.
pub const MAX_AUTOFIX_PASSES: usize = 10;

/// What [`apply_fixes`] returns.
pub struct Fixed {
    /// Whether any message had a fix that was to be applied.
    pub is_fixed: bool,
    pub output: Vec<u8>,
    /// The messages that are not fixed, sorted by position.
    pub remaining: Vec<LintMessage>,
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
        };
    }
    fixable.sort_by_key(|it| it.fix.as_ref().map(|fix| (fix.span.start, fix.span.end)));
    let mut output = Vec::with_capacity(text.len());
    let mut last: Option<usize> = None;
    let mut is_fixed = false;
    for message in fixable {
        let Some(fix) = message.fix.as_ref().filter(|_| should_fix(&message)) else {
            remaining.push(message);
            continue;
        };
        is_fixed = true;
        let (start, end) = (fix.span.start as usize, fix.span.end as usize);
        if last.is_some_and(|last| last >= start) || start > end || end > text.len() {
            remaining.push(message);
            continue;
        }
        output.extend_from_slice(&text[last.unwrap_or(0)..start]);
        output.extend_from_slice(&fix.text);
        last = Some(end);
    }
    output.extend_from_slice(&text[last.unwrap_or(0)..]);
    remaining.sort_by_key(|it| (it.line, it.column));
    Fixed {
        is_fixed,
        output,
        remaining,
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
}

/// ESLint's `Linter.verifyAndFix`: lints and fixes until nothing is left to fix, ten times at most.
/// `lint` parses and lints the text that it is given.
pub fn verify_and_fix(
    text: &[u8],
    should_fix: &dyn Fn(&LintMessage) -> bool,
    lint: &mut dyn FnMut(&[u8]) -> LintResult,
) -> FixReport {
    let mut current = text.to_vec();
    let mut previous: Option<Vec<u8>> = None;
    let (mut is_fixed, mut is_circular) = (false, false);
    let mut passes = 0;
    loop {
        passes += 1;
        let mut result = lint(&current);
        let is_fatal = matches!(&result.messages[..], [only] if only.is_fatal);
        let fixed = apply_fixes(&current, std::mem::take(&mut result.messages), should_fix);
        result.messages = fixed.remaining;
        if is_fatal {
            return FixReport {
                is_fixed,
                output: current,
                result,
                is_circular,
            };
        }
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
            }
            return FixReport {
                is_fixed,
                output: current,
                result,
                is_circular,
            };
        }
    }
}
