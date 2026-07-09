mod sha256;
mod merkle;
mod descriptor;
mod elf;

pub use elf::SignError;

// Exported under `__` names so integration tests can reach internal primitives
// without exposing them as first-class public API.
#[doc(hidden)]
pub fn __sha256_hash(data: &[u8]) -> [u8; 32] {
    sha256::hash(data)
}

#[doc(hidden)]
pub fn __merkle_root_hash(data: &[u8], cs_off: u64, cs_len: u64) -> [u8; 32] {
    merkle::root_hash(data, cs_off, cs_len)
}

#[doc(hidden)]
pub fn __descriptor_build(sign_size: u32, file_size: u64, root_hash: &[u8; 32]) -> [u8; 256] {
    descriptor::build(sign_size, file_size, root_hash)
}

/// Returns true if the ELF bytes already contain a `.codesign` section.
pub fn has_codesign(elf: &[u8]) -> bool {
    elf::has_codesign_section(elf)
}

/// Sign `elf` bytes with self-sign (flags=0x10). Fails if already signed.
/// Use `sign_selfsign_with_strip` to strip-then-sign.
pub fn sign_selfsign(elf: &[u8]) -> Result<Vec<u8>, SignError> {
    elf::sign(elf, false)
}

/// Strip existing `.codesign` section then sign.
pub fn sign_selfsign_with_strip(elf: &[u8]) -> Result<Vec<u8>, SignError> {
    elf::sign(elf, true)
}

/// Strip `.codesign` section in-place in the buffer.
/// Returns true if a section was removed, false if none present.
pub fn strip_codesign(elf: &mut Vec<u8>) -> Result<bool, SignError> {
    elf::strip(elf)
}

/// Sign a file in-place. Creates a `.unsigned` sibling during the operation.
pub fn sign_selfsign_inplace(path: &std::path::Path) -> Result<(), SignError> {
    let bytes = std::fs::read(path)?;
    let signed = sign_selfsign(&bytes)?;
    std::fs::write(path, &signed)?;
    Ok(())
}

/// Sign a file in-place, stripping any existing `.codesign` section first.
pub fn sign_selfsign_inplace_with_strip(path: &std::path::Path) -> Result<(), SignError> {
    let bytes = std::fs::read(path)?;
    let signed = sign_selfsign_with_strip(&bytes)?;
    std::fs::write(path, &signed)?;
    Ok(())
}
