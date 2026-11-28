use super::*;

/// The pages are not touched.
#[test]
fn lengths_have_31_bits() {
    let result = end(&mut vec![0; 8 + (1 << 31)], 0);
    assert!(matches!(result, Err(Error::ChunkTooLong)));
}
