use bun_core::vec::BorrowedBuf;
use bun_highway::zlib::{adler32, copy_and_adler32, copy_and_crc32, crc32};

use crate::plain;
use crate::samples::Random;

#[test]
fn any_length_is_checksummed_and_copied() {
    let bytes = Random::new(1).bytes(140_000);
    let around = |len: usize| len - 2..len + 20;
    let lengths = (0..1300).chain([16384, 65536, 131_072].into_iter().flat_map(around));
    for bytes in lengths.map(|len| &bytes[..len]) {
        let (crc, adler) = (
            plain::crc32(0x1234_5678, bytes),
            plain::adler32(0xfff0_fff0, bytes),
        );
        assert_eq!(crc32(0x1234_5678, bytes), crc);
        assert_eq!(adler32(0xfff0_fff0, bytes), adler);
        let mut room = vec![0; 2 * bytes.len()];
        let mut copies = BorrowedBuf::from(&mut room[..]);
        assert_eq!(copy_and_crc32(0x1234_5678, bytes, copies.unfilled()), crc);
        assert_eq!(
            copy_and_adler32(0xfff0_fff0, bytes, copies.unfilled()),
            adler
        );
        assert!(copies.filled() == bytes.repeat(2));
    }
}
