const std = @import("std");
const Io = std.Io;
const Writer = std.Io.Writer;
const tty = std.Io.tty;
const math = std.math;
const mem = std.mem;
const posix = std.posix;
const fs = std.fs;
const testing = std.testing;
const Allocator = mem.Allocator;
const File = std.fs.File;
const windows = std.os.windows;

const builtin = @import("builtin");
const native_arch = builtin.cpu.arch;
const native_os = builtin.os.tag;
const StackTrace = std.builtin.StackTrace;

const root = @import("root");

pub const Dwarf = @import("./new_debug/Dwarf.zig");
pub const ElfFile = @import("./new_debug/ElfFile.zig");
pub const Pdb = @import("./new_debug/Pdb.zig");
pub const MachOFile = @import("./new_debug/MachOFile.zig");
pub const cpu_context = @import("./new_debug/cpu_context.zig");

/// This type abstracts the target-specific implementation of accessing this process' own debug
/// information behind a generic interface which supports looking up source locations associated
/// with addresses, as well as unwinding the stack where a safe mechanism to do so exists.
///
/// The Zig Standard Library provides default implementations of `SelfInfo` for common targets, but
/// the implementation can be overriden by exposing `root.debug.SelfInfo`. Setting `SelfInfo` to
/// `void` indicates that the `SelfInfo` API is not supported.
///
/// This type must expose the following declarations:
///
/// ```
/// pub const init: SelfInfo;
/// pub fn deinit(si: *SelfInfo, gpa: Allocator) void;
///
/// /// Returns the symbol and source location of the instruction at `address`.
/// pub fn getSymbol(si: *SelfInfo, gpa: Allocator, address: usize) SelfInfoError!Symbol;
/// /// Returns a name for the "module" (e.g. shared library or executable image) containing `address`.
/// pub fn getModuleName(si: *SelfInfo, gpa: Allocator, address: usize) SelfInfoError![]const u8;
///
/// /// Whether a reliable stack unwinding strategy, such as DWARF unwinding, is available.
/// pub const can_unwind: bool;
/// /// Only required if `can_unwind == true`.
/// pub const UnwindContext = struct {
///     /// An address representing the instruction pointer in the last frame.
///     pc: usize,
///
///     pub fn init(ctx: *cpu_context.Native, gpa: Allocator) Allocator.Error!UnwindContext;
///     pub fn deinit(ctx: *UnwindContext, gpa: Allocator) void;
///     /// Returns the frame pointer associated with the last unwound stack frame.
///     /// If the frame pointer is unknown, 0 may be returned instead.
///     pub fn getFp(uc: *UnwindContext) usize;
/// };
/// /// Only required if `can_unwind == true`. Unwinds a single stack frame, returning the frame's
/// /// return address, or 0 if the end of the stack has been reached.
/// pub fn unwindFrame(si: *SelfInfo, gpa: Allocator, context: *UnwindContext) SelfInfoError!usize;
/// ```
pub const SelfInfo = if (@hasDecl(root, "debug") and @hasDecl(root.debug, "SelfInfo"))
    root.debug.SelfInfo
else switch (std.Target.ObjectFormat.default(native_os, native_arch)) {
    .coff => if (native_os == .windows) @import("./new_debug/SelfInfo/Windows.zig") else void,
    .elf => switch (native_os) {
        .freestanding, .other => void,
        else => @import("./new_debug/SelfInfo/Elf.zig"),
    },
    .macho => @import("./new_debug/SelfInfo/MachO.zig"),
    .plan9, .spirv, .wasm => void,
    .c, .hex, .raw, .goff, .xcoff => unreachable,
};

pub const SelfInfoError = error{
    /// The required debug info is invalid or corrupted.
    InvalidDebugInfo,
    /// The required debug info could not be found.
    MissingDebugInfo,
    /// The required debug info was found, and may be valid, but is not supported by this implementation.
    UnsupportedDebugInfo,
    /// The required debug info could not be read from disk due to some IO error.
    ReadFailed,
    OutOfMemory,
    Canceled,
    Unexpected,
};

