const builtin = @import("builtin");
const native_arch = builtin.cpu.arch;
const native_endian = native_arch.endian();

const std = @import("std");
const leb = std.leb;
const OP = std.dwarf.OP;
const mem = std.mem;
const assert = std.debug.assert;
const testing = std.testing;
const Writer = std.Io.Writer;
const debug = @import("../../new_debug.zig");

const regNative = debug.Dwarf.SelfUnwinder.regNative;

const ip_reg_num = debug.Dwarf.ipRegNum(native_arch).?;
const fp_reg_num = debug.Dwarf.fpRegNum(native_arch);
const sp_reg_num = debug.Dwarf.spRegNum(native_arch);

/// Expressions can be evaluated in different contexts, each requiring its own set of inputs.
/// Callers should specify all the fields relevant to their context. If a field is required
/// by the expression and it isn't in the context, error.IncompleteExpressionContext is returned.
pub const Context = struct {
    /// The dwarf format of the section this expression is in
    format: std.dwarf.Format = .@"32",
    /// The compilation unit this expression relates to, if any
    compile_unit: ?*const debug.Dwarf.CompileUnit = null,
    /// When evaluating a user-presented expression, this is the address of the object being evaluated
    object_address: ?*const anyopaque = null,
    /// .debug_addr section
    debug_addr: ?[]const u8 = null,
    cpu_context: ?*debug.cpu_context.Native = null,
    /// Call frame address, if in a CFI context
    cfa: ?usize = null,
    /// This expression is a sub-expression from an OP.entry_value instruction
    entry_value_context: bool = false,
};

pub const Options = struct {
    /// The address size of the target architecture
    addr_size: u8 = @sizeOf(usize),
    /// Endianness of the target architecture
    endian: std.builtin.Endian = native_endian,
    /// Restrict the stack machine to a subset of opcodes used in call frame instructions
    call_frame_context: bool = false,
};

// Explicitly defined to support executing sub-expressions
pub const Error = error{
    UnimplementedExpressionCall,
    UnimplementedOpcode,
    UnimplementedUserOpcode,
    UnimplementedTypedComparison,
    UnimplementedTypeConversion,

    UnknownExpressionOpcode,

    IncompleteExpressionContext,

    InvalidCFAOpcode,
    InvalidExpression,
    InvalidFrameBase,
    InvalidIntegralTypeSize,
    InvalidRegister,
    InvalidSubExpression,
    InvalidTypeLength,

    TruncatedIntegralType,

    IncompatibleRegisterSize,
} || debug.cpu_context.DwarfRegisterError || error{ EndOfStream, Overflow, OutOfMemory, DivisionByZero, ReadFailed };

