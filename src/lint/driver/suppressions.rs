//! ESLint's bulk suppressions: `eslint-suppressions.json` says how many errors of which rules are
//! tolerated in which files. `SuppressionsService`.

use crate::results::{Counts, FileResult};
use crate::run::Fatal;
use crate::{fs, paths};
use bun_lint::context::Severity;
use bun_lint::linter::{LintMessage, Suppression, write_json_string};
use bun_lint::options::Json;
use std::io::Write;

pub(crate) const DEFAULT_FILE_NAME: &[u8] = b"eslint-suppressions.json";

/// By rule: how many errors.
type ByRule = Vec<(Vec<u8>, u64)>;

/// The content of the file: by path from the working directory.
#[derive(Default)]
pub(crate) struct Suppressions(Vec<(Vec<u8>, ByRule)>);

fn rule_of(message: &LintMessage) -> Option<Vec<u8>> {
    message.rule_id.as_ref().map(|id| id.to_vec())
}

/// `countViolationsByRule`
fn count_violations(messages: &[LintMessage]) -> ByRule {
    let mut counts: ByRule = Vec::new();
    for rule in messages.iter().filter(|it| it.severity == Severity::Error).filter_map(rule_of) {
        match counts.iter_mut().find(|it| it.0 == rule) {
            Some(entry) => entry.1 += 1,
            None => counts.push((rule, 1)),
        }
    }
    counts
}

fn entry<'e, T: Default>(entries: &'e mut Vec<(Vec<u8>, T)>, key: &[u8]) -> &'e mut T {
    let at = entries.iter().position(|it| it.0 == key).unwrap_or_else(|| {
        entries.push((key.to_vec(), T::default()));
        entries.len() - 1
    });
    &mut entries[at].1
}

impl Suppressions {
    /// `load`. A file that does not exist has nothing in it.
    pub(crate) fn load(path: &[u8]) -> Result<Suppressions, Fatal> {
        let Ok(text) = fs::read(path) else {
            return Ok(Suppressions::default());
        };
        let Some(Json::Object(files)) = bun_lint::json::parse(&text) else {
            return Err(Fatal([b"Failed to parse suppressions file at ", path].concat()));
        };
        let count = |value: &Json| match value.get(b"count") {
            Some(Json::Number(count)) => *count as u64,
            _ => 0,
        };
        let by_rule = |rules: &Json| rules.as_object().unwrap_or_default().iter().map(|(rule, value)| (rule.clone(), count(value))).collect();
        Ok(Suppressions(files.iter().map(|(file, rules)| (file.clone(), by_rule(rules))).collect()))
    }

    /// `save`: `stringify(suppressions, { space: 2 })` of `json-stable-stringify`.
    pub(crate) fn save(&mut self, path: &[u8]) -> Result<(), Fatal> {
        self.0.sort_by(|a, b| a.0.cmp(&b.0));
        let mut out = b"{".to_vec();
        for (i, (file, rules)) in self.0.iter_mut().enumerate() {
            rules.sort_by(|a, b| a.0.cmp(&b.0));
            out.extend_from_slice(if i > 0 { b",\n  " } else { b"\n  " });
            write_json_string(&mut out, file);
            out.extend_from_slice(b": {");
            for (j, (rule, count)) in rules.iter().enumerate() {
                out.extend_from_slice(if j > 0 { b",\n    " } else { b"\n    " });
                write_json_string(&mut out, rule);
                let _ = write!(out, ": {{\n      \"count\": {count}\n    }}");
            }
            out.extend_from_slice(if rules.is_empty() { b"}" } else { b"\n  }" });
        }
        out.extend_from_slice(if self.0.is_empty() { b"}" } else { b"\n}" });
        fs::write_new(path, &out).map_err(|error| Fatal([b"Cannot write ", path, b": ", &fs::describe(&error)].concat()))
    }

    /// `suppress`. `rules`: only these. `None`: all.
    pub(crate) fn suppress(&mut self, results: &[FileResult], cwd: &[u8], rules: Option<&[Vec<u8>]>) {
        for result in results {
            let relative = paths::relative(cwd, &paths::from_native(&result.path));
            for (rule, count) in count_violations(&result.messages) {
                if rules.is_none_or(|rules| rules.contains(&rule)) {
                    *entry(entry(&mut self.0, &relative), &rule) = count;
                }
            }
        }
    }

    /// `applySuppressions`. Returns what is suppressed and does not occur.
    pub(crate) fn apply(&self, results: &mut [FileResult], cwd: &[u8]) -> Suppressions {
        let mut unused = Suppressions::default();
        for result in results {
            let relative = paths::relative(cwd, &paths::from_native(&result.path));
            let Some((_, suppressed)) = self.0.iter().find(|it| it.0 == relative) else {
                continue;
            };
            let violations = count_violations(&result.messages);
            let mut was_suppressed = false;
            for (rule, count) in &violations {
                let Some(&(_, tolerated)) = suppressed.iter().find(|it| it.0 == *rule) else {
                    continue;
                };
                if *count <= tolerated {
                    // `suppressMessagesByRule`
                    let (mut hidden, shown): (Vec<_>, Vec<_>) =
                        std::mem::take(&mut result.messages).into_iter().partition(|it| rule_of(it).as_ref() == Some(rule));
                    for message in &mut hidden {
                        message.suppressions = vec![Suppression::file()];
                    }
                    result.messages = shown;
                    result.suppressed.append(&mut hidden);
                    was_suppressed = true;
                }
                if *count < tolerated {
                    *entry(entry(&mut unused.0, &relative), rule) = tolerated - count;
                }
            }
            for (rule, tolerated) in suppressed.iter().filter(|it| !violations.iter().any(|violation| violation.0 == it.0)) {
                *entry(entry(&mut unused.0, &relative), rule) = *tolerated;
            }
            if was_suppressed {
                result.counts = Counts::of(&result.messages);
            }
        }
        unused
    }

    /// `prune`, given what [`Suppressions::apply`] returned.
    pub(crate) fn prune(&mut self, unused: &Suppressions, cwd: &[u8]) {
        for (file, rules) in &unused.0 {
            let Some((_, suppressed)) = self.0.iter_mut().find(|it| it.0 == *file) else {
                continue;
            };
            for (rule, count) in rules {
                suppressed.retain_mut(|it| {
                    if it.0 == *rule {
                        it.1 = it.1.saturating_sub(*count);
                    }
                    it.1 > 0
                });
            }
        }
        self.0.retain(|it| !it.1.is_empty() && bun_sys::exists(&paths::resolve(cwd, &it.0)));
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}
