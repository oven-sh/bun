usingnamespace @import("../global.zig");

const Lockfile = @import("./install.zig").Lockfile;
const PackageManager = @import("./install.zig").PackageManager;
const std = @import("std");
const PackageID = @import("./install.zig").PackageID;
const invalid_package_id = @import("./install.zig").invalid_package_id;
const ExternalSlice = @import("./install.zig").ExternalSlice;
const Resolution = @import("./resolution.zig").Resolution;
const PackageNameHash = @import("./install.zig").PackageNameHash;

const Tree = struct {
    id: Id = invalid_id,
    package_id: PackageID,

    parent: Id = invalid_id,
    packages: Lockfile.PackageIDSlice,

    pub const Slice = ExternalSlice(Tree);
    pub const List = std.ArrayListUnmanaged(Tree);
    pub const Id = u16;
    const invalid_id: Id = std.math.maxInt(Id);
    const dependency_loop = invalid_id - 1;

    // todo: use error type when it no longer takes up extra stack space
    pub fn addDependency(
        this: *Tree,
        name_hash: PackageNameHash,
        package_id: PackageID,
        lockfile: *Lockfile,
        list: *Lockfile.PackageIDList,
        trees: []Tree,
        allocator: *std.mem.Allocator,
    ) Id {
        if (this.package_id == package_id) return this.id;
        
        const this_packages = this.packages.get(name_hashes);

        for (this_packages) |pid, slot| {
            if (name_hashes[pid] == name_hash) {
                if (pid != package_id) {
                    return dependency_loop;
                }

                return this.id;
            }
        }

        var parent = this.parent;
        while (parent < dependency_loop) {
            const id = trees[parent].addDependency(name_hash, package_id, lockfile, list, trees);
            if (id >= dependency_loop) {
                break;
            }
            parent = id;
        }

        if (parent != this.parent) return parent;

        list.append(allocator, package_id) catch unreachable;
        this.packages.len += 1;
        return this.id;
    }
};

pub const Hoister = struct {
    allocator: *std.mem.Allocator,
    lockfile: *Lockfile,
};
