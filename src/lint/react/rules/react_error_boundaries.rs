bun_lint_react_compiler::declare_rule! {
    /// Validates using error boundaries instead of try/catch for child errors.
    ErrorBoundaries, "error-boundaries", Problem, ErrorBoundaries
}
