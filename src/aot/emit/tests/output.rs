use crate::emit::output::OutputSlice;
use std::mem::MaybeUninit;

const UNWRITTEN: u8 = 0xAA;

fn write_into<const SIZE: usize>(write: impl FnOnce(OutputSlice<'_>)) -> [u8; SIZE] {
    let mut storage = [MaybeUninit::new(UNWRITTEN); SIZE];
    write(OutputSlice::new(&mut storage));
    // SAFETY: every byte was initialized when the array was created.
    storage.map(|byte| unsafe { byte.assume_init() })
}

#[test]
fn take_splits_off_the_front() {
    let bytes: [u8; 4] = write_into(|mut output| {
        let mut front = output.take(1);
        assert!(!front.is_empty());
        front.put_bytes(&[1]);
        assert!(front.is_empty());
        assert!(!output.is_empty());
        output.put_bytes(&[2, 3]);
    });
    assert_eq!(bytes, [1, 2, 3, UNWRITTEN]);
}

#[test]
fn taking_nothing_leaves_the_slice() {
    let bytes: [u8; 2] = write_into(|mut output| {
        assert!(output.take(0).is_empty());
        output.put_bytes(&[7, 8]);
        assert!(output.is_empty());
    });
    assert_eq!(bytes, [7, 8]);
}

#[test]
fn words_are_little_endian() {
    let bytes: [u8; 8] = write_into(|mut output| {
        output.put_words(&[0x0403_0201, 0xFFEE_DDCC]);
        assert!(output.is_empty());
    });
    assert_eq!(bytes, [1, 2, 3, 4, 0xCC, 0xDD, 0xEE, 0xFF]);
}

#[test]
fn zeros_fill_the_rest() {
    let bytes: [u8; 5] = write_into(|mut output| {
        let untouched = output.take(1);
        assert!(!untouched.is_empty());
        output.put_bytes(&[9]);
        output.fill_with_zeros();
        assert!(output.is_empty());
    });
    assert_eq!(bytes, [UNWRITTEN, 9, 0, 0, 0]);
}

#[test]
#[should_panic]
fn writing_past_the_end_panics() {
    let _: [u8; 2] = write_into(|mut output| output.put_bytes(&[1, 2, 3]));
}
