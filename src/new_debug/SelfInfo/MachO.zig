mutex: std.Thread.Mutex,
/// Accessed through `Module.Adapter`.
modules: std.ArrayHashMapUnmanaged(Module, void, Module.Context, false),

pub const init: SelfInfo = .{
    .mutex = .{},
    .modules = .empty,
};
pub fn deinit(si: *SelfInfo, gpa: Allocator) void {
    for (si.modules.keys()) |*module| {
        unwind: {
            const u = &(module.unwind orelse break :unwind catch break :unwind);
            if (u.dwarf) |*dwarf| dwarf.deinit(gpa);
        }
        file: {
            const f = &(module.file orelse break :file catch break :file);
            f.deinit(gpa);
        }
    }
    si.modules.deinit(gpa);
}

pub fn getSymbol(si: *SelfInfo, gpa: Allocator, io: Io, address: usize) Error!std.debug.Symbol {
    _ = io;
    const module = try si.findModule(gpa, address);
    defer si.mutex.unlock();

    const file = try module.getFile(gpa);

    // This is not necessarily the same as the vmaddr_slide that dyld would report. This is
    // because the segments in the file on disk might differ from the ones in memory. Normally
    // we wouldn't necessarily expect that to work, but /usr/lib/dyld is incredibly annoying:
    // it exists on disk (necessarily, because the kernel needs to load it!), but is also in
    // the dyld cache (dyld actually restart itself from cache after loading it), and the two
    // versions have (very) different segment base addresses. It's sort of like a large slide
    // has been applied to all addresses in memory. For an optimal experience, we consider the
    // on-disk vmaddr instead of the in-memory one.
    const vaddr_offset = module.text_base - file.text_vmaddr;

    const vaddr = address - vaddr_offset;

    const ofile_dwarf, const ofile_vaddr = file.getDwarfForAddress(gpa, vaddr) catch {
        // Return at least the symbol name if available.
        return .{
            .name = try file.lookupSymbolName(vaddr),
            .compile_unit_name = null,
            .source_location = null,
        };
    };

    const compile_unit = ofile_dwarf.findCompileUnit(native_endian, ofile_vaddr) catch {
        // Return at least the symbol name if available.
        return .{
            .name = try file.lookupSymbolName(vaddr),
            .compile_unit_name = null,
            .source_location = null,
        };
    };

    return .{
        .name = ofile_dwarf.getSymbolName(ofile_vaddr) orelse
            try file.lookupSymbolName(vaddr),
        .compile_unit_name = compile_unit.die.getAttrString(
            ofile_dwarf,
            native_endian,
            std.dwarf.AT.name,
            ofile_dwarf.section(.debug_str),
            compile_unit,
        ) catch |err| switch (err) {
            error.MissingDebugInfo, error.InvalidDebugInfo => null,
        },
        .source_location = ofile_dwarf.getLineNumberInfo(
            gpa,
            native_endian,
            compile_unit,
            ofile_vaddr,
        ) catch null,
    };
}
pub fn getModuleName(si: *SelfInfo, gpa: Allocator, address: usize) Error![]const u8 {
    const module = try si.findModule(gpa, address);
    defer si.mutex.unlock();
    return module.name;
}
pub fn getModuleSlide(si: *SelfInfo, gpa: Allocator, address: usize) Error!usize {
    const module = try si.findModule(gpa, address);
    defer si.mutex.unlock();
    const header: *std.macho.mach_header_64 = @ptrFromInt(module.text_base);
    const raw_macho: [*]u8 = @ptrCast(header);
    var it = initLoadCommandIterator(header, raw_macho[@sizeOf(macho.mach_header_64)..][0..header.sizeofcmds]) catch unreachable;
    const text_vmaddr = while (it.next()) |load_cmd| {
        if (load_cmd.hdr.cmd != .SEGMENT_64) continue;
        const segment_cmd = load_cmd.cast(macho.segment_command_64).?;
        if (!mem.eql(u8, segment_cmd.segName(), "__TEXT")) continue;
        break segment_cmd.vmaddr;
    } else unreachable;
    return module.text_base - text_vmaddr;
}

