const std = @import("std");

/// Configuration options for the .env parser.
/// These options allow customizing parsing behavior while maintaining backward compatibility.
pub const ParserOptions = struct {
    /// When enabled, allows single-quoted strings ('...') to span multiple lines.
    /// This makes 'single quotes' behave similarly to bash-style multi-line strings.
    ///
    /// Example with option enabled:
    /// ```
    /// KEY='this is a heredoc
    /// as well'
    /// ```
    /// Result: "this is a heredoc\nas well"
    ///
    /// Default: false (backward compatible - single quotes terminate on newline)
    allow_single_quote_heredocs: bool = false,

    /// When enabled, allows double-quoted strings ("...") to span multiple lines
    /// without requiring triple-quote syntax (""").
    ///
    /// Note: Explicit double quotes already allow newlines by default in the current
    /// implementation. This option exists for explicitness and future configurability.
    ///
    /// Default: true (current behavior - double quotes allow newlines)
    allow_double_quote_heredocs: bool = true,

    /// When enabled, allows variable interpolation without braces (e.g., $VAR).
    /// Standard behavior only allows ${VAR}.
    ///
    /// Variable names with $VAR syntax are terminated by any character that is not
    /// a valid identifier character (alphanumeric or underscore).
    ///
    /// Default: false (backward compatible - requires ${VAR})
    allow_braceless_variables: bool = false,

    /// When enabled, allows the 'export ' prefix before a key.
    /// Example: export KEY=VALUE
    /// Default: false
    support_export_prefix: bool = false,

    /// When enabled, allows ':' as a key-value separator if followed by a space.
    /// Example: KEY: VALUE
    /// Default: false
    support_colon_separator: bool = false,

    /// Returns the default parser options for maximum backward compatibility.
    pub fn defaults() ParserOptions {
        return ParserOptions{};
    }

    /// Returns parser options with all quote heredoc features enabled.
    /// Useful for bash-style multi-line string compatibility.
    pub fn bashCompatible() ParserOptions {
        return ParserOptions{
            .allow_single_quote_heredocs = true,
            .allow_double_quote_heredocs = true,
            .allow_braceless_variables = true,
        };
    }
};

test "ParserOptions defaults" {
    const opts = ParserOptions.defaults();
    try std.testing.expect(!opts.allow_single_quote_heredocs);
    try std.testing.expect(opts.allow_double_quote_heredocs);
}

test "ParserOptions bashCompatible" {
    const opts = ParserOptions.bashCompatible();
    try std.testing.expect(opts.allow_single_quote_heredocs);
    try std.testing.expect(opts.allow_double_quote_heredocs);
}
