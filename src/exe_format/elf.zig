/// ELF file manipulation for `bun build --compile` on Linux.
///
/// Analogous to `macho.zig` (macOS) and `pe.zig` (Windows).
/// Finds the `.bun` ELF section (placed by a linker symbol in c-bindings.cpp)
/// and expands it to hold the standalone module graph data.
///
/// Must work on any host platform (macOS, Windows, Linux) for cross-compilation.
pub const ElfFile = struct {
    data: std.array_list.Managed(u8),
    allocator: Allocator,

    pub fn init(allocator: Allocator, elf_data: []const u8) !*ElfFile {
        if (elf_data.len < @sizeOf(Elf64_Ehdr)) return error.InvalidElfFile;

        const ehdr = readEhdr(elf_data);

        // Validate ELF magic
        if (!bun.strings.eqlComptime(ehdr.e_ident[0..4], "\x7fELF")) return error.InvalidElfFile;

        // Must be 64-bit
        if (ehdr.e_ident[elf.EI_CLASS] != elf.ELFCLASS64) return error.Not64Bit;

        // Must be little-endian (bun only supports x64 + arm64, both LE)
        if (ehdr.e_ident[elf.EI_DATA] != elf.ELFDATA2LSB) return error.NotLittleEndian;

        var data = try std.array_list.Managed(u8).initCapacity(allocator, elf_data.len);
        errdefer data.deinit();
        try data.appendSlice(elf_data);

        const self = try allocator.create(ElfFile);
        errdefer allocator.destroy(self);

        self.* = .{
            .data = data,
            .allocator = allocator,
        };

        return self;
    }

    pub fn deinit(self: *ElfFile) void {
        self.data.deinit();
        self.allocator.destroy(self);
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
    pub fn normalizeInterpreter(self: *ElfFile) void {
        // Don't rewrite on Nix/Guix hosts — the FHS path is a stub loader there.
        if (hostUsesNixStoreInterpreter()) return;

        const ehdr = readEhdr(self.data.items);
        const phdr_size = @sizeOf(Elf64_Phdr);

        // Bounds-check the program header table up-front; --compile-executable-path
        // accepts arbitrary files, so a corrupt e_phoff/e_phnum must not panic.
        const phdr_table_end = @as(u64, ehdr.e_phoff) +| @as(u64, ehdr.e_phnum) *| @as(u64, phdr_size);
        if (phdr_table_end > self.data.items.len) return;

        for (0..ehdr.e_phnum) |i| {
            const phdr_offset = @as(usize, @intCast(ehdr.e_phoff)) + i * phdr_size;
            const phdr = std.mem.bytesAsValue(Elf64_Phdr, self.data.items[phdr_offset..][0..phdr_size]).*;
            if (phdr.p_type != elf.PT_INTERP) continue;

            const interp_offset: usize = @intCast(phdr.p_offset);
            const interp_filesz: usize = @intCast(phdr.p_filesz);
            if (interp_offset + interp_filesz > self.data.items.len) return;

            const interp_region = self.data.items[interp_offset..][0..interp_filesz];
            const current = std.mem.sliceTo(interp_region, 0);

            if (!bun.strings.hasPrefixComptime(current, "/nix/store/") and
                !bun.strings.hasPrefixComptime(current, "/gnu/store/"))
            {
                return;
            }

            const last_slash = std.mem.lastIndexOfScalar(u8, current, '/') orelse return;
            const basename = current[last_slash + 1 ..];

            const replacement: []const u8 = inline for (interp_map) |entry| {
                if (bun.strings.eqlComptime(basename, entry[0])) break entry[1];
            } else return;

            // FHS path + NUL must fit in the existing segment (always true for
            // store paths: 32-char hash + pname + "/lib/" alone exceeds any FHS path).
            if (replacement.len + 1 > interp_filesz) return;

            log("rewriting PT_INTERP {s} -> {s}", .{ current, replacement });

            @memcpy(interp_region[0..replacement.len], replacement);
            @memset(interp_region[replacement.len..], 0);

            const new_size: u64 = replacement.len + 1;
            // p_filesz @ +32, p_memsz @ +40 in Elf64_Phdr
            std.mem.writeInt(u64, self.data.items[phdr_offset + 32 ..][0..8], new_size, .little);
            std.mem.writeInt(u64, self.data.items[phdr_offset + 40 ..][0..8], new_size, .little);

            self.updateInterpSectionSize(ehdr, new_size);
            return;
        }
    }

    /// Best-effort: keep the `.interp` section header's `sh_size` consistent with
    /// the rewritten PT_INTERP so `readelf -S` shows accurate metadata. The kernel
    /// only consults PT_INTERP, so any failure here is silently ignored.
    fn updateInterpSectionSize(self: *ElfFile, ehdr: Elf64_Ehdr, new_size: u64) void {
        const shdr_size = @sizeOf(Elf64_Shdr);
        const shnum = ehdr.e_shnum;
        if (shnum == 0 or ehdr.e_shstrndx >= shnum) return;

        const shdr_table_end = @as(u64, ehdr.e_shoff) +| @as(u64, shnum) *| @as(u64, shdr_size);
        if (shdr_table_end > self.data.items.len) return;

        const strtab_shdr = self.readShdr(ehdr.e_shoff, ehdr.e_shstrndx);
        const strtab_end = strtab_shdr.sh_offset +| strtab_shdr.sh_size;
        if (strtab_end > self.data.items.len) return;
        const strtab = self.data.items[@intCast(strtab_shdr.sh_offset)..][0..@intCast(strtab_shdr.sh_size)];

        for (0..shnum) |i| {
            const shdr = self.readShdr(ehdr.e_shoff, @intCast(i));
            if (shdr.sh_name >= strtab.len) continue;
            const name = std.mem.sliceTo(strtab[shdr.sh_name..], 0);
            if (!bun.strings.eqlComptime(name, ".interp")) continue;

            // sh_size @ +32 in Elf64_Shdr
            const shdr_offset = @as(usize, @intCast(ehdr.e_shoff)) + i * shdr_size;
            std.mem.writeInt(u64, self.data.items[shdr_offset + 32 ..][0..8], new_size, .little);
            return;
        }
    }

    const interp_map = .{
        .{ "ld-linux-x86-64.so.2", "/lib64/ld-linux-x86-64.so.2" },
        .{ "ld-linux-aarch64.so.1", "/lib/ld-linux-aarch64.so.1" },
        .{ "ld-musl-x86_64.so.1", "/lib/ld-musl-x86_64.so.1" },
        .{ "ld-musl-aarch64.so.1", "/lib/ld-musl-aarch64.so.1" },
    };

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
    pub fn writeBunSection(self: *ElfFile, payload: []const u8) !void {
        const ehdr = readEhdr(self.data.items);
        const bun_section = try self.findBunSection(ehdr);
        const bun_section_offset = bun_section.file_offset;
        const page_size = pageSize(ehdr);

        const header_size: u64 = @sizeOf(u64);
        const new_content_size: u64 = header_size + payload.len;
        const aligned_new_size = alignUp(new_content_size, page_size);

        // Locate the writable PT_LOAD we'll extend. .bun lives in this
        // segment already (BlobHeader is `aligned(16K)` + PROGBITS with WA
        // flags). Growing an existing PT_LOAD is the layout a linker would
        // naturally produce; WSL1's kernel loader rejects binaries that
        // instead add a late PT_LOAD by repurposing PT_GNU_STACK (#29963).
        const phdr_size = @sizeOf(Elf64_Phdr);
        var rw_phdr_index: ?usize = null;
        var rw_phdr: Elf64_Phdr = undefined;
        var max_vaddr_end: u64 = 0;
        for (0..ehdr.e_phnum) |i| {
            const phdr_offset = @as(usize, @intCast(ehdr.e_phoff)) + i * phdr_size;
            const phdr = std.mem.bytesAsValue(Elf64_Phdr, self.data.items[phdr_offset..][0..phdr_size]).*;
            if (phdr.p_type != elf.PT_LOAD) continue;

            const vaddr_end = phdr.p_vaddr + phdr.p_memsz;
            if (vaddr_end > max_vaddr_end) max_vaddr_end = vaddr_end;

            if ((phdr.p_flags & elf.PF_W) != 0 and rw_phdr_index == null) {
                rw_phdr_index = i;
                rw_phdr = phdr;
            }
        }

        const rw_index = rw_phdr_index orelse return error.NoWritableLoadSegment;

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
        const new_vaddr = alignUp(max_vaddr_end, page_size);
        const offset_in_segment = new_vaddr - rw_phdr.p_vaddr;
        const new_file_offset = rw_phdr.p_offset + offset_in_segment;

        // Sanity: `max_vaddr_end` already reflects the RW segment's full
        // memsz range (the loop above folds every PT_LOAD), so new_vaddr is
        // past it by construction. This guard catches pathological inputs
        // (e.g. corrupt ELF with rw_phdr.p_vaddr past max_vaddr_end).
        if (new_vaddr < rw_phdr.p_vaddr + rw_phdr.p_memsz) return error.NewVaddrCollides;

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
        const old_rw_file_end = rw_phdr.p_offset + rw_phdr.p_filesz;
        const old_file_size: u64 = self.data.items.len;
        if (old_rw_file_end > old_file_size) return error.InvalidElfFile;

        const move_src_start: u64 = old_rw_file_end;
        const move_src_end: u64 = old_file_size;
        const moved_tail_size: u64 = move_src_end - move_src_start;
        const move_dst_start: u64 = new_file_offset + aligned_new_size;
        const move_dst_end: u64 = move_dst_start + moved_tail_size;

        const total_new_size: u64 = move_dst_end;

        try self.data.ensureTotalCapacity(total_new_size);
        self.data.items.len = total_new_size;

        // Relocate the tail (non-ALLOC sections + old shdr table) past the
        // payload. Do this BEFORE zero-filling and writing the payload — if
        // `new_file_offset < old_file_size` (debug binaries with hundreds of
        // MB of debug info past the RW segment), the destination overlaps
        // the source, so memmove is required.
        if (moved_tail_size != 0) {
            bun.memmove(
                self.data.items[move_dst_start..move_dst_end],
                self.data.items[move_src_start..move_src_end],
            );
        }

        // Zero the bytes between the old RW file-content end and the payload
        // start. This entire range is now inside the extended PT_LOAD's
        // file-backed region; keeping it zero preserves BSS semantics.
        @memset(self.data.items[move_src_start..new_file_offset], 0);

        // Write the payload at the new location: [u64 LE size][data][zero padding]
        std.mem.writeInt(u64, self.data.items[new_file_offset..][0..8], @intCast(payload.len), .little);
        @memcpy(self.data.items[new_file_offset + header_size ..][0..payload.len], payload);

        // Zero the padding between payload end and the relocated tail
        const payload_end = new_file_offset + new_content_size;
        if (move_dst_start > payload_end) {
            @memset(self.data.items[payload_end..move_dst_start], 0);
        }

        // Write the vaddr of the appended data at the ORIGINAL .bun section location
        // (where BUN_COMPILED symbol points). At runtime, BUN_COMPILED.size will be
        // this vaddr (always non-zero), which the runtime dereferences as a pointer.
        // Non-standalone binaries have BUN_COMPILED.size = 0, so 0 means "no data".
        std.mem.writeInt(u64, self.data.items[bun_section_offset..][0..8], new_vaddr, .little);

        // Update every section header whose sh_offset pointed into the moved
        // tail so tools like `readelf -S`, `objdump`, and `gdb` still find
        // the right bytes. Special-case the .bun header — it moves to the
        // payload's new position, not to the shifted tail.
        //
        // The section header table itself is part of the moved tail, so we
        // compute its new location from e_shoff's old value.
        const old_shdr_offset: u64 = ehdr.e_shoff;
        const shdr_table_size = @as(u64, ehdr.e_shnum) * @sizeOf(Elf64_Shdr);
        if (old_shdr_offset < move_src_start or old_shdr_offset + shdr_table_size > move_src_end) {
            return error.InvalidElfFile;
        }
        const new_shdr_offset: u64 = old_shdr_offset + (move_dst_start - move_src_start);
        self.writeEhdrShoff(new_shdr_offset);

        const shnum = ehdr.e_shnum;
        for (0..shnum) |i| {
            const shdr_file_offset: u64 = new_shdr_offset + @as(u64, @intCast(i)) * @sizeOf(Elf64_Shdr);
            const shdr_bytes = self.data.items[shdr_file_offset..][0..@sizeOf(Elf64_Shdr)];
            var shdr = std.mem.bytesAsValue(Elf64_Shdr, shdr_bytes).*;

            if (i == bun_section.section_index) {
                shdr.sh_offset = new_file_offset;
                shdr.sh_size = new_content_size;
                shdr.sh_addr = new_vaddr;
            } else if (shdr.sh_type != elf.SHT_NOBITS and
                shdr.sh_offset >= move_src_start and
                shdr.sh_offset < move_src_end)
            {
                shdr.sh_offset += move_dst_start - move_src_start;
            }

            @memcpy(shdr_bytes, std.mem.asBytes(&shdr));
        }

        // Extend the existing writable PT_LOAD to cover the appended payload.
        // Keep p_offset/p_vaddr/p_paddr/p_align unchanged; only grow filesz
        // and memsz. Equal values are fine — the extension is entirely
        // file-backed (no new BSS gap).
        //
        // PT_GNU_STACK is deliberately left alone; repurposing it into a
        // separate late PT_LOAD is what breaks WSL1 (#29963).
        {
            const new_segment_size = offset_in_segment + aligned_new_size;
            const extended: Elf64_Phdr = .{
                .p_type = rw_phdr.p_type,
                .p_flags = rw_phdr.p_flags,
                .p_offset = rw_phdr.p_offset,
                .p_vaddr = rw_phdr.p_vaddr,
                .p_paddr = rw_phdr.p_paddr,
                .p_filesz = new_segment_size,
                .p_memsz = new_segment_size,
                .p_align = rw_phdr.p_align,
            };
            const phdr_offset = @as(usize, @intCast(ehdr.e_phoff)) + rw_index * phdr_size;
            @memcpy(self.data.items[phdr_offset..][0..phdr_size], std.mem.asBytes(&extended));
        }
    }

    pub fn write(self: *const ElfFile, writer: anytype) !void {
        try writer.writeAll(self.data.items);
    }

    // --- Internal helpers ---

    const BunSectionInfo = struct {
        /// File offset of the .bun section's data (sh_offset).
        file_offset: u64,
        /// Index of the .bun section in the section header table.
        section_index: u16,
    };

    /// Returns the file offset and section index of the `.bun` section.
    fn findBunSection(self: *const ElfFile, ehdr: Elf64_Ehdr) !BunSectionInfo {
        const shdr_size = @sizeOf(Elf64_Shdr);
        const shdr_table_offset = ehdr.e_shoff;
        const shnum = ehdr.e_shnum;

        if (shnum == 0) return error.BunSectionNotFound;
        if (shdr_table_offset + @as(u64, shnum) * shdr_size > self.data.items.len)
            return error.InvalidElfFile;

        // Read the .shstrtab section to get section names
        const shstrtab_shdr = self.readShdr(shdr_table_offset, ehdr.e_shstrndx);
        const strtab_offset = shstrtab_shdr.sh_offset;
        const strtab_size = shstrtab_shdr.sh_size;

        if (strtab_offset + strtab_size > self.data.items.len) return error.InvalidElfFile;
        const strtab = self.data.items[strtab_offset..][0..strtab_size];

        // Search for .bun section
        for (0..shnum) |i| {
            const shdr = self.readShdr(shdr_table_offset, @intCast(i));
            const name_offset = shdr.sh_name;

            if (name_offset < strtab.len) {
                const name = std.mem.sliceTo(strtab[name_offset..], 0);
                if (bun.strings.eqlComptime(name, ".bun")) {
                    return .{
                        .file_offset = shdr.sh_offset,
                        .section_index = @intCast(i),
                    };
                }
            }
        }

        return error.BunSectionNotFound;
    }

    fn readShdr(self: *const ElfFile, table_offset: u64, index: u16) Elf64_Shdr {
        const offset = table_offset + @as(u64, index) * @sizeOf(Elf64_Shdr);
        return std.mem.bytesAsValue(Elf64_Shdr, self.data.items[offset..][0..@sizeOf(Elf64_Shdr)]).*;
    }

    fn writeEhdrShoff(self: *ElfFile, new_shoff: u64) void {
        // e_shoff is at offset 40 in Elf64_Ehdr
        std.mem.writeInt(u64, self.data.items[40..][0..8], new_shoff, .little);
    }

    fn pageSize(ehdr: Elf64_Ehdr) u64 {
        return switch (ehdr.e_machine) {
            .AARCH64, .PPC64 => 0x10000, // 64KB
            else => 0x1000, // 4KB
        };
    }
};

fn readEhdr(data: []const u8) Elf64_Ehdr {
    return std.mem.bytesAsValue(Elf64_Ehdr, data[0..@sizeOf(Elf64_Ehdr)]).*;
}

fn alignUp(value: u64, alignment: u64) u64 {
    if (alignment == 0) return value;
    const mask = alignment - 1;
    return (value + mask) & ~mask;
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
fn hostUsesNixStoreInterpreter() bool {
    if (comptime !bun.Environment.isLinux) return false;

    const cache = struct {
        var computed: std.atomic.Value(u8) = .init(0); // 0 unknown, 1 no, 2 yes
        fn check() bool {
            // Test-only override: lets #29290's regression test force the
            // Nix-host branch without mutating `/etc/NIXOS` on the shared
            // rootfs (which would poison concurrent test workers).
            if (bun.env_var.BUN_DEBUG_FORCE_NIX_HOST.get()) return true;
            if (selfInterpIsNixStore()) return true;
            // Canonical NixOS marker — present even when bun itself was not
            // installed via Nix (statically-linked bun, downloaded tarball).
            if (bun.sys.exists("/etc/NIXOS")) return true;
            // Guix equivalent.
            if (bun.sys.directoryExistsAt(bun.FD.cwd(), "/gnu/store").unwrapOr(false)) return true;
            return false;
        }

        fn selfInterpIsNixStore() bool {
            // 4 KiB is enough: PT_INTERP on a glibc-linked binary points into
            // the first page. Read just the leading bytes to avoid slurping
            // the whole bun binary.
            var buf: [4096]u8 = undefined;
            const fd = switch (bun.sys.open("/proc/self/exe", bun.O.RDONLY, 0)) {
                .result => |fd| fd,
                .err => return false,
            };
            defer fd.close();
            const n = switch (bun.sys.read(fd, &buf)) {
                .result => |n| n,
                .err => return false,
            };
            if (n < @sizeOf(Elf64_Ehdr)) return false;
            const data = buf[0..n];

            if (!bun.strings.eqlComptime(data[0..4], "\x7fELF")) return false;
            if (data[elf.EI_CLASS] != elf.ELFCLASS64) return false;
            if (data[elf.EI_DATA] != elf.ELFDATA2LSB) return false;

            const ehdr = readEhdr(data);
            const phdr_size = @sizeOf(Elf64_Phdr);
            const table_end = @as(u64, ehdr.e_phoff) +| @as(u64, ehdr.e_phnum) *| @as(u64, phdr_size);
            if (table_end > data.len) return false;

            for (0..ehdr.e_phnum) |i| {
                const off = @as(usize, @intCast(ehdr.e_phoff)) + i * phdr_size;
                const phdr = std.mem.bytesAsValue(Elf64_Phdr, data[off..][0..phdr_size]).*;
                if (phdr.p_type != elf.PT_INTERP) continue;

                const interp_off: usize = @intCast(phdr.p_offset);
                const interp_sz: usize = @intCast(phdr.p_filesz);
                if (interp_off + interp_sz > data.len) return false;

                const interp = std.mem.sliceTo(data[interp_off..][0..interp_sz], 0);
                return bun.strings.hasPrefixComptime(interp, "/nix/store/") or
                    bun.strings.hasPrefixComptime(interp, "/gnu/store/");
            }
            return false;
        }
    };

    switch (cache.computed.load(.acquire)) {
        1 => return false,
        2 => return true,
        else => {},
    }
    const result = cache.check();
    cache.computed.store(if (result) 2 else 1, .release);
    return result;
}

const log = bun.Output.scoped(.elf, .visible);

const bun = @import("bun");

const std = @import("std");
const Allocator = std.mem.Allocator;

const elf = std.elf;
const Elf64_Ehdr = elf.Elf64_Ehdr;
const Elf64_Phdr = elf.Elf64_Phdr;
const Elf64_Shdr = elf.Elf64_Shdr;
