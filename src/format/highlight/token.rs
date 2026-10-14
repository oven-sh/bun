//! The kinds of tokens a highlighter can report.

macro_rules! tokens {
    ($($(#[$doc:meta])* $variant:ident = $name:literal $(in $parent:ident)?,)*) => {
        /// What a piece of source code is.
        ///
        /// The name is public API: it is the key in a theme, and each of its parts is a CSS class.
        /// A token without a style of its own takes its parent's: `keyword.control` falls back to
        /// `keyword`.
        #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
        #[repr(u8)]
        pub enum Token {
            $($(#[$doc])* $variant,)*
        }

        impl Token {
            pub const ALL: &'static [Token] = &[$(Token::$variant,)*];
            pub const COUNT: usize = Token::ALL.len();

            pub const fn name(self) -> &'static str {
                match self {
                    $(Token::$variant => $name,)*
                }
            }

            pub const fn parent(self) -> Option<Token> {
                match self {
                    $(Token::$variant => tokens!(@parent $($parent)?),)*
                }
            }
        }
    };
    (@parent) => { None };
    (@parent $parent:ident) => { Some(Token::$parent) };
}

tokens! {
    Comment = "comment",
    /// `/** .. */`, `///`
    CommentDoc = "comment.doc" in Comment,

    String = "string",
    /// `\n`, `&amp;`
    StringEscape = "string.escape" in String,
    StringRegexp = "string.regexp" in String,
    /// A string that names something: the argument of `url()`, a YAML anchor's target, a date in TOML.
    StringSpecial = "string.special" in String,

    Number = "number",
    /// The `px` of `10px`.
    NumberUnit = "number.unit" in Number,
    Boolean = "boolean",
    /// An enum member, a name in capitals, a keyword value in CSS.
    Constant = "constant",
    /// `null`, `undefined`, `NaN`, `Infinity`
    ConstantBuiltin = "constant.builtin" in Constant,

    /// `const`, `function`, `class`, `interface` and every keyword that fits nothing below.
    Keyword = "keyword",
    /// `if`, `for`, `return`, `await`, `throw`
    KeywordControl = "keyword.control" in Keyword,
    /// `import`, `export`, `from`, `as`
    KeywordImport = "keyword.import" in Keyword,
    /// `typeof`, `instanceof`, `in`, `new`, `keyof`, `satisfies`
    KeywordOperator = "keyword.operator" in Keyword,
    /// `public`, `static`, `async`, `readonly`, `!important`
    KeywordModifier = "keyword.modifier" in Keyword,
    /// `@media`, `%YAML`, `<!doctype>`, `#!/usr/bin/env bun`
    KeywordDirective = "keyword.directive" in Keyword,

    Operator = "operator",

    Punctuation = "punctuation",
    /// `(` `)` `[` `]` `{` `}`
    PunctuationBracket = "punctuation.bracket" in Punctuation,
    /// `,` `;` `.` `:`
    PunctuationDelimiter = "punctuation.delimiter" in Punctuation,
    /// What switches languages or marks up text: `${` `}`, `{{` `}}`, the `#` of a heading.
    PunctuationSpecial = "punctuation.special" in Punctuation,

    Variable = "variable",
    VariableParameter = "variable.parameter" in Variable,
    /// `this`, `super`, `arguments`
    VariableBuiltin = "variable.builtin" in Variable,

    /// A member of an object, a key in JSON, YAML or TOML, a property in CSS, a field in GraphQL.
    Property = "property",

    Function = "function",
    FunctionMethod = "function.method" in Function,

    /// A class, an interface, a type alias, an enum.
    Type = "type",
    /// `string`, `number`, `any`
    TypeBuiltin = "type.builtin" in Type,
    TypeParameter = "type.parameter" in Type,

    Namespace = "namespace",
    Label = "label",
    /// `@Component`, a directive in GraphQL
    Decorator = "decorator",

    /// The name of an element.
    Tag = "tag",
    /// The name of a component: `<Button>`.
    TagComponent = "tag.component" in Tag,
    /// `<` `>` `</` `/>`
    TagDelimiter = "tag.delimiter" in Tag,
    Attribute = "attribute",

    /// `&`, `*` and whatever else of a CSS selector fits nothing below. An element is a `tag`.
    Selector = "selector",
    SelectorClass = "selector.class" in Selector,
    SelectorId = "selector.id" in Selector,
    /// `:hover`, `::before`
    SelectorPseudo = "selector.pseudo" in Selector,

    MarkupHeading = "markup.heading",
    MarkupBold = "markup.bold",
    MarkupItalic = "markup.italic",
    MarkupStrikethrough = "markup.strikethrough",
    /// The text of a link.
    MarkupLink = "markup.link",
    MarkupLinkUrl = "markup.link.url" in MarkupLink,
    /// Inline code, and a code block in a language that isn't highlighted.
    MarkupRaw = "markup.raw",
    MarkupQuote = "markup.quote",
    /// `-`, `1.`, `[x]`
    MarkupList = "markup.list",
}

impl Token {
    pub fn from_name(name: &[u8]) -> Option<Token> {
        Token::ALL
            .iter()
            .copied()
            .find(|token| token.name().as_bytes() == name)
    }
}
