use crate::js::utils::number::format_number_token;
use crate::js::utils::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::js::utils::tailwindcss::{context_of_string, sorted_string_literal};
use crate::prelude::*;
use crate::write;

pub(crate) fn write_numeric_literal<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    write!(f, format_number_token(f.source_text().text_for(&e)));
}

pub(crate) fn write_string_literal<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let is_jsx = matches!(e.parent(), Node::Prop(property) if property.is_jsx_attribute())
        && matches!(e.ast_parent(), AstNodes::JSXAttribute(_));
    let source = f.source_text().text_for(&e);
    if let Some(context) = context_of_string(source, f) {
        let place = (e.span(), e.ast_parent());
        let printed = sorted_string_literal(source, is_jsx, place, context, f);
        return write!(f, text(&printed));
    }
    write!(
        f,
        FormatLiteralStringToken::new(source, is_jsx, StringLiteralParentKind::Expression)
    );
}

pub(crate) fn write_big_int_literal<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let raw = e.text();
    match raw.iter().any(u8::is_ascii_uppercase) {
        true => write!(f, text_without_whitespace(&raw.to_ascii_lowercase())),
        false => write!(f, source_text(e.span())),
    }
}

/// An error: `/a/é`. The characters are sorted as JavaScript sorts strings, by UTF-16 code units.
#[cold]
fn write_reg_exp_literal_with_unknown_flags<'a>(
    raw: &'a [u8],
    flags: &[u8],
    f: &mut Formatter<'a>,
) {
    let Ok(characters) = std::str::from_utf8(flags) else {
        return write!(f, text(raw));
    };
    let mut characters: Vec<char> = characters.chars().collect();
    characters.sort_by(|a, b| {
        a.encode_utf16(&mut [0; 2])
            .cmp(&b.encode_utf16(&mut [0; 2]))
    });
    f.write_built_text(|out| {
        out.extend_from_slice(raw.get(..raw.len() - flags.len()).unwrap_or_default());
        for character in characters {
            out.extend_from_slice(character.encode_utf8(&mut [0; 4]).as_bytes());
        }
    });
}

/// The flags are sorted.
pub(crate) fn write_reg_exp_literal<'a>(e: Expr<'a>, regex: Regex<'a>, f: &mut Formatter<'a>) {
    let (raw, flags) = (f.source_text().text_for(&e), regex.flags());
    if flags.is_sorted() {
        return write!(f, text(raw));
    }
    if !flags.is_ascii() {
        return write_reg_exp_literal_with_unknown_flags(raw, flags, f);
    }
    f.write_built_text(|out| {
        let start = out.len() + raw.len() - flags.len();
        out.extend_from_slice(raw);
        if let Some(flags) = out.get_mut(start..) {
            flags.sort_unstable();
        }
    });
}
