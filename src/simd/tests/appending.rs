//! What only a few callers need of `mem`.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::prelude::*;
use core::cell::Cell;

#[test]
fn in_place() {
    #[bun_simd::simd]
    fn on() {
        fn increment<'a, E: Readable<u8>>(mut values: &'a [E])
        where
            &'a [E]: Sink<u8>,
        {
            over(values).map_into(&mut values, |v| v + 1)
        }
        let mut values = [1u8; 16];
        increment(Cell::from_mut(&mut values[..]).as_slice_of_cells());
        assert_eq!(values, [2; 16]);
    }
    on::<bun_simd::target::Baseline>()
}
