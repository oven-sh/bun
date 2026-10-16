//! `containsAllTypesByName.ts`

use super::builtin_symbol_likes::BaseTypeAnswers;
use super::{Names, has_room_on_the_stack, is_type_flag_set};
use crate::types::tsutils::{is_type_reference, is_union_or_intersection_type};
use crate::types::{Type, TypeFlags};

/// `containsAllTypesByName(type, allowAny, allowedNames, matchAnyInstead)`: whether the type is,
/// extends, or is made of nothing but types with one of the names.
///
/// - `allow_any`: `any` and `unknown` do not count as a match. A type that the checker gave up on
///   never does.
/// - `match_any_instead`: one constituent or base type that matches is enough.
pub fn contains_all_types_by_name(
    ty: Type,
    allow_any: bool,
    allowed_names: impl Names,
    match_any_instead: bool,
) -> bool {
    let mut known = BaseTypeAnswers::default();
    contains(ty, allow_any, allowed_names, match_any_instead, &mut known)
}

fn contains<'a>(
    mut ty: Type<'a>,
    allow_any: bool,
    allowed_names: impl Names,
    match_any_instead: bool,
    known: &mut BaseTypeAnswers<'a>,
) -> bool {
    if !has_room_on_the_stack() {
        return false;
    }
    if is_type_flag_set(ty, TypeFlags::ANY | TypeFlags::UNKNOWN) {
        return !allow_any && !ty.is_unresolved();
    }
    if is_type_reference(ty) {
        ty = ty.target().unwrap_or(ty);
    }
    if ty
        .get_symbol()
        .is_some_and(|symbol| allowed_names.includes(symbol.name()))
    {
        return true;
    }
    let is_constituents = is_union_or_intersection_type(ty);
    let types = match is_constituents {
        true => ty.types(),
        false => ty.get_base_types(),
    };
    let ask = |known: &mut BaseTypeAnswers<'a>| {
        let predicate =
            |t: Type<'a>| contains(t, allow_any, allowed_names, match_any_instead, known);
        match match_any_instead {
            true => types.iter().any(predicate),
            false => (is_constituents || !types.is_empty()) && types.iter().all(predicate),
        }
    };
    match !is_constituents && types.len() > 1 {
        true => known.get_or_ask(ty, ask),
        false => ask(known),
    }
}

/// tsgolint's own `containsAllTypesByName`, which is not typescript-eslint's: with
/// `match_any_instead` every constituent of a union or an intersection has to match and one base
/// type is enough, without it one constituent is enough and every base type has to match. `any`
/// and `unknown` never match.
pub fn contains_all_types_by_name_as_tsgolint(
    ty: Type,
    allowed_names: impl Names,
    match_any_instead: bool,
) -> bool {
    let mut known = BaseTypeAnswers::default();
    contains_as_tsgolint(ty, allowed_names, match_any_instead, &mut known)
}

fn contains_as_tsgolint<'a>(
    mut ty: Type<'a>,
    allowed_names: impl Names,
    match_any_instead: bool,
    known: &mut BaseTypeAnswers<'a>,
) -> bool {
    if !has_room_on_the_stack() || is_type_flag_set(ty, TypeFlags::ANY | TypeFlags::UNKNOWN) {
        return false;
    }
    if is_type_reference(ty) {
        ty = ty.target().unwrap_or(ty);
    }
    if ty
        .get_symbol()
        .is_some_and(|symbol| allowed_names.includes(symbol.name()))
    {
        return true;
    }
    if is_union_or_intersection_type(ty) {
        let predicate =
            |t: Type<'a>| contains_as_tsgolint(t, allowed_names, match_any_instead, known);
        return match match_any_instead {
            true => ty.types().iter().all(predicate),
            false => ty.types().iter().any(predicate),
        };
    }
    // Empty unless it is a class or an interface.
    let bases = ty.get_base_types();
    let ask = |known: &mut BaseTypeAnswers<'a>| {
        let predicate =
            |t: Type<'a>| contains_as_tsgolint(t, allowed_names, match_any_instead, known);
        match match_any_instead {
            true => bases.iter().any(predicate),
            false => !bases.is_empty() && bases.iter().all(predicate),
        }
    };
    match bases.len() > 1 {
        true => known.get_or_ask(ty, ask),
        false => ask(known),
    }
}
