//! ELF file manipulation for `bun build --compile` on Linux.
//!
//! Analogous to `macho.rs` (macOS) and `pe.rs` (Windows).
//! Finds the `.bun` ELF section (placed by a linker symbol in c-bindings.cpp)
//! and expands it to hold the standalone module graph data.
//!
//! Must work on any host platform (macOS, Windows, Linux) for cross-compilation.

use core::mem::size_of;
#[cfg(any(target_os = "linux", target_os = "android"))]
use core::sync::atomic::{AtomicU8, Ordering};

#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_core::env_var;
use bun_core::{slice_to_nul, strings};

use crate::{align_up, read_struct, write_struct};

bun_core::declare_scope!(elf, visible);

#[derive(Debug, thiserror::Error, strum::IntoStaticStr)]
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
}

bun_core::named_error_set!(ElfError);

pub struct ElfFile {
    pub data: Vec<u8>,
}

impl ElfFile {
    pub fn init(data: Vec<u8>) -> Result<Box<ElfFile>, ElfError> {
        validate_elf64_le(&data)?;
        Ok(Box::new(ElfFile { data }))
    }

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
            if interp_offset + interp_filesz > self.data.len() {
                return;
            }

            // PORT NOTE: reshaped for borrowck — compute replacement under an
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
        // PORT NOTE: reshaped for borrowck — copy strtab bounds out so we can
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

