//! A check that formatting has not changed the program: the file before and the file after have
//! the same tokens and the same comments, but for what the formatter is meant to change.
//!
//! - Parentheses and semicolons are added and removed. They are not compared.
//! - So are the comma after the last element of a list, the separators of the members of
//!   interfaces and type literals, and the `|` or `&` before the first type of a union or an
//!   intersection.
//! - The quotes of strings, and the escapes of quotes in them. A property name can get or lose its
//!   quotes.
//! - How numbers are written: `0XAB`, `1.0`, `.5`, `1E5`.
//! - The order of the flags of a regular expression.
//! - The order of modifiers: `readonly abstract` is `abstract readonly`.
//! - The white space in JSX text, and `{" "}`.
//! - The empty braces of `import a, {} from "a"`.
//! - Escapes in names: `\u0061b` is `ab`.
//! - The indentation of the lines of block comments.
//!
//! It is a debugging aid, not a proof: a formatter that drops a pair of parentheses that matters
//! goes unnoticed.

use crate::js::utils::number::format_trimmed_number;
use bun_lint::ast::walk::{Visitor, walk};
use bun_lint::ast::{File, Node, StmtKind, TypeKind};
use bun_lint::tokens::{Token, TokenKind};
use std::borrow::Cow;

/// Where the tokens differ.
#[derive(Debug)]
pub struct Difference {
    /// The offset in the file before, and the token there.
    pub before: (u32, Vec<u8>),
    /// The same for the file after.
    pub after: (u32, Vec<u8>),
}

impl std::fmt::Display for Difference {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "`{}` at {} is `{}` at {}",
            bstr::BStr::new(&self.before.1),
            self.before.0,
            bstr::BStr::new(&self.after.1),
            self.after.0
        )
    }
}

/// The `{` of the interfaces and type literals of a file.
struct TypeBodies(Vec<u32>);

impl<'a> Visitor<'a> for TypeBodies {
    fn enter(&mut self, node: Node<'a>) {
        match node {
            Node::Type(ty) if matches!(ty.kind(), TypeKind::Object(_)) => self.0.push(ty.span().start),
            Node::Stmt(statement) => {
                if let StmtKind::Interface(interface) = statement.kind() {
                    self.0.push(interface.body_span().start);
                }
            }
            _ => {}
        }
    }

    fn exit(&mut self, _: Node<'a>) {}
}

/// A token in the form that is compared, and where it is.
type Item<'a> = (Cow<'a, [u8]>, u32);

/// `name` with the characters that `\u0061` and `\u{61}` in it stand for.
fn without_unicode_escapes(name: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(name.len());
    let mut rest = name;
    while let Some((&byte, after)) = rest.split_first() {
        rest = after;
        let Some(escape) = after.strip_prefix(b"u").filter(|_| byte == b'\\') else {
            out.push(byte);
            continue;
        };
        let (digits, after) = match escape.strip_prefix(b"{") {
            Some(braced) => {
                let end = bun_core::strings::index_of_char_usize(braced, b'}').unwrap_or(braced.len());
                (&braced[..end], braced.get(end + 1..).unwrap_or_default())
            }
            None => escape.split_at(escape.len().min(4)),
        };
        let code_point = digits.iter().try_fold(0u32, |all, &digit| Some(all.checked_mul(16)? + char::from(digit).to_digit(16)?));
        bun_lint::utils::text::push_code_point(&mut out, code_point.unwrap_or(0xFFFD));
        rest = after;
    }
    out
}

fn without_quote_escapes(content: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(content.len());
    let mut bytes = content.iter().copied().peekable();
    while let Some(byte) = bytes.next() {
        match (byte, bytes.peek()) {
            (b'\\', Some(b'"' | b'\'')) => {}
            (b'\\', Some(&next)) => {
                out.extend([byte, next]);
                bytes.next();
            }
            _ => out.push(byte),
        }
    }
    out
}

fn is_closer(token: Token<'_>) -> bool {
    token.kind() == TokenKind::Punctuator && matches!(token.text(), b")" | b"]" | b"}" | b">")
}

