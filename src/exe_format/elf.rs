//! ELF file manipulation for `bun build --compile` on Linux.
//!
//! Analogous to `macho.rs` (macOS) and `pe.rs` (Windows).
//! Finds the `.bun` ELF section (placed by a linker symbol in c-bindings.cpp)
//! and expands it to hold the standalone module graph data.
//! The payload itself: elf_payload.rs. Symbols of compiled functions: elf_symbols.rs.
//!
//! Must work on any host platform (macOS, Windows, Linux) for cross-compilation.

use core::mem::size_of;
#[cfg(any(target_os = "linux", target_os = "android"))]
use core::sync::atomic::{AtomicU8, Ordering};

#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_core::env_var;
use bun_core::{slice_to_nul, strings};

use crate::read_struct;

bun_core::declare_scope!(elf, visible);

#[derive(Debug, Copy, Clone, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum ElfError {
    #[error("InvalidElfFile")]
    InvalidElfFile,
    #[error("Not64Bit")]
    Not64Bit,
    #[error("NotLittleEndian")]
    NotLittleEndian,
    #[error("BunSectionNotFound")]
    BunSectionNotFound,
    #[error("NoWritableLoadSegment")]
    NoWritableLoadSegment,
    #[error("NewVaddrCollides")]
    NewVaddrCollides,
    #[error("BunSectionAlreadyWritten")]
    BunSectionAlreadyWritten,
}

pub struct ElfFile<D = Vec<u8>> {
    pub data: D,
}

#[cfg(test)]
impl ElfFile {
    pub fn init(data: Vec<u8>) -> Result<Box<ElfFile>, ElfError> {
        validate_elf64_le(&data)?;
        Ok(Box::new(ElfFile { data }))
    }
}

