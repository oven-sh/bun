bun_lint_react_compiler::declare_eslint_rule! {
    /// Validates that `useMemo()` and `useCallback()` specify comprehensive dependencies without extraneous values.
    MemoDependencies, "memo-dependencies", MemoDependencies
}
