//! Syntax errors from this crate's parsers: a message and an offset.

/// A syntax error in a file that isn't a script: the message, and the byte offset in the text, not counting a byte
/// order mark.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct SyntaxError(pub Message, pub u32);

impl SyntaxError {
    /// Converts the offset from one in `normalizeEndOfLine(original)` to one in `original`.
    #[cold]
    pub(crate) fn before_normalizing_end_of_line(self, original: &[u8]) -> SyntaxError {
        SyntaxError(
            self.0,
            BeforeNormalizing::new(original).original_offset_of(self.1),
        )
    }
}

/// Maps offsets in `normalizeEndOfLine(text)` back to offsets in `text`. Lookups in ascending order take a single
/// pass over the text in total.
pub(crate) struct BeforeNormalizing<'a> {
    original: &'a [u8],
    has_carriage_returns: bool,
    /// The last offset that was looked up, and the matching offset in `original`.
    last: (usize, usize),
}

impl<'a> BeforeNormalizing<'a> {
    pub(crate) fn new(original: &'a [u8]) -> BeforeNormalizing<'a> {
        BeforeNormalizing {
            original,
            has_carriage_returns: bun_core::strings::contains_char(original, b'\r'),
            last: (0, 0),
        }
    }

    pub(crate) fn original_offset_of(&mut self, normalized_offset: u32) -> u32 {
        if !self.has_carriage_returns {
            return normalized_offset;
        }
        if (normalized_offset as usize) < self.last.0 {
            self.last = (0, 0);
        }
        let (mut remaining, mut at) = (normalized_offset as usize - self.last.0, self.last.1);
        while remaining > 0 && at < self.original.len() {
            at += match self.original[at..].starts_with(b"\r\n") {
                true => 2,
                false => 1,
            };
            remaining -= 1;
        }
        self.last = (normalized_offset as usize - remaining, at);
        at as u32
    }
}

/// Where a parser records its syntax error. The error type that it propagates, [`Rejected`], is zero-sized, so the
/// success path doesn't pay for carrying the reason.
pub(crate) struct Rejection(std::cell::Cell<SyntaxError>);

impl Default for Rejection {
    fn default() -> Self {
        Rejection(std::cell::Cell::new(SyntaxError(
            Message::UnexpectedToken,
            0,
        )))
    }
}

/// The input was rejected, and the reason was recorded in a [`Rejection`].
#[derive(Debug, Copy, Clone)]
pub(crate) struct Rejected(());

impl Rejection {
    #[cold]
    pub(crate) fn note(&self, message: Message, offset: u32) -> Rejected {
        self.0.set(SyntaxError(message, offset));
        Rejected(())
    }

