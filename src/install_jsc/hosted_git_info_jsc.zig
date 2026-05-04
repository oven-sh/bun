//! JSC bridges for `src/install/hosted_git_info.zig`. Aliased back so call
//! sites and `$newZigFunction("hosted_git_info.zig", …)` are unchanged.

pub fn hostedGitInfoToJS(self: *const hgi.HostedGitInfo, go: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    const obj = jsc.JSValue.createEmptyObject(go, 6);
    obj.put(
        go,
        jsc.ZigString.static("type"),
        try bun.String.fromBytes(self.host_provider.typeStr()).toJS(go),
    );
    obj.put(
        go,
        jsc.ZigString.static("domain"),
        try bun.String.fromBytes(self.host_provider.domain()).toJS(go),
    );
    obj.put(
        go,
        jsc.ZigString.static("project"),
        try bun.String.fromBytes(self.project).toJS(go),
    );
    obj.put(
        go,
        jsc.ZigString.static("user"),
        if (self.user) |user| try bun.String.fromBytes(user).toJS(go) else .null,
    );
    obj.put(
        go,
        jsc.ZigString.static("committish"),
        if (self.committish) |committish|
            try bun.String.fromBytes(committish).toJS(go)
        else
            .null,
    );
    obj.put(
        go,
        jsc.ZigString.static("default"),
        try bun.String.fromBytes(@tagName(self.default_representation)).toJS(go),
    );

    return obj;
}

pub fn jsParseUrl(go: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const allocator = bun.default_allocator;

    if (callframe.argumentsCount() != 1) {
        return go.throw("hostedGitInfo.prototype.parseUrl takes exactly 1 argument", .{});
    }

    const arg0 = callframe.argument(0);
    if (!arg0.isString()) {
        return go.throw(
            "hostedGitInfo.prototype.parseUrl takes a string as its " ++
                "first argument",
            .{},
        );
    }

    // TODO(markovejnovic): This feels like there's too much going on all
    // to give us a slice. Maybe there's a better way to code this up.
    const npa_str = try arg0.toBunString(go);
    defer npa_str.deref();
    var as_utf8 = npa_str.toUTF8(allocator);
    defer as_utf8.deinit();
    const parsed = hgi.parseUrl(allocator, as_utf8.mut()) catch |err| {
        return go.throw("Invalid Git URL: {}", .{err});
    };
    defer parsed.url.deinit();

    return parsed.url.href().toJS(go);
}

pub fn jsFromUrl(go: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const allocator = bun.default_allocator;

    // TODO(markovejnovic): The original hosted-git-info actually takes another argument that
    //                      allows you to inject options. Seems untested so we didn't implement
    //                      it.
    if (callframe.argumentsCount() != 1) {
        return go.throw("hostedGitInfo.prototype.fromUrl takes exactly 1 argument", .{});
    }

    const arg0 = callframe.argument(0);
    if (!arg0.isString()) {
        return go.throw(
            "hostedGitInfo.prototype.fromUrl takes a string as its first argument",
            .{},
        );
    }

    // TODO(markovejnovic): This feels like there's too much going on all to give us a slice.
    // Maybe there's a better way to code this up.
    const npa_str = try arg0.toBunString(go);
    defer npa_str.deref();
    var as_utf8 = npa_str.toUTF8(allocator);
    defer as_utf8.deinit();
    const parsed = hgi.HostedGitInfo.fromUrl(allocator, as_utf8.mut()) catch |err| {
        return go.throw("Invalid Git URL: {}", .{err});
    } orelse {
        return .null;
    };

    return parsed.toJS(go);
}

const hgi = @import("../install/hosted_git_info.zig");

const bun = @import("bun");
const jsc = bun.jsc;