/// A stack machine that can decode and run DWARF expressions.
/// Expressions can be decoded for non-native address size and endianness,
/// but can only be executed if the current target matches the configuration.
pub fn StackMachine(comptime options: Options) type {
    const addr_type = switch (options.addr_size) {
        2 => u16,
        4 => u32,
        8 => u64,
        else => @compileError("Unsupported address size of " ++ options.addr_size),
    };

    const addr_type_signed = switch (options.addr_size) {
        2 => i16,
        4 => i32,
        8 => i64,
        else => @compileError("Unsupported address size of " ++ options.addr_size),
    };

    return struct {
        const Self = @This();

        const Operand = union(enum) {
            generic: addr_type,
            register: u8,
            type_size: u8,
            branch_offset: i16,
            base_register: struct {
                base_register: u8,
                offset: i64,
            },
            composite_location: struct {
                size: u64,
                offset: i64,
            },
            block: []const u8,
            register_type: struct {
                register: u8,
                type_offset: addr_type,
            },
            const_type: struct {
                type_offset: addr_type,
                value_bytes: []const u8,
            },
            deref_type: struct {
                size: u8,
                type_offset: addr_type,
            },
        };

        const Value = union(enum) {
            generic: addr_type,

            // Typed value with a maximum size of a register
            regval_type: struct {
                // Offset of DW_TAG_base_type DIE
                type_offset: addr_type,
                type_size: u8,
                value: addr_type,
            },

            // Typed value specified directly in the instruction stream
            const_type: struct {
                // Offset of DW_TAG_base_type DIE
                type_offset: addr_type,
                // Backed by the instruction stream
                value_bytes: []const u8,
            },

            pub fn asIntegral(self: Value) !addr_type {
                return switch (self) {
                    .generic => |v| v,

                    // TODO: For these two prongs, look up the type and assert it's integral?
                    .regval_type => |regval_type| regval_type.value,
                    .const_type => |const_type| {
                        const value: u64 = switch (const_type.value_bytes.len) {
                            1 => mem.readInt(u8, const_type.value_bytes[0..1], native_endian),
                            2 => mem.readInt(u16, const_type.value_bytes[0..2], native_endian),
                            4 => mem.readInt(u32, const_type.value_bytes[0..4], native_endian),
                            8 => mem.readInt(u64, const_type.value_bytes[0..8], native_endian),
                            else => return error.InvalidIntegralTypeSize,
                        };

                        return std.math.cast(addr_type, value) orelse error.TruncatedIntegralType;
                    },
                };
            }
        };

        stack: std.ArrayList(Value) = .empty,

        pub fn reset(self: *Self) void {
            self.stack.clearRetainingCapacity();
        }

        pub fn deinit(self: *Self, allocator: std.mem.Allocator) void {
            self.stack.deinit(allocator);
        }

        fn generic(value: anytype) Operand {
            const int_info = @typeInfo(@TypeOf(value)).int;
            if (@sizeOf(@TypeOf(value)) > options.addr_size) {
                return .{ .generic = switch (int_info.signedness) {
                    .signed => @bitCast(@as(addr_type_signed, @truncate(value))),
                    .unsigned => @truncate(value),
                } };
            } else {
                return .{ .generic = switch (int_info.signedness) {
                    .signed => @bitCast(@as(addr_type_signed, @intCast(value))),
                    .unsigned => @intCast(value),
                } };
            }
        }

        pub fn readOperand(reader: *std.Io.Reader, opcode: u8, context: Context) !?Operand {
            return switch (opcode) {
                OP.addr => generic(try reader.takeInt(addr_type, options.endian)),
                OP.call_ref => switch (context.format) {
                    .@"32" => generic(try reader.takeInt(u32, options.endian)),
                    .@"64" => generic(try reader.takeInt(u64, options.endian)),
                },
                OP.const1u,
                OP.pick,
                => generic(try reader.takeByte()),
                OP.deref_size,
                OP.xderef_size,
                => .{ .type_size = try reader.takeByte() },
                OP.const1s => generic(try reader.takeByteSigned()),
                OP.const2u,
                OP.call2,
                => generic(try reader.takeInt(u16, options.endian)),
                OP.call4 => generic(try reader.takeInt(u32, options.endian)),
                OP.const2s => generic(try reader.takeInt(i16, options.endian)),
                OP.bra,
                OP.skip,
                => .{ .branch_offset = try reader.takeInt(i16, options.endian) },
                OP.const4u => generic(try reader.takeInt(u32, options.endian)),
                OP.const4s => generic(try reader.takeInt(i32, options.endian)),
                OP.const8u => generic(try reader.takeInt(u64, options.endian)),
                OP.const8s => generic(try reader.takeInt(i64, options.endian)),
                OP.constu,
                OP.plus_uconst,
                OP.addrx,
                OP.constx,
                OP.convert,
                OP.reinterpret,
                => generic(try reader.takeLeb128(u64)),
                OP.consts,
                OP.fbreg,
                => generic(try reader.takeLeb128(i64)),
                OP.lit0...OP.lit31 => |n| generic(n - OP.lit0),
                OP.reg0...OP.reg31 => |n| .{ .register = n - OP.reg0 },
                OP.breg0...OP.breg31 => |n| .{ .base_register = .{
                    .base_register = n - OP.breg0,
                    .offset = try reader.takeLeb128(i64),
                } },
                OP.regx => .{ .register = try reader.takeLeb128(u8) },
                OP.bregx => blk: {
                    const base_register = try reader.takeLeb128(u8);
                    const offset = try reader.takeLeb128(i64);
                    break :blk .{ .base_register = .{
                        .base_register = base_register,
                        .offset = offset,
                    } };
                },
                OP.regval_type => blk: {
                    const register = try reader.takeLeb128(u8);
                    const type_offset = try reader.takeLeb128(addr_type);
                    break :blk .{ .register_type = .{
                        .register = register,
                        .type_offset = type_offset,
                    } };
                },
                OP.piece => .{
                    .composite_location = .{
                        .size = try reader.takeLeb128(u8),
                        .offset = 0,
                    },
                },
                OP.bit_piece => blk: {
                    const size = try reader.takeLeb128(u8);
                    const offset = try reader.takeLeb128(i64);
                    break :blk .{ .composite_location = .{
                        .size = size,
                        .offset = offset,
                    } };
                },
                OP.implicit_value, OP.entry_value => blk: {
                    const size = try reader.takeLeb128(u8);
                    const block = try reader.take(size);
                    break :blk .{ .block = block };
                },
                OP.const_type => blk: {
                    const type_offset = try reader.takeLeb128(addr_type);
                    const size = try reader.takeByte();
                    const value_bytes = try reader.take(size);
                    break :blk .{ .const_type = .{
                        .type_offset = type_offset,
                        .value_bytes = value_bytes,
                    } };
                },
                OP.deref_type,
                OP.xderef_type,
                => .{
                    .deref_type = .{
                        .size = try reader.takeByte(),
                        .type_offset = try reader.takeLeb128(addr_type),
                    },
                },
                OP.lo_user...OP.hi_user => return error.UnimplementedUserOpcode,
                else => null,
            };
        }

        pub fn run(
            self: *Self,
            expression: []const u8,
            allocator: std.mem.Allocator,
            context: Context,
            initial_value: ?usize,
        ) Error!?Value {
            if (initial_value) |i| try self.stack.append(allocator, .{ .generic = i });
            var stream: std.Io.Reader = .fixed(expression);
            while (try self.step(&stream, allocator, context)) {}
            if (self.stack.items.len == 0) return null;
            return self.stack.items[self.stack.items.len - 1];
        }

        /// Reads an opcode and its operands from `stream`, then executes it
        pub fn step(
            self: *Self,
            stream: *std.Io.Reader,
            allocator: std.mem.Allocator,
            context: Context,
        ) Error!bool {
            if (@sizeOf(usize) != @sizeOf(addr_type) or options.endian != native_endian)
                @compileError("Execution of non-native address sizes / endianness is not supported");

            const opcode = try stream.takeByte();
            if (options.call_frame_context and !isOpcodeValidInCFA(opcode)) return error.InvalidCFAOpcode;
            const operand = try readOperand(stream, opcode, context);
            switch (opcode) {

                // 2.5.1.1: Literal Encodings
                OP.lit0...OP.lit31,
                OP.addr,
                OP.const1u,
                OP.const2u,
                OP.const4u,
                OP.const8u,
                OP.const1s,
                OP.const2s,
                OP.const4s,
                OP.const8s,
                OP.constu,
                OP.consts,
                => try self.stack.append(allocator, .{ .generic = operand.?.generic }),

                OP.const_type => {
                    const const_type = operand.?.const_type;
                    try self.stack.append(allocator, .{ .const_type = .{
                        .type_offset = const_type.type_offset,
                        .value_bytes = const_type.value_bytes,
                    } });
                },

                OP.addrx,
                OP.constx,
                => {
                    if (context.compile_unit == null) return error.IncompleteExpressionContext;
                    if (context.debug_addr == null) return error.IncompleteExpressionContext;
                    const debug_addr_index = operand.?.generic;
                    const offset = context.compile_unit.?.addr_base + debug_addr_index;
                    if (offset >= context.debug_addr.?.len) return error.InvalidExpression;
                    const value = mem.readInt(usize, context.debug_addr.?[offset..][0..@sizeOf(usize)], native_endian);
                    try self.stack.append(allocator, .{ .generic = value });
                },

                // 2.5.1.2: Register Values
                OP.fbreg => {
                    if (context.compile_unit == null) return error.IncompleteExpressionContext;
                    if (context.compile_unit.?.frame_base == null) return error.IncompleteExpressionContext;

                    const offset: i64 = @intCast(operand.?.generic);
                    _ = offset;

                    switch (context.compile_unit.?.frame_base.?.*) {
                        .exprloc => {
                            // TODO: Run this expression in a nested stack machine
                            return error.UnimplementedOpcode;
                        },
                        .loclistx => {
                            // TODO: Read value from .debug_loclists
                            return error.UnimplementedOpcode;
                        },
                        .sec_offset => {
                            // TODO: Read value from .debug_loclists
                            return error.UnimplementedOpcode;
                        },
                        else => return error.InvalidFrameBase,
                    }
                },
                OP.breg0...OP.breg31,
                OP.bregx,
                => {
                    const cpu_context = context.cpu_context orelse return error.IncompleteExpressionContext;

                    const br = operand.?.base_register;
                    const value: i64 = @intCast((try regNative(cpu_context, br.base_register)).*);
                    try self.stack.append(allocator, .{ .generic = @intCast(value + br.offset) });
                },
                OP.regval_type => {
                    const cpu_context = context.cpu_context orelse return error.IncompleteExpressionContext;
                    const rt = operand.?.register_type;
                    try self.stack.append(allocator, .{
                        .regval_type = .{
                            .type_offset = rt.type_offset,
                            .type_size = @sizeOf(addr_type),
                            .value = (try regNative(cpu_context, rt.register)).*,
                        },
                    });
                },

                // 2.5.1.3: Stack Operations
                OP.dup => {
                    if (self.stack.items.len == 0) return error.InvalidExpression;
                    try self.stack.append(allocator, self.stack.items[self.stack.items.len - 1]);
                },
                OP.drop => {
                    _ = self.stack.pop();
                },
                OP.pick, OP.over => {
                    const stack_index = if (opcode == OP.over) 1 else operand.?.generic;
                    if (stack_index >= self.stack.items.len) return error.InvalidExpression;
                    try self.stack.append(allocator, self.stack.items[self.stack.items.len - 1 - stack_index]);
                },
                OP.swap => {
                    if (self.stack.items.len < 2) return error.InvalidExpression;
                    mem.swap(Value, &self.stack.items[self.stack.items.len - 1], &self.stack.items[self.stack.items.len - 2]);
                },
                OP.rot => {
                    if (self.stack.items.len < 3) return error.InvalidExpression;
                    const first = self.stack.items[self.stack.items.len - 1];
                    self.stack.items[self.stack.items.len - 1] = self.stack.items[self.stack.items.len - 2];
                    self.stack.items[self.stack.items.len - 2] = self.stack.items[self.stack.items.len - 3];
                    self.stack.items[self.stack.items.len - 3] = first;
                },
                OP.deref,
                OP.xderef,
                OP.deref_size,
                OP.xderef_size,
                OP.deref_type,
                OP.xderef_type,
                => {
                    if (self.stack.items.len == 0) return error.InvalidExpression;
                    const addr = try self.stack.items[self.stack.items.len - 1].asIntegral();
                    const addr_space_identifier: ?usize = switch (opcode) {
                        OP.xderef,
                        OP.xderef_size,
                        OP.xderef_type,
                        => blk: {
                            _ = self.stack.pop();
                            if (self.stack.items.len == 0) return error.InvalidExpression;
                            break :blk try self.stack.items[self.stack.items.len - 1].asIntegral();
                        },
                        else => null,
                    };

                    // Usage of addr_space_identifier in the address calculation is implementation defined.
                    // This code will need to be updated to handle any architectures that utilize this.
                    _ = addr_space_identifier;

                    const size = switch (opcode) {
                        OP.deref,
                        OP.xderef,
                        => @sizeOf(addr_type),
                        OP.deref_size,
                        OP.xderef_size,
                        => operand.?.type_size,
                        OP.deref_type,
                        OP.xderef_type,
                        => operand.?.deref_type.size,
                        else => unreachable,
                    };

                    const value: addr_type = std.math.cast(addr_type, @as(u64, switch (size) {
                        1 => @as(*const u8, @ptrFromInt(addr)).*,
                        2 => @as(*const u16, @ptrFromInt(addr)).*,
                        4 => @as(*const u32, @ptrFromInt(addr)).*,
                        8 => @as(*const u64, @ptrFromInt(addr)).*,
                        else => return error.InvalidExpression,
                    })) orelse return error.InvalidExpression;

                    switch (opcode) {
                        OP.deref_type,
                        OP.xderef_type,
                        => {
                            self.stack.items[self.stack.items.len - 1] = .{
                                .regval_type = .{
                                    .type_offset = operand.?.deref_type.type_offset,
                                    .type_size = operand.?.deref_type.size,
                                    .value = value,
                                },
                            };
                        },
                        else => {
                            self.stack.items[self.stack.items.len - 1] = .{ .generic = value };
                        },
                    }
                },
                OP.push_object_address => {
                    // In sub-expressions, `push_object_address` is not meaningful (as per the
                    // spec), so treat it like a nop
                    if (!context.entry_value_context) {
                        if (context.object_address == null) return error.IncompleteExpressionContext;
                        try self.stack.append(allocator, .{ .generic = @intFromPtr(context.object_address.?) });
                    }
                },
                OP.form_tls_address => {
                    return error.UnimplementedOpcode;
                },
                OP.call_frame_cfa => {
                    if (context.cfa) |cfa| {
                        try self.stack.append(allocator, .{ .generic = cfa });
                    } else return error.IncompleteExpressionContext;
                },

                // 2.5.1.4: Arithmetic and Logical Operations
                OP.abs => {
                    if (self.stack.items.len == 0) return error.InvalidExpression;
                    const value: isize = @bitCast(try self.stack.items[self.stack.items.len - 1].asIntegral());
                    self.stack.items[self.stack.items.len - 1] = .{
                        .generic = @abs(value),
                    };
                },
                OP.@"and" => {
                    if (self.stack.items.len < 2) return error.InvalidExpression;
                    const a = try self.stack.pop().?.asIntegral();
                    self.stack.items[self.stack.items.len - 1] = .{
                        .generic = a & try self.stack.items[self.stack.items.len - 1].asIntegral(),
                    };
                },
                OP.div => {
                    if (self.stack.items.len < 2) return error.InvalidExpression;
                    const a: isize = @bitCast(try self.stack.pop().?.asIntegral());
                    const b: isize = @bitCast(try self.stack.items[self.stack.items.len - 1].asIntegral());
                    self.stack.items[self.stack.items.len - 1] = .{
                        .generic = @bitCast(try std.math.divTrunc(isize, b, a)),
                    };
                },
                OP.minus => {
                    if (self.stack.items.len < 2) return error.InvalidExpression;
                    const b = try self.stack.pop().?.asIntegral();
                    self.stack.items[self.stack.items.len - 1] = .{
                        .generic = try std.math.sub(addr_type, try self.stack.items[self.stack.items.len - 1].asIntegral(), b),
                    };
                },
                OP.mod => {
                    if (self.stack.items.len < 2) return error.InvalidExpression;
                    const a: isize = @bitCast(try self.stack.pop().?.asIntegral());
                    const b: isize = @bitCast(try self.stack.items[self.stack.items.len - 1].asIntegral());
                    self.stack.items[self.stack.items.len - 1] = .{
                        .generic = @bitCast(@mod(b, a)),
                    };
                },
                OP.mul => {
                    if (self.stack.items.len < 2) return error.InvalidExpression;
                    const a: isize = @bitCast(try self.stack.pop().?.asIntegral());
                    const b: isize = @bitCast(try self.stack.items[self.stack.items.len - 1].asIntegral());
                    self.stack.items[self.stack.items.len - 1] = .{
                        .generic = @bitCast(@mulWithOverflow(a, b)[0]),
                    };
                },
                OP.neg => {
                    if (self.stack.items.len == 0) return error.InvalidExpression;
                    self.stack.items[self.stack.items.len - 1] = .{
                        .generic = @bitCast(
                            try std.math.negate(
                                @as(isize, @bitCast(try self.stack.items[self.stack.items.len - 1].asIntegral())),
                            ),
                        ),
                    };
                },
                OP.not => {
                    if (self.stack.items.len == 0) return error.InvalidExpression;
                    self.stack.items[self.stack.items.len - 1] = .{
                        .generic = ~try self.stack.items[self.stack.items.len - 1].asIntegral(),
                    };
                },
                OP.@"or" => {
                    if (self.stack.items.len < 2) return error.InvalidExpression;
                    const a = try self.stack.pop().?.asIntegral();
                    self.stack.items[self.stack.items.len - 1] = .{
                        .generic = a | try self.stack.items[self.stack.items.len - 1].asIntegral(),
                    };
                },
                OP.plus => {
                    if (self.stack.items.len < 2) return error.InvalidExpression;
                    const b = try self.stack.pop().?.asIntegral();
                    self.stack.items[self.stack.items.len - 1] = .{
                        .generic = try std.math.add(addr_type, try self.stack.items[self.stack.items.len - 1].asIntegral(), b),
                    };
                },
                OP.plus_uconst => {
                    if (self.stack.items.len == 0) return error.InvalidExpression;
                    const constant = operand.?.generic;
                    self.stack.items[self.stack.items.len - 1] = .{
                        .generic = try std.math.add(addr_type, try self.stack.items[self.stack.items.len - 1].asIntegral(), constant),
                    };
                },
                OP.shl => {
                    if (self.stack.items.len < 2) return error.InvalidExpression;
                    const a = try self.stack.pop().?.asIntegral();
                    const b = try self.stack.items[self.stack.items.len - 1].asIntegral();
                    self.stack.items[self.stack.items.len - 1] = .{
                        .generic = std.math.shl(usize, b, a),
                    };
                },
                OP.shr => {
                    if (self.stack.items.len < 2) return error.InvalidExpression;
                    const a = try self.stack.pop().?.asIntegral();
                    const b = try self.stack.items[self.stack.items.len - 1].asIntegral();
                    self.stack.items[self.stack.items.len - 1] = .{
                        .generic = std.math.shr(usize, b, a),
                    };
                },
                OP.shra => {
                    if (self.stack.items.len < 2) return error.InvalidExpression;
                    const a = try self.stack.pop().?.asIntegral();
                    const b: isize = @bitCast(try self.stack.items[self.stack.items.len - 1].asIntegral());
                    self.stack.items[self.stack.items.len - 1] = .{
                        .generic = @bitCast(std.math.shr(isize, b, a)),
                    };
                },
                OP.xor => {
                    if (self.stack.items.len < 2) return error.InvalidExpression;
                    const a = try self.stack.pop().?.asIntegral();
                    self.stack.items[self.stack.items.len - 1] = .{
                        .generic = a ^ try self.stack.items[self.stack.items.len - 1].asIntegral(),
                    };
                },

                // 2.5.1.5: Control Flow Operations
                OP.le,
                OP.ge,
                OP.eq,
                OP.lt,
                OP.gt,
                OP.ne,
                => {
                    if (self.stack.items.len < 2) return error.InvalidExpression;
                    const a = self.stack.pop().?;
                    const b = self.stack.items[self.stack.items.len - 1];

                    if (a == .generic and b == .generic) {
                        const a_int: isize = @bitCast(a.asIntegral() catch unreachable);
                        const b_int: isize = @bitCast(b.asIntegral() catch unreachable);
                        const result = @intFromBool(switch (opcode) {
                            OP.le => b_int <= a_int,
                            OP.ge => b_int >= a_int,
                            OP.eq => b_int == a_int,
                            OP.lt => b_int < a_int,
                            OP.gt => b_int > a_int,
                            OP.ne => b_int != a_int,
                            else => unreachable,
                        });

                        self.stack.items[self.stack.items.len - 1] = .{ .generic = result };
                    } else {
                        // TODO: Load the types referenced by these values, find their comparison operator, and run it
                        return error.UnimplementedTypedComparison;
                    }
                },
                OP.skip, OP.bra => {
                    const branch_offset = operand.?.branch_offset;
                    const condition = if (opcode == OP.bra) blk: {
                        if (self.stack.items.len == 0) return error.InvalidExpression;
                        break :blk try self.stack.pop().?.asIntegral() != 0;
                    } else true;

                    if (condition) {
                        const new_pos = std.math.cast(
                            usize,
                            try std.math.add(isize, @as(isize, @intCast(stream.seek)), branch_offset),
                        ) orelse return error.InvalidExpression;

                        if (new_pos < 0 or new_pos > stream.buffer.len) return error.InvalidExpression;
                        stream.seek = new_pos;
                    }
                },
                OP.call2,
                OP.call4,
                OP.call_ref,
                => {
                    const debug_info_offset = operand.?.generic;
                    _ = debug_info_offset;

                    // TODO: Load a DIE entry at debug_info_offset in a .debug_info section (the spec says that it
                    //       can be in a separate exe / shared object from the one containing this expression).
                    //       Transfer control to the DW_AT_location attribute, with the current stack as input.

                    return error.UnimplementedExpressionCall;
                },

                // 2.5.1.6: Type Conversions
                OP.convert => {
                    if (self.stack.items.len == 0) return error.InvalidExpression;
                    const type_offset = operand.?.generic;

                    // TODO: Load the DW_TAG_base_type entries in context.compile_unit and verify both types are the same size
                    const value = self.stack.items[self.stack.items.len - 1];
                    if (type_offset == 0) {
                        self.stack.items[self.stack.items.len - 1] = .{ .generic = try value.asIntegral() };
                    } else {
                        // TODO: Load the DW_TAG_base_type entry in context.compile_unit, find a conversion operator
                        //       from the old type to the new type, run it.
                        return error.UnimplementedTypeConversion;
                    }
                },
                OP.reinterpret => {
                    if (self.stack.items.len == 0) return error.InvalidExpression;
                    const type_offset = operand.?.generic;

                    // TODO: Load the DW_TAG_base_type entries in context.compile_unit and verify both types are the same size
                    const value = self.stack.items[self.stack.items.len - 1];
                    if (type_offset == 0) {
                        self.stack.items[self.stack.items.len - 1] = .{ .generic = try value.asIntegral() };
                    } else {
                        self.stack.items[self.stack.items.len - 1] = switch (value) {
                            .generic => |v| .{
                                .regval_type = .{
                                    .type_offset = type_offset,
                                    .type_size = @sizeOf(addr_type),
                                    .value = v,
                                },
                            },
                            .regval_type => |r| .{
                                .regval_type = .{
                                    .type_offset = type_offset,
                                    .type_size = r.type_size,
                                    .value = r.value,
                                },
                            },
                            .const_type => |c| .{
                                .const_type = .{
                                    .type_offset = type_offset,
                                    .value_bytes = c.value_bytes,
                                },
                            },
                        };
                    }
                },

                // 2.5.1.7: Special Operations
                OP.nop => {},
                OP.entry_value => {
                    const block = operand.?.block;
                    if (block.len == 0) return error.InvalidSubExpression;

                    // TODO: The spec states that this sub-expression needs to observe the state (ie. registers)
                    //       as it was upon entering the current subprogram. If this isn't being called at the
                    //       end of a frame unwind operation, an additional cpu_context.Native with this state will be needed.

                    if (isOpcodeRegisterLocation(block[0])) {
                        const cpu_context = context.cpu_context orelse return error.IncompleteExpressionContext;

                        var block_stream: std.Io.Reader = .fixed(block);
                        const register = (try readOperand(&block_stream, block[0], context)).?.register;
                        const value = (try regNative(cpu_context, register)).*;
                        try self.stack.append(allocator, .{ .generic = value });
                    } else {
                        var stack_machine: Self = .{};
                        defer stack_machine.deinit(allocator);

                        var sub_context = context;
                        sub_context.entry_value_context = true;
                        const result = try stack_machine.run(block, allocator, sub_context, null);
                        try self.stack.append(allocator, result orelse return error.InvalidSubExpression);
                    }
                },

                // These have already been handled by readOperand
                OP.lo_user...OP.hi_user => unreachable,
                else => {
                    //std.debug.print("Unknown DWARF expression opcode: {x}\n", .{opcode});
                    return error.UnknownExpressionOpcode;
                },
            }

            return stream.seek < stream.buffer.len;
        }
    };
}