pub const can_unwind: bool = true;
pub const UnwindContext = debug.Dwarf.SelfUnwinder;
/// Unwind a frame using MachO compact unwind info (from `__unwind_info`).
/// If the compact encoding can't encode a way to unwind a frame, it will
/// defer unwinding to DWARF, in which case `__eh_frame` will be used if available.
pub fn unwindFrame(si: *SelfInfo, gpa: Allocator, context: *UnwindContext) Error!usize {
    return unwindFrameInner(si, gpa, context) catch |err| switch (err) {
        error.InvalidDebugInfo,
        error.MissingDebugInfo,
        error.UnsupportedDebugInfo,
        error.ReadFailed,
        error.OutOfMemory,
        error.Unexpected,
        error.Canceled,
        => |e| return e,

        error.UnsupportedRegister,
        error.UnsupportedAddrSize,
        error.UnimplementedUserOpcode,
        => return error.UnsupportedDebugInfo,

        error.Overflow,
        error.EndOfStream,
        error.StreamTooLong,
        error.InvalidOpcode,
        error.InvalidOperation,
        error.InvalidOperand,
        error.InvalidRegister,
        error.IncompatibleRegisterSize,
        => return error.InvalidDebugInfo,
    };
}
fn unwindFrameInner(si: *SelfInfo, gpa: Allocator, context: *UnwindContext) !usize {
    const module = try si.findModule(gpa, context.pc);
    defer si.mutex.unlock();

    const unwind: *Module.Unwind = try module.getUnwindInfo(gpa);

    const ip_reg_num = comptime Dwarf.ipRegNum(builtin.target.cpu.arch).?;
    const fp_reg_num = comptime Dwarf.fpRegNum(builtin.target.cpu.arch);
    const sp_reg_num = comptime Dwarf.spRegNum(builtin.target.cpu.arch);

    const unwind_info = unwind.unwind_info orelse return error.MissingDebugInfo;
    if (unwind_info.len < @sizeOf(macho.unwind_info_section_header)) return error.InvalidDebugInfo;
    const header: *align(1) const macho.unwind_info_section_header = @ptrCast(unwind_info);

    const index_byte_count = header.indexCount * @sizeOf(macho.unwind_info_section_header_index_entry);
    if (unwind_info.len < header.indexSectionOffset + index_byte_count) return error.InvalidDebugInfo;
    const indices: []align(1) const macho.unwind_info_section_header_index_entry = @ptrCast(unwind_info[header.indexSectionOffset..][0..index_byte_count]);
    if (indices.len == 0) return error.MissingDebugInfo;

    // offset of the PC into the `__TEXT` segment
    const pc_text_offset = context.pc - module.text_base;

    const start_offset: u32, const first_level_offset: u32 = index: {
        var left: usize = 0;
        var len: usize = indices.len;
        while (len > 1) {
            const mid = left + len / 2;
            if (pc_text_offset < indices[mid].functionOffset) {
                len /= 2;
            } else {
                left = mid;
                len -= len / 2;
            }
        }
        break :index .{ indices[left].secondLevelPagesSectionOffset, indices[left].functionOffset };
    };
    // An offset of 0 is a sentinel indicating a range does not have unwind info.
    if (start_offset == 0) return error.MissingDebugInfo;

    const common_encodings_byte_count = header.commonEncodingsArrayCount * @sizeOf(macho.compact_unwind_encoding_t);
    if (unwind_info.len < header.commonEncodingsArraySectionOffset + common_encodings_byte_count) return error.InvalidDebugInfo;
    const common_encodings: []align(1) const macho.compact_unwind_encoding_t = @ptrCast(
        unwind_info[header.commonEncodingsArraySectionOffset..][0..common_encodings_byte_count],
    );

    if (unwind_info.len < start_offset + @sizeOf(macho.UNWIND_SECOND_LEVEL)) return error.InvalidDebugInfo;
    const kind: *align(1) const macho.UNWIND_SECOND_LEVEL = @ptrCast(unwind_info[start_offset..]);

    const entry: struct {
        function_offset: usize,
        raw_encoding: u32,
    } = switch (kind.*) {
        .REGULAR => entry: {
            if (unwind_info.len < start_offset + @sizeOf(macho.unwind_info_regular_second_level_page_header)) return error.InvalidDebugInfo;
            const page_header: *align(1) const macho.unwind_info_regular_second_level_page_header = @ptrCast(unwind_info[start_offset..]);

            const entries_byte_count = page_header.entryCount * @sizeOf(macho.unwind_info_regular_second_level_entry);
            if (unwind_info.len < start_offset + entries_byte_count) return error.InvalidDebugInfo;
            const entries: []align(1) const macho.unwind_info_regular_second_level_entry = @ptrCast(
                unwind_info[start_offset + page_header.entryPageOffset ..][0..entries_byte_count],
            );
            if (entries.len == 0) return error.InvalidDebugInfo;

            var left: usize = 0;
            var len: usize = entries.len;
            while (len > 1) {
                const mid = left + len / 2;
                if (pc_text_offset < entries[mid].functionOffset) {
                    len /= 2;
                } else {
                    left = mid;
                    len -= len / 2;
                }
            }
            break :entry .{
                .function_offset = entries[left].functionOffset,
                .raw_encoding = entries[left].encoding,
            };
        },
        .COMPRESSED => entry: {
            if (unwind_info.len < start_offset + @sizeOf(macho.unwind_info_compressed_second_level_page_header)) return error.InvalidDebugInfo;
            const page_header: *align(1) const macho.unwind_info_compressed_second_level_page_header = @ptrCast(unwind_info[start_offset..]);

            const entries_byte_count = page_header.entryCount * @sizeOf(macho.UnwindInfoCompressedEntry);
            if (unwind_info.len < start_offset + entries_byte_count) return error.InvalidDebugInfo;
            const entries: []align(1) const macho.UnwindInfoCompressedEntry = @ptrCast(
                unwind_info[start_offset + page_header.entryPageOffset ..][0..entries_byte_count],
            );
            if (entries.len == 0) return error.InvalidDebugInfo;

            var left: usize = 0;
            var len: usize = entries.len;
            while (len > 1) {
                const mid = left + len / 2;
                if (pc_text_offset < first_level_offset + entries[mid].funcOffset) {
                    len /= 2;
                } else {
                    left = mid;
                    len -= len / 2;
                }
            }
            const entry = entries[left];

            const function_offset = first_level_offset + entry.funcOffset;
            if (entry.encodingIndex < common_encodings.len) {
                break :entry .{
                    .function_offset = function_offset,
                    .raw_encoding = common_encodings[entry.encodingIndex],
                };
            }

            const local_index = entry.encodingIndex - common_encodings.len;
            const local_encodings_byte_count = page_header.encodingsCount * @sizeOf(macho.compact_unwind_encoding_t);
            if (unwind_info.len < start_offset + page_header.encodingsPageOffset + local_encodings_byte_count) return error.InvalidDebugInfo;
            const local_encodings: []align(1) const macho.compact_unwind_encoding_t = @ptrCast(
                unwind_info[start_offset + page_header.encodingsPageOffset ..][0..local_encodings_byte_count],
            );
            if (local_index >= local_encodings.len) return error.InvalidDebugInfo;
            break :entry .{
                .function_offset = function_offset,
                .raw_encoding = local_encodings[local_index],
            };
        },
        else => return error.InvalidDebugInfo,
    };

    if (entry.raw_encoding == 0) return error.MissingDebugInfo;

    const encoding: macho.CompactUnwindEncoding = @bitCast(entry.raw_encoding);
    const new_ip = switch (builtin.cpu.arch) {
        .x86_64 => switch (encoding.mode.x86_64) {
            .OLD => return error.UnsupportedDebugInfo,
            .RBP_FRAME => ip: {
                const frame = encoding.value.x86_64.frame;

                const fp = (try dwarfRegNative(&context.cpu_state, fp_reg_num)).*;
                const new_sp = fp + 2 * @sizeOf(usize);

                const ip_ptr = fp + @sizeOf(usize);
                const new_ip = @as(*const usize, @ptrFromInt(ip_ptr)).*;
                const new_fp = @as(*const usize, @ptrFromInt(fp)).*;

                (try dwarfRegNative(&context.cpu_state, fp_reg_num)).* = new_fp;
                (try dwarfRegNative(&context.cpu_state, sp_reg_num)).* = new_sp;
                (try dwarfRegNative(&context.cpu_state, ip_reg_num)).* = new_ip;

                const regs: [5]u3 = .{
                    frame.reg0,
                    frame.reg1,
                    frame.reg2,
                    frame.reg3,
                    frame.reg4,
                };
                for (regs, 0..) |reg, i| {
                    if (reg == 0) continue;
                    const addr = fp - frame.frame_offset * @sizeOf(usize) + i * @sizeOf(usize);
                    const reg_number = try Dwarf.compactUnwindToDwarfRegNumber(reg);
                    (try dwarfRegNative(&context.cpu_state, reg_number)).* = @as(*const usize, @ptrFromInt(addr)).*;
                }

                break :ip new_ip;
            },
            .STACK_IMMD,
            .STACK_IND,
            => ip: {
                const frameless = encoding.value.x86_64.frameless;

                const sp = (try dwarfRegNative(&context.cpu_state, sp_reg_num)).*;
                const stack_size: usize = stack_size: {
                    if (encoding.mode.x86_64 == .STACK_IMMD) {
                        break :stack_size @as(usize, frameless.stack.direct.stack_size) * @sizeOf(usize);
                    }
                    // In .STACK_IND, the stack size is inferred from the subq instruction at the beginning of the function.
                    const sub_offset_addr =
                        module.text_base +
                        entry.function_offset +
                        frameless.stack.indirect.sub_offset;
                    // `sub_offset_addr` points to the offset of the literal within the instruction
                    const sub_operand = @as(*align(1) const u32, @ptrFromInt(sub_offset_addr)).*;
                    break :stack_size sub_operand + @sizeOf(usize) * @as(usize, frameless.stack.indirect.stack_adjust);
                };

                // Decode the Lehmer-coded sequence of registers.
                // For a description of the encoding see lib/libc/include/any-macos.13-any/mach-o/compact_unwind_encoding.h

                // Decode the variable-based permutation number into its digits. Each digit represents
                // an index into the list of register numbers that weren't yet used in the sequence at
                // the time the digit was added.
                const reg_count = frameless.stack_reg_count;
                const ip_ptr = ip_ptr: {
                    var digits: [6]u3 = undefined;
                    var accumulator: usize = frameless.stack_reg_permutation;
                    var base: usize = 2;
                    for (0..reg_count) |i| {
                        const div = accumulator / base;
                        digits[digits.len - 1 - i] = @intCast(accumulator - base * div);
                        accumulator = div;
                        base += 1;
                    }

                    var registers: [6]u3 = undefined;
                    var used_indices: [6]bool = @splat(false);
                    for (digits[digits.len - reg_count ..], 0..) |target_unused_index, i| {
                        var unused_count: u8 = 0;
                        const unused_index = for (used_indices, 0..) |used, index| {
                            if (!used) {
                                if (target_unused_index == unused_count) break index;
                                unused_count += 1;
                            }
                        } else unreachable;
                        registers[i] = @intCast(unused_index + 1);
                        used_indices[unused_index] = true;
                    }

                    var reg_addr = sp + stack_size - @sizeOf(usize) * @as(usize, reg_count + 1);
                    for (0..reg_count) |i| {
                        const reg_number = try Dwarf.compactUnwindToDwarfRegNumber(registers[i]);
                        (try dwarfRegNative(&context.cpu_state, reg_number)).* = @as(*const usize, @ptrFromInt(reg_addr)).*;
                        reg_addr += @sizeOf(usize);
                    }

                    break :ip_ptr reg_addr;
                };

                const new_ip = @as(*const usize, @ptrFromInt(ip_ptr)).*;
                const new_sp = ip_ptr + @sizeOf(usize);

                (try dwarfRegNative(&context.cpu_state, sp_reg_num)).* = new_sp;
                (try dwarfRegNative(&context.cpu_state, ip_reg_num)).* = new_ip;

                break :ip new_ip;
            },
            .DWARF => {
                const dwarf = &(unwind.dwarf orelse return error.MissingDebugInfo);
                const rules = try context.computeRules(gpa, dwarf, unwind.vmaddr_slide, encoding.value.x86_64.dwarf);
                return context.next(gpa, &rules);
            },
        },
        .aarch64 => switch (encoding.mode.arm64) {
            .OLD => return error.UnsupportedDebugInfo,
            .FRAMELESS => ip: {
                const sp = (try dwarfRegNative(&context.cpu_state, sp_reg_num)).*;
                const new_sp = sp + encoding.value.arm64.frameless.stack_size * 16;
                const new_ip = (try dwarfRegNative(&context.cpu_state, 30)).*;
                (try dwarfRegNative(&context.cpu_state, sp_reg_num)).* = new_sp;
                break :ip new_ip;
            },
            .DWARF => {
                const dwarf = &(unwind.dwarf orelse return error.MissingDebugInfo);
                const rules = try context.computeRules(gpa, dwarf, unwind.vmaddr_slide, encoding.value.arm64.dwarf);
                return context.next(gpa, &rules);
            },
            .FRAME => ip: {
                const frame = encoding.value.arm64.frame;

                const fp = (try dwarfRegNative(&context.cpu_state, fp_reg_num)).*;
                const ip_ptr = fp + @sizeOf(usize);

                var reg_addr = fp - @sizeOf(usize);
                inline for (@typeInfo(@TypeOf(frame.x_reg_pairs)).@"struct".fields, 0..) |field, i| {
                    if (@field(frame.x_reg_pairs, field.name) != 0) {
                        (try dwarfRegNative(&context.cpu_state, 19 + i)).* = @as(*const usize, @ptrFromInt(reg_addr)).*;
                        reg_addr += @sizeOf(usize);
                        (try dwarfRegNative(&context.cpu_state, 20 + i)).* = @as(*const usize, @ptrFromInt(reg_addr)).*;
                        reg_addr += @sizeOf(usize);
                    }
                }

                // We intentionally skip restoring `frame.d_reg_pairs`; we know we don't support
                // vector registers in the AArch64 `cpu_context` anyway, so there's no reason to
                // fail a legitimate unwind just because we're asked to restore the registers here.
                // If some weird/broken unwind info tells us to read them later, we will fail then.
                reg_addr += 16 * @as(usize, @popCount(@as(u4, @bitCast(frame.d_reg_pairs))));

                const new_ip = @as(*const usize, @ptrFromInt(ip_ptr)).*;
                const new_fp = @as(*const usize, @ptrFromInt(fp)).*;

                (try dwarfRegNative(&context.cpu_state, fp_reg_num)).* = new_fp;
                (try dwarfRegNative(&context.cpu_state, ip_reg_num)).* = new_ip;

                break :ip new_ip;
            },
        },
        else => comptime unreachable, // unimplemented
    };

    const ret_addr = debug.stripInstructionPtrAuthCode(new_ip);

    // Like `Dwarf.SelfUnwinder.next`, adjust our next lookup pc in case the `call` was this
    // function's last instruction making `ret_addr` one byte past its end.
    context.pc = ret_addr -| 1;

    return ret_addr;
}

