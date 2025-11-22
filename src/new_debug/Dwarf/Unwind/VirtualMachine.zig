//! Virtual machine that evaluates DWARF call frame instructions

/// See section 6.4.1 of the DWARF5 specification for details on each
pub const RegisterRule = union(enum) {
    /// The spec says that the default rule for each column is the undefined rule.
    /// However, it also allows ABI / compiler authors to specify alternate defaults, so
    /// there is a distinction made here.
    default,
    undefined,
    same_value,
    /// offset(N)
    offset: i64,
    /// val_offset(N)
    val_offset: i64,
    /// register(R)
    register: u8,
    /// expression(E)
    expression: []const u8,
    /// val_expression(E)
    val_expression: []const u8,
};

pub const CfaRule = union(enum) {
    none,
    reg_off: struct {
        register: u8,
        offset: i64,
    },
    expression: []const u8,
};

/// Each row contains unwinding rules for a set of registers.
pub const Row = struct {
    /// Offset from `FrameDescriptionEntry.pc_begin`
    offset: u64 = 0,
    cfa: CfaRule = .none,
    /// The register fields in these columns define the register the rule applies to.
    columns: ColumnRange = .{ .start = undefined, .len = 0 },
};

pub const Column = struct {
    register: u8,
    rule: RegisterRule,
};

const ColumnRange = struct {
    start: usize,
    len: u8,
};

columns: std.ArrayList(Column) = .empty,
stack: std.ArrayList(struct {
    cfa: CfaRule,
    columns: ColumnRange,
}) = .empty,
current_row: Row = .{},

/// The result of executing the CIE's initial_instructions
cie_row: ?Row = null,

pub fn deinit(self: *VirtualMachine, gpa: Allocator) void {
    self.stack.deinit(gpa);
    self.columns.deinit(gpa);
    self.* = undefined;
}

pub fn reset(self: *VirtualMachine) void {
    self.stack.clearRetainingCapacity();
    self.columns.clearRetainingCapacity();
    self.current_row = .{};
    self.cie_row = null;
}

/// Return a slice backed by the row's non-CFA columns
pub fn rowColumns(self: *const VirtualMachine, row: *const Row) []Column {
    if (row.columns.len == 0) return &.{};
    return self.columns.items[row.columns.start..][0..row.columns.len];
}

/// Either retrieves or adds a column for `register` (non-CFA) in the current row.
fn getOrAddColumn(self: *VirtualMachine, gpa: Allocator, register: u8) !*Column {
    for (self.rowColumns(&self.current_row)) |*c| {
        if (c.register == register) return c;
    }

    if (self.current_row.columns.len == 0) {
        self.current_row.columns.start = self.columns.items.len;
    } else {
        assert(self.current_row.columns.start + self.current_row.columns.len == self.columns.items.len);
    }
    self.current_row.columns.len += 1;

    const column = try self.columns.addOne(gpa);
    column.* = .{
        .register = register,
        .rule = .default,
    };

    return column;
}

pub fn populateCieLastRow(
    gpa: Allocator,
    cie: *Unwind.CommonInformationEntry,
    addr_size_bytes: u8,
    endian: std.builtin.Endian,
) !void {
    assert(cie.last_row == null);

    var vm: VirtualMachine = .{};
    defer vm.deinit(gpa);

    try vm.evalInstructions(
        gpa,
        cie,
        std.math.maxInt(u64),
        cie.initial_instructions,
        addr_size_bytes,
        endian,
    );

    cie.last_row = .{
        .offset = vm.current_row.offset,
        .cfa = vm.current_row.cfa,
        .cols = try gpa.dupe(Column, vm.rowColumns(&vm.current_row)),
    };
}

