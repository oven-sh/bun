bun_lint_react_compiler::declare_rule! {
    /// Validates that effect dependencies are exhaustive, without extraneous values.
    ExhaustiveEffectDependencies, "exhaustive-effect-dependencies", Problem, EffectExhaustiveDependencies
}
