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
    (
        "no-arrow-condition",
        "no-confusing-arrow, no-constant-condition",
    ),
    ("no-comma-dangle", "comma-dangle"),
    ("no-empty-class", "no-empty-character-class"),
    ("no-empty-label", "no-labels"),
    ("no-extra-strict", "strict"),
    ("no-reserved-keys", "quote-props"),
    ("no-space-before-semi", "semi-spacing"),
    ("no-wrap-func", "no-extra-parens"),
    ("space-after-function-name", "space-before-function-paren"),
    ("space-after-keywords", "keyword-spacing"),
    (
        "space-before-function-parentheses",
        "space-before-function-paren",
    ),
    ("space-before-keywords", "keyword-spacing"),
    (
        "space-in-brackets",
        "object-curly-spacing, array-bracket-spacing, computed-property-spacing",
    ),
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
    /// `lists`: `bun_lint_eslint::RULES`, `bun_lint_typescript::RULES`, `bun_lint_plugins::RULES`.
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
        let at = self
            .rules
            .binary_search_by(|it| (it.meta.plugin as u8, it.meta.name.as_bytes()).cmp(&key));
        Some(self.rules[at.ok()?])
    }

    /// The position of a rule in [`Registry::all`].
    pub fn index_of(&self, entry: &RuleEntry) -> Option<usize> {
        let key = (entry.meta.plugin as u8, entry.meta.name);
        self.rules
            .binary_search_by(|it| (it.meta.plugin as u8, it.meta.name).cmp(&key))
            .ok()
    }

    /// The same as [`Registry::get`]. With `prefers_typescript`, for a rule of ESLint that
    /// typescript-eslint extends, the extension.
    pub fn get_preferring(
        &self,
        plugin: Plugin,
        name: &[u8],
        prefers_typescript: bool,
    ) -> Option<&'static RuleEntry> {
        if prefers_typescript
            && plugin == Plugin::Eslint
            && let Some(extension) = self.get(Plugin::TypeScript, name)
            && extension.meta.extends_base_rule.is_some()
        {
            return Some(extension);
        }
        self.get(plugin, name)
    }

    /// The same as [`Registry::find`], with what [`Registry::get_preferring`] does.
    pub fn find_preferring(
        &self,
        id: &[u8],
        prefers_typescript: bool,
    ) -> Option<&'static RuleEntry> {
        let entry = self.find(id)?;
        self.get_preferring(
            entry.meta.plugin,
            entry.meta.name.as_bytes(),
            prefers_typescript,
        )
    }

    /// The rule that a configuration or a comment calls `id`: `no-debugger`,
    /// `@typescript-eslint/no-explicit-any`. The names that oxlint has for the same plugins are
    /// understood too: `eslint/no-debugger`, `typescript/no-explicit-any`,
    /// `typescript-eslint/no-explicit-any`, `react/rules-of-hooks`, `node/no-unsupported-features/es-syntax`.
    pub fn find(&self, id: &[u8]) -> Option<&'static RuleEntry> {
        let (plugin, name) = parse_rule_id(id);
        self.get(Plugin::of_prefix(plugin)?, name)
    }
}

/// What replaces a rule that ESLint has removed, separated by `, `.
pub(crate) fn replacement_of(id: &[u8]) -> Option<&'static str> {
    REPLACEMENTS
        .iter()
        .find(|it| it.0.as_bytes() == id)
        .map(|it| it.1)
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
