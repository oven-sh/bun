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

    /// Whether no expression goes on with it.
    #[inline(always)]
    pub(crate) fn ends_expression(self) -> bool {
        matches!(
            self,
            T::Comma
                | T::CloseParen
                | T::CloseBracket
                | T::CloseBrace
                | T::Semicolon
                | T::Colon
                | T::Eof
        )
    }

    /// Whether a member access, a call, a `!`, type arguments or a template can start with it.
    #[inline(always)]
    pub(crate) fn can_follow_member_expression(self) -> bool {
        matches!(
            self,
            T::Dot
                | T::OpenParen
                | T::OpenBracket
                | T::Exclamation
                | T::QuestionDot
                | T::NoSubstitutionTemplate
                | T::TemplateHead
                | T::LessThan
                | T::LessThanLessThan
        )
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

macro_rules! keywords {
    ($($text:literal => $kind:ident,)*) => {
        /// The keyword that is spelled `text`, or `Identifier`.
        pub(crate) fn keyword(text: &[u8]) -> T {
            match text {
                $($text => T::$kind,)*
                _ => T::Identifier,
            }
        }

        pub(crate) const KEYWORDS: &[(&[u8], T)] = &[$(($text, T::$kind),)*];
    };
}

keywords! {
    b"break" => Break,
    b"case" => Case,
    b"catch" => Catch,
    b"class" => Class,
    b"const" => Const,
    b"continue" => Continue,
    b"debugger" => Debugger,
    b"default" => Default,
    b"delete" => Delete,
    b"do" => Do,
    b"else" => Else,
    b"enum" => Enum,
    b"export" => Export,
    b"extends" => Extends,
    b"false" => False,
    b"finally" => Finally,
    b"for" => For,
    b"function" => Function,
    b"if" => If,
    b"import" => Import,
    b"in" => In,
    b"instanceof" => InstanceOf,
    b"new" => New,
    b"null" => Null,
    b"return" => Return,
    b"super" => Super,
    b"switch" => Switch,
    b"this" => This,
    b"throw" => Throw,
    b"true" => True,
    b"try" => Try,
    b"typeof" => TypeOf,
    b"var" => Var,
    b"void" => Void,
    b"while" => While,
    b"with" => With,
    b"implements" => Implements,
    b"interface" => Interface,
    b"let" => Let,
    b"package" => Package,
    b"private" => Private,
    b"protected" => Protected,
    b"public" => Public,
    b"static" => Static,
    b"yield" => Yield,
    b"abstract" => Abstract,
    b"accessor" => Accessor,
    b"as" => As,
    b"asserts" => Asserts,
    b"assert" => Assert,
    b"any" => Any,
    b"async" => Async,
    b"await" => Await,
    b"boolean" => Boolean,
    b"constructor" => Constructor,
    b"declare" => Declare,
    b"get" => Get,
    b"infer" => Infer,
    b"intrinsic" => Intrinsic,
    b"is" => Is,
    b"keyof" => KeyOf,
    b"module" => Module,
    b"namespace" => Namespace,
    b"never" => Never,
    b"out" => Out,
    b"readonly" => Readonly,
    b"require" => Require,
    b"number" => NumberKeyword,
    b"object" => Object,
    b"satisfies" => Satisfies,
    b"set" => Set,
    b"string" => StringKeyword,
    b"symbol" => Symbol,
    b"type" => Type,
    b"undefined" => Undefined,
    b"unique" => Unique,
    b"unknown" => Unknown,
    b"using" => Using,
    b"from" => From,
    b"global" => Global,
    b"bigint" => BigIntKeyword,
    b"override" => Override,
    b"of" => Of,
    b"defer" => Defer,
}
