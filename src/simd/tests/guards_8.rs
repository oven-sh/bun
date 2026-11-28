#![allow(dead_code, unreachable_pub)]
#![cfg(all(unix, not(miri)))]
mod framework;
#[macro_use]
#[path = "framework/guards.rs"]
mod guards;

tests! { of_u8 u8 [b2 B2 b4 B4 b8 B8 b16 B16 b32 B32 b64 B64] }
