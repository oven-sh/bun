#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
include!("parts/sort.rs");
ints!(u32 i32);
both!(f32, |it| f32::from_bits(it as u32), |it| it.to_bits() as u64, f32::total_cmp);
