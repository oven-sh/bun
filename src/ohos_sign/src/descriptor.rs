pub const SIZE: usize = 256;
pub const FLAG_SELF_SIGN: u32 = 0x10;
pub const ELF_SIGN_INFO_TYPE: u32 = 1;

/// Build the 256-byte fs-verity descriptor.
/// When computing the digest, pass `sign_size = 0`.
/// When writing to disk, pass `sign_size = 32`.
pub fn build(sign_size: u32, file_size: u64, root_hash: &[u8; 32]) -> [u8; SIZE] {
    let mut out = [0u8; SIZE];
    out[0] = 1;   // version
    out[1] = 1;   // hashAlgorithm = SHA-256
    out[2] = 12;  // log2BlockSize = 4096
    out[3] = 0;   // saltSize
    out[4..8].copy_from_slice(&sign_size.to_le_bytes());
    out[8..16].copy_from_slice(&file_size.to_le_bytes());
    out[16..48].copy_from_slice(root_hash); // rootHash (left-aligned in 64-byte field)
    // out[48..80] = 0  (rootHash padding)
    // out[80..112] = 0 (salt)
    out[112..116].copy_from_slice(&FLAG_SELF_SIGN.to_le_bytes());
    // out[116..120] reserved1 = 0
    // out[120..128] merkleTreeOffset = 0
    // Embed version tag in reserved_2 so signed binaries carry an
    // identifiable string for diagnostic / audit purposes.
    let tag = crate::OHOS_SIGN_VERSION;
    let tag_start = 128 + 127 - tag.len(); // right-align in reserved_2
    out[tag_start..tag_start + tag.len()].copy_from_slice(tag);
    // out[128..255] reserved2 = 0 (overwritten above for version tag)
    out[255] = 3; // csVersion
    out
}
