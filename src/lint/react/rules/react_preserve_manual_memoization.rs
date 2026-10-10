bun_lint_react_compiler::declare_rule! {
    /// Validates that existing manual memoization is preserved by the React Compiler.
    PreserveManualMemoization, "preserve-manual-memoization", Problem, PreserveManualMemo
}
