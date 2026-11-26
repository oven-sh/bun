use bun_zstd::ZstdError::{
    DecompressionFailed, InvalidZstdData, ShortRead, ZstdDecompressionError,
};
use bun_zstd::{
    StreamingDecoder, compress_append, decompress_alloc, decompress_alloc_with_prefix,
    decompress_exact, decompressed_size, inflate_embedded, inflate_embedded_nul, split_first_frame,
};

const ABC: &[u8] = b"\x28\xb5\x2f\xfd\x20\x03\x19\x00\x00abc";
const ABC_WITHOUT_SIZE: &[u8] = b"\x28\xb5\x2f\xfd\x00\x00\x19\x00\x00abc";
/// "abcabcabcab", behind "abc".
const WITH_PREFIX: &[u8] = b"\x28\xb5\x2f\xfd\x20\x0b\x3d\x00\x00\x00\x01\x54\x00\x02\x08\x06";
const PREALLOCATED_MAX: usize = 16 << 20;

fn compressed(bytes: &[u8]) -> Vec<u8> {
    let mut out = b"in front".to_vec();
    compress_append(&mut out, bytes, 1).unwrap();
    out.strip_prefix(b"in front").unwrap().to_vec()
}

#[test]
fn a_prefix_is_history() {
    let result = decompress_alloc_with_prefix(WITH_PREFIX, b"01234abc");
    assert_eq!(result.as_deref(), Ok(&b"abcabcabcab"[..]));
    let result = decompress_alloc_with_prefix(WITH_PREFIX, b"bc");
    assert_eq!(result, Err(DecompressionFailed));
}

#[test]
fn a_frame_with_a_prefix_has_a_moderate_size() {
    let len = |frame: &[u8]| decompress_alloc_with_prefix(frame, b"").map(|it| it.len());
    let zeros = vec![0; PREALLOCATED_MAX + 1];
    assert_eq!(len(&compressed(&zeros[1..])), Ok(PREALLOCATED_MAX));
    for frame in [&compressed(&zeros), ABC_WITHOUT_SIZE, b"not a frame"] {
        assert_eq!(len(frame), Err(InvalidZstdData));
    }
}

#[test]
fn a_frame_without_a_prefix_has_any_size() {
    let zeros = vec![0; PREALLOCATED_MAX + 1];
    for bytes in [&zeros[..0], &zeros[1..], &zeros] {
        assert!(decompress_alloc(&compressed(bytes)).as_deref() == Ok(bytes));
    }
    let frames = [ABC, ABC_WITHOUT_SIZE].concat();
    assert_eq!(decompress_alloc(&frames).as_deref(), Ok(&b"abcabc"[..]));
    assert_eq!(decompress_alloc(b"not a frame"), Err(InvalidZstdData));
    let cut_off = &ABC_WITHOUT_SIZE[..11];
    assert_eq!(decompress_alloc(cut_off), Err(ZstdDecompressionError));
}

#[test]
fn frames_are_measured_and_split() {
    assert_eq!(decompressed_size(&[ABC, ABC].concat()), Some(6));
    let frames = [ABC, ABC_WITHOUT_SIZE].concat();
    assert_eq!(decompressed_size(&frames), None);
    assert_eq!(split_first_frame(&frames), Some((ABC, ABC_WITHOUT_SIZE)));
    assert_eq!(split_first_frame(ABC), Some((ABC, &b""[..])));
    for bytes in [&ABC[..11], b"not a frame"] {
        assert_eq!(decompressed_size(bytes), None);
        assert_eq!(split_first_frame(bytes), None);
    }
}

#[test]
fn exact_room_is_filled() {
    let mut out = Vec::with_capacity(4);
    let followed = [ABC, b"not a frame"].concat();
    let mut fills = |len, frame| decompress_exact(&mut out.spare_capacity_mut()[..len], frame);
    assert!(!fills(0, b"not a frame") && !fills(3, &followed));
    assert_eq!([4, 2, 3].map(|len| fills(len, ABC)), [false, false, true]);
    // SAFETY: the last call has written them.
    unsafe { out.set_len(3) };
    assert_eq!(out, b"abc");
}

#[test]
fn embedded_files_are_inflated() {
    assert_eq!(*inflate_embedded(ABC), *b"abc");
    assert_eq!(*inflate_embedded_nul(ABC), *b"abc\0");
}

#[test]
fn a_stream_is_inflating_within_a_frame() {
    let (mut decoder, mut out) = (StreamingDecoder::new(), Vec::new());
    assert!(!decoder.is_inflating());
    let result = decoder.decompress(&ABC[..10], &mut out, 9, false);
    assert_eq!((result, decoder.is_inflating()), (Err(ShortRead), true));
    let result = decoder.decompress(&ABC[10..], &mut out, 9, false);
    assert_eq!((result, decoder.is_inflating()), (Ok(2), false));
    assert_eq!(out, b"abc");
}

#[test]
fn a_stream_drops_what_follows_its_end_or_an_error() {
    let cases = [
        (ABC, Ok(ABC.len()), "abc"),
        (&ABC[..11], Err(ZstdDecompressionError), "ab"),
        (b"not a frame", Err(ZstdDecompressionError), ""),
    ];
    for (input, result, expected) in cases {
        let (mut decoder, mut out) = (StreamingDecoder::new(), Vec::new());
        assert_eq!(decoder.decompress(input, &mut out, 9, true), result);
        assert_eq!(decoder.decompress(ABC, &mut out, 9, true), Ok(ABC.len()));
        assert_eq!(out, expected.as_bytes());
    }
}
