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
    empty_name,
    name_starts_with_dot,
    name_starts_with_underscore,
    name_surrounded_with_spaces,
    illegal_name,
    name_contains_non_url_safe_characters,

    pub fn message(self: Error) []const u8 {
        // TODO(markovejnovic): These errors are not as rich as npm's. Namely,
        // npm-validate-package-name will preserve the original name and show it in the error --
        // "<name> is not allowed", etc.
        return switch (self) {
            .empty_name => "name length must be greater than zero",
            .name_starts_with_dot => "name cannot start with a period",
            .name_starts_with_underscore => "name cannot start with an underscore",
            .name_surrounded_with_spaces => "name cannot contain leading or trailing spaces",
            .illegal_name => "name is not allowed",
            .name_contains_non_url_safe_characters => "name can only contain URL-friendly characters",
        };
    }
};

pub const Warning = enum {
    core_module_name_conflict,
    name_too_long,
    name_contains_uppercase_letters,
    name_contains_special_characters,

    pub fn message(self: Warning) []const u8 {
        return switch (self) {
            .core_module_name_conflict => "name conflicts a core module name",
            .name_too_long => std.fmt.comptimePrint(
                "name can no longer contain more than {} characters",
                .{max_package_name_length},
            ),
            .name_contains_uppercase_letters => "name can no longer contain capital letters",
            .name_contains_special_characters => "name can no longer contain special characters (\"~'!()*\")",
        };
    }
};

pub const ValidationResult = struct {
    errors: std.EnumSet(Error),
    warnings: std.EnumSet(Warning),

    pub fn validForNewPackages(self: *const ValidationResult) bool {
        return self.errors.count() == 0 and self.warnings.count() == 0;
    }

    pub fn validForOldPackages(self: *const ValidationResult) bool {
        return self.errors.count() == 0;
    }
};

const exclusion_list = [_][]const u8{
    "node_modules",
    "favicon.ico",
};

pub fn validate(name: []const u8) ValidationResult {
    var result: ValidationResult = .{
        .errors = .initEmpty(),
        .warnings = .initEmpty(),
    };

    if (name.len == 0) {
        result.errors.insert(Error.empty_name);
    } else {
        switch (name[0]) {
            '.' => {
                result.errors.insert(Error.name_starts_with_dot);
            },
            '_' => {
                result.errors.insert(Error.name_starts_with_underscore);
            },
            else => {},
        }
    }

    if (!bun.strings.eql(bun.strings.trimSpaces(name), name)) {
        result.errors.insert(Error.name_surrounded_with_spaces);
        result.errors.insert(Error.name_contains_non_url_safe_characters);
    }

    for (exclusion_list) |excluded| {
        if (bun.strings.eqlCaseInsensitiveASCII(name, excluded, true)) {
            result.errors.insert(Error.illegal_name);
            break;
        }
    }

    if (ModuleLoader__isBuiltin(name.ptr, name.len)) {
        result.warnings.insert(Warning.core_module_name_conflict);
    }

    if (name.len > max_package_name_length) {
        result.warnings.insert(Warning.name_too_long);
    }

    if (bun.strings.containsUppercaseAscii(name)) {
        result.warnings.insert(Warning.name_contains_uppercase_letters);
    }

    const last_segment = if (bun.strings.lastIndexOfChar(name, '/')) |idx|
        name[idx + 1 ..]
    else
        name;

    if (bun.strings.indexOfAny(last_segment, "~'!()*") != null) {
        result.warnings.insert(Warning.name_contains_special_characters);
    }

    if (ScopedPackage.init(name)) |scoped| {
        if (scoped.pkg.len > 0 and scoped.pkg[0] == '.') {
            result.errors.insert(Error.name_starts_with_dot);
        }

        if (bun.strings.indexOfNeedsURLEncode(scoped.user) != null or
            bun.strings.indexOfNeedsURLEncode(scoped.pkg) != null or
            bun.strings.indexOfChar(scoped.user, ' ') != null or
            bun.strings.indexOfChar(scoped.pkg, ' ') != null or
            bun.strings.indexOfChar(scoped.user, ':') != null or
            bun.strings.indexOfChar(scoped.pkg, ':') != null)
        {
            result.errors.insert(Error.name_contains_non_url_safe_characters);
        }
    } else {
        if (bun.strings.indexOfChar(name, '/') != null) {
            result.errors.insert(Error.name_contains_non_url_safe_characters);
        }

        if (bun.strings.indexOfNeedsURLEncode(name) != null or
            bun.strings.indexOfChar(name, ' ') != null or
            bun.strings.indexOfChar(name, ':') != null)
        {
            result.errors.insert(Error.name_contains_non_url_safe_characters);
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

        if (result.errors.count() != 0) {
            const errors_array = try jsc.JSValue.createEmptyArray(go, 0);
            var it = result.errors.iterator();
            while (it.next()) |err| {
                try errors_array.push(go, bun.String.fromBytes(err.message()).toJS(go));
            }
            obj.put(go, bun.String.static("errors"), errors_array);
        }

        if (result.warnings.count() != 0) {
            const warnings_array = try jsc.JSValue.createEmptyArray(go, 0);
            var it = result.warnings.iterator();
            while (it.next()) |warn| {
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
