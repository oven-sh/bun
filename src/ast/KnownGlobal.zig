pub const KnownGlobal = enum {
    WeakSet,
    WeakMap,
    Date,
    Set,
    Map,
    Headers,
    Response,
    TextEncoder,
    TextDecoder,
    Error,
    TypeError,
    SyntaxError,
    RangeError,
    ReferenceError,
    EvalError,
    URIError,
    AggregateError,
    Array,
    Object,
    Function,
    RegExp,

    pub const map = bun.ComptimeEnumMap(KnownGlobal);

    inline fn callFromNew(e: *E.New, loc: logger.Loc) js_ast.Expr {
        const call = E.Call{
            .target = e.target,
            .args = e.args,
            .close_paren_loc = e.close_parens_loc,
            .can_be_unwrapped_if_unused = e.can_be_unwrapped_if_unused,
        };
        return js_ast.Expr.init(E.Call, call, loc);
    }

    pub noinline fn minifyGlobalConstructor(allocator: std.mem.Allocator, noalias e: *E.New, symbols: []const Symbol, loc: logger.Loc, minify_whitespace: bool) ?js_ast.Expr {
        const id = if (e.target.data == .e_identifier) e.target.data.e_identifier.ref else return null;
        const symbol = &symbols[id.innerIndex()];
        if (symbol.kind != .unbound)
            return null;

        const constructor = map.get(symbol.original_name) orelse return null;

        return switch (constructor) {
            // Error constructors can be called without 'new' with identical behavior
            .Error, .TypeError, .SyntaxError, .RangeError, .ReferenceError, .EvalError, .URIError, .AggregateError => {
                // Convert `new Error(...)` to `Error(...)` to save bytes
                return callFromNew(e, loc);
            },

            .Object => {
                const n = e.args.len;

                if (n == 0) {
                    // new Object() -> {}
                    return js_ast.Expr.init(E.Object, E.Object{}, loc);
                }

                if (n == 1) {
                    const arg = e.args.ptr[0];
                    switch (arg.data) {
                        .e_object, .e_array => {
                            // new Object({a: 1}) -> {a: 1}
                            // new Object([1, 2]) -> [1, 2]
                            return arg;
                        },
                        .e_null, .e_undefined => {
                            // new Object(null) -> {}
                            // new Object(undefined) -> {}
                            return js_ast.Expr.init(E.Object, E.Object{}, loc);
                        },
                        else => {},
                    }
                }

                // For other cases, just remove 'new'
                return callFromNew(e, loc);
            },

            .Array => {
                const n = e.args.len;

                return switch (n) {
                    0 => {
                        // new Array() -> []
                        return js_ast.Expr.init(E.Array, E.Array{}, loc);
                    },
                    1 => {
                        // For single argument, only convert to literal if we're SURE it's not a number
                        const arg = e.args.ptr[0];

                        // Check if it's an object or array literal first
                        switch (arg.data) {
                            .e_object, .e_array => {
                                // new Array({}) -> [{}], new Array([1]) -> [[1]]
                                // These are definitely not numbers, safe to convert
                                return js_ast.Expr.init(E.Array, .{ .items = e.args }, loc);
                            },
                            else => {},
                        }

                        // For other types, check via knownPrimitive
                        const primitive = arg.knownPrimitive();
                        // Only convert if we know for certain it's not a number
                        // unknown could be a number at runtime, so we must preserve Array() call
                        switch (primitive) {
                            .null, .undefined, .boolean, .string, .bigint => {
                                // These are definitely not numbers, safe to convert
                                return js_ast.Expr.init(E.Array, .{ .items = e.args }, loc);
                            },
                            .number => {
                                if (arg.data != .e_number) {
                                    return callFromNew(e, loc);
                                }
                                const val = arg.data.e_number.value;
                                if (
                                // only want this with whitespace minification
                                minify_whitespace and
                                    (val == 0 or
                                        val == 1 or
                                        val == 2 or
                                        val == 3 or
                                        val == 4 or
                                        val == 5 or
                                        val == 6 or
                                        val == 7 or
                                        val == 8 or
                                        val == 9 or
                                        val == 10))
                                {
                                    const arg_loc = arg.loc;
                                    var list = e.args.moveToListManaged(allocator);
                                    list.clearRetainingCapacity();
                                    bun.handleOom(list.appendNTimes(js_ast.Expr{ .data = js_parser.Prefill.Data.EMissing, .loc = arg_loc }, @intFromFloat(val)));
                                    return js_ast.Expr.init(E.Array, .{ .items = .moveFromList(&list) }, loc);
                                }
                                return callFromNew(e, loc);
                            },
                            .unknown, .mixed => {
                                // Could be a number, preserve Array() call
                                return callFromNew(e, loc);
                            },
                        }
                    },
                    // > 1
                    else => {
                        // new Array(1, 2, 3) -> [1, 2, 3]
                        // But NOT new Array(3) which creates an array with 3 empty slots
                        return js_ast.Expr.init(E.Array, .{ .items = e.args }, loc);
                    },
                };
            },

            .Function => {
                // Just remove 'new' for Function
                return callFromNew(e, loc);
            },
            .RegExp => {
                // Don't optimize RegExp - the semantics are too complex:
                // - new RegExp(re) creates a copy, but RegExp(re) returns the same instance
                // - This affects object identity and lastIndex behavior
                // - The difference only applies when flags are undefined
                // Keep the original new RegExp() call to preserve correct semantics
                return null;
            },
            .WeakSet, .WeakMap => {
                const n = e.args.len;

                if (n == 0) {
                    // "new WeakSet()" is pure
                    e.can_be_unwrapped_if_unused = .if_unused;

                    return null;
                }

                if (n == 1) {
                    switch (e.args.ptr[0].data) {
                        .e_null, .e_undefined => {
                            // "new WeakSet(null)" is pure
                            // "new WeakSet(void 0)" is pure
                            e.can_be_unwrapped_if_unused = .if_unused;
                        },
                        .e_array => |array| {
                            if (array.items.len == 0) {
                                // "new WeakSet([])" is pure
                                e.can_be_unwrapped_if_unused = .if_unused;
                            } else {
                                // "new WeakSet([x])" is impure because an exception is thrown if "x" is not an object
                            }
                        },
                        else => {
                            // "new WeakSet(x)" is impure because the iterator for "x" could have side effects
                        },
                    }
                }
                return null;
            },
            .Date => {
                const n = e.args.len;

                if (n == 0) {
                    // "new Date()" is pure
                    e.can_be_unwrapped_if_unused = .if_unused;

                    return null;
                }

                if (n == 1) {
                    switch (e.args.ptr[0].knownPrimitive()) {
                        .null, .undefined, .boolean, .number, .string => {
                            // "new Date('')" is pure
                            // "new Date(0)" is pure
                            // "new Date(null)" is pure
                            // "new Date(true)" is pure
                            // "new Date(false)" is pure
                            // "new Date(undefined)" is pure
                            e.can_be_unwrapped_if_unused = .if_unused;
                        },
                        else => {
                            // "new Date(x)" is impure because the argument could be a string with side effects

                        },
                    }
                }
                return null;
            },

            .Set => {
                const n = e.args.len;

                if (n == 0) {
                    // "new Set()" is pure
                    e.can_be_unwrapped_if_unused = .if_unused;
                    return null;
                }

                if (n == 1) {
                    switch (e.args.ptr[0].data) {
                        .e_array, .e_null, .e_undefined => {
                            // "new Set([a, b, c])" is pure
                            // "new Set(null)" is pure
                            // "new Set(void 0)" is pure
                            e.can_be_unwrapped_if_unused = .if_unused;
                        },
                        else => {
                            // "new Set(x)" is impure because the iterator for "x" could have side effects
                        },
                    }
                }
                return null;
            },

            .Headers => {
                const n = e.args.len;

                if (n == 0) {
                    // "new Headers()" is pure
                    e.can_be_unwrapped_if_unused = .if_unused;

                    return null;
                }
                return null;
            },

            .Response => {
                const n = e.args.len;

                if (n == 0) {
                    // "new Response()" is pure
                    e.can_be_unwrapped_if_unused = .if_unused;

                    return null;
                }

                if (n == 1) {
                    switch (e.args.ptr[0].knownPrimitive()) {
                        .null, .undefined, .boolean, .number, .string => {
                            // "new Response('')" is pure
                            // "new Response(0)" is pure
                            // "new Response(null)" is pure
                            // "new Response(true)" is pure
                            // "new Response(false)" is pure
                            // "new Response(undefined)" is pure

                            e.can_be_unwrapped_if_unused = .if_unused;
                        },
                        else => {
                            // "new Response(x)" is impure
                        },
                    }
                }
                return null;
            },
            .TextDecoder, .TextEncoder => {
                const n = e.args.len;

                if (n == 0) {
                    // "new TextEncoder()" is pure
                    // "new TextDecoder()" is pure
                    e.can_be_unwrapped_if_unused = .if_unused;

                    return null;
                }

                // We _could_ validate the encoding argument
                // But let's not bother
                return null;
            },

            .Map => {
                const n = e.args.len;

                if (n == 0) {
                    // "new Map()" is pure
                    e.can_be_unwrapped_if_unused = .if_unused;
                    return null;
                }

                if (n == 1) {
                    switch (e.args.ptr[0].data) {
                        .e_null, .e_undefined => {
                            // "new Map(null)" is pure
                            // "new Map(void 0)" is pure
                            e.can_be_unwrapped_if_unused = .if_unused;
                        },
                        .e_array => |array| {
                            var all_items_are_arrays = true;
                            for (array.items.slice()) |item| {
                                if (item.data != .e_array) {
                                    all_items_are_arrays = false;
                                    break;
                                }
                            }

                            if (all_items_are_arrays) {
                                // "new Map([[a, b], [c, d]])" is pure
                                e.can_be_unwrapped_if_unused = .if_unused;
                            }
                        },
                        else => {
                            // "new Map(x)" is impure because the iterator for "x" could have side effects
                        },
                    }
                }
                return null;
            },
        };
    }
};

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const js_parser = bun.js_parser;
const logger = bun.logger;

const js_ast = bun.ast;
const E = js_ast.E;
const Symbol = js_ast.Symbol;
