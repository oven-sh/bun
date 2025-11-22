//! Implements stack unwinding based on `Dwarf.Unwind`. The caller is responsible for providing the
//! initialized `Dwarf.Unwind` from the `.debug_frame` (or equivalent) section; this type handles
//! computing and applying the CFI register rules to evolve a `std.debug.cpu_context.Native` through
//! stack frames, hence performing the virtual unwind.
//!
//! Notably, this type is a valid implementation of `std.debug.SelfInfo.UnwindContext`.

/// The state of the CPU in the current stack frame.
cpu_state: debug.cpu_context.Native,
/// The value of the Program Counter in this frame. This is almost the same as the value of the IP
/// register in `cpu_state`, but may be off by one because the IP is typically a *return* address.
pc: usize,

cfi_vm: Dwarf.Unwind.VirtualMachine,
expr_vm: Dwarf.expression.StackMachine(.{ .call_frame_context = true }),

pub const CacheEntry = struct {
    const max_rules = 32;

    pc: usize,
    cie: *const Dwarf.Unwind.CommonInformationEntry,
    cfa_rule: Dwarf.Unwind.VirtualMachine.CfaRule,
    num_rules: u8,
    rules_regs: [max_rules]u16,
    rules: [max_rules]Dwarf.Unwind.VirtualMachine.RegisterRule,

    pub fn find(entries: []const CacheEntry, pc: usize) ?*const CacheEntry {
        assert(pc != 0);
        const idx = std.hash.int(pc) % entries.len;
        const entry = &entries[idx];
        return if (entry.pc == pc) entry else null;
    }

    pub fn populate(entry: *const CacheEntry, entries: []CacheEntry) void {
        const idx = std.hash.int(entry.pc) % entries.len;
        entries[idx] = entry.*;
    }

    pub const empty: CacheEntry = .{
        .pc = 0,
        .cie = undefined,
        .cfa_rule = undefined,
        .num_rules = undefined,
        .rules_regs = undefined,
        .rules = undefined,
    };
};

pub fn init(cpu_context: *const debug.cpu_context.Native) SelfUnwinder {
    return .{
        .cpu_state = cpu_context.*,
        .pc = stripInstructionPtrAuthCode(cpu_context.getPc()),
        .cfi_vm = .{},
        .expr_vm = .{},
    };
}

pub fn deinit(unwinder: *SelfUnwinder, gpa: Allocator) void {
    unwinder.cfi_vm.deinit(gpa);
    unwinder.expr_vm.deinit(gpa);
    unwinder.* = undefined;
}

pub fn getFp(unwinder: *const SelfUnwinder) usize {
    return unwinder.cpu_state.getFp();
}

/// Compute the rule set for the address `unwinder.pc` from the information in `unwind`. The caller
/// may store the returned rule set in a simple fixed-size cache keyed on the `pc` field to avoid
/// frequently recomputing register rules when unwinding many times.
///
/// To actually apply the computed rules, see `next`.
pub fn computeRules(
    unwinder: *SelfUnwinder,
    gpa: Allocator,
    unwind: *const Dwarf.Unwind,
    load_offset: usize,
    explicit_fde_offset: ?usize,
) !CacheEntry {
    assert(unwinder.pc != 0);

    const pc_vaddr = unwinder.pc - load_offset;

    const fde_offset = explicit_fde_offset orelse try unwind.lookupPc(
        pc_vaddr,
        @sizeOf(usize),
        native_endian,
    ) orelse return error.MissingDebugInfo;
    const cie, const fde = try unwind.getFde(fde_offset, native_endian);

    // `lookupPc` can return false positives, so check if the FDE *actually* includes the pc
    if (pc_vaddr < fde.pc_begin or pc_vaddr >= fde.pc_begin + fde.pc_range) {
        return error.MissingDebugInfo;
    }

    unwinder.cfi_vm.reset();
    const row = try unwinder.cfi_vm.runTo(gpa, pc_vaddr, cie, &fde, @sizeOf(usize), native_endian);

    var entry: CacheEntry = .{
        .pc = unwinder.pc,
        .cie = cie,
        .cfa_rule = row.cfa,
        .num_rules = undefined,
        .rules_regs = undefined,
        .rules = undefined,
    };
    var i: usize = 0;
    for (unwinder.cfi_vm.rowColumns(&row)) |col| {
        if (i == CacheEntry.max_rules) return error.UnsupportedDebugInfo;

        _ = unwinder.cpu_state.dwarfRegisterBytes(col.register) catch |err| switch (err) {
            // Reading an unsupported register during unwinding will result in an error, so there is
            // no point wasting a rule slot in the cache entry for it.
            error.UnsupportedRegister => continue,
            error.InvalidRegister => return error.InvalidDebugInfo,
        };
        entry.rules_regs[i] = col.register;
        entry.rules[i] = col.rule;
        i += 1;
    }
    entry.num_rules = @intCast(i);
    return entry;
}

