// Scratch: getPropertyNameFromType of checker/utilities.go is not in the worktree; its callers accept any of three results.
use crate::checker::data::*;
use crate::core::Text;
use std::borrow::Cow;
#[cfg(name_vec)]
pub fn get_property_name_from_type(c: &Checker<'_>, t: TypeId) -> Vec<u8> { unimplemented!() }
#[cfg(name_cow)]
pub fn get_property_name_from_type<'a>(c: &Checker<'a>, t: TypeId) -> Cow<'a, [u8]> { unimplemented!() }
#[cfg(name_text)]
pub fn get_property_name_from_type<'a>(c: &Checker<'a>, t: TypeId) -> Text<'a> { unimplemented!() }
