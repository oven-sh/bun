const ExternalStringList = @import("./install.zig").ExternalStringList;
const Semver = @import("./semver.zig");
const ExternalString = Semver.ExternalString;
const String = Semver.String;
const std = @import("std");

/// Normalized `bin` field in [package.json](https://docs.npmjs.com/cli/v8/configuring-npm/package-json#bin)
/// Can be a:
/// - file path (relative to the package root)
/// - directory (relative to the package root)
/// - map where keys are names of the binaries and values are file paths to the binaries
pub const Bin = extern struct {
    tag: Tag = Tag.none,
    value: Value = Value{ .none = .{} },

    pub fn count(this: Bin, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) void {
        switch (this.tag) {
            .file => builder.count(this.value.file.slice(buf)),
            .named_file => {
                builder.count(this.value.named_file[0].slice(buf));
                builder.count(this.value.named_file[1].slice(buf));
            },
            .dir => builder.count(this.value.dir.slice(buf)),
            .map => @panic("Bin.map not implemented yet!!. That means \"bin\" as multiple specific files won't work just yet"),
            else => {},
        }
    }

    pub fn clone(this: Bin, buf: []const u8, comptime StringBuilder: type, builder: StringBuilder) Bin {
        return switch (this.tag) {
            .none => Bin{ .tag = .none, .value = .{ .none = .{} } },
            .file => Bin{
                .tag = .file,
                .value = .{ .file = builder.append(String, this.value.file.slice(buf)) },
            },
            .named_file => Bin{
                .tag = .named_file,
                .value = .{
                    .named_file = [2]String{
                        builder.append(String, this.value.named_file[0].slice(buf)),
                        builder.append(String, this.value.named_file[1].slice(buf)),
                    },
                },
            },
            .dir => Bin{
                .tag = .dir,
                .value = .{ .dir = builder.append(String, this.value.dir.slice(buf)) },
            },
            .map => @panic("Bin.map not implemented yet!!. That means \"bin\" as multiple specific files won't work just yet"),
        };
    }

    pub const Value = extern union {
        /// no "bin", or empty "bin"
        none: void,

        /// "bin" is a string
        /// ```
        /// "bin": "./bin/foo",
        /// ```
        file: String,

        // Single-entry map
        ///```
        /// "bin": {
        ///     "babel": "./cli.js",
        /// }
        ///```
        named_file: [2]String,

        /// "bin" is a directory
        ///```
        /// "dirs": {
        ///     "bin": "./bin",
        /// }
        ///```
        dir: String,
        // "bin" is a map
        ///```
        /// "bin": {
        ///     "babel": "./cli.js",
        ///     "babel-cli": "./cli.js",
        /// }
        ///```
        map: ExternalStringList,
    };

    pub const Tag = enum(u8) {
        /// no bin field
        none = 0,
        /// "bin" is a string
        /// ```
        /// "bin": "./bin/foo",
        /// ```
        file = 1,

        // Single-entry map
        ///```
        /// "bin": {
        ///     "babel": "./cli.js",
        /// }
        ///```
        named_file = 2,
        /// "bin" is a directory
        ///```
        /// "dirs": {
        ///     "bin": "./bin",
        /// }
        ///```
        dir = 3,
        // "bin" is a map
        ///```
        /// "bin": {
        ///     "babel": "./cli.js",
        ///     "babel-cli": "./cli.js",
        /// }
        ///```
        map = 4,
    };
};
