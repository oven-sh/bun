//! ELF file manipulation for `bun build --compile` on Linux.
//!
//! Analogous to `macho.rs` (macOS) and `pe.rs` (Windows).
//! Finds the `.bun` ELF section (placed by a linker symbol in c-bindings.cpp)
//! and expands it to hold the standalone module graph data.
//!
//! Must work on any host platform (macOS, Windows, Linux) for cross-compilation.

use core::mem::size_of;
use core::sync::atomic::{AtomicU8, Ordering};

use bun_core::env_var;
use bun_str::strings;

bun_output::declare_scope!(elf, visible);

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

impl From<ElfError> for bun_core::Error {
    fn from(e: ElfError) -> Self {
        bun_core::Error::from_static_str(<&'static str>::from(e))
        // TODO(port): confirm bun_core::Error construction API
    }
}

pub struct ElfFile {
    pub data: Vec<u8>,
}

impl ElfFile {
    pub fn init(elf_data: &[u8]) -> Result<Box<ElfFile>, ElfError> {
        if elf_data.len() < size_of::<Elf64_Ehdr>() {
            return Err(ElfError::InvalidElfFile);
        }

        let ehdr = read_ehdr(elf_data);

        // Validate ELF magic
        if &ehdr.e_ident[0..4] != b"\x7fELF" {
            return Err(ElfError::InvalidElfFile);
        }

        // Must be 64-bit
        if ehdr.e_ident[EI_CLASS] != ELFCLASS64 {
            return Err(ElfError::Not64Bit);
        }

        // Must be little-endian (bun only supports x64 + arm64, both LE)
        if ehdr.e_ident[EI_DATA] != ELFDATA2LSB {
            return Err(ElfError::NotLittleEndian);
        }

        let mut data = Vec::with_capacity(elf_data.len());
        data.extend_from_slice(elf_data);

        Ok(Box::new(ElfFile { data }))
    }

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
        let phdr_table_end = (ehdr.e_phoff as u64)
            .saturating_add((ehdr.e_phnum as u64).saturating_mul(phdr_size as u64));
        if phdr_table_end > self.data.len() as u64 {
            return;
        }

