#[cfg(test)]
mod tests;

use super::generated::MAX_TRACKED_INTEGER;
use super::ids::{ABSENT_WORD, FunctionId, LayoutId, ModuleId, PropertyKeyId, TypeId};
use super::property_keys::{PropertyKey, WellKnownSymbol};
use super::text::{ParseError, Parsed, Parser};
use super::text_lexer::{TextPosition, TokenKind};
use super::types::{ClassPart, OpaqueKind, Primitives, Type, TypeFlags, TypeTable};
use crate::builtins::id::{BuiltinClass, BuiltinId};
use crate::builtins::table::class_data;

const MAX_TYPE_NESTING_IN_TEXT: u32 = 32;

const EXPECTED_INTERNAL_PART_ALONE: &str =
    "an environment or an opaque kind as the only part of a type";

#[derive(Copy, Clone)]
enum TypeWord {
    Primitives(Primitives),
    Number,
    Integers,
    Int32,
    Object,
    Anything,
    Function,
    MembersWithoutLayout,
    Environment,
    Builtin,
}

const TYPE_WORDS: [(&str, TypeWord); 18] = [
    ("undefined", TypeWord::Primitives(Primitives::UNDEFINED)),
    ("null", TypeWord::Primitives(Primitives::NULL)),
    ("boolean", TypeWord::Primitives(Primitives::BOOLEAN)),
    ("true", TypeWord::Primitives(Primitives::TRUE)),
    ("false", TypeWord::Primitives(Primitives::FALSE)),
    ("string", TypeWord::Primitives(Primitives::STRING)),
    ("symbol", TypeWord::Primitives(Primitives::SYMBOL)),
    ("bigint", TypeWord::Primitives(Primitives::BIG_INT)),
    ("absent", TypeWord::Primitives(Primitives::ABSENT)),
    ("number", TypeWord::Number),
    ("int", TypeWord::Integers),
    ("i32", TypeWord::Int32),
    ("object", TypeWord::Object),
    ("anything", TypeWord::Anything),
    ("function", TypeWord::Function),
    ("nolayout", TypeWord::MembersWithoutLayout),
    ("env", TypeWord::Environment),
    ("builtin", TypeWord::Builtin),
];

#[derive(Default)]
struct TypeParts {
    ty: Type,
    has_number_part: bool,
}

fn fail_at<T>(position: TextPosition, expected: &'static str) -> Parsed<T> {
    Err(ParseError {
        line: position.line,
        column: position.column,
        expected,
    })
}

impl TypeParts {
    fn ensure_single_number_part(&mut self, start: TextPosition) -> Parsed<()> {
        if self.has_number_part {
            return fail_at(start, "at most one number part in a type");
        }
        self.has_number_part = true;
        Ok(())
    }

    fn set_integers(&mut self, start: TextPosition, minimum: i64, maximum: i64) -> Parsed<()> {
        self.ensure_single_number_part(start)?;
        if minimum > maximum || minimum < -MAX_TRACKED_INTEGER || maximum > MAX_TRACKED_INTEGER {
            return fail_at(start, "a nonempty range of tracked integers");
        }
        self.ty.flags |= TypeFlags::HAS_INTEGERS;
        self.ty.minimum = minimum;
        self.ty.maximum = maximum;
        Ok(())
    }

    fn set_internal(&mut self, start: TextPosition, internal: Type) -> Parsed<()> {
        if !self.ty.is_never() {
            return fail_at(start, EXPECTED_INTERNAL_PART_ALONE);
        }
        self.ty = internal;
        Ok(())
    }
}

pub(super) fn parse_property_key(parser: &mut Parser<'_>) -> Parsed<PropertyKeyId> {
    let key = parse_property_key_value(parser)?;
    Ok(parser.program.property_keys.intern(key))
}

