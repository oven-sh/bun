//! The names of properties and members. Prettier's `print/key.js`.

use super::number::format_trimmed_number;
use super::string::{
    FormatLiteralStringToken, StringLiteralParentKind, is_canonical_simple_number, is_es5_identifier_name,
    is_simple_number,
};
use crate::ir::width::string_width;
use crate::js::format::format_node;
use crate::prelude::*;
use crate::write;
use std::borrow::Cow;

/// Prettier's `printKey`, without the brackets of a computed key, with the comments around it.
/// Quotes are added and removed as `quoteProps` says.
#[derive(Copy, Clone)]
pub(crate) struct FormatKey<'a> {
    key: Key<'a>,
    /// What it is the name of.
    parent: AstNodes<'a>,
}

impl<'a> FormatKey<'a> {
    pub(crate) fn new(key: Key<'a>, parent: AstNodes<'a>) -> Self {
        FormatKey { key, parent }
    }

    /// Writes it. Returns the number of columns that it takes.
    fn write(self, f: &mut Formatter<'a>) -> usize {
        let FormatKey { key, parent } = self;
        let span = key.inner_span(file_of(f));
        let printed = printed_key(key, span, parent, f);
        format_node(span, || parent, f, |f| match (key.kind(), &printed) {
            (KeyKind::Ident(_) | KeyKind::Private(_), Cow::Borrowed(_)) => write!(f, source_text(span)),
            _ => write!(f, text(&printed)),
        });
        string_width(&printed) as usize
    }
}

impl<'a> Format<'a> for FormatKey<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match self.key.kind() {
            KeyKind::Computed(expression) => expression.fmt(f),
            _ => {
                self.write(f);
            }
        }
    }
}

fn file_of<'a>(f: &Formatter<'a>) -> &'a File<'a> {
    f.file()
}

/// `text` in the quotes of the options. It has no quotes in it.
fn quoted<'a>(text: &[u8], f: &Formatter<'a>) -> Cow<'a, [u8]> {
    let quote = f.options().quote_style.as_byte();
    let mut quoted = Vec::with_capacity(text.len() + 2);
    quoted.push(quote);
    quoted.extend_from_slice(text);
    quoted.push(quote);
    Cow::Owned(quoted)
}

/// What is written for `key`, which is at `span` and is not an expression in brackets.
fn printed_key<'a>(key: Key<'a>, span: Span, parent: AstNodes<'a>, f: &Formatter<'a>) -> Cow<'a, [u8]> {
    let source = f.source_text().text_for(&span);
    let string_literal =
        || FormatLiteralStringToken::new(source, false, StringLiteralParentKind::Expression).clean_text(f).into_text();
    match key.kind() {
        KeyKind::Ident(name) if should_quote_keys(parent, f) => quoted(name.bytes(), f),
        KeyKind::Ident(_) | KeyKind::Private(_) | KeyKind::Computed(_) => Cow::Borrowed(source),
        KeyKind::String(_) => match unquoted(source, Some(parent), f) {
            Some(content) if should_unquote_keys(parent, f) => Cow::Borrowed(content),
            _ => string_literal(),
        },
        KeyKind::ComputedString(_) if source.starts_with(b"`") => Cow::Borrowed(source),
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
            // Prettier's `isKeySafeToQuote`: not in TypeScript, where it changes the type, and only
            // if the number is written the way it is converted to a string.
            let is_safe_to_quote =
                f.file().is_javascript() && is_simple_number(&printed) && name.bytes() == &*printed;
            match is_safe_to_quote && should_quote_keys(parent, f) {
                true => quoted(&printed, f),
                false => printed,
            }
        }
    }
}

