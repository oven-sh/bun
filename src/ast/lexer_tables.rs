use bun_core::CodePoint;
use enum_map::Enum;
use phf::phf_map;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug, Enum, strum::IntoStaticStr)]
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
        (self as u8) >= (T::TAmpersandAmpersandEquals as u8)
            && (self as u8) <= (T::TSlashEquals as u8)
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

/// Pack `N <= 16` bytes into a native-endian `u128` (zero-padded). `const` so
/// the literal arms in the `by_len!` macros below fold to integer immediates
/// at compile time; the runtime call (post-monomorphization, fixed `N`) lowers
/// to one or two unaligned loads.
///
/// The `N <= 8` branch routes through a `u64` and widens with `as u128` so the
/// upper half is the *literal* `0` rather than a stack-buffer read — LLVM
/// InstCombine then narrows the resulting `icmp eq i128 (zext %lo), C` back to
/// a single `i64` compare. This is the codegen Zig's `ComptimeStringMap` emits
/// (`mov (%rsi),%rax; movabs $imm,%rcx; cmp %rcx,%rax`). Matching on
/// `&[u8; N]` directly does **not** get this: rustc lowers array patterns to a
/// per-byte `cmpb`+`jne` decision tree (8 branches for `b"function"`), which
/// is what the previous revision of `by_len!` produced.
#[inline(always)]
const fn kw_pack<const N: usize>(arr: &[u8; N]) -> u128 {
    assert!(N <= 16);
    if N <= 8 {
        let mut lo = [0u8; 8];
        let mut i = 0;
        while i < N {
            lo[i] = arr[i];
            i += 1;
        }
        u64::from_ne_bytes(lo) as u128
    } else {
        let mut lo = [0u8; 8];
        let mut hi = [0u8; 8];
        let mut i = 0;
        while i < 8 {
            lo[i] = arr[i];
            i += 1;
        }
        while i < N {
            hi[i - 8] = arr[i];
            i += 1;
        }
        (u64::from_ne_bytes(lo) as u128) | ((u64::from_ne_bytes(hi) as u128) << 64)
    }
}

/// Hot-path keyword classifier — called once per identifier in the lexer.
///
/// Replaces the `phf::Map` lookup for `KEYWORDS` (which hashes through
/// SipHash13 and showed up as ~4% self-time under `phf_shared::hash` in
/// `perf record` on the three.js bundle). Mirrors Zig's `ComptimeStringMap`
/// strategy: bucket by length, then load the candidate once as a wide integer
/// and compare against const-folded immediates — one `cmp` per candidate, no
/// hash, no bounds checks, no `memcmp`, no per-byte ladder.
///
/// All JS keywords are 2..=10 ASCII bytes; the length dispatch rejects the
/// overwhelming majority of identifiers (which are not keywords) with one
/// branch when `len > 10`.
#[inline]
pub fn keyword(s: &[u8]) -> Option<T> {
    /// View `s` as `&[u8; $n]` (length already proven by the outer
    /// `match s.len()`), pack it into a single native-endian integer via
    /// [`kw_pack`], and compare against const-folded integer immediates. Each
    /// arm is one wide `cmp`. (Matching on `&[u8; N]` directly lowers to a
    /// per-byte `cmpb` chain — see [`kw_pack`] doc.)
    ///
    /// Spelled as an `if`/`else` chain rather than a `match`: inline-`const`
    /// in *pattern* position is unstable (`inline_const_pat`), but in
    /// *expression* position it has been stable since 1.79 and forces the RHS
    /// to a compile-time immediate. The lowered IR is identical — a `match`
    /// over scattered `u128` constants is a sequential `cmp`+`je` ladder
    /// either way (no jump table for sparse 128-bit keys).
    macro_rules! by_len {
        ($n:literal: $($lit:literal => $tok:expr,)*) => {{
            let arr: &[u8; $n] = s.try_into().unwrap();
            let w = kw_pack::<$n>(arr);
            $(if w == const { kw_pack::<$n>($lit) } { Some($tok) } else)* { None }
        }};
    }
    match s.len() {
        2 => by_len!(2:
            b"do" => T::TDo,
            b"if" => T::TIf,
            b"in" => T::TIn,
        ),
        3 => by_len!(3:
            b"for" => T::TFor,
            b"new" => T::TNew,
            b"try" => T::TTry,
            b"var" => T::TVar,
        ),
        4 => by_len!(4:
            b"case" => T::TCase,
            b"else" => T::TElse,
            b"enum" => T::TEnum,
            b"null" => T::TNull,
            b"this" => T::TThis,
            b"true" => T::TTrue,
            b"void" => T::TVoid,
            b"with" => T::TWith,
        ),
        5 => by_len!(5:
            b"break" => T::TBreak,
            b"catch" => T::TCatch,
            b"class" => T::TClass,
            b"const" => T::TConst,
            b"false" => T::TFalse,
            b"super" => T::TSuper,
            b"throw" => T::TThrow,
            b"while" => T::TWhile,
        ),
        6 => by_len!(6:
            b"delete" => T::TDelete,
            b"export" => T::TExport,
            b"import" => T::TImport,
            b"return" => T::TReturn,
            b"switch" => T::TSwitch,
            b"typeof" => T::TTypeof,
        ),
        7 => by_len!(7:
            b"default" => T::TDefault,
            b"extends" => T::TExtends,
            b"finally" => T::TFinally,
        ),
        8 => by_len!(8:
            b"continue" => T::TContinue,
            b"debugger" => T::TDebugger,
            b"function" => T::TFunction,
        ),
        10 => by_len!(10:
            b"instanceof" => T::TInstanceof,
        ),
        _ => None,
    }
}