    pub fn write_bun_section(&mut self, payload: &[u8]) -> Result<(), ElfError> {
        let ehdr = read_ehdr(&self.data);
        let bun_section = self.find_bun_section(ehdr)?;
        let bun_section_offset = bun_section.file_offset;
        let page_size = Self::page_size(ehdr);

        let header_size: u64 = size_of::<u64>() as u64;
        let new_content_size: u64 = header_size + payload.len() as u64;
        let aligned_new_size = align_up(new_content_size, page_size);

        let phdr_size = size_of::<Elf64_Phdr>();
        let mut rw_phdr_index: Option<usize> = None;
        let mut rw_phdr: Elf64_Phdr = Elf64_Phdr::ZEROED;
        let mut max_vaddr_end: u64 = 0;
        for i in 0..ehdr.e_phnum as usize {
            let phdr_offset = usize::try_from(ehdr.e_phoff).expect("int cast") + i * phdr_size;
            let phdr: Elf64_Phdr = read_struct(&self.data[phdr_offset..][..phdr_size]);
            if phdr.p_type != PT_LOAD {
                continue;
            }

            let vaddr_end = phdr.p_vaddr + phdr.p_memsz;
            if vaddr_end > max_vaddr_end {
                max_vaddr_end = vaddr_end;
            }

            if (phdr.p_flags & PF_W) != 0 && rw_phdr_index.is_none() {
                rw_phdr_index = Some(i);
                rw_phdr = phdr;
            }
        }

        let Some(rw_index) = rw_phdr_index else {
            return Err(ElfError::NoWritableLoadSegment);
        };

        let new_vaddr = align_up(max_vaddr_end, page_size);
        let offset_in_segment = new_vaddr - rw_phdr.p_vaddr;
        let new_file_offset = rw_phdr.p_offset + offset_in_segment;

        if new_vaddr < rw_phdr.p_vaddr + rw_phdr.p_memsz {
            return Err(ElfError::NewVaddrCollides);
        }

        let old_rw_file_end = rw_phdr.p_offset + rw_phdr.p_filesz;
        let old_file_size: u64 = self.data.len() as u64;
        if old_rw_file_end > old_file_size {
            return Err(ElfError::InvalidElfFile);
        }

        let move_src_start: u64 = old_rw_file_end;
        let move_src_end: u64 = old_file_size;
        let moved_tail_size: u64 = move_src_end - move_src_start;
        let move_dst_start: u64 = new_file_offset + aligned_new_size;
        let move_dst_end: u64 = move_dst_start + moved_tail_size;

        let total_new_size: u64 = move_dst_end;

        // PERF(port): Zig used ensureTotalCapacity + raw len bump leaving the
        // new region uninitialized; resize() zero-fills. The explicit @memset
        // calls below become partially redundant but stay for parity.
        let total_new_size_usz = usize::try_from(total_new_size).expect("int cast");
        self.data
            .reserve(total_new_size_usz.saturating_sub(self.data.len()));
        self.data.resize(total_new_size_usz, 0);

        if moved_tail_size != 0 {
            self.data.copy_within(
                usize::try_from(move_src_start).expect("int cast")
                    ..usize::try_from(move_src_end).expect("int cast"),
                usize::try_from(move_dst_start).expect("int cast"),
            );
        }

        // Zero the bytes between the old RW file-content end and the payload
        // start. This entire range is now inside the extended PT_LOAD's
        // file-backed region; keeping it zero preserves BSS semantics.
        self.data[usize::try_from(move_src_start).expect("int cast")
            ..usize::try_from(new_file_offset).expect("int cast")]
            .fill(0);

        // Write the payload at the new location: [u64 LE size][data][zero padding]
        write_u64_le(
            &mut self.data[usize::try_from(new_file_offset).expect("int cast")..][..8],
            payload.len() as u64,
        );
        self.data[usize::try_from(new_file_offset + header_size).expect("int cast")..]
            [..payload.len()]
            .copy_from_slice(payload);

        // Zero the padding between payload end and the relocated tail
        let payload_end = new_file_offset + new_content_size;
        if move_dst_start > payload_end {
            self.data[usize::try_from(payload_end).expect("int cast")
                ..usize::try_from(move_dst_start).expect("int cast")]
                .fill(0);
        }

        write_u64_le(
            &mut self.data[usize::try_from(bun_section_offset).expect("int cast")..][..8],
            new_vaddr,
        );

        let old_shdr_offset: u64 = ehdr.e_shoff;
        let shdr_table_size = ehdr.e_shnum as u64 * size_of::<Elf64_Shdr>() as u64;
        if old_shdr_offset < move_src_start || old_shdr_offset + shdr_table_size > move_src_end {
            return Err(ElfError::InvalidElfFile);
        }
        let new_shdr_offset: u64 = old_shdr_offset + (move_dst_start - move_src_start);
        self.write_ehdr_shoff(new_shdr_offset);

        let shnum = ehdr.e_shnum;
        for i in 0..shnum as usize {
            let shdr_file_offset: u64 = new_shdr_offset + i as u64 * size_of::<Elf64_Shdr>() as u64;
            let shdr_file_offset_usz = usize::try_from(shdr_file_offset).expect("int cast");
            let mut shdr: Elf64_Shdr =
                read_struct(&self.data[shdr_file_offset_usz..][..size_of::<Elf64_Shdr>()]);

            if i == bun_section.section_index as usize {
                shdr.sh_offset = new_file_offset;
                shdr.sh_size = new_content_size;
                shdr.sh_addr = new_vaddr;
            } else if shdr.sh_type != SHT_NOBITS
                && shdr.sh_offset >= move_src_start
                && shdr.sh_offset < move_src_end
            {
                shdr.sh_offset += move_dst_start - move_src_start;
            }

            write_struct(
                &mut self.data[shdr_file_offset_usz..][..size_of::<Elf64_Shdr>()],
                &shdr,
            );
        }

        {
            let new_segment_size = offset_in_segment + aligned_new_size;
            let extended = Elf64_Phdr {
                p_type: rw_phdr.p_type,
                p_flags: rw_phdr.p_flags,
                p_offset: rw_phdr.p_offset,
                p_vaddr: rw_phdr.p_vaddr,
                p_paddr: rw_phdr.p_paddr,
                p_filesz: new_segment_size,
                p_memsz: new_segment_size,
                p_align: rw_phdr.p_align,
            };
            let phdr_offset =
                usize::try_from(ehdr.e_phoff).expect("int cast") + rw_index * phdr_size;
            write_struct(&mut self.data[phdr_offset..][..phdr_size], &extended);
        }

        Ok(())
    }

    pub fn write(&self, writer: &mut impl std::io::Write) -> Result<(), bun_core::Error> {
        // PORT NOTE: Zig used `writer: anytype` (`std.Io.Writer`); std::io::Write
        // is the canonical Rust equivalent. bun_io has no Write trait.
        writer.write_all(&self.data)?;
        Ok(())
    }

    // --- Internal helpers ---

