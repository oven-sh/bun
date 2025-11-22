mutex: std.Thread.Mutex,
modules: std.ArrayList(Module),
module_name_arena: std.heap.ArenaAllocator.State,

pub const init: SelfInfo = .{
    .mutex = .{},
    .modules = .empty,
    .module_name_arena = .{},
};
pub fn deinit(si: *SelfInfo, gpa: Allocator) void {
    for (si.modules.items) |*module| {
        di: {
            const di = &(module.di orelse break :di catch break :di);
            di.deinit(gpa);
        }
    }
    si.modules.deinit(gpa);

    var module_name_arena = si.module_name_arena.promote(gpa);
    module_name_arena.deinit();
}

pub fn getSymbol(si: *SelfInfo, gpa: Allocator, io: Io, address: usize) Error!std.debug.Symbol {
    si.mutex.lock();
    defer si.mutex.unlock();
    const module = try si.findModule(gpa, address);
    const di = try module.getDebugInfo(gpa, io);
    return di.getSymbol(gpa, address - module.base_address);
}
pub fn getModuleName(si: *SelfInfo, gpa: Allocator, address: usize) Error![]const u8 {
    si.mutex.lock();
    defer si.mutex.unlock();
    const module = try si.findModule(gpa, address);
    return module.name;
}
pub fn getModuleSlide(si: *SelfInfo, gpa: Allocator, address: usize) Error!usize {
    si.mutex.lock();
    defer si.mutex.unlock();
    const module = try si.findModule(gpa, address);
    return module.base_address;
}

