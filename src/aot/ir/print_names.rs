#[cfg(test)]
mod tests;

use std::fmt::{Display, Write};

use bun_sema::atom::number_to_string;

use super::generated::MAX_TRACKED_INTEGER;
use super::ids::{Id, PropertyKeyId, StringId, TypeId};
use super::print::Printer;
use super::property_keys::{PropertyKeyKind, WellKnownSymbol};
use super::types::{ClassPart, Primitives, Type, TypeFlags, TypeTable};
use super::wtf8::decode_wtf8_code_point;

pub(super) fn print_quoted(out: &mut String, bytes: &[u8]) {
    out.push('"');
    let mut rest = bytes;
    while let Some(&first_byte) = rest.first() {
        let Some((code_point, length)) = decode_wtf8_code_point(rest) else {
            let _ = write!(out, "\\x{first_byte:02x}");
            rest = &rest[1..];
            continue;
        };
        rest = &rest[length..];
        match char::from_u32(code_point) {
            Some('"') => out.push_str("\\\""),
            Some('\\') => out.push_str("\\\\"),
            Some('\n') => out.push_str("\\n"),
            Some(character @ ' '..='~') => out.push(character),
            Some(_) | None => {
                let _ = write!(out, "\\u{{{code_point:x}}}");
            }
        }
    }
    out.push('"');
}

pub(super) fn print_bytes(out: &mut String, bytes: &[u8]) {
    out.push('"');
    for &byte in bytes {
        if byte < 0x20 || byte > 0x7e || byte == b'"' || byte == b'\\' {
            let _ = write!(out, "\\x{byte:02x}");
        } else {
            out.push(byte as char);
        }
    }
    out.push('"');
}

pub(super) fn print_double(out: &mut String, value: f64) {
    if value.is_nan() {
        out.push_str("NaN");
    } else if value == f64::INFINITY {
        out.push_str("Infinity");
    } else if value == f64::NEG_INFINITY {
        out.push_str("-Infinity");
    } else if value == 0.0 && value.is_sign_negative() {
        out.push_str("-0");
    } else {
        out.extend(number_to_string(value).into_iter().map(char::from));
    }
}

fn print_invalid(out: &mut String, kind: &str, number: usize) {
    let _ = write!(out, "<invalid {kind} {number}>");
}

fn print_optional(out: &mut String, value: Option<impl Display>) {
    match value {
        Some(value) => {
            let _ = write!(out, "{value}");
        }
        None => out.push('-'),
    }
}

pub(super) fn print_string(printer: &mut Printer<'_>, id: StringId) {
    let strings = printer.names.strings;
    if id.index() >= strings.len() {
        print_invalid(printer.out, "string", id.index());
        return;
    }
    print_quoted(printer.out, strings.get(id));
}

fn print_optional_string(printer: &mut Printer<'_>, id: Option<StringId>) {
    match id {
        Some(id) => print_string(printer, id),
        None => printer.out.push('-'),
    }
}

fn print_symbol_name(out: &mut String, symbol: WellKnownSymbol) {
    let mut characters = symbol.name().chars();
    out.extend(characters.next().map(|first| first.to_ascii_lowercase()));
    out.push_str(characters.as_str());
}

pub(super) fn print_property_key(printer: &mut Printer<'_>, id: PropertyKeyId) {
    let keys = printer.names.property_keys;
    if id.index() >= keys.len() {
        print_invalid(printer.out, "key", id.index());
        return;
    }
    let key = keys.get(id);
    match key.kind {
        PropertyKeyKind::Text => print_optional_string(printer, key.text),
        PropertyKeyKind::EnginePrivateName => {
            printer.out.push('@');
            print_optional_string(printer, key.text);
        }
        PropertyKeyKind::PrivateName => {
            printer.out.push('#');
            print_optional_string(printer, key.text);
            printer.out.push('@');
            print_optional(printer.out, key.owner);
        }
        PropertyKeyKind::WellKnownSymbol => {
            printer.out.push_str("@@");
            match key.symbol {
                Some(symbol) => print_symbol_name(printer.out, symbol),
                None => printer.out.push('-'),
            }
        }
        PropertyKeyKind::CreatedSymbol => {
            printer.out.push_str("symbol");
            if let Some(description) = key.text {
                printer.out.push('(');
                print_string(printer, description);
                printer.out.push(')');
            }
            printer.out.push('@');
            print_optional(printer.out, key.module);
            printer.out.push(':');
            print_optional(printer.out, key.position);
        }
    }
}

