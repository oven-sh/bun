bun_lint_react_compiler::declare_eslint_rule! {
    /// Validates that `useMemo()` always returns a value and that the result is used.
    VoidUseMemo, "void-use-memo", VoidUseMemo
}
