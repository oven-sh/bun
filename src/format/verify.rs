//! Checks that formatting didn't change the program. Used by `bun fmt --debug-check`.
//!
//! The output is parsed, and its syntax tree is compared with the input's ([`tree`]). So are the comments
//! ([`comments`]). Anything that isn't in the tree may change: whitespace, semicolons, redundant parentheses,
//! the comma after a list's last element, the separators between the members of interfaces and type literals.
//! Parentheses that matter produce a different tree.
//!
//! The changes that the formatter makes to the tree are allowed:
//!
//! - A string's quotes, and the escaping of quotes inside it. A property name without escapes can gain or
//!   lose its quotes.
//! - How numbers are written: `0XAB`, `1.0`, `.5`, `1E5`.
//! - The order of a regular expression's flags.
//! - The order of modifiers: `readonly abstract` equals `abstract readonly`.
//! - `a && (b && c)` equals `a && b && c`, and the same for `||` and `??`.
//! - Empty statements in a statement list are dropped.
//! - `new A` equals `new A()`.
//! - The `|` or `&` before a single type.
//! - Whitespace in JSX text, `{" "}`, and the quotes around attribute values.
//! - The empty braces of `import a, {} from "a"`.
//! - Escapes in names: `\u0061b` equals `ab`.
//! - The text of a template in another language, like `` css`a{}` ``, and the whitespace in the table of a ``
//!   describe.each`..` ``.
//! - Line breaks in templates: `\r\n` becomes `\n`.
//! - The indentation of lines in block comments, and the order of comments.
//! - With the matching options, the order of imports and of the names in them, and everything inside JSDoc
//!   comments.

mod comments;
mod tree;

pub use tree::{Program, Scratch, compare};

use bun_lint::ast::{Expr, ExprKind, Node};

/// A difference between the two programs.
#[derive(Debug)]
pub struct Difference {
    pub what: &'static str,
    /// The offset in the input, and the text there.
    pub before: (u32, Vec<u8>),
    /// The same for the output.
    pub after: (u32, Vec<u8>),
}

impl Difference {
    /// `before` and `after` are each a program's text and the offset of the difference in it.
    #[optimize(size)]
    fn new(what: &'static str, before: (&[u8], u32), after: (&[u8], u32)) -> Difference {
        // The rest of the line, cut off at 40 bytes.
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
    #[optimize(size)]
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

/// True if the text of template `e` may be formatted as CSS, GraphQL, HTML or Markdown.
#[optimize(size)]
pub(crate) fn is_in_another_language(e: Expr<'_>) -> bool {
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

/// True if template `e` is the table of a `` describe.each`..` ``.
#[optimize(size)]
pub(crate) fn is_table(e: Expr<'_>) -> bool {
    matches!(e.parent(), Node::Expr(parent) if matches!(parent.kind(), ExprKind::TaggedTemplate(call)
        if call.template() == Some(e) && call.callee().text().ends_with(b".each")))
}

/// `name` with escapes like `\u0061` and `\u{61}` decoded.
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
