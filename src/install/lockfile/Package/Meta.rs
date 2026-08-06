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
    pub(crate) origin: Origin,
    pub(crate) _padding_origin: u8,

    pub(crate) arch: Architecture,
    pub(crate) os: OperatingSystem,
    pub(crate) _padding_os: u16,

    pub(crate) id: PackageID,

    pub(crate) man_dir: String,
    pub(crate) integrity: Integrity,

    /// Shouldn't be used directly. Use `Meta.has_install_script()` and
    /// `Meta.set_has_install_script()` instead.
    ///
    /// `.Old` represents the value of this field before it was used
    /// in the lockfile and should never be saved to a new lockfile.
    /// There is a debug assert for this in `Lockfile.Package.Serializer.save()`.
    pub(crate) has_install_script: HasInstallScript,

    pub(crate) _padding_integrity: [u8; 2],
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
    pub(crate) fn is_disabled(&self, cpu: Architecture, os: OperatingSystem) -> bool {
        !self.arch.is_match(cpu) || !self.os.is_match(os)
    }

    pub(crate) fn has_install_script(&self) -> bool {
        self.has_install_script == HasInstallScript::True
    }

    pub fn set_has_install_script(&mut self, has_script: bool) {
        self.has_install_script = if has_script {
            HasInstallScript::True
        } else {
            HasInstallScript::False
        };
    }

    pub(crate) fn needs_update(&self) -> bool {
        self.has_install_script == HasInstallScript::Old
    }

    // The only concrete builder type used in install is the lockfile
    // `StringBuilder`, so take it directly instead of a placeholder trait that
    // nothing implements.
    pub(crate) fn count(&self, buf: &[u8], builder: &mut LockfileStringBuilder<'_>) {
        builder.count(self.man_dir.slice(buf));
    }

    pub(crate) fn init() -> Meta {
        Meta::default()
    }

    /// Named `clone_into` (not `clone`) to avoid shadowing `Clone::clone` now
    /// that `Meta: Clone + Copy`.
    pub(crate) fn clone_into(
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