pub const can_unwind: bool = switch (builtin.cpu.arch) {
    else => true,
    // On x86, `RtlVirtualUnwind` does not exist. We could in theory use `RtlCaptureStackBackTrace`
    // instead, but on x86, it turns out that function is just... doing FP unwinding with esp! It's
    // hard to find implementation details to confirm that, but the most authoritative source I have
    // is an entry in the LLVM mailing list from 2020/08/16 which contains this quote:
    //
    // > x86 doesn't have what most architectures would consider an "unwinder" in the sense of
    // > restoring registers; there is simply a linked list of frames that participate in SEH and
    // > that desire to be called for a dynamic unwind operation, so RtlCaptureStackBackTrace
    // > assumes that EBP-based frames are in use and walks an EBP-based frame chain on x86 - not
    // > all x86 code is written with EBP-based frames so while even though we generally build the
    // > OS that way, you might always run the risk of encountering external code that uses EBP as a
    // > general purpose register for which such an unwind attempt for a stack trace would fail.
    //
    // Regardless, it's easy to effectively confirm this hypothesis just by compiling some code with
    // `-fomit-frame-pointer -OReleaseFast` and observing that `RtlCaptureStackBackTrace` returns an
    // empty trace when it's called in such an application. Note that without `-OReleaseFast` or
    // similar, LLVM seems reluctant to ever clobber ebp, so you'll get a trace returned which just
    // contains all of the kernel32/ntdll frames but none of your own. Don't be deceived---this is
    // just coincidental!
    //
    // Anyway, the point is, the only stack walking primitive on x86-windows is FP unwinding. We
    // *could* ask Microsoft to do that for us with `RtlCaptureStackBackTrace`... but better to just
    // use our existing FP unwinder in `std.debug`!
    .x86 => false,
};
pub const UnwindContext = struct {
    pc: usize,
    cur: windows.CONTEXT,
    history_table: windows.UNWIND_HISTORY_TABLE,
    pub fn init(ctx: *const debug.cpu_context.Native) UnwindContext {
        return .{
            .pc = @returnAddress(),
            .cur = switch (builtin.cpu.arch) {
                .x86_64 => std.mem.zeroInit(windows.CONTEXT, .{
                    .Rax = ctx.gprs.get(.rax),
                    .Rcx = ctx.gprs.get(.rcx),
                    .Rdx = ctx.gprs.get(.rdx),
                    .Rbx = ctx.gprs.get(.rbx),
                    .Rsp = ctx.gprs.get(.rsp),
                    .Rbp = ctx.gprs.get(.rbp),
                    .Rsi = ctx.gprs.get(.rsi),
                    .Rdi = ctx.gprs.get(.rdi),
                    .R8 = ctx.gprs.get(.r8),
                    .R9 = ctx.gprs.get(.r9),
                    .R10 = ctx.gprs.get(.r10),
                    .R11 = ctx.gprs.get(.r11),
                    .R12 = ctx.gprs.get(.r12),
                    .R13 = ctx.gprs.get(.r13),
                    .R14 = ctx.gprs.get(.r14),
                    .R15 = ctx.gprs.get(.r15),
                    .Rip = ctx.gprs.get(.rip),
                }),
                .aarch64 => .{
                    .ContextFlags = 0,
                    .Cpsr = 0,
                    .DUMMYUNIONNAME = .{ .X = ctx.x },
                    .Sp = ctx.sp,
                    .Pc = ctx.pc,
                    .V = @splat(.{ .B = @splat(0) }),
                    .Fpcr = 0,
                    .Fpsr = 0,
                    .Bcr = @splat(0),
                    .Bvr = @splat(0),
                    .Wcr = @splat(0),
                    .Wvr = @splat(0),
                },
                .thumb => .{
                    .ContextFlags = 0,
                    .R0 = ctx.r[0],
                    .R1 = ctx.r[1],
                    .R2 = ctx.r[2],
                    .R3 = ctx.r[3],
                    .R4 = ctx.r[4],
                    .R5 = ctx.r[5],
                    .R6 = ctx.r[6],
                    .R7 = ctx.r[7],
                    .R8 = ctx.r[8],
                    .R9 = ctx.r[9],
                    .R10 = ctx.r[10],
                    .R11 = ctx.r[11],
                    .R12 = ctx.r[12],
                    .Sp = ctx.r[13],
                    .Lr = ctx.r[14],
                    .Pc = ctx.r[15],
                    .Cpsr = 0,
                    .Fpcsr = 0,
                    .Padding = 0,
                    .DUMMYUNIONNAME = .{ .S = @splat(0) },
                    .Bvr = @splat(0),
                    .Bcr = @splat(0),
                    .Wvr = @splat(0),
                    .Wcr = @splat(0),
                    .Padding2 = @splat(0),
                },
                else => comptime unreachable,
            },
            .history_table = std.mem.zeroes(windows.UNWIND_HISTORY_TABLE),
        };
    }
    pub fn deinit(ctx: *UnwindContext, gpa: Allocator) void {
        _ = ctx;
        _ = gpa;
    }
    pub fn getFp(ctx: *UnwindContext) usize {
        return ctx.cur.getRegs().bp;
    }
};
pub fn unwindFrame(si: *SelfInfo, gpa: Allocator, context: *UnwindContext) Error!usize {
    _ = si;
    _ = gpa;

    const current_regs = context.cur.getRegs();
    var image_base: windows.DWORD64 = undefined;
    if (windows.ntdll.RtlLookupFunctionEntry(current_regs.ip, &image_base, &context.history_table)) |runtime_function| {
        var handler_data: ?*anyopaque = null;
        var establisher_frame: u64 = undefined;
        _ = windows.ntdll.RtlVirtualUnwind(
            windows.UNW_FLAG_NHANDLER,
            image_base,
            current_regs.ip,
            runtime_function,
            &context.cur,
            &handler_data,
            &establisher_frame,
            null,
        );
    } else {
        // leaf function
        context.cur.setIp(@as(*const usize, @ptrFromInt(current_regs.sp)).*);
        context.cur.setSp(current_regs.sp + @sizeOf(usize));
    }

    const next_regs = context.cur.getRegs();
    const tib = &windows.teb().NtTib;
    if (next_regs.sp < @intFromPtr(tib.StackLimit) or next_regs.sp > @intFromPtr(tib.StackBase)) {
        context.pc = 0;
        return 0;
    }
    // Like `DwarfUnwindContext.unwindFrame`, adjust our next lookup pc in case the `call` was this
    // function's last instruction making `next_regs.ip` one byte past its end.
    context.pc = next_regs.ip -| 1;
    return next_regs.ip;
}

