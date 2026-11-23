#![allow(dead_code, unreachable_pub)]
#![cfg(all(unix, not(miri)))]
mod framework;
#[macro_use]
#[path = "framework/guards.rs"]
mod guards;

tests! { of_i64 i64 [b8 B8 b16 B16 b32 B32 b64 B64] of_f64 f64 [b16 B16 b32 B32] }
