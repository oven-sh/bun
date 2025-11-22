rwlock: std.Thread.RwLock,

modules: std.ArrayList(Module),
ranges: std.ArrayList(Module.Range),

unwind_cache: if (can_unwind) ?[]Dwarf.SelfUnwinder.CacheEntry else ?noreturn,

pub const init: SelfInfo = .{
    .rwlock = .{},
    .modules = .empty,
    .ranges = .empty,
    .unwind_cache = null,
};
pub fn deinit(si: *SelfInfo, gpa: Allocator) void {
    for (si.modules.items) |*mod| {
        unwind: {
            const u = &(mod.unwind orelse break :unwind catch break :unwind);
            for (u.buf[0..u.len]) |*unwind| unwind.deinit(gpa);
        }
        loaded: {
            const l = &(mod.loaded_elf orelse break :loaded catch break :loaded);
            l.file.deinit(gpa);
        }
    }

    si.modules.deinit(gpa);
    si.ranges.deinit(gpa);
    if (si.unwind_cache) |cache| gpa.free(cache);
}

pub fn getSymbol(si: *SelfInfo, gpa: Allocator, io: Io, address: usize) Error!std.debug.Symbol {
    _ = io;
    const module = try si.findModule(gpa, address, .exclusive);
    defer si.rwlock.unlock();

    const vaddr = address - module.load_offset;

    const loaded_elf = try module.getLoadedElf(gpa);
    if (loaded_elf.file.dwarf) |*dwarf| {
        if (!loaded_elf.scanned_dwarf) {
            dwarf.open(gpa, native_endian) catch |err| switch (err) {
                error.InvalidDebugInfo,
                error.MissingDebugInfo,
                error.OutOfMemory,
                => |e| return e,
                error.EndOfStream,
                error.Overflow,
                error.ReadFailed,
                error.StreamTooLong,
                => return error.InvalidDebugInfo,
            };
            loaded_elf.scanned_dwarf = true;
        }
        if (dwarf.getSymbol(gpa, native_endian, vaddr)) |sym| {
            return sym;
        } else |err| switch (err) {
            error.MissingDebugInfo => {},

            error.InvalidDebugInfo,
            error.OutOfMemory,
            => |e| return e,

            error.ReadFailed,
            error.EndOfStream,
            error.Overflow,
            error.StreamTooLong,
            => return error.InvalidDebugInfo,
        }
    }
    // When DWARF is unavailable, fall back to searching the symtab.
    return loaded_elf.file.searchSymtab(gpa, vaddr) catch |err| switch (err) {
        error.NoSymtab, error.NoStrtab => return error.MissingDebugInfo,
        error.BadSymtab => return error.InvalidDebugInfo,
        error.OutOfMemory => |e| return e,
    };
}
pub fn getModuleName(si: *SelfInfo, gpa: Allocator, address: usize) Error![]const u8 {
    const module = try si.findModule(gpa, address, .shared);
    defer si.rwlock.unlockShared();
    if (module.name.len == 0) return error.MissingDebugInfo;
    return module.name;
}
pub fn getModuleSlide(si: *SelfInfo, gpa: Allocator, address: usize) Error!usize {
    const module = try si.findModule(gpa, address, .shared);
    defer si.rwlock.unlockShared();
    return module.load_offset;
}