fn items<'a>(file: &'a File<'a>) -> Vec<Item<'a>> {
    let mut type_bodies = TypeBodies(Vec::new());
    walk(file, &mut type_bodies);
    type_bodies.0.sort_unstable();

    let mut out: Vec<Item<'a>> = Vec::new();
    // For each `{`, `[` and `(` that is open, whether it is that of an interface or a type literal.
    let mut open: Vec<bool> = Vec::new();
    let mut previous: Option<Token<'a>> = None;
    let mut tokens = file.tokens().peekable();

    while let Some(token) = tokens.next() {
        let (text, start) = (token.text(), token.start());
        let before = previous.replace(token);
        match token.kind() {
            TokenKind::Punctuator => match text {
                b"(" | b")" | b";" => {
                    match text {
                        b"(" => open.push(false),
                        b")" => drop(open.pop()),
                        _ => {}
                    }
                    continue;
                }
                b"{" | b"[" => open.push(type_bodies.0.binary_search(&start).is_ok()),
                b"}" | b"]" => drop(open.pop()),
                b"," if open.last() == Some(&true) || tokens.peek().is_none_or(|next| is_closer(*next)) => continue,
                // In front of the first type.
                b"|" | b"&"
                    if before.is_some_and(|it| {
                        (it.kind() == TokenKind::Punctuator && !is_closer(it))
                            || matches!(it.text(), b"extends" | b"as" | b"satisfies" | b"is" | b"keyof" | b"readonly" | b"in")
                    }) =>
                {
                    continue;
                }
                _ => {}
            },
            TokenKind::String => {
                let content = text.get(1..text.len().saturating_sub(1)).unwrap_or_default();
                // `{" "}`
                if content == b" "
                    && before.is_some_and(|it| it.is_punctuator("{"))
                    && tokens.peek().is_some_and(|it| it.is_punctuator("}"))
                    && out.last().is_some_and(|it| &*it.0 == b"{")
                {
                    out.pop();
                    open.pop();
                    previous = tokens.next();
                    continue;
                }
                out.push((Cow::Owned(without_quote_escapes(content)), start));
                continue;
            }
            TokenKind::Numeric => {
                let number = match text.ends_with(b"n") {
                    true => Cow::Owned(text.to_ascii_lowercase()),
                    false => format_trimmed_number(text),
                };
                out.push((number, start));
                continue;
            }
            TokenKind::RegularExpression => {
                let mut regex = text.to_vec();
                let flags = bun_core::strings::last_index_of_char(text, b'/').map_or(text.len(), |it| it + 1);
                if let Some(flags) = regex.get_mut(flags..) {
                    flags.sort_unstable();
                }
                out.push((Cow::Owned(regex), start));
                continue;
            }
            // The value of an attribute. Nothing is an escape in it but the entities.
            TokenKind::JsxText
                if before.is_some_and(|it| it.is_punctuator("=")) && matches!(text.first(), Some(b'"' | b'\'')) =>
            {
                let content = text.get(1..text.len().saturating_sub(1)).unwrap_or_default();
                let content = bun_core::strings::replace_owned(content, b"&apos;", b"'");
                out.push((Cow::Owned(bun_core::strings::replace_owned(&content, b"&quot;", b"\"")), start));
                continue;
            }
            TokenKind::JsxText => {
                out.extend(
                    text.split(|byte| byte.is_ascii_whitespace())
                        .filter(|word| !word.is_empty())
                        .map(|word| (Cow::Borrowed(word), start)),
                );
                continue;
            }
            // `\u0061b` is printed as `ab`.
            TokenKind::Identifier | TokenKind::Keyword | TokenKind::PrivateIdentifier
                if bun_core::strings::contains_char(text, b'\\') =>
            {
                out.push((Cow::Owned(without_unicode_escapes(text)), start));
                continue;
            }
            _ => {}
        }
        // `import a, {} from "a"`
        if text == b"from" && matches!(out.as_slice(), [.., a, b, c] if *a.0 == *b"," && *b.0 == *b"{" && *c.0 == *b"}") {
            out.truncate(out.len() - 3);
        }
        out.push((Cow::Borrowed(text), start));
        // Modifiers are put in order.
        let mut at = out.len() - 1;
        while is_modifier(text) && at > 0 && is_modifier(&out[at - 1].0) && out[at - 1].0 > out[at].0 {
            out.swap(at - 1, at);
            at -= 1;
        }
    }
    out
}

fn is_modifier(text: &[u8]) -> bool {
    matches!(
        text,
        b"declare"
            | b"public"
            | b"protected"
            | b"private"
            | b"static"
            | b"abstract"
            | b"override"
            | b"readonly"
            | b"const"
            | b"in"
            | b"out"
    )
}

/// The comments, each without the white space at the start and at the end of its lines.
fn comments<'a>(file: &'a File<'a>) -> Vec<(Vec<u8>, u32)> {
    let mut all: Vec<_> = file
        .comments()
        .map(|comment| {
            let mut text = Vec::new();
            for line in bun_core::strings::split(comment.text(), b"\n") {
                text.extend_from_slice(line.trim_ascii());
                text.push(b'\n');
            }
            (text, comment.start())
        })
        .collect();
    all.sort();
    all
}

/// Whether `after` is the same program as `before`, as far as the tokens tell.
pub fn compare<'a, 'b>(before: &'a File<'a>, after: &'b File<'b>) -> Result<(), Difference> {
    fn first_difference<T: AsRef<[u8]>, U: AsRef<[u8]>>(before: &[(T, u32)], after: &[(U, u32)]) -> Result<(), Difference> {
        let end = (&b"the end"[..], 0);
        let count = before.len().max(after.len());
        for i in 0..count {
            let a = before.get(i).map_or(end, |it| (it.0.as_ref(), it.1));
            let b = after.get(i).map_or(end, |it| (it.0.as_ref(), it.1));
            if a.0 != b.0 || before.get(i).is_some() != after.get(i).is_some() {
                return Err(Difference {
                    before: (a.1, a.0.to_vec()),
                    after: (b.1, b.0.to_vec()),
                });
            }
        }
        Ok(())
    }
    first_difference(&items(before), &items(after))?;
    first_difference(&comments(before), &comments(after))
}
