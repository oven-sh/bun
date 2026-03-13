name: string = "",
name_hash: PackageNameHash = 0,
version: Dependency.Version = .{},
version_buf: []const u8 = "",
package_id: PackageID = invalid_package_id,
is_aliased: bool = false,
failed: bool = false,
// This must be cloned to handle when the AST store resets
e_string: ?*JSAst.E.String = null,

pub const Array = std.ArrayListUnmanaged(UpdateRequest);

pub inline fn matches(this: PackageManager.UpdateRequest, dependency: Dependency, string_buf: []const u8) bool {
    return this.name_hash == if (this.name.len == 0)
        String.Builder.stringHash(dependency.version.literal.slice(string_buf))
    else
        dependency.name_hash;
}

pub fn getName(this: *const UpdateRequest) string {
    return if (this.is_aliased)
        this.name
    else
        this.version.literal.slice(this.version_buf);
}

/// If `this.package_id` is not `invalid_package_id`, it must be less than `lockfile.packages.len`.
pub fn getNameInLockfile(this: *const UpdateRequest, lockfile: *const Lockfile) ?string {
    return if (this.package_id == invalid_package_id)
        null
    else
        lockfile.packages.items(.name)[this.package_id].slice(this.version_buf);
}

/// It is incorrect to call this function before Lockfile.cleanWithLogger() because
/// resolved_name should be populated if possible.
///
/// `this` needs to be a pointer! If `this` is a copy and the name returned from
/// resolved_name is inlined, you will return a pointer to stack memory.
pub fn getResolvedName(this: *const UpdateRequest, lockfile: *const Lockfile) string {
    return if (this.is_aliased)
        this.name
    else if (this.getNameInLockfile(lockfile)) |name|
        name
    else
        this.version.literal.slice(this.version_buf);
}

pub fn fromJS(globalThis: *jsc.JSGlobalObject, input: jsc.JSValue) bun.JSError!jsc.JSValue {
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    var stack = std.heap.stackFallback(1024, arena.allocator());
    const allocator = stack.get();
    var all_positionals = std.array_list.Managed([]const u8).init(allocator);

    var log = logger.Log.init(allocator);

    if (input.isString()) {
        var input_str = try input.toSliceCloneWithAllocator(
            globalThis,
            allocator,
        );
        if (input_str.len > 0)
            try all_positionals.append(input_str.slice());
    } else if (input.isArray()) {
        var iter = try input.arrayIterator(globalThis);
        while (try iter.next()) |item| {
            const slice = try item.toSliceCloneWithAllocator(globalThis, allocator);
            if (slice.len == 0) continue;
            try all_positionals.append(slice.slice());
        }
    } else {
        return .js_undefined;
    }

    if (all_positionals.items.len == 0) {
        return .js_undefined;
    }

    var array = Array{};

    const update_requests = parseWithError(allocator, null, &log, all_positionals.items, &array, .add, false) catch {
        return globalThis.throwValue(try log.toJS(globalThis, bun.default_allocator, "Failed to parse dependencies"));
    };
    if (update_requests.len == 0) return .js_undefined;

    if (log.msgs.items.len > 0) {
        return globalThis.throwValue(try log.toJS(globalThis, bun.default_allocator, "Failed to parse dependencies"));
    }

    if (update_requests[0].failed) {
        return globalThis.throw("Failed to parse dependencies", .{});
    }

    var object = jsc.JSValue.createEmptyObject(globalThis, 2);
    var name_str = bun.String.init(update_requests[0].name);
    object.put(globalThis, "name", try name_str.transferToJS(globalThis));
    object.put(globalThis, "version", try update_requests[0].version.toJS(update_requests[0].version_buf, globalThis));
    return object;
}

pub fn parse(
    allocator: std.mem.Allocator,
    pm: ?*PackageManager,
    log: *logger.Log,
    positionals: []const string,
    update_requests: *Array,
    subcommand: Subcommand,
) []UpdateRequest {
    return parseWithError(allocator, pm, log, positionals, update_requests, subcommand, true) catch Global.crash();
}