pub const can_unwind: bool = s: {
    // The DWARF code can't deal with ILP32 ABIs yet: https://github.com/ziglang/zig/issues/25447
    switch (builtin.target.abi) {
        .gnuabin32,
        .muslabin32,
        .gnux32,
        .muslx32,
        => break :s false,
        else => {},
    }

    // Notably, we are yet to support unwinding on ARM. There, unwinding is not done through
    // `.eh_frame`, but instead with the `.ARM.exidx` section, which has a different format.
    const archs: []const std.Target.Cpu.Arch = switch (builtin.target.os.tag) {
        // Not supported yet: arm
        .haiku => &.{
            .aarch64,
            .m68k,
            .riscv64,
            .x86,
            .x86_64,
        },
        // Not supported yet: arm/armeb/thumb/thumbeb, xtensa/xtensaeb
        .linux => &.{
            .aarch64,
            .aarch64_be,
            .arc,
            .csky,
            .loongarch64,
            .m68k,
            .mips,
            .mipsel,
            .mips64,
            .mips64el,
            .or1k,
            .riscv32,
            .riscv64,
            .s390x,
            .x86,
            .x86_64,
        },
        .serenity => &.{
            .aarch64,
            .x86_64,
            .riscv64,
        },

        .dragonfly => &.{
            .x86_64,
        },
        // Not supported yet: arm
        .freebsd => &.{
            .aarch64,
            .riscv64,
            .x86_64,
        },
        // Not supported yet: arm/armeb, mips64/mips64el
        .netbsd => &.{
            .aarch64,
            .aarch64_be,
            .m68k,
            .mips,
            .mipsel,
            .x86,
            .x86_64,
        },
        // Not supported yet: arm
        .openbsd => &.{
            .aarch64,
            .mips64,
            .mips64el,
            .riscv64,
            .x86,
            .x86_64,
        },

        .illumos => &.{
            .x86,
            .x86_64,
        },

        else => unreachable,
    };
    for (archs) |a| {
        if (builtin.target.cpu.arch == a) break :s true;
    }
    break :s false;
};
comptime {
    if (can_unwind) {
        std.debug.assert(Dwarf.supportsUnwinding(&builtin.target));
    }
}
pub const UnwindContext = Dwarf.SelfUnwinder;
pub fn unwindFrame(si: *SelfInfo, gpa: Allocator, context: *UnwindContext) Error!usize {
    comptime assert(can_unwind);

    {
        si.rwlock.lockShared();
        defer si.rwlock.unlockShared();
        if (si.unwind_cache) |cache| {
            if (Dwarf.SelfUnwinder.CacheEntry.find(cache, context.pc)) |entry| {
                return context.next(gpa, entry);
            }
        }
    }

    const module = try si.findModule(gpa, context.pc, .exclusive);
    defer si.rwlock.unlock();

    if (si.unwind_cache == null) {
        si.unwind_cache = try gpa.alloc(Dwarf.SelfUnwinder.CacheEntry, 2048);
        @memset(si.unwind_cache.?, .empty);
    }

    const unwind_sections = try module.getUnwindSections(gpa);
    for (unwind_sections) |*unwind| {
        if (context.computeRules(gpa, unwind, module.load_offset, null)) |entry| {
            entry.populate(si.unwind_cache.?);
            return context.next(gpa, &entry);
        } else |err| switch (err) {
            error.MissingDebugInfo => continue,

            error.InvalidDebugInfo,
            error.UnsupportedDebugInfo,
            error.OutOfMemory,
            => |e| return e,

            error.EndOfStream,
            error.StreamTooLong,
            error.ReadFailed,
            error.Overflow,
            error.InvalidOpcode,
            error.InvalidOperation,
            error.InvalidOperand,
            => return error.InvalidDebugInfo,

            error.UnimplementedUserOpcode,
            error.UnsupportedAddrSize,
            => return error.UnsupportedDebugInfo,
        }
    }
    return error.MissingDebugInfo;
}

