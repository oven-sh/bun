#![allow(dead_code, unreachable_pub)]
#![cfg(all(unix, not(miri)))]
mod framework;
#[macro_use]
#[path = "framework/guards.rs"]
mod guards;

tests! { of_u8 u8 [b128 B128] }
tests! { of_i16 i16 [b128 B128] }
tests! { of_u32 u32 [b128 B128] }
tests! { of_u64 u64 [b128 B128] }
