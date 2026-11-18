//! What the lexer hands to the parser.

use crate::names::Name;

/// Not an `enum`, for any byte of a [`Token`] has to be one.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub(crate) struct TokenKind(u8);

macro_rules! kinds {
    ($($(#[$comment:meta])* $kind:ident,)*) => {
        enum Position {
            $($kind,)*
        }

        #[allow(non_upper_case_globals)]
        impl TokenKind {
            $($(#[$comment])* pub(crate) const $kind: TokenKind = TokenKind(Position::$kind as u8);)*
        }
    };
}

kinds! {
    Identifier,
    // A keyword is the index of its `Name`.
    Null,
    True,
    False,
    Break,
    Case,
    Default,
    For,
    New,
    Var,
    Const,
    Continue,
    Function,
    Return,
    If,
    This,
    Do,
    While,
    Switch,
    With,
    Throw,
    Try,
    Catch,
    Finally,
    Debugger,
    Else,
    Import,
    Export,
    Class,
    Extends,
    Super,
    Typeof,
    Void,
    Delete,
    Instanceof,
    In,
    Enum,
    Let,
    Yield,
    Await,
    /// In code that is not strict these are identifiers.
    ReservedInStrictCode,

    EscapedKeyword,
    PrivateName,
    Number,
    BigInt,
    String,
    Template,
    RegExp,

    // No expression goes on after these.
    Comma,
    Semicolon,
    Colon,
    CloseParen,
    CloseBracket,
    CloseBrace,
    End,

    // These go on with a member expression.
    Dot,
    OpenParen,
    OpenBracket,
    Backquote,
    QuestionDot,

    OpenBrace,
    Question,
    Ellipsis,
    Arrow,

    Assign,
    AddAssign,
    SubtractAssign,
    MultiplyAssign,
    DivideAssign,
    RemainderAssign,
    ExponentiateAssign,
    BitAndAssign,
    BitOrAssign,
    BitXorAssign,
    ShiftLeftAssign,
    ShiftRightAssign,
    ShiftRightUnsignedAssign,
    AndAssign,
    OrAssign,
    CoalesceAssign,

    Increment,
    Decrement,
    Not,
    BitNot,
    Plus,
    Minus,

    Star,
    Slash,
    Percent,
    Exponentiate,
    BitAnd,
    BitOr,
    BitXor,
    ShiftLeft,
    ShiftRight,
    ShiftRightUnsigned,
    Equal,
    NotEqual,
    StrictEqual,
    StrictNotEqual,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
    And,
    Or,
    Coalesce,

    // Names that are malformed.
    IncompleteEscape,
    InvalidEscape,
    InvalidUnicodeEscape,
    InvalidEncoding,
    InvalidCodePoint,
    // `Lexer::error` says more of these.
    Invalid,
    Unterminated,
    /// What more lines could complete.
    UnterminatedMultiline,
}

pub(crate) const RELATIONAL_PRECEDENCE: u8 = 8;

static PRECEDENCES: [u8; 256] = {
    type T = TokenKind;
    let levels: [&[TokenKind]; 12] = [
        &[T::Coalesce],
        &[T::Or],
        &[T::And],
        &[T::BitOr],
        &[T::BitXor],
        &[T::BitAnd],
        &[T::Equal, T::NotEqual, T::StrictEqual, T::StrictNotEqual],
        &[
            T::Less,
            T::LessEqual,
            T::Greater,
            T::GreaterEqual,
            T::Instanceof,
            T::In,
        ],
        &[T::ShiftLeft, T::ShiftRight, T::ShiftRightUnsigned],
        &[T::Plus, T::Minus],
        &[T::Star, T::Slash, T::Percent],
        &[T::Exponentiate],
    ];
    let mut precedences = [0; 256];
    let mut level = 0;
    while level < levels.len() {
        let mut index = 0;
        while index < levels[level].len() {
            precedences[levels[level][index].0 as usize] = level as u8 + 1;
            index += 1;
        }
        level += 1;
    }
    assert!(precedences[T::In.0 as usize] == RELATIONAL_PRECEDENCE);
    precedences
};

const _: () = assert!(
    TokenKind::Null.0 as usize == Name::NULL.index()
        && TokenKind::Super.0 as usize == Name::SUPER.index()
        && TokenKind::Await.0 as usize == Name::AWAIT.index()
        && TokenKind::ReservedInStrictCode.0 as usize == Name::IMPLEMENTS.index()
);

impl TokenKind {
    /// In strict code.
    #[inline(always)]
    pub(crate) fn of_name(name: Name) -> TokenKind {
        if name > Name::STATIC {
            return TokenKind::Identifier;
        }
        TokenKind(name.index() as u8).min(TokenKind::ReservedInStrictCode)
    }

    #[inline(always)]
    pub(crate) const fn index(self) -> usize {
        self.0 as usize
    }

    pub(crate) const fn from_index(index: u8) -> TokenKind {
        TokenKind(index)
    }

    #[inline(always)]
    const fn is_in(self, first: TokenKind, last: TokenKind) -> bool {
        self.0.wrapping_sub(first.0) <= last.0 - first.0
    }

    #[inline(always)]
    pub(crate) fn is_keyword(self) -> bool {
        self.is_in(TokenKind::Null, TokenKind::ReservedInStrictCode)
    }

    /// IdentifierName of ECMA-262.
    #[inline(always)]
    pub(crate) fn is_identifier_name(self) -> bool {
        self <= TokenKind::EscapedKeyword
    }

    #[inline(always)]
    pub(crate) fn ends_expression(self) -> bool {
        self.is_in(TokenKind::Comma, TokenKind::End)
    }

    #[inline(always)]
    pub(crate) fn continues_member(self) -> bool {
        self.is_in(TokenKind::Dot, TokenKind::QuestionDot)
    }

    #[inline(always)]
    pub(crate) fn is_assignment(self) -> bool {
        self.is_in(TokenKind::Assign, TokenKind::CoalesceAssign)
    }

    #[inline(always)]
    pub(crate) fn is_logical_assignment(self) -> bool {
        self.is_in(TokenKind::AndAssign, TokenKind::CoalesceAssign)
    }

    #[inline(always)]
    pub(crate) fn is_update(self) -> bool {
        self.is_in(TokenKind::Increment, TokenKind::Decrement)
    }

    #[inline(always)]
    pub(crate) const fn is_prefix_operator(self) -> bool {
        self.is_in(TokenKind::Increment, TokenKind::Minus)
            || self.is_in(TokenKind::Typeof, TokenKind::Delete)
    }

    /// Of a binary operator. Zero for anything else.
    #[inline(always)]
    pub(crate) fn precedence(self) -> u8 {
        PRECEDENCES[usize::from(self.0)]
    }

    /// Whether the token is all there is to say about an error at it.
    pub(crate) fn speaks_for_itself(self) -> bool {
        matches!(self, TokenKind::End | TokenKind::EscapedKeyword)
            || self >= TokenKind::IncompleteEscape
    }
}

/// What a token has besides a kind and a place.
#[derive(Clone, Copy)]
pub(crate) struct Detail(u64);

impl Detail {
    pub(crate) const NONE: Detail = Detail(0);
    pub(crate) const FOLLOWS_NEWLINE: Detail = Detail(1 << 8);
    /// A word of nothing but ASCII letters and digits is an identifier without a value, whatever it spells.
    pub(crate) const UNNAMED: Detail = Detail(1 << 9);
    pub(crate) const ELABORATE: Detail = Detail(1 << 16);

    #[inline(always)]
    pub(crate) fn value(value: u32) -> Detail {
        Detail(u64::from(value) << 32)
    }

    #[inline(always)]
    pub(crate) fn contains(self, other: Detail) -> bool {
        self.0 & other.0 != 0
    }
}

impl core::ops::BitOr for Detail {
    type Output = Detail;

    #[inline(always)]
    fn bitor(self, other: Detail) -> Detail {
        Detail(self.0 | other.0)
    }
}

/// Two words, each written at once: a copy of a token that has just been written field by field stalls.
#[derive(Clone, Copy)]
pub(crate) struct Token {
    range: u64,
    /// With the kind.
    detail: u64,
}

impl Token {
    #[inline(always)]
    pub(crate) fn new(kind: TokenKind, start: usize, end: usize, detail: Detail) -> Token {
        Token {
            range: (end as u64) << 32 | start as u64,
            detail: u64::from(kind.0) | detail.0,
        }
    }

    #[inline(always)]
    pub(crate) fn with_kind(self, kind: TokenKind) -> Token {
        let detail = Detail(self.detail & !0xff);
        Token::new(kind, self.start() as usize, self.end() as usize, detail)
    }

    #[inline(always)]
    pub(crate) fn kind(self) -> TokenKind {
        TokenKind(self.detail as u8)
    }

    #[inline(always)]
    pub(crate) fn start(self) -> u32 {
        self.range as u32
    }

    #[inline(always)]
    pub(crate) fn end(self) -> u32 {
        (self.range >> 32) as u32
    }

    /// Of a word, the index of its [`Name`]. Of a number that is not elaborate, the number.
    #[inline(always)]
    pub(crate) fn value(self) -> u32 {
        (self.detail >> 32) as u32
    }

    /// What it has from the text before it.
    #[inline(always)]
    pub(crate) fn lead(self) -> Detail {
        Detail(self.detail & Detail::FOLLOWS_NEWLINE.0)
    }

    #[inline(always)]
    pub(crate) fn follows_newline(self) -> bool {
        self.detail & Detail::FOLLOWS_NEWLINE.0 != 0
    }

    /// The value is not the text as it stands: there are escapes, or more to a number than a few decimal digits.
    #[inline(always)]
    pub(crate) fn is_elaborate(self) -> bool {
        self.detail & Detail::ELABORATE.0 != 0
    }

    #[inline(always)]
    pub(crate) fn name(self) -> Name {
        Name::from_word(self.value()).unwrap_or(Name::EMPTY)
    }

    /// An identifier that is a keyword in some places, where it cannot have escapes.
    #[inline(always)]
    pub(crate) fn is_contextual(self, name: Name) -> bool {
        const { assert!(TokenKind::Identifier.0 == 0) };
        self.detail & !(Detail::FOLLOWS_NEWLINE.0 | Detail::UNNAMED.0)
            == Detail::value(name.index() as u32).0
    }

    /// `let`, `yield` or `await`, with or without escapes.
    #[inline(always)]
    pub(crate) fn spells(self, keyword: TokenKind) -> bool {
        self.kind() == keyword
            || (self.kind() == TokenKind::EscapedKeyword && self.value() == u32::from(keyword.0))
    }
}
