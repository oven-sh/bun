bun_lint_react_compiler::declare_eslint_rule! {
    /// Validates that components and hooks are pure: that they do not call functions that are known to be impure.
    Purity, "purity", Purity, recommended
}
