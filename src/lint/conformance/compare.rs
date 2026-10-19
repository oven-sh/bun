//! What is compared of a test case: what ESLint reported for it when it was recorded, and what is
//! reported now.

use bstr::BString;
use bun_lint::fix::{Fix, SuggestionKind};
use bun_lint::linter::{LintMessage, RuleId, Suggestion, Utf16Offsets};
use bun_lint::options::Json;
use bun_lint::runner::RuleEntry;
use bun_lint::utils::sort;
use std::sync::atomic::{AtomicUsize, Ordering};

/// What is reported for the code of a case, and the code after one pass of fixes.
pub struct Outcome {
    pub messages: Vec<Reported>,
    pub output: Option<Vec<u8>>,
    pub has_parse_errors: bool,
    /// True if any message has a [held-back](held_back) fix.
    pub holds_back_a_fix: bool,
}

/// Returns the fix that upstream applies with `--fix` but that needs `--fix-dangerously` here, because it can change
/// what the program does. It's compared as a regular fix, so its text is still checked, and the case is
/// [counted](Counts::holding_back_a_fix).
fn held_back(message: &LintMessage) -> Option<&Suggestion> {
    let is_fix = |it: &&Suggestion| it.kind == SuggestionKind::DangerousFix;
    match message.fix {
        Some(_) => None,
        None => message.suggestions.iter().find(is_fix),
    }
}

/// Returns the fix that upstream's `--fix` applies for `message`.
fn fix_of(message: &LintMessage) -> Option<&Fix> {
    let held_back = || held_back(message).map(|it| &it.fix);
    message.fix.as_ref().or_else(held_back)
}

/// A message, as far as it is compared.
#[derive(PartialEq, Eq, Debug)]
pub struct Reported {
    /// `None`: the rule that is tested. Empty: the linter itself.
    pub rule_id: Option<BString>,
    pub message_id: BString,
    pub message: BString,
    pub line: u32,
    pub column: u32,
    pub end: Option<(u32, u32)>,
    pub fix: Option<Edit>,
    pub suggestions: Vec<Suggested>,
}

/// ESLint's `fix`: a range in UTF-16 code units, and what replaces it.
#[derive(PartialEq, Eq, Debug)]
pub struct Edit {
    pub range: (i64, i64),
    pub text: BString,
}

#[derive(PartialEq, Eq, Debug)]
pub struct Suggested {
    pub message_id: BString,
    pub desc: BString,
    pub fix: Option<Edit>,
    /// The code after it.
    pub output: BString,
}

impl Outcome {
    /// `messages`: what the linter says about `code` in a test of the rule `entry`.
    pub fn new(entry: &'static RuleEntry, code: &[u8], messages: &[LintMessage]) -> Outcome {
        let mut fixes: Vec<_> = messages.iter().filter_map(fix_of).collect();
        Outcome {
            holds_back_a_fix: messages.iter().any(|it| held_back(it).is_some()),
            has_parse_errors: messages
                .iter()
                .any(|it| it.is_fatal && it.message.starts_with(b"Parsing error")),
            messages: messages
                .iter()
                .map(|it| Reported::new(entry, code, it))
                .collect(),
            output: bun_lint::fix::apply_fixes(code, &mut fixes),
        }
    }
}

impl Reported {
    /// What is compared of a message about `code` in a test of the rule `entry`.
    pub fn new(entry: &'static RuleEntry, code: &[u8], message: &LintMessage) -> Reported {
        let apply = |fix: &Fix| {
            bun_lint::fix::apply_fixes(code, &mut vec![fix]).unwrap_or_else(|| code.to_vec())
        };
        let edit = |fix: &Fix| {
            let mut offsets = Utf16Offsets::new(code);
            Edit {
                range: (
                    offsets.convert(fix.span.start),
                    offsets.convert(fix.span.end),
                ),
                text: fix.text.clone().into(),
            }
        };
        Reported {
            rule_id: match &message.rule_id {
                Some(id) if *id == RuleId::Known(entry.meta) => None,
                Some(id) => Some(id.to_vec().into()),
                None => Some(BString::default()),
            },
            message_id: message.message_id.as_deref().unwrap_or_default().into(),
            message: message.message.clone().into(),
            line: message.line,
            column: message.column,
            end: message.end,
            fix: fix_of(message).map(edit),
            suggestions: (message.suggestions.iter())
                .filter(|it| !held_back(message).is_some_and(|fix| std::ptr::eq(*it, fix)))
                .map(|it| Suggested {
                    message_id: (*it.message_id).into(),
                    desc: it.message.clone().into(),
                    fix: Some(edit(&it.fix)),
                    output: apply(&it.fix).into(),
                })
                .collect(),
        }
    }
}