impl<D: core::ops::DerefMut<Target = [u8]>> ElfFile<D> {
    /// If PT_INTERP points into a Nix/Guix store path, rewrite it to the
    /// standard FHS path so `bun build --compile` output stays portable when
    /// the bun binary itself was patchelf'd (NixOS autoPatchelfHook). See #24742.
    ///
    /// Skipped when the host system itself uses a Nix/Guix store interpreter
    /// (i.e. the running bun process has a store-path PT_INTERP): on NixOS
    /// `/lib64/ld-linux-x86-64.so.2` is a stub that refuses to run generic
    /// binaries, so normalizing there would break locally-run compiled output
    /// (#29290). Cross-compile-style portability is preserved on any non-Nix
    /// Linux host that happens to have a patchelf'd bun installed.
    ///
    /// Store paths are always longer than the FHS path, so this is an in-place
    /// shrink — no segment moves. No-op for any other interpreter.
    pub fn normalize_interpreter(&mut self) {
        // Don't rewrite on Nix/Guix hosts — the FHS path is a stub loader there.
        if host_uses_nix_store_interpreter() {
            return;
        }

        let ehdr = read_ehdr(&self.data);
        let phdr_size = size_of::<Elf64_Phdr>();

        // Bounds-check the program header table up-front; --compile-executable-path
        // accepts arbitrary files, so a corrupt e_phoff/e_phnum must not panic.
        let phdr_table_end = ehdr
            .e_phoff
            .saturating_add((ehdr.e_phnum as u64).saturating_mul(phdr_size as u64));
        if phdr_table_end > self.data.len() as u64 {
            return;
        }

        for i in 0..ehdr.e_phnum as usize {
            let phdr_offset = usize::try_from(ehdr.e_phoff).expect("int cast") + i * phdr_size;
            let phdr: Elf64_Phdr = read_struct(&self.data[phdr_offset..][..phdr_size]);
            if phdr.p_type != PT_INTERP {
                continue;
            }

            let interp_offset = usize::try_from(phdr.p_offset).expect("int cast");
            let interp_filesz = usize::try_from(phdr.p_filesz).expect("int cast");
            let is_interp_in_file = interp_offset
                .checked_add(interp_filesz)
                .is_some_and(|interp_end| interp_end <= self.data.len());
            if !is_interp_in_file {
                return;
            }

            // reshaped for borrowck — compute replacement under an
            // immutable borrow, then take a mutable borrow for the writes.
            let replacement: &'static [u8] = {
                let interp_region = &self.data[interp_offset..][..interp_filesz];
                let current = slice_to_nul(interp_region);

                if !current.starts_with(b"/nix/store/") && !current.starts_with(b"/gnu/store/") {
                    return;
                }

                let Some(last_slash) = strings::last_index_of_char(current, b'/') else {
                    return;
                };
                let basename = &current[last_slash + 1..];

                let mut found: Option<&'static [u8]> = None;
                for entry in INTERP_MAP {
                    if basename == entry.0 {
                        found = Some(entry.1);
                        break;
                    }
                }
                let Some(replacement) = found else {
                    return;
                };

                // FHS path + NUL must fit in the existing segment (always true for
                // store paths: 32-char hash + pname + "/lib/" alone exceeds any FHS path).
                if replacement.len() + 1 > interp_filesz {
                    return;
                }

                bun_core::scoped_log!(
                    elf,
                    "rewriting PT_INTERP {} -> {}",
                    bstr::BStr::new(current),
                    bstr::BStr::new(replacement)
                );

                replacement
            };

            {
                let interp_region = &mut self.data[interp_offset..][..interp_filesz];
                interp_region[..replacement.len()].copy_from_slice(replacement);
                interp_region[replacement.len()..].fill(0);
            }

            let new_size: u64 = replacement.len() as u64 + 1;
            // p_filesz @ +32, p_memsz @ +40 in Elf64_Phdr
            write_u64_le(&mut self.data[phdr_offset + 32..][..8], new_size);
            write_u64_le(&mut self.data[phdr_offset + 40..][..8], new_size);

            self.update_interp_section_size(ehdr, new_size);
            return;
        }
    }

    /// Best-effort: keep the `.interp` section header's `sh_size` consistent with
    /// the rewritten PT_INTERP so `readelf -S` shows accurate metadata. The kernel
    /// only consults PT_INTERP, so any failure here is silently ignored.
    fn update_interp_section_size(&mut self, ehdr: Elf64_Ehdr, new_size: u64) {
        let shdr_size = size_of::<Elf64_Shdr>();
        let shnum = ehdr.e_shnum;
        if shnum == 0 || ehdr.e_shstrndx >= shnum {
            return;
        }

        let shdr_table_end =
            (ehdr.e_shoff).saturating_add((shnum as u64).saturating_mul(shdr_size as u64));
        if shdr_table_end > self.data.len() as u64 {
            return;
        }

        let strtab_shdr = self.read_shdr(ehdr.e_shoff, ehdr.e_shstrndx);
        let strtab_end = strtab_shdr.sh_offset.saturating_add(strtab_shdr.sh_size);
        if strtab_end > self.data.len() as u64 {
            return;
        }
        // reshaped for borrowck — copy strtab bounds out so we can
        // re-borrow self.data mutably below.
        let strtab_off = usize::try_from(strtab_shdr.sh_offset).expect("int cast");
        let strtab_len = usize::try_from(strtab_shdr.sh_size).expect("int cast");

        for i in 0..shnum as usize {
            let shdr = self.read_shdr(ehdr.e_shoff, u16::try_from(i).expect("int cast"));
            if shdr.sh_name as usize >= strtab_len {
                continue;
            }
            let strtab = &self.data[strtab_off..][..strtab_len];
            let name = slice_to_nul(&strtab[shdr.sh_name as usize..]);
            if name != b".interp" {
                continue;
            }

            // sh_size @ +32 in Elf64_Shdr
            let shdr_offset = usize::try_from(ehdr.e_shoff).expect("int cast") + i * shdr_size;
            write_u64_le(&mut self.data[shdr_offset + 32..][..8], new_size);
            return;
        }
    }
}

