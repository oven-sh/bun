//! The iteration protocol, the iterators that the tiers have fast paths for, and the lists that are made with them.

mod allocation_profile;
mod argument_list;
mod array_iterator;
mod helpers;
mod join;
mod mode;
mod new_array;
mod protocol;
pub mod quick_arrays;
mod record;
pub mod registers;
mod sort_keys;
mod spread;
mod string_iterator;

pub use allocation_profile::ArrayAllocationProfile;
pub use argument_list::{
    argument_list_length, arguments_from_array_like, load_argument_list, load_spread_arguments,
    spread_argument_count, to_argument_list,
};
pub use array_iterator::{IterationKind, JsArrayIterator};
pub use helpers::{JsIterator, JsIteratorHelper, JsWrapForValidIterator};
pub use mode::IterationMode;
pub use new_array::{
    append_to_array, array_species_create, new_array, new_array_from_constant, new_array_with_size,
    new_array_with_species, new_array_with_spread,
};
pub use protocol::{
    ITERATOR_RESULT_DONE_OFFSET, ITERATOR_RESULT_VALUE_OFFSET, iterator_close,
    iterator_close_on_throw, iterator_close_quietly, iterator_complete, iterator_method,
    iterator_next, iterator_value, throw_not_iterable,
};
pub use record::{IteratorRecord, for_each_in_iterable};
pub use registers::{IteratorRegisters, Step};
pub use sort_keys::find_sort_keys;
pub use spread::{spread, try_spread_directly};
pub use string_iterator::JsStringIterator;

#[derive(Default)]
pub(crate) struct State {
    being_joined: join::InProgress,
    joined: join::Cache,
}

impl crate::services::Service for State {
    fn did_collect(&self, _: &crate::Vm, _: crate::heap::Scope) {
        self.joined.clear();
    }
}