    /// Returns the file offset and section index of the `.bun` section.
    fn find_bun_section(&self, ehdr: Elf64_Ehdr) -> Result<BunSectionInfo, ElfError> {
        let shdr_size = size_of::<Elf64_Shdr>();
        let shdr_table_offset = ehdr.e_shoff;
        let shnum = ehdr.e_shnum;

        if shnum == 0 {
            return Err(ElfError::BunSectionNotFound);
        }
        if shdr_table_offset + shnum as u64 * shdr_size as u64 > self.data.len() as u64 {
            return Err(ElfError::InvalidElfFile);
        }

        // Read the .shstrtab section to get section names
        let shstrtab_shdr = self.read_shdr(shdr_table_offset, ehdr.e_shstrndx);
        let strtab_offset = shstrtab_shdr.sh_offset;
        let strtab_size = shstrtab_shdr.sh_size;

        if strtab_offset + strtab_size > self.data.len() as u64 {
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
                if name == b".bun" {
                    return Ok(BunSectionInfo {
                        file_offset: shdr.sh_offset,
                        section_index: u16::try_from(i).expect("int cast"),
                    });
                }
            }
        }

        Err(ElfError::BunSectionNotFound)
    }

    fn read_shdr(&self, table_offset: u64, index: u16) -> Elf64_Shdr {
        let offset = table_offset + index as u64 * size_of::<Elf64_Shdr>() as u64;
        read_struct(
            &self.data[usize::try_from(offset).expect("int cast")..][..size_of::<Elf64_Shdr>()],
        )
    }

    fn write_ehdr_shoff(&mut self, new_shoff: u64) {
        // e_shoff is at offset 40 in Elf64_Ehdr
        write_u64_le(&mut self.data[40..][..8], new_shoff);
    }

    fn page_size(ehdr: Elf64_Ehdr) -> u64 {
        match ehdr.e_machine {
            EM_AARCH64 | EM_PPC64 => 0x10000, // 64KB
            _ => 0x1000,                      // 4KB
        }
    }
}

// `deinit` in Zig only freed `data` and destroyed `self` — both handled by
// `Drop` on `Vec<u8>` / `Box<ElfFile>`. No explicit `Drop` impl needed.

struct BunSectionInfo {
    /// File offset of the .bun section's data (sh_offset).
    file_offset: u64,
    /// Index of the .bun section in the section header table.
    section_index: u16,
}

const INTERP_MAP: [(&[u8], &[u8]); 4] = [
    (b"ld-linux-x86-64.so.2", b"/lib64/ld-linux-x86-64.so.2"),
    (b"ld-linux-aarch64.so.1", b"/lib/ld-linux-aarch64.so.1"),
    (b"ld-musl-x86_64.so.1", b"/lib/ld-musl-x86_64.so.1"),
    (b"ld-musl-aarch64.so.1", b"/lib/ld-musl-aarch64.so.1"),
];

fn read_ehdr(data: &[u8]) -> Elf64_Ehdr {
    read_struct(&data[..size_of::<Elf64_Ehdr>()])
}

fn validate_elf64_le(data: &[u8]) -> Result<(), ElfError> {
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

fn host_uses_nix_store_interpreter() -> bool {
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        return false;
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        static COMPUTED: AtomicU8 = AtomicU8::new(0); // 0 unknown, 1 no, 2 yes

        fn check() -> bool {
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
            // PORT NOTE: close moved up; fd not needed after read (was `defer fd.close()`).
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
                if interp_off + interp_sz > data.len() {
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

// --- ELF definitions (from Zig std.elf; defined locally for cross-platform use) ---
// TODO(port): consider moving to a shared bun_exe_format::elf_defs module.

const EI_CLASS: usize = 4;
const EI_DATA: usize = 5;
const ELFCLASS64: u8 = 2;
const ELFDATA2LSB: u8 = 1;

use bun_sys::elf::{PT_INTERP, PT_LOAD};
const PF_W: u32 = 2;
const SHT_NOBITS: u32 = 8;

const EM_PPC64: u16 = 21;
const EM_AARCH64: u16 = 183;

#[repr(C)]
#[derive(Clone, Copy)]
#[allow(non_camel_case_types, non_snake_case)]
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
#[allow(non_camel_case_types, non_snake_case)]
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
    const ZEROED: Self = Self {
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
#[allow(non_camel_case_types, non_snake_case)]
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

// --- byte helpers (Zig std.mem.writeInt) ---

#[inline]
fn write_u64_le(bytes: &mut [u8], value: u64) {
    bytes[..8].copy_from_slice(&value.to_le_bytes());
}

// ported from: src/exe_format/elf.zig
