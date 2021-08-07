usingnamespace @import("../global.zig");

const allocators = @import("../allocators.zig");
const DirInfo = @This();
const Fs = @import("../fs.zig");
const TSConfigJSON = @import("./tsconfig_json.zig").TSConfigJSON;
const PackageJSON = @import("./package_json.zig").PackageJSON;

pub const Index = allocators.IndexType;

// These objects are immutable, so we can just point to the parent directory
// and avoid having to lock the cache again
parent: Index = allocators.NotFound,

// A pointer to the enclosing dirInfo with a valid "browser" field in
// package.json. We need this to remap paths after they have been resolved.
enclosing_browser_scope: Index = allocators.NotFound,

abs_path: string = "",
entries: Index = undefined,
has_node_modules: bool = false, // Is there a "node_modules" subdirectory?
package_json: ?*PackageJSON = null, // Is there a "package.json" file?
tsconfig_json: ?*TSConfigJSON = null, // Is there a "tsconfig.json" file in this directory or a parent directory?
abs_real_path: string = "", // If non-empty, this is the real absolute path resolving any symlinks

pub fn getFileDescriptor(dirinfo: *const DirInfo) StoredFileDescriptorType {
    if (!FeatureFlags.store_file_descriptors) {
        return 0;
    }

    if (dirinfo.getEntries()) |entries| {
        return entries.fd;
    } else {
        return 0;
    }
}

pub fn getEntries(dirinfo: *const DirInfo) ?*Fs.FileSystem.DirEntry {
    var entries_ptr = Fs.FileSystem.instance.fs.entries.atIndex(dirinfo.entries) orelse return null;
    switch (entries_ptr.*) {
        .entries => |entr| {
            return &entries_ptr.entries;
        },
        .err => {
            return null;
        },
    }
}

pub fn getEntriesConst(dirinfo: *const DirInfo) ?*const Fs.FileSystem.DirEntry {
    const entries_ptr = Fs.FileSystem.instance.fs.entries.atIndex(dirinfo.entries) orelse return null;
    switch (entries_ptr.*) {
        .entries => |entr| {
            return &entries_ptr.entries;
        },
        .err => {
            return null;
        },
    }
}

pub fn getParent(i: *const DirInfo) ?*DirInfo {
    return HashMap.instance.atIndex(i.parent);
}
pub fn getEnclosingBrowserScope(i: *const DirInfo) ?*DirInfo {
    return HashMap.instance.atIndex(i.enclosing_browser_scope);
}

// Goal: Really fast, low allocation directory map exploiting cache locality where we don't worry about lifetimes much.
// 1. Don't store the keys or values of directories that don't exist
// 2. Don't expect a provided key to exist after it's queried
// 3. Store whether a directory has been queried and whether that query was successful.
// 4. Allocate onto the https://en.wikipedia.org/wiki/.bss#BSS_in_C instead of the heap, so we can avoid memory leaks
pub const HashMap = allocators.BSSMap(DirInfo, Fs.Preallocate.Counts.dir_entry, false, 128);
