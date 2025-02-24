const std = @import("std");
const bun = @import("root").bun;
const expectString = std.testing.expectEqualStrings;
const expect = std.testing.expect;
const logger = bun.logger;
const unicode = std.unicode;
const default_allocator = bun.default_allocator;
const string = @import("string_types.zig").string;
const CodePoint = @import("string_types.zig").CodePoint;
const ComptimeStringMap = bun.ComptimeStringMap;

pub const T = enum(u8) {
    t_end_of_file = 0,
    // close brace is here so that we can do comparisons against EOF or close brace in one branch
    t_close_brace = 1,

    t_syntax_error = 2,

    // "#!/usr/bin/env node"
    t_hashbang = 3,

    // literals
    t_no_substitution_template_literal = 4, // contents are in lexer.string_literal ([]uint16)
    t_numeric_literal = 5, // contents are in lexer.number (float64)
    t_string_literal = 6, // contents are in lexer.string_literal ([]uint16)
    t_big_integer_literal = 7, // contents are in lexer.identifier (string)

    // pseudo-literals
    t_template_head = 8, // contents are in lexer.string_literal ([]uint16)
    t_template_middle = 9, // contents are in lexer.string_literal ([]uint16)
    t_template_tail = 10, // contents are in lexer.string_literal ([]uint16)

    // punctuation
    t_ampersand = 11,
    t_ampersand_ampersand = 12,
    t_asterisk = 13,
    t_asterisk_asterisk = 14,
    t_at = 15,
    t_bar = 16,
    t_bar_bar = 17,
    t_caret = 18,
    t_close_bracket = 19,
    t_close_paren = 20,
    t_colon = 21,
    t_comma = 22,
    t_dot = 23,
    t_dot_dot_dot = 24,
    t_equals_equals = 25,
    t_equals_equals_equals = 26,
    t_equals_greater_than = 27,
    t_exclamation = 28,
    t_exclamation_equals = 29,
    t_exclamation_equals_equals = 30,
    t_greater_than = 31,
    t_greater_than_equals = 32,
    t_greater_than_greater_than = 33,
    t_greater_than_greater_than_greater_than = 34,
    t_less_than = 35,
    t_less_than_equals = 36,
    t_less_than_less_than = 37,
    t_minus = 38,
    t_minus_minus = 39,
    t_open_brace = 40,
    t_open_bracket = 41,
    t_open_paren = 42,
    t_percent = 43,
    t_plus = 44,
    t_plus_plus = 45,
    t_question = 46,
    t_question_dot = 47,
    t_question_question = 48,
    t_semicolon = 49,
    t_slash = 50,
    t_tilde = 51,

    // assignments (keep in sync with is_assign() below)
    t_ampersand_ampersand_equals = 52,
    t_ampersand_equals = 53,
    t_asterisk_asterisk_equals = 54,
    t_asterisk_equals = 55,
    t_bar_bar_equals = 56,
    t_bar_equals = 57,
    t_caret_equals = 58,
    t_equals = 59,
    t_greater_than_greater_than_equals = 60,
    t_greater_than_greater_than_greater_than_equals = 61,
    t_less_than_less_than_equals = 62,
    t_minus_equals = 63,
    t_percent_equals = 64,
    t_plus_equals = 65,
    t_question_question_equals = 66,
    t_slash_equals = 67,

    // class-private fields and methods
    t_private_identifier = 68,

    // identifiers
    t_identifier = 69, // contents are in lexer.identifier (string)
    t_escaped_keyword = 70, // a keyword that has been escaped as an identifer

    // reserved words
    t_break = 71,
    t_case = 72,
    t_catch = 73,
    t_class = 74,
    t_const = 75,
    t_continue = 76,
    t_debugger = 77,
    t_default = 78,
    t_delete = 79,
    t_do = 80,
    t_else = 81,
    t_enum = 82,
    t_export = 83,
    t_extends = 84,
    t_false = 85,
    t_finally = 86,
    t_for = 87,
    t_function = 88,
    t_if = 89,
    t_import = 90,
    t_in = 91,
    t_instanceof = 92,
    t_new = 93,
    t_null = 94,
    t_return = 95,
    t_super = 96,
    t_switch = 97,
    t_this = 98,
    t_throw = 99,
    t_true = 100,
    t_try = 101,
    t_typeof = 102,
    t_var = 103,
    t_void = 104,
    t_while = 105,
    t_with = 106,

    pub fn isAssign(self: T) bool {
        return @intFromEnum(self) >= @intFromEnum(T.t_ampersand_ampersand_equals) and @intFromEnum(self) <= @intFromEnum(T.t_slash_equals);
    }

    pub fn isReservedWord(self: T) bool {
        return @intFromEnum(self) >= @intFromEnum(T.t_break) and @intFromEnum(self) <= @intFromEnum(T.t_with);
    }

    pub fn isString(self: T) bool {
        switch (self) {
            T.t_no_substitution_template_literal, T.t_string_literal, T.t_template_head, T.t_template_middle, T.t_template_tail => {
                return true;
            },
            else => {
                return false;
            },
        }
    }

    pub fn isCloseBraceOrEOF(self: T) bool {
        return @intFromEnum(self) <= @intFromEnum(T.t_close_brace);
    }
};