impl<D: core::ops::DerefMut<Target = [u8]>> ElfFile<D> {
    /// Returns the file offset and section index of the `.bun` section.
    pub(crate) fn find_bun_section(&self, ehdr: Elf64_Ehdr) -> Result<BunSectionInfo, ElfError> {
        let shdr_size = size_of::<Elf64_Shdr>();
        let shdr_table_offset = ehdr.e_shoff;
        let shnum = ehdr.e_shnum;

        if shnum == 0 {
            return Err(ElfError::BunSectionNotFound);
        }
        let is_table_in_file = shdr_table_offset
            .checked_add(shnum as u64 * shdr_size as u64)
            .is_some_and(|table_end| table_end <= self.data.len() as u64);
        if !is_table_in_file || ehdr.e_shstrndx >= shnum {
            return Err(ElfError::InvalidElfFile);
        }

        // Read the .shstrtab section to get section names
        let shstrtab_shdr = self.read_shdr(shdr_table_offset, ehdr.e_shstrndx);
        let strtab_offset = shstrtab_shdr.sh_offset;
        let strtab_size = shstrtab_shdr.sh_size;

        let is_strtab_in_file = strtab_offset
            .checked_add(strtab_size)
            .is_some_and(|strtab_end| strtab_end <= self.data.len() as u64);
        if !is_strtab_in_file {
            return Err(ElfError::InvalidElfFile);
        }
        let strtab = &self.data[usize::try_from(strtab_offset).expect("int cast")..]
            [..usize::try_from(strtab_size).expect("int cast")];

        // Search for .bun section
        for i in 0..shnum as usize {
            let shdr = self.read_shdr(shdr_table_offset, u16::try_from(i).expect("int cast"));
            let name_offset = shdr.sh_name;

            if (name_offset as usize) < strtab.len() {
                let name = slice_to_nul(&strtab[name_offset as usize..]);
                if name == crate::image::KnownSection::Payload.names().elf {
                    return Ok(BunSectionInfo {
                        file_offset: shdr.sh_offset,
                        vaddr: shdr.sh_addr,
                        size: shdr.sh_size,
                        section_index: u16::try_from(i).expect("int cast"),
                    });
                }
            }
        }

        Err(ElfError::BunSectionNotFound)
    }

    pub(crate) fn read_shdr(&self, table_offset: u64, index: u16) -> Elf64_Shdr {
        let offset = table_offset + index as u64 * size_of::<Elf64_Shdr>() as u64;
        read_struct(
            &self.data[usize::try_from(offset).expect("int cast")..][..size_of::<Elf64_Shdr>()],
        )
    }

    pub(crate) fn write_ehdr_shoff(&mut self, new_shoff: u64) {
        // e_shoff is at offset 40 in Elf64_Ehdr
        write_u64_le(&mut self.data[40..][..8], new_shoff);
    }

    pub(crate) fn page_size(ehdr: Elf64_Ehdr) -> u64 {
        match ehdr.e_machine {
            EM_AARCH64 | EM_PPC64 => 0x10000, // 64KB
            _ => 0x1000,                      // 4KB
        }
    }
}

pub(crate) struct BunSectionInfo {
    /// File offset of the .bun section's data (sh_offset).
    pub(crate) file_offset: u64,
    /// Virtual address of the .bun section (sh_addr).
    pub(crate) vaddr: u64,
    /// Size of the .bun section (sh_size).
    pub(crate) size: u64,
    /// Index of the .bun section in the section header table.
    pub(crate) section_index: u16,
}

const INTERP_MAP: [(&[u8], &[u8]); 4] = [
    (b"ld-linux-x86-64.so.2", b"/lib64/ld-linux-x86-64.so.2"),
    (b"ld-linux-aarch64.so.1", b"/lib/ld-linux-aarch64.so.1"),
    (b"ld-musl-x86_64.so.1", b"/lib/ld-musl-x86_64.so.1"),
    (b"ld-musl-aarch64.so.1", b"/lib/ld-musl-aarch64.so.1"),
];

pub(crate) fn read_ehdr(data: &[u8]) -> Elf64_Ehdr {
    read_struct(&data[..size_of::<Elf64_Ehdr>()])
}

/// Full ELF64-LE header validation (magic + class + endian). This is the strict
/// check used before parsing program/section headers — NOT a format sniff. Do
/// not route `macho::utils::is_elf` through this; that function is intentionally
/// a 4-byte-magic-only sniff used for elf-vs-macho dispatch and must accept
/// 32-bit/BE ELF.
pub(crate) fn validate_elf64_le(data: &[u8]) -> Result<(), ElfError> {
    if data.len() < size_of::<Elf64_Ehdr>() {
        return Err(ElfError::InvalidElfFile);
    }
    if &data[0..4] != b"\x7fELF" {
        return Err(ElfError::InvalidElfFile);
    }
    if data[EI_CLASS] != ELFCLASS64 {
        return Err(ElfError::Not64Bit);
    }
    if data[EI_DATA] != ELFDATA2LSB {
        return Err(ElfError::NotLittleEndian);
    }
    Ok(())
}

