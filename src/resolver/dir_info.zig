const bun = @import("../global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const FeatureFlags = bun.FeatureFlags;

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
package_json_for_browser_field: ?*const PackageJSON = null,
enclosing_tsconfig_json: ?*const TSConfigJSON = null,

/// package.json used for bundling
/// it's the deepest one in the hierarchy with a "name" field
/// or, if using `bun run`, the name field is optional
/// https://github.com/oven-sh/bun/issues/229
enclosing_package_json: ?*PackageJSON = null,

package_json_for_dependencies: ?*const PackageJSON = null,

abs_path: string = "",
entries: Index = undefined,
has_node_modules: bool = false, // Is there a "node_modules" subdirectory?
is_node_modules: bool = false, // Is this a "node_modules" directory?
package_json: ?*PackageJSON = null, // Is there a "package.json" file?
tsconfig_json: ?*TSConfigJSON = null, // Is there a "tsconfig.json" file in this directory or a parent directory?
abs_real_path: string = "", // If non-empty, this is the real absolute path resolving any symlinks

pub fn hasParentPackage(this: *const DirInfo) bool {
    const parent = this.getParent() orelse return false;
    return !parent.is_node_modules;
}

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
        .entries => {
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
        .entries => {
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
pub const HashMap = allocators.BSSMap(DirInfo, Fs.Preallocate.Counts.dir_entry, false, 128, true);
