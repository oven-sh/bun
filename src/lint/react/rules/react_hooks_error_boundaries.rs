bun_lint_react_compiler::declare_eslint_rule! {
    /// Validates usage of error boundaries instead of `try`/`catch` for errors in child components.
    ErrorBoundaries, "error-boundaries", ErrorBoundaries, recommended
}
