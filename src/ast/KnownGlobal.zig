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

    pub const map = bun.ComptimeEnumMap(KnownGlobal);

    pub noinline fn maybeMarkConstructorAsPure(noalias e: *E.New, symbols: []const Symbol) void {
        const id = if (e.target.data == .e_identifier) e.target.data.e_identifier.ref else return;
        const symbol = &symbols[id.innerIndex()];
        if (symbol.kind != .unbound)
            return;

        const constructor = map.get(symbol.original_name) orelse return;

        switch (constructor) {
            .WeakSet, .WeakMap => {
                const n = e.args.len;

                if (n == 0) {
                    // "new WeakSet()" is pure
                    e.can_be_unwrapped_if_unused = .if_unused;

                    return;
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
            },
            .Date => {
                const n = e.args.len;

                if (n == 0) {
                    // "new Date()" is pure
                    e.can_be_unwrapped_if_unused = .if_unused;

                    return;
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
            },

            .Set => {
                const n = e.args.len;

                if (n == 0) {
                    // "new Set()" is pure
                    e.can_be_unwrapped_if_unused = .if_unused;
                    return;
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
            },

            .Headers => {
                const n = e.args.len;

                if (n == 0) {
                    // "new Headers()" is pure
                    e.can_be_unwrapped_if_unused = .if_unused;

                    return;
                }
            },

            .Response => {
                const n = e.args.len;

                if (n == 0) {
                    // "new Response()" is pure
                    e.can_be_unwrapped_if_unused = .if_unused;

                    return;
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
            },
            .TextDecoder, .TextEncoder => {
                const n = e.args.len;

                if (n == 0) {
                    // "new TextEncoder()" is pure
                    // "new TextDecoder()" is pure
                    e.can_be_unwrapped_if_unused = .if_unused;

                    return;
                }

                // We _could_ validate the encoding argument
                // But let's not bother
            },

            .Map => {
                const n = e.args.len;

                if (n == 0) {
                    // "new Map()" is pure
                    e.can_be_unwrapped_if_unused = .if_unused;
                    return;
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
            },
        }
    }
};

const string = []const u8;

const bun = @import("bun");

const js_ast = bun.ast;
const E = js_ast.E;
const Symbol = js_ast.Symbol;

const std = @import("std");
const Map = std.AutoHashMapUnmanaged;
