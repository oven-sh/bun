bun_lint_react_compiler::declare_eslint_rule! {
    /// Validates that components are static, not recreated every render.
    StaticComponents, "static-components", StaticComponents, recommended
}
