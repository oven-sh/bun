bun_lint_react_compiler::declare_eslint_rule! {
    /// Validates against mutating props, state, and other values that are immutable.
    Immutability, "immutability", Immutability, recommended
}
