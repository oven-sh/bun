//! pprof (`profile.proto`) profiles. `heap` samples allocations through mimalloc's
//! `mi_profiler_t` hooks.

#![feature(allocator_api)]

mod encode;
pub mod heap;
mod proto;
