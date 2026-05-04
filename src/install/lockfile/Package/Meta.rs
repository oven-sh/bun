use bun_install::integrity::Integrity;
use bun_install::npm::{Architecture, OperatingSystem};
use bun_install::{Origin, PackageID, INVALID_PACKAGE_ID};
use bun_semver::String;

// TODO: when we bump the lockfile version, we should reorder this to:
// id(32), arch(16), os(16), id(8), man_dir(8), has_install_script(8), integrity(72 align 8)
// should allow us to remove padding bytes

// TODO: remove origin. it doesnt do anything and can be inferred from the resolution
#[repr(C)]
pub struct Meta {
    pub origin: Origin,
    pub _padding_origin: u8,

    pub arch: Architecture,
    pub os: OperatingSystem,
    pub _padding_os: u16,

    pub id: PackageID,

    pub man_dir: String,
    pub integrity: Integrity,

    /// Shouldn't be used directly. Use `Meta.has_install_script()` and
    /// `Meta.set_has_install_script()` instead.
    ///
    /// `.Old` represents the value of this field before it was used
    /// in the lockfile and should never be saved to a new lockfile.
    /// There is a debug assert for this in `Lockfile.Package.Serializer.save()`.
    pub has_install_script: HasInstallScript,

    pub _padding_integrity: [u8; 2],
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum HasInstallScript {
    Old = 0,
    False,
    True,
}

impl Default for Meta {
    fn default() -> Self {
        Self {
            origin: Origin::Npm,
            _padding_origin: 0,
            arch: Architecture::ALL,
            os: OperatingSystem::ALL,
            _padding_os: 0,
            id: INVALID_PACKAGE_ID,
            man_dir: String::default(),
            integrity: Integrity::default(),
            has_install_script: HasInstallScript::False,
            _padding_integrity: [0; 2],
        }
    }
}

impl Meta {
    /// Does the `cpu` arch and `os` match the requirements listed in the package?
    /// This is completely unrelated to "devDependencies", "peerDependencies", "optionalDependencies" etc
    pub fn is_disabled(&self, cpu: Architecture, os: OperatingSystem) -> bool {
        !self.arch.is_match(cpu) || !self.os.is_match(os)
    }

    pub fn has_install_script(&self) -> bool {
        self.has_install_script == HasInstallScript::True
    }

    pub fn set_has_install_script(&mut self, has_script: bool) {
        self.has_install_script = if has_script {
            HasInstallScript::True
        } else {
            HasInstallScript::False
        };
    }

    pub fn needs_update(&self) -> bool {
        self.has_install_script == HasInstallScript::Old
    }

    // TODO(port): StringBuilder trait — Zig used `comptime StringBuilderType: type` duck-typing
    // for `.count(slice)` and `.append(String, slice)`. Phase B should define this trait in
    // bun_install::lockfile and bound B on it.
    pub fn count<B>(&self, buf: &[u8], builder: &mut B)
    where
        B: StringBuilder,
    {
        builder.count(self.man_dir.slice(buf));
    }

    pub fn init() -> Meta {
        Meta::default()
    }

    pub fn clone<B>(&self, id: PackageID, buf: &[u8], builder: &mut B) -> Meta
    where
        B: StringBuilder,
    {
        Meta {
            id,
            man_dir: builder.append::<String>(self.man_dir.slice(buf)),
            integrity: self.integrity,
            arch: self.arch,
            os: self.os,
            origin: self.origin,
            has_install_script: self.has_install_script,
            ..Meta::default()
        }
    }
}

// TODO(port): placeholder trait for the `comptime StringBuilderType` pattern used across
// install/lockfile. Move to a shared module in Phase B.
pub trait StringBuilder {
    fn count(&mut self, slice: &[u8]);
    fn append<T>(&mut self, slice: &[u8]) -> T;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/lockfile/Package/Meta.zig (81 lines)
//   confidence: medium
//   todos:      2
//   notes:      StringBuilder trait is a placeholder for Zig's comptime duck-typed builder param; inline anon enum hoisted to HasInstallScript
// ──────────────────────────────────────────────────────────────────────────
