//! Sorts that are compiled once for the whole program. The standard library's are instantiated for every type and
//! closure, at several KB each. All of these are stable. They cost a list of indices and a function call per
//! comparison.
//!
//! The standard library may panic if the comparison isn't a total order. [`sort_by`] accepts any comparison.

pub use bun_collections::index_sort::{
    merge_sort_slice_by as sort_by, sort_slice as sort, sort_slice_by_key as sort_by_key,
};