/// Prettier's `isKeySafeToUnquote`. `string`: a string literal that is the name of `parent`.
/// Returns it without its quotes.
fn unquoted<'a>(string: &'a [u8], parent: Option<AstNodes<'a>>, f: &Formatter<'a>) -> Option<&'a [u8]> {
    let content = string.get(1..string.len().saturating_sub(1))?;
    let is_javascript = f.file().is_javascript();
    let is_safe = match parent {
        Some(AstNodes::TSMethodSignature(_)) if content == b"new" => false,
        // With `strictPropertyInitialization`, TypeScript treats a property with a quoted name
        // differently.
        Some(AstNodes::PropertyDefinition(member))
            if !is_javascript && !member.modifiers().iter().any(|it| it.flag() == Flags::ABSTRACT) =>
        {
            false
        }
        // In TypeScript, `1` and `"1"` are different types.
        _ => {
            is_es5_identifier_name(content)
                || (is_javascript
                    && is_simple_number(content)
                    && is_canonical_simple_number(content)
                    && !crate::pragma::is_flow_file(f.file().text(), f.filepath()))
        }
    };
    is_safe.then_some(content)
}

/// Whether `key`, the name of `parent`, is a string that cannot do without its quotes. With
/// `quoteProps: "consistent"`, the names next to it are quoted then.
pub(crate) fn key_requires_quotes<'a>(key: Key<'a>, parent: AstNodes<'a>, f: &Formatter<'a>) -> bool {
    requires_quotes(key, Some(parent), f)
}

/// [`key_requires_quotes`] without what only holds for the names of some kinds of members.
pub(crate) fn should_preserve_quote<'a>(key: Key<'a>, f: &Formatter<'a>) -> bool {
    requires_quotes(key, None, f)
}

fn requires_quotes<'a>(key: Key<'a>, parent: Option<AstNodes<'a>>, f: &Formatter<'a>) -> bool {
    matches!(key.kind(), KeyKind::String(_))
        && unquoted(f.source_text().text_for(&key.span(file_of(f))), parent, f).is_none()
}

/// Prettier's `hasSiblingsRequireQuoted`. `parent`: what has the name.
///
/// Objects, classes, interfaces and enums, which can be large, have put the answer in the context.
/// For patterns, this looks at all the names.
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
            Node::Pat(pattern) => matches!(pattern.kind(), PatKind::Object(properties) if properties.iter().any(|it| {
                it.key().is_some_and(|key| key_requires_quotes(key, AstNodes::BindingProperty(it), f))
            })),
            _ => false,
        },
        AstNodes::AssignmentTargetPropertyProperty(property) => match property.parent() {
            Node::Expr(object) => matches!(object.kind(), ExprKind::Object(properties) if properties.iter().any(|it| {
                it.key().is_some_and(|key| key_requires_quotes(key, parent, f))
            })),
            _ => false,
        },
        _ => false,
    }
}

/// The part of Prettier's `shouldQuoteKey` that is the same for all the names of an object.
fn should_quote_keys<'a>(parent: AstNodes<'a>, f: &Formatter<'a>) -> bool {
    f.options().quote_properties.is_consistent() && siblings_require_quotes(parent, f)
}

/// The part of Prettier's `shouldUnquoteKey` that is the same for all the names of an object.
fn should_unquote_keys<'a>(parent: AstNodes<'a>, f: &Formatter<'a>) -> bool {
    match f.options().quote_properties {
        QuoteProperties::AsNeeded => true,
        QuoteProperties::Preserve => false,
        QuoteProperties::Consistent => !siblings_require_quotes(parent, f),
    }
}

/// Prettier's `printKey`.
pub(crate) fn format_computed_or_property_key<'a>(key: Key<'a>, parent: AstNodes<'a>, f: &mut Formatter<'a>) {
    match key.is_computed() {
        true => write!(f, ["[", FormatKey::new(key, parent), "]"]),
        false => write!(f, FormatKey::new(key, parent)),
    }
}

/// Writes a key that is not computed. Returns the number of columns that it takes.
pub(crate) fn write_member_name<'a>(key: Key<'a>, parent: AstNodes<'a>, f: &mut Formatter<'a>) -> usize {
    FormatKey::new(key, parent).write(f)
}
