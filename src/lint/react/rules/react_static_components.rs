bun_lint_react_compiler::declare_rule! {
    /// Validates that components are static, not recreated on every render.
    StaticComponents, "static-components", Problem, StaticComponents
}