    /// The most recently recorded error.
    #[cold]
    pub(crate) fn reason(&self) -> SyntaxError {
        self.0.get()
    }
}

macro_rules! messages {
    ($($name:ident = $text:literal,)*) => {
        /// An error message.
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
    NestedTooDeeply = "This file is nested too deeply",
    TooLarge = "The file is too large",
    UnclosedBlock = "Unclosed block",
    UnclosedBracket = "Unclosed bracket",
    UnclosedComment = "Unclosed comment",
    UnclosedInterpolation = "Unclosed interpolation",
    UnclosedString = "Unclosed string",

    // Style sheets
    AtRuleWithoutName = "Expected a name after \"@\"",
    NeitherDeclarationNorRule = "Expected a declaration or a rule",
    PropertyWithoutName = "Expected a property name",
    RuleWithoutSelector = "Expected a selector",
    UnexpectedClosingBrace = "Unexpected \"}\"",
    UnexpectedColon = "Unexpected \":\"",
    UnreadableAtRule = "Invalid at-rule parameters",
    UnreadableValue = "Invalid value",

    // GraphQL
    EmptyExtension = "This extension is empty",
    ExpectedClosingBracket = "Expected \"]\"",
    ExpectedClosingParenthesis = "Expected \")\"",
    ExpectedDefinition = "Expected a definition",
    ExpectedDigit = "Expected a digit",
    ExpectedDirectiveLocation = "Expected a directive location",
    ExpectedName = "Expected a name",
    ExpectedOpeningBrace = "Expected \"{\"",
    ExpectedValue = "Expected a value",
    InvalidEscapeSequence = "Invalid escape sequence",
    InvalidNumber = "Invalid number",
    UnexpectedCharacter = "Unexpected character",

    // JSON
    ExpectedComma = "Expected \",\"",
    ExpectedEndOfFile = "Expected end of file",

    // Handlebars
    AttributeInEndTag = "An end tag cannot have attributes",
    EndTagOfVoidElement = "This element cannot have an end tag",
    EndTagWithoutStartTag = "This end tag has no start tag",
    ExpectedEndOfMustache = "Expected \"}}\"",
    InvalidBlockParameters = "Invalid block parameters",
    InvalidDoctype = "Invalid doctype",
    InvalidPath = "\"..\", \".\" and \"this\" can only be at the start of a path",
    InvalidTagName = "Invalid element name",
    MisplacedBlock = "A block can only be inside an element or another block",
    MisplacedMustache = "A mustache is not allowed here",
    SelfClosingEndTag = "An end tag cannot be self-closing",
    UnclosedElement = "Unclosed element",
    UnquotedValueWithMustache = "An attribute value that mixes text and a mustache needs quotes",
    UnsupportedMustache = "Partials, decorators and raw blocks are not supported",
    WrongEndTag = "This end tag does not match the open element",
    WrongNameAtEndOfBlock = "This name does not match the open block",

    // Svelte
    ChildrenNotAllowed = "This element cannot have children",
    DeprecatedTagOption = "The \"tag\" option is called \"customElement\" now",
    DirectiveWithoutName = "Expected a name after \":\"",
    ElseIfInOneWord = "\"elseif\" is written \"else if\"",
    EndTagOfClosedElement = "Another element has already closed the element this end tag is for",
    ExpectedClosingBrace = "Expected \"}\"",
    ExpectedEndOfTag = "Expected \">\"",
    ExpectedEquals = "Expected \"=\"",
    ExpectedOpeningParenthesis = "Expected \"(\"",
    ExpectedPattern = "Expected a name or a destructuring pattern",
    ExpectedWhiteSpace = "Expected white space",
    InvalidCustomElementName = "Invalid custom element name",
    InvalidCustomElementOption = "\"customElement\" must be a string or an object",
    InvalidDebugTag = "{@debug} takes names separated by commas",
    InvalidDeclarationTag = "Only \"let\" and \"const\" can be declared here",
    InvalidDirectiveValue = "The value of a directive must be one expression in braces",
    InvalidOptionValue = "Invalid value for this option",
    InvalidRenderTag = "{@render} takes a function call",
    InvalidScriptContext = "\"context\" can only be \"module\"",
    InvalidThis = "\"this\" must be an expression in braces",
    MisplacedClause = "This clause is not directly inside a block that can have it",
    MisplacedTag = "A {@...} tag is not allowed here",
    MissingThis = "This element needs a \"this\" attribute with a value",
    NeedsEmbeddedFormatting = "Svelte cannot be formatted with embeddedLanguageFormatting set to \"off\"",
    NotAtTopLevel = "This element must be at the top level of the component",
    NotStaticOption = "<svelte:options> can only have plain attributes",
    RepeatedAttribute = "An element can have this attribute only once",
    RepeatedClause = "A block can have this clause only once",
    RepeatedElement = "A component can have this element only once",
    ReservedCustomElementName = "This custom element name is reserved",
    ReservedScriptAttribute = "This attribute is reserved on <script>",
    ReservedWord = "A reserved word cannot be a name here",
    SequenceInConstTag = "A comma expression needs parentheses here",
    TypeScriptInJavaScript = "This is TypeScript, which needs <script lang=\"ts\">",
    UnexpectedEndOfBlock = "There is no open block to end here",
    UnknownBlock = "There is no such {#...} block",
    UnknownOption = "<svelte:options> has no such option",
    UnknownSvelteElement = "There is no such <svelte:...> element",
    UnknownTag = "There is no such {@...} tag",
    ValueOfModuleAttribute = "\"module\" cannot have a value",

    // YAML
    CannotBeFormatted = "This cannot be formatted",
    ExpectedColon = "Expected \":\"",
    InvalidDirective = "Invalid directive",
    InvalidTag = "This tag cannot be resolved",
    KeyOverSeveralLines = "A key without \"?\" must be on one line",
    MisplacedComment = "A comment is not allowed here",
    RepeatedProperty = "A node can have at most one anchor and one tag",
    TabAsIndentation = "Tabs cannot be used for indentation",
    UnexpectedToken = "Unexpected token",
}
