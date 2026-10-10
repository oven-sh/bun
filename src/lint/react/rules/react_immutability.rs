bun_lint_react_compiler::declare_rule! {
    /// Disallow mutating props, state, and other values that are immutable by the Rules of React.
    Immutability, "immutability", Problem, Immutability
}
