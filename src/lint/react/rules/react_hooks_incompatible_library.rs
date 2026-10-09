bun_lint_react_compiler::declare_eslint_rule! {
    /// Validates against usage of libraries which are incompatible with memoization.
    IncompatibleLibrary, "incompatible-library", IncompatibleLibrary, recommended
}
