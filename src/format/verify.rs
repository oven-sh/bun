//! A check that formatting has not changed the program. `bun format` makes it before it writes a file.
//!
//! What has been written is parsed, and its syntax tree is compared with that of the file ([`tree`]). So are
//! the comments ([`comments`]). All that is not in the tree is free to change: white space, semicolons,
//! parentheses that mean nothing, the comma after the last element of a list, the separators of the members
//! of interfaces and type literals. Parentheses that mean something make another tree.
//!
//! What the formatter changes in the tree is allowed:
//!
//! - The quotes of strings, and the escapes of quotes in them. A property name without escapes can get or
//!   lose its quotes.
//! - How numbers are written: `0XAB`, `1.0`, `.5`, `1E5`.
//! - The order of the flags of a regular expression.
//! - The order of modifiers: `readonly abstract` is `abstract readonly`.
//! - `a && (b && c)` is `a && b && c`, and the same for `||` and `??`.
//! - Empty statements in a list of statements are left out.
//! - `new A` is `new A()`.
//! - The `|` or `&` before a type that is alone.
//! - The white space in JSX text, `{" "}`, and the quotes of the values of attributes.
//! - The empty braces of `import a, {} from "a"`.
//! - Escapes in names: `\u0061b` is `ab`.
//! - The text of a template that is in another language, like `` css`a{}` ``, and the white space in
//!   the table of a `` describe.each`..` ``.
//! - The line breaks in templates: `\r\n` is `\n`.
//! - The indentation of the lines of block comments, and the order of the comments.
//! - With the options for it, the order of imports and of the names in them, and all that is in JSDoc comments.
//!
//! test/cli/format/oracle/verify-mutants.ts damages formatted code and counts what the check notices.

mod comments;
mod tree;

pub use tree::{Program, Scratch, compare};

use bun_lint::ast::{Expr, ExprKind, Node};

/// Where the programs differ.
#[derive(Debug)]
pub struct Difference {
    pub what: &'static str,
    /// The offset in the file before, and the text there.
    pub before: (u32, Vec<u8>),
    /// The same for the file after.
    pub after: (u32, Vec<u8>),
}

impl Difference {
    /// `before`, `after`: the text of the program, and where in it the difference is.
    fn new(what: &'static str, before: (&[u8], u32), after: (&[u8], u32)) -> Difference {
        // The rest of the line, if that is not long.
        let excerpt = |(text, at): (&[u8], u32)| {
            let rest = text.get(at as usize..).unwrap_or_default();
            let line = rest
                .get(..bun_core::strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len()))
                .unwrap_or(rest);
            (
                at.min(text.len() as u32),
                line.get(..40).unwrap_or(line).to_vec(),
            )
        };
        Difference {
            what,
            before: excerpt(before),
            after: excerpt(after),
        }
    }
}

impl std::fmt::Display for Difference {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}: `{}` at {} is `{}` at {}",
            self.what,
            bstr::BStr::new(&self.before.1),
            self.before.0,
            bstr::BStr::new(&self.after.1),
            self.after.0
        )
    }
}

/// Whether the text of the template `e` may be formatted as a style sheet, as GraphQL, as HTML or as Markdown.
fn is_in_another_language(e: Expr<'_>) -> bool {
    let has_tag = match e.parent() {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::TaggedTemplate(call) => {
                matches!(
                    call.callee().text(),
                    b"gql" | b"graphql" | b"graphql.experimental" | b"md" | b"markdown"
                ) || matches!(
                    crate::css::embed::root_name_of_tag(call.callee()),
                    Some(b"css" | b"styled" | b"gql" | b"graphql")
                )
            }
            ExprKind::Call(call) => call.callee().text() == b"graphql",
            _ => false,
        },
        _ => false,
    };
    let before = e
        .file()
        .text()
        .get(..e.span().start as usize)
        .unwrap_or_default();
    has_tag
        || before.trim_ascii_end().ends_with(b"/* GraphQL */")
        || crate::css::embed::is_embed_css(e)
        || crate::html::in_js::can_be_html(e)
}

/// Whether the template `e` is the table of a `` describe.each`..` ``.
fn is_table(e: Expr<'_>) -> bool {
    matches!(e.parent(), Node::Expr(parent) if matches!(parent.kind(), ExprKind::TaggedTemplate(call)
        if call.template() == Some(e) && call.callee().text().ends_with(b".each")))
}

/// `name` with the characters that `\u0061` and `\u{61}` in it stand for.
pub(crate) fn without_unicode_escapes(name: &[u8]) -> Vec<u8> {
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
                let end =
                    bun_core::strings::index_of_char_usize(braced, b'}').unwrap_or(braced.len());
                (&braced[..end], braced.get(end + 1..).unwrap_or_default())
            }
            None => escape.split_at(escape.len().min(4)),
        };
        let code_point = digits.iter().try_fold(0u32, |all, &digit| {
            Some(all.checked_mul(16)? + char::from(digit).to_digit(16)?)
        });
        bun_core::strings::push_codepoint_wtf8(&mut out, code_point.unwrap_or(0xFFFD));
        rest = after;
    }
    out
}