/// Applies the register rules given in `cache_entry` to the current state of `unwinder`. The caller
/// is responsible for ensuring that `cache_entry` contains the correct rule set for `unwinder.pc`.
///
/// `unwinder.cpu_state` and `unwinder.pc` are updated to refer to the next frame, and this frame's
/// return address is returned as a `usize`.
pub fn next(unwinder: *SelfUnwinder, gpa: Allocator, cache_entry: *const CacheEntry) debug.SelfInfoError!usize {
    return unwinder.nextInner(gpa, cache_entry) catch |err| switch (err) {
        error.OutOfMemory,
        error.InvalidDebugInfo,
        => |e| return e,

        error.UnsupportedRegister,
        error.UnimplementedExpressionCall,
        error.UnimplementedOpcode,
        error.UnimplementedUserOpcode,
        error.UnimplementedTypedComparison,
        error.UnimplementedTypeConversion,
        error.UnknownExpressionOpcode,
        => return error.UnsupportedDebugInfo,

        error.ReadFailed,
        error.EndOfStream,
        error.Overflow,
        error.IncompatibleRegisterSize,
        error.InvalidRegister,
        error.IncompleteExpressionContext,
        error.InvalidCFAOpcode,
        error.InvalidExpression,
        error.InvalidFrameBase,
        error.InvalidIntegralTypeSize,
        error.InvalidSubExpression,
        error.InvalidTypeLength,
        error.TruncatedIntegralType,
        error.DivisionByZero,
        => return error.InvalidDebugInfo,
    };
}

