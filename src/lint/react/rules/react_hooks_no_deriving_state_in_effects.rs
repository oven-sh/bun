bun_lint_react_compiler::declare_eslint_rule! {
    /// Validates against deriving values from state in an effect.
    NoDerivingStateInEffects, "no-deriving-state-in-effects", EffectDerivationsOfState
}