// Strict-mode reserved-word table sunk to `bun_core::lexer_tables` (single
// source of truth shared with `MutableString::ensure_valid_identifier`).
// `STRICT_MODE_RESERVED_WORDS` is now `[&[u8]; 9]` — `.len()`/`.iter()`-
// compatible with the former `phf::Set` callers (renamer.rs).
pub use bun_core::lexer_tables::{
    STRICT_MODE_RESERVED_WORDS, is_strict_mode_reserved_word, strict_mode_reserved_word_remap,
};

// Kept for non-hot-path callers (e.g. error formatting, `to_string` on the
// token). The lexer hot loop uses `keyword()` above instead.
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

    /// Hot path: queried in `parse_property` once per identifier-keyed
    /// property (every method/field name in a class body). Same length-bucket
    /// strategy as [`keyword`] — avoids the SipHash round-trip inside
    /// `phf::Map::get`. All entries are 3..=9 ASCII bytes; class-heavy inputs
    /// like three.js have property names that are overwhelmingly *not* in this
    /// set, so the `match s.len()` rejects most lookups in one branch.
    #[inline]
    pub fn find(s: &[u8]) -> Option<PropertyModifierKeyword> {
        macro_rules! by_len {
            ($n:literal: $($lit:literal => $tok:expr,)*) => {{
                let arr: &[u8; $n] = s.try_into().unwrap();
                let w = kw_pack::<$n>(arr);
                // See `keyword`'s `by_len!` for why this is an if-chain.
                $(if w == const { kw_pack::<$n>($lit) } { Some($tok) } else)* { None }
            }};
        }
        match s.len() {
            3 => by_len!(3:
                b"get" => PropertyModifierKeyword::PGet,
                b"set" => PropertyModifierKeyword::PSet,
            ),
            5 => by_len!(5:
                b"async" => PropertyModifierKeyword::PAsync,
            ),
            6 => by_len!(6:
                b"public" => PropertyModifierKeyword::PPublic,
                b"static" => PropertyModifierKeyword::PStatic,
            ),
            7 => by_len!(7:
                b"declare" => PropertyModifierKeyword::PDeclare,
                b"private" => PropertyModifierKeyword::PPrivate,
            ),
            8 => by_len!(8:
                b"abstract" => PropertyModifierKeyword::PAbstract,
                b"accessor" => PropertyModifierKeyword::PAccessor,
                b"override" => PropertyModifierKeyword::POverride,
                b"readonly" => PropertyModifierKeyword::PReadonly,
            ),
            9 => by_len!(9:
                b"protected" => PropertyModifierKeyword::PProtected,
            ),
            _ => None,
        }
    }
}

