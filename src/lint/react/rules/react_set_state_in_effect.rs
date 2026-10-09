bun_lint_react_compiler::declare_rule! {
    /// Disallow calling `setState` synchronously inside an effect.
    SetStateInEffect, "set-state-in-effect", Problem, EffectSetState
}
