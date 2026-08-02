// Byte-level regression test for the OHOS fs-verity descriptor.
//
// The OHOS kernel requires the descriptor's reserved2 region (bytes
// 128..255) to be all zeros, with only the last byte (csVersion) set to 3.
// A version tag embedded there makes the kernel reject the signature with
// EPERM/Operation not permitted. This test pins the fixed layout so the
// bug cannot silently regress.
use ohos_sign::__descriptor_build;

const EMPTY_HASH: [u8; 32] = [0u8; 32];

#[test]
fn reserved2_is_all_zeros_except_csversion() {
    let desc = __descriptor_build(32, 4096, &EMPTY_HASH);
    // bytes 128..255 (reserved2) must be zero
    assert!(
        desc[128..255].iter().all(|&b| b == 0),
        "reserved2 region (128..255) must be all zeros, got: {:?}",
        &desc[128..255],
    );
    // last byte is csVersion = 3
    assert_eq!(desc[255], 3, "csVersion must be 3");
}

#[test]
fn no_version_tag_in_descriptor() {
    let desc = __descriptor_build(32, 4096, &EMPTY_HASH);
    // The old implementation right-aligned b"ohos-sign-20260722" at
    // offset 128+127-18 = 237. The whole reserved2 region must be zero now.
    assert_eq!(
        desc[237..255],
        [0u8; 18],
        "no version tag may be embedded in reserved2",
    );
}

#[test]
fn descriptor_header_fields_are_stable() {
    let desc = __descriptor_build(32, 4096, &EMPTY_HASH);
    assert_eq!(desc[0], 1, "version = 1");
    assert_eq!(desc[1], 1, "hashAlgorithm = SHA-256");
    assert_eq!(desc[2], 12, "log2BlockSize = 4096");
    assert_eq!(desc[3], 0, "saltSize = 0");
    // sig_size = 32 LE at 4..8, data_size = 4096 LE at 8..16
    assert_eq!(desc[4..8], [32, 0, 0, 0], "sig_size = 32");
    assert_eq!(desc[8..16], [0, 16, 0, 0, 0, 0, 0, 0], "data_size = 4096");
    // flags = 0x10 (SELF_SIGN) at 112..116
    assert_eq!(desc[112..116], [0x10, 0, 0, 0], "FLAG_SELF_SIGN");
    // reserved1 (116..120) and merkleTreeOffset (120..128) zero
    assert_eq!(desc[116..128], [0u8; 12], "reserved1 + merkleTreeOffset");
}
