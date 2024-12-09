const std = @import("std");
const mem = std.mem;
const fs = std.fs;
const io = std.io;
const macho = std.macho;
const Allocator = mem.Allocator;
const bun = @import("root").bun;
const elf = std.elf;

pub const BlobAlignment = 4 * 1024;

pub const ElfError = error{
    InvalidElfFile,
    SectionNotFound,
    SymbolNotFound,
    InvalidSectionType,
    NotEnoughSpace,
    InvalidAlignment,
    SectionHasRelocations,
    SectionInGroup,
    CompressedSectionNotSupported,
    InvalidSectionFlags,
} || Allocator.Error;

/// Embeds binary data into an ELF executable by modifying the ".data.bun" section
pub fn embedBinaryData(allocator: Allocator, input_elf: []const u8, data_to_embed: []const u8) ElfError![]u8 {
    // Parse ELF header
    if (input_elf.len < @sizeOf(elf.Elf64_Ehdr)) {
        return error.InvalidElfFile;
    }
    const elf_header = @as(*align(1) const elf.Elf64_Ehdr, @ptrCast(input_elf.ptr)).*;

    // Verify ELF magic
    if (!mem.eql(u8, elf_header.e_ident[0..4], "\x7fELF")) {
        return error.InvalidElfFile;
    }

    // Parse section headers
    const sh_offset = elf_header.e_shoff;
    const sh_size = @as(usize, @intCast(elf_header.e_shentsize)) * @as(usize, @intCast(elf_header.e_shnum));
    if (sh_offset + sh_size > input_elf.len) {
        return error.InvalidElfFile;
    }

    const sections = @as([*]const elf.Elf64_Shdr, @alignCast(@ptrCast(input_elf.ptr + sh_offset)))[0..elf_header.e_shnum];

    // Find string table section
    const strtab = sections[elf_header.e_shstrndx];
    const strtab_data = input_elf[strtab.sh_offset..][0..strtab.sh_size];

    // Find .data.bun section
    var bun_data_section: ?*elf.Elf64_Shdr = null;
    for (sections) |*section| {
        const name = mem.sliceTo(@as([*:0]const u8, @ptrCast(strtab_data.ptr + section.sh_name)), 0);
        if (section.sh_name >= strtab_data.len) {
            return error.InvalidElfFile;
        }
        if (mem.eql(u8, name, ".data.bun")) {
            bun_data_section = @constCast(section);
            break;
        }
    }

    const data_section = bun_data_section orelse return error.SectionNotFound;

    // Verify section is writable and has enough space
    if (data_section.sh_type != elf.SHT_PROGBITS) {
        return error.InvalidSectionType;
    }

    // Check section flags - it should be writable and allocated
    if ((data_section.sh_flags & (elf.SHF_WRITE | elf.SHF_ALLOC)) != (elf.SHF_WRITE | elf.SHF_ALLOC)) {
        return error.InvalidSectionFlags;
    }

    const required_size = mem.alignForward(usize, @sizeOf(u32) + data_to_embed.len, @max(BlobAlignment, data_section.sh_addralign));

    // Calculate new file size if we need to expand
    const size_difference = if (data_section.sh_size < required_size)
        required_size - data_section.sh_size
    else
        0;

    // Create output buffer with potentially increased size
    const output = try allocator.alloc(u8, input_elf.len + size_difference);

    // Copy everything up to the section that needs expansion
    @memcpy(output[0..data_section.sh_offset], input_elf[0..data_section.sh_offset]);

    // Write our data
    const out_ptr = @as([*]u8, @ptrCast(output.ptr + data_section.sh_offset));
    mem.writeInt(u32, out_ptr[0..4], @as(u32, @intCast(data_to_embed.len)), .little);
    @memcpy(out_ptr[4..][0..data_to_embed.len], data_to_embed);

    // If we didn't need to expand, copy the rest of the file
    if (size_difference == 0) {
        const remaining_offset = data_section.sh_offset + data_section.sh_size;
        @memcpy(
            output[remaining_offset..],
            input_elf[remaining_offset..],
        );
        return output;
    }

    // If we expanded, we need to:
    // 1. Update section header for .data.bun
    const output_sections = @as([*]elf.Elf64_Shdr, @alignCast(@ptrCast(output.ptr + elf_header.e_shoff)))[0..elf_header.e_shnum];

    // Find and update our section in the output buffer
    for (output_sections) |*section| {
        const name = mem.sliceTo(@as([*:0]const u8, @ptrCast(strtab_data.ptr + section.sh_name)), 0);
        if (mem.eql(u8, name, ".data.bun")) {
            section.sh_size = required_size;
            break;
        }
    }

    // 2. Copy remaining sections and adjust their offsets
    const current_offset = data_section.sh_offset + required_size;
    const section_end = data_section.sh_offset + data_section.sh_size;

    // Copy remaining file contents with adjusted offsets
    @memcpy(
        output[current_offset..],
        input_elf[section_end..],
    );

    // 3. Update section headers that come after our modified section
    for (output_sections) |*section| {
        if (section.sh_offset > data_section.sh_offset) {
            section.sh_offset += size_difference;
        }
    }

    // 4. Update ELF header if section header table was moved
    if (elf_header.e_shoff > data_section.sh_offset) {
        const output_header = @as(*align(1) elf.Elf64_Ehdr, @ptrCast(output.ptr));
        output_header.e_shoff += size_difference;
    }

    // Update program headers if needed
    const ph_offset = elf_header.e_phoff;
    const ph_size = @as(usize, @intCast(elf_header.e_phentsize)) * @as(usize, @intCast(elf_header.e_phnum));
    if (ph_offset + ph_size > input_elf.len) {
        return error.InvalidElfFile;
    }

    const phdrs = @as([*]elf.Elf64_Phdr, @alignCast(@ptrCast(output.ptr + ph_offset)))[0..elf_header.e_phnum];

    // Update any program headers that contain our section
    for (phdrs) |*phdr| {
        const segment_end = phdr.p_offset + phdr.p_filesz;
        if (phdr.p_type == elf.PT_LOAD and
            data_section.sh_offset >= phdr.p_offset and
            data_section.sh_offset < segment_end)
        {
            // Update segment size if it contains our modified section
            if (size_difference > 0) {
                phdr.p_filesz += size_difference;
                phdr.p_memsz += size_difference;
            }

            // Check alignment requirements
            const new_size = phdr.p_offset + phdr.p_filesz + size_difference;
            if (new_size % phdr.p_align != 0) {
                return error.InvalidAlignment;
            }
        } else if (phdr.p_offset > data_section.sh_offset) {
            // Adjust offset for segments that come after our section
            phdr.p_offset += size_difference;
        }
    }

    // Update virtual addresses for affected sections
    for (output_sections) |*section| {
        if (section.sh_addr > data_section.sh_addr) {
            section.sh_addr += size_difference;
        }
    }

    // Update virtual addresses in program headers
    for (phdrs) |*phdr| {
        if (phdr.p_vaddr > data_section.sh_addr) {
            phdr.p_vaddr += size_difference;
            phdr.p_paddr += size_difference;
        }
    }

    // Find and update dynamic section if present
    for (output_sections) |*section| {
        if (section.sh_type == elf.SHT_DYNAMIC) {
            const dynamic = @as([*]elf.Elf64_Dyn, @alignCast(@ptrCast(output.ptr + section.sh_offset)))[0..@divExact(section.sh_size, @sizeOf(elf.Elf64_Dyn))];

            for (dynamic) |*dyn| {
                // Update dynamic entries that contain file offsets
                switch (dyn.d_tag) {
                    elf.DT_STRTAB, elf.DT_SYMTAB, elf.DT_RELA, elf.DT_REL, elf.DT_JMPREL, elf.DT_VERNEED, elf.DT_VERSYM => {
                        if (dyn.d_val > data_section.sh_offset) {
                            dyn.d_val += size_difference;
                        }
                    },
                    else => {},
                }
            }
        }
    }

    // Find and update symbol tables
    for (output_sections) |*section| {
        if (section.sh_type == elf.SHT_SYMTAB or section.sh_type == elf.SHT_DYNSYM) {
            const symbols = @as([*]elf.Elf64_Sym, @alignCast(@ptrCast(output.ptr + section.sh_offset)))[0..@divExact(section.sh_size, @sizeOf(elf.Elf64_Sym))];

            for (symbols) |*sym| {
                if (sym.st_value > data_section.sh_addr) {
                    sym.st_value += size_difference;
                }
            }
        }
    }

    // Update relocations
    for (output_sections) |*section| {
        if (section.sh_type == elf.SHT_RELA) {
            const relocations = @as([*]elf.Elf64_Rela, @alignCast(@ptrCast(output.ptr + section.sh_offset)))[0..@divExact(section.sh_size, @sizeOf(elf.Elf64_Rela))];

            for (relocations) |*rela| {
                if (rela.r_offset > data_section.sh_addr) {
                    rela.r_offset += size_difference;
                }
            }
        }
    }

    // Update section groups if present
    for (output_sections) |*section| {
        if (section.sh_type == elf.SHT_GROUP) {
            const group_members = @as([*]u32, @alignCast(@ptrCast(output.ptr + section.sh_offset)))[0..@divExact(section.sh_size, @sizeOf(u32))];

            // Skip the flags word at the start
            for (group_members[1..]) |*member| {
                const member_section = output_sections[member.*];
                if (member_section.sh_addr > data_section.sh_addr) {
                    member.* += @truncate(size_difference);
                }
            }
        }
    }

    return output;
}
