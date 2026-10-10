bun_lint_react_compiler::declare_rule! {
    /// Warns on syntax that the React Compiler does not plan to support, such as `eval`.
    UnsupportedSyntax, "unsupported-syntax", Suggestion, UnsupportedSyntax
}
