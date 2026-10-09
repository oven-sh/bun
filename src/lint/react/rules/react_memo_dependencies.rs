bun_lint_react_compiler::declare_rule! {
    /// Validates that `useMemo()` and `useCallback()` dependencies are comprehensive, without extraneous values.
    MemoDependencies, "memo-dependencies", Problem, MemoDependencies
}
