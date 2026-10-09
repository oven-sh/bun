bun_lint_react_compiler::declare_eslint_rule! {
    /// Validates against calling `setState` synchronously in an effect.
    SetStateInEffect, "set-state-in-effect", EffectSetState, recommended
}
