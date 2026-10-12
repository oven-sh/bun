//! The rules that `bun lint` has.

use bun_lint::linter::Registry;

bun_lint::rule_sets! {
    pub enum Rules / Runs {
        eslint: bun_lint_eslint,
        typescript: bun_lint_typescript,
        plugins: bun_lint_plugins,
        unicorn: bun_lint_unicorn,
        react: bun_lint_react,
        jest: bun_lint_jest,
    }
}

pub(crate) fn registry() -> Registry {
    Registry::new(&[
        bun_lint_eslint::RULES,
        bun_lint_typescript::RULES,
        bun_lint_plugins::RULES,
        bun_lint_unicorn::RULES,
        bun_lint_react::RULES,
        bun_lint_jest::RULES,
    ])
}
