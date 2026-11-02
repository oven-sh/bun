//! Property and member names. Prettier's `print/key.js`.

use super::number::format_trimmed_number;
use super::string::{
    FormatLiteralStringToken, StringLiteralParentKind, is_canonical_simple_number,
    is_name_without_quotes, is_simple_number,
};
use super::tailwindcss::{
    context_of_string, has_white_space, sorted_string_literal, sorted_template_text,
};
use crate::ir::width::string_width;
use crate::js::format::format_name;
use crate::prelude::*;
use crate::write;
use bun_lint::linter::is_flow_file;
use std::borrow::Cow;

/// Prettier's `printKey`, without a computed key's brackets, with the comments around it. Quotes are added and removed
/// according to `quoteProps`.
#[derive(Copy, Clone)]
pub(crate) struct FormatKey<'a> {
    key: Key<'a>,
    /// The node it names.
    parent: AstNodes<'a>,
}

impl<'a> FormatKey<'a> {
    pub(crate) fn new(key: Key<'a>, parent: AstNodes<'a>) -> Self {
        FormatKey { key, parent }
    }
}

/// The node that a key names. Most keys are printed without looking at it, so the node kind of a member or property is
/// only computed on demand.
#[derive(Copy, Clone)]
pub(crate) enum KeyParent<'a> {
    Node(AstNodes<'a>),
    Member(Member<'a>),
    Property(Prop<'a>),
}

impl<'a> KeyParent<'a> {
    #[inline]
    fn as_ast_nodes(self) -> AstNodes<'a> {
        match self {
            KeyParent::Node(node) => node,
            KeyParent::Member(member) => member.as_ast_nodes(),
            KeyParent::Property(property) => property.as_ast_nodes(),
        }
    }
}

/// Prints `key`, which isn't an expression in brackets. Returns its width in columns.
fn write_key<'a>(key: Key<'a>, parent: KeyParent<'a>, f: &mut Formatter<'a>) -> usize {
    let span = key.inner_span(file_of(f));
    let is_name = matches!(key.kind(), KeyKind::Ident(_) | KeyKind::Private(_));
    if is_name && f.is_quiet() && !f.options().quote_properties.is_consistent() {
        write!(f, source_text(span));
        return match f.elements().last() {
            Some(FormatElement::SourceText(text)) => text.width.value() as usize,
            _ => 0,
        };
    }
    let mut printed = printed_key(key, span, parent.as_ast_nodes(), f);
    // Prettier's `printPropertyKey` prints a key like any other node unless it adds or removes the quotes, so a
    // `prettier-ignore` comment applies to `0XAB` and `'a-b'`, and not to the `'a'` that is printed as `a`.
    let source = f.source_text().text_for(&span);
    let has_quotes = |text: &[u8]| matches!(text.first(), Some(b'"' | b'\''));
    if !f.is_quiet()
        && has_quotes(source) == has_quotes(&printed)
        && f.comments().of_name(span.start).is_ignored
    {
        printed = Cow::Borrowed(source);
    }
    format_name(span, f, |f| match &printed {
        Cow::Borrowed(_) if is_name => write!(f, source_text(span)),
        _ => write!(f, text(&printed)),
    });
    // With a line break in it, it isn't a single string to Prettier, which only measures the width of single strings.
    match bun_core::strings::contains_char(&printed, b'\n') {
        true => usize::MAX,
        false => string_width(&printed) as usize,
    }
}

impl<'a> Format<'a> for FormatKey<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match self.key.kind() {
            KeyKind::Computed(expression) => expression.fmt(f),
            _ => {
                write_key(self.key, KeyParent::Node(self.parent), f);
            }
        }
    }
}

fn file_of<'a>(f: &Formatter<'a>) -> &'a File<'a> {
    f.file()
}

/// `text` wrapped in the configured quotes. It has no quotes in it.
fn quoted<'a>(text: &[u8], f: &Formatter<'a>) -> Cow<'a, [u8]> {
    let quote = f.options().quote_style.as_byte();
    let mut quoted = Vec::with_capacity(text.len() + 2);
    quoted.push(quote);
    quoted.extend_from_slice(text);
    quoted.push(quote);
    Cow::Owned(quoted)
}

