bun_lint_react_compiler::declare_rule! {
    /// Validates that `useMemo()` callbacks return a value and the result is used.
    VoidUseMemo, "void-use-memo", Problem, VoidUseMemo
}