/// True iff the host bun is running on is managed by Nix or Guix — in which
/// case the "generic" FHS linker path `/lib64/ld-linux-x86-64.so.2` is a stub
/// that rejects generic binaries, and rewriting PT_INTERP to it would break
/// locally-run `bun build --compile` output. See #29290.
///
/// Checks (any one is sufficient):
///   1. `BUN_DEBUG_FORCE_NIX_HOST` — test-only override used by #29290's
///      regression test to exercise this branch without writing to `/etc`.
///   2. The running bun process's own PT_INTERP (via `/proc/self/exe`). NixOS
///      `autoPatchelfHook` rewrites installed binaries to `/nix/store/...`
///      loaders; this is the most precise signal.
///   3. `/etc/NIXOS` — canonical NixOS marker, present on every NixOS system
///      regardless of how bun itself was installed (e.g. a statically-linked
///      bun built elsewhere).
///   4. `/gnu/store` directory — Guix's equivalent of /nix/store.
///
/// Result is cached — this is called once per `bun build --compile`.
///
/// Always `false` on non-Linux hosts: `bun build --compile` for a Linux target
/// can run on macOS/Windows, in which case the host's linker layout is
/// irrelevant and we want to normalize for portability (#24742).
fn host_uses_nix_store_interpreter() -> bool {
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        return false;
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        static COMPUTED: AtomicU8 = AtomicU8::new(0); // 0 unknown, 1 no, 2 yes

        fn check() -> bool {
            // Test-only override: lets #29290's regression test force the
            // Nix-host branch without mutating `/etc/NIXOS` on the shared
            // rootfs (which would poison concurrent test workers).
            // env_var .get() returns Option<bool> (nullability
            // collapsed in the macro port); default-false makes None ≡ false.
            if env_var::BUN_DEBUG_FORCE_NIX_HOST.get() == Some(true) {
                return true;
            }
            if self_interp_is_nix_store() {
                return true;
            }
            // Canonical NixOS marker — present even when bun itself was not
            // installed via Nix (statically-linked bun, downloaded tarball).
            if bun_sys::exists_z(bun_core::zstr!("/etc/NIXOS")) {
                return true;
            }
            // Guix equivalent.
            if bun_sys::directory_exists_at(bun_sys::Fd::cwd(), bun_core::zstr!("/gnu/store"))
                .unwrap_or(false)
            {
                return true;
            }
            false
        }

        fn self_interp_is_nix_store() -> bool {
            // 4 KiB is enough: PT_INTERP on a glibc-linked binary points into
            // the first page. Read just the leading bytes to avoid slurping
            // the whole bun binary.
            use bun_sys::FdExt as _;
            let mut buf = [0u8; 4096];
            let fd = match bun_sys::open(bun_core::zstr!("/proc/self/exe"), bun_sys::O::RDONLY, 0) {
                Ok(fd) => fd,
                Err(_) => return false,
            };
            // close moved up; fd not needed after read (was `defer fd.close()`).
            let n = match bun_sys::read(fd, &mut buf) {
                Ok(n) => n,
                Err(_) => {
                    fd.close();
                    return false;
                }
            };
            fd.close();
            let data = &buf[..n];
            if validate_elf64_le(data).is_err() {
                return false;
            }

            let ehdr = read_ehdr(data);
            let phdr_size = size_of::<Elf64_Phdr>();
            let table_end = (ehdr.e_phoff)
                .saturating_add((ehdr.e_phnum as u64).saturating_mul(phdr_size as u64));
            if table_end > data.len() as u64 {
                return false;
            }

            for i in 0..ehdr.e_phnum as usize {
                let off = usize::try_from(ehdr.e_phoff).expect("int cast") + i * phdr_size;
                let phdr: Elf64_Phdr = read_struct(&data[off..][..phdr_size]);
                if phdr.p_type != PT_INTERP {
                    continue;
                }

                let interp_off = usize::try_from(phdr.p_offset).expect("int cast");
                let interp_sz = usize::try_from(phdr.p_filesz).expect("int cast");
                let is_interp_in_data = interp_off
                    .checked_add(interp_sz)
                    .is_some_and(|interp_end| interp_end <= data.len());
                if !is_interp_in_data {
                    return false;
                }

                let interp = slice_to_nul(&data[interp_off..][..interp_sz]);
                return interp.starts_with(b"/nix/store/") || interp.starts_with(b"/gnu/store/");
            }
            false
        }

        match COMPUTED.load(Ordering::Acquire) {
            1 => return false,
            2 => return true,
            _ => {}
        }
        let result = check();
        COMPUTED.store(if result { 2 } else { 1 }, Ordering::Release);
        result
    }
}

