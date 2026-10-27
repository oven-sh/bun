//! Applies messages' fixes: ESLint's `SourceCodeFixer.applyFixes` and `Linter.verifyAndFix`.

use super::{LintMessage, LintResult, RuleId};

/// ESLint's `MAX_AUTOFIX_PASSES`.
pub const MAX_AUTOFIX_PASSES: usize = 10;

/// The result of [`apply_fixes`].
pub struct Fixed {
    /// True if any message had a fix that should be applied.
    pub is_fixed: bool,
    pub output: Vec<u8>,
    /// The messages that weren't fixed, sorted by position.
    pub remaining: Vec<LintMessage>,
    /// The rules whose fixes are in `output`.
    pub applied: Vec<RuleId>,
    /// Number of fixes applied to produce `output`.
    pub count: usize,
}

/// The byte order mark.
const BYTE_ORDER_MARK: &[u8] = b"\xEF\xBB\xBF";

/// ESLint's `SourceCodeFixer.applyFixes`. A fix that overlaps or touches an already applied fix
/// waits for the next pass. `should_fix` is ESLint's `fix` option as a function. Unlike ESLint,
/// this doesn't count a no-op fix as a fix.
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
            count: 0,
        };
    }
    crate::utils::sort::sort_by_key(&mut fixable, |it| {
        it.fix.as_ref().map(|fix| (fix.span.start, fix.span.end))
    });
    let mut output = Vec::with_capacity(text.len());
    let mut last: Option<usize> = None;
    let mut is_fixed = false;
    let mut applied: Vec<RuleId> = Vec::new();
    let mut count = 0;
    for message in fixable {
        let Some(fix) = message.fix.as_ref().filter(|_| should_fix(&message)) else {
            remaining.push(message);
            continue;
        };
        let (start, end) = (fix.span.start as usize, fix.span.end as usize);
        // The fix is a no-op, so the next run would report the same message again.
        if text.get(start..end) == Some(&fix.text[..]) {
            remaining.push(message);
            continue;
        }
        is_fixed = true;
        if last.is_some_and(|last| last >= start) || start > end {
            remaining.push(message);
            continue;
        }
        // A range can extend past the text, as with `String.prototype.slice`.
        output.extend_from_slice(&text[last.unwrap_or(0).min(text.len())..start.min(text.len())]);
        // ESLint's "Remove BOM": the mark in the fix replaces the existing one.
        if start == BYTE_ORDER_MARK.len()
            && text.starts_with(BYTE_ORDER_MARK)
            && fix.text.starts_with(BYTE_ORDER_MARK)
        {
            output.clear();
        }
        output.extend_from_slice(&fix.text);
        last = Some(end);
        count += 1;
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
        count,
    }
}

/// The result of [`verify_and_fix`].
pub struct FixReport {
    /// True if the text changed.
    pub is_fixed: bool,
    /// Number of fixes applied to produce `output`, over all passes.
    pub fixes: usize,
    pub output: Vec<u8>,
    /// The remaining messages, which are about `output`.
    pub result: LintResult,
    /// The fixes undo each other, so fixing stopped. ESLint warns about it.
    pub is_circular: bool,
    /// Rules whose fixes were applied in the pass that [broke the syntax](breaks_syntax). `output` is the text before
    /// that pass.
    pub broken_by: Option<Vec<RuleId>>,
}

fn is_fatal(result: &LintResult) -> bool {
    !result.messages.is_empty() && result.messages.iter().all(|it| it.is_fatal)
}

/// True if the text can't be parsed. The message about an unreadable config comment is fatal too, but isn't a parse
/// error.
pub fn is_parse_error(message: &LintMessage) -> bool {
    message.is_fatal && message.message.starts_with(b"Parsing error: ")
}