pub fn Builder(comptime options: Options) type {
    const addr_type = switch (options.addr_size) {
        2 => u16,
        4 => u32,
        8 => u64,
        else => @compileError("Unsupported address size of " ++ options.addr_size),
    };

    return struct {
        /// Zero-operand instructions
        pub fn writeOpcode(writer: *Writer, comptime opcode: u8) !void {
            if (options.call_frame_context and !comptime isOpcodeValidInCFA(opcode)) return error.InvalidCFAOpcode;
            switch (opcode) {
                OP.dup,
                OP.drop,
                OP.over,
                OP.swap,
                OP.rot,
                OP.deref,
                OP.xderef,
                OP.push_object_address,
                OP.form_tls_address,
                OP.call_frame_cfa,
                OP.abs,
                OP.@"and",
                OP.div,
                OP.minus,
                OP.mod,
                OP.mul,
                OP.neg,
                OP.not,
                OP.@"or",
                OP.plus,
                OP.shl,
                OP.shr,
                OP.shra,
                OP.xor,
                OP.le,
                OP.ge,
                OP.eq,
                OP.lt,
                OP.gt,
                OP.ne,
                OP.nop,
                OP.stack_value,
                => try writer.writeByte(opcode),
                else => @compileError("This opcode requires operands, use `write<Opcode>()` instead"),
            }
        }

        // 2.5.1.1: Literal Encodings
        pub fn writeLiteral(writer: *Writer, literal: u8) !void {
            switch (literal) {
                0...31 => |n| try writer.writeByte(n + OP.lit0),
                else => return error.InvalidLiteral,
            }
        }

        pub fn writeConst(writer: *Writer, comptime T: type, value: T) !void {
            if (@typeInfo(T) != .int) @compileError("Constants must be integers");

            switch (T) {
                u8, i8, u16, i16, u32, i32, u64, i64 => {
                    try writer.writeByte(switch (T) {
                        u8 => OP.const1u,
                        i8 => OP.const1s,
                        u16 => OP.const2u,
                        i16 => OP.const2s,
                        u32 => OP.const4u,
                        i32 => OP.const4s,
                        u64 => OP.const8u,
                        i64 => OP.const8s,
                        else => unreachable,
                    });

                    try writer.writeInt(T, value, options.endian);
                },
                else => switch (@typeInfo(T).int.signedness) {
                    .unsigned => {
                        try writer.writeByte(OP.constu);
                        try writer.writeUleb128(value);
                    },
                    .signed => {
                        try writer.writeByte(OP.consts);
                        try writer.writeLeb128(value);
                    },
                },
            }
        }

        pub fn writeConstx(writer: *Writer, debug_addr_offset: anytype) !void {
            try writer.writeByte(OP.constx);
            try writer.writeUleb128(debug_addr_offset);
        }

        pub fn writeConstType(writer: *Writer, die_offset: anytype, value_bytes: []const u8) !void {
            if (options.call_frame_context) return error.InvalidCFAOpcode;
            if (value_bytes.len > 0xff) return error.InvalidTypeLength;
            try writer.writeByte(OP.const_type);
            try writer.writeUleb128(die_offset);
            try writer.writeByte(@intCast(value_bytes.len));
            try writer.writeAll(value_bytes);
        }

        pub fn writeAddr(writer: *Writer, value: addr_type) !void {
            try writer.writeByte(OP.addr);
            try writer.writeInt(addr_type, value, options.endian);
        }

        pub fn writeAddrx(writer: *Writer, debug_addr_offset: anytype) !void {
            if (options.call_frame_context) return error.InvalidCFAOpcode;
            try writer.writeByte(OP.addrx);
            try writer.writeUleb128(debug_addr_offset);
        }

        // 2.5.1.2: Register Values
        pub fn writeFbreg(writer: *Writer, offset: anytype) !void {
            try writer.writeByte(OP.fbreg);
            try writer.writeSleb128(offset);
        }

        pub fn writeBreg(writer: *Writer, register: u8, offset: anytype) !void {
            if (register > 31) return error.InvalidRegister;
            try writer.writeByte(OP.breg0 + register);
            try writer.writeSleb128(offset);
        }

        pub fn writeBregx(writer: *Writer, register: anytype, offset: anytype) !void {
            try writer.writeByte(OP.bregx);
            try writer.writeUleb128(register);
            try writer.writeSleb128(offset);
        }

        pub fn writeRegvalType(writer: *Writer, register: anytype, offset: anytype) !void {
            if (options.call_frame_context) return error.InvalidCFAOpcode;
            try writer.writeByte(OP.regval_type);
            try writer.writeUleb128(register);
            try writer.writeUleb128(offset);
        }

        // 2.5.1.3: Stack Operations
        pub fn writePick(writer: *Writer, index: u8) !void {
            try writer.writeByte(OP.pick);
            try writer.writeByte(index);
        }

        pub fn writeDerefSize(writer: *Writer, size: u8) !void {
            try writer.writeByte(OP.deref_size);
            try writer.writeByte(size);
        }

        pub fn writeXDerefSize(writer: *Writer, size: u8) !void {
            try writer.writeByte(OP.xderef_size);
            try writer.writeByte(size);
        }

        pub fn writeDerefType(writer: *Writer, size: u8, die_offset: anytype) !void {
            if (options.call_frame_context) return error.InvalidCFAOpcode;
            try writer.writeByte(OP.deref_type);
            try writer.writeByte(size);
            try writer.writeUleb128(die_offset);
        }

        pub fn writeXDerefType(writer: *Writer, size: u8, die_offset: anytype) !void {
            try writer.writeByte(OP.xderef_type);
            try writer.writeByte(size);
            try writer.writeUleb128(die_offset);
        }

        // 2.5.1.4: Arithmetic and Logical Operations

        pub fn writePlusUconst(writer: *Writer, uint_value: anytype) !void {
            try writer.writeByte(OP.plus_uconst);
            try writer.writeUleb128(uint_value);
        }

        // 2.5.1.5: Control Flow Operations

        pub fn writeSkip(writer: *Writer, offset: i16) !void {
            try writer.writeByte(OP.skip);
            try writer.writeInt(i16, offset, options.endian);
        }

        pub fn writeBra(writer: *Writer, offset: i16) !void {
            try writer.writeByte(OP.bra);
            try writer.writeInt(i16, offset, options.endian);
        }

        pub fn writeCall(writer: *Writer, comptime T: type, offset: T) !void {
            if (options.call_frame_context) return error.InvalidCFAOpcode;
            switch (T) {
                u16 => try writer.writeByte(OP.call2),
                u32 => try writer.writeByte(OP.call4),
                else => @compileError("Call operand must be a 2 or 4 byte offset"),
            }

            try writer.writeInt(T, offset, options.endian);
        }

        pub fn writeCallRef(writer: *Writer, comptime is_64: bool, value: if (is_64) u64 else u32) !void {
            if (options.call_frame_context) return error.InvalidCFAOpcode;
            try writer.writeByte(OP.call_ref);
            try writer.writeInt(if (is_64) u64 else u32, value, options.endian);
        }

        pub fn writeConvert(writer: *Writer, die_offset: anytype) !void {
            if (options.call_frame_context) return error.InvalidCFAOpcode;
            try writer.writeByte(OP.convert);
            try writer.writeUleb128(die_offset);
        }

        pub fn writeReinterpret(writer: *Writer, die_offset: anytype) !void {
            if (options.call_frame_context) return error.InvalidCFAOpcode;
            try writer.writeByte(OP.reinterpret);
            try writer.writeUleb128(die_offset);
        }

        // 2.5.1.7: Special Operations

        pub fn writeEntryValue(writer: *Writer, expression: []const u8) !void {
            try writer.writeByte(OP.entry_value);
            try writer.writeUleb128(expression.len);
            try writer.writeAll(expression);
        }

        // 2.6: Location Descriptions
        pub fn writeReg(writer: *Writer, register: u8) !void {
            try writer.writeByte(OP.reg0 + register);
        }

        pub fn writeRegx(writer: *Writer, register: anytype) !void {
            try writer.writeByte(OP.regx);
            try writer.writeUleb128(register);
        }

        pub fn writeImplicitValue(writer: *Writer, value_bytes: []const u8) !void {
            try writer.writeByte(OP.implicit_value);
            try writer.writeUleb128(value_bytes.len);
            try writer.writeAll(value_bytes);
        }
    };
}