fn parseWithError(
    allocator: std.mem.Allocator,
    pm: ?*PackageManager,
    log: *logger.Log,
    positionals: []const string,
    update_requests: *Array,
    subcommand: Subcommand,
    fatal: bool,
) ![]UpdateRequest {
    // first one is always either:
    // add
    // remove
    outer: for (positionals) |positional| {
        var input: []u8 = bun.handleOom(bun.default_allocator.dupe(u8, std.mem.trim(u8, positional, " \n\r\t")));
        {
            var temp: [2048]u8 = undefined;
            const len = std.mem.replace(u8, input, "\\\\", "/", &temp);
            bun.path.platformToPosixInPlace(u8, &temp);
            const input2 = temp[0 .. input.len - len];
            @memcpy(input[0..input2.len], input2);
            input.len = input2.len;
        }
        switch (subcommand) {
            .link, .unlink => if (!strings.hasPrefixComptime(input, "link:")) {
                input = std.fmt.allocPrint(allocator, "{0s}@link:{0s}", .{input}) catch unreachable;
            },
            else => {},
        }

        var value = input;
        var alias: ?string = null;
        if (!Dependency.isTarball(input) and strings.isNPMPackageName(input)) {
            alias = input;
            value = input[input.len..];
        } else if (input.len > 1) {
            if (strings.indexOfChar(input[1..], '@')) |at| {
                const name = input[0 .. at + 1];
                if (strings.isNPMPackageName(name)) {
                    alias = name;
                    value = input[at + 2 ..];
                }
            }
        }

        const placeholder = String.from("@@@");
        var version = Dependency.parseWithOptionalTag(
            allocator,
            if (alias) |name| String.init(input, name) else placeholder,
            if (alias) |name| String.Builder.stringHash(name) else null,
            value,
            null,
            &SlicedString.init(input, value),
            log,
            pm,
        ) orelse {
            if (fatal) {
                Output.errGeneric("unrecognised dependency format: {s}", .{
                    positional,
                });
            } else {
                log.addErrorFmt(null, logger.Loc.Empty, allocator, "unrecognised dependency format: {s}", .{
                    positional,
                }) catch |err| bun.handleOom(err);
            }

            return error.UnrecognizedDependencyFormat;
        };
        if (alias != null and version.tag == .git) {
            if (Dependency.parseWithOptionalTag(
                allocator,
                placeholder,
                null,
                input,
                null,
                &SlicedString.init(input, input),
                log,
                pm,
            )) |ver| {
                alias = null;
                version = ver;
            }
        }
        if (switch (version.tag) {
            .dist_tag => version.value.dist_tag.name.eql(placeholder, input, input),
            .npm => version.value.npm.name.eql(placeholder, input, input),
            else => false,
        }) {
            if (fatal) {
                Output.errGeneric("unrecognised dependency format: {s}", .{
                    positional,
                });
            } else {
                log.addErrorFmt(null, logger.Loc.Empty, allocator, "unrecognised dependency format: {s}", .{
                    positional,
                }) catch |err| bun.handleOom(err);
            }

            return error.UnrecognizedDependencyFormat;
        }

        var request = UpdateRequest{
            .version = version,
            .version_buf = input,
        };
        if (alias) |name| {
            request.is_aliased = true;
            request.name = allocator.dupe(u8, name) catch unreachable;
            request.name_hash = String.Builder.stringHash(name);
        } else if (version.tag == .github and version.value.github.committish.isEmpty()) {
            request.name_hash = String.Builder.stringHash(version.literal.slice(input));
        } else {
            request.name_hash = String.Builder.stringHash(version.literal.slice(input));
        }

        for (update_requests.items) |*prev| {
            if (prev.name_hash == request.name_hash and request.name.len == prev.name.len) continue :outer;
        }
        bun.handleOom(update_requests.append(allocator, request));
    }

    return update_requests.items;
}

pub const CommandLineArguments = PackageManager.CommandLineArguments;
pub const Options = PackageManager.Options;
pub const PackageInstaller = PackageManager.PackageInstaller;
pub const PackageJSONEditor = PackageManager.PackageJSONEditor;
pub const Subcommand = PackageManager.Subcommand;

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Global = bun.Global;
const JSAst = bun.ast;
const Output = bun.Output;
const default_allocator = bun.default_allocator;
const jsc = bun.jsc;
const logger = bun.logger;
const strings = bun.strings;

const Semver = bun.Semver;
const SlicedString = Semver.SlicedString;
const String = Semver.String;

const Dependency = bun.install.Dependency;
const Lockfile = bun.install.Lockfile;
const PackageID = bun.install.PackageID;
const PackageNameHash = bun.install.PackageNameHash;
const invalid_package_id = bun.install.invalid_package_id;

const PackageManager = bun.install.PackageManager;
const UpdateRequest = PackageManager.UpdateRequest;