/// Unresolved source locations can be represented with a single `usize` that
/// corresponds to a virtual memory address of the program counter. Combined
/// with debug information, those values can be converted into a resolved
/// source location, including file, line, and column.
pub const SourceLocation = struct {
    line: u64,
    column: u64,
    file_name: []const u8,

    pub const invalid: SourceLocation = .{
        .line = 0,
        .column = 0,
        .file_name = &.{},
    };
};

pub const Symbol = struct {
    name: ?[]const u8,
    compile_unit_name: ?[]const u8,
    source_location: ?SourceLocation,
    pub const unknown: Symbol = .{
        .name = null,
        .compile_unit_name = null,
        .source_location = null,
    };
};

/// Marked `inline` to propagate a comptime-known error to callers.
pub inline fn getSelfDebugInfo() !*SelfInfo {
    if (SelfInfo == void) return error.UnsupportedTarget;
    const S = struct {
        var self_info: SelfInfo = .init;
    };
    return &S.self_info;
}

/// The pointer through which a `cpu_context.Native` is received from callers of stack tracing logic.
pub const CpuContextPtr = if (cpu_context.Native == noreturn) noreturn else *const cpu_context.Native;

pub const StackUnwindOptions = struct {
    /// If not `null`, we will ignore all frames up until this return address. This is typically
    /// used to omit intermediate handling code (for instance, a panic handler and its machinery)
    /// from stack traces.
    first_address: ?usize = null,
    /// If not `null`, we will unwind from this `cpu_context.Native` instead of the current top of
    /// the stack. The main use case here is printing stack traces from signal handlers, where the
    /// kernel provides a `*const cpu_context.Native` of the state before the signal.
    context: ?CpuContextPtr = null,
    /// If `true`, stack unwinding strategies which may cause crashes are used as a last resort.
    /// If `false`, only known-safe mechanisms will be attempted.
    allow_unsafe_unwind: bool = false,
};

/// Capture and return the current stack trace. The returned `StackTrace` stores its addresses in
/// the given buffer, so `addr_buf` must have a lifetime at least equal to the `StackTrace`.
///
/// See `writeCurrentStackTrace` to immediately print the trace instead of capturing it.
pub noinline fn captureCurrentStackTrace(options: StackUnwindOptions, addr_buf: []usize) StackTrace {
    const empty_trace: StackTrace = .{ .index = 0, .instruction_addresses = &.{} };
    //if (!std.options.allow_stack_tracing) return empty_trace;
    var it: StackIterator = .init(options.context);
    defer it.deinit();
    if (!it.stratOk(options.allow_unsafe_unwind)) return empty_trace;
    var total_frames: usize = 0;
    var index: usize = 0;
    var wait_for = options.first_address;
    // Ideally, we would iterate the whole stack so that the `index` in the returned trace was
    // indicative of how many frames were skipped. However, this has a significant runtime cost
    // in some cases, so at least for now, we don't do that.
    while (index < addr_buf.len) switch (it.next()) {
        .switch_to_fp => if (!it.stratOk(options.allow_unsafe_unwind)) break,
        .end => break,
        .frame => |ret_addr| {
            if (total_frames > 10_000) {
                // Limit the number of frames in case of (e.g.) broken debug information which is
                // getting unwinding stuck in a loop.
                break;
            }
            total_frames += 1;
            if (wait_for) |target| {
                if (ret_addr != target) continue;
                wait_for = null;
            }
            addr_buf[index] = ret_addr;
            index += 1;
        },
    };
    return .{
        .index = index,
        .instruction_addresses = addr_buf[0..index],
    };
}