const Module = struct {
    load_offset: usize,
    name: []const u8,
    build_id: ?[]const u8,
    gnu_eh_frame: ?[]const u8,

    /// `null` means unwind information has not yet been loaded.
    unwind: ?(Error!UnwindSections),

    /// `null` means the ELF file has not yet been loaded.
    loaded_elf: ?(Error!LoadedElf),

    const LoadedElf = struct {
        file: debug.ElfFile,
        scanned_dwarf: bool,
    };

    const UnwindSections = struct {
        buf: [2]Dwarf.Unwind,
        len: usize,
    };

    const Range = struct {
        start: usize,
        len: usize,
        /// Index into `modules`
        module_index: usize,
    };

    /// Assumes we already hold an exclusive lock.
    fn getUnwindSections(mod: *Module, gpa: Allocator) Error![]Dwarf.Unwind {
        if (mod.unwind == null) mod.unwind = loadUnwindSections(mod, gpa);
        const us = &(mod.unwind.? catch |err| return err);
        return us.buf[0..us.len];
    }
    fn loadUnwindSections(mod: *Module, gpa: Allocator) Error!UnwindSections {
        var us: UnwindSections = .{
            .buf = undefined,
            .len = 0,
        };
        if (mod.gnu_eh_frame) |section_bytes| {
            const section_vaddr: u64 = @intFromPtr(section_bytes.ptr) - mod.load_offset;
            const header = Dwarf.Unwind.EhFrameHeader.parse(section_vaddr, section_bytes, @sizeOf(usize), native_endian) catch |err| switch (err) {
                error.ReadFailed => unreachable, // it's all fixed buffers
                error.InvalidDebugInfo => |e| return e,
                error.EndOfStream, error.Overflow => return error.InvalidDebugInfo,
                error.UnsupportedAddrSize => return error.UnsupportedDebugInfo,
            };
            us.buf[us.len] = .initEhFrameHdr(header, section_vaddr, @ptrFromInt(@as(usize, @intCast(mod.load_offset + header.eh_frame_vaddr))));
            us.len += 1;
        } else {
            // There is no `.eh_frame_hdr` section. There may still be an `.eh_frame` or `.debug_frame`
            // section, but we'll have to load the binary to get at it.
            const loaded = try mod.getLoadedElf(gpa);
            // If both are present, we can't just pick one -- the info could be split between them.
            // `.debug_frame` is likely to be the more complete section, so we'll prioritize that one.
            if (loaded.file.debug_frame) |*debug_frame| {
                us.buf[us.len] = .initSection(.debug_frame, debug_frame.vaddr, debug_frame.bytes);
                us.len += 1;
            }
            if (loaded.file.eh_frame) |*eh_frame| {
                us.buf[us.len] = .initSection(.eh_frame, eh_frame.vaddr, eh_frame.bytes);
                us.len += 1;
            }
        }
        errdefer for (us.buf[0..us.len]) |*u| u.deinit(gpa);
        for (us.buf[0..us.len]) |*u| u.prepare(gpa, @sizeOf(usize), native_endian, true, false) catch |err| switch (err) {
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
        return us;
    }

    /// Assumes we already hold an exclusive lock.
    fn getLoadedElf(mod: *Module, gpa: Allocator) Error!*LoadedElf {
        if (mod.loaded_elf == null) mod.loaded_elf = loadElf(mod, gpa);
        return if (mod.loaded_elf.?) |*elf| elf else |err| err;
    }
    fn loadElf(mod: *Module, gpa: Allocator) Error!LoadedElf {
        const load_result = if (mod.name.len > 0) res: {
            var file = std.fs.cwd().openFile(mod.name, .{}) catch return error.MissingDebugInfo;
            defer file.close();
            break :res debug.ElfFile.load(gpa, file, mod.build_id, &.native(mod.name));
        } else res: {
            const path = std.fs.selfExePathAlloc(gpa) catch |err| switch (err) {
                error.OutOfMemory => |e| return e,
                else => return error.ReadFailed,
            };
            defer gpa.free(path);
            var file = std.fs.cwd().openFile(path, .{}) catch return error.MissingDebugInfo;
            defer file.close();
            break :res debug.ElfFile.load(gpa, file, mod.build_id, &.native(path));
        };

        var elf_file = load_result catch |err| switch (err) {
            error.OutOfMemory,
            error.Unexpected,
            error.Canceled,
            => |e| return e,

            error.Overflow,
            error.TruncatedElfFile,
            error.InvalidCompressedSection,
            error.InvalidElfMagic,
            error.InvalidElfVersion,
            error.InvalidElfClass,
            error.InvalidElfEndian,
            => return error.InvalidDebugInfo,

            error.SystemResources,
            error.MemoryMappingNotSupported,
            error.AccessDenied,
            error.LockedMemoryLimitExceeded,
            error.ProcessFdQuotaExceeded,
            error.SystemFdQuotaExceeded,
            error.Streaming,
            => return error.ReadFailed,
        };
        errdefer elf_file.deinit(gpa);

        if (elf_file.endian != native_endian) return error.InvalidDebugInfo;
        if (elf_file.is_64 != (@sizeOf(usize) == 8)) return error.InvalidDebugInfo;

        return .{
            .file = elf_file,
            .scanned_dwarf = false,
        };
    }
};

fn findModule(si: *SelfInfo, gpa: Allocator, address: usize, lock: enum { shared, exclusive }) Error!*Module {
    // With the requested lock, scan the module ranges looking for `address`.
    switch (lock) {
        .shared => si.rwlock.lockShared(),
        .exclusive => si.rwlock.lock(),
    }
    for (si.ranges.items) |*range| {
        if (address >= range.start and address < range.start + range.len) {
            return &si.modules.items[range.module_index];
        }
    }
    // The address wasn't in a known range. We will rebuild the module/range lists, since it's possible
    // a new module was loaded. Upgrade to an exclusive lock if necessary.
    switch (lock) {
        .shared => {
            si.rwlock.unlockShared();
            si.rwlock.lock();
        },
        .exclusive => {},
    }
    // Rebuild module list with the exclusive lock.
    {
        errdefer si.rwlock.unlock();
        for (si.modules.items) |*mod| {
            unwind: {
                const u = &(mod.unwind orelse break :unwind catch break :unwind);
                for (u.buf[0..u.len]) |*unwind| unwind.deinit(gpa);
            }
            loaded: {
                const l = &(mod.loaded_elf orelse break :loaded catch break :loaded);
                l.file.deinit(gpa);
            }
        }
        si.modules.clearRetainingCapacity();
        si.ranges.clearRetainingCapacity();
        var ctx: DlIterContext = .{ .si = si, .gpa = gpa };
        try std.posix.dl_iterate_phdr(&ctx, error{OutOfMemory}, DlIterContext.callback);
    }
    // Downgrade the lock back to shared if necessary.
    switch (lock) {
        .shared => {
            si.rwlock.unlock();
            si.rwlock.lockShared();
        },
        .exclusive => {},
    }
    // Scan the newly rebuilt module ranges.
    for (si.ranges.items) |*range| {
        if (address >= range.start and address < range.start + range.len) {
            return &si.modules.items[range.module_index];
        }
    }
    // Still nothing; unlock and error.
    switch (lock) {
        .shared => si.rwlock.unlockShared(),
        .exclusive => si.rwlock.unlock(),
    }
    return error.MissingDebugInfo;
}
const DlIterContext = struct {
    si: *SelfInfo,
    gpa: Allocator,

    fn callback(info: *std.posix.dl_phdr_info, size: usize, context: *@This()) !void {
        _ = size;

        var build_id: ?[]const u8 = null;
        var gnu_eh_frame: ?[]const u8 = null;

        // Populate `build_id` and `gnu_eh_frame`
        for (info.phdr[0..info.phnum]) |phdr| {
            //switch (phdr.type) {
            //    .NOTE => {
            //        // Look for .note.gnu.build-id
            //        const segment_ptr: [*]const u8 = @ptrFromInt(info.addr + phdr.vaddr);
            //        var r: std.Io.Reader = .fixed(segment_ptr[0..phdr.memsz]);
            //        const name_size = r.takeInt(u32, native_endian) catch continue;
            //        const desc_size = r.takeInt(u32, native_endian) catch continue;
            //        const note_type = r.takeInt(u32, native_endian) catch continue;
            //        const name = r.take(name_size) catch continue;
            //        if (note_type != std.elf.NT_GNU_BUILD_ID) continue;
            //        if (!std.mem.eql(u8, name, "GNU\x00")) continue;
            //        const desc = r.take(desc_size) catch continue;
            //        build_id = desc;
            //    },
            //    std.elf.PT.GNU_EH_FRAME => {
            //        const segment_ptr: [*]const u8 = @ptrFromInt(info.addr + phdr.vaddr);
            //        gnu_eh_frame = segment_ptr[0..phdr.memsz];
            //    },
            //    else => {},
            //}
            switch (phdr.p_type) {
                std.elf.PT_NOTE => {
                    // Look for .note.gnu.build-id
                    const segment_ptr: [*]const u8 = @ptrFromInt(info.addr + phdr.p_vaddr);
                    var r: std.Io.Reader = .fixed(segment_ptr[0..phdr.p_memsz]);
                    const name_size = r.takeInt(u32, native_endian) catch continue;
                    const desc_size = r.takeInt(u32, native_endian) catch continue;
                    const note_type = r.takeInt(u32, native_endian) catch continue;
                    const name = r.take(name_size) catch continue;
                    if (note_type != std.elf.NT_GNU_BUILD_ID) continue;
                    if (!std.mem.eql(u8, name, "GNU\x00")) continue;
                    const desc = r.take(desc_size) catch continue;
                    build_id = desc;
                },
                std.elf.PT_GNU_EH_FRAME => {
                    const segment_ptr: [*]const u8 = @ptrFromInt(info.addr + phdr.p_vaddr);
                    gnu_eh_frame = segment_ptr[0..phdr.p_memsz];
                },
                else => {},
            }
        }

        const gpa = context.gpa;
        const si = context.si;

        const module_index = si.modules.items.len;
        try si.modules.append(gpa, .{
            .load_offset = info.addr,
            // Android libc uses NULL instead of "" to mark the main program
            .name = std.mem.sliceTo(info.name, 0) orelse "",
            .build_id = build_id,
            .gnu_eh_frame = gnu_eh_frame,
            .unwind = null,
            .loaded_elf = null,
        });

        for (info.phdr[0..info.phnum]) |phdr| {
            if (phdr.p_type != std.elf.PT_LOAD) continue;
            try context.si.ranges.append(gpa, .{
                // Overflowing addition handles VSDOs having p_vaddr = 0xffffffffff700000
                .start = info.addr +% phdr.p_vaddr,
                .len = phdr.p_memsz,
                .module_index = module_index,
            });
        }
    }
};

const debug = @import("../../new_debug.zig");

const std = @import("std");
const Io = std.Io;
const Allocator = std.mem.Allocator;
const Dwarf = debug.Dwarf;
const Error = debug.SelfInfoError;
const assert = std.debug.assert;

const builtin = @import("builtin");
const native_endian = builtin.target.cpu.arch.endian();

const SelfInfo = @This();
