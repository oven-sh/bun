use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefers use of `String.raw` to avoid escaping `\`.
pub struct PreferStringRaw;

const PREFER_STRING_RAW: Message =
    Message::new("", "`String.raw` should be used to avoid escaping `\\`.");

impl Rule for PreferStringRaw {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "prefer-string-raw", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().string_literals();
    /// The offsets of each `\\` in the text, in order.
    type State<'a> = Vec<u32>;

    fn new(_: &Options) -> Self {
        PreferStringRaw
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if file.is_declaration_file() {
            return None;
        }
        let (text, mut found) = (file.text(), Vec::new());
        let mut at = strings::index_of_char_usize(text, b'\\')?;
        while let Some(next) = text
            .get(at..)
            .and_then(|rest| strings::index_of(rest, b"\\\\"))
        {
            found.push((at + next) as u32);
            at += next + 2;
        }
        (!found.is_empty()).then_some(found)
    }

    fn string_literal<'a>(&self, string_literal: Literal<'a>, cx: &mut Cx<'a, Self>) {
        let (span, found) = (string_literal.span(), &cx.state);
        if found
            .get(found.partition_point(|it| *it < span.start))
            .is_none_or(|it| *it >= span.end)
            || is_skipped_position(string_literal)
        {
            return;
        }
        let raw = string_literal.text();
        let Some(([quote], trimmed)) = raw
            .get(..raw.len() - 1)
            .and_then(|it| it.split_first_chunk())
        else {
            return;
        };
        // This is the string's value if there's no other escape.
        let Some(unescaped) = unescape_backslash(trimmed, *quote) else {
            return;
        };
        // A trailing `\` would escape the backtick.
        if unescaped
            .iter()
            .rev()
            .take_while(|it| **it == b'\\')
            .count()
            % 2
            == 1
            || strings::contains_char(&unescaped, b'`')
            || strings::contains(&unescaped, b"${")
        {
            return;
        }
        cx.report(string_literal, PREFER_STRING_RAW)
            .called_with_name()
            .fix(|fixer| {
                // Bun's runtime passes `\u00E9` to a tag as the raw text of `é`, so the string's value would change.
                if !unescaped.is_ascii() {
                    return None;
                }
                let before = fixer
                    .file()
                    .text()
                    .get(..string_literal.span().start as usize)
                    .unwrap_or_default();
                let space: &[u8] = if ends_with_keyword(before) { b" " } else { b"" };
                Some(fixer.replace(
                    string_literal,
                    [space, b"String.raw`", &unescaped, b"`"].concat(),
                ))
            });
    }
}

/// Returns `input` with `\\` replaced by `\` and `\'` by the quote. `None` if it has any other escape.
fn unescape_backslash(input: &[u8], quote: u8) -> Option<Vec<u8>> {
    let mut result = Vec::with_capacity(input.len());
    let mut rest = input;
    while let Some(at) = strings::index_of_char_usize(rest, b'\\') {
        let next = rest
            .get(at + 1)
            .filter(|it| **it == b'\\' || **it == quote)?;
        result.extend_from_slice(rest.get(..at)?);
        result.push(*next);
        rest = rest.get(at + 2..)?;
    }
    result.extend_from_slice(rest);
    Some(result)
}

/// The positions oxlint skips, judged by the parent. They include a property's value unless the key is a string.
fn is_skipped_position(string_literal: Literal) -> bool {
    let is_string = |key: Option<Key>| {
        matches!(
            key.map(Key::kind),
            Some(KeyKind::String(_) | KeyKind::ComputedString(_))
        )
    };
    match string_literal.owner() {
        Node::Expr(e) if !e.is_parenthesized() => match e.parent() {
            Node::Prop(prop) if prop.is_jsx_attribute() => e.jsx_container_span().is_none(),
            Node::Prop(prop) => !is_string(prop.key()),
            Node::Stmt(statement) => statement.directive().is_some(),
            Node::EnumMember(member) => {
                !matches!(member.key().map(Key::kind), Some(KeyKind::String(_)))
            }
            _ => false,
        },
        Node::Expr(_) => false,
        Node::Prop(prop) => !prop.key().is_some_and(Key::is_computed),
        Node::Member(member) => member.is_signature(),
        Node::Type(ty) => ty.tag() != TypeTag::Import,
        // Only a module specifier. Not the name of `declare module "a"` or any other string in a statement.
        Node::Stmt(statement) => {
            statement.tag() != StmtTag::ImportEquals
                && statement.module_specifier_span() == Some(string_literal.span())
        }
        Node::EnumMember(_) => true,
        _ => false,
    }
}

/// Only looks at the text.
fn ends_with_keyword(source: &[u8]) -> bool {
    const KEYWORDS: [&str; 47] = [
        "let",
        "static",
        "implements",
        "interface",
        "package",
        "private",
        "protected",
        "public",
        "await",
        "break",
        "case",
        "catch",
        "class",
        "const",
        "continue",
        "debugger",
        "default",
        "delete",
        "do",
        "else",
        "enum",
        "export",
        "extends",
        "false",
        "finally",
        "for",
        "function",
        "if",
        "import",
        "in",
        "instanceof",
        "new",
        "null",
        "return",
        "super",
        "switch",
        "this",
        "throw",
        "true",
        "try",
        "typeof",
        "var",
        "void",
        "while",
        "with",
        "yield",
        "of",
    ];
    source.last().is_some_and(u8::is_ascii_lowercase)
        && KEYWORDS.iter().any(|it| source.ends_with(it.as_bytes()))
}