/// `text` with `\r\n` and `\r` replaced by `\n`, which is what Prettier gets.
fn with_normalized_newlines(text: Cow<'_, [u8]>) -> Cow<'_, [u8]> {
    if !bun_core::strings::contains_char(&text, b'\r') {
        return text;
    }
    let mut normalized = Vec::with_capacity(text.len());
    bun_core::strings::push_crlf_as_lf(&mut normalized, &text);
    Cow::Owned(normalized)
}

/// The printed form of `key`, which is at `span` and isn't an expression in brackets.
fn printed_key<'a>(
    key: Key<'a>,
    span: Span,
    parent: AstNodes<'a>,
    f: &Formatter<'a>,
) -> Cow<'a, [u8]> {
    let source = f.source_text().text_for(&span);
    let string_literal = || {
        FormatLiteralStringToken::new(source, false, StringLiteralParentKind::Expression)
            .clean_text(f)
            .into_text()
    };
    if matches!(key.kind(), KeyKind::String(_) | KeyKind::ComputedString(_))
        && !source.starts_with(b"`")
        && let Some(context) = context_of_string(source, f)
        && let Some(sorted) = sorted_string_literal(source, false, (span, parent), context, f)
    {
        return Cow::Owned(sorted);
    }
    if let (KeyKind::ComputedString(_), [b'`', text @ .., b'`']) = (key.kind(), source)
        && has_white_space(text)
        && let (Some(context), Some(tailwind)) = (
            f.context().tailwind_context(),
            f.options().tailwind.as_deref(),
        )
        && let context = match context.follows_plugin {
            true => context.in_template_at(span, parent, f),
            false => context,
        }
        && let Some(sorted) = sorted_template_text(text, (true, true), context, tailwind)
    {
        return with_normalized_newlines(Cow::Owned([&b"`"[..], &sorted, b"`"].concat()));
    }
    match key.kind() {
        KeyKind::Ident(name) if should_quote_keys(parent, f) => quoted(name.bytes(), f),
        KeyKind::Ident(_) | KeyKind::Private(_) | KeyKind::Computed(_) => Cow::Borrowed(source),
        KeyKind::String(_) => match unquoted(source, Some(parent), f) {
            Some(content) if should_unquote_keys(parent, f) => Cow::Borrowed(content),
            _ => string_literal(),
        },
        KeyKind::ComputedString(_) if source.starts_with(b"`") => {
            with_normalized_newlines(Cow::Borrowed(source))
        }
        KeyKind::ComputedString(_) => string_literal(),
        KeyKind::Number(_) | KeyKind::ComputedNumber(_) if source.ends_with(b"n") => {
            match source.iter().any(u8::is_ascii_uppercase) {
                true => Cow::Owned(source.to_ascii_lowercase()),
                false => Cow::Borrowed(source),
            }
        }
        KeyKind::ComputedNumber(_) => format_trimmed_number(source),
        KeyKind::Number(name) => {
            let printed = format_trimmed_number(source);
            // Prettier's `isKeySafeToQuote`: not in TypeScript, where it changes the type, and only if the number is
            // written the same way it converts to a string.
            let is_safe_to_quote = (f.context().has_babel_tree() || f.file().is_flow())
                && is_simple_number(&printed)
                && name.bytes() == &*printed;
            match is_safe_to_quote && should_quote_keys(parent, f) {
                true => quoted(&printed, f),
                false => printed,
            }
        }
    }
}

/// True if Prettier's `parser` is `babel` or similar, not one of the parsers for an expression in HTML or for JSX in
/// MDX. Prettier doesn't list those where it unquotes a number.
fn is_parser_for_programs(f: &Formatter<'_>) -> bool {
    matches!(f.options().in_html.root, HtmlRoot::None | HtmlRoot::Program)
        && !f.options().is_mdx_jsx
}

/// Prettier's `isKeySafeToUnquote`. `string` is a string literal that names `parent`. Returns it without its quotes.
fn unquoted<'a>(
    string: &'a [u8],
    parent: Option<AstNodes<'a>>,
    f: &Formatter<'a>,
) -> Option<&'a [u8]> {
    let content = string.get(1..string.len().saturating_sub(1))?;
    let is_javascript = f.file().is_javascript();
    let is_safe = match parent {
        Some(AstNodes::TSMethodSignature(_)) if content == b"new" => false,
        // With `strictPropertyInitialization`, TypeScript treats a property with a quoted name
        // differently.
        Some(AstNodes::PropertyDefinition(member))
            if !is_javascript
                && !member
                    .modifiers()
                    .iter()
                    .any(|it| it.flag() == Flags::ABSTRACT) =>
        {
            false
        }
        // In TypeScript, `1` and `"1"` are different types.
        _ => {
            is_name_without_quotes(content, f.options().flavor)
                || (is_javascript
                    && is_parser_for_programs(f)
                    && is_simple_number(content)
                    && is_canonical_simple_number(content)
                    && !f.file().is_flow()
                    && (f.options().flavor.is_oxfmt()
                        || !is_flow_file(
                            bun_core::strings::without_utf8_bom(f.file().text()),
                            f.filepath(),
                        )))
        }
    };
    is_safe.then_some(content)
}

