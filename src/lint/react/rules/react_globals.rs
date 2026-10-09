bun_lint_react_compiler::declare_rule! {
    /// Disallow assigning to or mutating globals during render.
    Globals, "globals", Problem, Globals
}
