hash_map: HashMap = .{},

const Value = union(enum) {
    expired: Npm.PackageManifest,
    manifest: Npm.PackageManifest,

    // Avoid checking the filesystem again.
    not_found: void,
};
const HashMap = std.HashMapUnmanaged(PackageNameHash, Value, IdentityContext(PackageNameHash), 80);

pub fn byName(this: *PackageManifestMap, pm: *PackageManager, scope: *const Npm.Registry.Scope, name: []const u8, cache_behavior: CacheBehavior, needs_extended_manifest: bool) ?*Npm.PackageManifest {
    return this.byNameHash(pm, scope, String.Builder.stringHash(name), cache_behavior, needs_extended_manifest);
}

pub fn insert(this: *PackageManifestMap, name_hash: PackageNameHash, manifest: *const Npm.PackageManifest) !void {
    try this.hash_map.put(bun.default_allocator, name_hash, .{ .manifest = manifest.* });
}

pub fn byNameHash(this: *PackageManifestMap, pm: *PackageManager, scope: *const Npm.Registry.Scope, name_hash: PackageNameHash, cache_behavior: CacheBehavior, needs_extended_manifest: bool) ?*Npm.PackageManifest {
    return byNameHashAllowExpired(this, pm, scope, name_hash, null, cache_behavior, needs_extended_manifest);
}

pub fn byNameAllowExpired(this: *PackageManifestMap, pm: *PackageManager, scope: *const Npm.Registry.Scope, name: string, is_expired: ?*bool, cache_behavior: CacheBehavior, needs_extended_manifest: bool) ?*Npm.PackageManifest {
    return byNameHashAllowExpired(this, pm, scope, String.Builder.stringHash(name), is_expired, cache_behavior, needs_extended_manifest);
}

pub const CacheBehavior = enum {
    load_from_memory,
    load_from_memory_fallback_to_disk,
};

pub fn byNameHashAllowExpired(
    this: *PackageManifestMap,
    pm: *PackageManager,
    scope: *const Npm.Registry.Scope,
    name_hash: PackageNameHash,
    is_expired: ?*bool,
    cache_behavior: CacheBehavior,
    needs_extended_manifest: bool,
) ?*Npm.PackageManifest {
    if (cache_behavior == .load_from_memory) {
        const entry = this.hash_map.getPtr(name_hash) orelse return null;
        return switch (entry.*) {
            .manifest => &entry.manifest,
            .expired => if (is_expired) |expiry| {
                expiry.* = true;
                return &entry.expired;
            } else null,
            .not_found => null,
        };
    }

    const entry = bun.handleOom(this.hash_map.getOrPut(bun.default_allocator, name_hash));
    if (entry.found_existing) {
        if (entry.value_ptr.* == .manifest) {
            if (needs_extended_manifest and !entry.value_ptr.manifest.pkg.has_extended_manifest) {
                entry.value_ptr.* = .{ .expired = entry.value_ptr.manifest };
            } else {
                return &entry.value_ptr.manifest;
            }
        }

        if (is_expired) |expiry| {
            if (entry.value_ptr.* == .expired) {
                expiry.* = true;
                return &entry.value_ptr.expired;
            }
        }

        return null;
    }

    if (pm.options.enable.manifest_cache) {
        if (Npm.PackageManifest.Serializer.loadByFileID(
            pm.allocator,
            scope,
            pm.getCacheDirectory(),
            name_hash,
        ) catch null) |manifest| {
            if (needs_extended_manifest and !manifest.pkg.has_extended_manifest) {
                entry.value_ptr.* = .{ .expired = manifest };
                if (is_expired) |expiry| {
                    expiry.* = true;
                    return &entry.value_ptr.expired;
                }
                return null;
            }

            if (pm.options.enable.manifest_cache_control and manifest.pkg.public_max_age > pm.timestamp_for_manifest_cache_control) {
                entry.value_ptr.* = .{ .manifest = manifest };
                return &entry.value_ptr.manifest;
            } else {
                entry.value_ptr.* = .{ .expired = manifest };

                if (is_expired) |expiry| {
                    expiry.* = true;
                    return &entry.value_ptr.expired;
                }

                return null;
            }
        }
    }

    entry.value_ptr.* = .{ .not_found = {} };
    return null;
}

const string = []const u8;

const std = @import("std");

const install = @import("./install.zig");
const Npm = install.Npm;
const PackageManager = install.PackageManager;
const PackageManifestMap = install.PackageManifestMap;
const PackageNameHash = install.PackageNameHash;

const bun = @import("bun");
const IdentityContext = bun.IdentityContext;

const Semver = bun.Semver;
const String = Semver.String;