const Module = struct {
    base_address: usize,
    size: u32,
    name: []const u8,
    handle: windows.HMODULE,

    di: ?(Error!DebugInfo),

    const DebugInfo = struct {
        arena: std.heap.ArenaAllocator.State,
        io: Io,
        coff_image_base: u64,
        mapped_file: ?MappedFile,
        dwarf: ?Dwarf,
        pdb: ?Pdb,
        coff_section_headers: []coff.SectionHeader,

        const MappedFile = struct {
            file: fs.File,
            section_handle: windows.HANDLE,
            section_view: []const u8,
            fn deinit(mf: *const MappedFile) void {
                const process_handle = windows.GetCurrentProcess();
                assert(windows.ntdll.NtUnmapViewOfSection(process_handle, @constCast(mf.section_view.ptr)) == .SUCCESS);
                windows.CloseHandle(mf.section_handle);
                mf.file.close();
            }
        };

        fn deinit(di: *DebugInfo, gpa: Allocator) void {
            const io = di.io;
            if (di.dwarf) |*dwarf| dwarf.deinit(gpa);
            if (di.pdb) |*pdb| {
                pdb.file_reader.file.close(io);
                pdb.deinit();
            }
            if (di.mapped_file) |*mf| mf.deinit();

            var arena = di.arena.promote(gpa);
            arena.deinit();
        }

        fn getSymbol(di: *DebugInfo, gpa: Allocator, vaddr: usize) Error!std.debug.Symbol {
            pdb: {
                const pdb = &(di.pdb orelse break :pdb);
                var coff_section: *align(1) const coff.SectionHeader = undefined;
                const mod_index = for (pdb.sect_contribs) |sect_contrib| {
                    if (sect_contrib.section > di.coff_section_headers.len) continue;
                    // Remember that SectionContribEntry.Section is 1-based.
                    coff_section = &di.coff_section_headers[sect_contrib.section - 1];

                    const vaddr_start = coff_section.virtual_address + sect_contrib.offset;
                    const vaddr_end = vaddr_start + sect_contrib.size;
                    if (vaddr >= vaddr_start and vaddr < vaddr_end) {
                        break sect_contrib.module_index;
                    }
                } else {
                    // we have no information to add to the address
                    break :pdb;
                };
                const module = pdb.getModule(mod_index) catch |err| switch (err) {
                    error.InvalidDebugInfo,
                    error.MissingDebugInfo,
                    error.OutOfMemory,
                    => |e| return e,

                    error.ReadFailed,
                    error.EndOfStream,
                    => return error.InvalidDebugInfo,
                } orelse {
                    return error.InvalidDebugInfo; // bad module index
                };
                return .{
                    .name = pdb.getSymbolName(module, vaddr - coff_section.virtual_address),
                    .compile_unit_name = fs.path.basename(module.obj_file_name),
                    .source_location = pdb.getLineNumberInfo(module, vaddr - coff_section.virtual_address) catch null,
                };
            }
            dwarf: {
                const dwarf = &(di.dwarf orelse break :dwarf);
                const dwarf_address = vaddr + di.coff_image_base;
                return dwarf.getSymbol(gpa, native_endian, dwarf_address) catch |err| switch (err) {
                    error.MissingDebugInfo => break :dwarf,

                    error.InvalidDebugInfo,
                    error.OutOfMemory,
                    => |e| return e,

                    error.ReadFailed,
                    error.EndOfStream,
                    error.Overflow,
                    error.StreamTooLong,
                    => return error.InvalidDebugInfo,
                };
            }
            return error.MissingDebugInfo;
        }
    };

    fn getDebugInfo(module: *Module, gpa: Allocator, io: Io) Error!*DebugInfo {
        if (module.di == null) module.di = loadDebugInfo(module, gpa, io);
        return if (module.di.?) |*di| di else |err| err;
    }
    fn loadDebugInfo(module: *const Module, gpa: Allocator, io: Io) Error!DebugInfo {
        const mapped_ptr: [*]const u8 = @ptrFromInt(module.base_address);
        const mapped = mapped_ptr[0..module.size];
        var coff_obj = coff.Coff.init(mapped, true) catch return error.InvalidDebugInfo;

        var arena_instance: std.heap.ArenaAllocator = .init(gpa);
        errdefer arena_instance.deinit();
        const arena = arena_instance.allocator();

        // The string table is not mapped into memory by the loader, so if a section name is in the
        // string table then we have to map the full image file from disk. This can happen when
        // a binary is produced with -gdwarf, since the section names are longer than 8 bytes.
        const mapped_file: ?DebugInfo.MappedFile = mapped: {
            if (!coff_obj.strtabRequired()) break :mapped null;
            var name_buffer: [windows.PATH_MAX_WIDE + 4:0]u16 = undefined;
            name_buffer[0..4].* = .{ '\\', '?', '?', '\\' }; // openFileAbsoluteW requires the prefix to be present
            const process_handle = windows.GetCurrentProcess();
            const len = windows.kernel32.GetModuleFileNameExW(
                process_handle,
                module.handle,
                name_buffer[4..],
                windows.PATH_MAX_WIDE,
            );
            if (len == 0) return error.MissingDebugInfo;
            const name_w = name_buffer[0 .. len + 4 :0];
            var threaded: Io.Threaded = .init_single_threaded;
            const coff_file = threaded.dirOpenFileWtf16(null, name_w, .{}) catch |err| switch (err) {
                error.Canceled => |e| return e,
                error.Unexpected => |e| return e,
                error.FileNotFound => return error.MissingDebugInfo,

                error.FileTooBig,
                error.IsDir,
                error.NotDir,
                error.SymLinkLoop,
                error.NameTooLong,
                error.BadPathName,
                => return error.InvalidDebugInfo,

                error.SystemResources,
                error.WouldBlock,
                error.AccessDenied,
                error.ProcessNotFound,
                error.PermissionDenied,
                error.NoSpaceLeft,
                error.DeviceBusy,
                error.NoDevice,
                error.SharingViolation,
                error.PathAlreadyExists,
                error.PipeBusy,
                error.NetworkNotFound,
                error.AntivirusInterference,
                error.ProcessFdQuotaExceeded,
                error.SystemFdQuotaExceeded,
                error.FileLocksNotSupported,
                error.FileBusy,
                => return error.ReadFailed,
            };
            errdefer coff_file.close(io);
            var section_handle: windows.HANDLE = undefined;
            const create_section_rc = windows.ntdll.NtCreateSection(
                &section_handle,
                windows.STANDARD_RIGHTS_REQUIRED | windows.SECTION_QUERY | windows.SECTION_MAP_READ,
                null,
                null,
                windows.PAGE_READONLY,
                // The documentation states that if no AllocationAttribute is specified, then SEC_COMMIT is the default.
                // In practice, this isn't the case and specifying 0 will result in INVALID_PARAMETER_6.
                windows.SEC_COMMIT,
                coff_file.handle,
            );
            if (create_section_rc != .SUCCESS) return error.MissingDebugInfo;
            errdefer windows.CloseHandle(section_handle);
            var coff_len: usize = 0;
            var section_view_ptr: ?[*]const u8 = null;
            const map_section_rc = windows.ntdll.NtMapViewOfSection(
                section_handle,
                process_handle,
                @ptrCast(&section_view_ptr),
                null,
                0,
                null,
                &coff_len,
                .ViewUnmap,
                0,
                windows.PAGE_READONLY,
            );
            if (map_section_rc != .SUCCESS) return error.MissingDebugInfo;
            errdefer assert(windows.ntdll.NtUnmapViewOfSection(process_handle, @constCast(section_view_ptr.?)) == .SUCCESS);
            const section_view = section_view_ptr.?[0..coff_len];
            coff_obj = coff.Coff.init(section_view, false) catch return error.InvalidDebugInfo;
            break :mapped .{
                .file = .adaptFromNewApi(coff_file),
                .section_handle = section_handle,
                .section_view = section_view,
            };
        };
        errdefer if (mapped_file) |*mf| mf.deinit();

        const coff_image_base = coff_obj.getImageBase();

        var opt_dwarf: ?Dwarf = dwarf: {
            if (coff_obj.getSectionByName(".debug_info") == null) break :dwarf null;

            var sections: Dwarf.SectionArray = undefined;
            inline for (@typeInfo(Dwarf.Section.Id).@"enum".fields, 0..) |section, i| {
                sections[i] = if (coff_obj.getSectionByName("." ++ section.name)) |section_header| .{
                    .data = try coff_obj.getSectionDataAlloc(section_header, arena),
                    .owned = false,
                } else null;
            }
            break :dwarf .{ .sections = sections };
        };
        errdefer if (opt_dwarf) |*dwarf| dwarf.deinit(gpa);

        if (opt_dwarf) |*dwarf| {
            dwarf.open(gpa, native_endian) catch |err| switch (err) {
                error.Overflow,
                error.EndOfStream,
                error.StreamTooLong,
                error.ReadFailed,
                => return error.InvalidDebugInfo,

                error.InvalidDebugInfo,
                error.MissingDebugInfo,
                error.OutOfMemory,
                => |e| return e,
            };
        }

        var opt_pdb: ?Pdb = pdb: {
            const path = coff_obj.getPdbPath() catch {
                return error.InvalidDebugInfo;
            } orelse {
                break :pdb null;
            };
            const pdb_file_open_result = if (fs.path.isAbsolute(path)) res: {
                break :res std.fs.cwd().openFile(path, .{});
            } else res: {
                const self_dir = fs.selfExeDirPathAlloc(gpa) catch |err| switch (err) {
                    error.OutOfMemory, error.Unexpected => |e| return e,
                    else => return error.ReadFailed,
                };
                defer gpa.free(self_dir);
                const abs_path = try fs.path.join(gpa, &.{ self_dir, path });
                defer gpa.free(abs_path);
                break :res std.fs.cwd().openFile(abs_path, .{});
            };
            const pdb_file = pdb_file_open_result catch |err| switch (err) {
                error.FileNotFound, error.IsDir => break :pdb null,
                else => return error.ReadFailed,
            };
            errdefer pdb_file.close();

            const pdb_reader = try arena.create(Io.File.Reader);
            pdb_reader.* = pdb_file.reader(io, try arena.alloc(u8, 4096));

            var pdb = Pdb.init(gpa, pdb_reader) catch |err| switch (err) {
                error.OutOfMemory, error.ReadFailed, error.Unexpected => |e| return e,
                else => return error.InvalidDebugInfo,
            };
            errdefer pdb.deinit();
            pdb.parseInfoStream() catch |err| switch (err) {
                error.UnknownPDBVersion => return error.UnsupportedDebugInfo,
                error.EndOfStream => return error.InvalidDebugInfo,

                error.InvalidDebugInfo,
                error.MissingDebugInfo,
                error.OutOfMemory,
                error.ReadFailed,
                => |e| return e,
            };
            pdb.parseDbiStream() catch |err| switch (err) {
                error.UnknownPDBVersion => return error.UnsupportedDebugInfo,

                error.EndOfStream,
                error.EOF,
                error.StreamTooLong,
                error.WriteFailed,
                => return error.InvalidDebugInfo,

                error.InvalidDebugInfo,
                error.OutOfMemory,
                error.ReadFailed,
                => |e| return e,
            };

            if (!std.mem.eql(u8, &coff_obj.guid, &pdb.guid) or coff_obj.age != pdb.age)
                return error.InvalidDebugInfo;

            break :pdb pdb;
        };
        errdefer if (opt_pdb) |*pdb| {
            pdb.file_reader.file.close(io);
            pdb.deinit();
        };

        const coff_section_headers: []coff.SectionHeader = if (opt_pdb != null) csh: {
            break :csh try coff_obj.getSectionHeadersAlloc(arena);
        } else &.{};

        return .{
            .arena = arena_instance.state,
            .io = io,
            .coff_image_base = coff_image_base,
            .mapped_file = mapped_file,
            .dwarf = opt_dwarf,
            .pdb = opt_pdb,
            .coff_section_headers = coff_section_headers,
        };
    }
};

