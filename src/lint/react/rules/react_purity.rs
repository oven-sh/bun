bun_lint_react_compiler::declare_rule! {
    /// Validates that components and hooks do not call known-impure functions.
    Purity, "purity", Problem, Purity
}
