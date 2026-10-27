extern crate std;

use super::*;
use std::panic::catch_unwind;
use std::string::String;
use std::vec::Vec;

/// 16 bytes at an 8-aligned address, so `&BYTES.0[1..]` is odd.
#[repr(C, align(8))]
struct Aligned([u8; 16]);
const BYTES: Aligned = Aligned([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

fn panic_message(f: impl FnOnce() + std::panic::UnwindSafe) -> String {
    let payload = catch_unwind(f).expect_err("should panic");
    payload
        .downcast_ref::<String>()
        .expect("formatted panic")
        .clone()
}

#[test]
fn narrowing_is_total() {
    let units = [0x0201u16.to_le(), 0x0403u16.to_le()];
    assert_eq!(slice_as_bytes(&units), [1, 2, 3, 4]);
    assert_eq!(cast_slice::<u16, u8>(&units), [1, 2, 3, 4]);
    assert_eq!(cast_slice::<u64, u16>(&[u64::MAX]), [u16::MAX; 4]);
    assert_eq!(bytes_of(&0x0201u16.to_le()), [1, 2]);
    assert_eq!(slice_as_bytes::<u32>(&[]), []);
}

#[test]
fn const_contexts() {
    const WORD: [u16; 2] = [0x0101, 0x0202];
    const AS_BYTES: &[u8] = slice_as_bytes(&WORD);
    const READ: Option<u32> = read_prefix(&[0xff; 5]);
    const ZERO: [u64; 2] = zeroed();
    assert_eq!(AS_BYTES, [1, 1, 2, 2]);
    assert_eq!(READ, Some(u32::MAX));
    assert_eq!(ZERO, [0, 0]);
}

#[test]
fn widening_checks_alignment_and_length() {
    let bytes = &BYTES.0;
    assert_eq!(
        cast_slice::<u8, u32>(&bytes[4..12]),
        [
            u32::from_ne_bytes([4, 5, 6, 7]),
            u32::from_ne_bytes([8, 9, 10, 11])
        ],
    );
    assert_eq!(try_cast_slice::<u8, u16>(&bytes[1..5]), None);
    assert_eq!(try_cast_slice::<u8, u16>(&bytes[..5]), None);
    assert_eq!(try_cast_slice::<u8, u64>(&bytes[4..12]), None);
    assert_eq!(try_cast_slice::<[u8; 3], u16>(&[[0; 3]; 3]), None);
}

#[test]
fn equal_alignment_only_checks_length() {
    assert_eq!(
        cast_slice::<[u8; 3], [u8; 2]>(&[[1, 2, 3], [4, 5, 6]]),
        [[1, 2], [3, 4], [5, 6]]
    );
    assert_eq!(try_cast_slice::<[u8; 3], [u8; 2]>(&[[1, 2, 3]]), None);
    assert_eq!(cast_slice::<i8, u8>(&[-1, 1]), [255, 1]);
}

#[test]
fn an_empty_slice_casts_from_any_address() {
    let bytes = &BYTES.0;
    assert_eq!(cast_slice::<u8, u64>(&bytes[1..1]), []);
    assert_eq!(cast_slice::<u8, u64>(&[]), []);
    assert_eq!(cast_slice::<u8, u64>(Vec::new().as_slice()), []);
    let mut bytes = BYTES;
    assert_eq!(cast_slice_mut::<u8, u64>(&mut bytes.0[3..3]), []);
    // The result is aligned for `B` even though the input was not.
    assert!(cast_slice::<u8, u64>(&BYTES.0[1..1]).as_ptr().is_aligned());
}

#[test]
fn unaligned_reads_any_address() {
    let bytes = &BYTES.0;
    let odd: &[Unaligned<u32>] = cast_slice(&bytes[1..9]);
    assert_eq!(odd[0].get(), u32::from_ne_bytes([1, 2, 3, 4]));
    assert_eq!(odd[1].get(), u32::from_ne_bytes([5, 6, 7, 8]));
    assert_eq!(bytes_of(&Unaligned::new(1u16.to_le())), [1, 0]);
    assert_eq!(try_cast_slice::<Unaligned<u32>, u32>(odd), None);
    assert_eq!(
        cast_slice::<Unaligned<u32>, u32>(cast_slice(&bytes[4..8])).len(),
        1
    );
}

#[test]
fn slice_of_leaves_out_a_partial_element() {
    let bytes = &BYTES.0;
    let odd = Unaligned::<u32>::slice_of(&bytes[1..11]);
    assert_eq!(odd.len(), 2);
    assert_eq!(odd[1].get(), u32::from_ne_bytes([5, 6, 7, 8]));
    assert_eq!(Unaligned::<u32>::slice_of(&bytes[1..4]).len(), 0);
    assert_eq!(Unaligned::<u64>::slice_of(&[]).len(), 0);

    let mut bytes = BYTES;
    Unaligned::<u16>::slice_of_mut(&mut bytes.0[1..6]).fill(Unaligned::new(0xffff));
    assert_eq!(bytes.0[..7], [0, 255, 255, 255, 255, 5, 6]);
}

#[test]
fn vec_from_bytes_copies_from_any_address() {
    let bytes = &BYTES.0;
    for start in 0..2 {
        assert_eq!(
            vec_from_bytes::<u32>(&bytes[start..start + 8]).unwrap(),
            [
                u32::from_ne_bytes(bytes[start..start + 4].try_into().unwrap()),
                u32::from_ne_bytes(bytes[start + 4..start + 8].try_into().unwrap()),
            ],
        );
    }
    assert_eq!(vec_from_bytes::<u32>(&bytes[..6]), None);
    assert_eq!(vec_from_bytes::<[u8; 3]>(&bytes[..4]), None);
    assert_eq!(vec_from_bytes::<u64>(&[]), Some(Vec::new()));
}

#[test]
fn read_prefix_takes_the_front() {
    let bytes = &BYTES.0;
    assert_eq!(
        read_prefix::<u32>(&bytes[1..]),
        Some(u32::from_ne_bytes([1, 2, 3, 4]))
    );
    assert_eq!(
        read_prefix::<u32>(&bytes[..4]),
        Some(u32::from_ne_bytes([0, 1, 2, 3]))
    );
    assert_eq!(read_prefix::<u32>(&bytes[..3]), None);
    assert_eq!(read_prefix::<[u8; 2]>(&bytes[15..]), None);
    assert_eq!(read_prefix::<()>(&[]), Some(()));
}

#[test]
fn writes_go_both_ways() {
    let mut units = [0u16; 2];
    slice_as_bytes_mut(&mut units).copy_from_slice(&[1, 0, 2, 0]);
    assert_eq!(units, [1u16.to_le(), 2u16.to_le()]);

    let mut bytes = BYTES;
    cast_slice_mut::<u8, u16>(&mut bytes.0[2..6]).fill(0xffff);
    assert_eq!(bytes.0[..8], [0, 1, 255, 255, 255, 255, 6, 7]);
    assert_eq!(try_cast_slice_mut::<u8, u16>(&mut bytes.0[1..3]), None);

    let mut word = 0u32;
    bytes_of_mut(&mut word).fill(0xff);
    assert_eq!(word, u32::MAX);
}

#[test]
fn panics_say_what_and_where() {
    let odd = &BYTES.0[1..3];
    assert_eq!(
        panic_message(|| _ = cast_slice::<u8, u16>(odd)),
        std::format!("cast_slice: {:p} is not aligned to 2", odd.as_ptr()),
    );
    assert_eq!(
        panic_message(|| _ = cast_slice::<u8, u32>(&BYTES.0[..6])),
        "cast_slice: 6 bytes are not a whole number of 4-byte elements",
    );

    let location = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let seen = location.clone();
    let previous = std::panic::take_hook();
    std::panic::set_hook(std::boxed::Box::new(move |info| {
        *seen.lock().unwrap() = std::format!("{}", info.location().unwrap().file());
    }));
    let result = catch_unwind(|| _ = cast_slice::<u8, u16>(&BYTES.0[1..3]));
    std::panic::set_hook(previous);
    assert!(result.is_err());
    assert!(
        location.lock().unwrap().ends_with("tests.rs"),
        "{location:?}"
    );
}

#[test]
fn restricted_bytes_are_still_initialized() {
    assert_eq!(slice_as_bytes(&[true, false]), [1, 0]);
    assert_eq!(bytes_of(&'a'), 97u32.to_ne_bytes());
    assert!(!zeroed::<bool>());
    assert!(zeroed::<*const u8>().is_null());
    assert_eq!(zeroed::<Unaligned<u64>>().get(), 0);
}
