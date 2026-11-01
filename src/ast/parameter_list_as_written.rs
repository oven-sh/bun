//! The runtime prints a parameter list that holds a comment as it is written: an injector reads `/* token */ name` from `fn.toString()`.

use bun_alloc::AstAlloc;
use bun_collections::ArrayHashMap;
use bun_collections::array_hash_map::AutoContext;
use bun_core::strings;

use crate::StoreStr;

/// The key is where the printer finds the list again: the `(` of a function, the start of an arrow function.
pub type ParameterListsAsWritten = ArrayHashMap<i32, StoreStr, AutoContext, AstAlloc>;

/// `mock.module` takes each of these, anywhere in the text of a factory, as a mention of the original module.
const READ_BY_MOCK_MODULE: [&[u8]; 3] = [b"importOriginal", b"importActual", b"requireActual"];

/// The text up to the `)` of the list that starts at `after_open_paren`, if the printer is to write it: plain names and a comment.
pub fn text_to_keep(after_open_paren: &[u8]) -> Option<&[u8]> {
    let mut names = Names::new(after_open_paren);
    while let Ok(Some(_)) = names.next_name() {}
    let (text, rest) = after_open_paren.split_at(names.position);
    let is_kept = names.has_comment
        && rest.first() == Some(&b')')
        && !READ_BY_MOCK_MODULE
            .iter()
            .any(|word| strings::contains(text, word));
    is_kept.then_some(text)
}

pub struct Name {
    pub start: usize,
    pub end: usize,
    /// `...` stands before it.
    pub is_rest: bool,
}

/// The text holds something other than names, commas, `...`, ASCII whitespace and ASCII comments.
#[derive(Debug)]
pub struct NotPlainNames;

/// The names in the text between the parentheses of a parameter list.
pub struct Names<'a> {
    text: &'a [u8],
    /// After an error, where what is not part of a list of plain names starts.
    position: usize,
    has_comment: bool,
}

impl<'a> Names<'a> {
    pub fn new(text: &'a [u8]) -> Self {
        Names {
            text,
            position: 0,
            has_comment: false,
        }
    }

    /// `Ok(None)` at the end of the text.
    pub fn next_name(&mut self) -> Result<Option<Name>, NotPlainNames> {
        let text = self.text;
        let mut at = self.position;
        let mut is_rest = false;
        let found = loop {
            let Some(&byte) = text.get(at) else {
                break if is_rest {
                    Err(NotPlainNames)
                } else {
                    Ok(None)
                };
            };
            match byte {
                b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C => at += 1,
                b',' if !is_rest => at += 1,
                b'.' if !is_rest && text[at..].starts_with(b"...") => {
                    is_rest = true;
                    at += 3;
                }
                b'/' => match end_of_comment(text, at) {
                    Some(end) => {
                        at = end;
                        self.has_comment = true;
                    }
                    None => break Err(NotPlainNames),
                },
                b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' => {
                    let start = at;
                    while text.get(at).is_some_and(|&byte| is_name_byte(byte)) {
                        at += 1;
                    }
                    break Ok(Some(Name {
                        start,
                        end: at,
                        is_rest,
                    }));
                }
                _ => break Err(NotPlainNames),
            }
        };
        self.position = at;
        found
    }
}

fn is_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$'
}

