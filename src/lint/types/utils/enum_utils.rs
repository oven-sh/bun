//! `rules/enum-utils/shared.ts`

use super::{is_number_like, is_string_like};
use crate::types::tsutils::union_constituents;
use crate::types::{Literal, SymbolFlags, SyntaxKind, Type, TypeFlags};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::rc::Rc;

/// The enum for a member of an enum, any other type as it is: `Fruit` for `Fruit.Apple`.
fn get_base_enum_type(ty: Type<'_>) -> Type<'_> {
    let member = ty
        .get_symbol()
        .filter(|symbol| symbol.has_flags(SymbolFlags::ENUM_MEMBER));
    let declaration = member.and_then(|symbol| symbol.value_declaration()?.parent());
    declaration.map_or(ty, |it| it.get_type_at_location())
}

/// `getEnumLiterals(type)`: the constituents that are members of enums. `Fruit.Apple` of
/// `Fruit.Apple | 123`.
pub fn get_enum_literals(ty: Type<'_>) -> SmallVec<[Type<'_>; 4]> {
    union_constituents(ty)
        .iter()
        .filter(|sub_type| sub_type.has_flags(TypeFlags::ENUM_LITERAL))
        .collect()
}

/// `getEnumTypes(typeChecker, type)`: the enums of those. `Fruit` and `Vegetable` for
/// `Fruit.Apple | Vegetable.Lettuce | 123`. As upstream, one for each member.
pub fn get_enum_types(ty: Type<'_>) -> SmallVec<[Type<'_>; 4]> {
    let literals = union_constituents(ty)
        .iter()
        .filter(|sub_type| sub_type.has_flags(TypeFlags::ENUM_LITERAL));
    literals.map(get_base_enum_type).collect()
}

/// `isMismatchedEnumComparisonTypes(typeChecker, leftType, rightType)`: a value of an enum is
/// compared with a value of the same primitive kind that is not of that enum.
pub fn is_mismatched_enum_comparison_types<'a>(left_type: Type<'a>, right_type: Type<'a>) -> bool {
    // Comparisons that have nothing to do with enums.
    let (left_enum_types, right_enum_types) =
        (get_enum_types(left_type), get_enum_types(right_type));
    if left_enum_types.is_empty() && right_enum_types.is_empty() {
        return false;
    }
    // Comparisons that share an enum: `Fruit.Apple === Fruit.Banana`.
    if left_enum_types
        .iter()
        .any(|left_enum_type| right_enum_types.contains(left_enum_type))
    {
        return false;
    }
    // A type on both sides: `fruit === 0` for a `Fruit.Apple | 0`.
    let (left_type_parts, right_type_parts) = (
        union_constituents(left_type),
        union_constituents(right_type),
    );
    if left_type_parts
        .iter()
        .any(|left_type_part| right_type_parts.contains(left_type_part))
    {
        return false;
    }
    type_violates(left_type, right_type) || type_violates(right_type, left_type)
}

/// What [`is_mismatched_enum_comparison_types`] looks for in a type.
struct ComparedType<'a> {
    /// `getEnumTypes(typeChecker, type)`
    enum_types: FxHashSet<Type<'a>>,
    constituents: FxHashSet<Type<'a>>,
    /// A constituent is an enum, or a member of one, whose value is a number.
    has_number_enum: bool,
    /// The same for a string.
    has_string_enum: bool,
    is_number_like: bool,
    is_string_like: bool,
}

impl<'a> ComparedType<'a> {
    fn new(ty: Type<'a>) -> Self {
        let mut it = ComparedType {
            enum_types: FxHashSet::default(),
            constituents: FxHashSet::default(),
            has_number_enum: false,
            has_string_enum: false,
            is_number_like: is_number_like(ty),
            is_string_like: is_string_like(ty),
        };
        for constituent in union_constituents(ty) {
            it.constituents.insert(constituent);
            if constituent.has_flags(TypeFlags::ENUM_LITERAL) {
                it.enum_types.insert(get_base_enum_type(constituent));
            }
            match get_enum_value_type(constituent) {
                Some(value_type) if value_type == TypeFlags::NUMBER => it.has_number_enum = true,
                Some(_) => it.has_string_enum = true,
                None => {}
            }
        }
        it
    }

