bun_lint_react_compiler::declare_eslint_rule! {
    /// Validates correct usage of refs: not reading or writing `ref.current` during render.
    Refs, "refs", Refs, recommended
}
