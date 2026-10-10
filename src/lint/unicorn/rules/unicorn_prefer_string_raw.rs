use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefers use of `String.raw` to avoid escaping `\`.
pub struct PreferStringRaw;

const PREFER_STRING_RAW: Message = Message::new("", "`String.raw` should be used to avoid escaping `\\`.");

impl Rule for PreferStringRaw {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-string-raw", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().string_literals();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferStringRaw
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if file.is_declaration_file() {
            return None;
        }
        Some(())
    }

    fn string_literal<'a>(&self, string_literal: Literal<'a>, cx: &mut Cx<'a, Self>) {
        let raw = string_literal.text();
        if !strings::contains(raw, b"\\\\") || is_where_no_template_can_be(string_literal) {
            return;
        }
        let Some(([quote], trimmed)) = raw.get(..raw.len() - 1).and_then(|it| it.split_first_chunk()) else {
            return;
        };
        // It is the value if there is no other escape.
        let Some(unescaped) = unescape_backslash(trimmed, *quote) else {
            return;
        };
        // A last `\` would escape the backtick.
        if unescaped.iter().rev().take_while(|it| **it == b'\\').count() % 2 == 1
            || strings::contains_char(&unescaped, b'`')
            || strings::contains(&unescaped, b"${")
        {
            return;
        }
        cx.report(string_literal, PREFER_STRING_RAW).fix(|fixer| {
            let before = fixer.file().text().get(..string_literal.span().start as usize).unwrap_or_default();
            let space: &[u8] = if ends_with_keyword(before) { b" " } else { b"" };
            fixer.replace(string_literal, [space, b"String.raw`", &unescaped, b"`"].concat())
        });
    }
}

/// `input` with `\` for `\\` and the quote for `\'`. `None` if it has another escape.
fn unescape_backslash(input: &[u8], quote: u8) -> Option<Vec<u8>> {
    let mut result = Vec::with_capacity(input.len());
    let mut rest = input;
    while let Some(at) = strings::index_of_char_usize(rest, b'\\') {
        let next = rest.get(at + 1).filter(|it| **it == b'\\' || **it == quote)?;
        result.extend_from_slice(rest.get(..at)?);
        result.push(*next);
        rest = rest.get(at + 2..)?;
    }
    result.extend_from_slice(rest);
    Some(result)
}

/// What oxlint leaves out, by the parent. The value of a property is among it unless the key is a string.
fn is_where_no_template_can_be(string_literal: Literal) -> bool {
    let is_string =
        |key: Option<Key>| matches!(key.map(Key::kind), Some(KeyKind::String(_) | KeyKind::ComputedString(_)));
    match string_literal.owner() {
        Node::Expr(e) if !e.is_parenthesized() => match e.parent() {
            Node::Prop(prop) if prop.is_jsx_attribute() => e.jsx_container_span().is_none(),
            Node::Prop(prop) => !is_string(prop.key()),
            Node::Stmt(statement) => statement.directive().is_some(),
            Node::EnumMember(member) => !matches!(member.key().map(Key::kind), Some(KeyKind::String(_))),
            _ => false,
        },
        Node::Expr(_) => false,
        Node::Prop(prop) => !prop.key().is_some_and(Key::is_computed),
        Node::Member(member) => member.is_signature(),
        Node::Type(ty) => ty.tag() != TypeTag::Import,
        // Not the name of `declare module "a"`, nor what else a statement has.
        Node::Stmt(statement) => {
            statement.tag() != StmtTag::ImportEquals && statement.module_specifier_span() == Some(string_literal.span())
        }
        Node::EnumMember(_) => true,
        _ => false,
    }
}

/// By the text alone.
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
    source.last().is_some_and(u8::is_ascii_lowercase) && KEYWORDS.iter().any(|it| source.ends_with(it.as_bytes()))
}