/// True if the fixes that produced the text that `result` describes must be rolled back. Either the text doesn't parse,
/// or it has more [errors that the parser tolerates](LintResult::tolerated_errors) than the text before the fixes,
/// which had `tolerated_before`. Otherwise the next pass would run on broken code, and rolling back only that pass
/// would keep the broken code.
pub fn breaks_syntax(result: &LintResult, tolerated_before: usize) -> bool {
    is_fatal(result) && result.messages.iter().all(is_parse_error)
        || result.tolerated_errors > tolerated_before
}

/// oxlint's error for a name that's declared twice. It doesn't come from oxc's parser, which accepts such code.
pub fn is_redeclaration(message: &LintMessage) -> bool {
    message.message.starts_with(b"Parsing error: Identifier `")
        && message.message.ends_with(b"` has already been declared")
}

/// The report to return when a pass's fixes are rolled back. `before` is the text before that pass. `was_fixed` tells
/// whether earlier passes had already changed it, and `fixes` is how many fixes they applied.
fn rolled_back_report(
    before: Vec<u8>,
    (rules, was_fixed, fixes): (Vec<RuleId>, bool, usize),
    lint: &mut dyn FnMut(&[u8], bool) -> LintResult,
) -> FixReport {
    FixReport {
        is_fixed: was_fixed,
        fixes,
        result: lint(&before, false),
        output: before,
        is_circular: false,
        broken_by: Some(rules),
    }
}

/// ESLint's `Linter.verifyAndFix`: lints and fixes until nothing is left to fix, at most ten times. `lint` parses and
/// lints the given text. Its second argument is `true` if fixes have just produced that text. Unlike ESLint, this rolls
/// back a pass whose fixes [break the syntax](breaks_syntax).
pub fn verify_and_fix(
    text: &[u8],
    should_fix: &dyn Fn(&LintMessage) -> bool,
    lint: &mut dyn FnMut(&[u8], bool) -> LintResult,
) -> FixReport {
    let mut current = text.to_vec();
    let mut previous: Option<Vec<u8>> = None;
    let (mut is_fixed, mut is_circular, mut fixes) = (false, false, 0);
    // About the previous pass: the rules whose fixes it applied, then `is_fixed` and `fixes` as they were before it.
    let mut last_pass: Option<(Vec<RuleId>, bool, usize)> = None;
    // [`LintResult::tolerated_errors`] for `previous`.
    let mut tolerated_before = 0;
    let mut passes = 0;
    loop {
        passes += 1;
        let mut result = lint(&current, passes > 1);
        let is_fatal = is_fatal(&result);
        if breaks_syntax(&result, tolerated_before)
            && let (Some(before), Some(pass)) = (previous.take(), last_pass.take())
        {
            return rolled_back_report(before, pass, lint);
        }
        tolerated_before = result.tolerated_errors;
        let fixed = apply_fixes(&current, std::mem::take(&mut result.messages), should_fix);
        result.messages = fixed.remaining;
        if is_fatal {
            return FixReport {
                is_fixed,
                fixes,
                output: current,
                result,
                is_circular,
                broken_by: None,
            };
        }
        last_pass = Some((fixed.applied, is_fixed, fixes));
        is_fixed |= fixed.is_fixed;
        fixes += fixed.count;
        let second_previous = previous.take();
        previous = Some(std::mem::replace(&mut current, fixed.output));
        if passes > 1 && second_previous.as_ref() == Some(&current) {
            is_circular = true;
        }
        if is_circular || !fixed.is_fixed || passes >= MAX_AUTOFIX_PASSES {
            // The messages are about the text before the last fixes.
            if fixed.is_fixed {
                result = lint(&current, true);
                if breaks_syntax(&result, tolerated_before)
                    && let (Some(before), Some(pass)) = (previous.take(), last_pass.take())
                {
                    return rolled_back_report(before, pass, lint);
                }
            }
            return FixReport {
                is_fixed,
                fixes,
                output: current,
                result,
                is_circular,
                broken_by: None,
            };
        }
    }
}