/// Assumes we already hold `si.mutex`.
fn findModule(si: *SelfInfo, gpa: Allocator, address: usize) error{ MissingDebugInfo, OutOfMemory, Unexpected }!*Module {
    for (si.modules.items) |*mod| {
        if (address >= mod.base_address and address < mod.base_address + mod.size) {
            return mod;
        }
    }

    // A new module might have been loaded; rebuild the list.
    {
        for (si.modules.items) |*mod| {
            const di = &(mod.di orelse continue catch continue);
            di.deinit(gpa);
        }
        si.modules.clearRetainingCapacity();

        var module_name_arena = si.module_name_arena.promote(gpa);
        defer si.module_name_arena = module_name_arena.state;
        _ = module_name_arena.reset(.retain_capacity);

        const handle = windows.kernel32.CreateToolhelp32Snapshot(windows.TH32CS_SNAPMODULE | windows.TH32CS_SNAPMODULE32, 0);
        if (handle == windows.INVALID_HANDLE_VALUE) {
            return windows.unexpectedError(windows.GetLastError());
        }
        defer windows.CloseHandle(handle);
        var entry: windows.MODULEENTRY32 = undefined;
        entry.dwSize = @sizeOf(windows.MODULEENTRY32);
        var result = windows.kernel32.Module32First(handle, &entry);
        while (result != 0) : (result = windows.kernel32.Module32Next(handle, &entry)) {
            try si.modules.append(gpa, .{
                .base_address = @intFromPtr(entry.modBaseAddr),
                .size = entry.modBaseSize,
                .name = try module_name_arena.allocator().dupe(
                    u8,
                    std.mem.sliceTo(&entry.szModule, 0),
                ),
                .handle = entry.hModule,
                .di = null,
            });
        }
    }

    for (si.modules.items) |*mod| {
        if (address >= mod.base_address and address < mod.base_address + mod.size) {
            return mod;
        }
    }

    return error.MissingDebugInfo;
}

const debug = @import("../../new_debug.zig");
const std = @import("std");
const Io = std.Io;
const Allocator = std.mem.Allocator;
const Dwarf = debug.Dwarf;
const Pdb = debug.Pdb;
const Error = debug.SelfInfoError;
const assert = std.debug.assert;
const coff = std.coff;
const fs = std.fs;
const windows = std.os.windows;

const builtin = @import("builtin");
const native_endian = builtin.target.cpu.arch.endian();

const SelfInfo = @This();