/// Acquires the mutex on success.
fn findModule(si: *SelfInfo, gpa: Allocator, address: usize) Error!*Module {
    var info: dl_info = undefined;
    if (dladdr(@ptrFromInt(address), &info) == 0) {
        return error.MissingDebugInfo;
    }
    si.mutex.lock();
    errdefer si.mutex.unlock();
    const gop = try si.modules.getOrPutAdapted(gpa, @intFromPtr(info.fbase), Module.Adapter{});
    errdefer comptime unreachable;
    if (!gop.found_existing) {
        gop.key_ptr.* = .{
            .text_base = @intFromPtr(info.fbase),
            .name = std.mem.span(info.fname),
            .unwind = null,
            .file = null,
        };
    }
    return gop.key_ptr;
}

const Module = struct {
    text_base: usize,
    name: []const u8,
    unwind: ?(Error!Unwind),
    file: ?(Error!MachOFile),

    const Adapter = struct {
        pub fn hash(_: Adapter, text_base: usize) u32 {
            return @truncate(std.hash.int(text_base));
        }
        pub fn eql(_: Adapter, a_text_base: usize, b_module: Module, b_index: usize) bool {
            _ = b_index;
            return a_text_base == b_module.text_base;
        }
    };
    const Context = struct {
        pub fn hash(_: Context, module: Module) u32 {
            return @truncate(std.hash.int(module.text_base));
        }
        pub fn eql(_: Context, a_module: Module, b_module: Module, b_index: usize) bool {
            _ = b_index;
            return a_module.text_base == b_module.text_base;
        }
    };

    const Unwind = struct {
        /// The slide applied to the `__unwind_info` and `__eh_frame` sections.
        /// So, `unwind_info.ptr` is this many bytes higher than the section's vmaddr.
        vmaddr_slide: u64,
        /// Backed by the in-memory section mapped by the loader.
        unwind_info: ?[]const u8,
        /// Backed by the in-memory `__eh_frame` section mapped by the loader.
        dwarf: ?Dwarf.Unwind,
    };

    fn getUnwindInfo(module: *Module, gpa: Allocator) Error!*Unwind {
        if (module.unwind == null) module.unwind = loadUnwindInfo(module, gpa);
        return if (module.unwind.?) |*unwind| unwind else |err| err;
    }
    fn loadUnwindInfo(module: *const Module, gpa: Allocator) Error!Unwind {
        const header: *std.macho.mach_header_64 = @ptrFromInt(module.text_base);

        const raw_macho: [*]u8 = @ptrCast(header);
        var it = initLoadCommandIterator(header, raw_macho[@sizeOf(macho.mach_header_64)..][0..header.sizeofcmds]) catch unreachable;
        const sections, const text_vmaddr = while (it.next()) |load_cmd| {
            if (load_cmd.hdr.cmd != .SEGMENT_64) continue;
            const segment_cmd = load_cmd.cast(macho.segment_command_64).?;
            if (!mem.eql(u8, segment_cmd.segName(), "__TEXT")) continue;
            break .{ load_cmd.getSections(), segment_cmd.vmaddr };
        } else unreachable;

        const vmaddr_slide = module.text_base - text_vmaddr;

        var opt_unwind_info: ?[]const u8 = null;
        var opt_eh_frame: ?[]const u8 = null;
        for (sections) |sect| {
            if (mem.eql(u8, sect.sectName(), "__unwind_info")) {
                const sect_ptr: [*]u8 = @ptrFromInt(@as(usize, @intCast(vmaddr_slide + sect.addr)));
                opt_unwind_info = sect_ptr[0..@intCast(sect.size)];
            } else if (mem.eql(u8, sect.sectName(), "__eh_frame")) {
                const sect_ptr: [*]u8 = @ptrFromInt(@as(usize, @intCast(vmaddr_slide + sect.addr)));
                opt_eh_frame = sect_ptr[0..@intCast(sect.size)];
            }
        }
        const eh_frame = opt_eh_frame orelse return .{
            .vmaddr_slide = vmaddr_slide,
            .unwind_info = opt_unwind_info,
            .dwarf = null,
        };
        var dwarf: Dwarf.Unwind = .initSection(.eh_frame, @intFromPtr(eh_frame.ptr) - vmaddr_slide, eh_frame);
        errdefer dwarf.deinit(gpa);
        // We don't need lookups, so this call is just for scanning CIEs.
        dwarf.prepare(gpa, @sizeOf(usize), native_endian, false, true) catch |err| switch (err) {
            error.ReadFailed => unreachable, // it's all fixed buffers
            error.InvalidDebugInfo,
            error.MissingDebugInfo,
            error.OutOfMemory,
            => |e| return e,
            error.EndOfStream,
            error.Overflow,
            error.StreamTooLong,
            error.InvalidOperand,
            error.InvalidOpcode,
            error.InvalidOperation,
            => return error.InvalidDebugInfo,
            error.UnsupportedAddrSize,
            error.UnsupportedDwarfVersion,
            error.UnimplementedUserOpcode,
            => return error.UnsupportedDebugInfo,
        };

        return .{
            .vmaddr_slide = vmaddr_slide,
            .unwind_info = opt_unwind_info,
            .dwarf = dwarf,
        };
    }

    fn getFile(module: *Module, gpa: Allocator) Error!*MachOFile {
        if (module.file == null) module.file = MachOFile.load(gpa, module.name, builtin.cpu.arch) catch |err| switch (err) {
            error.InvalidMachO, error.InvalidDwarf => error.InvalidDebugInfo,
            error.MissingDebugInfo, error.OutOfMemory, error.UnsupportedDebugInfo, error.ReadFailed => |e| e,
        };
        return if (module.file.?) |*f| f else |err| err;
    }
};

