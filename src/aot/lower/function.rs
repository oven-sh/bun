mod body;
mod closures;
mod header;
mod requested_originals;
mod text;
mod text_of_heads;
mod text_of_jsx;
mod text_read_back;
mod text_replaced_by_bundling;
mod this;

pub(crate) use self::header::{
    create_header, declare_source_function, declare_source_function_with,
};
pub(in crate::lower) use self::text::{print_number, print_string};
use crate::ir::ValueId;

#[derive(Copy, Clone, Default)]
pub(crate) struct EntryArguments<'x> {
    pub(crate) this: Option<ValueId>,
    pub(crate) new_target: Option<ValueId>,
    pub(crate) parameters: &'x [ValueId],
}
