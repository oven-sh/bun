// old (v2)
pub const MetaV2 = extern struct {
    origin: enum(u8) {
        local = 0,
        npm = 1,
        tarball = 2,
    } = .npm,
    _padding_origin: u8 = 0,

    arch: Npm.Architecture = .all,
    os: Npm.OperatingSystem = .all,
    _padding_os: u16 = 0,

    id: PackageID = invalid_package_id,

    man_dir: String = .{},
    integrity: Integrity = .{},
    has_install_script: enum(u8) {
        old = 0,
        false,
        true,
    } = .false,

    _padding_integrity: [2]u8 = .{0} ** 2,

    pub fn init() MetaV2 {
        return .{};
    }
};

// v3
pub const Meta = extern struct {
    id: PackageID = invalid_package_id,

    arch: Npm.Architecture = .all,
    os: Npm.OperatingSystem = .all,
    libc: Npm.Libc = .all,

    man_dir: String = .{},
    has_install_script: bool = false,
    integrity: Integrity = .{},

    _padding: [1]u8 = .{0} ** 1,

    /// Does the `cpu` arch, `os`, and `libc` match the requirements listed in the package?
    /// This is completely unrelated to "devDependencies", "peerDependencies", "optionalDependencies" etc
    pub fn isDisabled(this: *const Meta, cpu: Npm.Architecture, os: Npm.OperatingSystem, libc: Npm.Libc) bool {
        return !this.arch.isMatch(cpu) or !this.os.isMatch(os) or !this.libc.isMatch(libc);
    }

    pub fn count(this: *const Meta, buf: []const u8, comptime StringBuilderType: type, builder: StringBuilderType) void {
        builder.count(this.man_dir.slice(buf));
    }

    pub fn init() Meta {
        return .{};
    }

    pub fn clone(this: *const Meta, id: PackageID, buf: []const u8, comptime StringBuilderType: type, builder: StringBuilderType) Meta {
        return Meta{
            .id = id,
            .man_dir = builder.append(String, this.man_dir.slice(buf)),
            .integrity = this.integrity,
            .arch = this.arch,
            .os = this.os,
            .libc = this.libc,
            .has_install_script = this.has_install_script,
        };
    }
};

const Integrity = @import("../../integrity.zig").Integrity;

const bun = @import("bun");
const String = bun.Semver.String;

const install = bun.install;
const Npm = install.Npm;
const PackageID = install.PackageID;
const invalid_package_id = install.invalid_package_id;
