use bun_install::integrity::Integrity;
use bun_install::npm::{Architecture, Libc, OperatingSystem};
use bun_install::{INVALID_PACKAGE_ID, Origin, PackageID};
use bun_semver::String;

use crate::lockfile_real::StringBuilder as LockfileStringBuilder;

// TODO: when we bump the lockfile version, we should reorder this to:
// id(32), arch(16), os(16), id(8), package_json_version(8), has_install_script(8), integrity(72 align 8)
// should allow us to remove padding bytes

// TODO: remove origin. it doesnt do anything and can be inferred from the resolution
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Meta {
    pub(crate) origin: Origin,
    pub(crate) _padding_origin: u8,

    pub(crate) arch: Architecture,
    pub(crate) os: OperatingSystem,
    /// Stored in what used to be padding, so an older `bun.lockb` reads back as `Libc::NONE` (not
    /// declared).
    pub(crate) libc: Libc,
    /// In former padding: a row that an older bun wrote reads back as `VersionRecord::UNKNOWN`.
    pub(crate) version_record: VersionRecord,

    pub(crate) id: PackageID,

    /// The package.json `version` of a tarball, git or GitHub package. Read it with `recorded_version`.
    pub(crate) package_json_version: String,
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

// Former padding and a slot that no older bun assigned: both are zero in every older `bun.lockb`.
const _: () = assert!(core::mem::offset_of!(Meta, version_record) == 7);
const _: () = assert!(core::mem::offset_of!(Meta, package_json_version) == 12);

/// Not an enum: `bun.lockb` is loaded without a check of this byte.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct VersionRecord(pub u8);

impl VersionRecord {
    pub const UNKNOWN: Self = Self(0);
    pub const RECORDED: Self = Self(1);
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
            libc: Libc::NONE,
            version_record: VersionRecord::UNKNOWN,
            id: INVALID_PACKAGE_ID,
            package_json_version: String::default(),
            integrity: Integrity::default(),
            has_install_script: HasInstallScript::False,
            _padding_integrity: [0; 2],
        }
    }
}

impl Meta {
    /// Does the `cpu` arch, `os` and `libc` match the requirements listed in the package?
    /// This is completely unrelated to "devDependencies", "peerDependencies", "optionalDependencies" etc
    pub fn is_disabled(&self, cpu: Architecture, os: OperatingSystem, libc: Libc) -> bool {
        !self.arch.is_match(cpu) || !self.os.is_match(os) || !self.libc.is_match(libc)
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
        builder.count(self.package_json_version.slice(buf));
    }

    pub(crate) fn has_recorded_version(&self) -> bool {
        self.version_record == VersionRecord::RECORDED
    }

    /// `None`: no version was recorded. Empty: the package.json has none.
    pub(crate) fn recorded_version<'a>(&'a self, buf: &'a [u8]) -> Option<&'a [u8]> {
        self.has_recorded_version()
            .then(|| self.package_json_version.slice(buf))
    }

    pub(crate) fn record_version(&mut self, version: String) {
        self.package_json_version = version;
        self.version_record = VersionRecord::RECORDED;
    }

    /// A version is of bytes that the row pins: a commit, or a tarball with an integrity.
    pub(crate) fn pins(&self, tag: bun_install::resolution::Tag) -> bool {
        tag.is_git() || (tag.is_tarball() && self.integrity.tag.is_supported())
    }

    pub(crate) fn forget_version(&mut self) {
        self.package_json_version = String::default();
        self.version_record = VersionRecord::UNKNOWN;
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
            package_json_version: builder.append::<String>(self.package_json_version.slice(buf)),
            version_record: self.version_record,
            integrity: self.integrity,
            arch: self.arch,
            os: self.os,
            libc: self.libc,
            origin: self.origin,
            has_install_script: self.has_install_script,
            ..Meta::default()
        }
    }
}