/// `text[at]` is `/`. The end of the ASCII comment that starts there, if it ends inside the text: a line comment ends before its line terminator.
fn end_of_comment(text: &[u8], at: usize) -> Option<usize> {
    let body = text.get(at + 2..)?;
    let length = match text[at + 1] {
        b'*' => strings::index_of(body, b"*/")? + 2,
        // JavaScriptCore reads `sourceURL=` and `sourceMappingURL=` from a comment that starts with `//#` or `//@`.
        b'/' if !matches!(body.first(), Some(b'#' | b'@')) => strings::index_of_any(body, b"\r\n")?,
        _ => return None,
    };
    body[..length].is_ascii().then_some(at + 2 + length)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `None`: not a list of plain names.
    fn names_of(text: &str) -> Option<(Vec<String>, bool)> {
        let mut names = Names::new(text.as_bytes());
        let mut found = Vec::new();
        while let Some(name) = names.next_name().ok()? {
            let spelling = &text[name.start..name.end];
            found.push(if name.is_rest {
                format!("...{spelling}")
            } else {
                spelling.to_owned()
            });
        }
        Some((found, names.has_comment))
    }

    fn commented(names: &[&str]) -> Option<(Vec<String>, bool)> {
        Some((names.iter().map(|&name| name.to_owned()).collect(), true))
    }

    fn kept(after_open_paren: &str) -> Option<&str> {
        text_to_keep(after_open_paren.as_bytes()).map(|text| core::str::from_utf8(text).unwrap())
    }

    #[test]
    fn names_and_comments() {
        assert_eq!(
            names_of("/* config */config, /* config.proxies */proxies"),
            commented(&["config", "proxies"])
        );
        assert_eq!(
            names_of("a /* after */, $b_1 // line\n"),
            commented(&["a", "$b_1"])
        );
        assert_eq!(names_of("/* a, b) */"), commented(&[]));
        assert_eq!(
            names_of(" a,\r\n\tb, "),
            Some((vec!["a".into(), "b".into()], false))
        );
        assert_eq!(names_of(""), Some((vec![], false)));
    }

    #[test]
    fn rest_parameter() {
        assert_eq!(
            names_of("a, /* all */ ...rest"),
            commented(&["a", "...rest"])
        );
        assert_eq!(names_of("... /* all */ rest"), commented(&["...rest"]));
        assert_eq!(names_of("a, ..."), None);
        assert_eq!(names_of("......a"), None);
        assert_eq!(names_of("..a"), None);
        assert_eq!(names_of("...,a"), None);
    }

    #[test]
    fn what_is_not_a_plain_name() {
        for text in [
            "a = 1",
            "{ a }",
            "[a]",
            "a: number",
            "a?",
            "@inject a",
            "a /* \u{e9} */",
            "a // \u{e9}\n",
            "\u{e9}",
            "a\\u0062",
            "a <!-- b\n",
            "a / b",
            "1",
            "a)",
        ] {
            assert_eq!(names_of(text), None, "{text}");
        }
    }

    #[test]
    fn a_comment_ends_inside_the_text() {
        assert_eq!(names_of("a /* open"), None);
        assert_eq!(names_of("a // no line terminator"), None);
        assert_eq!(names_of("a /"), None);
        assert_eq!(names_of("a // ends\r"), commented(&["a"]));
        assert_eq!(names_of("/**/"), commented(&[]));
        assert_eq!(names_of("/*/ a */ b"), commented(&["b"]));
    }

    #[test]
    fn a_line_comment_that_can_hold_a_directive_is_not_passed() {
        assert_eq!(names_of("a, //# sourceURL=x.js\n b"), None);
        assert_eq!(names_of("a, //@ sourceMappingURL=x\n b"), None);
        assert_eq!(names_of("a, //#region\n b"), None);
        assert_eq!(
            names_of("a, // # sourceURL=x.js\n b"),
            commented(&["a", "b"])
        );
        assert_eq!(names_of("/*# sourceURL=x.js */ a"), commented(&["a"]));
    }

    #[test]
    fn a_keyword_is_a_name_here() {
        // The parser leaves a TypeScript `this` parameter and a modifier out of the arguments, so the printer finds other names.
        assert_eq!(names_of("this, /* c */ a"), commented(&["this", "a"]));
        assert_eq!(names_of("public /* c */ a"), commented(&["public", "a"]));
    }

    #[test]
    fn the_text_to_keep_ends_before_the_close_paren() {
        assert_eq!(kept("a, /* c */ b) { return a; }"), Some("a, /* c */ b"));
        assert_eq!(kept("/* none */) => 1"), Some("/* none */"));
        assert_eq!(kept("a, // c\n  b,\n) {}"), Some("a, // c\n  b,\n"));
    }

    #[test]
    fn no_text_is_kept() {
        for after_open_paren in [
            "a, b) /* c */ => a",
            "/* c */ a = 1) {}",
            "/* c */ a: string) {}",
            "/* c */ a, { b }) {}",
            "/* c */ a",
            "/* c */",
            "/* importOriginal */ load) => load()",
            "load /* see vi.importActual */) => load()",
            "/* c */ requireActual) => 1",
        ] {
            assert_eq!(kept(after_open_paren), None, "{after_open_paren}");
        }
    }
}
