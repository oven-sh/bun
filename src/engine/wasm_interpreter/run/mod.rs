//! A handler for each form of each instruction, and functions that pick one.

pub(crate) mod atomic;
pub(crate) mod calls;
pub(crate) mod comparison;
pub(crate) mod control;
pub(crate) mod conversion;
pub(crate) mod exceptions;
pub(crate) mod float;
pub(crate) mod form;
pub(crate) mod global;
pub(crate) mod integer;
pub(crate) mod memory;
pub(crate) mod moves;
pub(crate) mod object;
pub(crate) mod operation;
pub(crate) mod reference;
pub(crate) mod vector;