const StackIterator = union(enum) {
    /// We will first report the current PC of this `CpuContextPtr`, then we will switch to a
    /// different strategy to actually unwind.
    ctx_first: CpuContextPtr,
    /// Unwinding using debug info (e.g. DWARF CFI).
    di: if (SelfInfo != void and SelfInfo.can_unwind and fp_usability != .ideal)
        SelfInfo.UnwindContext
    else
        noreturn,
    /// Naive frame-pointer-based unwinding. Very simple, but typically unreliable.
    fp: usize,

    /// It is important that this function is marked `inline` so that it can safely use
    /// `@frameAddress` and `cpu_context.Native.current` as the caller's stack frame and
    /// our own are one and the same.
    ///
    /// `opt_context_ptr` must remain valid while the `StackIterator` is used.
    inline fn init(opt_context_ptr: ?CpuContextPtr) StackIterator {
        if (opt_context_ptr) |context_ptr| {
            // Use `ctx_first` here so we report the PC in the context before unwinding any further.
            return .{ .ctx_first = context_ptr };
        }

        // Otherwise, we're going to capture the current context or frame address, so we don't need
        // `ctx_first`, because the first PC is in `std.debug` and we need to unwind before reaching
        // a frame we want to report.

        // Workaround the C backend being unable to use inline assembly on MSVC by disabling the
        // call to `current`. This effectively constrains stack trace collection and dumping to FP
        // unwinding when building with CBE for MSVC.
        if (!(builtin.zig_backend == .stage2_c and builtin.target.abi == .msvc) and
            SelfInfo != void and
            SelfInfo.can_unwind and
            cpu_context.Native != noreturn and
            fp_usability != .ideal)
        {
            return .{ .di = .init(&.current()) };
        }
        return .{
            // On SPARC, the frame pointer will point to the previous frame's save area,
            // meaning we will read the previous return address and thus miss a frame.
            // Instead, start at the stack pointer so we get the return address from the
            // current frame's save area. The addition of the stack bias cannot fail here
            // since we know we have a valid stack pointer.
            .fp = if (native_arch.isSPARC()) sp: {
                flushSparcWindows();
                break :sp asm (""
                    : [_] "={o6}" (-> usize),
                ) + stack_bias;
            } else @frameAddress(),
        };
    }
    fn deinit(si: *StackIterator) void {
        switch (si.*) {
            .ctx_first => {},
            .fp => {},
            .di => |*unwind_context| unwind_context.deinit(getDebugInfoAllocator()),
        }
    }

    noinline fn flushSparcWindows() void {
        // Flush all register windows except the current one (hence `noinline`). This ensures that
        // we actually see meaningful data on the stack when we walk the frame chain.
        if (comptime builtin.target.cpu.has(.sparc, .v9))
            asm volatile ("flushw" ::: .{ .memory = true })
        else
            asm volatile ("ta 3" ::: .{ .memory = true }); // ST_FLUSH_WINDOWS
    }

    const FpUsability = enum {
        /// FP unwinding is impractical on this target. For example, due to its very silly ABI
        /// design decisions, it's not possible to do generic FP unwinding on MIPS without a
        /// complicated code scanning algorithm.
        useless,
        /// FP unwinding is unsafe on this target; we may crash when doing so. We will only perform
        /// FP unwinding in the case of crashes/panics, or if the user opts in.
        unsafe,
        /// FP unwinding is guaranteed to be safe on this target. We will do so if unwinding with
        /// debug info does not work, and if this compilation has frame pointers enabled.
        safe,
        /// FP unwinding is the best option on this target. This is usually because the ABI requires
        /// a backchain pointer, thus making it always available, safe, and fast.
        ideal,
    };

    const fp_usability: FpUsability = switch (builtin.target.cpu.arch) {
        .avr,
        .csky,
        .mips,
        .mipsel,
        .mips64,
        .mips64el,
        .msp430,
        .xcore,
        => .useless,
        .hexagon,
        // The PowerPC ABIs don't actually strictly require a backchain pointer; they allow omitting
        // it when full unwind info is present. Despite this, both GCC and Clang always enforce the
        // presence of the backchain pointer no matter what options they are given. This seems to be
        // a case of "the spec is only a polite suggestion", except it works in our favor this time!
        .powerpc,
        .powerpcle,
        .powerpc64,
        .powerpc64le,
        .sparc,
        .sparc64,
        => .ideal,
        // https://developer.apple.com/documentation/xcode/writing-arm64-code-for-apple-platforms#Respect-the-purpose-of-specific-CPU-registers
        .aarch64 => if (builtin.target.os.tag.isDarwin()) .safe else .unsafe,
        else => .unsafe,
    };

    /// Whether the current unwind strategy is allowed given `allow_unsafe`.
    fn stratOk(it: *const StackIterator, allow_unsafe: bool) bool {
        return switch (it.*) {
            .ctx_first, .di => true,
            // If we omitted frame pointers from *this* compilation, FP unwinding would crash
            // immediately regardless of anything. But FPs could also be omitted from a different
            // linked object, so it's not guaranteed to be safe, unless the target specifically
            // requires it.
            .fp => switch (fp_usability) {
                .useless => false,
                .unsafe => allow_unsafe and !builtin.omit_frame_pointer,
                .safe => !builtin.omit_frame_pointer,
                .ideal => true,
            },
        };
    }

    const Result = union(enum) {
        /// A stack frame has been found; this is the corresponding return address.
        frame: usize,
        /// The end of the stack has been reached.
        end,
        /// We were using `SelfInfo.UnwindInfo`, but are now switching to FP unwinding due to this error.
        switch_to_fp: struct {
            address: usize,
            err: SelfInfoError,
        },
    };

    fn next(it: *StackIterator) Result {
        switch (it.*) {
            .ctx_first => |context_ptr| {
                // After the first frame, start actually unwinding.
                it.* = if (SelfInfo != void and SelfInfo.can_unwind and fp_usability != .ideal)
                    .{ .di = .init(context_ptr) }
                else
                    .{ .fp = context_ptr.getFp() };

                // The caller expects *return* addresses, where they will subtract 1 to find the address of the call.
                // However, we have the actual current PC, which should not be adjusted. Compensate by adding 1.
                return .{ .frame = context_ptr.getPc() +| 1 };
            },
            .di => |*unwind_context| {
                const di = getSelfDebugInfo() catch unreachable;
                const di_gpa = getDebugInfoAllocator();
                const ret_addr = di.unwindFrame(di_gpa, unwind_context) catch |err| {
                    const pc = unwind_context.pc;
                    const fp = unwind_context.getFp();
                    it.* = .{ .fp = fp };
                    return .{ .switch_to_fp = .{
                        .address = pc,
                        .err = err,
                    } };
                };
                if (ret_addr <= 1) return .end;
                return .{ .frame = ret_addr };
            },
            .fp => |fp| {
                if (fp == 0) return .end; // we reached the "sentinel" base pointer

                const bp_addr = applyOffset(fp, fp_to_bp_offset) orelse return .end;
                const ra_addr = applyOffset(fp, fp_to_ra_offset) orelse return .end;

                if (bp_addr == 0 or !mem.isAligned(bp_addr, @alignOf(usize)) or
                    ra_addr == 0 or !mem.isAligned(ra_addr, @alignOf(usize)))
                {
                    // This isn't valid, but it most likely indicates end of stack.
                    return .end;
                }

                const bp_ptr: *const usize = @ptrFromInt(bp_addr);
                const ra_ptr: *const usize = @ptrFromInt(ra_addr);
                const bp = applyOffset(bp_ptr.*, stack_bias) orelse return .end;

                // If the stack grows downwards, `bp > fp` should always hold; conversely, if it
                // grows upwards, `bp < fp` should always hold. If that is not the case, this
                // frame is invalid, so we'll treat it as though we reached end of stack. The
                // exception is address 0, which is a graceful end-of-stack signal, in which case
                // *this* return address is valid and the *next* iteration will be the last.
                //if (bp != 0 and switch (comptime builtin.target.stackGrowth()) {
                //    .down => bp <= fp,
                //    .up => bp >= fp,
                //}) return .end;
                if (bp != 0 and bp <= fp) return .end;

                it.fp = bp;
                const ra = stripInstructionPtrAuthCode(ra_ptr.*);
                if (ra <= 1) return .end;
                return .{ .frame = ra };
            },
        }
    }

    /// Offset of the saved base pointer (previous frame pointer) wrt the frame pointer.
    const fp_to_bp_offset = off: {
        // On 32-bit PA-RISC, the base pointer is the final word of the frame marker.
        //if (native_arch == .hppa) break :off -1 * @sizeOf(usize);
        // On 64-bit PA-RISC, the frame marker was shrunk significantly; now there's just the return
        // address followed by the base pointer.
        //if (native_arch == .hppa64) break :off -1 * @sizeOf(usize);
        // On LoongArch and RISC-V, the frame pointer points to the top of the saved register area,
        // in which the base pointer is the first word.
        if (native_arch.isLoongArch() or native_arch.isRISCV()) break :off -2 * @sizeOf(usize);
        // On OpenRISC, the frame pointer is stored below the return address.
        if (native_arch == .or1k) break :off -2 * @sizeOf(usize);
        // On SPARC, the frame pointer points to the save area which holds 16 slots for the local
        // and incoming registers. The base pointer (i6) is stored in its customary save slot.
        if (native_arch.isSPARC()) break :off 14 * @sizeOf(usize);
        // Everywhere else, the frame pointer points directly to the location of the base pointer.
        break :off 0;
    };

    /// Offset of the saved return address wrt the frame pointer.
    const fp_to_ra_offset = off: {
        // On 32-bit PA-RISC, the return address sits in the middle-ish of the frame marker.
        //if (native_arch == .hppa) break :off -5 * @sizeOf(usize);
        // On 64-bit PA-RISC, the frame marker was shrunk significantly; now there's just the return
        // address followed by the base pointer.
        //if (native_arch == .hppa64) break :off -2 * @sizeOf(usize);
        // On LoongArch and RISC-V, the frame pointer points to the top of the saved register area,
        // in which the return address is the second word.
        if (native_arch.isLoongArch() or native_arch.isRISCV()) break :off -1 * @sizeOf(usize);
        // On OpenRISC, the return address is stored below the stack parameter area.
        if (native_arch == .or1k) break :off -1 * @sizeOf(usize);
        if (native_arch.isPowerPC64()) break :off 2 * @sizeOf(usize);
        // On s390x, r14 is the link register and we need to grab it from its customary slot in the
        // register save area (ELF ABI s390x Supplement §1.2.2.2).
        if (native_arch == .s390x) break :off 14 * @sizeOf(usize);
        // On SPARC, the frame pointer points to the save area which holds 16 slots for the local
        // and incoming registers. The return address (i7) is stored in its customary save slot.
        if (native_arch.isSPARC()) break :off 15 * @sizeOf(usize);
        break :off @sizeOf(usize);
    };

    /// Value to add to the stack pointer and frame/base pointers to get the real location being
    /// pointed to. Yes, SPARC really does this.
    const stack_bias = bias: {
        if (native_arch == .sparc64) break :bias 2047;
        break :bias 0;
    };

    /// On some oddball architectures, a return address points to the call instruction rather than
    /// the instruction following it.
    const ra_call_offset = off: {
        if (native_arch.isSPARC()) break :off 0;
        break :off 1;
    };

    fn applyOffset(addr: usize, comptime off: comptime_int) ?usize {
        if (off >= 0) return math.add(usize, addr, off) catch return null;
        return math.sub(usize, addr, -off) catch return null;
    }
};

