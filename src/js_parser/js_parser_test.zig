usingnamespace @import("./imports.zig");
usingnamespace @import("./js_parser.zig");

usingnamespace @import("../linker.zig");

const SymbolList = [][]Symbol;

// const Tester = struct {
//     allocator: *std.mem.Allocator,

//     pub const Expectation = struct {
//         target: anytype,

//         pub fn report(writer: anytype) void {}

// pub const Outcome = enum {
//     pending,
//     pass,
//     fail,
// };

//         const Normalized = struct {
//             value: NormalizedValue,
//             optional: bool = false,
//             pointer: bool = false,
//             array_like: bool = false,

//             const NormalizedValue = union(enum) {
//                 Struct: anytype,
//                 Number: f64,
//                 String: anytype,
//             };

//             pub fn parse_valuetype(value: anytype, was_optional: bool, was_pointer: bool, was_arraylike: bool, original_value: anytype) Normalized {
//                 switch (@typeInfo(@TypeOf(value))) {
//                     .Pointer => |info| {
//                         return switch (info.size) {
//                             .One => {
//                                 return parse_valuetype(value.*, was_optional, true, was_arraylike, original_value);
//                             },
//                             .Many, .C => @compileError("Not supported."),
//                             .Slice => |slice| {
//                                 return parse_valuetype(value.ptr.*, was_optional, true, true, original_value);
//                             },
//                         };
//                     },
//                     .Enum => |info| {
//                         return parse_valuetype(@enumToInt(value), was_optional, was_pointer, was_arraylike, original_value);
//                     },
//                     .Struct => |info| {
//                         return Normalized{
//                             .value = NormalizedValue{
//                                 .Struct = original_value,
//                             },
//                             .optional = was_optional,
//                             .pointer = was_pointer,
//                             .array_like = was_arraylike,
//                         };
//                     },
//                     .Int => |info| {
//                         if (std.meta.bitCount(@TypeOf(value)) == 8)
//                             return Normalized{
//                                 .value = NormalizedValue{
//                                     .Number = @intToFloat(f64, value),
//                                 },
//                                 .optional = was_optional,
//                                 .pointer = was_pointer,
//                                 .array_like = was_arraylike,
//                             };
//                     },
//                     .ComptimeInt => {
//                         return Normalized{
//                             .value = NormalizedValue{
//                                 .Number = @intToFloat(f64, value),
//                             },
//                             .optional = was_optional,
//                             .pointer = was_pointer,
//                             .array_like = was_arraylike,
//                         };
//                     },
//                     .Float => |info| {
//                         return Normalized{
//                             .value = NormalizedValue{
//                                 .Number = @floatCast(f64, value),
//                             },
//                             .optional = was_optional,
//                             .pointer = was_pointer,
//                             .array_like = was_arraylike,
//                         };
//                     },
//                 }
//             }

//             pub fn init(value: anytype) Normalized {
//                 return Normalized.parse_valuetype(value, false, false, false, value);
//             }
//         };

//         fn equals(a: anytype) bool {
//             const T = @TypeOf(a);
//             const a_info = @typeInfo(T);
//             const Tb = @TypeOf(b);
//             const b_info = @typeInfo(Tb);

//             const a_final = a_getter: {};

//             switch (@typeInfo(T)) {
//                 .Struct => |info| {
//                     inline for (info.fields) |field_info| {
//                         if (!eql(@field(a, field_info.name), @field(b, field_info.name))) return false;
//                     }
//                     return true;
//                 },
//                 .ErrorUnion => {
//                     if (a) |a_p| {
//                         if (b) |b_p| return eql(a_p, b_p) else |_| return false;
//                     } else |a_e| {
//                         if (b) |_| return false else |b_e| return a_e == b_e;
//                     }
//                 },
//                 .Union => |info| {
//                     if (info.tag_type) |UnionTag| {
//                         const tag_a = activeTag(a);
//                         const tag_b = activeTag(b);
//                         if (tag_a != tag_b) return false;

//                         inline for (info.fields) |field_info| {
//                             if (@field(UnionTag, field_info.name) == tag_a) {
//                                 return eql(@field(a, field_info.name), @field(b, field_info.name));
//                             }
//                         }
//                         return false;
//                     }