fn nextInner(unwinder: *SelfUnwinder, gpa: Allocator, cache_entry: *const CacheEntry) !usize {
    const format = cache_entry.cie.format;

    const cfa = switch (cache_entry.cfa_rule) {
        .none => return error.InvalidDebugInfo,
        .reg_off => |ro| cfa: {
            const ptr = try regNative(&unwinder.cpu_state, ro.register);
            break :cfa try applyOffset(ptr.*, ro.offset);
        },
        .expression => |expr| cfa: {
            // On most implemented architectures, the CFA is defined to be the previous frame's SP.
            //
            // On s390x, it's defined to be SP + 160 (ELF ABI s390x Supplement §1.6.3); however,
            // what this actually means is that there will be a `def_cfa r15 + 160`, so nothing
            // special for us to do.
            const prev_cfa_val = (try regNative(&unwinder.cpu_state, sp_reg_num)).*;
            unwinder.expr_vm.reset();
            const value = try unwinder.expr_vm.run(expr, gpa, .{
                .format = format,
                .cpu_context = &unwinder.cpu_state,
            }, prev_cfa_val) orelse return error.InvalidDebugInfo;
            switch (value) {
                .generic => |g| break :cfa g,
                else => return error.InvalidDebugInfo,
            }
        },
    };

    // Create a copy of the CPU state, to which we will apply the new rules.
    var new_cpu_state = unwinder.cpu_state;

    // On all implemented architectures, the CFA is defined to be the previous frame's SP
    (try regNative(&new_cpu_state, sp_reg_num)).* = cfa;

    const return_address_register = cache_entry.cie.return_address_register;
    var has_return_address = true;

    const rules_len = cache_entry.num_rules;
    for (cache_entry.rules_regs[0..rules_len], cache_entry.rules[0..rules_len]) |register, rule| {
        const new_val: union(enum) {
            same,
            undefined,
            val: usize,
            bytes: []const u8,
        } = switch (rule) {
            .default => val: {
                // The way things are supposed to work is that `.undefined` is the default rule
                // unless an ABI says otherwise (e.g. aarch64, s390x).
                //
                // Unfortunately, at some point, a decision was made to have libgcc's unwinder
                // assume `.same` as the default for all registers. Compilers then started depending
                // on this, and the practice was carried forward to LLVM's libunwind and some of its
                // backends.
                break :val .same;
            },
            .undefined => .undefined,
            .same_value => .same,
            .offset => |offset| val: {
                const ptr: *const usize = @ptrFromInt(try applyOffset(cfa, offset));
                break :val .{ .val = ptr.* };
            },
            .val_offset => |offset| .{ .val = try applyOffset(cfa, offset) },
            .register => |r| .{ .bytes = try unwinder.cpu_state.dwarfRegisterBytes(r) },
            .expression => |expr| val: {
                unwinder.expr_vm.reset();
                const value = try unwinder.expr_vm.run(expr, gpa, .{
                    .format = format,
                    .cpu_context = &unwinder.cpu_state,
                }, cfa) orelse return error.InvalidDebugInfo;
                const ptr: *const usize = switch (value) {
                    .generic => |addr| @ptrFromInt(addr),
                    else => return error.InvalidDebugInfo,
                };
                break :val .{ .val = ptr.* };
            },
            .val_expression => |expr| val: {
                unwinder.expr_vm.reset();
                const value = try unwinder.expr_vm.run(expr, gpa, .{
                    .format = format,
                    .cpu_context = &unwinder.cpu_state,
                }, cfa) orelse return error.InvalidDebugInfo;
                switch (value) {
                    .generic => |val| break :val .{ .val = val },
                    else => return error.InvalidDebugInfo,
                }
            },
        };
        switch (new_val) {
            .same => {},
            .undefined => {
                const dest = try new_cpu_state.dwarfRegisterBytes(@intCast(register));
                @memset(dest, undefined);

                // If the return address register is explicitly set to `.undefined`, it means that
                // there are no more frames to unwind.
                if (register == return_address_register) {
                    has_return_address = false;
                }
            },
            .val => |val| {
                const dest = try new_cpu_state.dwarfRegisterBytes(@intCast(register));
                if (dest.len != @sizeOf(usize)) return error.InvalidDebugInfo;
                const dest_ptr: *align(1) usize = @ptrCast(dest);
                dest_ptr.* = val;
            },
            .bytes => |src| {
                const dest = try new_cpu_state.dwarfRegisterBytes(@intCast(register));
                if (dest.len != src.len) return error.InvalidDebugInfo;
                @memcpy(dest, src);
            },
        }
    }

    const return_address = if (has_return_address)
        stripInstructionPtrAuthCode((try regNative(&new_cpu_state, return_address_register)).*)
    else
        0;

    (try regNative(&new_cpu_state, ip_reg_num)).* = return_address;

    // The new CPU state is complete; flush changes.
    unwinder.cpu_state = new_cpu_state;

    // The caller will subtract 1 from the return address to get an address corresponding to the
    // function call. However, if this is a signal frame, that's actually incorrect, because the
    // "return address" we have is the instruction which triggered the signal (if the signal
    // handler returned, the instruction would be re-run). Compensate for this by incrementing
    // the address in that case.
    const adjusted_ret_addr = if (cache_entry.cie.is_signal_frame) return_address +| 1 else return_address;

    // We also want to do that same subtraction here to get the PC for the next frame's FDE.
    // This is because if the callee was noreturn, then the function call might be the caller's
    // last instruction, so `return_address` might actually point outside of it!
    unwinder.pc = adjusted_ret_addr -| 1;

    return adjusted_ret_addr;
}

pub fn regNative(ctx: *debug.cpu_context.Native, num: u16) error{
    InvalidRegister,
    UnsupportedRegister,
    IncompatibleRegisterSize,
}!*align(1) usize {
    const bytes = try ctx.dwarfRegisterBytes(num);
    if (bytes.len != @sizeOf(usize)) return error.IncompatibleRegisterSize;
    return @ptrCast(bytes);
}

/// Since register rules are applied (usually) during a panic,
/// checked addition / subtraction is used so that we can return
/// an error and fall back to FP-based unwinding.
fn applyOffset(base: usize, offset: i64) !usize {
    return if (offset >= 0)
        try std.math.add(usize, base, @as(usize, @intCast(offset)))
    else
        try std.math.sub(usize, base, @as(usize, @intCast(-offset)));
}

const ip_reg_num = Dwarf.ipRegNum(builtin.target.cpu.arch).?;
const sp_reg_num = Dwarf.spRegNum(builtin.target.cpu.arch);

const std = @import("std");
const Allocator = std.mem.Allocator;
const Dwarf = debug.Dwarf;
const assert = std.debug.assert;
const stripInstructionPtrAuthCode = debug.stripInstructionPtrAuthCode;

const builtin = @import("builtin");
const native_endian = builtin.target.cpu.arch.endian();

const SelfUnwinder = @This();
const debug = @import("../../new_debug.zig");