// Certain opcodes are not allowed in a CFA context, see 6.4.2
fn isOpcodeValidInCFA(opcode: u8) bool {
    return switch (opcode) {
        OP.addrx,
        OP.call2,
        OP.call4,
        OP.call_ref,
        OP.const_type,
        OP.constx,
        OP.convert,
        OP.deref_type,
        OP.regval_type,
        OP.reinterpret,
        OP.push_object_address,
        OP.call_frame_cfa,
        => false,
        else => true,
    };
}

fn isOpcodeRegisterLocation(opcode: u8) bool {
    return switch (opcode) {
        OP.reg0...OP.reg31, OP.regx => true,
        else => false,
    };
}

test "basics" {
    const allocator = std.testing.allocator;

    const options = Options{};
    var stack_machine = StackMachine(options){};
    defer stack_machine.deinit(allocator);

    const b = Builder(options);

    var program: std.Io.Writer.Allocating = .init(allocator);
    defer program.deinit();

    const writer = &program.writer;

    // Literals
    {
        const context = Context{};
        for (0..32) |i| {
            try b.writeLiteral(writer, @intCast(i));
        }

        _ = try stack_machine.run(program.written(), allocator, context, 0);

        for (0..32) |i| {
            const expected = 31 - i;
            try testing.expectEqual(expected, stack_machine.stack.pop().?.generic);
        }
    }

    // Constants
    {
        stack_machine.reset();
        program.clearRetainingCapacity();

        const input = [_]comptime_int{
            1,
            -1,
            @as(usize, @truncate(0x0fff)),
            @as(isize, @truncate(-0x0fff)),
            @as(usize, @truncate(0x0fffffff)),
            @as(isize, @truncate(-0x0fffffff)),
            @as(usize, @truncate(0x0fffffffffffffff)),
            @as(isize, @truncate(-0x0fffffffffffffff)),
            @as(usize, @truncate(0x8000000)),
            @as(isize, @truncate(-0x8000000)),
            @as(usize, @truncate(0x12345678_12345678)),
            @as(usize, @truncate(0xffffffff_ffffffff)),
            @as(usize, @truncate(0xeeeeeeee_eeeeeeee)),
        };

        try b.writeConst(writer, u8, input[0]);
        try b.writeConst(writer, i8, input[1]);
        try b.writeConst(writer, u16, input[2]);
        try b.writeConst(writer, i16, input[3]);
        try b.writeConst(writer, u32, input[4]);
        try b.writeConst(writer, i32, input[5]);
        try b.writeConst(writer, u64, input[6]);
        try b.writeConst(writer, i64, input[7]);
        try b.writeConst(writer, u28, input[8]);
        try b.writeConst(writer, i28, input[9]);
        try b.writeAddr(writer, input[10]);

        var mock_compile_unit: debug.Dwarf.CompileUnit = undefined;
        mock_compile_unit.addr_base = 1;

        var mock_debug_addr: std.Io.Writer.Allocating = .init(allocator);
        defer mock_debug_addr.deinit();

        try mock_debug_addr.writer.writeInt(u16, 0, native_endian);
        try mock_debug_addr.writer.writeInt(usize, input[11], native_endian);
        try mock_debug_addr.writer.writeInt(usize, input[12], native_endian);

        const context: Context = .{
            .compile_unit = &mock_compile_unit,
            .debug_addr = mock_debug_addr.written(),
        };

        try b.writeConstx(writer, @as(usize, 1));
        try b.writeAddrx(writer, @as(usize, 1 + @sizeOf(usize)));

        const die_offset: usize = @truncate(0xaabbccdd);
        const type_bytes: []const u8 = &.{ 1, 2, 3, 4 };
        try b.writeConstType(writer, die_offset, type_bytes);

        _ = try stack_machine.run(program.written(), allocator, context, 0);

        const const_type = stack_machine.stack.pop().?.const_type;
        try testing.expectEqual(die_offset, const_type.type_offset);
        try testing.expectEqualSlices(u8, type_bytes, const_type.value_bytes);

        const expected = .{
            .{ usize, input[12], usize },
            .{ usize, input[11], usize },
            .{ usize, input[10], usize },
            .{ isize, input[9], isize },
            .{ usize, input[8], usize },
            .{ isize, input[7], isize },
            .{ usize, input[6], usize },
            .{ isize, input[5], isize },
            .{ usize, input[4], usize },
            .{ isize, input[3], isize },
            .{ usize, input[2], usize },
            .{ isize, input[1], isize },
            .{ usize, input[0], usize },
        };

        inline for (expected) |e| {
            try testing.expectEqual(@as(e[0], e[1]), @as(e[2], @bitCast(stack_machine.stack.pop().?.generic)));
        }
    }

    // Register values
    if (debug.cpu_context.Native != noreturn) {
        stack_machine.reset();
        program.clearRetainingCapacity();

        var cpu_context: debug.cpu_context.Native = undefined;
        const context = Context{
            .cpu_context = &cpu_context,
        };

        const reg_bytes = try cpu_context.dwarfRegisterBytes(0);

        // TODO: Test fbreg (once implemented): mock a DIE and point compile_unit.frame_base at it

        mem.writeInt(usize, reg_bytes[0..@sizeOf(usize)], 0xee, native_endian);
        (try regNative(&cpu_context, fp_reg_num)).* = 1;
        (try regNative(&cpu_context, ip_reg_num)).* = 2;

        try b.writeBreg(writer, fp_reg_num, @as(usize, 100));
        try b.writeBregx(writer, ip_reg_num, @as(usize, 200));
        try b.writeRegvalType(writer, @as(u8, 0), @as(usize, 300));

        _ = try stack_machine.run(program.written(), allocator, context, 0);

        const regval_type = stack_machine.stack.pop().?.regval_type;
        try testing.expectEqual(@as(usize, 300), regval_type.type_offset);
        try testing.expectEqual(@as(u8, @sizeOf(usize)), regval_type.type_size);
        try testing.expectEqual(@as(usize, 0xee), regval_type.value);

        try testing.expectEqual(@as(usize, 202), stack_machine.stack.pop().?.generic);
        try testing.expectEqual(@as(usize, 101), stack_machine.stack.pop().?.generic);
    }

    // Stack operations
    {
        var context = Context{};

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u8, 1);
        try b.writeOpcode(writer, OP.dup);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 1), stack_machine.stack.pop().?.generic);
        try testing.expectEqual(@as(usize, 1), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u8, 1);
        try b.writeOpcode(writer, OP.drop);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expect(stack_machine.stack.pop() == null);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u8, 4);
        try b.writeConst(writer, u8, 5);
        try b.writeConst(writer, u8, 6);
        try b.writePick(writer, 2);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 4), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u8, 4);
        try b.writeConst(writer, u8, 5);
        try b.writeConst(writer, u8, 6);
        try b.writeOpcode(writer, OP.over);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 5), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u8, 5);
        try b.writeConst(writer, u8, 6);
        try b.writeOpcode(writer, OP.swap);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 5), stack_machine.stack.pop().?.generic);
        try testing.expectEqual(@as(usize, 6), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u8, 4);
        try b.writeConst(writer, u8, 5);
        try b.writeConst(writer, u8, 6);
        try b.writeOpcode(writer, OP.rot);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 5), stack_machine.stack.pop().?.generic);
        try testing.expectEqual(@as(usize, 4), stack_machine.stack.pop().?.generic);
        try testing.expectEqual(@as(usize, 6), stack_machine.stack.pop().?.generic);

        const deref_target: usize = @truncate(0xffeeffee_ffeeffee);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeAddr(writer, @intFromPtr(&deref_target));
        try b.writeOpcode(writer, OP.deref);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(deref_target, stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeLiteral(writer, 0);
        try b.writeAddr(writer, @intFromPtr(&deref_target));
        try b.writeOpcode(writer, OP.xderef);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(deref_target, stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeAddr(writer, @intFromPtr(&deref_target));
        try b.writeDerefSize(writer, 1);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, @as(*const u8, @ptrCast(&deref_target)).*), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeLiteral(writer, 0);
        try b.writeAddr(writer, @intFromPtr(&deref_target));
        try b.writeXDerefSize(writer, 1);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, @as(*const u8, @ptrCast(&deref_target)).*), stack_machine.stack.pop().?.generic);

        const type_offset: usize = @truncate(0xaabbaabb_aabbaabb);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeAddr(writer, @intFromPtr(&deref_target));
        try b.writeDerefType(writer, 1, type_offset);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        const deref_type = stack_machine.stack.pop().?.regval_type;
        try testing.expectEqual(type_offset, deref_type.type_offset);
        try testing.expectEqual(@as(u8, 1), deref_type.type_size);
        try testing.expectEqual(@as(usize, @as(*const u8, @ptrCast(&deref_target)).*), deref_type.value);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeLiteral(writer, 0);
        try b.writeAddr(writer, @intFromPtr(&deref_target));
        try b.writeXDerefType(writer, 1, type_offset);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        const xderef_type = stack_machine.stack.pop().?.regval_type;
        try testing.expectEqual(type_offset, xderef_type.type_offset);
        try testing.expectEqual(@as(u8, 1), xderef_type.type_size);
        try testing.expectEqual(@as(usize, @as(*const u8, @ptrCast(&deref_target)).*), xderef_type.value);

        context.object_address = &deref_target;

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeOpcode(writer, OP.push_object_address);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, @intFromPtr(context.object_address.?)), stack_machine.stack.pop().?.generic);

        // TODO: Test OP.form_tls_address

        context.cfa = @truncate(0xccddccdd_ccddccdd);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeOpcode(writer, OP.call_frame_cfa);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(context.cfa.?, stack_machine.stack.pop().?.generic);
    }

    // Arithmetic and Logical Operations
    {
        const context = Context{};

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, i16, -4096);
        try b.writeOpcode(writer, OP.abs);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 4096), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u16, 0xff0f);
        try b.writeConst(writer, u16, 0xf0ff);
        try b.writeOpcode(writer, OP.@"and");
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 0xf00f), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, i16, -404);
        try b.writeConst(writer, i16, 100);
        try b.writeOpcode(writer, OP.div);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(isize, -404 / 100), @as(isize, @bitCast(stack_machine.stack.pop().?.generic)));

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u16, 200);
        try b.writeConst(writer, u16, 50);
        try b.writeOpcode(writer, OP.minus);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 150), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u16, 123);
        try b.writeConst(writer, u16, 100);
        try b.writeOpcode(writer, OP.mod);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 23), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u16, 0xff);
        try b.writeConst(writer, u16, 0xee);
        try b.writeOpcode(writer, OP.mul);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 0xed12), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u16, 5);
        try b.writeOpcode(writer, OP.neg);
        try b.writeConst(writer, i16, -6);
        try b.writeOpcode(writer, OP.neg);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 6), stack_machine.stack.pop().?.generic);
        try testing.expectEqual(@as(isize, -5), @as(isize, @bitCast(stack_machine.stack.pop().?.generic)));

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u16, 0xff0f);
        try b.writeOpcode(writer, OP.not);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(~@as(usize, 0xff0f), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u16, 0xff0f);
        try b.writeConst(writer, u16, 0xf0ff);
        try b.writeOpcode(writer, OP.@"or");
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 0xffff), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, i16, 402);
        try b.writeConst(writer, i16, 100);
        try b.writeOpcode(writer, OP.plus);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 502), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u16, 4096);
        try b.writePlusUconst(writer, @as(usize, 8192));
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 4096 + 8192), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u16, 0xfff);
        try b.writeConst(writer, u16, 1);
        try b.writeOpcode(writer, OP.shl);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 0xfff << 1), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u16, 0xfff);
        try b.writeConst(writer, u16, 1);
        try b.writeOpcode(writer, OP.shr);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 0xfff >> 1), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u16, 0xfff);
        try b.writeConst(writer, u16, 1);
        try b.writeOpcode(writer, OP.shr);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, @bitCast(@as(isize, 0xfff) >> 1)), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConst(writer, u16, 0xf0ff);
        try b.writeConst(writer, u16, 0xff0f);
        try b.writeOpcode(writer, OP.xor);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 0x0ff0), stack_machine.stack.pop().?.generic);
    }

    // Control Flow Operations
    {
        const context = Context{};
        const expected = .{
            .{ OP.le, 1, 1, 0 },
            .{ OP.ge, 1, 0, 1 },
            .{ OP.eq, 1, 0, 0 },
            .{ OP.lt, 0, 1, 0 },
            .{ OP.gt, 0, 0, 1 },
            .{ OP.ne, 0, 1, 1 },
        };

        inline for (expected) |e| {
            stack_machine.reset();
            program.clearRetainingCapacity();

            try b.writeConst(writer, u16, 0);
            try b.writeConst(writer, u16, 0);
            try b.writeOpcode(writer, e[0]);
            try b.writeConst(writer, u16, 0);
            try b.writeConst(writer, u16, 1);
            try b.writeOpcode(writer, e[0]);
            try b.writeConst(writer, u16, 1);
            try b.writeConst(writer, u16, 0);
            try b.writeOpcode(writer, e[0]);
            _ = try stack_machine.run(program.written(), allocator, context, null);
            try testing.expectEqual(@as(usize, e[3]), stack_machine.stack.pop().?.generic);
            try testing.expectEqual(@as(usize, e[2]), stack_machine.stack.pop().?.generic);
            try testing.expectEqual(@as(usize, e[1]), stack_machine.stack.pop().?.generic);
        }

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeLiteral(writer, 2);
        try b.writeSkip(writer, 1);
        try b.writeLiteral(writer, 3);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 2), stack_machine.stack.pop().?.generic);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeLiteral(writer, 2);
        try b.writeBra(writer, 1);
        try b.writeLiteral(writer, 3);
        try b.writeLiteral(writer, 0);
        try b.writeBra(writer, 1);
        try b.writeLiteral(writer, 4);
        try b.writeLiteral(writer, 5);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 5), stack_machine.stack.pop().?.generic);
        try testing.expectEqual(@as(usize, 4), stack_machine.stack.pop().?.generic);
        try testing.expect(stack_machine.stack.pop() == null);

        // TODO: Test call2, call4, call_ref once implemented

    }

    // Type conversions
    {
        const context = Context{};
        stack_machine.reset();
        program.clearRetainingCapacity();

        // TODO: Test typed OP.convert once implemented

        const value: usize = @truncate(0xffeeffee_ffeeffee);
        var value_bytes: [options.addr_size]u8 = undefined;
        mem.writeInt(usize, &value_bytes, value, native_endian);

        // Convert to generic type
        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConstType(writer, @as(usize, 0), &value_bytes);
        try b.writeConvert(writer, @as(usize, 0));
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(value, stack_machine.stack.pop().?.generic);

        // Reinterpret to generic type
        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConstType(writer, @as(usize, 0), &value_bytes);
        try b.writeReinterpret(writer, @as(usize, 0));
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(value, stack_machine.stack.pop().?.generic);

        // Reinterpret to new type
        const die_offset: usize = 0xffee;

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeConstType(writer, @as(usize, 0), &value_bytes);
        try b.writeReinterpret(writer, die_offset);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        const const_type = stack_machine.stack.pop().?.const_type;
        try testing.expectEqual(die_offset, const_type.type_offset);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeLiteral(writer, 0);
        try b.writeReinterpret(writer, die_offset);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        const regval_type = stack_machine.stack.pop().?.regval_type;
        try testing.expectEqual(die_offset, regval_type.type_offset);
    }

    // Special operations
    {
        var context = Context{};

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeOpcode(writer, OP.nop);
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expect(stack_machine.stack.pop() == null);

        // Sub-expression
        {
            var sub_program: std.Io.Writer.Allocating = .init(allocator);
            defer sub_program.deinit();
            const sub_writer = &sub_program.writer;
            try b.writeLiteral(sub_writer, 3);

            stack_machine.reset();
            program.clearRetainingCapacity();
            try b.writeEntryValue(writer, sub_program.written());
            _ = try stack_machine.run(program.written(), allocator, context, null);
            try testing.expectEqual(@as(usize, 3), stack_machine.stack.pop().?.generic);
        }

        // Register location description
        var cpu_context: debug.cpu_context.Native = undefined;
        context = .{ .cpu_context = &cpu_context };

        const reg_bytes = try cpu_context.dwarfRegisterBytes(0);
        mem.writeInt(usize, reg_bytes[0..@sizeOf(usize)], 0xee, native_endian);

        var sub_program: std.Io.Writer.Allocating = .init(allocator);
        defer sub_program.deinit();
        const sub_writer = &sub_program.writer;
        try b.writeReg(sub_writer, 0);

        stack_machine.reset();
        program.clearRetainingCapacity();
        try b.writeEntryValue(writer, sub_program.written());
        _ = try stack_machine.run(program.written(), allocator, context, null);
        try testing.expectEqual(@as(usize, 0xee), stack_machine.stack.pop().?.generic);
    }
}
