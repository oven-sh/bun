mod body;
mod closures;
mod header;
mod this;

pub(crate) use self::header::{
    create_header, declare_source_function, declare_source_function_with,
};
pub(in crate::lower) use self::this::find_this_position;
use crate::ir::ValueId;

#[derive(Copy, Clone, Default)]
pub(crate) struct EntryArguments<'x> {
    pub(crate) this: Option<ValueId>,
    pub(crate) new_target: Option<ValueId>,
    pub(crate) parameters: &'x [ValueId],
}