/// Some platforms use pointer authentication: the upper bits of instruction pointers contain a
/// signature. This function clears those signature bits to make the pointer directly usable.
pub inline fn stripInstructionPtrAuthCode(ptr: usize) usize {
    if (native_arch.isAARCH64()) {
        // `hint 0x07` maps to `xpaclri` (or `nop` if the hardware doesn't support it)
        // The save / restore is because `xpaclri` operates on x30 (LR)
        return asm (
            \\mov x16, x30
            \\mov x30, x15
            \\hint 0x07
            \\mov x15, x30
            \\mov x30, x16
            : [ret] "={x15}" (-> usize),
            : [ptr] "{x15}" (ptr),
            : .{ .x16 = true });
    }

    return ptr;
}

/// The returned allocator should be thread-safe if the compilation is multi-threaded, because
/// multiple threads could capture and/or print stack traces simultaneously.
pub fn getDebugInfoAllocator() Allocator {
    // Allow overriding the debug info allocator by exposing `root.debug.getDebugInfoAllocator`.
    if (@hasDecl(root, "debug") and @hasDecl(root.debug, "getDebugInfoAllocator")) {
        return root.debug.getDebugInfoAllocator();
    }
    // Otherwise, use a global arena backed by the page allocator
    const S = struct {
        var arena: std.heap.ArenaAllocator = .init(std.heap.page_allocator);
        var ts_arena: std.heap.ThreadSafeAllocator = .{ .child_allocator = arena.allocator() };
    };
    return S.ts_arena.allocator();
}