/// TypeScript "parameter property" modifier check (constructor args). Same
/// strategy as [`is_strict_mode_reserved_word`]: length-bucketed fixed-array
/// compare to avoid the SipHash inside `phf::Set::contains`. All entries are
/// 6..=9 ASCII bytes and lengths are unique except 8 (override/readonly).
#[inline]
pub fn is_type_script_accessibility_modifier(s: &[u8]) -> bool {
    macro_rules! by_len {
        ($n:literal: $($lit:literal,)*) => {{
            let arr: &[u8; $n] = s.try_into().unwrap();
            let w = kw_pack::<$n>(arr);
            // See `keyword`'s `by_len!` for why this is an `||` chain rather
            // than a `matches!` over `const { }` patterns.
            false $(|| w == const { kw_pack::<$n>($lit) })*
        }};
    }
    match s.len() {
        6 => by_len!(6: b"public",),
        7 => by_len!(7: b"private",),
        8 => by_len!(8: b"override", b"readonly",),
        9 => by_len!(9: b"protected",),
        _ => false,
    }
}

/// `.rodata` `[&[u8]; T::COUNT]` indexed by [`T`] discriminant. Replaces the
/// `LazyLock<EnumMap<T, _>>` Phase-A scaffolding so lookup is a plain array
/// index with zero init code (matches Zig `std.EnumArray`).
#[repr(transparent)]
pub struct TokenEnumType(pub [&'static [u8]; <T as Enum>::LENGTH]);

impl core::ops::Index<T> for TokenEnumType {
    type Output = &'static [u8];
    #[inline]
    fn index(&self, t: T) -> &&'static [u8] {
        &self.0[t as usize]
    }
}

impl TokenEnumType {
    /// Zig: `tokenToString.get(token)`.
    #[inline]
    pub fn get(&self, t: T) -> &'static [u8] {
        self.0[t as usize]
    }
}

