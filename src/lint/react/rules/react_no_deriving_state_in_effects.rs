bun_lint_react_compiler::declare_rule! {
    /// Disallow deriving values from state in an effect instead of computing them during render.
    NoDerivingStateInEffects, "no-deriving-state-in-effects", Suggestion, EffectDerivationsOfState
}
