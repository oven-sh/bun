//! The same for shared memory, which is assembly, and for src/simd/slices.rs.
#![allow(dead_code, unreachable_pub)]
#![cfg(all(unix, not(miri)))]
mod framework;
#[path = "framework/guards.rs"]
#[allow(unused)]
mod guards;
include!("parts/guards_slices.rs");
