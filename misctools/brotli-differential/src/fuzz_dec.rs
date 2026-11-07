//! libFuzzer: two bytes of settings, then a stream for both decoders.
#![no_main]
#![allow(dead_code)]
mod args;
mod dec;
mod ffi;
mod rng;

libfuzzer_sys::fuzz_target!(|input: &[u8]| {
    let [flags, schedule, stream @ ..] = input else { return };
    let case = dec::DecCase {
        stream: stream.to_vec(),
        large_window: flags & 1 != 0,
        no_realloc: flags & 2 != 0,
        dicts: dec::dictionaries(flags >> 2),
        schedule: u64::from(*schedule).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 8,
        max_output: 4 << 20,
    };
    if let Err(e) = dec::compare(&case, None) {
        panic!("{e}");
    }
});
