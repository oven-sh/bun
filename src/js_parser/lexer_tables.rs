use bun_str::strings::CodePoint;
use enum_map::{Enum, EnumMap};
use phf::{phf_map, phf_set};

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Enum)]
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

impl T {
    pub fn is_assign(self) -> bool {
        (self as u8) >= (T::TAmpersandAmpersandEquals as u8) && (self as u8) <= (T::TSlashEquals as u8)
    }

    pub fn is_reserved_word(self) -> bool {
        (self as u8) >= (T::TBreak as u8) && (self as u8) <= (T::TWith as u8)
    }

    pub fn is_string(self) -> bool {
        match self {
            T::TNoSubstitutionTemplateLiteral
            | T::TStringLiteral
            | T::TTemplateHead
            | T::TTemplateMiddle
            | T::TTemplateTail => true,
            _ => false,
        }
    }

    pub fn is_close_brace_or_eof(self) -> bool {
        (self as u8) <= (T::TCloseBrace as u8)
    }
}

pub static KEYWORDS: phf::Map<&'static [u8], T> = phf_map! {
    b"break" => T::TBreak,
    b"case" => T::TCase,
    b"catch" => T::TCatch,
    b"class" => T::TClass,
    b"const" => T::TConst,
    b"continue" => T::TContinue,
    b"debugger" => T::TDebugger,
    b"default" => T::TDefault,
    b"delete" => T::TDelete,
    b"do" => T::TDo,
    b"else" => T::TElse,
    b"enum" => T::TEnum,
    b"export" => T::TExport,
    b"extends" => T::TExtends,
    b"false" => T::TFalse,
    b"finally" => T::TFinally,
    b"for" => T::TFor,
    b"function" => T::TFunction,
    b"if" => T::TIf,
    b"import" => T::TImport,
    b"in" => T::TIn,
    b"instanceof" => T::TInstanceof,
    b"new" => T::TNew,
    b"null" => T::TNull,
    b"return" => T::TReturn,
    b"super" => T::TSuper,
    b"switch" => T::TSwitch,
    b"this" => T::TThis,
    b"throw" => T::TThrow,
    b"true" => T::TTrue,
    b"try" => T::TTry,
    b"typeof" => T::TTypeof,
    b"var" => T::TVar,
    b"void" => T::TVoid,
    b"while" => T::TWhile,
    b"with" => T::TWith,
};

pub static STRICT_MODE_RESERVED_WORDS: phf::Set<&'static [u8]> = phf_set! {
    b"implements",
    b"interface",
    b"let",
    b"package",
    b"private",
    b"protected",
    b"public",
    b"static",
    b"yield",
};

pub static STRICT_MODE_RESERVED_WORDS_REMAP: phf::Map<&'static [u8], &'static [u8]> = phf_map! {
    b"implements" => b"_implements",
    b"interface" => b"_interface",
    b"let" => b"_let",
    b"package" => b"_package",
    b"private" => b"_private",
    b"protected" => b"_protected",
    b"public" => b"_public",
    b"static" => b"_static",
    b"yield" => b"_yield",
};

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum PropertyModifierKeyword {
    PAbstract,
    PAccessor,
    PAsync,
    PDeclare,
    PGet,
    POverride,
    PPrivate,
    PProtected,
    PPublic,
    PReadonly,
    PSet,
    PStatic,
}

impl PropertyModifierKeyword {
    pub const LIST: phf::Map<&'static [u8], PropertyModifierKeyword> = phf_map! {
        b"abstract" => PropertyModifierKeyword::PAbstract,
        b"accessor" => PropertyModifierKeyword::PAccessor,
        b"async" => PropertyModifierKeyword::PAsync,
        b"declare" => PropertyModifierKeyword::PDeclare,
        b"get" => PropertyModifierKeyword::PGet,
        b"override" => PropertyModifierKeyword::POverride,
        b"private" => PropertyModifierKeyword::PPrivate,
        b"protected" => PropertyModifierKeyword::PProtected,
        b"public" => PropertyModifierKeyword::PPublic,
        b"readonly" => PropertyModifierKeyword::PReadonly,
        b"set" => PropertyModifierKeyword::PSet,
        b"static" => PropertyModifierKeyword::PStatic,
    };
}

