//! All of `bun lint`'s rules.

bun_lint::rule_sets! {
    pub enum Rules / Runs {
        eslint: bun_lint_eslint,
        typescript: bun_lint_typescript,
        plugins: bun_lint_plugins,
        unicorn: bun_lint_unicorn,
        react: bun_lint_react,
        jest: bun_lint_jest,
        json: bun_lint_json,
        markdown: bun_lint_markdown,
    }
}

/// The languages other than JavaScript that `bun lint` parses itself.
pub(crate) static LANGUAGES: &[&dyn bun_lint::languages::Language] =
    &[&bun_lint_json::Json, &bun_lint_markdown::Markdown];

/// Builds the registry of every rule set and language that `bun lint` ships.
pub(crate) fn registry() -> bun_lint::linter::Registry {
    bun_lint::linter::Registry::new(&[
        bun_lint_eslint::RULES,
        bun_lint_typescript::RULES,
        bun_lint_plugins::RULES,
        bun_lint_unicorn::RULES,
        bun_lint_react::RULES,
        bun_lint_jest::RULES,
        bun_lint_json::RULES,
        bun_lint_markdown::RULES,
    ])
    .with_languages(LANGUAGES)
}