/// The string at `key` of `json`.
pub fn string_of<'j>(json: &'j Json, key: &[u8]) -> Option<&'j [u8]> {
    json.get(key)?.as_str()
}

fn text_of(json: &Json, key: &[u8]) -> BString {
    string_of(json, key).unwrap_or_default().into()
}

/// A message as it is printed: here it is valid UTF-8 from the start.
fn message_of(json: &Json, key: &[u8]) -> BString {
    let mut message = Vec::new();
    bun_core::strings::push_wtf8_well_formed(
        &mut message,
        string_of(json, key).unwrap_or_default(),
    );
    message.into()
}

fn number_of(json: &Json, key: &[u8]) -> Option<u32> {
    match json.get(key)? {
        Json::Number(n) => Some(*n as u32),
        _ => None,
    }
}

fn expected_edit(of: &Json) -> Option<Edit> {
    let fix = of.get(b"fix")?;
    let range = fix.get(b"range")?.as_array()?;
    let at = |i: usize| match range.get(i) {
        Some(Json::Number(n)) => Some(*n as i64),
        _ => None,
    };
    Some(Edit {
        range: (at(0)?, at(1)?),
        text: string_of(fix, b"text")?.into(),
    })
}

/// What ESLint reported for `case`.
pub fn expected_messages(case: &Json) -> Vec<Reported> {
    let messages = case
        .get(b"messages")
        .and_then(Json::as_array)
        .unwrap_or_default();
    let reported = messages.iter().map(|it| Reported {
        rule_id: it
            .get(b"ruleId")
            .map(|id| id.as_str().unwrap_or_default().into()),
        message_id: text_of(it, b"messageId"),
        message: message_of(it, b"message"),
        line: number_of(it, b"line").unwrap_or(0),
        column: number_of(it, b"column").unwrap_or(0),
        end: number_of(it, b"endLine").zip(number_of(it, b"endColumn")),
        fix: expected_edit(it),
        suggestions: (it
            .get(b"suggestions")
            .and_then(Json::as_array)
            .unwrap_or_default()
            .iter())
        .map(|it| Suggested {
            message_id: text_of(it, b"messageId"),
            desc: message_of(it, b"desc"),
            fix: expected_edit(it),
            output: text_of(it, b"output"),
        })
        .collect(),
    });
    reported.collect()
}

/// What is counted beside the cases that fail.
#[derive(Default)]
pub struct Counts {
    /// Messages without a help for which oxlint has one.
    pub lacking_help: AtomicUsize,
    /// Cases whose messages are the recorded ones in another order.
    pub in_another_order: AtomicUsize,
    /// `--in-order`: such a case fails.
    pub fails_on_order: bool,
    /// Passing cases where `--fix` applies fewer fixes than upstream's `--fix`. The rest need `--fix-suggestions` or
    /// `--fix-dangerously`.
    pub holding_back_a_fix: AtomicUsize,
}

/// The order of what starts at the same place depends on the order in which ESLint visits the
/// nodes.
fn in_order(mut messages: Vec<Reported>) -> Vec<Reported> {
    sort::sort_by(&mut messages, |a, b| {
        (a.line, a.column, a.end, &a.message_id, &a.message).cmp(&(
            b.line,
            b.column,
            b.end,
            &b.message_id,
            &b.message,
        ))
    });
    messages
}

/// Why a case fails: in a few words, and at length.
pub struct Problem {
    pub summary: &'static str,
    pub details: String,
}

