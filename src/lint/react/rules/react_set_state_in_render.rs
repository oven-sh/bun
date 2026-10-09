bun_lint_react_compiler::declare_rule! {
    /// Disallow setting state during render, which can trigger additional renders and infinite render loops.
    SetStateInRender, "set-state-in-render", Problem, RenderSetState
}
