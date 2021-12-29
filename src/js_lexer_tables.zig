usingnamespace @import("string_types.zig");
const std = @import("std");
const expectString = std.testing.expectEqualStrings;
const expect = std.testing.expect;
const logger = @import("logger.zig");
const unicode = std.unicode;
const default_allocator = @import("./global.zig").default_allocator;
const string = @import("string_types.zig").string;
const CodePoint = @import("string_types.zig").CodePoint;

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

    pub fn isAssign(self: T) bool {
        return @enumToInt(self) >= @enumToInt(T.t_ampersand_ampersand_equals) and @enumToInt(self) <= @enumToInt(T.t_slash_equals);
    }

    pub fn isReservedWord(self: T) bool {
        return @enumToInt(self) >= @enumToInt(T.t_break) and @enumToInt(self) <= @enumToInt(T.t_with);
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

pub const StrictModeReservedWords = std.ComptimeStringMap(bool, .{
    .{ "implements", true },
    .{ "interface", true },
    .{ "let", true },
    .{ "package", true },
    .{ "private", true },
    .{ "protected", true },
    .{ "public", true },
    .{ "static", true },
    .{ "yield", true },
});

pub const StrictModeReservedWordsRemap = std.ComptimeStringMap(string, .{
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

    pub const List = std.ComptimeStringMap(PropertyModifierKeyword, .{
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

pub const TypeScriptAccessibilityModifier = std.ComptimeStringMap(u1, .{
    .{ "public", 1 },
    .{ "private", 1 },
    .{ "protected", 1 },
    .{ "readonly", 1 },
});

pub const TokenEnumType = std.EnumArray(T, []u8);

pub const tokenToString = brk: {
    var TEndOfFile = "end of file".*;
    var TSyntaxError = "syntax error".*;
    var THashbang = "hashbang comment".*;

    // Literals
    var TNoSubstitutionTemplateLiteral = "template literal".*;
    var TNumericLiteral = "number".*;
    var TStringLiteral = "string".*;
    var TBigIntegerLiteral = "bigint".*;

    // Pseudo-literals
    var TTemplateHead = "template literal".*;
    var TTemplateMiddle = "template literal".*;
    var TTemplateTail = "template literal".*;

    // Punctuation
    var TAmpersand = "\"&\"".*;
    var TAmpersandAmpersand = "\"&&\"".*;
    var TAsterisk = "\"*\"".*;
    var TAsteriskAsterisk = "\"**\"".*;
    var TAt = "\"@\"".*;
    var TBar = "\"|\"".*;
    var TBarBar = "\"||\"".*;
    var TCaret = "\"^\"".*;
    var TCloseBrace = "\"}\"".*;
    var TCloseBracket = "\"]\"".*;
    var TCloseParen = "\")\"".*;
    var TColon = "\" =\"".*;
    var TComma = "\",\"".*;
    var TDot = "\".\"".*;
    var TDotDotDot = "\"...\"".*;
    var TEqualsEquals = "\"==\"".*;
    var TEqualsEqualsEquals = "\"===\"".*;
    var TEqualsGreaterThan = "\"=>\"".*;
    var TExclamation = "\"!\"".*;
    var TExclamationEquals = "\"!=\"".*;
    var TExclamationEqualsEquals = "\"!==\"".*;
    var TGreaterThan = "\">\"".*;
    var TGreaterThanEquals = "\">=\"".*;
    var TGreaterThanGreaterThan = "\">>\"".*;
    var TGreaterThanGreaterThanGreaterThan = "\">>>\"".*;
    var TLessThan = "\"<\"".*;
    var TLessThanEquals = "\"<=\"".*;
    var TLessThanLessThan = "\"<<\"".*;
    var TMinus = "\"-\"".*;
    var TMinusMinus = "\"--\"".*;
    var TOpenBrace = "\"{\"".*;
    var TOpenBracket = "\"[\"".*;
    var TOpenParen = "\"(\"".*;
    var TPercent = "\"%\"".*;
    var TPlus = "\"+\"".*;
    var TPlusPlus = "\"++\"".*;
    var TQuestion = "\"?\"".*;
    var TQuestionDot = "\"?.\"".*;
    var TQuestionQuestion = "\"??\"".*;
    var TSemicolon = "\";\"".*;
    var TSlash = "\"/\"".*;
    var TTilde = "\"~\"".*;

    // Assignments
    var TAmpersandAmpersandEquals = "\"&&=\"".*;
    var TAmpersandEquals = "\"&=\"".*;
    var TAsteriskAsteriskEquals = "\"**=\"".*;
    var TAsteriskEquals = "\"*=\"".*;
    var TBarBarEquals = "\"||=\"".*;
    var TBarEquals = "\"|=\"".*;
    var TCaretEquals = "\"^=\"".*;
    var TEquals = "\"=\"".*;
    var TGreaterThanGreaterThanEquals = "\">>=\"".*;
    var TGreaterThanGreaterThanGreaterThanEquals = "\">>>=\"".*;
    var TLessThanLessThanEquals = "\"<<=\"".*;
    var TMinusEquals = "\"-=\"".*;
    var TPercentEquals = "\"%=\"".*;
    var TPlusEquals = "\"+=\"".*;
    var TQuestionQuestionEquals = "\"??=\"".*;
    var TSlashEquals = "\"/=\"".*;

    // Class-private fields and methods
    var TPrivateIdentifier = "private identifier".*;

    // Identifiers
    var TIdentifier = "identifier".*;
    var TEscapedKeyword = "escaped keyword".*;

    // Reserved words
    var TBreak = "\"break\"".*;
    var TCase = "\"case\"".*;
    var TCatch = "\"catch\"".*;
    var TClass = "\"class\"".*;
    var TConst = "\"const\"".*;
    var TContinue = "\"continue\"".*;
    var TDebugger = "\"debugger\"".*;
    var TDefault = "\"default\"".*;
    var TDelete = "\"delete\"".*;
    var TDo = "\"do\"".*;
    var TElse = "\"else\"".*;
    var TEnum = "\"enum\"".*;
    var TExport = "\"export\"".*;
    var TExtends = "\"extends\"".*;
    var TFalse = "\"false\"".*;
    var TFinally = "\"finally\"".*;
    var TFor = "\"for\"".*;
    var TFunction = "\"function\"".*;
    var TIf = "\"if\"".*;
    var TImport = "\"import\"".*;
    var TIn = "\"in\"".*;
    var TInstanceof = "\"instanceof\"".*;
    var TNew = "\"new\"".*;
    var TNull = "\"null\"".*;
    var TReturn = "\"return\"".*;
    var TSuper = "\"super\"".*;
    var TSwitch = "\"switch\"".*;
    var TThis = "\"this\"".*;
    var TThrow = "\"throw\"".*;
    var TTrue = "\"true\"".*;
    var TTry = "\"try\"".*;
    var TTypeof = "\"typeof\"".*;
    var TVar = "\"var\"".*;
    var TVoid = "\"void\"".*;
    var TWhile = "\"while\"".*;
    var TWith = "\"with\"".*;

    var tokenEnums = TokenEnumType.initUndefined();

    var eof = "end of file";

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

    pub const List = std.ComptimeStringMap(TypescriptStmtKeyword, .{
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

pub const JSXEntityMap = std.StringHashMap(CodePoint);

//  Error: meta is a void element tag and must neither have `children` nor use `dangerouslySetInnerHTML`.
pub const ChildlessJSXTags = std.ComptimeStringMap(void, .{
    .{ "area", void },
    .{ "base", void },
    .{ "br", void },
    .{ "col", void },
    .{ "embed", void },
    .{ "hr", void },
    .{ "img", void },
    .{ "input", void },
    .{ "keygen", void },
    .{ "link", void },
    .{ "meta", void },
    .{ "param", void },
    .{ "source", void },
    .{ "track", void },
    .{ "wbr", void },
    .{ "menuitem", void },
});

pub var jsxEntity: JSXEntityMap = undefined;
var has_loaded_jsx_map = false;

// There's probably a way to move this to comptime
pub fn initJSXEntityMap() !void {
    if (has_loaded_jsx_map) {
        return;
    }

    has_loaded_jsx_map = true;
    jsxEntity = JSXEntityMap.init(default_allocator);
    // return jsxEntity;
    jsxEntity.ensureCapacity(255) catch unreachable;

    jsxEntity.putAssumeCapacity("quot", @as(CodePoint, 0x0022));
    jsxEntity.putAssumeCapacity("amp", @as(CodePoint, 0x0026));
    jsxEntity.putAssumeCapacity("apos", @as(CodePoint, 0x0027));
    jsxEntity.putAssumeCapacity("lt", @as(CodePoint, 0x003C));
    jsxEntity.putAssumeCapacity("gt", @as(CodePoint, 0x003E));
    jsxEntity.putAssumeCapacity("nbsp", @as(CodePoint, 0x00A0));
    jsxEntity.putAssumeCapacity("iexcl", @as(CodePoint, 0x00A1));
    jsxEntity.putAssumeCapacity("cent", @as(CodePoint, 0x00A2));
    jsxEntity.putAssumeCapacity("pound", @as(CodePoint, 0x00A3));
    jsxEntity.putAssumeCapacity("curren", @as(CodePoint, 0x00A4));
    jsxEntity.putAssumeCapacity("yen", @as(CodePoint, 0x00A5));
    jsxEntity.putAssumeCapacity("brvbar", @as(CodePoint, 0x00A6));
    jsxEntity.putAssumeCapacity("sect", @as(CodePoint, 0x00A7));
    jsxEntity.putAssumeCapacity("uml", @as(CodePoint, 0x00A8));
    jsxEntity.putAssumeCapacity("copy", @as(CodePoint, 0x00A9));
    jsxEntity.putAssumeCapacity("ordf", @as(CodePoint, 0x00AA));
    jsxEntity.putAssumeCapacity("laquo", @as(CodePoint, 0x00AB));
    jsxEntity.putAssumeCapacity("not", @as(CodePoint, 0x00AC));
    jsxEntity.putAssumeCapacity("shy", @as(CodePoint, 0x00AD));
    jsxEntity.putAssumeCapacity("reg", @as(CodePoint, 0x00AE));
    jsxEntity.putAssumeCapacity("macr", @as(CodePoint, 0x00AF));
    jsxEntity.putAssumeCapacity("deg", @as(CodePoint, 0x00B0));
    jsxEntity.putAssumeCapacity("plusmn", @as(CodePoint, 0x00B1));
    jsxEntity.putAssumeCapacity("sup2", @as(CodePoint, 0x00B2));
    jsxEntity.putAssumeCapacity("sup3", @as(CodePoint, 0x00B3));
    jsxEntity.putAssumeCapacity("acute", @as(CodePoint, 0x00B4));
    jsxEntity.putAssumeCapacity("micro", @as(CodePoint, 0x00B5));
    jsxEntity.putAssumeCapacity("para", @as(CodePoint, 0x00B6));
    jsxEntity.putAssumeCapacity("middot", @as(CodePoint, 0x00B7));
    jsxEntity.putAssumeCapacity("cedil", @as(CodePoint, 0x00B8));
    jsxEntity.putAssumeCapacity("sup1", @as(CodePoint, 0x00B9));
    jsxEntity.putAssumeCapacity("ordm", @as(CodePoint, 0x00BA));
    jsxEntity.putAssumeCapacity("raquo", @as(CodePoint, 0x00BB));
    jsxEntity.putAssumeCapacity("frac14", @as(CodePoint, 0x00BC));
    jsxEntity.putAssumeCapacity("frac12", @as(CodePoint, 0x00BD));
    jsxEntity.putAssumeCapacity("frac34", @as(CodePoint, 0x00BE));
    jsxEntity.putAssumeCapacity("iquest", @as(CodePoint, 0x00BF));
    jsxEntity.putAssumeCapacity("Agrave", @as(CodePoint, 0x00C0));
    jsxEntity.putAssumeCapacity("Aacute", @as(CodePoint, 0x00C1));
    jsxEntity.putAssumeCapacity("Acirc", @as(CodePoint, 0x00C2));
    jsxEntity.putAssumeCapacity("Atilde", @as(CodePoint, 0x00C3));
    jsxEntity.putAssumeCapacity("Auml", @as(CodePoint, 0x00C4));
    jsxEntity.putAssumeCapacity("Aring", @as(CodePoint, 0x00C5));
    jsxEntity.putAssumeCapacity("AElig", @as(CodePoint, 0x00C6));
    jsxEntity.putAssumeCapacity("Ccedil", @as(CodePoint, 0x00C7));
    jsxEntity.putAssumeCapacity("Egrave", @as(CodePoint, 0x00C8));
    jsxEntity.putAssumeCapacity("Eacute", @as(CodePoint, 0x00C9));
    jsxEntity.putAssumeCapacity("Ecirc", @as(CodePoint, 0x00CA));
    jsxEntity.putAssumeCapacity("Euml", @as(CodePoint, 0x00CB));
    jsxEntity.putAssumeCapacity("Igrave", @as(CodePoint, 0x00CC));
    jsxEntity.putAssumeCapacity("Iacute", @as(CodePoint, 0x00CD));
    jsxEntity.putAssumeCapacity("Icirc", @as(CodePoint, 0x00CE));
    jsxEntity.putAssumeCapacity("Iuml", @as(CodePoint, 0x00CF));
    jsxEntity.putAssumeCapacity("ETH", @as(CodePoint, 0x00D0));
    jsxEntity.putAssumeCapacity("Ntilde", @as(CodePoint, 0x00D1));
    jsxEntity.putAssumeCapacity("Ograve", @as(CodePoint, 0x00D2));
    jsxEntity.putAssumeCapacity("Oacute", @as(CodePoint, 0x00D3));
    jsxEntity.putAssumeCapacity("Ocirc", @as(CodePoint, 0x00D4));
    jsxEntity.putAssumeCapacity("Otilde", @as(CodePoint, 0x00D5));
    jsxEntity.putAssumeCapacity("Ouml", @as(CodePoint, 0x00D6));
    jsxEntity.putAssumeCapacity("times", @as(CodePoint, 0x00D7));
    jsxEntity.putAssumeCapacity("Oslash", @as(CodePoint, 0x00D8));
    jsxEntity.putAssumeCapacity("Ugrave", @as(CodePoint, 0x00D9));
    jsxEntity.putAssumeCapacity("Uacute", @as(CodePoint, 0x00DA));
    jsxEntity.putAssumeCapacity("Ucirc", @as(CodePoint, 0x00DB));
    jsxEntity.putAssumeCapacity("Uuml", @as(CodePoint, 0x00DC));
    jsxEntity.putAssumeCapacity("Yacute", @as(CodePoint, 0x00DD));
    jsxEntity.putAssumeCapacity("THORN", @as(CodePoint, 0x00DE));
    jsxEntity.putAssumeCapacity("szlig", @as(CodePoint, 0x00DF));
    jsxEntity.putAssumeCapacity("agrave", @as(CodePoint, 0x00E0));
    jsxEntity.putAssumeCapacity("aacute", @as(CodePoint, 0x00E1));
    jsxEntity.putAssumeCapacity("acirc", @as(CodePoint, 0x00E2));
    jsxEntity.putAssumeCapacity("atilde", @as(CodePoint, 0x00E3));
    jsxEntity.putAssumeCapacity("auml", @as(CodePoint, 0x00E4));
    jsxEntity.putAssumeCapacity("aring", @as(CodePoint, 0x00E5));
    jsxEntity.putAssumeCapacity("aelig", @as(CodePoint, 0x00E6));
    jsxEntity.putAssumeCapacity("ccedil", @as(CodePoint, 0x00E7));
    jsxEntity.putAssumeCapacity("egrave", @as(CodePoint, 0x00E8));
    jsxEntity.putAssumeCapacity("eacute", @as(CodePoint, 0x00E9));
    jsxEntity.putAssumeCapacity("ecirc", @as(CodePoint, 0x00EA));
    jsxEntity.putAssumeCapacity("euml", @as(CodePoint, 0x00EB));
    jsxEntity.putAssumeCapacity("igrave", @as(CodePoint, 0x00EC));
    jsxEntity.putAssumeCapacity("iacute", @as(CodePoint, 0x00ED));
    jsxEntity.putAssumeCapacity("icirc", @as(CodePoint, 0x00EE));
    jsxEntity.putAssumeCapacity("iuml", @as(CodePoint, 0x00EF));
    jsxEntity.putAssumeCapacity("eth", @as(CodePoint, 0x00F0));
    jsxEntity.putAssumeCapacity("ntilde", @as(CodePoint, 0x00F1));
    jsxEntity.putAssumeCapacity("ograve", @as(CodePoint, 0x00F2));
    jsxEntity.putAssumeCapacity("oacute", @as(CodePoint, 0x00F3));
    jsxEntity.putAssumeCapacity("ocirc", @as(CodePoint, 0x00F4));
    jsxEntity.putAssumeCapacity("otilde", @as(CodePoint, 0x00F5));
    jsxEntity.putAssumeCapacity("ouml", @as(CodePoint, 0x00F6));
    jsxEntity.putAssumeCapacity("divide", @as(CodePoint, 0x00F7));
    jsxEntity.putAssumeCapacity("oslash", @as(CodePoint, 0x00F8));
    jsxEntity.putAssumeCapacity("ugrave", @as(CodePoint, 0x00F9));
    jsxEntity.putAssumeCapacity("uacute", @as(CodePoint, 0x00FA));
    jsxEntity.putAssumeCapacity("ucirc", @as(CodePoint, 0x00FB));
    jsxEntity.putAssumeCapacity("uuml", @as(CodePoint, 0x00FC));
    jsxEntity.putAssumeCapacity("yacute", @as(CodePoint, 0x00FD));
    jsxEntity.putAssumeCapacity("thorn", @as(CodePoint, 0x00FE));
    jsxEntity.putAssumeCapacity("yuml", @as(CodePoint, 0x00FF));
    jsxEntity.putAssumeCapacity("OElig", @as(CodePoint, 0x0152));
    jsxEntity.putAssumeCapacity("oelig", @as(CodePoint, 0x0153));
    jsxEntity.putAssumeCapacity("Scaron", @as(CodePoint, 0x0160));
    jsxEntity.putAssumeCapacity("scaron", @as(CodePoint, 0x0161));
    jsxEntity.putAssumeCapacity("Yuml", @as(CodePoint, 0x0178));
    jsxEntity.putAssumeCapacity("fnof", @as(CodePoint, 0x0192));
    jsxEntity.putAssumeCapacity("circ", @as(CodePoint, 0x02C6));
    jsxEntity.putAssumeCapacity("tilde", @as(CodePoint, 0x02DC));
    jsxEntity.putAssumeCapacity("Alpha", @as(CodePoint, 0x0391));
    jsxEntity.putAssumeCapacity("Beta", @as(CodePoint, 0x0392));
    jsxEntity.putAssumeCapacity("Gamma", @as(CodePoint, 0x0393));
    jsxEntity.putAssumeCapacity("Delta", @as(CodePoint, 0x0394));
    jsxEntity.putAssumeCapacity("Epsilon", @as(CodePoint, 0x0395));
    jsxEntity.putAssumeCapacity("Zeta", @as(CodePoint, 0x0396));
    jsxEntity.putAssumeCapacity("Eta", @as(CodePoint, 0x0397));
    jsxEntity.putAssumeCapacity("Theta", @as(CodePoint, 0x0398));
    jsxEntity.putAssumeCapacity("Iota", @as(CodePoint, 0x0399));
    jsxEntity.putAssumeCapacity("Kappa", @as(CodePoint, 0x039A));
    jsxEntity.putAssumeCapacity("Lambda", @as(CodePoint, 0x039B));
    jsxEntity.putAssumeCapacity("Mu", @as(CodePoint, 0x039C));
    jsxEntity.putAssumeCapacity("Nu", @as(CodePoint, 0x039D));
    jsxEntity.putAssumeCapacity("Xi", @as(CodePoint, 0x039E));
    jsxEntity.putAssumeCapacity("Omicron", @as(CodePoint, 0x039F));
    jsxEntity.putAssumeCapacity("Pi", @as(CodePoint, 0x03A0));
    jsxEntity.putAssumeCapacity("Rho", @as(CodePoint, 0x03A1));
    jsxEntity.putAssumeCapacity("Sigma", @as(CodePoint, 0x03A3));
    jsxEntity.putAssumeCapacity("Tau", @as(CodePoint, 0x03A4));
    jsxEntity.putAssumeCapacity("Upsilon", @as(CodePoint, 0x03A5));
    jsxEntity.putAssumeCapacity("Phi", @as(CodePoint, 0x03A6));
    jsxEntity.putAssumeCapacity("Chi", @as(CodePoint, 0x03A7));
    jsxEntity.putAssumeCapacity("Psi", @as(CodePoint, 0x03A8));
    jsxEntity.putAssumeCapacity("Omega", @as(CodePoint, 0x03A9));
    jsxEntity.putAssumeCapacity("alpha", @as(CodePoint, 0x03B1));
    jsxEntity.putAssumeCapacity("beta", @as(CodePoint, 0x03B2));
    jsxEntity.putAssumeCapacity("gamma", @as(CodePoint, 0x03B3));
    jsxEntity.putAssumeCapacity("delta", @as(CodePoint, 0x03B4));
    jsxEntity.putAssumeCapacity("epsilon", @as(CodePoint, 0x03B5));
    jsxEntity.putAssumeCapacity("zeta", @as(CodePoint, 0x03B6));
    jsxEntity.putAssumeCapacity("eta", @as(CodePoint, 0x03B7));
    jsxEntity.putAssumeCapacity("theta", @as(CodePoint, 0x03B8));
    jsxEntity.putAssumeCapacity("iota", @as(CodePoint, 0x03B9));
    jsxEntity.putAssumeCapacity("kappa", @as(CodePoint, 0x03BA));
    jsxEntity.putAssumeCapacity("lambda", @as(CodePoint, 0x03BB));
    jsxEntity.putAssumeCapacity("mu", @as(CodePoint, 0x03BC));
    jsxEntity.putAssumeCapacity("nu", @as(CodePoint, 0x03BD));
    jsxEntity.putAssumeCapacity("xi", @as(CodePoint, 0x03BE));
    jsxEntity.putAssumeCapacity("omicron", @as(CodePoint, 0x03BF));
    jsxEntity.putAssumeCapacity("pi", @as(CodePoint, 0x03C0));
    jsxEntity.putAssumeCapacity("rho", @as(CodePoint, 0x03C1));
    jsxEntity.putAssumeCapacity("sigmaf", @as(CodePoint, 0x03C2));
    jsxEntity.putAssumeCapacity("sigma", @as(CodePoint, 0x03C3));
    jsxEntity.putAssumeCapacity("tau", @as(CodePoint, 0x03C4));
    jsxEntity.putAssumeCapacity("upsilon", @as(CodePoint, 0x03C5));
    jsxEntity.putAssumeCapacity("phi", @as(CodePoint, 0x03C6));
    jsxEntity.putAssumeCapacity("chi", @as(CodePoint, 0x03C7));
    jsxEntity.putAssumeCapacity("psi", @as(CodePoint, 0x03C8));
    jsxEntity.putAssumeCapacity("omega", @as(CodePoint, 0x03C9));
    jsxEntity.putAssumeCapacity("thetasym", @as(CodePoint, 0x03D1));
    jsxEntity.putAssumeCapacity("upsih", @as(CodePoint, 0x03D2));
    jsxEntity.putAssumeCapacity("piv", @as(CodePoint, 0x03D6));
    jsxEntity.putAssumeCapacity("ensp", @as(CodePoint, 0x2002));
    jsxEntity.putAssumeCapacity("emsp", @as(CodePoint, 0x2003));
    jsxEntity.putAssumeCapacity("thinsp", @as(CodePoint, 0x2009));
    jsxEntity.putAssumeCapacity("zwnj", @as(CodePoint, 0x200C));
    jsxEntity.putAssumeCapacity("zwj", @as(CodePoint, 0x200D));
    jsxEntity.putAssumeCapacity("lrm", @as(CodePoint, 0x200E));
    jsxEntity.putAssumeCapacity("rlm", @as(CodePoint, 0x200F));
    jsxEntity.putAssumeCapacity("ndash", @as(CodePoint, 0x2013));
    jsxEntity.putAssumeCapacity("mdash", @as(CodePoint, 0x2014));
    jsxEntity.putAssumeCapacity("lsquo", @as(CodePoint, 0x2018));
    jsxEntity.putAssumeCapacity("rsquo", @as(CodePoint, 0x2019));
    jsxEntity.putAssumeCapacity("sbquo", @as(CodePoint, 0x201A));
    jsxEntity.putAssumeCapacity("ldquo", @as(CodePoint, 0x201C));
    jsxEntity.putAssumeCapacity("rdquo", @as(CodePoint, 0x201D));
    jsxEntity.putAssumeCapacity("bdquo", @as(CodePoint, 0x201E));
    jsxEntity.putAssumeCapacity("dagger", @as(CodePoint, 0x2020));
    jsxEntity.putAssumeCapacity("Dagger", @as(CodePoint, 0x2021));
    jsxEntity.putAssumeCapacity("bull", @as(CodePoint, 0x2022));
    jsxEntity.putAssumeCapacity("hellip", @as(CodePoint, 0x2026));
    jsxEntity.putAssumeCapacity("permil", @as(CodePoint, 0x2030));
    jsxEntity.putAssumeCapacity("prime", @as(CodePoint, 0x2032));
    jsxEntity.putAssumeCapacity("Prime", @as(CodePoint, 0x2033));
    jsxEntity.putAssumeCapacity("lsaquo", @as(CodePoint, 0x2039));
    jsxEntity.putAssumeCapacity("rsaquo", @as(CodePoint, 0x203A));
    jsxEntity.putAssumeCapacity("oline", @as(CodePoint, 0x203E));
    jsxEntity.putAssumeCapacity("frasl", @as(CodePoint, 0x2044));
    jsxEntity.putAssumeCapacity("euro", @as(CodePoint, 0x20AC));
    jsxEntity.putAssumeCapacity("image", @as(CodePoint, 0x2111));
    jsxEntity.putAssumeCapacity("weierp", @as(CodePoint, 0x2118));
    jsxEntity.putAssumeCapacity("real", @as(CodePoint, 0x211C));
    jsxEntity.putAssumeCapacity("trade", @as(CodePoint, 0x2122));
    jsxEntity.putAssumeCapacity("alefsym", @as(CodePoint, 0x2135));
    jsxEntity.putAssumeCapacity("larr", @as(CodePoint, 0x2190));
    jsxEntity.putAssumeCapacity("uarr", @as(CodePoint, 0x2191));
    jsxEntity.putAssumeCapacity("rarr", @as(CodePoint, 0x2192));
    jsxEntity.putAssumeCapacity("darr", @as(CodePoint, 0x2193));
    jsxEntity.putAssumeCapacity("harr", @as(CodePoint, 0x2194));
    jsxEntity.putAssumeCapacity("crarr", @as(CodePoint, 0x21B5));
    jsxEntity.putAssumeCapacity("lArr", @as(CodePoint, 0x21D0));
    jsxEntity.putAssumeCapacity("uArr", @as(CodePoint, 0x21D1));
    jsxEntity.putAssumeCapacity("rArr", @as(CodePoint, 0x21D2));
    jsxEntity.putAssumeCapacity("dArr", @as(CodePoint, 0x21D3));
    jsxEntity.putAssumeCapacity("hArr", @as(CodePoint, 0x21D4));
    jsxEntity.putAssumeCapacity("forall", @as(CodePoint, 0x2200));
    jsxEntity.putAssumeCapacity("part", @as(CodePoint, 0x2202));
    jsxEntity.putAssumeCapacity("exist", @as(CodePoint, 0x2203));
    jsxEntity.putAssumeCapacity("empty", @as(CodePoint, 0x2205));
    jsxEntity.putAssumeCapacity("nabla", @as(CodePoint, 0x2207));
    jsxEntity.putAssumeCapacity("isin", @as(CodePoint, 0x2208));
    jsxEntity.putAssumeCapacity("notin", @as(CodePoint, 0x2209));
    jsxEntity.putAssumeCapacity("ni", @as(CodePoint, 0x220B));
    jsxEntity.putAssumeCapacity("prod", @as(CodePoint, 0x220F));
    jsxEntity.putAssumeCapacity("sum", @as(CodePoint, 0x2211));
    jsxEntity.putAssumeCapacity("minus", @as(CodePoint, 0x2212));
    jsxEntity.putAssumeCapacity("lowast", @as(CodePoint, 0x2217));
    jsxEntity.putAssumeCapacity("radic", @as(CodePoint, 0x221A));
    jsxEntity.putAssumeCapacity("prop", @as(CodePoint, 0x221D));
    jsxEntity.putAssumeCapacity("infin", @as(CodePoint, 0x221E));
    jsxEntity.putAssumeCapacity("ang", @as(CodePoint, 0x2220));
    jsxEntity.putAssumeCapacity("and", @as(CodePoint, 0x2227));
    jsxEntity.putAssumeCapacity("or", @as(CodePoint, 0x2228));
    jsxEntity.putAssumeCapacity("cap", @as(CodePoint, 0x2229));
    jsxEntity.putAssumeCapacity("cup", @as(CodePoint, 0x222A));
    jsxEntity.putAssumeCapacity("int", @as(CodePoint, 0x222B));
    jsxEntity.putAssumeCapacity("there4", @as(CodePoint, 0x2234));
    jsxEntity.putAssumeCapacity("sim", @as(CodePoint, 0x223C));
    jsxEntity.putAssumeCapacity("cong", @as(CodePoint, 0x2245));
    jsxEntity.putAssumeCapacity("asymp", @as(CodePoint, 0x2248));
    jsxEntity.putAssumeCapacity("ne", @as(CodePoint, 0x2260));
    jsxEntity.putAssumeCapacity("equiv", @as(CodePoint, 0x2261));
    jsxEntity.putAssumeCapacity("le", @as(CodePoint, 0x2264));
    jsxEntity.putAssumeCapacity("ge", @as(CodePoint, 0x2265));
    jsxEntity.putAssumeCapacity("sub", @as(CodePoint, 0x2282));
    jsxEntity.putAssumeCapacity("sup", @as(CodePoint, 0x2283));
    jsxEntity.putAssumeCapacity("nsub", @as(CodePoint, 0x2284));
    jsxEntity.putAssumeCapacity("sube", @as(CodePoint, 0x2286));
    jsxEntity.putAssumeCapacity("supe", @as(CodePoint, 0x2287));
    jsxEntity.putAssumeCapacity("oplus", @as(CodePoint, 0x2295));
    jsxEntity.putAssumeCapacity("otimes", @as(CodePoint, 0x2297));
    jsxEntity.putAssumeCapacity("perp", @as(CodePoint, 0x22A5));
    jsxEntity.putAssumeCapacity("sdot", @as(CodePoint, 0x22C5));
    jsxEntity.putAssumeCapacity("lceil", @as(CodePoint, 0x2308));
    jsxEntity.putAssumeCapacity("rceil", @as(CodePoint, 0x2309));
    jsxEntity.putAssumeCapacity("lfloor", @as(CodePoint, 0x230A));
    jsxEntity.putAssumeCapacity("rfloor", @as(CodePoint, 0x230B));
    jsxEntity.putAssumeCapacity("lang", @as(CodePoint, 0x2329));
    jsxEntity.putAssumeCapacity("rang", @as(CodePoint, 0x232A));
    jsxEntity.putAssumeCapacity("loz", @as(CodePoint, 0x25CA));
    jsxEntity.putAssumeCapacity("spades", @as(CodePoint, 0x2660));
    jsxEntity.putAssumeCapacity("clubs", @as(CodePoint, 0x2663));
    jsxEntity.putAssumeCapacity("hearts", @as(CodePoint, 0x2665));
    jsxEntity.putAssumeCapacity("diams", @as(CodePoint, 0x2666));
}

test "tokenToString" {
    try expectString(tokenToString.get(T.t_end_of_file), "end of file");
}

// test "jsxEntity" {
//     try alloc.setup(std.heap.page_allocator);

//     initJSXEntityMap() catch |err| {
//         @panic(@errorName(err));
//     };

//     if (jsxEntity.get("sim")) |v| {
//         expect(v == 0x223C);
//     }
// }