pub static TYPE_SCRIPT_ACCESSIBILITY_MODIFIER: phf::Set<&'static [u8]> = phf_set! {
    b"override",
    b"private",
    b"protected",
    b"public",
    b"readonly",
};

pub type TokenEnumType = EnumMap<T, &'static [u8]>;

// PERF(port): was comptime-built std.EnumArray — LazyLock builds once at first access; profile in Phase B (consider const [&[u8]; N] indexed by discriminant if hot).
pub static TOKEN_TO_STRING: std::sync::LazyLock<TokenEnumType> = std::sync::LazyLock::new(|| {
    let mut token_enums: TokenEnumType = EnumMap::from_fn(|_| b"" as &'static [u8]);

    token_enums[T::TEndOfFile] = b"end of file";
    token_enums[T::TSyntaxError] = b"syntax error";
    token_enums[T::THashbang] = b"hashbang comment";

    // Literals
    token_enums[T::TNoSubstitutionTemplateLiteral] = b"template literal";
    token_enums[T::TNumericLiteral] = b"number";
    token_enums[T::TStringLiteral] = b"string";
    token_enums[T::TBigIntegerLiteral] = b"bigint";

    // Pseudo-literals
    token_enums[T::TTemplateHead] = b"template literal";
    token_enums[T::TTemplateMiddle] = b"template literal";
    token_enums[T::TTemplateTail] = b"template literal";

    // Punctuation
    token_enums[T::TAmpersand] = b"\"&\"";
    token_enums[T::TAmpersandAmpersand] = b"\"&&\"";
    token_enums[T::TAsterisk] = b"\"*\"";
    token_enums[T::TAsteriskAsterisk] = b"\"**\"";
    token_enums[T::TAt] = b"\"@\"";
    token_enums[T::TBar] = b"\"|\"";
    token_enums[T::TBarBar] = b"\"||\"";
    token_enums[T::TCaret] = b"\"^\"";
    token_enums[T::TCloseBrace] = b"\"}\"";
    token_enums[T::TCloseBracket] = b"\"]\"";
    token_enums[T::TCloseParen] = b"\")\"";
    token_enums[T::TColon] = b"\" =\"";
    token_enums[T::TComma] = b"\",\"";
    token_enums[T::TDot] = b"\".\"";
    token_enums[T::TDotDotDot] = b"\"...\"";
    token_enums[T::TEqualsEquals] = b"\"==\"";
    token_enums[T::TEqualsEqualsEquals] = b"\"===\"";
    token_enums[T::TEqualsGreaterThan] = b"\"=>\"";
    token_enums[T::TExclamation] = b"\"!\"";
    token_enums[T::TExclamationEquals] = b"\"!=\"";
    token_enums[T::TExclamationEqualsEquals] = b"\"!==\"";
    token_enums[T::TGreaterThan] = b"\">\"";
    token_enums[T::TGreaterThanEquals] = b"\">=\"";
    token_enums[T::TGreaterThanGreaterThan] = b"\">>\"";
    token_enums[T::TGreaterThanGreaterThanGreaterThan] = b"\">>>\"";
    token_enums[T::TLessThan] = b"\"<\"";
    token_enums[T::TLessThanEquals] = b"\"<=\"";
    token_enums[T::TLessThanLessThan] = b"\"<<\"";
    token_enums[T::TMinus] = b"\"-\"";
    token_enums[T::TMinusMinus] = b"\"--\"";
    token_enums[T::TOpenBrace] = b"\"{\"";
    token_enums[T::TOpenBracket] = b"\"[\"";
    token_enums[T::TOpenParen] = b"\"(\"";
    token_enums[T::TPercent] = b"\"%\"";
    token_enums[T::TPlus] = b"\"+\"";
    token_enums[T::TPlusPlus] = b"\"++\"";
    token_enums[T::TQuestion] = b"\"?\"";
    token_enums[T::TQuestionDot] = b"\"?.\"";
    token_enums[T::TQuestionQuestion] = b"\"??\"";
    token_enums[T::TSemicolon] = b"\";\"";
    token_enums[T::TSlash] = b"\"/\"";
    token_enums[T::TTilde] = b"\"~\"";

    // Assignments
    token_enums[T::TAmpersandAmpersandEquals] = b"\"&&=\"";
    token_enums[T::TAmpersandEquals] = b"\"&=\"";
    token_enums[T::TAsteriskAsteriskEquals] = b"\"**=\"";
    token_enums[T::TAsteriskEquals] = b"\"*=\"";
    token_enums[T::TBarBarEquals] = b"\"||=\"";
    token_enums[T::TBarEquals] = b"\"|=\"";
    token_enums[T::TCaretEquals] = b"\"^=\"";
    token_enums[T::TEquals] = b"\"=\"";
    token_enums[T::TGreaterThanGreaterThanEquals] = b"\">>=\"";
    token_enums[T::TGreaterThanGreaterThanGreaterThanEquals] = b"\">>>=\"";
    token_enums[T::TLessThanLessThanEquals] = b"\"<<=\"";
    token_enums[T::TMinusEquals] = b"\"-=\"";
    token_enums[T::TPercentEquals] = b"\"%=\"";
    token_enums[T::TPlusEquals] = b"\"+=\"";
    token_enums[T::TQuestionQuestionEquals] = b"\"??=\"";
    token_enums[T::TSlashEquals] = b"\"/=\"";

    // Class-private fields and methods
    token_enums[T::TPrivateIdentifier] = b"private identifier";

    // Identifiers
    token_enums[T::TIdentifier] = b"identifier";
    token_enums[T::TEscapedKeyword] = b"escaped keyword";

    // Reserved words
    token_enums[T::TBreak] = b"\"break\"";
    token_enums[T::TCase] = b"\"case\"";
    token_enums[T::TCatch] = b"\"catch\"";
    token_enums[T::TClass] = b"\"class\"";
    token_enums[T::TConst] = b"\"const\"";
    token_enums[T::TContinue] = b"\"continue\"";
    token_enums[T::TDebugger] = b"\"debugger\"";
    token_enums[T::TDefault] = b"\"default\"";
    token_enums[T::TDelete] = b"\"delete\"";
    token_enums[T::TDo] = b"\"do\"";
    token_enums[T::TElse] = b"\"else\"";
    token_enums[T::TEnum] = b"\"enum\"";
    token_enums[T::TExport] = b"\"export\"";
    token_enums[T::TExtends] = b"\"extends\"";
    token_enums[T::TFalse] = b"\"false\"";
    token_enums[T::TFinally] = b"\"finally\"";
    token_enums[T::TFor] = b"\"for\"";
    token_enums[T::TFunction] = b"\"function\"";
    token_enums[T::TIf] = b"\"if\"";
    token_enums[T::TImport] = b"\"import\"";
    token_enums[T::TIn] = b"\"in\"";
    token_enums[T::TInstanceof] = b"\"instanceof\"";
    token_enums[T::TNew] = b"\"new\"";
    token_enums[T::TNull] = b"\"null\"";
    token_enums[T::TReturn] = b"\"return\"";
    token_enums[T::TSuper] = b"\"super\"";
    token_enums[T::TSwitch] = b"\"switch\"";
    token_enums[T::TThis] = b"\"this\"";
    token_enums[T::TThrow] = b"\"throw\"";
    token_enums[T::TTrue] = b"\"true\"";
    token_enums[T::TTry] = b"\"try\"";
    token_enums[T::TTypeof] = b"\"typeof\"";
    token_enums[T::TVar] = b"\"var\"";
    token_enums[T::TVoid] = b"\"void\"";
    token_enums[T::TWhile] = b"\"while\"";
    token_enums[T::TWith] = b"\"with\"";

    token_enums
});

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum TypescriptStmtKeyword {
    TsStmtType,
    TsStmtNamespace,
    TsStmtModule,
    TsStmtInterface,
    TsStmtAbstract,
    TsStmtGlobal,
    TsStmtDeclare,
}

impl TypescriptStmtKeyword {
    pub const LIST: phf::Map<&'static [u8], TypescriptStmtKeyword> = phf_map! {
        b"type" => TypescriptStmtKeyword::TsStmtType,
        b"namespace" => TypescriptStmtKeyword::TsStmtNamespace,
        b"module" => TypescriptStmtKeyword::TsStmtModule,
        b"interface" => TypescriptStmtKeyword::TsStmtInterface,
        b"abstract" => TypescriptStmtKeyword::TsStmtAbstract,
        b"global" => TypescriptStmtKeyword::TsStmtGlobal,
        b"declare" => TypescriptStmtKeyword::TsStmtDeclare,
    };
}