/// Runs the CIE instructions, then the FDE instructions. Execution halts
/// once the row that corresponds to `pc` is known, and the row is returned.
pub fn runTo(
    vm: *VirtualMachine,
    gpa: Allocator,
    pc: u64,
    cie: *const Unwind.CommonInformationEntry,
    fde: *const Unwind.FrameDescriptionEntry,
    addr_size_bytes: u8,
    endian: std.builtin.Endian,
) !Row {
    assert(vm.cie_row == null);

    const target_offset = pc - fde.pc_begin;
    assert(target_offset < fde.pc_range);

    const instruction_bytes: []const u8 = insts: {
        if (target_offset < cie.last_row.?.offset) {
            break :insts cie.initial_instructions;
        }
        // This is the more common case: start from the CIE's last row.
        assert(vm.columns.items.len == 0);
        vm.current_row = .{
            .offset = cie.last_row.?.offset,
            .cfa = cie.last_row.?.cfa,
            .columns = .{
                .start = 0,
                .len = @intCast(cie.last_row.?.cols.len),
            },
        };
        try vm.columns.appendSlice(gpa, cie.last_row.?.cols);
        vm.cie_row = vm.current_row;
        break :insts fde.instructions;
    };

    try vm.evalInstructions(
        gpa,
        cie,
        target_offset,
        instruction_bytes,
        addr_size_bytes,
        endian,
    );
    return vm.current_row;
}

/// Evaluates instructions from `instruction_bytes` until `target_addr` is reached or all
/// instructions have been evaluated.
fn evalInstructions(
    vm: *VirtualMachine,
    gpa: Allocator,
    cie: *const Unwind.CommonInformationEntry,
    target_addr: u64,
    instruction_bytes: []const u8,
    addr_size_bytes: u8,
    endian: std.builtin.Endian,
) !void {
    var fr: std.Io.Reader = .fixed(instruction_bytes);
    while (fr.seek < fr.buffer.len) {
        switch (try Instruction.read(&fr, addr_size_bytes, endian)) {
            .nop => {
                // If there was one nop, there's a good chance we've reached the padding and so
                // everything left is a nop, which is represented by a 0 byte.
                if (std.mem.allEqual(u8, fr.buffered(), 0)) return;
            },

            .remember_state => {
                try vm.stack.append(gpa, .{
                    .cfa = vm.current_row.cfa,
                    .columns = vm.current_row.columns,
                });
                const cols_len = vm.current_row.columns.len;
                const copy_start = vm.columns.items.len;
                assert(vm.current_row.columns.start == copy_start - cols_len);
                try vm.columns.ensureUnusedCapacity(gpa, cols_len); // to prevent aliasing issues
                vm.columns.appendSliceAssumeCapacity(vm.columns.items[copy_start - cols_len ..]);
                vm.current_row.columns.start = copy_start;
            },
            .restore_state => {
                const restored = vm.stack.pop() orelse return error.InvalidOperation;
                vm.columns.shrinkRetainingCapacity(restored.columns.start + restored.columns.len);

                vm.current_row.cfa = restored.cfa;
                vm.current_row.columns = restored.columns;
            },

            .advance_loc => |delta| {
                const new_addr = vm.current_row.offset + delta * cie.code_alignment_factor;
                if (new_addr > target_addr) return;
                vm.current_row.offset = new_addr;
            },
            .set_loc => |new_addr| {
                if (new_addr <= vm.current_row.offset) return error.InvalidOperation;
                if (cie.segment_selector_size != 0) return error.InvalidOperation; // unsupported
                // TODO: Check cie.segment_selector_size != 0 for DWARFV4

                if (new_addr > target_addr) return;
                vm.current_row.offset = new_addr;
            },

            .register => |reg| {
                const column = try vm.getOrAddColumn(gpa, reg.index);
                column.rule = switch (reg.rule) {
                    .restore => rule: {
                        const cie_row = &(vm.cie_row orelse return error.InvalidOperation);
                        for (vm.rowColumns(cie_row)) |cie_col| {
                            if (cie_col.register == reg.index) break :rule cie_col.rule;
                        }
                        break :rule .default;
                    },
                    .undefined => .undefined,
                    .same_value => .same_value,
                    .offset_uf => |off| .{ .offset = @as(i64, @intCast(off)) * cie.data_alignment_factor },
                    .offset_sf => |off| .{ .offset = off * cie.data_alignment_factor },
                    .val_offset_uf => |off| .{ .val_offset = @as(i64, @intCast(off)) * cie.data_alignment_factor },
                    .val_offset_sf => |off| .{ .val_offset = off * cie.data_alignment_factor },
                    .register => |callee_reg| .{ .register = callee_reg },
                    .expr => |len| .{ .expression = try takeExprBlock(&fr, len) },
                    .val_expr => |len| .{ .val_expression = try takeExprBlock(&fr, len) },
                };
            },
            .def_cfa => |cfa| vm.current_row.cfa = .{ .reg_off = .{
                .register = cfa.register,
                .offset = @intCast(cfa.offset),
            } },
            .def_cfa_sf => |cfa| vm.current_row.cfa = .{ .reg_off = .{
                .register = cfa.register,
                .offset = cfa.offset_sf * cie.data_alignment_factor,
            } },
            .def_cfa_reg => |register| switch (vm.current_row.cfa) {
                .none => {
                    // According to the DWARF specification, this is not valid, because this
                    // instruction can only be used to replace the register if the rule is already a
                    // `.reg_off`. However, this is emitted in practice by GNU toolchains for some
                    // targets, and so by convention is interpreted as equivalent to `.def_cfa` with
                    // an offset of 0.
                    vm.current_row.cfa = .{ .reg_off = .{
                        .register = register,
                        .offset = 0,
                    } };
                },
                .expression => return error.InvalidOperation,
                .reg_off => |*ro| ro.register = register,
            },
            .def_cfa_offset => |offset| switch (vm.current_row.cfa) {
                .none, .expression => return error.InvalidOperation,
                .reg_off => |*ro| ro.offset = @intCast(offset),
            },
            .def_cfa_offset_sf => |offset_sf| switch (vm.current_row.cfa) {
                .none, .expression => return error.InvalidOperation,
                .reg_off => |*ro| ro.offset = offset_sf * cie.data_alignment_factor,
            },
            .def_cfa_expr => |len| {
                vm.current_row.cfa = .{ .expression = try takeExprBlock(&fr, len) };
            },
        }
    }
}

