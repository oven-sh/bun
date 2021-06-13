const options = @import("./options.zig");
usingnamespace @import("ast/base.zig");
usingnamespace @import("global.zig");
const std = @import("std");
pub const ProdSourceContent = @embedFile("./runtime.out.js");

pub const Runtime = struct {
    pub fn sourceContent() string {
        if (isDebug) {
            var runtime_path = std.fs.path.join(std.heap.c_allocator, &[_]string{ std.fs.path.dirname(@src().file).?, "runtime.out.js" }) catch unreachable;
            const file = std.fs.openFileAbsolute(runtime_path, .{}) catch unreachable;
            defer file.close();
            return file.readToEndAlloc(std.heap.c_allocator, (file.stat() catch unreachable).size) catch unreachable;
        } else {
            return ProdSourceContent;
        }
    }
    pub var version_hash = @embedFile("./runtime.version");
    pub fn version() string {
        return version_hash;
    }

    pub const Features = struct {
        react_fast_refresh: bool = false,
        hot_module_reloading: bool = false,
        keep_names_for_arrow_functions: bool = true,
    };

    pub const Imports = struct {
        __name: ?Ref = null,
        __toModule: ?Ref = null,
        __commonJS: ?Ref = null,
        __require: ?Ref = null,
        __export: ?Ref = null,
        __reExport: ?Ref = null,
        __load: ?Ref = null,
        load_from_bundle: ?Ref = null,
        register: ?Ref = null,
        lazy_export: ?Ref = null,

        pub const all = [_][]const u8{
            "__name",
            "__toModule",
            "__require",
            "__commonJS",
            "__export",
            "__reExport",
            "__load",
            // require
            "load_from_bundle",
            //
            "register",
            "lazy_export",
        };
        pub const Name = "<RUNTIME";

        pub const Iterator = struct {
            i: usize = 0,

            runtime_imports: *Imports,

            const Entry = struct {
                key: u16,
                value: Ref,
            };

            pub fn next(this: *Iterator) ?Entry {
                while (this.i < all.len) {
                    defer this.i += 1;

                    switch (this.i) {
                        0 => {
                            if (@field(this.runtime_imports, all[0])) |val| {
                                return Entry{ .key = 0, .value = val };
                            }
                        },
                        1 => {
                            if (@field(this.runtime_imports, all[1])) |val| {
                                return Entry{ .key = 1, .value = val };
                            }
                        },
                        2 => {
                            if (@field(this.runtime_imports, all[2])) |val| {
                                return Entry{ .key = 2, .value = val };
                            }
                        },
                        3 => {
                            if (@field(this.runtime_imports, all[3])) |val| {
                                return Entry{ .key = 3, .value = val };
                            }
                        },
                        4 => {
                            if (@field(this.runtime_imports, all[4])) |val| {
                                return Entry{ .key = 4, .value = val };
                            }
                        },
                        5 => {
                            if (@field(this.runtime_imports, all[5])) |val| {
                                return Entry{ .key = 5, .value = val };
                            }
                        },
                        6 => {
                            if (@field(this.runtime_imports, all[6])) |val| {
                                return Entry{ .key = 6, .value = val };
                            }
                        },
                        7 => {
                            if (@field(this.runtime_imports, all[7])) |val| {
                                return Entry{ .key = 7, .value = val };
                            }
                        },
                        8 => {
                            if (@field(this.runtime_imports, all[8])) |val| {
                                return Entry{ .key = 8, .value = val };
                            }
                        },
                        9 => {
                            if (@field(this.runtime_imports, all[9])) |val| {
                                return Entry{ .key = 9, .value = val };
                            }
                        },

                        else => {
                            return null;
                        },
                    }
                }

                return null;
            }
        };

        pub fn iter(imports: *Imports) Iterator {
            return Iterator{ .runtime_imports = imports };
        }

        pub fn contains(imports: *const Imports, comptime key: string) bool {
            return @field(imports, key) != null;
        }

        pub fn hasAny(imports: *const Imports) bool {
            inline for (all) |field| {
                if (@field(imports, field) != null) {
                    return true;
                }
            }

            return false;
        }

        pub fn put(imports: *Imports, comptime key: string, ref: Ref) void {
            @field(imports, key) = ref;
        }

        pub fn at(
            imports: *Imports,
            comptime key: string,
        ) ?Ref {
            return @field(imports, key);
        }

        pub fn get(
            imports: *const Imports,
            key: anytype,
        ) ?Ref {
            return switch (key) {
                0 => @field(imports, all[0]),
                1 => @field(imports, all[1]),
                2 => @field(imports, all[2]),
                3 => @field(imports, all[3]),
                4 => @field(imports, all[4]),
                5 => @field(imports, all[5]),
                6 => @field(imports, all[6]),
                7 => @field(imports, all[7]),
                8 => @field(imports, all[8]),
                9 => @field(imports, all[9]),
                else => null,
            };
        }

        pub fn count(imports: *const Imports) usize {
            var i: usize = 0;

            inline for (all) |field| {
                if (@field(imports, field) != null) {
                    i += 1;
                }
            }

            return i;
        }
    };
};