pub static TOKEN_TO_STRING: TokenEnumType = TokenEnumType({
    let mut token_enums: [&'static [u8]; <T as Enum>::LENGTH] = [b""; <T as Enum>::LENGTH];

    token_enums[T::TEndOfFile as usize] = b"end of file";
    token_enums[T::TSyntaxError as usize] = b"syntax error";
    token_enums[T::THashbang as usize] = b"hashbang comment";

    // Literals
    token_enums[T::TNoSubstitutionTemplateLiteral as usize] = b"template literal";
    token_enums[T::TNumericLiteral as usize] = b"number";
    token_enums[T::TStringLiteral as usize] = b"string";
    token_enums[T::TBigIntegerLiteral as usize] = b"bigint";

    // Pseudo-literals
    token_enums[T::TTemplateHead as usize] = b"template literal";
    token_enums[T::TTemplateMiddle as usize] = b"template literal";
    token_enums[T::TTemplateTail as usize] = b"template literal";

    // Punctuation
    token_enums[T::TAmpersand as usize] = b"\"&\"";
    token_enums[T::TAmpersandAmpersand as usize] = b"\"&&\"";
    token_enums[T::TAsterisk as usize] = b"\"*\"";
    token_enums[T::TAsteriskAsterisk as usize] = b"\"**\"";
    token_enums[T::TAt as usize] = b"\"@\"";
    token_enums[T::TBar as usize] = b"\"|\"";
    token_enums[T::TBarBar as usize] = b"\"||\"";
    token_enums[T::TCaret as usize] = b"\"^\"";
    token_enums[T::TCloseBrace as usize] = b"\"}\"";
    token_enums[T::TCloseBracket as usize] = b"\"]\"";
    token_enums[T::TCloseParen as usize] = b"\")\"";
    token_enums[T::TColon as usize] = b"\" =\"";
    token_enums[T::TComma as usize] = b"\",\"";
    token_enums[T::TDot as usize] = b"\".\"";
    token_enums[T::TDotDotDot as usize] = b"\"...\"";
    token_enums[T::TEqualsEquals as usize] = b"\"==\"";
    token_enums[T::TEqualsEqualsEquals as usize] = b"\"===\"";
    token_enums[T::TEqualsGreaterThan as usize] = b"\"=>\"";
    token_enums[T::TExclamation as usize] = b"\"!\"";
    token_enums[T::TExclamationEquals as usize] = b"\"!=\"";
    token_enums[T::TExclamationEqualsEquals as usize] = b"\"!==\"";
    token_enums[T::TGreaterThan as usize] = b"\">\"";
    token_enums[T::TGreaterThanEquals as usize] = b"\">=\"";
    token_enums[T::TGreaterThanGreaterThan as usize] = b"\">>\"";
    token_enums[T::TGreaterThanGreaterThanGreaterThan as usize] = b"\">>>\"";
    token_enums[T::TLessThan as usize] = b"\"<\"";
    token_enums[T::TLessThanEquals as usize] = b"\"<=\"";
    token_enums[T::TLessThanLessThan as usize] = b"\"<<\"";
    token_enums[T::TMinus as usize] = b"\"-\"";
    token_enums[T::TMinusMinus as usize] = b"\"--\"";
    token_enums[T::TOpenBrace as usize] = b"\"{\"";
    token_enums[T::TOpenBracket as usize] = b"\"[\"";
    token_enums[T::TOpenParen as usize] = b"\"(\"";
    token_enums[T::TPercent as usize] = b"\"%\"";
    token_enums[T::TPlus as usize] = b"\"+\"";
    token_enums[T::TPlusPlus as usize] = b"\"++\"";
    token_enums[T::TQuestion as usize] = b"\"?\"";
    token_enums[T::TQuestionDot as usize] = b"\"?.\"";
    token_enums[T::TQuestionQuestion as usize] = b"\"??\"";
    token_enums[T::TSemicolon as usize] = b"\";\"";
    token_enums[T::TSlash as usize] = b"\"/\"";
    token_enums[T::TTilde as usize] = b"\"~\"";

    // Assignments
    token_enums[T::TAmpersandAmpersandEquals as usize] = b"\"&&=\"";
    token_enums[T::TAmpersandEquals as usize] = b"\"&=\"";
    token_enums[T::TAsteriskAsteriskEquals as usize] = b"\"**=\"";
    token_enums[T::TAsteriskEquals as usize] = b"\"*=\"";
    token_enums[T::TBarBarEquals as usize] = b"\"||=\"";
    token_enums[T::TBarEquals as usize] = b"\"|=\"";
    token_enums[T::TCaretEquals as usize] = b"\"^=\"";
    token_enums[T::TEquals as usize] = b"\"=\"";
    token_enums[T::TGreaterThanGreaterThanEquals as usize] = b"\">>=\"";
    token_enums[T::TGreaterThanGreaterThanGreaterThanEquals as usize] = b"\">>>=\"";
    token_enums[T::TLessThanLessThanEquals as usize] = b"\"<<=\"";
    token_enums[T::TMinusEquals as usize] = b"\"-=\"";
    token_enums[T::TPercentEquals as usize] = b"\"%=\"";
    token_enums[T::TPlusEquals as usize] = b"\"+=\"";
    token_enums[T::TQuestionQuestionEquals as usize] = b"\"??=\"";
    token_enums[T::TSlashEquals as usize] = b"\"/=\"";

    // Class-private fields and methods
    token_enums[T::TPrivateIdentifier as usize] = b"private identifier";

    // Identifiers
    token_enums[T::TIdentifier as usize] = b"identifier";
    token_enums[T::TEscapedKeyword as usize] = b"escaped keyword";

    // Reserved words
    token_enums[T::TBreak as usize] = b"\"break\"";
    token_enums[T::TCase as usize] = b"\"case\"";
    token_enums[T::TCatch as usize] = b"\"catch\"";
    token_enums[T::TClass as usize] = b"\"class\"";
    token_enums[T::TConst as usize] = b"\"const\"";
    token_enums[T::TContinue as usize] = b"\"continue\"";
    token_enums[T::TDebugger as usize] = b"\"debugger\"";
    token_enums[T::TDefault as usize] = b"\"default\"";
    token_enums[T::TDelete as usize] = b"\"delete\"";
    token_enums[T::TDo as usize] = b"\"do\"";
    token_enums[T::TElse as usize] = b"\"else\"";
    token_enums[T::TEnum as usize] = b"\"enum\"";
    token_enums[T::TExport as usize] = b"\"export\"";
    token_enums[T::TExtends as usize] = b"\"extends\"";
    token_enums[T::TFalse as usize] = b"\"false\"";
    token_enums[T::TFinally as usize] = b"\"finally\"";
    token_enums[T::TFor as usize] = b"\"for\"";
    token_enums[T::TFunction as usize] = b"\"function\"";
    token_enums[T::TIf as usize] = b"\"if\"";
    token_enums[T::TImport as usize] = b"\"import\"";
    token_enums[T::TIn as usize] = b"\"in\"";
    token_enums[T::TInstanceof as usize] = b"\"instanceof\"";
    token_enums[T::TNew as usize] = b"\"new\"";
    token_enums[T::TNull as usize] = b"\"null\"";
    token_enums[T::TReturn as usize] = b"\"return\"";
    token_enums[T::TSuper as usize] = b"\"super\"";
    token_enums[T::TSwitch as usize] = b"\"switch\"";
    token_enums[T::TThis as usize] = b"\"this\"";
    token_enums[T::TThrow as usize] = b"\"throw\"";
    token_enums[T::TTrue as usize] = b"\"true\"";
    token_enums[T::TTry as usize] = b"\"try\"";
    token_enums[T::TTypeof as usize] = b"\"typeof\"";
    token_enums[T::TVar as usize] = b"\"var\"";
    token_enums[T::TVoid as usize] = b"\"void\"";
    token_enums[T::TWhile as usize] = b"\"while\"";
    token_enums[T::TWith as usize] = b"\"with\"";

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
    /// Length-gated match. Same strategy as [`keyword`]: 7 entries, max 2 per
    /// length bucket, so gating on `len()` first lets LLVM lower each inner
    /// compare to a fixed-width integer compare instead of phf's SipHash +
    /// index + slice-compare. Almost every miss (every non-TS-keyword
    /// identifier at statement position) falls out on the single `usize`
    /// compare without touching bytes.
    #[inline]
    pub fn from_bytes(s: &[u8]) -> Option<Self> {
        macro_rules! by_len {
            ($n:literal: $($lit:literal => $kw:expr,)*) => {{
                let arr: &[u8; $n] = s.try_into().unwrap();
                let w = kw_pack::<$n>(arr);
                // See `keyword`'s `by_len!` for why this is an if-chain.
                $(if w == const { kw_pack::<$n>($lit) } { Some($kw) } else)* { None }
            }};
        }
        match s.len() {
            4 => by_len!(4:
                b"type" => Self::TsStmtType,
            ),
            6 => by_len!(6:
                b"module" => Self::TsStmtModule,
                b"global" => Self::TsStmtGlobal,
            ),
            7 => by_len!(7:
                b"declare" => Self::TsStmtDeclare,
            ),
            8 => by_len!(8:
                b"abstract" => Self::TsStmtAbstract,
            ),
            9 => by_len!(9:
                b"namespace" => Self::TsStmtNamespace,
                b"interface" => Self::TsStmtInterface,
            ),
            _ => None,
        }
    }
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

// ported from: src/js_parser/lexer_tables.zig

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyword_fn_matches_phf_table() {
        // Positive: every entry in the canonical phf map round-trips.
        for (k, &v) in KEYWORDS.entries() {
            assert_eq!(keyword(k), Some(v), "keyword({:?})", k);
        }
        // Negative: a few near-misses and the strict-mode set (which are NOT
        // in KEYWORDS) must miss.
        for k in [
            b"" as &[u8],
            b"i",
            b"iff",
            b"forr",
            b"functions",
            b"instanceo",
            b"let",
            b"yield",
            b"static",
            b"implements",
            b"awaits",
        ] {
            assert_eq!(keyword(k), None, "keyword({:?})", k);
        }
    }

    #[test]
    fn strict_mode_reserved_fn_matches_phf_set() {
        for k in STRICT_MODE_RESERVED_WORDS.iter() {
            assert!(is_strict_mode_reserved_word(k), "{:?}", k);
            assert!(strict_mode_reserved_word_remap(k).is_some(), "{:?}", k);
        }
        for k in [
            b"" as &[u8],
            b"le",
            b"lett",
            b"publi",
            b"publics",
            b"var",
            b"function",
            b"interfac",
            b"interfaces",
        ] {
            assert!(!is_strict_mode_reserved_word(k), "{:?}", k);
            assert!(strict_mode_reserved_word_remap(k).is_none(), "{:?}", k);
        }
    }

    #[test]
    fn property_modifier_find_matches_phf_map() {
        for (k, v) in PropertyModifierKeyword::LIST.entries() {
            assert_eq!(PropertyModifierKeyword::find(k), Some(*v), "{:?}", k);
        }
        for k in [
            b"" as &[u8],
            b"ge",
            b"gett",
            b"asyn",
            b"asyncc",
            b"static_",
            b"abstrac",
            b"abstractt",
            b"protecte",
            b"protecteds",
            b"const",
        ] {
            assert_eq!(PropertyModifierKeyword::find(k), None, "{:?}", k);
        }
    }
}

// ── identifier predicates ──────────────────────────────────────────────────
// Shared by `bun_ast::E::EString::is_identifier`, `bun_js_printer::renamer`,
// and the parser's lexer. Data-only (codepoint tables live in `bun_core`).

#[inline]
pub fn is_identifier_start(codepoint: i32) -> bool {
    bun_core::identifier::is_identifier_start(codepoint)
}
#[inline]
pub fn is_identifier_continue(codepoint: i32) -> bool {
    bun_core::identifier::is_identifier_part(codepoint)
}

pub use bun_core::identifier::{is_identifier, is_identifier_utf16};

pub fn is_latin1_identifier<B: AsRef<[u8]>>(name: B) -> bool {
    // Zig `isLatin1Identifier(comptime Buffer, name)` is generic over `[]const u8`
    // and `[]const u16`; the u16 instantiation is [`is_latin1_identifier_u16`].
    let name = name.as_ref();
    if name.is_empty() {
        return false;
    }

    match name[0] {
        b'a'..=b'z' | b'A'..=b'Z' | b'$' | b'_' => {}
        _ => return false,
    }

    if name.len() > 1 {
        for &c in &name[1..] {
            match c {
                b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' | b'$' | b'_' => {}
                _ => return false,
            }
        }
    }

    true
}

/// `JSLexer.isLatin1Identifier(comptime []const u16, name)` — UTF-16 overload
/// of [`is_latin1_identifier`]. Walks code units exactly as the Zig generic
/// does (no narrowing/alloc): any unit `> 0xFF` fails the predicate, otherwise
/// the byte rules apply.
pub fn is_latin1_identifier_u16(name: &[u16]) -> bool {
    if name.is_empty() {
        return false;
    }

    match name[0] {
        c @ 0..=0xFF => match c as u8 {
            b'a'..=b'z' | b'A'..=b'Z' | b'$' | b'_' => {}
            _ => return false,
        },
        _ => return false,
    }

    for &c in &name[1..] {
        match c {
            c @ 0..=0xFF => match c as u8 {
                b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' | b'$' | b'_' => {}
                _ => return false,
            },
            _ => return false,
        }
    }

    true
}