pub(super) fn print_type(printer: &mut Printer<'_>, id: TypeId) {
    let types = printer.names.types;
    if id.index() >= types.len() {
        print_invalid(printer.out, "type", id.index());
        return;
    }
    let ty = types.get(id);
    let mut separator = "";
    if ty.is_anything() {
        print_type_word_part(printer, "anything", &mut separator);
    } else {
        print_primitive_parts(printer, ty, &mut separator);
        print_any_object_part(printer, ty.flags, &mut separator);
    }
    if ty.primitives.contains(Primitives::ABSENT) {
        print_type_word_part(printer, "absent", &mut separator);
    }
    print_string_literals(printer, ty, &mut separator);
    print_object_parts(printer, ty, &mut separator);
    for part in &ty.classes {
        begin_type_part(printer, &mut separator);
        print_class_part(printer, id, part);
    }
    if let Some(kind) = ty.opaque {
        print_type_word_part(printer, &kind.name().to_ascii_lowercase(), &mut separator);
    }
    if separator.is_empty() {
        printer.out.push_str("never");
    }
}

fn begin_type_part(printer: &mut Printer<'_>, separator: &mut &'static str) {
    printer.out.push_str(separator);
    *separator = "|";
}

fn print_type_word_part(printer: &mut Printer<'_>, word: &str, separator: &mut &'static str) {
    begin_type_part(printer, separator);
    printer.out.push_str(word);
}

fn print_primitive_parts(printer: &mut Printer<'_>, ty: &Type, separator: &mut &'static str) {
    let primitives = ty.primitives;
    if primitives.contains(Primitives::UNDEFINED) {
        print_type_word_part(printer, "undefined", separator);
    }
    if primitives.contains(Primitives::NULL) {
        print_type_word_part(printer, "null", separator);
    }
    if primitives.contains(Primitives::BOOLEAN) {
        print_type_word_part(printer, "boolean", separator);
    } else if primitives.contains(Primitives::TRUE) {
        print_type_word_part(printer, "true", separator);
    } else if primitives.contains(Primitives::FALSE) {
        print_type_word_part(printer, "false", separator);
    }
    if primitives.contains(Primitives::NUMBER) {
        print_type_word_part(printer, "number", separator);
    } else if let Some((minimum, maximum)) = ty.integer_range() {
        begin_type_part(printer, separator);
        print_integer_part(printer, minimum, maximum);
    }
    if primitives.contains(Primitives::STRING) {
        print_type_word_part(printer, "string", separator);
    }
    if primitives.contains(Primitives::SYMBOL) {
        print_type_word_part(printer, "symbol", separator);
    }
    if primitives.contains(Primitives::BIG_INT) {
        print_type_word_part(printer, "bigint", separator);
    }
}

fn print_integer_part(printer: &mut Printer<'_>, minimum: i64, maximum: i64) {
    if minimum == -MAX_TRACKED_INTEGER && maximum == MAX_TRACKED_INTEGER {
        printer.out.push_str("int");
    } else if minimum == i64::from(i32::MIN) && maximum == i64::from(i32::MAX) {
        printer.out.push_str("i32");
    } else if minimum == maximum {
        let _ = write!(printer.out, "{minimum}");
    } else {
        let _ = write!(printer.out, "int[{minimum}, {maximum}]");
    }
}

fn print_any_object_part(
    printer: &mut Printer<'_>,
    flags: TypeFlags,
    separator: &mut &'static str,
) {
    if flags.contains(TypeFlags::ANY_OBJECT) {
        print_type_word_part(printer, "object", separator);
    } else if flags.contains(TypeFlags::ANY_FUNCTION) {
        print_type_word_part(printer, "function", separator);
    }
}

fn print_string_literals(printer: &mut Printer<'_>, ty: &Type, separator: &mut &'static str) {
    let strings = printer.names.strings;
    let mut literals = ty.strings.clone();
    if literals
        .iter()
        .all(|literal| literal.index() < strings.len())
    {
        literals.sort_unstable_by_key(|&literal| strings.get(literal));
    }
    for literal in literals {
        begin_type_part(printer, separator);
        print_string(printer, literal);
    }
}

fn print_object_parts(printer: &mut Printer<'_>, ty: &Type, separator: &mut &'static str) {
    for &layout in &ty.layouts {
        begin_type_part(printer, separator);
        let _ = write!(printer.out, "{layout}");
    }
    if ty.flags.contains(TypeFlags::HAS_MEMBERS_WITHOUT_LAYOUT) {
        begin_type_part(printer, separator);
        printer.out.push_str("nolayout");
    }
    if let Some(layout) = ty.environment {
        begin_type_part(printer, separator);
        let _ = write!(printer.out, "env {layout}");
    }
    for &function in &ty.functions {
        begin_type_part(printer, separator);
        let _ = write!(printer.out, "{function}");
    }
    for &builtin in &ty.builtins {
        begin_type_part(printer, separator);
        let _ = write!(printer.out, "builtin({})", builtin.name());
    }
}

fn print_class_part(printer: &mut Printer<'_>, holder: TypeId, part: &ClassPart) {
    printer.out.push_str(part.builtin_class.name());
    if part.contents.iter().all(|&ty| ty == TypeTable::ANYTHING) {
        return;
    }
    printer.out.push('<');
    printer.print_separated(&part.contents, |printer, &ty| {
        if ty < holder {
            print_type(printer, ty);
        } else {
            print_invalid(printer.out, "type", ty.index());
        }
    });
    printer.out.push('>');
}
