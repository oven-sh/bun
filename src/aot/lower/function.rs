mod body;
mod closures;
mod header;
mod this;

pub(crate) use self::body::{lower_function_body, lower_left_out_function, lower_source_function};
pub(crate) use self::closures::{
    captures_home_object, emit_closure, emit_direct_call, lower_function_expression, lower_method,
};
pub(in crate::lower) use self::header::is_derived_constructor;
pub(crate) use self::header::{
    create_header, declare_source_function, declare_source_function_with,
};
pub(crate) use self::this::{
    bind_this, get_home_object, get_new_target, get_this, lower_this_expression,
};
pub(in crate::lower) use self::this::{find_this_position, get_entry_this, is_this_of_module};
use crate::ir::ValueId;

#[derive(Copy, Clone, Default)]
pub(crate) struct EntryArguments<'x> {
    pub(crate) this: Option<ValueId>,
    pub(crate) new_target: Option<ValueId>,
    pub(crate) parameters: &'x [ValueId],
}
