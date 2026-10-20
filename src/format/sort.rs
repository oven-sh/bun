//! Sorts that are compiled once for the whole program, where those of the standard library are compiled once for each
//! type and closure, several KB each. All are stable. They cost a list of indices and a call for each comparison.
//!
//! The standard library may panic if the comparison isn't a total order. [`sort_by`] accepts any comparison.

pub use bun_collections::index_sort::{
    merge_sort_slice_by as sort_by, sort_slice as sort, sort_slice_by_key as sort_by_key,
};
