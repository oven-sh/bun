//! The kinds of tokens, in the order of TypeScript's `SyntaxKind`: the parser classifies a token by
//! comparing its kind with the first and the last of a group.

/// The kind of a token.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub(crate) enum T {
    Eof,
    Number,
    BigInt,
    String,
    JsxText,
    Regex,
    NoSubstitutionTemplate,
    TemplateHead,
    TemplateMiddle,
    TemplateTail,

    OpenBrace,
    CloseBrace,
    OpenParen,
    CloseParen,
    OpenBracket,
    CloseBracket,
    Dot,
    DotDotDot,
    Semicolon,
    Comma,
    QuestionDot,
    LessThan,
    LessThanSlash,
    GreaterThan,
    LessThanEquals,
    GreaterThanEquals,
    EqualsEquals,
    ExclamationEquals,
    EqualsEqualsEquals,
    ExclamationEqualsEquals,
    EqualsGreaterThan,
    Plus,
    Minus,
    Asterisk,
    AsteriskAsterisk,
    Slash,
    Percent,
    PlusPlus,
    MinusMinus,
    LessThanLessThan,
    GreaterThanGreaterThan,
    GreaterThanGreaterThanGreaterThan,
    Ampersand,
    Bar,
    Caret,
    Exclamation,
    Tilde,
    AmpersandAmpersand,
    BarBar,
    Question,
    Colon,
    At,
    QuestionQuestion,
    // The assignment operators, from here to `CaretEquals`.
    Equals,
    PlusEquals,
    MinusEquals,
    AsteriskEquals,
    AsteriskAsteriskEquals,
    SlashEquals,
    PercentEquals,
    LessThanLessThanEquals,
    GreaterThanGreaterThanEquals,
    GreaterThanGreaterThanGreaterThanEquals,
    AmpersandEquals,
    BarEquals,
    BarBarEquals,
    AmpersandAmpersandEquals,
    QuestionQuestionEquals,
    CaretEquals,

    Identifier,
    PrivateIdentifier,

    // The reserved words, from here to `With`.
    Break,
    Case,
    Catch,
    Class,
    Const,
    Continue,
    Debugger,
    Default,
    Delete,
    Do,
    Else,
    Enum,
    Export,
    Extends,
    False,
    Finally,
    For,
    Function,
    If,
    Import,
    In,
    InstanceOf,
    New,
    Null,
    Return,
    Super,
    Switch,
    This,
    Throw,
    True,
    Try,
    TypeOf,
    Var,
    Void,
    While,
    /// A reserved word that is written with an escape: a name where any word is one, and nothing
    /// else.
    EscapedReservedWord,
    With,
    // The words that are reserved in strict mode, from here to `Yield`.
    Implements,
    Interface,
    Let,
    Package,
    Private,
    Protected,
    Public,
    Static,
    Yield,
    // The contextual keywords.
    Abstract,
    Accessor,
    As,
    Asserts,
    Assert,
    Any,
    Async,
    Await,
    Boolean,
    Constructor,
    Declare,
    Get,
    Infer,
    Intrinsic,
    Is,
    KeyOf,
    Module,
    Namespace,
    Never,
    Out,
    Readonly,
    Require,
    NumberKeyword,
    Object,
    Satisfies,
    Set,
    StringKeyword,
    Symbol,
    Type,
    Undefined,
    Unique,
    Unknown,
    Using,
    From,
    Global,
    BigIntKeyword,
    Override,
    Of,
    Defer,
}

impl T {
    /// `isReservedWord`
    #[inline(always)]
    pub(crate) fn is_reserved_word(self) -> bool {
        self >= T::Break && self <= T::With
    }

    /// `TokenIsIdentifierOrKeyword`, which is true of a private name too.
    #[inline(always)]
    pub(crate) fn is_identifier_or_keyword(self) -> bool {
        self >= T::Identifier
    }

    /// `IsAssignmentOperator`
    #[inline(always)]
    pub(crate) fn is_assignment_operator(self) -> bool {
        self >= T::Equals && self <= T::CaretEquals
    }

    /// `IsModifierKind`
    #[inline]
    pub(crate) fn is_modifier(self) -> bool {
        matches!(
            self,
            T::Abstract
                | T::Accessor
                | T::Async
                | T::Const
                | T::Declare
                | T::Default
                | T::Export
                | T::In
                | T::Public
                | T::Private
                | T::Protected
                | T::Readonly
                | T::Static
                | T::Out
                | T::Override
        )
    }

    /// `GetBinaryOperatorPrecedence`, 0 for a token that is not a binary operator. The comma and the
    /// assignment operators are not among them: the parser handles those where it parses them.
    #[inline(always)]
    pub(crate) fn binary_precedence(self) -> u8 {
        PRECEDENCE[self as usize]
    }
}