const MachoSymbol = struct {
    strx: u32,
    addr: u64,
    /// Value may be `unknown_ofile`.
    ofile: u32,
    const unknown_ofile = std.math.maxInt(u32);
    fn addressLessThan(context: void, lhs: MachoSymbol, rhs: MachoSymbol) bool {
        _ = context;
        return lhs.addr < rhs.addr;
    }
    /// Assumes that `symbols` is sorted in order of ascending `addr`.
    fn find(symbols: []const MachoSymbol, address: usize) ?*const MachoSymbol {
        if (symbols.len == 0) return null; // no potential match
        if (address < symbols[0].addr) return null; // address is before the lowest-address symbol
        var left: usize = 0;
        var len: usize = symbols.len;
        while (len > 1) {
            const mid = left + len / 2;
            if (address < symbols[mid].addr) {
                len /= 2;
            } else {
                left = mid;
                len -= len / 2;
            }
        }
        return &symbols[left];
    }

    test find {
        const symbols: []const MachoSymbol = &.{
            .{ .addr = 100, .strx = undefined, .ofile = undefined },
            .{ .addr = 200, .strx = undefined, .ofile = undefined },
            .{ .addr = 300, .strx = undefined, .ofile = undefined },
        };

        try testing.expectEqual(null, find(symbols, 0));
        try testing.expectEqual(null, find(symbols, 99));
        try testing.expectEqual(&symbols[0], find(symbols, 100).?);
        try testing.expectEqual(&symbols[0], find(symbols, 150).?);
        try testing.expectEqual(&symbols[0], find(symbols, 199).?);

        try testing.expectEqual(&symbols[1], find(symbols, 200).?);
        try testing.expectEqual(&symbols[1], find(symbols, 250).?);
        try testing.expectEqual(&symbols[1], find(symbols, 299).?);

        try testing.expectEqual(&symbols[2], find(symbols, 300).?);
        try testing.expectEqual(&symbols[2], find(symbols, 301).?);
        try testing.expectEqual(&symbols[2], find(symbols, 5000).?);
    }
};
test {
    _ = MachoSymbol;
}