// --- ELF definitions (defined locally for cross-platform use) ---

pub(crate) const EI_CLASS: usize = 4;
pub(crate) const EI_DATA: usize = 5;
pub(crate) const ELFCLASS64: u8 = 2;
pub(crate) const ELFDATA2LSB: u8 = 1;

use bun_sys::elf::PT_INTERP;
pub(crate) const PF_W: u32 = 2;
pub(crate) const SHT_NOBITS: u32 = 8;
pub(crate) const SHF_ALLOC: u64 = 0x2;
pub(crate) const SHF_TLS: u64 = 0x400;

const EM_PPC64: u16 = 21;
pub(crate) const EM_AARCH64: u16 = 183;
pub(crate) const EM_X86_64: u16 = 62;
pub(crate) const SHT_PROGBITS: u32 = 1;
pub(crate) const SHT_SYMTAB: u32 = 2;
pub(crate) const SHT_STRTAB: u32 = 3;
pub(crate) const SHN_LORESERVE: usize = 0xff00;
pub(crate) const STT_FUNC: u8 = 2;
pub(crate) const SHF_WRITE: u64 = 0x1;
pub(crate) const SHF_EXECINSTR: u64 = 0x4;

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct Elf64_Ehdr {
    pub e_ident: [u8; 16],
    pub e_type: u16,
    pub e_machine: u16,
    pub e_version: u32,
    pub e_entry: u64,
    pub e_phoff: u64,
    pub e_shoff: u64,
    pub e_flags: u32,
    pub e_ehsize: u16,
    pub e_phentsize: u16,
    pub e_phnum: u16,
    pub e_shentsize: u16,
    pub e_shnum: u16,
    pub e_shstrndx: u16,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct Elf64_Phdr {
    pub p_type: u32,
    pub p_flags: u32,
    pub p_offset: u64,
    pub p_vaddr: u64,
    pub p_paddr: u64,
    pub p_filesz: u64,
    pub p_memsz: u64,
    pub p_align: u64,
}

impl Elf64_Phdr {
    pub(crate) const ZEROED: Self = Self {
        p_type: 0,
        p_flags: 0,
        p_offset: 0,
        p_vaddr: 0,
        p_paddr: 0,
        p_filesz: 0,
        p_memsz: 0,
        p_align: 0,
    };
}

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct Elf64_Shdr {
    pub sh_name: u32,
    pub sh_type: u32,
    pub sh_flags: u64,
    pub sh_addr: u64,
    pub sh_offset: u64,
    pub sh_size: u64,
    pub sh_link: u32,
    pub sh_info: u32,
    pub sh_addralign: u64,
    pub sh_entsize: u64,
}

// --- byte helpers ---

#[inline]
pub(crate) fn write_u64_le(bytes: &mut [u8], value: u64) {
    bytes[..8].copy_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::write_struct;

    #[test]
    fn interpreter_range_overflow_is_ignored() {
        let mut data = vec![0u8; size_of::<Elf64_Ehdr>() + size_of::<Elf64_Phdr>()];
        data[..4].copy_from_slice(b"\x7fELF");
        data[EI_CLASS] = ELFCLASS64;
        data[EI_DATA] = ELFDATA2LSB;
        let mut ehdr = read_ehdr(&data);
        ehdr.e_phoff = size_of::<Elf64_Ehdr>() as u64;
        ehdr.e_phnum = 1;
        write_struct(&mut data, &ehdr);
        let interp = Elf64_Phdr {
            p_type: PT_INTERP,
            p_offset: u64::MAX - 15,
            p_filesz: 32,
            ..Elf64_Phdr::ZEROED
        };
        write_struct(&mut data[size_of::<Elf64_Ehdr>()..], &interp);

        let mut file = ElfFile::init(data.clone()).unwrap();
        file.normalize_interpreter();
        assert!(file.data == data);
    }
}
