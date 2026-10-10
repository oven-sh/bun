bun_lint_react_compiler::declare_rule! {
    /// Warns on usage of libraries that are incompatible with memoization.
    IncompatibleLibrary, "incompatible-library", Problem, IncompatibleLibrary
}
