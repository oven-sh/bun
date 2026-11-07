//! `get-eslint-disabled-lines.ts`, `get-eslint-disabled-rules.ts`, `is-node-eslint-disabled.ts`: upstream reads the
//! `eslint-disable` comments itself, apart from the linter's handling of them.

use bun_core::strings;
use bun_lint::prelude::*;

/// `getEslintDisabledLines` for one rule: the 1-based lines on which the rule is disabled, sorted.
#[derive(Debug, Default)]
pub(crate) struct DisabledLines {
    pub(crate) lines: Vec<u32>,
}

impl DisabledLines {
    /// `getEslintDisabledLines`. `rule_id` is `context.id`, with the plugin prefix. An `eslint-disable` that no
    /// `eslint-enable` follows disables nothing, as upstream.
    pub(crate) fn compute<'a>(file: &'a File<'a>, rule_id: &[u8]) -> DisabledLines {
        let mut lines = Vec::new();
        let mut disabled_from: Option<u32> = None;
        for comment in file.comments() {
            let Some((directive, rules)) = eslint_disabled_rules(comment.comment_value()) else {
                continue;
            };
            if !rules.includes(rule_id) {
                continue;
            }
            match directive {
                Directive::DisableNextLine => lines.push(file.line_of(comment.end()) + 1),
                Directive::DisableLine => lines.push(file.line_of(comment.start())),
                Directive::Disable => {
                    disabled_from.get_or_insert_with(|| file.line_of(comment.start()));
                }
                Directive::Enable => {
                    if let Some(from) = disabled_from.take() {
                        lines.extend(from + 1..=file.line_of(comment.start()));
                    }
                }
            }
        }
        lines.sort_unstable();
        lines.dedup();
        DisabledLines { lines }
    }

    /// No line of the file disables the rule, so no node is `isEslintDisabled`.
    pub(crate) fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }

    /// Upstream's `isNodeEslintDisabled`: the rule is disabled on the line `node` starts on.
    pub(crate) fn contains(&self, file: &File<'_>, node: Span) -> bool {
        !self.lines.is_empty() && self.lines.binary_search(&file.line_of(node.start)).is_ok()
    }
}

/// Upstream's `eslintDisableDirectives`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Directive {
    Disable,
    Enable,
    DisableLine,
    DisableNextLine,
}

impl Directive {
    const ALL: [Directive; 4] = [
        Directive::Disable,
        Directive::Enable,
        Directive::DisableLine,
        Directive::DisableNextLine,
    ];

    const fn text(self) -> &'static [u8] {
        match self {
            Directive::Disable => b"eslint-disable",
            Directive::Enable => b"eslint-enable",
            Directive::DisableLine => b"eslint-disable-line",
            Directive::DisableNextLine => b"eslint-disable-next-line",
        }
    }
}

/// The `rules` of upstream's `getEslintDisabledRules`: `'all'` for a bare directive, or the text after it, a
/// comma-separated list of rule ids. The list is kept as text and split when it is asked about a rule.
#[derive(Clone, Copy, Debug)]
pub(crate) enum DisabledRules<'c> {
    All,
    Listed(&'c [u8]),
}

impl DisabledRules<'_> {
    /// `rules === 'all' || rules.includes(ruleName)`
    pub(crate) fn includes(self, rule_id: &[u8]) -> bool {
        match self {
            DisabledRules::All => true,
            DisabledRules::Listed(list) => {
                strings::split(list, b",").any(|rule| strings::trim_js_whitespace(rule) == rule_id)
            }
        }
    }
}

/// Upstream's `getEslintDisabledRules`: the directive a comment's value is, with the rules it names. `None` for a
/// comment that is not one of the four directives, which includes `eslint-disable-foo` and `/* eslint .. */`.
pub(crate) fn eslint_disabled_rules(value: &[u8]) -> Option<(Directive, DisabledRules<'_>)> {
    if !strings::contains(value, b"eslint-") {
        return None;
    }
    let directive_part = directive_part(value);
    Directive::ALL.into_iter().find_map(|directive| {
        // The directive alone, or `^<directive> ((?:.|\s)*)$` with a non-empty capture.
        match directive_part.strip_prefix(directive.text())? {
            [] => Some((directive, DisabledRules::All)),
            [b' ', rules @ ..] if !rules.is_empty() => {
                Some((directive, DisabledRules::Listed(rules)))
            }
            _ => None,
        }
    })
}

/// Upstream's `getDirectivePart`: the trimmed comment value without the justification after the first
/// `/\s-{2,}\s/u`, as ESLint's own directive parser cuts it.
fn directive_part(value: &[u8]) -> &[u8] {
    let mut at = 0;
    while at < value.len() {
        let rest = value.get(at..).unwrap_or_default();
        let space = strings::js_whitespace_len(rest);
        if space == 0 {
            at += 1;
            continue;
        }
        let after_space = rest.get(space..).unwrap_or_default();
        let mut dashes = 0;
        while after_space.get(dashes) == Some(&b'-') {
            dashes += 1;
        }
        if dashes >= 2
            && strings::js_whitespace_len(after_space.get(dashes..).unwrap_or_default()) > 0
        {
            return strings::trim_js_whitespace(value.get(..at).unwrap_or_default());
        }
        at += space;
    }
    strings::trim_js_whitespace(value)
}
