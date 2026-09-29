//! Pre-`dlopen` libc-mismatch detection for native addons on Linux.
//!
//! A glibc-linked `.node` loaded into a musl process (typically via Alpine's
//! `gcompat` shim, which satisfies the `libc.so.6` soname but not the ABI)
//! segfaults inside the dynamic loader during relocation. That crash is not
//! catchable from JS and looks like a Bun bug. Instead, inspect the addon's
//! ELF `PT_DYNAMIC` segment before calling `dlopen` and surface a
//! `ERR_DLOPEN_FAILED` that names the problem. See issue #15753.

use core::ffi::c_char;

/// Called from `Process_functionDlopen` (BunProcess.cpp) immediately before
/// `dlopen`. Returns `1` when the file at `path_ptr[..path_len]` is an ELF
/// shared object whose `DT_NEEDED` list references glibc and this process is
/// musl-linked (or the test-only `BUN_INTERNAL_NAPI_FORCE_MUSL_CHECK` env var
/// is set). The matching soname is copied NUL-terminated into
/// `soname_out[..soname_cap]` so the thrown error can quote the actual
/// rejected entry. Returns `0` for every other outcome, including I/O and
/// parse errors: a false negative falls through to `dlopen` which is today's
/// behaviour, whereas a false positive would refuse a working addon.
///
/// # Safety
/// `path_ptr` must be valid for reads of `path_len` bytes; `soname_out` must
/// be valid for writes of `soname_cap` bytes.
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn Bun__addonNeedsGlibcOnMusl(
    path_ptr: *const c_char,
    path_len: usize,
    soname_out: *mut u8,
    soname_cap: usize,
) -> i32 {
    let _ = (path_ptr, path_len, soname_out, soname_cap);
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        if !check_enabled() {
            return 0;
        }
        // SAFETY: caller contract.
        let path = unsafe { bun_core::ffi::slice(path_ptr.cast::<u8>(), path_len) };
        if let Some(name) = elf_glibc_needed(path) {
            if !soname_out.is_null() && soname_cap > 0 {
                // SAFETY: caller contract.
                let out = unsafe { core::slice::from_raw_parts_mut(soname_out, soname_cap) };
                let n = name.len().min(soname_cap - 1);
                out[..n].copy_from_slice(&name[..n]);
                out[n] = 0;
            }
            return 1;
        }
    }
    0
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn check_enabled() -> bool {
    bun_core::Environment::IS_MUSL
        || bun_core::env_var::BUN_INTERNAL_NAPI_FORCE_MUSL_CHECK.get() == Some(true)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn elf_glibc_needed(path: &[u8]) -> Option<Vec<u8>> {
    use bun_exe_format::loader_entries::elf;
    use bun_sys::{Fd, File, O};

    let file = File::openat(Fd::cwd(), path, O::RDONLY | O::CLOEXEC, 0).ok()?;

    let mut ehdr = [0u8; elf::EHDR_SIZE];
    if file.pread_all(&mut ehdr, 0).ok()? < ehdr.len() {
        return None;
    }
    // ELF64 little-endian only (matches every Bun target).
    let header = elf::header(&ehdr)?;
    let phnum = usize::from(header.phnum);
    if phnum == 0 || phnum > 256 {
        return None;
    }

    let mut phdrs = vec![0u8; phnum * elf::PHDR_SIZE];
    if file.pread_all(&mut phdrs, header.phoff).ok()? < phdrs.len() {
        return None;
    }

    let mut loads = [None; 16];
    let mut load_count = 0usize;
    let mut dynamic = None;
    for phdr in elf::program_headers(&phdrs, elf::PHDR_SIZE) {
        match phdr.kind {
            elf::PT_LOAD if load_count < loads.len() => {
                loads[load_count] = Some(phdr);
                load_count += 1;
            }
            elf::PT_DYNAMIC => dynamic = Some(phdr),
            _ => {}
        }
    }
    let dynamic = dynamic?;
    // Cap the dynamic-section read: real addons carry a few dozen entries.
    let mut dynb = vec![0u8; dynamic.filesz.min(8192) as usize];
    let n = file.pread_all(&mut dynb, dynamic.offset).ok()?;

    let mut strtab_vaddr: Option<u64> = None;
    let mut strsz: u64 = 0;
    let mut needed: [u64; 32] = [0; 32];
    let mut needed_count = 0usize;
    for (d_tag, d_val) in elf::dynamic_entries(&dynb[..n]) {
        match d_tag {
            elf::DT_NEEDED if needed_count < needed.len() => {
                needed[needed_count] = d_val;
                needed_count += 1;
            }
            elf::DT_STRTAB => strtab_vaddr = Some(d_val),
            elf::DT_STRSZ => strsz = d_val,
            _ => {}
        }
    }
    if needed_count == 0 {
        return None;
    }
    let strtab_vaddr = strtab_vaddr?;
    let strtab_off = loads[..load_count]
        .iter()
        .flatten()
        .find_map(|load| load.offset_of(strtab_vaddr))?;
    // DT_NEEDED names sit at the front of .dynstr; cap the read.
    let strsz = (strsz.min(64 * 1024) as usize).max(256);
    let mut strtab = vec![0u8; strsz];
    let n = file.pread_all(&mut strtab, strtab_off).ok()?;
    let strtab = &strtab[..n];

    needed[..needed_count]
        .iter()
        .filter_map(|&offset| elf::string_at(strtab, offset))
        .find(|&(name, _)| is_glibc_soname(name))
        .map(|(name, _)| name.to_vec())
}

/// glibc ships its libc split across several sonames (merged into `libc.so.6`
/// in 2.34 but older toolchains still emit the split list); musl uses a single
/// `libc.musl-<arch>.so.1`. `libstdc++.so.6` / `libgcc_s.so.1` are
/// deliberately excluded since Alpine packages real copies of those.
#[cfg(any(target_os = "linux", target_os = "android"))]
fn is_glibc_soname(name: &[u8]) -> bool {
    matches!(
        name,
        b"libc.so.6"
            | b"libpthread.so.0"
            | b"libm.so.6"
            | b"libdl.so.2"
            | b"librt.so.1"
            | b"libresolv.so.2"
            | b"libutil.so.1"
    ) || name.starts_with(b"ld-linux")
}
