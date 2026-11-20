//! What a program needs to allocate in Rust: Bun, and JavaScriptCore's programs that link a crate of it.
#![feature(rustc_attrs)]
#![allow(internal_features)]

/// mimalloc as the process allocator.
#[cfg(not(bun_asan))]
#[global_allocator]
static ALLOC: bun_alloc::Mimalloc = bun_alloc::Mimalloc;

/// Under ASAN, use the system allocator so the interceptor sees every allocation.
#[cfg(bun_asan)]
#[global_allocator]
static ALLOC: std::alloc::System = std::alloc::System;

/// `alloc` calls this empty function before every allocation. rustc defines it only in the allocator shim it
/// generates when rustc itself links the final artifact (`allocator_shim_contents`, rustc_codegen_ssa), as a
/// tripwire against linking Rust libraries any other way (library/alloc/src/alloc.rs: "Make sure we don't
/// accidentally allow omitting the allocator shim in stable code until it is actually stabilized"). This build
/// links the rlibs itself, so it is defined here. Everything else a shim would hold already exists: the
/// allocator symbols come from `#[global_allocator]` above, the allocation error handler from std.
///
/// A toolchain that renames the function (`_v2` → `_v3`) fails the link with an undefined symbol naming the new one.
#[rustc_std_internal_symbol]
fn __rust_no_alloc_shim_is_unstable_v2() {}