pub const Keywords = ComptimeStringMap(T, .{
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

pub const StrictModeReservedWords = ComptimeStringMap(void, .{
    .{ "implements", {} },
    .{ "interface", {} },
    .{ "let", {} },
    .{ "package", {} },
    .{ "private", {} },
    .{ "protected", {} },
    .{ "public", {} },
    .{ "static", {} },
    .{ "yield", {} },
});

pub const StrictModeReservedWordsRemap = ComptimeStringMap(string, .{
    .{ "implements", "_implements" },
    .{ "interface", "_interface" },
    .{ "let", "_let" },
    .{ "package", "_package" },
    .{ "private", "_private" },
    .{ "protected", "_protected" },
    .{ "public", "_public" },
    .{ "static", "_static" },
    .{ "yield", "_yield" },
});

pub const PropertyModifierKeyword = enum {
    p_abstract,
    p_async,
    p_declare,
    p_get,
    p_override,
    p_private,
    p_protected,
    p_public,
    p_readonly,
    p_set,
    p_static,

    pub const List = ComptimeStringMap(PropertyModifierKeyword, .{
        .{ "abstract", .p_abstract },
        .{ "async", .p_async },
        .{ "declare", .p_declare },
        .{ "get", .p_get },
        .{ "override", .p_override },
        .{ "private", .p_private },
        .{ "protected", .p_protected },
        .{ "public", .p_public },
        .{ "readonly", .p_readonly },
        .{ "set", .p_set },
        .{ "static", .p_static },
    });
};

pub const TypeScriptAccessibilityModifier = ComptimeStringMap(void, .{
    .{ "override", void },
    .{ "private", void },
    .{ "protected", void },
    .{ "public", void },
    .{ "readonly", void },
});

pub const TokenEnumType = std.EnumArray(T, []const u8);

pub const tokenToString = brk: {
    const TEndOfFile = "end of file".*;
    const TSyntaxError = "syntax error".*;
    const THashbang = "hashbang comment".*;

    // Literals
    const TNoSubstitutionTemplateLiteral = "template literal".*;
    const TNumericLiteral = "number".*;
    const TStringLiteral = "string".*;
    const TBigIntegerLiteral = "bigint".*;

    // Pseudo-literals
    const TTemplateHead = "template literal".*;
    const TTemplateMiddle = "template literal".*;
    const TTemplateTail = "template literal".*;

    // Punctuation
    const TAmpersand = "\"&\"".*;
    const TAmpersandAmpersand = "\"&&\"".*;
    const TAsterisk = "\"*\"".*;
    const TAsteriskAsterisk = "\"**\"".*;
    const TAt = "\"@\"".*;
    const TBar = "\"|\"".*;
    const TBarBar = "\"||\"".*;
    const TCaret = "\"^\"".*;
    const TCloseBrace = "\"}\"".*;
    const TCloseBracket = "\"]\"".*;
    const TCloseParen = "\")\"".*;
    const TColon = "\" =\"".*;
    const TComma = "\",\"".*;
    const TDot = "\".\"".*;
    const TDotDotDot = "\"...\"".*;
    const TEqualsEquals = "\"==\"".*;
    const TEqualsEqualsEquals = "\"===\"".*;
    const TEqualsGreaterThan = "\"=>\"".*;
    const TExclamation = "\"!\"".*;
    const TExclamationEquals = "\"!=\"".*;
    const TExclamationEqualsEquals = "\"!==\"".*;
    const TGreaterThan = "\">\"".*;
    const TGreaterThanEquals = "\">=\"".*;
    const TGreaterThanGreaterThan = "\">>\"".*;
    const TGreaterThanGreaterThanGreaterThan = "\">>>\"".*;
    const TLessThan = "\"<\"".*;
    const TLessThanEquals = "\"<=\"".*;
    const TLessThanLessThan = "\"<<\"".*;
    const TMinus = "\"-\"".*;
    const TMinusMinus = "\"--\"".*;
    const TOpenBrace = "\"{\"".*;
    const TOpenBracket = "\"[\"".*;
    const TOpenParen = "\"(\"".*;
    const TPercent = "\"%\"".*;
    const TPlus = "\"+\"".*;
    const TPlusPlus = "\"++\"".*;
    const TQuestion = "\"?\"".*;
    const TQuestionDot = "\"?.\"".*;
    const TQuestionQuestion = "\"??\"".*;
    const TSemicolon = "\";\"".*;
    const TSlash = "\"/\"".*;
    const TTilde = "\"~\"".*;

    // Assignments
    const TAmpersandAmpersandEquals = "\"&&=\"".*;
    const TAmpersandEquals = "\"&=\"".*;
    const TAsteriskAsteriskEquals = "\"**=\"".*;
    const TAsteriskEquals = "\"*=\"".*;
    const TBarBarEquals = "\"||=\"".*;
    const TBarEquals = "\"|=\"".*;
    const TCaretEquals = "\"^=\"".*;
    const TEquals = "\"=\"".*;
    const TGreaterThanGreaterThanEquals = "\">>=\"".*;
    const TGreaterThanGreaterThanGreaterThanEquals = "\">>>=\"".*;
    const TLessThanLessThanEquals = "\"<<=\"".*;
    const TMinusEquals = "\"-=\"".*;
    const TPercentEquals = "\"%=\"".*;
    const TPlusEquals = "\"+=\"".*;
    const TQuestionQuestionEquals = "\"??=\"".*;
    const TSlashEquals = "\"/=\"".*;

    // Class-private fields and methods
    const TPrivateIdentifier = "private identifier".*;

    // Identifiers
    const TIdentifier = "identifier".*;
    const TEscapedKeyword = "escaped keyword".*;

    // Reserved words
    const TBreak = "\"break\"".*;
    const TCase = "\"case\"".*;
    const TCatch = "\"catch\"".*;
    const TClass = "\"class\"".*;
    const TConst = "\"const\"".*;
    const TContinue = "\"continue\"".*;
    const TDebugger = "\"debugger\"".*;
    const TDefault = "\"default\"".*;
    const TDelete = "\"delete\"".*;
    const TDo = "\"do\"".*;
    const TElse = "\"else\"".*;
    const TEnum = "\"enum\"".*;
    const TExport = "\"export\"".*;
    const TExtends = "\"extends\"".*;
    const TFalse = "\"false\"".*;
    const TFinally = "\"finally\"".*;
    const TFor = "\"for\"".*;
    const TFunction = "\"function\"".*;
    const TIf = "\"if\"".*;
    const TImport = "\"import\"".*;
    const TIn = "\"in\"".*;
    const TInstanceof = "\"instanceof\"".*;
    const TNew = "\"new\"".*;
    const TNull = "\"null\"".*;
    const TReturn = "\"return\"".*;
    const TSuper = "\"super\"".*;
    const TSwitch = "\"switch\"".*;
    const TThis = "\"this\"".*;
    const TThrow = "\"throw\"".*;
    const TTrue = "\"true\"".*;
    const TTry = "\"try\"".*;
    const TTypeof = "\"typeof\"".*;
    const TVar = "\"var\"".*;
    const TVoid = "\"void\"".*;
    const TWhile = "\"while\"".*;
    const TWith = "\"with\"".*;

    var tokenEnums = TokenEnumType.initUndefined();

    tokenEnums.set(T.t_end_of_file, &TEndOfFile);
    tokenEnums.set(T.t_syntax_error, &TSyntaxError);
    tokenEnums.set(T.t_hashbang, &THashbang);

    // Literals
    tokenEnums.set(T.t_no_substitution_template_literal, &TNoSubstitutionTemplateLiteral);
    tokenEnums.set(T.t_numeric_literal, &TNumericLiteral);
    tokenEnums.set(T.t_string_literal, &TStringLiteral);
    tokenEnums.set(T.t_big_integer_literal, &TBigIntegerLiteral);

    // Pseudo-literals
    tokenEnums.set(T.t_template_head, &TTemplateHead);
    tokenEnums.set(T.t_template_middle, &TTemplateMiddle);
    tokenEnums.set(T.t_template_tail, &TTemplateTail);

    // Punctuation
    tokenEnums.set(T.t_ampersand, &TAmpersand);
    tokenEnums.set(T.t_ampersand_ampersand, &TAmpersandAmpersand);
    tokenEnums.set(T.t_asterisk, &TAsterisk);
    tokenEnums.set(T.t_asterisk_asterisk, &TAsteriskAsterisk);
    tokenEnums.set(T.t_at, &TAt);
    tokenEnums.set(T.t_bar, &TBar);
    tokenEnums.set(T.t_bar_bar, &TBarBar);
    tokenEnums.set(T.t_caret, &TCaret);
    tokenEnums.set(T.t_close_brace, &TCloseBrace);
    tokenEnums.set(T.t_close_bracket, &TCloseBracket);
    tokenEnums.set(T.t_close_paren, &TCloseParen);
    tokenEnums.set(T.t_colon, &TColon);
    tokenEnums.set(T.t_comma, &TComma);
    tokenEnums.set(T.t_dot, &TDot);
    tokenEnums.set(T.t_dot_dot_dot, &TDotDotDot);
    tokenEnums.set(T.t_equals_equals, &TEqualsEquals);
    tokenEnums.set(T.t_equals_equals_equals, &TEqualsEqualsEquals);
    tokenEnums.set(T.t_equals_greater_than, &TEqualsGreaterThan);
    tokenEnums.set(T.t_exclamation, &TExclamation);
    tokenEnums.set(T.t_exclamation_equals, &TExclamationEquals);
    tokenEnums.set(T.t_exclamation_equals_equals, &TExclamationEqualsEquals);
    tokenEnums.set(T.t_greater_than, &TGreaterThan);
    tokenEnums.set(T.t_greater_than_equals, &TGreaterThanEquals);
    tokenEnums.set(T.t_greater_than_greater_than, &TGreaterThanGreaterThan);
    tokenEnums.set(T.t_greater_than_greater_than_greater_than, &TGreaterThanGreaterThanGreaterThan);
    tokenEnums.set(T.t_less_than, &TLessThan);
    tokenEnums.set(T.t_less_than_equals, &TLessThanEquals);
    tokenEnums.set(T.t_less_than_less_than, &TLessThanLessThan);
    tokenEnums.set(T.t_minus, &TMinus);
    tokenEnums.set(T.t_minus_minus, &TMinusMinus);
    tokenEnums.set(T.t_open_brace, &TOpenBrace);
    tokenEnums.set(T.t_open_bracket, &TOpenBracket);
    tokenEnums.set(T.t_open_paren, &TOpenParen);
    tokenEnums.set(T.t_percent, &TPercent);
    tokenEnums.set(T.t_plus, &TPlus);
    tokenEnums.set(T.t_plus_plus, &TPlusPlus);
    tokenEnums.set(T.t_question, &TQuestion);
    tokenEnums.set(T.t_question_dot, &TQuestionDot);
    tokenEnums.set(T.t_question_question, &TQuestionQuestion);
    tokenEnums.set(T.t_semicolon, &TSemicolon);
    tokenEnums.set(T.t_slash, &TSlash);
    tokenEnums.set(T.t_tilde, &TTilde);

    // Assignments
    tokenEnums.set(T.t_ampersand_ampersand_equals, &TAmpersandAmpersandEquals);
    tokenEnums.set(T.t_ampersand_equals, &TAmpersandEquals);
    tokenEnums.set(T.t_asterisk_asterisk_equals, &TAsteriskAsteriskEquals);
    tokenEnums.set(T.t_asterisk_equals, &TAsteriskEquals);
    tokenEnums.set(T.t_bar_bar_equals, &TBarBarEquals);
    tokenEnums.set(T.t_bar_equals, &TBarEquals);
    tokenEnums.set(T.t_caret_equals, &TCaretEquals);
    tokenEnums.set(T.t_equals, &TEquals);
    tokenEnums.set(T.t_greater_than_greater_than_equals, &TGreaterThanGreaterThanEquals);
    tokenEnums.set(T.t_greater_than_greater_than_greater_than_equals, &TGreaterThanGreaterThanGreaterThanEquals);
    tokenEnums.set(T.t_less_than_less_than_equals, &TLessThanLessThanEquals);
    tokenEnums.set(T.t_minus_equals, &TMinusEquals);
    tokenEnums.set(T.t_percent_equals, &TPercentEquals);
    tokenEnums.set(T.t_plus_equals, &TPlusEquals);
    tokenEnums.set(T.t_question_question_equals, &TQuestionQuestionEquals);
    tokenEnums.set(T.t_slash_equals, &TSlashEquals);

    // Class-private fields and methods
    tokenEnums.set(T.t_private_identifier, &TPrivateIdentifier);

    // Identifiers
    tokenEnums.set(T.t_identifier, &TIdentifier);
    tokenEnums.set(T.t_escaped_keyword, &TEscapedKeyword);

    // Reserved words
    tokenEnums.set(T.t_break, &TBreak);
    tokenEnums.set(T.t_case, &TCase);
    tokenEnums.set(T.t_catch, &TCatch);
    tokenEnums.set(T.t_class, &TClass);
    tokenEnums.set(T.t_const, &TConst);
    tokenEnums.set(T.t_continue, &TContinue);
    tokenEnums.set(T.t_debugger, &TDebugger);
    tokenEnums.set(T.t_default, &TDefault);
    tokenEnums.set(T.t_delete, &TDelete);
    tokenEnums.set(T.t_do, &TDo);
    tokenEnums.set(T.t_else, &TElse);
    tokenEnums.set(T.t_enum, &TEnum);
    tokenEnums.set(T.t_export, &TExport);
    tokenEnums.set(T.t_extends, &TExtends);
    tokenEnums.set(T.t_false, &TFalse);
    tokenEnums.set(T.t_finally, &TFinally);
    tokenEnums.set(T.t_for, &TFor);
    tokenEnums.set(T.t_function, &TFunction);
    tokenEnums.set(T.t_if, &TIf);
    tokenEnums.set(T.t_import, &TImport);
    tokenEnums.set(T.t_in, &TIn);
    tokenEnums.set(T.t_instanceof, &TInstanceof);
    tokenEnums.set(T.t_new, &TNew);
    tokenEnums.set(T.t_null, &TNull);
    tokenEnums.set(T.t_return, &TReturn);
    tokenEnums.set(T.t_super, &TSuper);
    tokenEnums.set(T.t_switch, &TSwitch);
    tokenEnums.set(T.t_this, &TThis);
    tokenEnums.set(T.t_throw, &TThrow);
    tokenEnums.set(T.t_true, &TTrue);
    tokenEnums.set(T.t_try, &TTry);
    tokenEnums.set(T.t_typeof, &TTypeof);
    tokenEnums.set(T.t_var, &TVar);
    tokenEnums.set(T.t_void, &TVoid);
    tokenEnums.set(T.t_while, &TWhile);
    tokenEnums.set(T.t_with, &TWith);

    break :brk tokenEnums;
};

pub const TypescriptStmtKeyword = enum {
    ts_stmt_type,
    ts_stmt_namespace,
    ts_stmt_module,
    ts_stmt_interface,
    ts_stmt_abstract,
    ts_stmt_global,
    ts_stmt_declare,

    pub const List = ComptimeStringMap(TypescriptStmtKeyword, .{
        .{
            "type",
            TypescriptStmtKeyword.ts_stmt_type,
        },
        .{
            "namespace",
            TypescriptStmtKeyword.ts_stmt_namespace,
        },
        .{
            "module",
            TypescriptStmtKeyword.ts_stmt_module,
        },
        .{
            "interface",
            TypescriptStmtKeyword.ts_stmt_interface,
        },
        .{
            "abstract",
            TypescriptStmtKeyword.ts_stmt_abstract,
        },
        .{
            "global",
            TypescriptStmtKeyword.ts_stmt_global,
        },
        .{
            "declare",
            TypescriptStmtKeyword.ts_stmt_declare,
        },
    });
};

// In a microbenchmark, this outperforms
pub const jsxEntity = ComptimeStringMap(CodePoint, .{
    .{ "Aacute", @as(CodePoint, 0x00C1) },
    .{ "aacute", @as(CodePoint, 0x00E1) },
    .{ "Acirc", @as(CodePoint, 0x00C2) },
    .{ "acirc", @as(CodePoint, 0x00E2) },
    .{ "acute", @as(CodePoint, 0x00B4) },
    .{ "AElig", @as(CodePoint, 0x00C6) },
    .{ "aelig", @as(CodePoint, 0x00E6) },
    .{ "Agrave", @as(CodePoint, 0x00C0) },
    .{ "agrave", @as(CodePoint, 0x00E0) },
    .{ "alefsym", @as(CodePoint, 0x2135) },
    .{ "Alpha", @as(CodePoint, 0x0391) },
    .{ "alpha", @as(CodePoint, 0x03B1) },
    .{ "amp", @as(CodePoint, 0x0026) },
    .{ "and", @as(CodePoint, 0x2227) },
    .{ "ang", @as(CodePoint, 0x2220) },
    .{ "apos", @as(CodePoint, 0x0027) },
    .{ "Aring", @as(CodePoint, 0x00C5) },
    .{ "aring", @as(CodePoint, 0x00E5) },
    .{ "asymp", @as(CodePoint, 0x2248) },
    .{ "Atilde", @as(CodePoint, 0x00C3) },
    .{ "atilde", @as(CodePoint, 0x00E3) },
    .{ "Auml", @as(CodePoint, 0x00C4) },
    .{ "auml", @as(CodePoint, 0x00E4) },
    .{ "bdquo", @as(CodePoint, 0x201E) },
    .{ "Beta", @as(CodePoint, 0x0392) },
    .{ "beta", @as(CodePoint, 0x03B2) },
    .{ "brvbar", @as(CodePoint, 0x00A6) },
    .{ "bull", @as(CodePoint, 0x2022) },
    .{ "cap", @as(CodePoint, 0x2229) },
    .{ "Ccedil", @as(CodePoint, 0x00C7) },
    .{ "ccedil", @as(CodePoint, 0x00E7) },
    .{ "cedil", @as(CodePoint, 0x00B8) },
    .{ "cent", @as(CodePoint, 0x00A2) },
    .{ "Chi", @as(CodePoint, 0x03A7) },
    .{ "chi", @as(CodePoint, 0x03C7) },
    .{ "circ", @as(CodePoint, 0x02C6) },
    .{ "clubs", @as(CodePoint, 0x2663) },
    .{ "cong", @as(CodePoint, 0x2245) },
    .{ "copy", @as(CodePoint, 0x00A9) },
    .{ "crarr", @as(CodePoint, 0x21B5) },
    .{ "cup", @as(CodePoint, 0x222A) },
    .{ "curren", @as(CodePoint, 0x00A4) },
    .{ "dagger", @as(CodePoint, 0x2020) },
    .{ "Dagger", @as(CodePoint, 0x2021) },
    .{ "darr", @as(CodePoint, 0x2193) },
    .{ "dArr", @as(CodePoint, 0x21D3) },
    .{ "deg", @as(CodePoint, 0x00B0) },
    .{ "Delta", @as(CodePoint, 0x0394) },
    .{ "delta", @as(CodePoint, 0x03B4) },
    .{ "diams", @as(CodePoint, 0x2666) },
    .{ "divide", @as(CodePoint, 0x00F7) },
    .{ "Eacute", @as(CodePoint, 0x00C9) },
    .{ "eacute", @as(CodePoint, 0x00E9) },
    .{ "Ecirc", @as(CodePoint, 0x00CA) },
    .{ "ecirc", @as(CodePoint, 0x00EA) },
    .{ "Egrave", @as(CodePoint, 0x00C8) },
    .{ "egrave", @as(CodePoint, 0x00E8) },
    .{ "empty", @as(CodePoint, 0x2205) },
    .{ "emsp", @as(CodePoint, 0x2003) },
    .{ "ensp", @as(CodePoint, 0x2002) },
    .{ "Epsilon", @as(CodePoint, 0x0395) },
    .{ "epsilon", @as(CodePoint, 0x03B5) },
    .{ "equiv", @as(CodePoint, 0x2261) },
    .{ "Eta", @as(CodePoint, 0x0397) },
    .{ "eta", @as(CodePoint, 0x03B7) },
    .{ "ETH", @as(CodePoint, 0x00D0) },
    .{ "eth", @as(CodePoint, 0x00F0) },
    .{ "Euml", @as(CodePoint, 0x00CB) },
    .{ "euml", @as(CodePoint, 0x00EB) },
    .{ "euro", @as(CodePoint, 0x20AC) },
    .{ "exist", @as(CodePoint, 0x2203) },
    .{ "fnof", @as(CodePoint, 0x0192) },
    .{ "forall", @as(CodePoint, 0x2200) },
    .{ "frac12", @as(CodePoint, 0x00BD) },
    .{ "frac14", @as(CodePoint, 0x00BC) },
    .{ "frac34", @as(CodePoint, 0x00BE) },
    .{ "frasl", @as(CodePoint, 0x2044) },
    .{ "Gamma", @as(CodePoint, 0x0393) },
    .{ "gamma", @as(CodePoint, 0x03B3) },
    .{ "ge", @as(CodePoint, 0x2265) },
    .{ "gt", @as(CodePoint, 0x003E) },
    .{ "harr", @as(CodePoint, 0x2194) },
    .{ "hArr", @as(CodePoint, 0x21D4) },
    .{ "hearts", @as(CodePoint, 0x2665) },
    .{ "hellip", @as(CodePoint, 0x2026) },
    .{ "Iacute", @as(CodePoint, 0x00CD) },
    .{ "iacute", @as(CodePoint, 0x00ED) },
    .{ "Icirc", @as(CodePoint, 0x00CE) },
    .{ "icirc", @as(CodePoint, 0x00EE) },
    .{ "iexcl", @as(CodePoint, 0x00A1) },
    .{ "Igrave", @as(CodePoint, 0x00CC) },
    .{ "igrave", @as(CodePoint, 0x00EC) },
    .{ "image", @as(CodePoint, 0x2111) },
    .{ "infin", @as(CodePoint, 0x221E) },
    .{ "int", @as(CodePoint, 0x222B) },
    .{ "Iota", @as(CodePoint, 0x0399) },
    .{ "iota", @as(CodePoint, 0x03B9) },
    .{ "iquest", @as(CodePoint, 0x00BF) },
    .{ "isin", @as(CodePoint, 0x2208) },
    .{ "Iuml", @as(CodePoint, 0x00CF) },
    .{ "iuml", @as(CodePoint, 0x00EF) },
    .{ "Kappa", @as(CodePoint, 0x039A) },
    .{ "kappa", @as(CodePoint, 0x03BA) },
    .{ "Lambda", @as(CodePoint, 0x039B) },
    .{ "lambda", @as(CodePoint, 0x03BB) },
    .{ "lang", @as(CodePoint, 0x2329) },
    .{ "laquo", @as(CodePoint, 0x00AB) },
    .{ "larr", @as(CodePoint, 0x2190) },
    .{ "lArr", @as(CodePoint, 0x21D0) },
    .{ "lceil", @as(CodePoint, 0x2308) },
    .{ "ldquo", @as(CodePoint, 0x201C) },
    .{ "le", @as(CodePoint, 0x2264) },
    .{ "lfloor", @as(CodePoint, 0x230A) },
    .{ "lowast", @as(CodePoint, 0x2217) },
    .{ "loz", @as(CodePoint, 0x25CA) },
    .{ "lrm", @as(CodePoint, 0x200E) },
    .{ "lsaquo", @as(CodePoint, 0x2039) },
    .{ "lsquo", @as(CodePoint, 0x2018) },
    .{ "lt", @as(CodePoint, 0x003C) },
    .{ "macr", @as(CodePoint, 0x00AF) },
    .{ "mdash", @as(CodePoint, 0x2014) },
    .{ "micro", @as(CodePoint, 0x00B5) },
    .{ "middot", @as(CodePoint, 0x00B7) },
    .{ "minus", @as(CodePoint, 0x2212) },
    .{ "Mu", @as(CodePoint, 0x039C) },
    .{ "mu", @as(CodePoint, 0x03BC) },
    .{ "nabla", @as(CodePoint, 0x2207) },
    .{ "nbsp", @as(CodePoint, 0x00A0) },
    .{ "ndash", @as(CodePoint, 0x2013) },
    .{ "ne", @as(CodePoint, 0x2260) },
    .{ "ni", @as(CodePoint, 0x220B) },
    .{ "not", @as(CodePoint, 0x00AC) },
    .{ "notin", @as(CodePoint, 0x2209) },
    .{ "nsub", @as(CodePoint, 0x2284) },
    .{ "Ntilde", @as(CodePoint, 0x00D1) },
    .{ "ntilde", @as(CodePoint, 0x00F1) },
    .{ "Nu", @as(CodePoint, 0x039D) },
    .{ "nu", @as(CodePoint, 0x03BD) },
    .{ "Oacute", @as(CodePoint, 0x00D3) },
    .{ "oacute", @as(CodePoint, 0x00F3) },
    .{ "Ocirc", @as(CodePoint, 0x00D4) },
    .{ "ocirc", @as(CodePoint, 0x00F4) },
    .{ "OElig", @as(CodePoint, 0x0152) },
    .{ "oelig", @as(CodePoint, 0x0153) },
    .{ "Ograve", @as(CodePoint, 0x00D2) },
    .{ "ograve", @as(CodePoint, 0x00F2) },
    .{ "oline", @as(CodePoint, 0x203E) },
    .{ "Omega", @as(CodePoint, 0x03A9) },
    .{ "omega", @as(CodePoint, 0x03C9) },
    .{ "Omicron", @as(CodePoint, 0x039F) },
    .{ "omicron", @as(CodePoint, 0x03BF) },
    .{ "oplus", @as(CodePoint, 0x2295) },
    .{ "or", @as(CodePoint, 0x2228) },
    .{ "ordf", @as(CodePoint, 0x00AA) },
    .{ "ordm", @as(CodePoint, 0x00BA) },
    .{ "Oslash", @as(CodePoint, 0x00D8) },
    .{ "oslash", @as(CodePoint, 0x00F8) },
    .{ "Otilde", @as(CodePoint, 0x00D5) },
    .{ "otilde", @as(CodePoint, 0x00F5) },
    .{ "otimes", @as(CodePoint, 0x2297) },
    .{ "Ouml", @as(CodePoint, 0x00D6) },
    .{ "ouml", @as(CodePoint, 0x00F6) },
    .{ "para", @as(CodePoint, 0x00B6) },
    .{ "part", @as(CodePoint, 0x2202) },
    .{ "permil", @as(CodePoint, 0x2030) },
    .{ "perp", @as(CodePoint, 0x22A5) },
    .{ "Phi", @as(CodePoint, 0x03A6) },
    .{ "phi", @as(CodePoint, 0x03C6) },
    .{ "Pi", @as(CodePoint, 0x03A0) },
    .{ "pi", @as(CodePoint, 0x03C0) },
    .{ "piv", @as(CodePoint, 0x03D6) },
    .{ "plusmn", @as(CodePoint, 0x00B1) },
    .{ "pound", @as(CodePoint, 0x00A3) },
    .{ "prime", @as(CodePoint, 0x2032) },
    .{ "Prime", @as(CodePoint, 0x2033) },
    .{ "prod", @as(CodePoint, 0x220F) },
    .{ "prop", @as(CodePoint, 0x221D) },
    .{ "Psi", @as(CodePoint, 0x03A8) },
    .{ "psi", @as(CodePoint, 0x03C8) },
    .{ "quot", @as(CodePoint, 0x0022) },
    .{ "radic", @as(CodePoint, 0x221A) },
    .{ "rang", @as(CodePoint, 0x232A) },
    .{ "raquo", @as(CodePoint, 0x00BB) },
    .{ "rarr", @as(CodePoint, 0x2192) },
    .{ "rArr", @as(CodePoint, 0x21D2) },
    .{ "rceil", @as(CodePoint, 0x2309) },
    .{ "rdquo", @as(CodePoint, 0x201D) },
    .{ "real", @as(CodePoint, 0x211C) },
    .{ "reg", @as(CodePoint, 0x00AE) },
    .{ "rfloor", @as(CodePoint, 0x230B) },
    .{ "Rho", @as(CodePoint, 0x03A1) },
    .{ "rho", @as(CodePoint, 0x03C1) },
    .{ "rlm", @as(CodePoint, 0x200F) },
    .{ "rsaquo", @as(CodePoint, 0x203A) },
    .{ "rsquo", @as(CodePoint, 0x2019) },
    .{ "sbquo", @as(CodePoint, 0x201A) },
    .{ "Scaron", @as(CodePoint, 0x0160) },
    .{ "scaron", @as(CodePoint, 0x0161) },
    .{ "sdot", @as(CodePoint, 0x22C5) },
    .{ "sect", @as(CodePoint, 0x00A7) },
    .{ "shy", @as(CodePoint, 0x00AD) },
    .{ "Sigma", @as(CodePoint, 0x03A3) },
    .{ "sigma", @as(CodePoint, 0x03C3) },
    .{ "sigmaf", @as(CodePoint, 0x03C2) },
    .{ "sim", @as(CodePoint, 0x223C) },
    .{ "spades", @as(CodePoint, 0x2660) },
    .{ "sub", @as(CodePoint, 0x2282) },
    .{ "sube", @as(CodePoint, 0x2286) },
    .{ "sum", @as(CodePoint, 0x2211) },
    .{ "sup", @as(CodePoint, 0x2283) },
    .{ "sup1", @as(CodePoint, 0x00B9) },
    .{ "sup2", @as(CodePoint, 0x00B2) },
    .{ "sup3", @as(CodePoint, 0x00B3) },
    .{ "supe", @as(CodePoint, 0x2287) },
    .{ "szlig", @as(CodePoint, 0x00DF) },
    .{ "Tau", @as(CodePoint, 0x03A4) },
    .{ "tau", @as(CodePoint, 0x03C4) },
    .{ "there4", @as(CodePoint, 0x2234) },
    .{ "Theta", @as(CodePoint, 0x0398) },
    .{ "theta", @as(CodePoint, 0x03B8) },
    .{ "thetasym", @as(CodePoint, 0x03D1) },
    .{ "thinsp", @as(CodePoint, 0x2009) },
    .{ "THORN", @as(CodePoint, 0x00DE) },
    .{ "thorn", @as(CodePoint, 0x00FE) },
    .{ "tilde", @as(CodePoint, 0x02DC) },
    .{ "times", @as(CodePoint, 0x00D7) },
    .{ "trade", @as(CodePoint, 0x2122) },
    .{ "Uacute", @as(CodePoint, 0x00DA) },
    .{ "uacute", @as(CodePoint, 0x00FA) },
    .{ "uarr", @as(CodePoint, 0x2191) },
    .{ "uArr", @as(CodePoint, 0x21D1) },
    .{ "Ucirc", @as(CodePoint, 0x00DB) },
    .{ "ucirc", @as(CodePoint, 0x00FB) },
    .{ "Ugrave", @as(CodePoint, 0x00D9) },
    .{ "ugrave", @as(CodePoint, 0x00F9) },
    .{ "uml", @as(CodePoint, 0x00A8) },
    .{ "upsih", @as(CodePoint, 0x03D2) },
    .{ "Upsilon", @as(CodePoint, 0x03A5) },
    .{ "upsilon", @as(CodePoint, 0x03C5) },
    .{ "Uuml", @as(CodePoint, 0x00DC) },
    .{ "uuml", @as(CodePoint, 0x00FC) },
    .{ "weierp", @as(CodePoint, 0x2118) },
    .{ "Xi", @as(CodePoint, 0x039E) },
    .{ "xi", @as(CodePoint, 0x03BE) },
    .{ "Yacute", @as(CodePoint, 0x00DD) },
    .{ "yacute", @as(CodePoint, 0x00FD) },
    .{ "yen", @as(CodePoint, 0x00A5) },
    .{ "yuml", @as(CodePoint, 0x00FF) },
    .{ "Yuml", @as(CodePoint, 0x0178) },
    .{ "Zeta", @as(CodePoint, 0x0396) },
    .{ "zeta", @as(CodePoint, 0x03B6) },
    .{ "zwj", @as(CodePoint, 0x200D) },
    .{ "zwnj", @as(CodePoint, 0x200C) },
});

pub const CharacterType = enum(u8) {
    /// Start of an identifier: a-z, A-Z, $, _
    identifier_start = @as(u8, @intFromEnum(T.t_identifier)),

    /// Invalid/unsupported characters
    invalid = @as(u8, @intFromEnum(T.t_syntax_error)),
    /// Line breaks: \n, \r
    line_terminator = @as(u8, @intFromEnum(T.t_bar_bar)),
    /// '!'
    exclamation_mark = @as(u8, @intFromEnum(T.t_exclamation)),
    /// (
    open_paren = @as(u8, @intFromEnum(T.t_open_paren)),
    /// )
    close_paren = @as(u8, @intFromEnum(T.t_close_paren)),
    /// [
    open_bracket = @as(u8, @intFromEnum(T.t_open_bracket)),
    /// ]
    close_bracket = @as(u8, @intFromEnum(T.t_close_bracket)),
    /// ,
    comma = @as(u8, @intFromEnum(T.t_comma)),
    /// :
    colon = @as(u8, @intFromEnum(T.t_colon)),
    /// ?
    question = @as(u8, @intFromEnum(T.t_question)),
    /// ~
    tilde = @as(u8, @intFromEnum(T.t_tilde)),
    /// '
    quote = @as(u8, @intFromEnum(T.t_string_literal)),
    /// "
    double_quote = @as(u8, @intFromEnum(T.t_template_middle)),
    /// `
    back_quote = @as(u8, @intFromEnum(T.t_no_substitution_template_literal)),
    /// .0-9
    dot_or_number = @as(u8, @intFromEnum(T.t_numeric_literal)),
    /// /
    slash = @as(u8, @intFromEnum(T.t_slash)),
    /// \
    back_slash = @as(u8, @intFromEnum(T.t_break)),
    /// ;
    semicolon = @as(u8, @intFromEnum(T.t_semicolon)),
    /// {
    open_brace = @as(u8, @intFromEnum(T.t_open_brace)),
    /// }
    close_brace = @as(u8, @intFromEnum(T.t_close_brace)),
    /// +
    add = @as(u8, @intFromEnum(T.t_plus)),
    /// -
    sub = @as(u8, @intFromEnum(T.t_minus)),
    /// *
    multiply = @as(u8, @intFromEnum(T.t_asterisk)),
    /// %
    modulo = @as(u8, @intFromEnum(T.t_percent)),
    /// &
    @"and" = @as(u8, @intFromEnum(T.t_ampersand)),
    /// ^
    xor = @as(u8, @intFromEnum(T.t_caret)),
    /// |
    @"or" = @as(u8, @intFromEnum(T.t_bar)),
    /// <
    less = @as(u8, @intFromEnum(T.t_less_than)),
    /// >
    greater = @as(u8, @intFromEnum(T.t_greater_than)),
    /// =
    equal = @as(u8, @intFromEnum(T.t_equals)),
    /// Space, tab, etc
    white_space = @as(u8, @intFromEnum(T.t_super)), // Using arbitrary non-conflicting valu)e
    /// #
    hash = @as(u8, @intFromEnum(T.t_hashbang)),
    /// @
    at = @as(u8, @intFromEnum(T.t_at)),

    eof = 255,

    // Lookup table for ASCII characters (0-127)
    const ascii_types = [128]CharacterType{
        // 0-31 control characters
        .invalid, // NUL
        .invalid, // SOH
        .invalid, // STX
        .invalid, // ETX
        .invalid, // EOT
        .invalid, // ENQ
        .invalid, // ACK
        .invalid, // BEL
        .invalid, // BS
        .white_space, // TAB
        .line_terminator, // LF
        .white_space, // VT
        .white_space, // FF
        .line_terminator, // CR
        .invalid, // SO
        .invalid, // SI
        .invalid, // DLE
        .invalid, // DC1
        .invalid, // DC2
        .invalid, // DC3
        .invalid, // DC4
        .invalid, // NAK
        .invalid, // SYN
        .invalid, // ETB
        .invalid, // CAN
        .invalid, // EM
        .invalid, // SUB
        .invalid, // ESC
        .invalid, // FS
        .invalid, // GS
        .invalid, // RS
        .invalid, // US

        // 32-47 punctuation and symbols
        .white_space, // Space
        .exclamation_mark, // !
        .double_quote, // "
        .hash, // #
        .identifier_start, // $
        .modulo, // %
        .@"and", // &
        .quote, // '
        .open_paren, // (
        .close_paren, // )
        .multiply, // *
        .add, // +
        .comma, // ,
        .sub, // -
        .dot_or_number, // .
        .slash, // /

        // 48-57 numbers
        .dot_or_number, // 0
        .dot_or_number, .dot_or_number, .dot_or_number, .dot_or_number, .dot_or_number, // 1-5
        .dot_or_number, .dot_or_number, .dot_or_number, .dot_or_number, // 6-9

        // 58-64 more punctuation
        .colon, // :
        .semicolon, // ;
        .less, // <
        .equal, // =
        .greater, // >
        .question, // ?
        .at, // @

        // 65-90 uppercase letters
        .identifier_start, .identifier_start, .identifier_start, .identifier_start, .identifier_start, // A-E
        .identifier_start, .identifier_start, .identifier_start, .identifier_start, .identifier_start, // F-J
        .identifier_start, .identifier_start, .identifier_start, .identifier_start, .identifier_start, // K-O
        .identifier_start, .identifier_start, .identifier_start, .identifier_start, .identifier_start, // P-T
        .identifier_start, .identifier_start, .identifier_start, .identifier_start, .identifier_start, // U-Y
        .identifier_start, // Z

        // 91-96 more punctuation
        .open_bracket, // [
        .back_slash, // \
        .close_bracket, // ]
        .xor, // ^
        .identifier_start, // _
        .back_quote, // `

        // 97-122 lowercase letters
        .identifier_start, .identifier_start, .identifier_start, .identifier_start, .identifier_start, // a-e
        .identifier_start, .identifier_start, .identifier_start, .identifier_start, .identifier_start, // f-j
        .identifier_start, .identifier_start, .identifier_start, .identifier_start, .identifier_start, // k-o
        .identifier_start, .identifier_start, .identifier_start, .identifier_start, .identifier_start, // p-t
        .identifier_start, .identifier_start, .identifier_start, .identifier_start, .identifier_start, // u-y
        .identifier_start, // z

        // 123-127 final punctuation
        .open_brace, // {
        .@"or", // |
        .close_brace, // }
        .tilde, // ~
        .invalid, // DEL
    };

    const JSIdentifier = @import("./js_lexer/identifier.zig");
    pub fn isIdentifierStart(codepoint: i32) bool {
        return JSIdentifier.isIdentifierStart(codepoint);
    }
    pub fn isIdentifierContinue(codepoint: i32) bool {
        return JSIdentifier.isIdentifierPart(codepoint);
    }

    /// Get the character type for a given code point
    pub fn get(cp: i32) CharacterType {
        if (cp >= 0 and cp < 128) {
            @branchHint(.likely);
            return ascii_types[@as(usize, @intCast(cp))];
        }

        return switch (cp) {
            -1 => .eof,

            0x2028, 0x2029 => .line_terminator,
            0x000B, // line tabulation
            0x0009, // character tabulation
            0x000C, // form feed
            0x0020, // space
            0x00A0, // no-break space
            // Unicode "Space_Separator" code points
            0x1680, // ogham space mark
            0x2000, // en quad
            0x2001, // em quad
            0x2002, // en space
            0x2003, // em space
            0x2004, // three-per-em space
            0x2005, // four-per-em space
            0x2006, // six-per-em space
            0x2007, // figure space
            0x2008, // punctuation space
            0x2009, // thin space
            0x200A, // hair space
            0x202F, // narrow no-break space
            0x205F, // medium mathematical space
            0x3000, // ideographic space
            0xFEFF, // zero width non-breaking space
            => .white_space,

            else => if (isIdentifierStart(cp))
                .identifier_start
            else
                .invalid,
        };
    }
};