const COUNT: usize = T::Defer as usize + 1;

const PRECEDENCE: [u8; COUNT] = {
    let mut table = [0u8; COUNT];
    table[T::QuestionQuestion as usize] = 1;
    table[T::BarBar as usize] = 2;
    table[T::AmpersandAmpersand as usize] = 3;
    table[T::Bar as usize] = 4;
    table[T::Caret as usize] = 5;
    table[T::Ampersand as usize] = 6;
    table[T::EqualsEquals as usize] = 7;
    table[T::ExclamationEquals as usize] = 7;
    table[T::EqualsEqualsEquals as usize] = 7;
    table[T::ExclamationEqualsEquals as usize] = 7;
    table[T::LessThan as usize] = 8;
    table[T::GreaterThan as usize] = 8;
    table[T::LessThanEquals as usize] = 8;
    table[T::GreaterThanEquals as usize] = 8;
    table[T::InstanceOf as usize] = 8;
    table[T::In as usize] = 8;
    table[T::As as usize] = 8;
    table[T::Satisfies as usize] = 8;
    table[T::LessThanLessThan as usize] = 9;
    table[T::GreaterThanGreaterThan as usize] = 9;
    table[T::GreaterThanGreaterThanGreaterThan as usize] = 9;
    table[T::Plus as usize] = 10;
    table[T::Minus as usize] = 10;
    table[T::Asterisk as usize] = 11;
    table[T::Slash as usize] = 11;
    table[T::Percent as usize] = 11;
    table[T::AsteriskAsterisk as usize] = 12;
    table
};

/// The keyword that is spelled `text`, or `Identifier`.
pub(crate) fn keyword(text: &[u8]) -> T {
    match text {
        b"break" => T::Break,
        b"case" => T::Case,
        b"catch" => T::Catch,
        b"class" => T::Class,
        b"const" => T::Const,
        b"continue" => T::Continue,
        b"debugger" => T::Debugger,
        b"default" => T::Default,
        b"delete" => T::Delete,
        b"do" => T::Do,
        b"else" => T::Else,
        b"enum" => T::Enum,
        b"export" => T::Export,
        b"extends" => T::Extends,
        b"false" => T::False,
        b"finally" => T::Finally,
        b"for" => T::For,
        b"function" => T::Function,
        b"if" => T::If,
        b"import" => T::Import,
        b"in" => T::In,
        b"instanceof" => T::InstanceOf,
        b"new" => T::New,
        b"null" => T::Null,
        b"return" => T::Return,
        b"super" => T::Super,
        b"switch" => T::Switch,
        b"this" => T::This,
        b"throw" => T::Throw,
        b"true" => T::True,
        b"try" => T::Try,
        b"typeof" => T::TypeOf,
        b"var" => T::Var,
        b"void" => T::Void,
        b"while" => T::While,
        b"with" => T::With,
        b"implements" => T::Implements,
        b"interface" => T::Interface,
        b"let" => T::Let,
        b"package" => T::Package,
        b"private" => T::Private,
        b"protected" => T::Protected,
        b"public" => T::Public,
        b"static" => T::Static,
        b"yield" => T::Yield,
        b"abstract" => T::Abstract,
        b"accessor" => T::Accessor,
        b"as" => T::As,
        b"asserts" => T::Asserts,
        b"assert" => T::Assert,
        b"any" => T::Any,
        b"async" => T::Async,
        b"await" => T::Await,
        b"boolean" => T::Boolean,
        b"constructor" => T::Constructor,
        b"declare" => T::Declare,
        b"get" => T::Get,
        b"infer" => T::Infer,
        b"intrinsic" => T::Intrinsic,
        b"is" => T::Is,
        b"keyof" => T::KeyOf,
        b"module" => T::Module,
        b"namespace" => T::Namespace,
        b"never" => T::Never,
        b"out" => T::Out,
        b"readonly" => T::Readonly,
        b"require" => T::Require,
        b"number" => T::NumberKeyword,
        b"object" => T::Object,
        b"satisfies" => T::Satisfies,
        b"set" => T::Set,
        b"string" => T::StringKeyword,
        b"symbol" => T::Symbol,
        b"type" => T::Type,
        b"undefined" => T::Undefined,
        b"unique" => T::Unique,
        b"unknown" => T::Unknown,
        b"using" => T::Using,
        b"from" => T::From,
        b"global" => T::Global,
        b"bigint" => T::BigIntKeyword,
        b"override" => T::Override,
        b"of" => T::Of,
        b"defer" => T::Defer,
        _ => T::Identifier,
    }
}
