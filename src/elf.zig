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
        if (!std.mem.eql(u8, ehdr.e_ident[0..4], "\x7fELF")) return error.InvalidElfFile;

        // Must be 64-bit
        if (ehdr.e_ident[elf.EI_CLASS] != elf.ELFCLASS64) return error.Not64Bit;

        // Must be little-endian (bun only supports x64 + arm64, both LE)
        if (ehdr.e_ident[elf.EI_DATA] != elf.ELFDATA2LSB) return error.NotLittleEndian;

        var data = try std.array_list.Managed(u8).initCapacity(allocator, elf_data.len);
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
        const bun_section_offset = try self.findBunSection(ehdr);
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

    /// Returns the file offset (sh_offset) of the `.bun` section.
    fn findBunSection(self: *const ElfFile, ehdr: Elf64_Ehdr) !u64 {
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
                if (std.mem.eql(u8, name, ".bun")) {
                    return shdr.sh_offset;
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

const bun = @import("bun");

const std = @import("std");
const Allocator = std.mem.Allocator;

const elf = std.elf;
const Elf64_Ehdr = elf.Elf64_Ehdr;
const Elf64_Phdr = elf.Elf64_Phdr;
const Elf64_Shdr = elf.Elf64_Shdr;
