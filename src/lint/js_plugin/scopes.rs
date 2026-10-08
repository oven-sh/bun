//! The scopes, variables and references of a file as arrays of numbers.

use super::ast::NodeIds;
use super::offsets::Offsets;
use crate::ast::File;

pub(super) fn write<'a>(_file: &'a File<'a>, _offsets: &Offsets, _ids: &NodeIds<'a>, _out: &mut Vec<u8>) {}