//                     @compileError("cannot compare untagged union type " ++ @typeName(T));
//                 },
//                 .Array => {
//                     if (a.len != b.len) return false;
//                     for (a) |e, i|
//                         if (!eql(e, b[i])) return false;
//                     return true;
//                 },
//                 .Vector => |info| {
//                     var i: usize = 0;
//                     while (i < info.len) : (i += 1) {
//                         if (!eql(a[i], b[i])) return false;
//                     }
//                     return true;
//                 },
//                 .Pointer => |info| {
//                     return switch (info.size) {
//                         .One, .Many, .C => a == b,
//                         .Slice => |slice| {
//                             if (a.len != b.len) {
//                                 return false;
//                             }
//                             for (a) |e, i|
//                                 if (!eql(e, b[i])) return false;
//                         },
//                     };
//                 },
//                 .Optional => {
//                     return eql(a.?, b.?);
//                 },
//                 else => return a == b,
//             }
//         }

//         pub fn toBe(value: anytype) *Expectation {}
//     };

//     pub fn expect(outcome: anytype) Expectation {}
//     pub fn init(allocator: *std.mem.Allocator) Tester {
//         return Tester{ .allocator = allocator };
//     }
// };

const RED = "\x1b[31;1m";
const GREEN = "\x1b[32;1m";
const CYAN = "\x1b[36;1m";
const WHITE = "\x1b[37;1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

pub const Tester = struct {
    pass: std.ArrayList(Expectation),
    fail: std.ArrayList(Expectation),
    allocator: *std.mem.Allocator,

    pub fn t(allocator: *std.mem.Allocator) Tester {
        return Tester{
            .allocator = allocator,
            .pass = std.ArrayList(Expectation).init(allocator),
            .fail = std.ArrayList(Expectation).init(allocator),
        };
    }

    pub const Expectation = struct {
        expected: string,
        result: string,
        source: std.builtin.SourceLocation,

        pub fn init(expected: string, result: string, src: std.builtin.SourceLocation) Expectation {
            return Expectation{
                .expected = expected,
                .result = result,
                .source = src,
            };
        }
        const PADDING = 0;
        pub fn print(self: *const @This()) void {
            var pad = &([_]u8{' '} ** PADDING);
            var stderr = std.io.getStdErr();

            stderr.writeAll(RESET) catch unreachable;
            stderr.writeAll(pad) catch unreachable;
            stderr.writeAll(DIM) catch unreachable;
            std.fmt.format(stderr.writer(), "{s}:{d}:{d}", .{ self.source.file, self.source.line, self.source.column }) catch unreachable;
            stderr.writeAll(RESET) catch unreachable;
            stderr.writeAll("\n") catch unreachable;

            stderr.writeAll(pad) catch unreachable;
            stderr.writeAll("Expected: ") catch unreachable;
            stderr.writeAll(RESET) catch unreachable;
            stderr.writeAll(GREEN) catch unreachable;
            std.fmt.format(stderr.writer(), "\"{s}\"", .{self.expected}) catch unreachable;
            stderr.writeAll(GREEN) catch unreachable;
            stderr.writeAll(RESET) catch unreachable;

            stderr.writeAll("\n") catch unreachable;
            stderr.writeAll(pad) catch unreachable;
            stderr.writeAll("Received: ") catch unreachable;
            stderr.writeAll(RESET) catch unreachable;
            stderr.writeAll(RED) catch unreachable;
            std.fmt.format(stderr.writer(), "\"{s}\"", .{self.result}) catch unreachable;
            stderr.writeAll(RED) catch unreachable;
            stderr.writeAll(RESET) catch unreachable;
            stderr.writeAll("\n") catch unreachable;
        }

        pub fn evaluate_outcome(self: *const @This()) Outcome {
            for (self.expected) |char, i| {
                if (char != self.result[i]) {
                    return Outcome.fail;
                }
            }

            return Outcome.pass;
        }
    };

    pub const Outcome = enum {
        pass,
        fail,
    };
    pub fn expect(tester: *Tester, expected: string, result: string, src: std.builtin.SourceLocation) callconv(.Inline) bool {
        var expectation = Expectation.init(expected, result, src);
        switch (expectation.evaluate_outcome()) {
            .pass => {
                tester.pass.append(expectation) catch unreachable;
                return true;
            },
            .fail => {
                tester.fail.append(expectation) catch unreachable;
                return false;
            },
        }
    }

    const ReportType = enum {
        none,
        pass,
        fail,
        some_fail,

        pub fn init(tester: *Tester) ReportType {
            if (tester.fail.items.len == 0 and tester.pass.items.len == 0) {
                return .none;
            } else if (tester.fail.items.len == 0) {
                return .pass;
            } else if (tester.pass.items.len == 0) {
                return .fail;
            } else {
                return .some_fail;
            }
        }
    };

    pub fn report(tester: *Tester, src: std.builtin.SourceLocation) void {
        var stderr = std.io.getStdErr();

        if (tester.fail.items.len > 0) {
            std.fmt.format(stderr.writer(), "\n\n", .{}) catch unreachable;
        }

        for (tester.fail.items) |item| {
            item.print();
            std.fmt.format(stderr.writer(), "\n", .{}) catch unreachable;
        }

        switch (ReportType.init(tester)) {
            .none => {
                std.log.info("No expectations.\n\n", .{});
            },
            .pass => {
                std.fmt.format(stderr.writer(), "{s}All {d} expectations passed.{s}\n", .{ GREEN, tester.pass.items.len, GREEN }) catch unreachable;
                std.fmt.format(stderr.writer(), RESET, .{}) catch unreachable;
                std.testing.expect(true);
            },
            .fail => {
                std.fmt.format(stderr.writer(), "{s}All {d} expectations failed.{s}\n\n", .{ RED, tester.fail.items.len, RED }) catch unreachable;
                std.fmt.format(stderr.writer(), RESET, .{}) catch unreachable;
                std.testing.expect(false);
            },
            .some_fail => {
                std.fmt.format(stderr.writer(), "{s}{d} failed{s} and {s}{d} passed{s} of {d} expectations{s}\n\n", .{
                    RED,
                    tester.fail.items.len,
                    RED ++ RESET,
                    GREEN,
                    tester.pass.items.len,
                    GREEN ++ RESET,
                    tester.fail.items.len + tester.pass.items.len,
                    RESET,
                }) catch unreachable;
                std.fmt.format(stderr.writer(), RESET, .{}) catch unreachable;
                std.testing.expect(false);
            },
        }
    }
};

