bun_lint_react_compiler::declare_eslint_rule! {
    /// Validates against setting state during render.
    SetStateInRender, "set-state-in-render", RenderSetState, recommended
}
