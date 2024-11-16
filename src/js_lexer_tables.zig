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
    t_end_of_file,
    // close brace is here so that we can do comparisons against EOF or close brace in one branch
    t_close_brace,

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