fn expectPrinted(t: *Tester, contents: string, expected: string, src: anytype) !void {
    if (alloc.dynamic_manager == null) {
        try alloc.setup(std.heap.page_allocator);
    }

    debugl("INIT TEST");

    const opts = try options.TransformOptions.initUncached(alloc.dynamic, "file.js", contents);
    var log = logger.Log.init(alloc.dynamic);
    var source = logger.Source.initFile(opts.entry_point, alloc.dynamic);
    var ast: js_ast.Ast = undefined;

    var define = try Define.init(alloc.dynamic, null);
    debugl("INIT PARSER");
    var parser = try Parser.init(opts, &log, &source, define, alloc.dynamic);
    debugl("RUN PARSER");

    var res = try parser.parse();
    ast = res.ast;
    var symbols: SymbolList = &([_][]Symbol{ast.symbols});
    var symbol_map = js_ast.Symbol.Map.initList(symbols);

    if (log.msgs.items.len > 0) {
        debugl("PRINT LOG ERRORS");
        var fixedBuffer = [_]u8{0} ** 4096;
        var stream = std.io.fixedBufferStream(&fixedBuffer);

        try log.print(stream.writer());
        std.debug.print("{s}", .{fixedBuffer});
    }
    var linker = Linker{};
    debugl("START AST PRINT");

    if (PRINT_AST) {
        var fixed_buffer = [_]u8{0} ** 512000;
        var buf_stream = std.io.fixedBufferStream(&fixed_buffer);
        try ast.toJSON(alloc.dynamic, std.io.getStdErr().writer());
    }

    const result = js_printer.printAst(alloc.dynamic, ast, symbol_map, true, js_printer.Options{ .to_module_ref = res.ast.module_ref orelse Ref{ .inner_index = 0 } }, &linker) catch unreachable;
    var copied = try std.mem.dupe(alloc.dynamic, u8, result.js);
    _ = t.expect(contents, copied, src);
    // std.testing.expectEqualStrings(contents, copied);
}

const PRINT_AST = false;

