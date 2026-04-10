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
    /// Store paths are always longer than the FHS path, so this is an in-place
    /// shrink — no segment moves. No-op for any other interpreter.
    pub fn normalizeInterpreter(self: *ElfFile) void {
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

    /// Find the `.bun` section and write `payload` to the end of the ELF file,
    /// creating a new PT_LOAD segment (from PT_GNU_STACK) to map it. Stores the
    /// new segment's vaddr at the original BUN_COMPILED location so the runtime
    /// can dereference it directly.
    ///
    /// We always append rather than writing in-place because .bun is in the middle
    /// of a PT_LOAD segment — sections like .dynamic, .got, .got.plt come after it,
    /// and expanding in-place would invalidate their absolute virtual addresses.
    pub fn writeBunSection(self: *ElfFile, payload: []const u8) !void {
        const ehdr = readEhdr(self.data.items);
        const bun_section = try self.findBunSection(ehdr);
        const bun_section_offset = bun_section.file_offset;
        const page_size = pageSize(ehdr);

        const header_size: u64 = @sizeOf(u64);
        const new_content_size: u64 = header_size + payload.len;
        const aligned_new_size = alignUp(new_content_size, page_size);

        // Find the highest virtual address across all PT_LOAD segments
        var max_vaddr_end: u64 = 0;
        const phdr_size = @sizeOf(Elf64_Phdr);
        for (0..ehdr.e_phnum) |i| {
            const phdr_offset = @as(usize, @intCast(ehdr.e_phoff)) + i * phdr_size;
            const phdr = std.mem.bytesAsValue(Elf64_Phdr, self.data.items[phdr_offset..][0..phdr_size]).*;
            if (phdr.p_type == elf.PT_LOAD) {
                const vaddr_end = phdr.p_vaddr + phdr.p_memsz;
                if (vaddr_end > max_vaddr_end) {
                    max_vaddr_end = vaddr_end;
                }
            }
        }

        // The new segment's virtual address: after all existing mappings, page-aligned
        const new_vaddr = alignUp(max_vaddr_end, page_size);

        // The new data goes at the end of the file, page-aligned
        const new_file_offset = alignUp(self.data.items.len, page_size);

        // Grow the buffer to hold the new data + section header table after it
        const shdr_table_size = @as(u64, ehdr.e_shnum) * @sizeOf(Elf64_Shdr);
        const new_shdr_offset = new_file_offset + aligned_new_size;
        const total_new_size = new_shdr_offset + shdr_table_size;

        const old_file_size = self.data.items.len;
        try self.data.ensureTotalCapacity(total_new_size);
        self.data.items.len = total_new_size;

        // Zero the gap between old file end and new data (alignment padding).
        // Without this, uninitialized allocator memory would leak into the output.
        if (new_file_offset > old_file_size) {
            @memset(self.data.items[old_file_size..new_file_offset], 0);
        }

        // Copy the section header table to its new location
        const old_shdr_offset = ehdr.e_shoff;
        bun.memmove(
            self.data.items[new_shdr_offset..][0..shdr_table_size],
            self.data.items[old_shdr_offset..][0..shdr_table_size],
        );

        // Update e_shoff to the new section header table location
        self.writeEhdrShoff(new_shdr_offset);

        // Write the payload at the new location: [u64 LE size][data][zero padding]
        std.mem.writeInt(u64, self.data.items[new_file_offset..][0..8], @intCast(payload.len), .little);
        @memcpy(self.data.items[new_file_offset + header_size ..][0..payload.len], payload);

        // Zero the padding between payload end and section header table
        const padding_start = new_file_offset + new_content_size;
        if (new_shdr_offset > padding_start) {
            @memset(self.data.items[padding_start..new_shdr_offset], 0);
        }

        // Write the vaddr of the appended data at the ORIGINAL .bun section location
        // (where BUN_COMPILED symbol points). At runtime, BUN_COMPILED.size will be
        // this vaddr (always non-zero), which the runtime dereferences as a pointer.
        // Non-standalone binaries have BUN_COMPILED.size = 0, so 0 means "no data".
        std.mem.writeInt(u64, self.data.items[bun_section_offset..][0..8], new_vaddr, .little);

        // Update the .bun section header to reflect the new data location and size
        // so that tools like `readelf -S` show accurate metadata.
        {
            const shdr_offset = new_shdr_offset + @as(u64, bun_section.section_index) * @sizeOf(Elf64_Shdr);
            const shdr_bytes = self.data.items[shdr_offset..][0..@sizeOf(Elf64_Shdr)];
            var shdr = std.mem.bytesAsValue(Elf64_Shdr, shdr_bytes).*;
            shdr.sh_offset = new_file_offset;
            shdr.sh_size = new_content_size;
            shdr.sh_addr = new_vaddr;
            @memcpy(shdr_bytes, std.mem.asBytes(&shdr));
        }

        // Find PT_GNU_STACK and convert it to PT_LOAD for the new .bun data.
        // PT_GNU_STACK only controls stack executability; on modern kernels the
        // stack defaults to non-executable without it, so repurposing is safe.
        var found_gnu_stack = false;
        for (0..ehdr.e_phnum) |i| {
            const phdr_offset = @as(usize, @intCast(ehdr.e_phoff)) + i * phdr_size;
            const phdr = std.mem.bytesAsValue(Elf64_Phdr, self.data.items[phdr_offset..][0..phdr_size]).*;

            if (phdr.p_type == elf.PT_GNU_STACK) {
                // Convert to PT_LOAD
                const new_phdr: Elf64_Phdr = .{
                    .p_type = elf.PT_LOAD,
                    .p_flags = elf.PF_R, // read-only
                    .p_offset = new_file_offset,
                    .p_vaddr = new_vaddr,
                    .p_paddr = new_vaddr,
                    .p_filesz = aligned_new_size,
                    .p_memsz = aligned_new_size,
                    .p_align = page_size,
                };
                @memcpy(self.data.items[phdr_offset..][0..phdr_size], std.mem.asBytes(&new_phdr));
                found_gnu_stack = true;
                break;
            }
        }

        if (!found_gnu_stack) {
            return error.NoGnuStackSegment;
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

const log = bun.Output.scoped(.elf, .visible);

const bun = @import("bun");

const std = @import("std");
const Allocator = std.mem.Allocator;

const elf = std.elf;
const Elf64_Ehdr = elf.Elf64_Ehdr;
const Elf64_Phdr = elf.Elf64_Phdr;
const Elf64_Shdr = elf.Elf64_Shdr;
