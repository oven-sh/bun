use crate::js::utils::number::format_number_token;
use crate::js::utils::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::prelude::*;
use crate::write;

pub(crate) fn write_numeric_literal<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    write!(f, format_number_token(e.text()));
}

pub(crate) fn write_string_literal<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let is_jsx = matches!(e.parent(), Node::Prop(property) if property.is_jsx_attribute())
        && matches!(e.ast_parent(), AstNodes::JSXAttribute(_));
    write!(f, FormatLiteralStringToken::new(e.text(), is_jsx, StringLiteralParentKind::Expression));
}

pub(crate) fn write_big_int_literal<'a>(e: Expr<'a>, f: &mut Formatter<'a>) {
    let raw = e.text();
    match raw.iter().any(u8::is_ascii_uppercase) {
        true => write!(f, text_without_whitespace(&raw.to_ascii_lowercase())),
        false => write!(f, source_text(e.span())),
    }
}

/// The flags are sorted.
pub(crate) fn write_reg_exp_literal<'a>(e: Expr<'a>, regex: Regex<'a>, f: &mut Formatter<'a>) {
    let (raw, flags) = (e.text(), regex.flags());
    if flags.is_sorted() {
        return write!(f, text(raw));
    }
    f.write_built_text(|out| {
        let start = out.len() + raw.len() - flags.len();
        out.extend_from_slice(raw);
        if let Some(flags) = out.get_mut(start..) {
            flags.sort_unstable();
        }
    });
}
