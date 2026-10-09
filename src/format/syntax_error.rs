//! What the parsers of this crate refuse: what is wrong, and where.

/// A syntax error in a file that is not a script: what is wrong, and at which byte of the text, not counting a byte order
/// mark.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct SyntaxError(pub Message, pub u32);

impl SyntaxError {
    /// `self` is in what `normalizeEndOfLine` has made of `original`. The same in `original`.
    #[cold]
    pub(crate) fn before_normalizing_end_of_line(self, original: &[u8]) -> SyntaxError {
        let mut left = self.1 as usize;
        let mut at = 0;
        while left > 0 && at < original.len() {
            at += match original[at..].starts_with(b"\r\n") {
                true => 2,
                false => 1,
            };
            left -= 1;
        }
        SyntaxError(self.0, at as u32)
    }
}

/// Where a parser notes what it refuses. What it returns on the way, [`Refused`], has no size, so that nothing is paid for
/// the reason where nothing is refused.
pub(crate) struct Refusal(std::cell::Cell<SyntaxError>);

impl Default for Refusal {
    fn default() -> Self {
        Refusal(std::cell::Cell::new(SyntaxError(
            Message::UnexpectedToken,
            0,
        )))
    }
}

/// A text has been refused, and the reason noted.
#[derive(Debug, Copy, Clone)]
pub(crate) struct Refused(());

impl Refusal {
    #[cold]
    pub(crate) fn note(&self, message: Message, offset: u32) -> Refused {
        self.0.set(SyntaxError(message, offset));
        Refused(())
    }

    /// What has been noted last.
    #[cold]
    pub(crate) fn reason(&self) -> SyntaxError {
        self.0.get()
    }
}

macro_rules! messages {
    ($($name:ident = $text:literal,)*) => {
        /// What is wrong.
        #[repr(u8)]
        #[derive(Debug, Copy, Clone, PartialEq, Eq)]
        pub enum Message {
            $($name,)*
        }

        impl Message {
            pub fn text(self) -> &'static str {
                match self {
                    $(Message::$name => $text,)*
                }
            }
        }
    };
}

messages! {
    UnexpectedEnd = "Unexpected end of file",
    NestedTooDeeply = "It is nested too deeply",
    TooLarge = "The file is too large",
    UnclosedBlock = "This block is not closed",
    UnclosedBracket = "This bracket is not closed",
    UnclosedComment = "This comment is not closed",
    UnclosedInterpolation = "This interpolation is not closed",
    UnclosedString = "This string is not closed",

    // Style sheets
    AtRuleWithoutName = "Expected a name after \"@\"",
    NeitherDeclarationNorRule = "This is neither a declaration nor a rule",
    PropertyWithoutName = "Expected the name of a property",
    RuleWithoutSelector = "Expected a selector",
    UnexpectedClosingBrace = "Unexpected \"}\"",
    UnexpectedColon = "Unexpected \":\"",
    UnreadableAtRule = "The parameters of this at-rule cannot be read",
    UnreadableValue = "This value cannot be read",

    // GraphQL
    EmptyExtension = "This extension adds nothing",
    ExpectedClosingBracket = "Expected \"]\"",
    ExpectedClosingParenthesis = "Expected \")\"",
    ExpectedDefinition = "Expected a definition",
    ExpectedDigit = "Expected a digit",
    ExpectedDirectiveLocation = "Expected a place where a directive can be",
    ExpectedName = "Expected a name",
    ExpectedOpeningBrace = "Expected \"{\"",
    ExpectedValue = "Expected a value",
    InvalidEscapeSequence = "Invalid escape sequence",
    InvalidNumber = "Invalid number",
    UnexpectedCharacter = "Unexpected character",

    // JSON
    ExpectedEndOfFile = "Expected the end of the file",

    // Handlebars
    AttributeInEndTag = "An end tag cannot have attributes",
    EndTagOfVoidElement = "This element has no end tag",
    EndTagWithoutStartTag = "This end tag has no start tag",
    ExpectedEndOfMustache = "Expected \"}}\"",
    InvalidBlockParameters = "These block parameters cannot be read",
    InvalidDoctype = "This doctype cannot be read",
    InvalidPath = "\"..\", \".\" and \"this\" can only be at the start of a path",
    InvalidTagName = "This is not the name of an element",
    MisplacedBlock = "A block can only be in an element or in another block",
    MisplacedMustache = "A mustache cannot be here",
    SelfClosingEndTag = "An end tag cannot close itself",
    UnclosedElement = "This element is not closed",
    UnquotedValueWithMustache = "A value with a mustache and text in it needs quotes",
    UnsupportedMustache = "Partials, decorators and raw blocks are not supported",
    WrongEndTag = "This end tag does not close the element that is open",
    WrongNameAtEndOfBlock = "This is not the name of the block that is open",

    // YAML
    BadIndentation = "This is not indented as it has to be",
    BlockInFlow = "A block collection or scalar cannot be between brackets",
    CannotBeFormatted = "This cannot be formatted",
    EmptyAnchor = "Expected a name after \"&\"",
    ExpectedColon = "Expected \":\"",
    ExpectedComma = "Expected \",\"",
    ExpectedCommaOrColon = "Expected \",\" or \":\"",
    ExpectedDocumentStart = "Expected \"---\" after the directives",
    ExpectedLineBreak = "Expected a line break",
    ExpectedWhiteSpace = "Expected white space",
    InvalidAlias = "An alias has a name, and neither an anchor nor a tag",
    InvalidBlockScalarHeader = "This is not what can follow \"|\" or \">\"",
    InvalidDirective = "This directive cannot be read",
    InvalidStartOfPlainScalar = "A plain scalar cannot start with this character",
    InvalidString = "This string has an invalid escape sequence or indentation",
    InvalidTag = "This tag cannot be resolved",
    KeyOverSeveralLines = "A key without \"?\" has to be on one line",
    KeyTooLong = "A key without \"?\" cannot be longer than 1024 characters",
    MappingOnLineOfKey = "A mapping cannot start on the line of the key that it is the value of",
    MisplacedComment = "A comment cannot be here",
    RepeatedProperty = "A node has one anchor and one tag at most",
    TabAsIndentation = "A tab cannot be indentation",
    UnexpectedIndicator = "This has to come before the anchor and the tag, and once",
    UnexpectedToken = "Unexpected token",
    ValueDoesNotFitTag = "The value is not what its tag says",
}
