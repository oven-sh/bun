pub const Meta = extern struct {
    // TODO: when we bump the lockfile version, we should reorder this to:
    // id(32), arch(16), os(16), id(8), man_dir(8), has_install_script(8), integrity(72 align 8)
    // should allow us to remove padding bytes

    // TODO: remove origin. it doesnt do anything and can be inferred from the resolution
    origin: Origin = Origin.npm,
    _padding_origin: u8 = 0,

    arch: Npm.Architecture = .all,
    os: Npm.OperatingSystem = .all,
    _padding_os: u16 = 0,

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

    _padding_integrity: [2]u8 = .{0} ** 2,

    /// Does the `cpu` arch and `os` match the requirements listed in the package?
    /// This is completely unrelated to "devDependencies", "peerDependencies", "optionalDependencies" etc
    pub fn isDisabled(this: *const Meta, cpu: Npm.Architecture, os: Npm.OperatingSystem) bool {
        return !this.arch.isMatch(cpu) or !this.os.isMatch(os);
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
            .origin = this.origin,
            .has_install_script = this.has_install_script,
        };
    }
};

const Integrity = @import("../../integrity.zig").Integrity;

const bun = @import("bun");
const String = bun.Semver.String;

const install = bun.install;
const Npm = install.Npm;
const Origin = install.Origin;
const PackageID = install.PackageID;
const invalid_package_id = install.invalid_package_id;
