use bun_install::integrity::Integrity;
use bun_install::npm::{Architecture, OperatingSystem};
use bun_install::{INVALID_PACKAGE_ID, Origin, PackageID};
use bun_semver::String;

use crate::lockfile_real::StringBuilder as LockfileStringBuilder;

// TODO: when we bump the lockfile version, we should reorder this to:
// id(32), arch(16), os(16), id(8), man_dir(8), has_install_script(8), integrity(72 align 8)
// should allow us to remove padding bytes

// TODO: remove origin. it doesnt do anything and can be inferred from the resolution
#[repr(C)]
#[derive(Clone, Copy)]
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
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum HasInstallScript {
    Old = 0,
    #[default]
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

    // PORT NOTE: Zig used `comptime StringBuilderType: type` duck-typing for the
    // builder param. The only concrete instantiation in install is
    // `*Lockfile.StringBuilder`, so we take it directly here instead of a
    // placeholder trait that nothing implements.
    pub fn count(&self, buf: &[u8], builder: &mut LockfileStringBuilder<'_>) {
        builder.count(self.man_dir.slice(buf));
    }

    pub fn init() -> Meta {
        Meta::default()
    }

    /// Named `clone_into` (not `clone`) to avoid shadowing `Clone::clone` now
    /// that `Meta: Clone + Copy`. Mirrors Zig `Meta.clone(id, buf, Builder, builder)`.
    pub fn clone_into(
        &self,
        id: PackageID,
        buf: &[u8],
        builder: &mut LockfileStringBuilder<'_>,
    ) -> Meta {
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

// ported from: src/install/lockfile/Package/Meta.zig
