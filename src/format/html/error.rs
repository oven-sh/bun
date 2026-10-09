//! The errors of `angular-html-parser`, with its messages.

use crate::text::utf16_len;
use bun_core::strings;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum ErrorKind {
    UnexpectedCharacter,
    UnknownEntity,
    DecimalEntityWithoutSemicolon,
    HexadecimalEntityWithoutSemicolon,
    UnclosedBlock,
    IcuWithoutClosingBrace,
    IcuWithoutOpeningBrace,
    SelfClosed,
    OpeningTagNotTerminated,
    EndTagOfVoidElement,
    UnexpectedClosingTag,
    UnexpectedClosingBlock,
    IncompleteBlock,
    LetWithoutValue,
    LetNotTerminated,
    IncompleteLet,
    /// None of the parser's: Prettier fails over what has been parsed.
    Other,
}

#[derive(Debug, Copy, Clone)]
pub(crate) struct SyntaxError<'a> {
    /// Where its span starts.
    pub(crate) at: u32,
    pub(crate) kind: ErrorKind,
    /// The namespace of `name`, if that is the name of an element.
    pub(crate) prefix: &'a [u8],
    /// What the message names. For a character: the text from it on.
    pub(crate) name: &'a [u8],
    /// `_isInExpansionForm()`, when it was thrown by the lexer.
    pub(crate) is_in_expansion_form: bool,
}

impl<'a> SyntaxError<'a> {
    pub(crate) fn new(at: u32, kind: ErrorKind, name: &'a [u8]) -> SyntaxError<'a> {
        SyntaxError {
            at,
            kind,
            prefix: b"",
            name,
            is_in_expansion_form: false,
        }
    }

    /// `error.msg`
    fn message(&self) -> Vec<u8> {
        use ErrorKind::*;
        let name = match self.prefix {
            b"" => self.name.to_vec(),
            prefix => [&b":"[..], prefix, b":", self.name].concat(),
        };
        let (before, after): (&str, &str) = match self.kind {
            UnexpectedCharacter => ("Unexpected character \"", "\""),
            UnknownEntity => (
                "Unknown entity \"",
                "\" - use the \"&#<decimal>;\" or  \"&#x<hex>;\" syntax",
            ),
            DecimalEntityWithoutSemicolon => (
                "Unable to parse entity \"",
                "\" - decimal character reference entities must end with \";\"",
            ),
            HexadecimalEntityWithoutSemicolon => (
                "Unable to parse entity \"",
                "\" - hexadecimal character reference entities must end with \";\"",
            ),
            UnclosedBlock => ("Unclosed block \"", "\""),
            IcuWithoutClosingBrace => ("Invalid ICU message. Missing '}'.", ""),
            IcuWithoutOpeningBrace => ("Invalid ICU message. Missing '{'.", ""),
            SelfClosed => (
                "Only void, custom and foreign elements can be self closed \"",
                "\"",
            ),
            OpeningTagNotTerminated => ("Opening tag \"", "\" not terminated."),
            EndTagOfVoidElement => ("Void elements do not have end tags \"", "\""),
            UnexpectedClosingTag => (
                "Unexpected closing tag \"",
                "\". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags",
            ),
            UnexpectedClosingBlock if name.is_empty() => (
                "Unexpected closing block. The block may have been closed earlier. If you meant to write the `}` character, you should use the \"&#125;\" HTML entity instead.",
                "",
            ),
            UnexpectedClosingBlock => (
                "Unexpected closing block. The block may have been closed earlier. Did you forget to close the <",
                "> element? If you meant to write the `}` character, you should use the \"&#125;\" HTML entity instead.",
            ),
            IncompleteBlock => (
                "Incomplete block \"",
                "\". If you meant to write the @ character, you should use the \"&#64;\" HTML entity instead.",
            ),
            LetWithoutValue => (
                "Invalid @let declaration \"",
                "\". Declaration must have a value.",
            ),
            LetNotTerminated => (
                "Unterminated @let declaration \"",
                "\". Declaration must be terminated with a semicolon.",
            ),
            IncompleteLet if name.is_empty() => (
                "Incomplete @let declaration. @let declarations must be written as `@let <name> = <value>;`",
                "",
            ),
            IncompleteLet => (
                "Incomplete @let declaration \"",
                "\". @let declarations must be written as `@let <name> = <value>;`",
            ),
            Other => ("Unexpected token", ""),
        };
        let name: &[u8] = match (self.kind, &name[..]) {
            (UnexpectedCharacter, [] | [0, ..]) => b"EOF",
            (UnexpectedCharacter, text) => {
                let len = bun_core::lexer::char_and_size(text, 0).1;
                text.get(..len).unwrap_or(text)
            }
            (IcuWithoutClosingBrace | IcuWithoutOpeningBrace | Other, _) => b"",
            (_, name) => name,
        };
        let hint: &str = match self.is_in_expansion_form {
            true => {
                " (Do you have an unescaped \"{\" in your template? Use \"{{ '{' }}\") to escape it.)"
            }
            false => "",
        };
        [before.as_bytes(), name, after.as_bytes(), hint.as_bytes()].concat()
    }

    /// `SyntaxError: Unexpected character "a" (1:2)`, as Prettier shows it. `text`: what has been parsed.
    pub(crate) fn describe(&self, text: &[u8]) -> Vec<u8> {
        let before = text.get(..self.at as usize).unwrap_or(text);
        let line_start = strings::last_index_of_char(before, b'\n').map_or(0, |at| at + 1);
        let place = format!(
            " ({}:{})",
            strings::count_char(before, b'\n') + 1,
            utf16_len(&before[line_start..]) + 1
        );
        [&b"SyntaxError: "[..], &self.message(), place.as_bytes()].concat()
    }
}
