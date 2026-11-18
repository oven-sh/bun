//! What the source of a built-in refers to that this crate knows nothing of.

use bun_engine_text::{Identifier, PropertyName, Text};

use crate::constant::LinkTimeConstant;
use crate::operand::CellType;

#[derive(Clone, Copy, Debug)]
pub enum BuiltinValue {
    Int32(i32),
    Double(f64),
    LinkTime(LinkTimeConstant),
    /// `@name(value)` tests the type of a cell.
    CellTest(CellType),
    /// `@name(object)` tests flags of the shape.
    ShapeFlagsTest(u32),
}

pub trait Host {
    /// The symbol for an `@name` that is not among the static ones.
    fn private_name(&self, name: Text<'_>) -> Option<Identifier>;

    /// None if `@name` is a binding, such as a private property of the global object.
    fn builtin_value(&self, name: PropertyName<'_>) -> Option<BuiltinValue>;

    /// Stands for all that `builtin_value` answers.
    fn version(&self) -> u32;
}
