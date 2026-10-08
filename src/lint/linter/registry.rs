//! The rules that exist, by name.

use crate::rule::Plugin;
use crate::runner::RuleEntry;
use bun_core::strings;

/// All the rules that can be configured.
pub struct Registry {
    /// Sorted by plugin and name.
    rules: Vec<&'static RuleEntry>,
}

/// `conf/replacements.json`: rules that ESLint has removed, and what replaces them.
const REPLACEMENTS: &[(&str, &str)] = &[
    ("generator-star", "generator-star-spacing"),
    ("global-strict", "strict"),
    ("no-arrow-condition", "no-confusing-arrow, no-constant-condition"),
    ("no-comma-dangle", "comma-dangle"),
    ("no-empty-class", "no-empty-character-class"),
    ("no-empty-label", "no-labels"),
    ("no-extra-strict", "strict"),
    ("no-reserved-keys", "quote-props"),
    ("no-space-before-semi", "semi-spacing"),
    ("no-wrap-func", "no-extra-parens"),
    ("space-after-function-name", "space-before-function-paren"),
    ("space-after-keywords", "keyword-spacing"),
    ("space-before-function-parentheses", "space-before-function-paren"),
    ("space-before-keywords", "keyword-spacing"),
    ("space-in-brackets", "object-curly-spacing, array-bracket-spacing, computed-property-spacing"),
    ("space-return-throw-case", "keyword-spacing"),
    ("space-unary-word-ops", "space-unary-ops"),
    ("spaced-line-comment", "spaced-comment"),
];

/// ESLint's `parseRuleId`: the name of the plugin, which is empty for a rule of ESLint itself, and
/// the name of the rule in it.
pub fn parse_rule_id(id: &[u8]) -> (&[u8], &[u8]) {
    let slash = match id.first() {
        Some(b'@') => strings::last_index_of_char(id, b'/'),
        _ => strings::index_of_char_usize(id, b'/'),
    };
    match slash {
        Some(slash) => (&id[..slash], &id[slash + 1..]),
        None => (b"", id),
    }
}

impl Registry {
    /// `lists`: `bun_lint_eslint::RULES`, `bun_lint_typescript::RULES`.
    pub fn new(lists: &[&'static [RuleEntry]]) -> Registry {
        let mut rules: Vec<_> = lists.iter().flat_map(|list| list.iter()).collect();
        rules.sort_by_key(|it| (it.meta.plugin as u8, it.meta.name));
        Registry { rules }
    }

    pub fn all(&self) -> &[&'static RuleEntry] {
        &self.rules
    }

    pub fn get(&self, plugin: Plugin, name: &[u8]) -> Option<&'static RuleEntry> {
        let key = (plugin as u8, name);
        let at = self.rules.binary_search_by(|it| (it.meta.plugin as u8, it.meta.name.as_bytes()).cmp(&key));
        Some(self.rules[at.ok()?])
    }

    /// The rule that a configuration or a comment calls `id`: `no-debugger`,
    /// `@typescript-eslint/no-explicit-any`. The names that oxlint has for the same plugins are
    /// understood too: `eslint/no-debugger`, `typescript/no-explicit-any`,
    /// `typescript-eslint/no-explicit-any`.
    pub fn find(&self, id: &[u8]) -> Option<&'static RuleEntry> {
        let (plugin, name) = parse_rule_id(id);
        let plugin = match plugin {
            b"" | b"eslint" => Plugin::Eslint,
            b"@typescript-eslint" | b"typescript-eslint" | b"typescript" => Plugin::TypeScript,
            _ => return None,
        };
        self.get(plugin, name)
    }
}

/// ESLint's `createMissingRuleMessage`.
pub(crate) fn missing_rule_message(id: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(id.len() + 40);
    match REPLACEMENTS.iter().find(|it| it.0.as_bytes() == id) {
        Some((_, replacements)) => {
            out.extend_from_slice(b"Rule '");
            out.extend_from_slice(id);
            out.extend_from_slice(b"' was removed and replaced by: ");
            out.extend_from_slice(replacements.as_bytes());
        }
        None => {
            out.extend_from_slice(b"Definition for rule '");
            out.extend_from_slice(id);
            out.extend_from_slice(b"' was not found.");
        }
    }
    out
}
