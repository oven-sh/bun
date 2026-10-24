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

fn print_symbol_name(out: &mut String, symbol: WellKnownSymbol) {
    let mut characters = symbol.name().chars();
    out.extend(characters.next().map(|first| first.to_ascii_lowercase()));
    out.push_str(characters.as_str());
}

impl Printer<'_> {
    pub fn print_bytes(&mut self, bytes: &[u8]) {
        self.out.push('"');
        for &byte in bytes {
            if byte < 0x20 || byte > 0x7e || byte == b'"' || byte == b'\\' {
                let _ = write!(self.out, "\\x{byte:02x}");
            } else {
                self.out.push(byte as char);
            }
        }
        self.out.push('"');
    }

    pub fn print_double(&mut self, value: f64) {
        if value.is_nan() {
            self.out.push_str("NaN");
        } else if value == f64::INFINITY {
            self.out.push_str("Infinity");
        } else if value == f64::NEG_INFINITY {
            self.out.push_str("-Infinity");
        } else if value == 0.0 && value.is_sign_negative() {
            self.out.push_str("-0");
        } else {
            self.out
                .extend(number_to_string(value).into_iter().map(char::from));
        }
    }

    pub fn print_string(&mut self, id: StringId) {
        let strings = self.names.strings;
        if id.index() >= strings.len() {
            print_invalid(self.out, "string", id.index());
            return;
        }
        print_quoted(self.out, strings.get(id));
    }

    fn print_optional_string(&mut self, id: Option<StringId>) {
        match id {
            Some(id) => self.print_string(id),
            None => self.out.push('-'),
        }
    }

    pub fn print_property_key(&mut self, id: PropertyKeyId) {
        let keys = self.names.property_keys;
        if id.index() >= keys.len() {
            print_invalid(self.out, "key", id.index());
            return;
        }
        let key = keys.get(id);
        match key.kind {
            PropertyKeyKind::Text => self.print_optional_string(key.text),
            PropertyKeyKind::EnginePrivateName => {
                self.out.push('@');
                self.print_optional_string(key.text);
            }
            PropertyKeyKind::PrivateName => {
                self.out.push('#');
                self.print_optional_string(key.text);
                self.out.push('@');
                print_optional(self.out, key.owner);
            }
            PropertyKeyKind::WellKnownSymbol => {
                self.out.push_str("@@");
                match key.symbol {
                    Some(symbol) => print_symbol_name(self.out, symbol),
                    None => self.out.push('-'),
                }
            }
            PropertyKeyKind::CreatedSymbol => {
                self.out.push_str("symbol");
                if let Some(description) = key.text {
                    self.out.push('(');
                    self.print_string(description);
                    self.out.push(')');
                }
                self.out.push('@');
                print_optional(self.out, key.module);
                self.out.push(':');
                print_optional(self.out, key.position);
            }
        }
    }

    pub fn print_type(&mut self, id: TypeId) {
        let types = self.names.types;
        if id.index() >= types.len() {
            print_invalid(self.out, "type", id.index());
            return;
        }
        let ty = types.get(id);
        let mut separator = "";
        if ty.is_anything() {
            self.print_type_word_part("anything", &mut separator);
        } else {
            self.print_primitive_parts(ty, &mut separator);
            if ty.flags.contains(TypeFlags::ANY_OBJECT) {
                self.print_type_word_part("object", &mut separator);
            } else if ty.flags.contains(TypeFlags::ANY_FUNCTION) {
                self.print_type_word_part("function", &mut separator);
            }
        }
        if ty.primitives.contains(Primitives::ABSENT) {
            self.print_type_word_part("absent", &mut separator);
        }
        self.print_string_literals(ty, &mut separator);
        self.print_object_parts(ty, &mut separator);
        for part in &ty.classes {
            self.begin_type_part(&mut separator);
            self.print_class_part(id, part);
        }
        if let Some(kind) = ty.opaque {
            self.print_type_word_part(&kind.name().to_ascii_lowercase(), &mut separator);
        }
        if separator.is_empty() {
            self.out.push_str("never");
        }
    }

    fn begin_type_part(&mut self, separator: &mut &'static str) {
        self.out.push_str(separator);
        *separator = "|";
    }

    fn print_type_word_part(&mut self, word: impl Display, separator: &mut &'static str) {
        self.begin_type_part(separator);
        let _ = write!(self.out, "{word}");
    }

    fn print_primitive_parts(&mut self, ty: &Type, separator: &mut &'static str) {
        let primitives = ty.primitives;
        if primitives.contains(Primitives::UNDEFINED) {
            self.print_type_word_part("undefined", separator);
        }
        if primitives.contains(Primitives::NULL) {
            self.print_type_word_part("null", separator);
        }
        if primitives.contains(Primitives::BOOLEAN) {
            self.print_type_word_part("boolean", separator);
        } else if primitives.contains(Primitives::TRUE) {
            self.print_type_word_part("true", separator);
        } else if primitives.contains(Primitives::FALSE) {
            self.print_type_word_part("false", separator);
        }
        if primitives.contains(Primitives::NUMBER) {
            self.print_type_word_part("number", separator);
        } else if let Some((minimum, maximum)) = ty.integer_range() {
            self.begin_type_part(separator);
            self.print_integer_part(minimum, maximum);
        }
        if primitives.contains(Primitives::STRING) {
            self.print_type_word_part("string", separator);
        }
        if primitives.contains(Primitives::SYMBOL) {
            self.print_type_word_part("symbol", separator);
        }
        if primitives.contains(Primitives::BIG_INT) {
            self.print_type_word_part("bigint", separator);
        }
    }

    fn print_integer_part(&mut self, minimum: i64, maximum: i64) {
        if minimum == -MAX_TRACKED_INTEGER && maximum == MAX_TRACKED_INTEGER {
            self.out.push_str("int");
        } else if minimum == i64::from(i32::MIN) && maximum == i64::from(i32::MAX) {
            self.out.push_str("i32");
        } else if minimum == maximum {
            let _ = write!(self.out, "{minimum}");
        } else {
            let _ = write!(self.out, "int[{minimum}, {maximum}]");
        }
    }

    fn print_string_literals(&mut self, ty: &Type, separator: &mut &'static str) {
        let strings = self.names.strings;
        let mut literals = ty.strings.clone();
        if literals
            .iter()
            .all(|literal| literal.index() < strings.len())
        {
            literals.sort_unstable_by_key(|&literal| strings.get(literal));
        }
        for literal in literals {
            self.begin_type_part(separator);
            self.print_string(literal);
        }
    }

    fn print_object_parts(&mut self, ty: &Type, separator: &mut &'static str) {
        for &layout in &ty.layouts {
            self.print_type_word_part(layout, separator);
        }
        if ty.flags.contains(TypeFlags::HAS_MEMBERS_WITHOUT_LAYOUT) {
            self.print_type_word_part("nolayout", separator);
        }
        if let Some(layout) = ty.environment {
            self.print_type_word_part(format_args!("env {layout}"), separator);
        }
        for &function in &ty.functions {
            self.print_type_word_part(function, separator);
        }
        for &builtin in &ty.builtins {
            self.print_type_word_part(format_args!("builtin({})", builtin.name()), separator);
        }
    }

    fn print_class_part(&mut self, holder: TypeId, part: &ClassPart) {
        self.out.push_str(part.builtin_class.name());
        if part.contents.iter().all(|&ty| ty == TypeTable::ANYTHING) {
            return;
        }
        self.out.push('<');
        self.print_separated(&part.contents, |printer, &ty| {
            if ty < holder {
                printer.print_type(ty);
            } else {
                print_invalid(printer.out, "type", ty.index());
            }
        });
        self.out.push('>');
    }
}