/// What is wrong with `messages`, which are about `code`, where oxlint is the judge: the messages without their fixes, and the code
/// after the fixes that each further flag of oxlint applies. A help that is there has to be oxlint's.
pub(crate) fn problem_of_oxlint(
    entry: &'static RuleEntry,
    code: &[u8],
    messages: &[LintMessage],
    case: &Json,
    counts: &Counts,
) -> Option<Problem> {
    let mut outcome = Outcome::new(entry, code, messages);
    for message in &mut outcome.messages {
        (message.fix, message.suggestions) = (None, Vec::new());
        // Those of oxlint have none.
        message.message_id.clear();
    }
    // As they were recorded, which keeps the order of oxlint only among those that start at one place.
    sort::sort_by_key(&mut outcome.messages, |it| (it.line, it.column));
    // `output` is compared below.
    outcome.output = string_of(case, b"output").map(<[u8]>::to_vec);
    outcome.holds_back_a_fix = false;
    if let Some(problem) = problem_of(Some(outcome), case, counts) {
        return Some(problem);
    }
    let expected = case.get(b"messages").and_then(Json::as_array);
    for message in messages {
        // Several can say the same at one place.
        let there = expected.unwrap_or_default().iter().filter(|it| {
            (number_of(it, b"line"), number_of(it, b"column"))
                == (Some(message.line), Some(message.column))
                && message_of(it, b"message") == message.message
        });
        let helps = there.filter_map(|it| string_of(it.get(b"oxlint")?, b"help"));
        let helps: Vec<&bstr::BStr> = helps.map(bstr::BStr::new).collect();
        match message.help() {
            "" => {
                (counts.lacking_help).fetch_add(usize::from(!helps.is_empty()), Ordering::Relaxed);
            }
            help if helps.iter().any(|it| **it == help) => {}
            help => {
                return Some(Problem {
                    summary: "the help differs",
                    details: format!("  expected: {helps:?}\n  actual: {help:?}"),
                });
            }
        }
    }
    let steps: [(&[u8], &[SuggestionKind]); 3] = [
        (b"output", &[]),
        (b"outputWithSuggestions", &[SuggestionKind::Suggestion]),
        (
            b"outputDangerously",
            &[
                SuggestionKind::Suggestion,
                SuggestionKind::DangerousFix,
                SuggestionKind::DangerousSuggestion,
            ],
        ),
    ];
    let outputs = steps.map(|(_, kinds)| {
        // oxlint applies the first of several.
        let mut fixes: Vec<&Fix> = (messages.iter())
            .filter_map(|it| {
                let suggested = it.suggestions.first().filter(|it| kinds.contains(&it.kind));
                it.fix.as_ref().or_else(|| suggested.map(|it| &it.fix))
            })
            .collect();
        bun_lint::fix::apply_fixes(code, &mut fixes).unwrap_or_else(|| code.to_vec())
    });
    let (mut before, mut holds_back_a_fix) = (code.to_vec(), false);
    for (step, (key, _)) in steps.iter().enumerate() {
        let expected = string_of(case, key).unwrap_or(&before).to_vec();
        // Output that oxlint produces with these flags may need more flags here, but never fewer.
        match outputs.iter().skip(step).position(|it| *it == expected) {
            Some(0) => {}
            Some(_) => holds_back_a_fix = true,
            None => {
                return Some(Problem {
                    summary: "output differs",
                    details: format!(
                        "  {}\n  expected: {:?}\n  actual: {:?}",
                        bstr::BStr::new(key),
                        bstr::BStr::new(&expected),
                        bstr::BStr::new(outputs.get(step).map_or(&[][..], Vec::as_slice))
                    ),
                });
            }
        }
        before = expected;
    }
    (counts.holding_back_a_fix).fetch_add(usize::from(holds_back_a_fix), Ordering::Relaxed);
    None
}

/// What is wrong with `outcome`, which is `None` if the code was not linted at all.
pub fn problem_of(outcome: Option<Outcome>, case: &Json, counts: &Counts) -> Option<Problem> {
    let problem = |summary, details| Some(Problem { summary, details });
    let Some(outcome) = outcome else {
        return problem("the file is not part of the program", String::new());
    };
    if outcome.has_parse_errors {
        return problem("the parser rejects the code", String::new());
    }
    let (actual, expected) = (outcome.messages, expected_messages(case));
    if actual != expected {
        let order = || format!("  expected: {expected:#?}\n  actual: {actual:#?}");
        let as_they_came = counts.fails_on_order.then(order);
        let (actual, expected) = (in_order(actual), in_order(expected));
        if actual != expected {
            return problem(
                "messages differ",
                format!("  expected: {expected:#?}\n  actual: {actual:#?}"),
            );
        }
        counts.in_another_order.fetch_add(1, Ordering::Relaxed);
        if let Some(details) = as_they_came {
            return problem("the order differs", details);
        }
    }
    let (actual, expected) = (
        outcome.output.as_deref().map(bstr::BStr::new),
        string_of(case, b"output").map(bstr::BStr::new),
    );
    if actual != expected {
        return problem(
            "output differs",
            format!("  expected: {expected:?}\n  actual: {actual:?}"),
        );
    }
    (counts.holding_back_a_fix).fetch_add(usize::from(outcome.holds_back_a_fix), Ordering::Relaxed);
    None
}
