//! The names of properties and members.

use super::number::format_trimmed_number;
use super::string::{FormatLiteralStringToken, StringLiteralParentKind, is_es5_identifier_name, is_simple_number};
use crate::js::format::format_node;
use crate::prelude::*;
use crate::write;

/// ESTree's `key`, without the brackets of a computed one, with the comments around it. A string
/// keeps its quotes: see [`format_property_key`].
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
}

fn file_of<'a>(f: &Formatter<'a>) -> &'a File<'a> {
    f.file()
}

/// Whether a name in `parent` is quoted along with the other names of the object.
fn is_property_key_parent(parent: AstNodes<'_>) -> bool {
    matches!(
        parent,
        AstNodes::ObjectProperty(_)
            | AstNodes::TSPropertySignature(_)
            | AstNodes::TSMethodSignature(_)
            | AstNodes::MethodDefinition(_)
            | AstNodes::PropertyDefinition(_)
            | AstNodes::AccessorProperty(_)
    )
}

impl<'a> Format<'a> for FormatKey<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let FormatKey { key, parent } = *self;
        if let KeyKind::Computed(expression) = key.kind() {
            return expression.fmt(f);
        }
        let span = key.inner_span(file_of(f));
        format_node(span, || parent, f, |f| {
            let source = f.source_text().text_for(&span);
            let is_quoted = !key.is_computed() && is_property_key_parent(parent) && f.context().is_quote_needed();
            let quote = f.options().quote_style.as_str();
            match key.kind() {
                KeyKind::Ident(_) if is_quoted => write!(f, [quote, source_text(span), quote]),
                KeyKind::Ident(_) | KeyKind::Private(_) | KeyKind::Computed(_) => write!(f, source_text(span)),
                KeyKind::String(_) | KeyKind::ComputedString(_) if source.starts_with(b"`") => write!(f, text(source)),
                KeyKind::String(_) | KeyKind::ComputedString(_) => {
                    write!(f, FormatLiteralStringToken::new(source, false, StringLiteralParentKind::Expression));
                }
                KeyKind::Number(_) | KeyKind::ComputedNumber(_) if source.ends_with(b"n") => {
                    write!(f, text_without_whitespace(&source.to_ascii_lowercase()));
                }
                KeyKind::Number(name) | KeyKind::ComputedNumber(name) => {
                    let formatted = format_trimmed_number(source);
                    // Prettier's `isKeySafeToQuote`: not in TypeScript, where it changes the type,
                    // and only if the number is written the way it is converted to a string.
                    let should_quote = is_quoted
                        && f.file().is_javascript()
                        && is_simple_number(&formatted)
                        && name.bytes() == &*formatted;
                    match should_quote {
                        true => write!(f, [quote, text_without_whitespace(&formatted), quote]),
                        false => write!(f, text_without_whitespace(&formatted)),
                    }
                }
            }
        });
    }
}

fn string_literal_of<'a>(key: Key<'a>, f: &Formatter<'a>) -> Option<(Span, &'a [u8])> {
    match key.kind() {
        KeyKind::String(_) => {
            let span = key.span(file_of(f));
            Some((span, f.source_text().text_for(&span)))
        }
        _ => None,
    }
}

/// Prettier's `printPropertyKey` for a key that is not computed: the quotes of a string are removed
/// if they can be.
pub(crate) fn format_property_key<'a>(key: Key<'a>, parent: AstNodes<'a>, f: &mut Formatter<'a>) {
    let Some((span, string)) = string_literal_of(key, f) else {
        return write!(f, FormatKey::new(key, parent));
    };
    // In TypeScript, a property of a class with a quoted name is treated differently.
    let kind = match matches!(parent, AstNodes::PropertyDefinition(_)) && !f.file().is_javascript() {
        true => StringLiteralParentKind::Expression,
        false => StringLiteralParentKind::Member,
    };
    format_node(span, || parent, f, |f| write!(f, FormatLiteralStringToken::new(string, false, kind)));
}

/// `[key]` for a computed key, otherwise [`format_property_key`].
pub(crate) fn format_computed_or_property_key<'a>(key: Key<'a>, parent: AstNodes<'a>, f: &mut Formatter<'a>) {
    match key.is_computed() {
        true => write!(f, ["[", FormatKey::new(key, parent), "]"]),
        false => format_property_key(key, parent, f),
    }
}

/// The same as [`format_property_key`]. Returns the number of columns that the name takes.
pub(crate) fn write_member_name<'a>(key: Key<'a>, parent: AstNodes<'a>, f: &mut Formatter<'a>) -> usize {
    if let Some((span, string)) = string_literal_of(key, f) {
        let format = FormatLiteralStringToken::new(string, false, StringLiteralParentKind::Member).clean_text(f);
        let width = format.width();
        format_node(span, || parent, f, |f| write!(f, format));
        width
    } else {
        write!(f, FormatKey::new(key, parent));
        f.source_text().span_width(key.span(file_of(f)))
    }
}

/// Whether `key` is a string that cannot do without its quotes.
pub(crate) fn should_preserve_quote<'a>(key: Key<'a>, f: &Formatter<'a>) -> bool {
    string_literal_of(key, f).is_some_and(|(_, string)| {
        !is_es5_identifier_name(string.get(1..string.len().saturating_sub(1)).unwrap_or_default())
    })
}