/// True if `key`, which names `parent`, is a string that needs its quotes. With `quoteProps: "consistent"`, the names
/// next to it are then quoted too.
pub(crate) fn key_requires_quotes<'a>(
    key: Key<'a>,
    parent: AstNodes<'a>,
    f: &Formatter<'a>,
) -> bool {
    requires_quotes(key, Some(parent), f)
}

/// [`key_requires_quotes`] without the checks that only apply to the names of some kinds of members.
pub(crate) fn should_preserve_quote<'a>(key: Key<'a>, f: &Formatter<'a>) -> bool {
    requires_quotes(key, None, f)
}

fn requires_quotes<'a>(key: Key<'a>, parent: Option<AstNodes<'a>>, f: &Formatter<'a>) -> bool {
    matches!(key.kind(), KeyKind::String(_))
        && unquoted(f.source_text().text_for(&key.span(file_of(f))), parent, f).is_none_or(
            |content| {
                number_in_quotes_requires_them(f)
                    && !is_name_without_quotes(content, f.options().flavor)
            },
        )
}

/// With `quoteProps: "consistent"`, Prettier prints `{ "1": a, b: c }` as `{ 1: a, b: c }` and oxfmt as `{ "1": a, "b":
/// c }`.
fn number_in_quotes_requires_them(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

/// Prettier's `hasSiblingsRequireQuoted`. `parent` is the node with the name.
///
/// Objects, classes, interfaces and enums, which can be large, have already cached the answer in the context. For
/// patterns, this looks at all the names.
fn siblings_require_quotes<'a>(parent: AstNodes<'a>, f: &Formatter<'a>) -> bool {
    match parent {
        AstNodes::ObjectProperty(_)
        | AstNodes::TSPropertySignature(_)
        | AstNodes::TSMethodSignature(_)
        | AstNodes::MethodDefinition(_)
        | AstNodes::PropertyDefinition(_)
        | AstNodes::AccessorProperty(_)
        | AstNodes::TSEnumMember(_) => f.context().is_quote_needed(),
        AstNodes::BindingProperty(property) => match property.parent() {
            Node::Pat(pattern) => {
                matches!(pattern.kind(), PatKind::Object(properties) if properties.iter().any(|it| {
                    it.key().is_some_and(|key| key_requires_quotes(key, AstNodes::BindingProperty(it), f))
                }))
            }
            _ => false,
        },
        AstNodes::AssignmentTargetPropertyProperty(property) => match property.parent() {
            Node::Expr(object) => {
                matches!(object.kind(), ExprKind::Object(properties) if properties.iter().any(|it| {
                    it.key().is_some_and(|key| key_requires_quotes(key, parent, f))
                }))
            }
            _ => false,
        },
        _ => false,
    }
}

/// The part of Prettier's `shouldQuoteKey` that's the same for all of an object's names.
fn should_quote_keys<'a>(parent: AstNodes<'a>, f: &Formatter<'a>) -> bool {
    f.options().quote_properties.is_consistent() && siblings_require_quotes(parent, f)
}

/// The part of Prettier's `shouldUnquoteKey` that's the same for all of an object's names.
fn should_unquote_keys<'a>(parent: AstNodes<'a>, f: &Formatter<'a>) -> bool {
    match f.options().quote_properties {
        QuoteProperties::AsNeeded => true,
        QuoteProperties::Preserve => false,
        QuoteProperties::Consistent => !siblings_require_quotes(parent, f),
    }
}

/// Prettier's `printKey`.
pub(crate) fn format_computed_or_property_key<'a>(
    key: Key<'a>,
    parent: AstNodes<'a>,
    f: &mut Formatter<'a>,
) {
    match key.is_computed() {
        true => write!(f, ["[", FormatKey::new(key, parent), "]"]),
        false => write!(f, FormatKey::new(key, parent)),
    }
}

/// Prints a key that isn't computed. Returns its width in columns.
#[inline]
pub(crate) fn write_member_name<'a>(
    key: Key<'a>,
    parent: KeyParent<'a>,
    f: &mut Formatter<'a>,
) -> usize {
    write_key(key, parent, f)
}