// In a microbenchmark, this outperforms
pub static JSX_ENTITY: phf::Map<&'static [u8], CodePoint> = phf_map! {
    b"Aacute" => 0x00C1,
    b"aacute" => 0x00E1,
    b"Acirc" => 0x00C2,
    b"acirc" => 0x00E2,
    b"acute" => 0x00B4,
    b"AElig" => 0x00C6,
    b"aelig" => 0x00E6,
    b"Agrave" => 0x00C0,
    b"agrave" => 0x00E0,
    b"alefsym" => 0x2135,
    b"Alpha" => 0x0391,
    b"alpha" => 0x03B1,
    b"amp" => 0x0026,
    b"and" => 0x2227,
    b"ang" => 0x2220,
    b"apos" => 0x0027,
    b"Aring" => 0x00C5,
    b"aring" => 0x00E5,
    b"asymp" => 0x2248,
    b"Atilde" => 0x00C3,
    b"atilde" => 0x00E3,
    b"Auml" => 0x00C4,
    b"auml" => 0x00E4,
    b"bdquo" => 0x201E,
    b"Beta" => 0x0392,
    b"beta" => 0x03B2,
    b"brvbar" => 0x00A6,
    b"bull" => 0x2022,
    b"cap" => 0x2229,
    b"Ccedil" => 0x00C7,
    b"ccedil" => 0x00E7,
    b"cedil" => 0x00B8,
    b"cent" => 0x00A2,
    b"Chi" => 0x03A7,
    b"chi" => 0x03C7,
    b"circ" => 0x02C6,
    b"clubs" => 0x2663,
    b"cong" => 0x2245,
    b"copy" => 0x00A9,
    b"crarr" => 0x21B5,
    b"cup" => 0x222A,
    b"curren" => 0x00A4,
    b"dagger" => 0x2020,
    b"Dagger" => 0x2021,
    b"darr" => 0x2193,
    b"dArr" => 0x21D3,
    b"deg" => 0x00B0,
    b"Delta" => 0x0394,
    b"delta" => 0x03B4,
    b"diams" => 0x2666,
    b"divide" => 0x00F7,
    b"Eacute" => 0x00C9,
    b"eacute" => 0x00E9,
    b"Ecirc" => 0x00CA,
    b"ecirc" => 0x00EA,
    b"Egrave" => 0x00C8,
    b"egrave" => 0x00E8,
    b"empty" => 0x2205,
    b"emsp" => 0x2003,
    b"ensp" => 0x2002,
    b"Epsilon" => 0x0395,
    b"epsilon" => 0x03B5,
    b"equiv" => 0x2261,
    b"Eta" => 0x0397,
    b"eta" => 0x03B7,
    b"ETH" => 0x00D0,
    b"eth" => 0x00F0,
    b"Euml" => 0x00CB,
    b"euml" => 0x00EB,
    b"euro" => 0x20AC,
    b"exist" => 0x2203,
    b"fnof" => 0x0192,
    b"forall" => 0x2200,
    b"frac12" => 0x00BD,
    b"frac14" => 0x00BC,
    b"frac34" => 0x00BE,
    b"frasl" => 0x2044,
    b"Gamma" => 0x0393,
    b"gamma" => 0x03B3,
    b"ge" => 0x2265,
    b"gt" => 0x003E,
    b"harr" => 0x2194,
    b"hArr" => 0x21D4,
    b"hearts" => 0x2665,
    b"hellip" => 0x2026,
    b"Iacute" => 0x00CD,
    b"iacute" => 0x00ED,
    b"Icirc" => 0x00CE,
    b"icirc" => 0x00EE,
    b"iexcl" => 0x00A1,
    b"Igrave" => 0x00CC,
    b"igrave" => 0x00EC,
    b"image" => 0x2111,
    b"infin" => 0x221E,
    b"int" => 0x222B,
    b"Iota" => 0x0399,
    b"iota" => 0x03B9,
    b"iquest" => 0x00BF,
    b"isin" => 0x2208,
    b"Iuml" => 0x00CF,
    b"iuml" => 0x00EF,
    b"Kappa" => 0x039A,
    b"kappa" => 0x03BA,
    b"Lambda" => 0x039B,
    b"lambda" => 0x03BB,
    b"lang" => 0x2329,
    b"laquo" => 0x00AB,
    b"larr" => 0x2190,
    b"lArr" => 0x21D0,
    b"lceil" => 0x2308,
    b"ldquo" => 0x201C,
    b"le" => 0x2264,
    b"lfloor" => 0x230A,
    b"lowast" => 0x2217,
    b"loz" => 0x25CA,
    b"lrm" => 0x200E,
    b"lsaquo" => 0x2039,
    b"lsquo" => 0x2018,
    b"lt" => 0x003C,
    b"macr" => 0x00AF,
    b"mdash" => 0x2014,
    b"micro" => 0x00B5,
    b"middot" => 0x00B7,
    b"minus" => 0x2212,
    b"Mu" => 0x039C,
    b"mu" => 0x03BC,
    b"nabla" => 0x2207,
    b"nbsp" => 0x00A0,
    b"ndash" => 0x2013,
    b"ne" => 0x2260,
    b"ni" => 0x220B,
    b"not" => 0x00AC,
    b"notin" => 0x2209,
    b"nsub" => 0x2284,
    b"Ntilde" => 0x00D1,
    b"ntilde" => 0x00F1,
    b"Nu" => 0x039D,
    b"nu" => 0x03BD,
    b"Oacute" => 0x00D3,
    b"oacute" => 0x00F3,
    b"Ocirc" => 0x00D4,
    b"ocirc" => 0x00F4,
    b"OElig" => 0x0152,
    b"oelig" => 0x0153,
    b"Ograve" => 0x00D2,
    b"ograve" => 0x00F2,
    b"oline" => 0x203E,
    b"Omega" => 0x03A9,
    b"omega" => 0x03C9,
    b"Omicron" => 0x039F,
    b"omicron" => 0x03BF,
    b"oplus" => 0x2295,
    b"or" => 0x2228,
    b"ordf" => 0x00AA,
    b"ordm" => 0x00BA,
    b"Oslash" => 0x00D8,
    b"oslash" => 0x00F8,
    b"Otilde" => 0x00D5,
    b"otilde" => 0x00F5,
    b"otimes" => 0x2297,
    b"Ouml" => 0x00D6,
    b"ouml" => 0x00F6,
    b"para" => 0x00B6,
    b"part" => 0x2202,
    b"permil" => 0x2030,
    b"perp" => 0x22A5,
    b"Phi" => 0x03A6,
    b"phi" => 0x03C6,
    b"Pi" => 0x03A0,
    b"pi" => 0x03C0,
    b"piv" => 0x03D6,
    b"plusmn" => 0x00B1,
    b"pound" => 0x00A3,
    b"prime" => 0x2032,
    b"Prime" => 0x2033,
    b"prod" => 0x220F,
    b"prop" => 0x221D,
    b"Psi" => 0x03A8,
    b"psi" => 0x03C8,
    b"quot" => 0x0022,
    b"radic" => 0x221A,
    b"rang" => 0x232A,
    b"raquo" => 0x00BB,
    b"rarr" => 0x2192,
    b"rArr" => 0x21D2,
    b"rceil" => 0x2309,
    b"rdquo" => 0x201D,
    b"real" => 0x211C,
    b"reg" => 0x00AE,
    b"rfloor" => 0x230B,
    b"Rho" => 0x03A1,
    b"rho" => 0x03C1,
    b"rlm" => 0x200F,
    b"rsaquo" => 0x203A,
    b"rsquo" => 0x2019,
    b"sbquo" => 0x201A,
    b"Scaron" => 0x0160,
    b"scaron" => 0x0161,
    b"sdot" => 0x22C5,
    b"sect" => 0x00A7,
    b"shy" => 0x00AD,
    b"Sigma" => 0x03A3,
    b"sigma" => 0x03C3,
    b"sigmaf" => 0x03C2,
    b"sim" => 0x223C,
    b"spades" => 0x2660,
    b"sub" => 0x2282,
    b"sube" => 0x2286,
    b"sum" => 0x2211,
    b"sup" => 0x2283,
    b"sup1" => 0x00B9,
    b"sup2" => 0x00B2,
    b"sup3" => 0x00B3,
    b"supe" => 0x2287,
    b"szlig" => 0x00DF,
    b"Tau" => 0x03A4,
    b"tau" => 0x03C4,
    b"there4" => 0x2234,
    b"Theta" => 0x0398,
    b"theta" => 0x03B8,
    b"thetasym" => 0x03D1,
    b"thinsp" => 0x2009,
    b"THORN" => 0x00DE,
    b"thorn" => 0x00FE,
    b"tilde" => 0x02DC,
    b"times" => 0x00D7,
    b"trade" => 0x2122,
    b"Uacute" => 0x00DA,
    b"uacute" => 0x00FA,
    b"uarr" => 0x2191,
    b"uArr" => 0x21D1,
    b"Ucirc" => 0x00DB,
    b"ucirc" => 0x00FB,
    b"Ugrave" => 0x00D9,
    b"ugrave" => 0x00F9,
    b"uml" => 0x00A8,
    b"upsih" => 0x03D2,
    b"Upsilon" => 0x03A5,
    b"upsilon" => 0x03C5,
    b"Uuml" => 0x00DC,
    b"uuml" => 0x00FC,
    b"weierp" => 0x2118,
    b"Xi" => 0x039E,
    b"xi" => 0x03BE,
    b"Yacute" => 0x00DD,
    b"yacute" => 0x00FD,
    b"yen" => 0x00A5,
    b"yuml" => 0x00FF,
    b"Yuml" => 0x0178,
    b"Zeta" => 0x0396,
    b"zeta" => 0x03B6,
    b"zwj" => 0x200D,
    b"zwnj" => 0x200C,
};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/lexer_tables.zig (809 lines)
//   confidence: high
//   todos:      0
//   notes:      ComptimeStringMap→phf; void-valued maps→phf::Set; tokenToString uses LazyLock<EnumMap> (PERF note); associated-const phf maps may need hoisting to module statics if phf_map! rejects const position.
// ──────────────────────────────────────────────────────────────────────────