        for i in 0..ehdr.e_phnum as usize {
            let phdr_offset = usize::try_from(ehdr.e_phoff).unwrap() + i * phdr_size;
            let phdr: Elf64_Phdr = read_struct(&self.data[phdr_offset..][..phdr_size]);
            if phdr.p_type != PT_INTERP {
                continue;
            }

            let interp_offset = usize::try_from(phdr.p_offset).unwrap();
            let interp_filesz = usize::try_from(phdr.p_filesz).unwrap();
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

                bun_output::scoped_log!(
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
        let strtab_off = usize::try_from(strtab_shdr.sh_offset).unwrap();
        let strtab_len = usize::try_from(strtab_shdr.sh_size).unwrap();

        for i in 0..shnum as usize {
            let shdr = self.read_shdr(ehdr.e_shoff, u16::try_from(i).unwrap());
            if shdr.sh_name as usize >= strtab_len {
                continue;
            }
            let strtab = &self.data[strtab_off..][..strtab_len];
            let name = slice_to_nul(&strtab[shdr.sh_name as usize..]);
            if name != b".interp" {
                continue;
            }

            // sh_size @ +32 in Elf64_Shdr
            let shdr_offset = usize::try_from(ehdr.e_shoff).unwrap() + i * shdr_size;
            write_u64_le(&mut self.data[shdr_offset + 32..][..8], new_size);
            return;
        }
    }

    /// Find the `.bun` section and write `payload` so the kernel `mmap`s it at
    /// exec time alongside the rest of the binary. Stores the data's vaddr at
    /// the original BUN_COMPILED location so the runtime can dereference it
    /// directly.
    ///
    /// We extend the existing writable `PT_LOAD` to cover the appended payload
    /// rather than creating a new segment (by repurposing `PT_GNU_STACK`).
    /// Earlier versions added a late `PT_LOAD`; WSL1's kernel ELF loader
    /// rejects that shape with `ENOEXEC` at `execve` time before anything in
    /// the binary runs (#29963). Growing an already-valid `PT_LOAD` — the shape
    /// a linker would natively produce — keeps compiled binaries loadable on
    /// WSL1 while preserving the mmap-at-execve contract (no file I/O at
    /// startup, works with execute-only permissions).
    ///
    /// We always append rather than writing in-place because `.bun` is in the
    /// middle of a `PT_LOAD` segment — sections like `.dynamic`, `.got`,
    /// `.got.plt` come after it, and expanding in-place would invalidate their
    /// absolute virtual addresses.
    pub fn write_bun_section(&mut self, payload: &[u8]) -> Result<(), ElfError> {
        let ehdr = read_ehdr(&self.data);
        let bun_section = self.find_bun_section(ehdr)?;
        let bun_section_offset = bun_section.file_offset;
        let page_size = Self::page_size(ehdr);

        let header_size: u64 = size_of::<u64>() as u64;
        let new_content_size: u64 = header_size + payload.len() as u64;
        let aligned_new_size = align_up(new_content_size, page_size);

        // Locate the writable PT_LOAD we'll extend. .bun lives in this
        // segment already (BlobHeader is `aligned(16K)` + PROGBITS with WA
        // flags). Growing an existing PT_LOAD is the layout a linker would
        // naturally produce; WSL1's kernel loader rejects binaries that
        // instead add a late PT_LOAD by repurposing PT_GNU_STACK (#29963).
        let phdr_size = size_of::<Elf64_Phdr>();
        let mut rw_phdr_index: Option<usize> = None;
        let mut rw_phdr: Elf64_Phdr = Elf64_Phdr::ZEROED;
        let mut max_vaddr_end: u64 = 0;
        for i in 0..ehdr.e_phnum as usize {
            let phdr_offset = usize::try_from(ehdr.e_phoff).unwrap() + i * phdr_size;
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

        // Place the new data at a page-aligned virtual address past every
        // existing mapping. page_size is ≥ 128 so this also guarantees the
        // 128-byte alignment that JSC's bytecode cache requires — see
        // `target_mod = 120` in StandaloneModuleGraph.zig, which assumes the
        // payload starts on a 128-byte boundary so bytecode at payload-offset
        // 120 lands 128-aligned once the 8-byte `[u64 size]` header is
        // accounted for. A non-page-aligned `new_vaddr` (e.g. one inheriting
        // `rw_phdr.p_vaddr`'s residue mod 128) would SIGSEGV in JSC bytecode
        // deserialization on aarch64.
        //
        // `new_file_offset` follows the segment's existing (vaddr - offset)
        // delta, so the kernel's mmap at `rw_phdr.p_offset → rw_phdr.p_vaddr`
        // covers our new payload continuously once we grow p_filesz.
        let new_vaddr = align_up(max_vaddr_end, page_size);
        let offset_in_segment = new_vaddr - rw_phdr.p_vaddr;
        let new_file_offset = rw_phdr.p_offset + offset_in_segment;

        // Sanity: `max_vaddr_end` already reflects the RW segment's full
        // memsz range (the loop above folds every PT_LOAD), so new_vaddr is
        // past it by construction. This guard catches pathological inputs
        // (e.g. corrupt ELF with rw_phdr.p_vaddr past max_vaddr_end).
        if new_vaddr < rw_phdr.p_vaddr + rw_phdr.p_memsz {
            return Err(ElfError::NewVaddrCollides);
        }

        // File layout after this function returns:
        //
        //   [0, old_rw_file_end)                      original content, unchanged
        //                                             (RW segment's file-backed bytes)
        //   [old_rw_file_end, new_file_offset)        zero fill
        //                                             (becomes file-backed inside the
        //                                              extended RW PT_LOAD; must read as
        //                                              zero to keep BSS semantics)
        //   [new_file_offset, +aligned_new_size)      [u64 LE size][payload][zero pad]
        //                                             (new .bun contents — vaddr = new_vaddr)
        //   [payload_end, +moved_tail_size)           relocated non-ALLOC sections + old
        //                                             section header table
        //
        // Anything past `old_rw_file_end` in the input — non-ALLOC sections
        // like `.comment`, `.symtab`, `.strtab`, `.shstrtab`, debug info,
        // plus the section header table — has to be moved out of the way
        // because that file range now lives inside the extended RW PT_LOAD.
        // Leaving it in place would mmap it into what was previously BSS
        // (zero-initialized statics), corrupting the process.
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
        let total_new_size_usz = usize::try_from(total_new_size).unwrap();
        self.data
            .reserve(total_new_size_usz.saturating_sub(self.data.len()));
        self.data.resize(total_new_size_usz, 0);

        // Relocate the tail (non-ALLOC sections + old shdr table) past the
        // payload. Do this BEFORE zero-filling and writing the payload — if
        // `new_file_offset < old_file_size` (debug binaries with hundreds of
        // MB of debug info past the RW segment), the destination overlaps
        // the source, so memmove is required.
        if moved_tail_size != 0 {
            self.data.copy_within(
                usize::try_from(move_src_start).unwrap()..usize::try_from(move_src_end).unwrap(),
                usize::try_from(move_dst_start).unwrap(),
            );
        }

        // Zero the bytes between the old RW file-content end and the payload
        // start. This entire range is now inside the extended PT_LOAD's
        // file-backed region; keeping it zero preserves BSS semantics.
        self.data[usize::try_from(move_src_start).unwrap()..usize::try_from(new_file_offset).unwrap()].fill(0);

        // Write the payload at the new location: [u64 LE size][data][zero padding]
        write_u64_le(
            &mut self.data[usize::try_from(new_file_offset).unwrap()..][..8],
            payload.len() as u64,
        );
        self.data[usize::try_from(new_file_offset + header_size).unwrap()..][..payload.len()]
            .copy_from_slice(payload);

        // Zero the padding between payload end and the relocated tail
        let payload_end = new_file_offset + new_content_size;
        if move_dst_start > payload_end {
            self.data[usize::try_from(payload_end).unwrap()..usize::try_from(move_dst_start).unwrap()].fill(0);
        }

        // Write the vaddr of the appended data at the ORIGINAL .bun section location
        // (where BUN_COMPILED symbol points). At runtime, BUN_COMPILED.size will be
        // this vaddr (always non-zero), which the runtime dereferences as a pointer.
        // Non-standalone binaries have BUN_COMPILED.size = 0, so 0 means "no data".
        write_u64_le(
            &mut self.data[usize::try_from(bun_section_offset).unwrap()..][..8],
            new_vaddr,
        );

        // Update every section header whose sh_offset pointed into the moved
        // tail so tools like `readelf -S`, `objdump`, and `gdb` still find
        // the right bytes. Special-case the .bun header — it moves to the
        // payload's new position, not to the shifted tail.
        //
        // The section header table itself is part of the moved tail, so we
        // compute its new location from e_shoff's old value.
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
            let shdr_file_offset_usz = usize::try_from(shdr_file_offset).unwrap();
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

        // Extend the existing writable PT_LOAD to cover the appended payload.
        // Keep p_offset/p_vaddr/p_paddr/p_align unchanged; only grow filesz
        // and memsz. Equal values are fine — the extension is entirely
        // file-backed (no new BSS gap).
        //
        // PT_GNU_STACK is deliberately left alone; repurposing it into a
        // separate late PT_LOAD is what breaks WSL1 (#29963).
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
            let phdr_offset = usize::try_from(ehdr.e_phoff).unwrap() + rw_index * phdr_size;
            write_struct(&mut self.data[phdr_offset..][..phdr_size], &extended);
        }

        Ok(())
    }

    pub fn write(&self, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
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
        let strtab = &self.data[usize::try_from(strtab_offset).unwrap()..][..usize::try_from(strtab_size).unwrap()];

        // Search for .bun section
        for i in 0..shnum as usize {
            let shdr = self.read_shdr(shdr_table_offset, u16::try_from(i).unwrap());
            let name_offset = shdr.sh_name;

            if (name_offset as usize) < strtab.len() {
                let name = slice_to_nul(&strtab[name_offset as usize..]);
                if name == b".bun" {
                    return Ok(BunSectionInfo {
                        file_offset: shdr.sh_offset,
                        section_index: u16::try_from(i).unwrap(),
                    });
                }
            }
        }

        Err(ElfError::BunSectionNotFound)
    }

    fn read_shdr(&self, table_offset: u64, index: u16) -> Elf64_Shdr {
        let offset = table_offset + index as u64 * size_of::<Elf64_Shdr>() as u64;
        read_struct(&self.data[usize::try_from(offset).unwrap()..][..size_of::<Elf64_Shdr>()])
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

fn align_up(value: u64, alignment: u64) -> u64 {
    if alignment == 0 {
        return value;
    }
    let mask = alignment - 1;
    (value + mask) & !mask
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
    #[cfg(not(target_os = "linux"))]
    {
        return false;
    }

    #[cfg(target_os = "linux")]
    {
        static COMPUTED: AtomicU8 = AtomicU8::new(0); // 0 unknown, 1 no, 2 yes

        fn check() -> bool {
            // Test-only override: lets #29290's regression test force the
            // Nix-host branch without mutating `/etc/NIXOS` on the shared
            // rootfs (which would poison concurrent test workers).
            if env_var::BUN_DEBUG_FORCE_NIX_HOST.get() {
                return true;
            }
            if self_interp_is_nix_store() {
                return true;
            }
            // Canonical NixOS marker — present even when bun itself was not
            // installed via Nix (statically-linked bun, downloaded tarball).
            if bun_sys::exists(b"/etc/NIXOS") {
                return true;
            }
            // Guix equivalent.
            if bun_sys::directory_exists_at(bun_sys::Fd::cwd(), b"/gnu/store").unwrap_or(false) {
                return true;
            }
            false
        }

        fn self_interp_is_nix_store() -> bool {
            // 4 KiB is enough: PT_INTERP on a glibc-linked binary points into
            // the first page. Read just the leading bytes to avoid slurping
            // the whole bun binary.
            let mut buf = [0u8; 4096];
            let fd = match bun_sys::open(b"/proc/self/exe", bun_sys::O::RDONLY, 0) {
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
            if n < size_of::<Elf64_Ehdr>() {
                return false;
            }
            let data = &buf[..n];

            if &data[0..4] != b"\x7fELF" {
                return false;
            }
            if data[EI_CLASS] != ELFCLASS64 {
                return false;
            }
            if data[EI_DATA] != ELFDATA2LSB {
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
                let off = usize::try_from(ehdr.e_phoff).unwrap() + i * phdr_size;
                let phdr: Elf64_Phdr = read_struct(&data[off..][..phdr_size]);
                if phdr.p_type != PT_INTERP {
                    continue;
                }

                let interp_off = usize::try_from(phdr.p_offset).unwrap();
                let interp_sz = usize::try_from(phdr.p_filesz).unwrap();
                if interp_off + interp_sz > data.len() {
                    return false;
                }

                let interp = slice_to_nul(&data[interp_off..][..interp_sz]);
                return interp.starts_with(b"/nix/store/")
                    || interp.starts_with(b"/gnu/store/");
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

const PT_LOAD: u32 = 1;
const PT_INTERP: u32 = 3;
const PF_W: u32 = 2;
const SHT_NOBITS: u32 = 8;

const EM_PPC64: u16 = 21;
const EM_AARCH64: u16 = 183;

#[repr(C)]
#[derive(Clone, Copy)]
#[allow(non_camel_case_types, non_snake_case)]
pub struct Elf64_Ehdr {
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
pub struct Elf64_Phdr {
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
pub struct Elf64_Shdr {
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

// --- byte helpers (Zig std.mem.bytesAsValue / asBytes / writeInt) ---

#[inline]
fn read_struct<T: Copy>(bytes: &[u8]) -> T {
    debug_assert!(bytes.len() >= size_of::<T>());
    // SAFETY: T is #[repr(C)] POD (Elf64_* headers); all bit patterns are
    // valid; bytes.len() >= size_of::<T>() asserted above. read_unaligned
    // tolerates arbitrary alignment of the source slice.
    unsafe { core::ptr::read_unaligned(bytes.as_ptr() as *const T) }
}

#[inline]
fn write_struct<T: Copy>(bytes: &mut [u8], value: &T) {
    debug_assert!(bytes.len() >= size_of::<T>());
    // SAFETY: T is #[repr(C)] POD; bytes.len() >= size_of::<T>() asserted
    // above; write_unaligned tolerates arbitrary alignment of dest.
    unsafe { core::ptr::write_unaligned(bytes.as_mut_ptr() as *mut T, *value) }
}

#[inline]
fn write_u64_le(bytes: &mut [u8], value: u64) {
    bytes[..8].copy_from_slice(&value.to_le_bytes());
}

#[inline]
fn slice_to_nul(buf: &[u8]) -> &[u8] {
    match buf.iter().position(|&b| b == 0) {
        Some(i) => &buf[..i],
        None => buf,
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/exe_format/elf.zig (534 lines)
//   confidence: medium-high
//   todos:      3
//   notes:      ELF structs/consts defined locally (Zig used std.elf); bun_sys/bun_io/env_var APIs assumed; borrowck reshapes in normalize_interpreter/update_interp_section_size; u64→usize narrowing uses checked try_from
// ──────────────────────────────────────────────────────────────────────────