fn parse_property_key_value(parser: &mut Parser<'_>) -> Parsed<PropertyKey> {
    if parser.at(TokenKind::String) {
        return Ok(PropertyKey::from_text(parser.parse_string()?));
    }
    if parser.accept(TokenKind::At) {
        if parser.accept(TokenKind::At) {
            let symbol = parser.parse_enum(find_well_known_symbol, "a well-known symbol")?;
            return Ok(PropertyKey::from_well_known_symbol(symbol));
        }
        return Ok(PropertyKey::from_engine_private_name(
            parser.parse_string()?,
        ));
    }
    if parser.accept(TokenKind::NumberSign) {
        let text = parser.parse_string()?;
        parser.expect(TokenKind::At, "@")?;
        let owner = parser.parse_id::<LayoutId>("a layout id")?;
        return Ok(PropertyKey::from_private_name(text, owner));
    }
    if parser.accept_word("symbol") {
        return parse_created_symbol(parser);
    }
    parser.fail("a property key")
}

fn find_well_known_symbol(word: &str) -> Option<WellKnownSymbol> {
    let (&first, rest) = word.as_bytes().split_first()?;
    WellKnownSymbol::ALL.into_iter().find(|symbol| {
        let name = symbol.name().as_bytes().split_first();
        name.is_some_and(|(name_first, name_rest)| {
            name_first.to_ascii_lowercase() == first && name_rest == rest
        })
    })
}

fn parse_created_symbol(parser: &mut Parser<'_>) -> Parsed<PropertyKey> {
    let mut description = None;
    if parser.accept(TokenKind::LeftParenthesis) {
        description = Some(parser.parse_string()?);
        parser.expect(TokenKind::RightParenthesis, ")")?;
    }
    parser.expect(TokenKind::At, "@")?;
    let module = parser.parse_id::<ModuleId>("a module id")?;
    parser.expect(TokenKind::Colon, ":")?;
    let out_of_range = parser.fail("a position below 4294967295");
    let position = parser.parse_u32()?;
    if position == ABSENT_WORD {
        return out_of_range;
    }
    Ok(PropertyKey::from_created_symbol(
        module,
        position,
        description,
    ))
}

pub(super) fn parse_type(parser: &mut Parser<'_>) -> Parsed<TypeId> {
    let ty = parse_type_value(parser, 0)?;
    Ok(parser.program.types.intern(ty))
}

fn parse_type_value(parser: &mut Parser<'_>, nesting: u32) -> Parsed<Type> {
    if nesting > MAX_TYPE_NESTING_IN_TEXT {
        return parser.fail("type nesting within the limit");
    }
    if parser.accept_word("never") {
        if parser.at(TokenKind::Bar) {
            return parser.fail("never as the only part of a type");
        }
        return Ok(Type::never());
    }
    let mut parts = TypeParts::default();
    loop {
        parse_type_part(parser, &mut parts, nesting)?;
        if !parser.accept(TokenKind::Bar) {
            return Ok(parts.ty);
        }
    }
}

fn parse_type_part(parser: &mut Parser<'_>, parts: &mut TypeParts, nesting: u32) -> Parsed<()> {
    if parts.ty.is_internal() {
        return parser.fail(EXPECTED_INTERNAL_PART_ALONE);
    }
    let start = parser.token.position;
    if parser.at(TokenKind::String) {
        parts.ty.strings.push(parser.parse_string()?);
        return Ok(());
    }
    if parser.at(TokenKind::Integer) {
        let value = parser.parse_i64()?;
        return parts.set_integers(start, value, value);
    }
    if let Ok(layout) = parser.parse_id::<LayoutId>("a layout id") {
        parts.ty.layouts.push(layout);
        return Ok(());
    }
    if let Ok(function) = parser.parse_id::<FunctionId>("a function id") {
        parts.ty.functions.push(function);
        return Ok(());
    }
    let Some(word) = parser.word_text() else {
        return parser.fail("a type");
    };
    match TYPE_WORDS.iter().find(|(name, _)| *name == word) {
        Some(&(_, type_word)) => parse_type_word(parser, parts, type_word),
        None => parse_named_part(parser, parts, word, nesting),
    }
}