test "expectPrint" {
    var t_ = Tester.t(std.heap.page_allocator);
    var t = &t_;

    try expectPrinted(t, "class Foo { foo() {} }", "class Foo {\n  foo() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { *foo() {} }", "class Foo {\n  *foo() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { get foo() {} }", "class Foo {\n  get foo() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { set foo(x) {} }", "class Foo {\n  set foo(x) {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static foo() {} }", "class Foo {\n  static foo() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static *foo() {} }", "class Foo {\n  static *foo() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static get foo() {} }", "class Foo {\n  static get foo() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static set foo(x) {} }", "class Foo {\n  static set foo(x) {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { async foo() {} }", "class Foo {\n  async foo() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static async foo() {} }", "class Foo {\n  static async foo() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static async *foo() {} }", "class Foo {\n  static async *foo() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static async *foo() {}\n hey = true; }", "class Foo {\n  static async *foo() {\n  }\n     hey = true;\n}\n", @src());

    try expectPrinted(t, "class Foo { if() {} }", "class Foo {\n  if() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { *if() {} }", "class Foo {\n  *if() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { get if() {} }", "class Foo {\n  get if() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { set if(x) {} }", "class Foo {\n  set if(x) {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static if() {} }", "class Foo {\n  static if() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static *if() {} }", "class Foo {\n  static *if() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static get if() {} }", "class Foo {\n  static get if() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static set if(x) {} }", "class Foo {\n  static set if(x) {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { async if() {} }", "class Foo {\n  async if() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static async if() {} }", "class Foo {\n  static async if() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static async *if() {} }", "class Foo {\n  static async *if() {\n  }\n}\n", @src());

    try expectPrinted(t, "class Foo { a() {} b() {} }", "class Foo {\n  a() {\n  }\n  b() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { a() {} get b() {} }", "class Foo {\n  a() {\n  }\n  get b() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { a() {} set b(x) {} }", "class Foo {\n  a() {\n  }\n  set b(x) {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { a() {} static b() {} }", "class Foo {\n  a() {\n  }\n  static b() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { a() {} static *b() {} }", "class Foo {\n  a() {\n  }\n  static *b() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { a() {} static get b() {} }", "class Foo {\n  a() {\n  }\n  static get b() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { a() {} static set b(x) {} }", "class Foo {\n  a() {\n  }\n  static set b(x) {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { a() {} async b() {} }", "class Foo {\n  a() {\n  }\n  async b() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { a() {} static async b() {} }", "class Foo {\n  a() {\n  }\n  static async b() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { a() {} static async *b() {} }", "class Foo {\n  a() {\n  }\n  static async *b() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { [arguments] }", "class Foo {\n  [arguments];\n}\n", @src());
    try expectPrinted(t, "class Foo { [arguments] = 1 }", "class Foo {\n  [arguments] = 1;\n}\n", @src());
    try expectPrinted(t, "class Foo { arguments = 1 }", "class Foo {\n  arguments = 1;\n}\n", @src());
    try expectPrinted(t, "class Foo { x = class { arguments = 1 } }", "class Foo {\n  x = class {\n    arguments = 1;\n  };\n}\n", @src());
    try expectPrinted(t, "class Foo { x = function() { arguments } }", "class Foo {\n  x = function() {\n    arguments;\n  };\n}\n", @src());
    try expectPrinted(t, "class Foo { get ['constructor']() {} }", "class Foo {\n  get [\"constructor\"]() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { set ['constructor'](x) {} }", "class Foo {\n  set [\"constructor\"](x) {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { *['constructor']() {} }", "class Foo {\n  *[\"constructor\"]() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { async ['constructor']() {} }", "class Foo {\n  async [\"constructor\"]() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { async *['constructor']() {} }", "class Foo {\n  async *[\"constructor\"]() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { get prototype() {} }", "class Foo {\n  get prototype() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { get 'prototype'() {} }", "class Foo {\n  get prototype() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { set prototype(x) {} }", "class Foo {\n  set prototype(x) {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { set 'prototype'(x) {} }", "class Foo {\n  set prototype(x) {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { *prototype() {} }", "class Foo {\n  *prototype() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { *'prototype'() {} }", "class Foo {\n  *prototype() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { async prototype() {} }", "class Foo {\n  async prototype() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { async 'prototype'() {} }", "class Foo {\n  async prototype() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { async *prototype() {} }", "class Foo {\n  async *prototype() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { async *'prototype'() {} }", "class Foo {\n  async *prototype() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static get ['prototype']() {} }", "class Foo {\n  static get [\"prototype\"]() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static set ['prototype'](x) {} }", "class Foo {\n  static set [\"prototype\"](x) {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static *['prototype']() {} }", "class Foo {\n  static *[\"prototype\"]() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static async ['prototype']() {} }", "class Foo {\n  static async [\"prototype\"]() {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo { static async *['prototype']() {} }", "class Foo {\n  static async *[\"prototype\"]() {\n  }\n}\n", @src());

    try expectPrinted(t, "class Foo extends Bar { constructor() { super() } }", "class Foo extends Bar {\n  constructor() {\n    super();\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo extends Bar { constructor() { () => super() } }", "class Foo extends Bar {\n  constructor() {\n    () => super();\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo extends Bar { constructor() { () => { super() } } }", "class Foo extends Bar {\n  constructor() {\n    () => {\n      super();\n    };\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo extends Bar { constructor(x = super()) {} }", "class Foo extends Bar {\n  constructor(x = super()) {\n  }\n}\n", @src());
    try expectPrinted(t, "class Foo extends Bar { constructor(x = () => super()) {} }", "class Foo extends Bar {\n  constructor(x = () => super()) {\n  }\n}\n", @src());

    try expectPrinted(t, "(x) => function() {}", "(x) => function() {\n};\n", @src());

    try expectPrinted(t, "x => function() {}", "(x) => function() {\n};\n", @src());

    try expectPrinted(t, "(x => function() {})", "(x) => function() {\n};\n", @src());

    try expectPrinted(t, "(x = () => {}) => {}", "(x = () => {\n}) => {\n};\n", @src());
    try expectPrinted(t, "async (x = () => {}) => {}", "async (x = () => {\n}) => {\n};\n", @src());

    try expectPrinted(t, "(() => {}) ? a : b", "(() => {\n}) ? a : b;\n", @src());
    try expectPrinted(t, "1 < (() => {})", "1 < (() => {\n});\n", @src());
    try expectPrinted(t, "y = x => {}", "y = (x) => {\n};\n", @src());
    try expectPrinted(t, "y = () => {}", "y = () => {\n};\n", @src());
    try expectPrinted(t, "y = (x) => {}", "y = (x) => {\n};\n", @src());
    try expectPrinted(t, "y = async x => {}", "y = async (x) => {\n};\n", @src());
    try expectPrinted(t, "y = async () => {}", "y = async () => {\n};\n", @src());
    try expectPrinted(t, "y = async (x) => {}", "y = async (x) => {\n};\n", @src());
    try expectPrinted(t, "1 + function () {}", "1 + function() {\n};\n", @src());
    try expectPrinted(t, "1 + async function () {}", "1 + async function() {\n};\n", @src());
    try expectPrinted(t, "class Foo extends function () {} {}", "class Foo extends function() {\n} {\n}\n", @src());
    try expectPrinted(t, "class Foo extends async function () {} {}", "class Foo extends async function() {\n} {\n}\n", @src());

    try expectPrinted(t, "() => {}\n(0)", "() => {\n};\n0;\n", @src());
    try expectPrinted(t, "x => {}\n(0)", "(x) => {\n};\n0;\n", @src());
    try expectPrinted(t, "async () => {}\n(0)", "async () => {\n};\n0;\n", @src());
    try expectPrinted(t, "async x => {}\n(0)", "async (x) => {\n};\n0;\n", @src());
    try expectPrinted(t, "async (x) => {}\n(0)", "async (x) => {\n};\n0;\n", @src());

    try expectPrinted(t, "() => {}\n,0", "() => {\n}, 0;\n", @src());
    try expectPrinted(t, "x => {}\n,0", "(x) => {\n}, 0;\n", @src());
    try expectPrinted(t, "async () => {}\n,0", "async () => {\n}, 0;\n", @src());
    try expectPrinted(t, "async x => {}\n,0", "async (x) => {\n}, 0;\n", @src());
    try expectPrinted(t, "async (x) => {}\n,0", "async (x) => {\n}, 0;\n", @src());

    try expectPrinted(t, "(() => {})\n(0)", "(() => {\n})(0);\n", @src());
    try expectPrinted(t, "(x => {})\n(0)", "((x) => {\n})(0);\n", @src());
    try expectPrinted(t, "(async () => {})\n(0)", "(async () => {\n})(0);\n", @src());
    try expectPrinted(t, "(async x => {})\n(0)", "(async (x) => {\n})(0);\n", @src());
    try expectPrinted(t, "(async (x) => {})\n(0)", "(async (x) => {\n})(0);\n", @src());
    try expectPrinted(t, "y = () => {}\n(0)", "y = () => {\n};\n0;\n", @src());
    try expectPrinted(t, "y = x => {}\n(0)", "y = (x) => {\n};\n0;\n", @src());
    try expectPrinted(t, "y = async () => {}\n(0)", "y = async () => {\n};\n0;\n", @src());
    try expectPrinted(t, "y = async x => {}\n(0)", "y = async (x) => {\n};\n0;\n", @src());
    try expectPrinted(t, "y = async (x) => {}\n(0)", "y = async (x) => {\n};\n0;\n", @src());

    try expectPrinted(t, "y = () => {}\n,0", "y = () => {\n}, 0;\n", @src());
    try expectPrinted(t, "y = x => {}\n,0", "y = (x) => {\n}, 0;\n", @src());
    try expectPrinted(t, "y = async () => {}\n,0", "y = async () => {\n}, 0;\n", @src());
    try expectPrinted(t, "y = async x => {}\n,0", "y = async (x) => {\n}, 0;\n", @src());
    try expectPrinted(t, "y = async (x) => {}\n,0", "y = async (x) => {\n}, 0;\n", @src());

    try expectPrinted(t, "y = (() => {})\n(0)", "y = (() => {\n})(0);\n", @src());
    try expectPrinted(t, "y = (x => {})\n(0)", "y = ((x) => {\n})(0);\n", @src());
    try expectPrinted(t, "y = (async () => {})\n(0)", "y = (async () => {\n})(0);\n", @src());
    try expectPrinted(t, "y = (async x => {})\n(0)", "y = (async (x) => {\n})(0);\n", @src());
    try expectPrinted(t, "y = (async (x) => {})\n(0)", "y = (async (x) => {\n})(0);\n", @src());
    try expectPrinted(t, "(() => {}\n,0)", "() => {\n}, 0;\n", @src());
    try expectPrinted(t, "(x => {}\n,0)", "(x) => {\n}, 0;\n", @src());
    try expectPrinted(t, "(async () => {}\n,0)", "async () => {\n}, 0;\n", @src());
    try expectPrinted(t, "(async x => {}\n,0)", "async (x) => {\n}, 0;\n", @src());
    try expectPrinted(t, "(async (x) => {}\n,0)", "async (x) => {\n}, 0;\n", @src());

    try expectPrinted(t, "((() => {})\n(0))", "(() => {\n})(0);\n", @src());
    try expectPrinted(t, "((x => {})\n(0))", "((x) => {\n})(0);\n", @src());
    try expectPrinted(t, "((async () => {})\n(0))", "(async () => {\n})(0);\n", @src());
    try expectPrinted(t, "((async x => {})\n(0))", "(async (x) => {\n})(0);\n", @src());
    try expectPrinted(t, "((async (x) => {})\n(0))", "(async (x) => {\n})(0);\n", @src());

    try expectPrinted(t, "y = (() => {}\n,0)", "y = (() => {\n}, 0);\n", @src());
    try expectPrinted(t, "y = (x => {}\n,0)", "y = ((x) => {\n}, 0);\n", @src());
    try expectPrinted(t, "y = (async () => {}\n,0)", "y = (async () => {\n}, 0);\n", @src());
    try expectPrinted(t, "y = (async x => {}\n,0)", "y = (async (x) => {\n}, 0);\n", @src());
    try expectPrinted(t, "y = (async (x) => {}\n,0)", "y = (async (x) => {\n}, 0);\n", @src());

    try expectPrinted(t, "y = ((() => {})\n(0))", "y = (() => {\n})(0);\n", @src());
    try expectPrinted(t, "y = ((x => {})\n(0))", "y = ((x) => {\n})(0);\n", @src());
    try expectPrinted(t, "y = ((async () => {})\n(0))", "y = (async () => {\n})(0);\n", @src());
    try expectPrinted(t, "y = ((async x => {})\n(0))", "y = (async (x) => {\n})(0);\n", @src());
    try expectPrinted(t, "y = ((async (x) => {})\n(0))", "y = (async (x) => {\n})(0);\n", @src());

    try expectPrinted(t, "(-x) ** 2", "(-x) ** 2;\n", @src());
    try expectPrinted(t, "(+x) ** 2", "(+x) ** 2;\n", @src());
    try expectPrinted(t, "(~x) ** 2", "(~x) ** 2;\n", @src());
    try expectPrinted(t, "(!x) ** 2", "(!x) ** 2;\n", @src());
    try expectPrinted(t, "(-1) ** 2", "(-1) ** 2;\n", @src());
    try expectPrinted(t, "(+1) ** 2", "1 ** 2;\n", @src());
    try expectPrinted(t, "(~1) ** 2", "(~1) ** 2;\n", @src());
    try expectPrinted(t, "(!1) ** 2", "false ** 2;\n", @src());
    try expectPrinted(t, "(void x) ** 2", "(void x) ** 2;\n", @src());
    try expectPrinted(t, "(delete x) ** 2", "(delete x) ** 2;\n", @src());
    try expectPrinted(t, "(typeof x) ** 2", "(typeof x) ** 2;\n", @src());
    try expectPrinted(t, "undefined ** 2", "(void 0) ** 2;\n", @src());

    try expectPrinted(t, "({ prototype: 1 })", "({prototype: 1});\n", @src());
    try expectPrinted(t, "({ get prototype() {} })", "({get prototype() {\n}});\n", @src());
    try expectPrinted(t, "({ set prototype(x) {} })", "({set prototype(x) {\n}});\n", @src());
    try expectPrinted(t, "({ *prototype() {} })", "({*prototype() {\n}});\n", @src());
    try expectPrinted(t, "({ async prototype() {} })", "({async prototype() {\n}});\n", @src());
    try expectPrinted(t, "({ async* prototype() {} })", "({async *prototype() {\n}});\n", @src());

    try expectPrinted(t, "({foo})", "({foo});\n", @src());
    try expectPrinted(t, "({foo:0})", "({foo: 0});\n", @src());
    try expectPrinted(t, "({1e9:0})", "({1e9: 0});\n", @src());
    try expectPrinted(t, "({1_2_3n:0})", "({123n: 0});\n", @src());
    try expectPrinted(t, "({0x1_2_3n:0})", "({0x123n: 0});\n", @src());
    try expectPrinted(t, "({foo() {}})", "({foo() {\n}});\n", @src());
    try expectPrinted(t, "({*foo() {}})", "({*foo() {\n}});\n", @src());
    try expectPrinted(t, "({get foo() {}})", "({get foo() {\n}});\n", @src());
    try expectPrinted(t, "({set foo(x) {}})", "({set foo(x) {\n}});\n", @src());

    try expectPrinted(t, "({if:0})", "({if: 0});\n", @src());
    try expectPrinted(t, "({if() {}})", "({if() {\n}});\n", @src());
    try expectPrinted(t, "({*if() {}})", "({*if() {\n}});\n", @src());
    try expectPrinted(t, "({get if() {}})", "({get if() {\n}});\n", @src());
    try expectPrinted(t, "({set if(x) {}})", "({set if(x) {\n}});\n", @src());

    try expectPrinted(t, "await x", "await x;\n", @src());
    try expectPrinted(t, "await +x", "await +x;\n", @src());
    try expectPrinted(t, "await -x", "await -x;\n", @src());
    try expectPrinted(t, "await ~x", "await ~x;\n", @src());
    try expectPrinted(t, "await !x", "await !x;\n", @src());
    try expectPrinted(t, "await --x", "await --x;\n", @src());
    try expectPrinted(t, "await ++x", "await ++x;\n", @src());
    try expectPrinted(t, "await x--", "await x--;\n", @src());
    try expectPrinted(t, "await x++", "await x++;\n", @src());
    try expectPrinted(t, "await void x", "await void x;\n", @src());
    try expectPrinted(t, "await typeof x", "await typeof x;\n", @src());
    try expectPrinted(t, "await (x * y)", "await (x * y);\n", @src());
    try expectPrinted(t, "await (x ** y)", "await (x ** y);\n", @src());

    t.report(@src());
}
