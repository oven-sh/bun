//! This module provides the functionality offered by
//! https://github.com/npm/validate-npm-package-name.
//!
//! It deviates from the original implementation in its string error messages. The difference is
//! that the original implementation is able to preserve the original name of the package in its
//! error messages while ours is not. This is a conscious decision to avoid allocations and it is
//! documented in the JS tests.
extern fn ModuleLoader__isBuiltin(data: [*]const u8, len: usize) bool;

/// The maximum length of a package name, according the upstream npm implementation.
pub const max_package_name_length = 214;

pub const Error = enum {
    EmptyName,
    NameStartsWithDot,
    NameStartsWithUnderscore,
    NameSurroundedWithSpaces,
    IllegalName,
    NameContainsNonUrlSafeCharacters,

    pub fn message(self: Error) []const u8 {
        // TODO(markovejnovic): These errors are not as rich as npm's. Namely,
        // npm-validate-package-name will preserve the original name and show it in the error --
        // "<name> is not allowed", etc.
        return switch (self) {
            .EmptyName => "name length must be greater than zero",
            .NameStartsWithDot => "name cannot start with a period",
            .NameStartsWithUnderscore => "name cannot start with an underscore",
            .NameSurroundedWithSpaces => "name cannot contain leading or trailing spaces",
            .IllegalName => "name is not allowed",
            .NameContainsNonUrlSafeCharacters => "name can only contain URL-friendly characters",
        };
    }
};

pub const Warning = enum {
    CoreModuleNameConflict,
    NameTooLong,
    NameContainsUppercaseLetters,
    NameContainsSpecialCharacters,

    pub fn message(self: Warning) []const u8 {
        return switch (self) {
            .CoreModuleNameConflict => "name conflicts a core module name",
            .NameTooLong => std.fmt.comptimePrint(
                "name can no longer contain more than {} characters",
                .{max_package_name_length},
            ),
            .NameContainsUppercaseLetters => "name can no longer contain capital letters",
            .NameContainsSpecialCharacters => "name can no longer contain special characters (\"~'!()*\")",
        };
    }
};

pub const ValidationResult = struct {
    errors: bun.bit_set.IntegerBitSet(std.meta.fields(Error).len),
    warnings: bun.bit_set.IntegerBitSet(std.meta.fields(Warning).len),

    pub fn validForNewPackages(self: *const ValidationResult) bool {
        return self.errors.mask == 0 and self.warnings.mask == 0;
    }

    pub fn validForOldPackages(self: *const ValidationResult) bool {
        return self.errors.mask == 0;
    }
};

const exclusion_list = [_][]const u8{
    "node_modules",
    "favicon.ico",
};