fn parse_type_word(parser: &mut Parser<'_>, parts: &mut TypeParts, word: TypeWord) -> Parsed<()> {
    let start = parser.token.position;
    parser.advance();
    match word {
        TypeWord::Primitives(primitives) => parts.ty.primitives |= primitives,
        TypeWord::Number => {
            parts.ensure_single_number_part(start)?;
            parts.ty.primitives |= Primitives::NUMBER;
        }
        TypeWord::Integers => {
            let (minimum, maximum) = parse_integer_bounds(parser)?;
            parts.set_integers(start, minimum, maximum)?;
        }
        TypeWord::Int32 => parts.set_integers(start, i32::MIN.into(), i32::MAX.into())?,
        TypeWord::Object => parts.ty.flags |= TypeFlags::ANY_OBJECT_OR_FUNCTION,
        TypeWord::Anything => {
            parts.ensure_single_number_part(start)?;
            parts.ty.primitives |= Primitives::OBSERVABLE;
            parts.ty.flags |= TypeFlags::ANY_OBJECT_OR_FUNCTION;
        }
        TypeWord::Function => parts.ty.flags |= TypeFlags::ANY_FUNCTION,
        TypeWord::MembersWithoutLayout => {
            parts.ty.flags |= TypeFlags::HAS_MEMBERS_WITHOUT_LAYOUT;
        }
        TypeWord::Environment => {
            let layout = parser.parse_id::<LayoutId>("a layout id")?;
            parts.set_internal(start, Type::environment(layout))?;
        }
        TypeWord::Builtin => {
            parser.expect(TokenKind::LeftParenthesis, "(")?;
            let builtin = parser.parse_enum(BuiltinId::from_name, "a built-in")?;
            parser.expect(TokenKind::RightParenthesis, ")")?;
            parts.ty.builtins.push(builtin);
        }
    }
    Ok(())
}

fn parse_integer_bounds(parser: &mut Parser<'_>) -> Parsed<(i64, i64)> {
    if !parser.accept(TokenKind::LeftBracket) {
        return Ok((-MAX_TRACKED_INTEGER, MAX_TRACKED_INTEGER));
    }
    let minimum = parser.parse_i64()?;
    parser.expect(TokenKind::Comma, ",")?;
    let maximum = parser.parse_i64()?;
    parser.expect(TokenKind::RightBracket, "]")?;
    Ok((minimum, maximum))
}

fn find_opaque_kind(word: &str) -> Option<OpaqueKind> {
    if word.bytes().any(|byte| byte.is_ascii_uppercase()) {
        return None;
    }
    let mut kinds = OpaqueKind::ALL.into_iter();
    kinds.find(|kind| kind.name().eq_ignore_ascii_case(word))
}

fn parse_named_part(
    parser: &mut Parser<'_>,
    parts: &mut TypeParts,
    word: &str,
    nesting: u32,
) -> Parsed<()> {
    let start = parser.token.position;
    if let Some(kind) = find_opaque_kind(word) {
        parser.advance();
        return parts.set_internal(start, Type::opaque(kind));
    }
    let Some(class) = BuiltinClass::from_name(word) else {
        return parser.fail("a type");
    };
    parts
        .ty
        .classes
        .push(parse_class_part(parser, class, nesting)?);
    Ok(())
}

fn parse_class_part(
    parser: &mut Parser<'_>,
    builtin_class: BuiltinClass,
    nesting: u32,
) -> Parsed<ClassPart> {
    let start = parser.token.position;
    parser.advance();
    let arity = class_data(builtin_class).contents.len();
    if !parser.accept(TokenKind::LeftAngle) {
        let contents = vec![TypeTable::ANYTHING; arity];
        return Ok(ClassPart {
            builtin_class,
            contents,
        });
    }
    let mut contents = Vec::with_capacity(arity);
    loop {
        let ty = parse_type_value(parser, nesting + 1)?;
        contents.push(parser.program.types.intern(ty));
        if !parser.accept(TokenKind::Comma) {
            break;
        }
    }
    parser.expect(TokenKind::RightAngle, ", or >")?;
    if contents.len() != arity {
        return fail_at(start, "one type per contents slot of the class");
    }
    Ok(ClassPart {
        builtin_class,
        contents,
    })
}