/// Uses `mmap` to map the file at `path` into memory.
fn mapDebugInfoFile(path: []const u8) ![]align(std.heap.page_size_min) const u8 {
    const file = std.fs.cwd().openFile(path, .{}) catch |err| switch (err) {
        error.FileNotFound => return error.MissingDebugInfo,
        else => return error.ReadFailed,
    };
    defer file.close();

    const file_end_pos = file.getEndPos() catch |err| switch (err) {
        error.Unexpected => |e| return e,
        else => return error.ReadFailed,
    };
    const file_len = std.math.cast(usize, file_end_pos) orelse return error.InvalidDebugInfo;

    return posix.mmap(
        null,
        file_len,
        posix.PROT.READ,
        .{ .TYPE = .SHARED },
        file.handle,
        0,
    ) catch |err| switch (err) {
        error.Unexpected => |e| return e,
        else => return error.ReadFailed,
    };
}

extern "c" fn dladdr(addr: *const anyopaque, info: *dl_info) c_int;

const dl_info = extern struct {
    fname: [*:0]const u8,
    fbase: *anyopaque,
    sname: ?[*:0]const u8,
    saddr: ?*anyopaque,
};

fn initLoadCommandIterator(
    hdr: *const macho.mach_header_64,
    cmds_buf_overlong: []const u8,
) error{InvalidMachO}!macho.LoadCommandIterator {
    if (cmds_buf_overlong.len < hdr.sizeofcmds) return error.InvalidMachO;
    if (hdr.ncmds > 0 and hdr.sizeofcmds < @sizeOf(macho.load_command)) return error.InvalidMachO;
    const cmds_buf = cmds_buf_overlong[0..hdr.sizeofcmds];
    return .{
        .index = 0,
        .ncmds = hdr.ncmds,
        .buffer = cmds_buf,
    };
}

const std = @import("std");
const Io = std.Io;
const Allocator = std.mem.Allocator;
const Dwarf = debug.Dwarf;
const Error = debug.SelfInfoError;
const MachOFile = debug.MachOFile;
const assert = std.debug.assert;
const posix = std.posix;
const macho = std.macho;
const mem = std.mem;
const testing = std.testing;
const debug = @import("../../new_debug.zig");
const dwarfRegNative = debug.Dwarf.SelfUnwinder.regNative;

const builtin = @import("builtin");
const native_endian = builtin.target.cpu.arch.endian();

const SelfInfo = @This();