fn takeExprBlock(r: *std.Io.Reader, len: usize) error{ ReadFailed, InvalidOperand }![]const u8 {
    return r.take(len) catch |err| switch (err) {
        error.ReadFailed => |e| return e,
        error.EndOfStream => return error.InvalidOperand,
    };
}

const OpcodeByte = packed struct(u8) {
    low: packed union {
        operand: u6,
        extended: enum(u6) {
            nop = 0,
            set_loc = 1,
            advance_loc1 = 2,
            advance_loc2 = 3,
            advance_loc4 = 4,
            offset_extended = 5,
            restore_extended = 6,
            undefined = 7,
            same_value = 8,
            register = 9,
            remember_state = 10,
            restore_state = 11,
            def_cfa = 12,
            def_cfa_register = 13,
            def_cfa_offset = 14,
            def_cfa_expression = 15,
            expression = 16,
            offset_extended_sf = 17,
            def_cfa_sf = 18,
            def_cfa_offset_sf = 19,
            val_offset = 20,
            val_offset_sf = 21,
            val_expression = 22,
            _,
        },
    },
    opcode: enum(u2) {
        extended = 0,
        advance_loc = 1,
        offset = 2,
        restore = 3,
    },
};

pub const Instruction = union(enum) {
    nop,
    remember_state,
    restore_state,
    advance_loc: u32,
    set_loc: u64,

    register: struct {
        index: u8,
        rule: union(enum) {
            restore, // restore from cie
            undefined,
            same_value,
            offset_uf: u64,
            offset_sf: i64,
            val_offset_uf: u64,
            val_offset_sf: i64,
            register: u8,
            /// Value is the number of bytes in the DWARF expression, which the caller must read.
            expr: usize,
            /// Value is the number of bytes in the DWARF expression, which the caller must read.
            val_expr: usize,
        },
    },

    def_cfa: struct {
        register: u8,
        offset: u64,
    },
    def_cfa_sf: struct {
        register: u8,
        offset_sf: i64,
    },
    def_cfa_reg: u8,
    def_cfa_offset: u64,
    def_cfa_offset_sf: i64,
    /// Value is the number of bytes in the DWARF expression, which the caller must read.
    def_cfa_expr: usize,

    pub fn read(
        reader: *std.Io.Reader,
        addr_size_bytes: u8,
        endian: std.builtin.Endian,
    ) !Instruction {
        const inst: OpcodeByte = @bitCast(try reader.takeByte());
        return switch (inst.opcode) {
            .advance_loc => .{ .advance_loc = inst.low.operand },
            .offset => .{ .register = .{
                .index = inst.low.operand,
                .rule = .{ .offset_uf = try reader.takeLeb128(u64) },
            } },
            .restore => .{ .register = .{
                .index = inst.low.operand,
                .rule = .restore,
            } },
            .extended => switch (inst.low.extended) {
                .nop => .nop,
                .remember_state => .remember_state,
                .restore_state => .restore_state,
                .advance_loc1 => .{ .advance_loc = try reader.takeByte() },
                .advance_loc2 => .{ .advance_loc = try reader.takeInt(u16, endian) },
                .advance_loc4 => .{ .advance_loc = try reader.takeInt(u32, endian) },
                .set_loc => .{ .set_loc = switch (addr_size_bytes) {
                    2 => try reader.takeInt(u16, endian),
                    4 => try reader.takeInt(u32, endian),
                    8 => try reader.takeInt(u64, endian),
                    else => return error.UnsupportedAddrSize,
                } },

                .offset_extended => .{ .register = .{
                    .index = try reader.takeLeb128(u8),
                    .rule = .{ .offset_uf = try reader.takeLeb128(u64) },
                } },
                .offset_extended_sf => .{ .register = .{
                    .index = try reader.takeLeb128(u8),
                    .rule = .{ .offset_sf = try reader.takeLeb128(i64) },
                } },
                .restore_extended => .{ .register = .{
                    .index = try reader.takeLeb128(u8),
                    .rule = .restore,
                } },
                .undefined => .{ .register = .{
                    .index = try reader.takeLeb128(u8),
                    .rule = .undefined,
                } },
                .same_value => .{ .register = .{
                    .index = try reader.takeLeb128(u8),
                    .rule = .same_value,
                } },
                .register => .{ .register = .{
                    .index = try reader.takeLeb128(u8),
                    .rule = .{ .register = try reader.takeLeb128(u8) },
                } },
                .val_offset => .{ .register = .{
                    .index = try reader.takeLeb128(u8),
                    .rule = .{ .val_offset_uf = try reader.takeLeb128(u64) },
                } },
                .val_offset_sf => .{ .register = .{
                    .index = try reader.takeLeb128(u8),
                    .rule = .{ .val_offset_sf = try reader.takeLeb128(i64) },
                } },
                .expression => .{ .register = .{
                    .index = try reader.takeLeb128(u8),
                    .rule = .{ .expr = try reader.takeLeb128(usize) },
                } },
                .val_expression => .{ .register = .{
                    .index = try reader.takeLeb128(u8),
                    .rule = .{ .val_expr = try reader.takeLeb128(usize) },
                } },

                .def_cfa => .{ .def_cfa = .{
                    .register = try reader.takeLeb128(u8),
                    .offset = try reader.takeLeb128(u64),
                } },
                .def_cfa_sf => .{ .def_cfa_sf = .{
                    .register = try reader.takeLeb128(u8),
                    .offset_sf = try reader.takeLeb128(i64),
                } },
                .def_cfa_register => .{ .def_cfa_reg = try reader.takeLeb128(u8) },
                .def_cfa_offset => .{ .def_cfa_offset = try reader.takeLeb128(u64) },
                .def_cfa_offset_sf => .{ .def_cfa_offset_sf = try reader.takeLeb128(i64) },
                .def_cfa_expression => .{ .def_cfa_expr = try reader.takeLeb128(usize) },

                _ => switch (@intFromEnum(inst.low.extended)) {
                    0x1C...0x3F => return error.UnimplementedUserOpcode,
                    else => return error.InvalidOpcode,
                },
            },
        };
    }
};

const std = @import("std");
const assert = std.debug.assert;
const Allocator = std.mem.Allocator;

const debug = @import("../../../new_debug.zig");
const Unwind = debug.Dwarf.Unwind;

const VirtualMachine = @This();
