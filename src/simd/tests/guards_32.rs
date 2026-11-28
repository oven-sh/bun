#![allow(dead_code, unreachable_pub)]
#![cfg(all(unix, not(miri)))]
mod framework;
#[macro_use]
#[path = "framework/guards.rs"]
mod guards;

tests! { of_u32 u32 [b4 B4 b8 B8 b16 B16 b32 B32 b64 B64] of_f32 f32 [b16 B16 b32 B32] }