pub fn validate(name: []const u8) ValidationResult {
    var result: ValidationResult = .{
        .errors = bun.bit_set.IntegerBitSet(std.meta.fields(Error).len).initEmpty(),
        .warnings = bun.bit_set.IntegerBitSet(std.meta.fields(Warning).len).initEmpty(),
    };

    if (name.len == 0) {
        result.errors.set(@intFromEnum(Error.EmptyName));
    }

    if (name.len > 0 and name[0] == '.') {
        result.errors.set(@intFromEnum(Error.NameStartsWithDot));
    }

    if (name.len > 0 and name[0] == '_') {
        result.errors.set(@intFromEnum(Error.NameStartsWithUnderscore));
    }

    const trimmed = bun.strings.trimSpaces(name);
    if (!bun.strings.eql(trimmed, name)) {
        result.errors.set(@intFromEnum(Error.NameSurroundedWithSpaces));
        result.errors.set(@intFromEnum(Error.NameContainsNonUrlSafeCharacters));
    }

    for (exclusion_list) |excluded| {
        if (bun.strings.eqlCaseInsensitiveASCII(name, excluded, true)) {
            result.errors.set(@intFromEnum(Error.IllegalName));
            break;
        }
    }

    if (ModuleLoader__isBuiltin(name.ptr, name.len)) {
        result.warnings.set(@intFromEnum(Warning.CoreModuleNameConflict));
    }

    if (name.len > max_package_name_length) {
        result.warnings.set(@intFromEnum(Warning.NameTooLong));
    }

    if (!bun.strings.isAllLowercaseASCII(name)) {
        result.warnings.set(@intFromEnum(Warning.NameContainsUppercaseLetters));
    }

    const last_segment = if (bun.strings.lastIndexOfChar(name, '/')) |idx|
        name[idx + 1 ..]
    else
        name;

    if (bun.strings.indexOfAny(last_segment, "~'!()*") != null) {
        result.warnings.set(@intFromEnum(Warning.NameContainsSpecialCharacters));
    }

    if (ScopedPackage.init(name)) |scoped| {
        if (scoped.pkg.len > 0 and scoped.pkg[0] == '.') {
            result.errors.set(@intFromEnum(Error.NameStartsWithDot));
        }

        if (bun.strings.indexOfNeedsURLEncode(scoped.user) != null or
            bun.strings.indexOfNeedsURLEncode(scoped.pkg) != null or
            bun.strings.indexOfChar(scoped.user, ' ') != null or
            bun.strings.indexOfChar(scoped.pkg, ' ') != null or
            bun.strings.indexOfChar(scoped.user, ':') != null or
            bun.strings.indexOfChar(scoped.pkg, ':') != null)
        {
            result.errors.set(@intFromEnum(Error.NameContainsNonUrlSafeCharacters));
        }
    } else {
        if (bun.strings.indexOfChar(name, '/') != null) {
            result.errors.set(@intFromEnum(Error.NameContainsNonUrlSafeCharacters));
        }

        if (bun.strings.indexOfNeedsURLEncode(name) != null or
            bun.strings.indexOfChar(name, ' ') != null or
            bun.strings.indexOfChar(name, ':') != null)
        {
            result.errors.set(@intFromEnum(Error.NameContainsNonUrlSafeCharacters));
        }
    }

    return result;
}

const ScopedPackage = struct {
    user: []const u8,
    pkg: []const u8,

    fn init(name: []const u8) ?ScopedPackage {
        if (name.len < 4 or name[0] != '@') return null;

        const slash_idx = bun.strings.indexOfChar(name, '/') orelse return null;
        if (slash_idx == 1 or slash_idx >= name.len - 1) return null;

        // Ensure there's only one slash
        if (bun.strings.indexOfCharPos(name, '/', slash_idx + 1) != null) return null;

        return .{
            .user = name[1..slash_idx],
            .pkg = name[slash_idx + 1 ..],
        };
    }
};

pub const TestingAPIs = struct {
    pub fn jsValidate(go: *jsc.JSGlobalObject, cf: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        if (cf.argumentsCount() < 1) {
            return go.throw("validate() requires 1 argument", .{});
        }

        const name_arg = cf.argument(0);
        const name_str = try name_arg.toBunString(go);
        defer name_str.deref();

        const name_utf8 = name_str.toUTF8(bun.default_allocator);
        defer name_utf8.deinit();

        const result = validate(name_utf8.slice());

        return try validationResultToJS(go, result);
    }

    fn validationResultToJS(
        go: *jsc.JSGlobalObject,
        result: ValidationResult,
    ) bun.JSError!jsc.JSValue {
        const obj = jsc.JSValue.createEmptyObject(go, 4);

        obj.put(
            go,
            bun.String.static("validForNewPackages"),
            jsc.JSValue.jsBoolean(result.validForNewPackages()),
        );

        obj.put(
            go,
            bun.String.static("validForOldPackages"),
            jsc.JSValue.jsBoolean(result.validForOldPackages()),
        );

        if (result.errors.mask != 0) {
            const errors_array = try jsc.JSValue.createEmptyArray(go, 0);
            var it = result.errors.iterator(.{});
            while (it.next()) |idx| {
                const err: Error = @enumFromInt(idx);
                try errors_array.push(go, bun.String.fromBytes(err.message()).toJS(go));
            }
            obj.put(go, bun.String.static("errors"), errors_array);
        }

        if (result.warnings.mask != 0) {
            const warnings_array = try jsc.JSValue.createEmptyArray(go, 0);
            var it = result.warnings.iterator(.{});
            while (it.next()) |idx| {
                const warn: Warning = @enumFromInt(idx);
                try warnings_array.push(go, bun.String.fromBytes(warn.message()).toJS(go));
            }
            obj.put(go, bun.String.static("warnings"), warnings_array);
        }

        return obj;
    }
};

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
