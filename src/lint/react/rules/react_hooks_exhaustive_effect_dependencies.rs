bun_lint_react_compiler::declare_eslint_rule! {
    /// Validates that effect dependencies are exhaustive and without extraneous values.
    ExhaustiveEffectDependencies, "exhaustive-effect-dependencies", EffectExhaustiveDependencies
}
