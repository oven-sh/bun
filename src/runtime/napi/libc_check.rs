//! Pre-`dlopen` libc-mismatch detection for native addons on Linux.
//!
//! A glibc-linked `.node` loaded into a musl process (typically via Alpine's
//! `gcompat` shim, which satisfies the `libc.so.6` soname but not the ABI)
//! segfaults inside the dynamic loader during relocation. That crash is not
//! catchable from JS and looks like a Bun bug. Instead, inspect the addon's
//! ELF `PT_DYNAMIC` segment before calling `dlopen` and surface a
//! `ERR_DLOPEN_FAILED` that names the problem. See issue #15753.

/// Called from `Process_functionDlopen` (BunProcess.cpp) immediately before
/// `dlopen`. Returns `1` when the file at `path` is an ELF shared object whose
/// `DT_NEEDED` list references glibc and this process is musl-linked (or the
/// test-only `BUN_INTERNAL_NAPI_FORCE_MUSL_CHECK` env var is set). The
/// matching soname is copied NUL-terminated into `soname_out` so the thrown
/// error can quote the actual rejected entry. Returns `0` for every other
/// outcome, including I/O and parse errors: a false negative falls through to
/// `dlopen` which is today's behaviour, whereas a false positive would refuse
/// a working addon.
// HOST_EXPORT(Bun__addonNeedsGlibcOnMusl, c)
pub fn addon_needs_glibc_on_musl(path: &[u8], soname_out: &mut [u8]) -> i32 {
    let _ = (path, &soname_out);
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        if !check_enabled() {
            return 0;
        }
        if let Some(name) = elf_glibc_needed(path) {
            if let Some(cap) = soname_out.len().checked_sub(1) {
                let n = name.len().min(cap);
                soname_out[..n].copy_from_slice(&name[..n]);
                soname_out[n] = 0;
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
    use bun_sys::{Fd, File, O};

    const PHDR_SIZE: usize = 56; // Elf64_Phdr
    const DYN_SIZE: usize = 16; // Elf64_Dyn
    const PT_LOAD: u32 = 1;
    const PT_DYNAMIC: u32 = 2;
    const DT_NULL: i64 = 0;
    const DT_NEEDED: i64 = 1;
    const DT_STRTAB: i64 = 5;
    const DT_STRSZ: i64 = 10;

    let file = File::openat(Fd::cwd(), path, O::RDONLY | O::CLOEXEC, 0).ok()?;

    let mut ehdr = [0u8; 64];
    if file.pread_all(&mut ehdr, 0).ok()? < ehdr.len() {
        return None;
    }
    // ELF64 little-endian only (matches every Bun target).
    if &ehdr[0..4] != b"\x7fELF" || ehdr[4] != 2 || ehdr[5] != 1 {
        return None;
    }
    let e_phoff = read_u64_le(&ehdr[32..40]);
    let e_phnum = read_u16_le(&ehdr[56..58]) as usize;
    if e_phnum == 0 || e_phnum > 256 {
        return None;
    }

    let mut phdrs = vec![0u8; e_phnum.checked_mul(PHDR_SIZE)?];
    if file.pread_all(&mut phdrs, e_phoff).ok()? < phdrs.len() {
        return None;
    }

    let mut loads: [(u64, u64, u64); 16] = [(0, 0, 0); 16];
    let mut load_count = 0usize;
    let mut dynamic: Option<(u64, u64)> = None;
    for i in 0..e_phnum {
        let ph = &phdrs[i * PHDR_SIZE..][..PHDR_SIZE];
        let p_type = read_u32_le(&ph[0..4]);
        let p_offset = read_u64_le(&ph[8..16]);
        let p_vaddr = read_u64_le(&ph[16..24]);
        let p_filesz = read_u64_le(&ph[32..40]);
        match p_type {
            PT_LOAD if load_count < loads.len() => {
                loads[load_count] = (p_vaddr, p_filesz, p_offset);
                load_count += 1;
            }
            PT_DYNAMIC => dynamic = Some((p_offset, p_filesz)),
            _ => {}
        }
    }
    let (dyn_off, dyn_size) = dynamic?;
    // Cap the dynamic-section read: real addons carry a few dozen entries.
    let dyn_size = dyn_size.min(8192) as usize;
    let mut dynb = vec![0u8; dyn_size];
    let n = file.pread_all(&mut dynb, dyn_off).ok()?;
    let dynb = &dynb[..n];

    let mut strtab_vaddr: Option<u64> = None;
    let mut strsz: u64 = 0;
    let mut needed: [u64; 32] = [0; 32];
    let mut needed_count = 0usize;
    for chunk in dynb.as_chunks::<DYN_SIZE>().0 {
        let d_tag = read_u64_le(&chunk[0..8]) as i64;
        let d_val = read_u64_le(&chunk[8..16]);
        match d_tag {
            DT_NULL => break,
            DT_NEEDED if needed_count < needed.len() => {
                needed[needed_count] = d_val;
                needed_count += 1;
            }
            DT_STRTAB => strtab_vaddr = Some(d_val),
            DT_STRSZ => strsz = d_val,
            _ => {}
        }
    }
    if needed_count == 0 {
        return None;
    }
    let strtab_vaddr = strtab_vaddr?;
    let strtab_off = vaddr_to_offset(&loads[..load_count], strtab_vaddr)?;
    // DT_NEEDED names sit at the front of .dynstr; cap the read.
    let strsz = (strsz.min(64 * 1024) as usize).max(256);
    let mut strtab = vec![0u8; strsz];
    let n = file.pread_all(&mut strtab, strtab_off).ok()?;
    let strtab = &strtab[..n];

    for &off in &needed[..needed_count] {
        let off = off as usize;
        if off >= strtab.len() {
            continue;
        }
        let name = bun_core::slice_to_nul(&strtab[off..]);
        if is_glibc_soname(name) {
            return Some(name.to_vec());
        }
    }
    None
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

#[cfg(any(target_os = "linux", target_os = "android"))]
fn vaddr_to_offset(loads: &[(u64, u64, u64)], vaddr: u64) -> Option<u64> {
    for &(base, size, off) in loads {
        if vaddr >= base && vaddr - base < size {
            return Some(off + (vaddr - base));
        }
    }
    None
}

#[cfg(any(target_os = "linux", target_os = "android"))]
#[inline]
fn read_u16_le(b: &[u8]) -> u16 {
    u16::from_le_bytes([b[0], b[1]])
}

#[cfg(any(target_os = "linux", target_os = "android"))]
#[inline]
fn read_u32_le(b: &[u8]) -> u32 {
    u32::from_le_bytes([b[0], b[1], b[2], b[3]])
}

#[cfg(any(target_os = "linux", target_os = "android"))]
#[inline]
fn read_u64_le(b: &[u8]) -> u64 {
    u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
}
