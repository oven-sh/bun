// mock of the token enum
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum T {
    TEndOfFile,
    // close brace is here so that we can do comparisons against EOF or close brace in one branch
    TCloseBrace,

    TSyntaxError,

    // "#!/usr/bin/env node"
    THashbang,

    // literals
    TNoSubstitutionTemplateLiteral, // contents are in lexer.string_literal ([]uint16)
    TNumericLiteral,                // contents are in lexer.number (float64)
    TStringLiteral,                 // contents are in lexer.string_literal ([]uint16)
    TBigIntegerLiteral,             // contents are in lexer.identifier (string)

    // pseudo-literals
    TTemplateHead,   // contents are in lexer.string_literal ([]uint16)
    TTemplateMiddle, // contents are in lexer.string_literal ([]uint16)
    TTemplateTail,   // contents are in lexer.string_literal ([]uint16)

    // punctuation
    TAmpersand,
    TAmpersandAmpersand,
    TAsterisk,
    TAsteriskAsterisk,
    TAt,
    TBar,
    TBarBar,
    TCaret,
    TCloseBracket,
    TCloseParen,
    TColon,
    TComma,
    TDot,
    TDotDotDot,
    TEqualsEquals,
    TEqualsEqualsEquals,
    TEqualsGreaterThan,
    TExclamation,
    TExclamationEquals,
    TExclamationEqualsEquals,
    TGreaterThan,
    TGreaterThanEquals,
    TGreaterThanGreaterThan,
    TGreaterThanGreaterThanGreaterThan,
    TLessThan,
    TLessThanEquals,
    TLessThanLessThan,
    TMinus,
    TMinusMinus,
    TOpenBrace,
    TOpenBracket,
    TOpenParen,
    TPercent,
    TPlus,
    TPlusPlus,
    TQuestion,
    TQuestionDot,
    TQuestionQuestion,
    TSemicolon,
    TSlash,
    TTilde,

    // assignments (keep in sync with is_assign() below)
    TAmpersandAmpersandEquals,
    TAmpersandEquals,
    TAsteriskAsteriskEquals,
    TAsteriskEquals,
    TBarBarEquals,
    TBarEquals,
    TCaretEquals,
    TEquals,
    TGreaterThanGreaterThanEquals,
    TGreaterThanGreaterThanGreaterThanEquals,
    TLessThanLessThanEquals,
    TMinusEquals,
    TPercentEquals,
    TPlusEquals,
    TQuestionQuestionEquals,
    TSlashEquals,

    // class-private fields and methods
    TPrivateIdentifier,

    // identifiers
    TIdentifier,     // contents are in lexer.identifier (string)
    TEscapedKeyword, // a keyword that has been escaped as an identifer

    // reserved words
    TBreak,
    TCase,
    TCatch,
    TClass,
    TConst,
    TContinue,
    TDebugger,
    TDefault,
    TDelete,
    TDo,
    TElse,
    TEnum,
    TExport,
    TExtends,
    TFalse,
    TFinally,
    TFor,
    TFunction,
    TIf,
    TImport,
    TIn,
    TInstanceof,
    TNew,
    TNull,
    TReturn,
    TSuper,
    TSwitch,
    TThis,
    TThrow,
    TTrue,
    TTry,
    TTypeof,
    TVar,
    TVoid,
    TWhile,
    TWith,
}
