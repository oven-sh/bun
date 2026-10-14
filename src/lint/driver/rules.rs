//! The rules that `bun lint` has.

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