    /// [`type_violates`]
    fn violates(&self, right: &ComparedType) -> bool {
        self.has_number_enum && right.is_number_like || self.has_string_enum && right.is_string_like
    }
}

fn have_one_in_common<'a>(a: &FxHashSet<Type<'a>>, b: &FxHashSet<Type<'a>>) -> bool {
    let (few, many) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    few.iter().any(|it| many.contains(it))
}

/// [`is_mismatched_enum_comparison_types`] for a file. What it finds in a union of many is kept: to go through an enum of 10,000
/// members for each `case` of a `switch` over it takes long.
#[derive(Default)]
pub struct EnumComparisons<'a> {
    of_many: FxHashMap<Type<'a>, Rc<ComparedType<'a>>>,
}

impl<'a> EnumComparisons<'a> {
    const MANY: usize = 16;

    fn compared(&mut self, ty: Type<'a>) -> Rc<ComparedType<'a>> {
        match union_constituents(ty).len() > Self::MANY {
            true => Rc::clone(
                self.of_many
                    .entry(ty)
                    .or_insert_with(|| Rc::new(ComparedType::new(ty))),
            ),
            false => Rc::new(ComparedType::new(ty)),
        }
    }

    pub fn is_mismatched(&mut self, left_type: Type<'a>, right_type: Type<'a>) -> bool {
        if union_constituents(left_type).len() <= Self::MANY
            && union_constituents(right_type).len() <= Self::MANY
        {
            return is_mismatched_enum_comparison_types(left_type, right_type);
        }
        let (left, right) = (self.compared(left_type), self.compared(right_type));
        if left.enum_types.is_empty() && right.enum_types.is_empty()
            || have_one_in_common(&left.enum_types, &right.enum_types)
            || have_one_in_common(&left.constituents, &right.constituents)
        {
            return false;
        }
        left.violates(&right) || right.violates(&left)
    }
}

/// Whether the right type is an unsafe comparison against any constituent of the left type.
fn type_violates(left_type: Type, right_type: Type) -> bool {
    let has = |flags: TypeFlags| {
        union_constituents(left_type)
            .iter()
            .any(|it| get_enum_value_type(it) == Some(flags))
    };
    has(TypeFlags::NUMBER) && is_number_like(right_type)
        || has(TypeFlags::STRING) && is_string_like(right_type)
}

/// `getEnumValueType(type)`: `NUMBER` or `STRING` for an enum or a member of one, by what its value
/// is.
pub fn get_enum_value_type(ty: Type) -> Option<TypeFlags> {
    let flags = ty.flags();
    flags.intersects(TypeFlags::ENUM_LIKE).then(|| {
        match flags.intersects(TypeFlags::NUMBER_LITERAL) {
            true => TypeFlags::NUMBER,
            false => TypeFlags::STRING,
        }
    })
}

/// `getEnumKeyForLiteral(enumLiterals, literal)`: how the member whose value is `literal` is
/// written: `Fruit.Apple`, `Fruit['a b']`, `Fruit[key]`.
pub fn get_enum_key_for_literal(enum_literals: &[Type], literal: Literal) -> Option<Vec<u8>> {
    for enum_literal in enum_literals {
        if enum_literal.value() != Some(literal) {
            continue;
        }
        let member_declaration = enum_literal.get_symbol()?.value_declaration()?;
        let member_name_identifier = member_declaration.name()?;
        let mut key = member_declaration.parent()?.name()?.text().to_vec();
        match member_name_identifier.kind() {
            SyntaxKind::Identifier => {
                key.push(b'.');
                key.extend_from_slice(member_name_identifier.text());
            }
            SyntaxKind::StringLiteral => {
                key.extend_from_slice(b"['");
                for &byte in member_name_identifier.text() {
                    if byte == b'\'' {
                        key.push(b'\\');
                    }
                    key.push(byte);
                }
                key.extend_from_slice(b"']");
            }
            SyntaxKind::ComputedPropertyName => {
                key.push(b'[');
                key.extend_from_slice(member_name_identifier.expression()?.get_source_text());
                key.push(b']');
            }
            _ => continue,
        }
        return Some(key);
    }
    None
}
