const std = @import("std");

pub const T = enum(u8) {
    t_end_of_file,
    t_syntax_error,

    // "#!/usr/bin/env node"
    t_hashbang,

    // literals
    t_no_substitution_template_literal, // contents are in lexer.string_literal ([]uint16)
    t_numeric_literal, // contents are in lexer.number (float64)
    t_string_literal, // contents are in lexer.string_literal ([]uint16)
    t_big_integer_literal, // contents are in lexer.identifier (string)

    // pseudo-literals
    t_template_head, // contents are in lexer.string_literal ([]uint16)
    t_template_middle, // contents are in lexer.string_literal ([]uint16)
    t_template_tail, // contents are in lexer.string_literal ([]uint16)

    // punctuation
    t_ampersand,
    t_ampersand_ampersand,
    t_asterisk,
    t_asterisk_asterisk,
    t_at,
    t_bar,
    t_bar_bar,
    t_caret,
    t_close_brace,
    t_close_bracket,
    t_close_paren,
    t_colon,
    t_comma,
    t_dot,
    t_dot_dot_dot,
    t_equals_equals,
    t_equals_equals_equals,
    t_equals_greater_than,
    t_exclamation,
    t_exclamation_equals,
    t_exclamation_equals_equals,
    t_greater_than,
    t_greater_than_equals,
    t_greater_than_greater_than,
    t_greater_than_greater_than_greater_than,
    t_less_than,
    t_less_than_equals,
    t_less_than_less_than,
    t_minus,
    t_minus_minus,
    t_open_brace,
    t_open_bracket,
    t_open_paren,
    t_percent,
    t_plus,
    t_plus_plus,
    t_question,
    t_question_dot,
    t_question_question,
    t_semicolon,
    t_slash,
    t_tilde,

    // assignments (keep in sync with is_assign() below)
    t_ampersand_ampersand_equals,
    t_ampersand_equals,
    t_asterisk_asterisk_equals,
    t_asterisk_equals,
    t_bar_bar_equals,
    t_bar_equals,
    t_caret_equals,
    t_equals,
    t_greater_than_greater_than_equals,
    t_greater_than_greater_than_greater_than_equals,
    t_less_than_less_than_equals,
    t_minus_equals,
    t_percent_equals,
    t_plus_equals,
    t_question_question_equals,
    t_slash_equals,

    // class-private fields and methods
    t_private_identifier,

    // identifiers
    t_identifier, // contents are in lexer.identifier (string)
    t_escaped_keyword, // a keyword that has been escaped as an identifer

    // reserved words
    t_break,
    t_case,
    t_catch,
    t_class,
    t_const,
    t_continue,
    t_debugger,
    t_default,
    t_delete,
    t_do,
    t_else,
    t_enum,
    t_export,
    t_extends,
    t_false,
    t_finally,
    t_for,
    t_function,
    t_if,
    t_import,
    t_in,
    t_instanceof,
    t_new,
    t_null,
    t_return,
    t_super,
    t_switch,
    t_this,
    t_throw,
    t_true,
    t_try,
    t_typeof,
    t_var,
    t_void,
    t_while,
    t_with,

    pub fn isAssign() bool {
        return self >= T.t_ampersand_ampersand_equals and self <= T.t_slash_equals;
    }

    pub fn isReservedWord() bool {
        return self >= T.t_break and self <= T.t_with;
    }
};

pub const Keywords = std.ComptimeStringMap(T, .{
    .{ "break", .t_break },
    .{ "case", .t_case },
    .{ "catch", .t_catch },
    .{ "class", .t_class },
    .{ "const", .t_const },
    .{ "continue", .t_continue },
    .{ "debugger", .t_debugger },
    .{ "default", .t_default },
    .{ "delete", .t_delete },
    .{ "do", .t_do },
    .{ "else", .t_else },
    .{ "enum", .t_enum },
    .{ "export", .t_export },
    .{ "extends", .t_extends },
    .{ "false", .t_false },
    .{ "finally", .t_finally },
    .{ "for", .t_for },
    .{ "function", .t_function },
    .{ "if", .t_if },
    .{ "import", .t_import },
    .{ "in", .t_in },
    .{ "instanceof", .t_instanceof },
    .{ "new", .t_new },
    .{ "null", .t_null },
    .{ "return", .t_return },
    .{ "super", .t_super },
    .{ "switch", .t_switch },
    .{ "this", .t_this },
    .{ "throw", .t_throw },
    .{ "true", .t_true },
    .{ "try", .t_try },
    .{ "typeof", .t_typeof },
    .{ "var", .t_var },
    .{ "void", .t_void },
    .{ "while", .t_while },
    .{ "with", .t_with },
});

const Lexer = struct {};
