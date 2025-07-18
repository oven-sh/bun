pub const Meta = extern struct {
    // TODO: when we bump the lockfile version, we should reorder this to:
    // id(32), arch(16), os(16), id(8), man_dir(8), has_install_script(8), integrity(72 align 8)
    // should allow us to remove padding bytes

    // TODO: remove origin. it doesnt do anything and can be inferred from the resolution
    origin: Origin = Origin.npm,
    _padding_origin: u8 = 0,

    arch: Npm.Architecture = .all,
    os: Npm.OperatingSystem = .all,
    libc: Npm.Libc = .all,
    _padding_after_platform: u8 = 0,

    id: PackageID = invalid_package_id,

    man_dir: String = .{},
    integrity: Integrity = .{},

    /// Shouldn't be used directly. Use `Meta.hasInstallScript()` and
    /// `Meta.setHasInstallScript()` instead.
    ///
    /// `.old` represents the value of this field before it was used
    /// in the lockfile and should never be saved to a new lockfile.
    /// There is a debug assert for this in `Lockfile.Package.Serializer.save()`.
    has_install_script: enum(u8) {
        old = 0,
        false,
        true,
    } = .false,

    _padding_integrity: u8 = 0,
    _padding_end: u8 = 0,

    /// Does the `cpu` arch and `os` match the requirements listed in the package?
    /// This is completely unrelated to "devDependencies", "peerDependencies", "optionalDependencies" etc
    pub fn isDisabled(this: *const Meta) bool {
        return !this.arch.isMatch() or !this.os.isMatch() or !this.libc.isMatch();
    }

    pub fn isDisabledWithTarget(this: *const Meta, target_os: ?Npm.OperatingSystem, target_cpu: ?Npm.Architecture, target_libc: ?Npm.Libc) bool {
        if (target_os != null or target_cpu != null or target_libc != null) {
            const os_match = if (target_os) |os| this.os.isMatchWithTarget(os) else true;
            const cpu_match = if (target_cpu) |cpu| this.arch.isMatchWithTarget(cpu) else true;
            const libc_match = if (target_libc) |libc| this.libc.isMatchWithTarget(libc) else true;
            return !os_match or !cpu_match or !libc_match;
        } else {
            return this.isDisabled();
        }
    }

    pub fn hasInstallScript(this: *const Meta) bool {
        return this.has_install_script == .true;
    }

    pub fn setHasInstallScript(this: *Meta, has_script: bool) void {
        this.has_install_script = if (has_script) .true else .false;
    }

    pub fn needsUpdate(this: *const Meta) bool {
        return this.has_install_script == .old;
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
            .origin = this.origin,
            .has_install_script = this.has_install_script,
        };
    }
};

const bun = @import("bun");
const install = bun.install;
const Npm = install.Npm;
const String = bun.Semver.String;
const Integrity = @import("../../integrity.zig").Integrity;
const Origin = install.Origin;
const PackageID = install.PackageID;
const invalid_package_id = install.invalid_package_id;
