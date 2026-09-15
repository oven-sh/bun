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

/// Number of bytes in the on-disk ElfSignInfo payload: 8-byte header +
/// 256-byte fs-verity descriptor + 32-byte SHA-256 signature.
const SIGN_INFO_LEN: usize = 8 + descriptor::SIZE + 32;

/// Validate an existing self-signature: the descriptor is well-formed, the
/// stored page Merkle root matches a freshly recomputed one, and the stored
/// signature equals SHA-256 of the descriptor with signSize zeroed.
pub fn is_validly_signed(elf: &[u8]) -> bool {
    let Some((cs_off, cs_len)) = elf::codesign_section_range(elf) else {
        return false;
    };
    if cs_len < SIGN_INFO_LEN {
        return false;
    }
    let d = cs_off + 8;
    let kind = u32::from_le_bytes(elf[cs_off..cs_off + 4].try_into().unwrap());
    let length = u32::from_le_bytes(elf[cs_off + 4..cs_off + 8].try_into().unwrap());
    if kind != descriptor::ELF_SIGN_INFO_TYPE || length as usize != descriptor::SIZE + 32 {
        return false;
    }
    if elf[d] != 1 || elf[d + 1] != 1 || elf[d + 2] != 12 || elf[d + 255] != 3 {
        return false;
    }
    let sign_size = u32::from_le_bytes(elf[d + 4..d + 8].try_into().unwrap());
    let data_size = u64::from_le_bytes(elf[d + 8..d + 16].try_into().unwrap());
    if sign_size != 32 || data_size != elf.len() as u64 {
        return false;
    }
    let mut stored_root = [0u8; 32];
    stored_root.copy_from_slice(&elf[d + 16..d + 48]);
    let root = merkle::root_hash(elf, cs_off as u64, cs_len as u64);
    if stored_root != root {
        return false;
    }
    let mut stored_signature = [0u8; 32];
    stored_signature.copy_from_slice(&elf[d + descriptor::SIZE..d + descriptor::SIZE + 32]);
    stored_signature == sha256::hash(&descriptor::build(0, data_size, &root))
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

/// Write the signed bytes back to `path`. Prefer a sibling temp file + rename
/// so an inode the kernel marked immutable after execution can still be
/// replaced; fall back to an in-place write when the directory is not
/// writable.
fn write_signed(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("elf");
    let tmp = dir.join(format!(".{file_name}.ohos-sign.tmp"));
    let replaced = (|| -> std::io::Result<()> {
        std::fs::write(&tmp, bytes)?;
        if let Ok(metadata) = std::fs::metadata(path) {
            let _ = std::fs::set_permissions(&tmp, metadata.permissions());
        }
        std::fs::rename(&tmp, path)
    })();
    match replaced {
        Ok(()) => Ok(()),
        Err(_) => {
            let _ = std::fs::remove_file(&tmp);
            std::fs::write(path, bytes)
        }
    }
}

/// Sign a file, replacing it in place (temp file + rename when possible).
pub fn sign_selfsign_inplace(path: &std::path::Path) -> Result<(), SignError> {
    let bytes = std::fs::read(path)?;
    let signed = sign_selfsign(&bytes)?;
    write_signed(path, &signed)?;
    Ok(())
}

/// Sign a file in-place, stripping any existing `.codesign` section first.
/// Non-ELF inputs (e.g. Mach-O templates for `--target=bun-darwin-*`) are
/// skipped silently: the compile pipeline calls this unconditionally on
/// OHOS, and only ELF outputs need signing.
pub fn sign_selfsign_inplace_with_strip(path: &std::path::Path) -> Result<(), SignError> {
    let bytes = std::fs::read(path)?;
    if !elf::is_elf64(&bytes) {
        return Ok(());
    }
    let signed = sign_selfsign_with_strip(&bytes)?;
    write_signed(path, &signed)?;
    Ok(())
}

/// C FFI bridge: ensure an ELF file at `path` has a `.codesign` section.
/// If unsigned, signs it in-place using self-sign. Returns true if the file
/// is (or became) signed; false if not an ELF or signing failed.
/// Called from BunProcess.cpp before `dlopen()` on OHOS.
#[unsafe(no_mangle)]
pub extern "C" fn ohos_ensure_elf_signed(path: *const core::ffi::c_char) -> bool {
    if path.is_null() {
        return false;
    }
    let cstr = unsafe { core::ffi::CStr::from_ptr(path) };
    let path_bytes = cstr.to_bytes();
    let path = std::path::Path::new(std::str::from_utf8(path_bytes).unwrap_or(""));
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(_) => return false,
    };
    if bytes.len() < 4 || bytes[..4] != [0x7f, 0x45, 0x4c, 0x46] {
        return false;
    }
    // A stale .codesign section (from a previous sign of a different build,
    // or a file modified after signing) makes has_codesign() report true
    // while the signature no longer covers the file — the kernel then rejects
    // the dlopen with EPERM. Validate first so a still-valid signature is
    // left untouched: rewriting an executed/mapped ELF in place fails on OHOS
    // and would be wasted work on every dlopen. Only then strip the stale
    // section and re-sign. Failures are silent — the caller (BunProcess.cpp)
    // reports the dlopen error, and an error line here would pollute stderr
    // and trip `stderr.not.toContain("error:")` assertions in the test suite.
    if is_validly_signed(&bytes) {
        return true;
    }
    sign_selfsign_inplace_with_strip(path).is_ok()
}
