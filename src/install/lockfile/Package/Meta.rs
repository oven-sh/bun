use std::io::Write as _;

use bun_alloc::AllocError;
use bun_install::integrity::Integrity;
use bun_install::npm::{Architecture, Libc, OperatingSystem};
use bun_install::{INVALID_PACKAGE_ID, Origin, PackageID};
use bun_semver::semver_string::Buf as StringBuf;
use bun_semver::{ExternalString, SlicedString, String, Version as SemverVersion};

use crate::Dependency;
use crate::dependency::{self, Behavior, Tag as DependencyTag, TagExt as _};
use crate::lockfile_real::Package;
use crate::lockfile_real::StringBuilder as LockfileStringBuilder;
use crate::package_installer::alias_is_safe_install_target;
use crate::resolution_real::{Resolution, TaggedValue};
use crate::versioned_url::VersionedURL;

// TODO: when we bump the lockfile version, we should reorder this to:
// id(32), arch(16), os(16), id(8), man_dir(8), has_install_script(8), integrity(72 align 8)
// should allow us to remove padding bytes

// TODO: remove origin. it doesnt do anything and can be inferred from the resolution
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Meta {
    pub(crate) origin: Origin,
    /// Shouldn't be used directly. Use `Meta.is_shipped()` and `Meta.mark_shipped()` instead.
    ///
    /// Stored in what used to be padding, so an older `bun.lockb` reads back as 0 (not shipped).
    pub(crate) shipped: u8,

    pub(crate) arch: Architecture,
    pub(crate) os: OperatingSystem,
    /// Stored in what used to be padding, so an older `bun.lockb` reads back as `Libc::NONE` (not
    /// declared).
    pub(crate) libc: Libc,
    pub(crate) _padding_libc: u8,

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

// `bun.lockb` stores `Meta` byte for byte.
const _: () = assert!(core::mem::size_of::<Meta>() == 88);

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
            shipped: 0,
            arch: Architecture::ALL,
            os: OperatingSystem::ALL,
            libc: Libc::NONE,
            _padding_libc: 0,
            id: INVALID_PACKAGE_ID,
            man_dir: String::default(),
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

    /// Whether the package was read from the `node_modules` of a package that bundles it. Such a
    /// package exists only inside that folder and is never the same package as another one, so
    /// the lockfile's name index does not hold it.
    #[inline]
    pub fn is_shipped(&self) -> bool {
        self.shipped != 0
    }

    /// Call before the package is appended to a lockfile: appending is what leaves a shipped
    /// package out of the name index.
    pub fn mark_shipped(&mut self) {
        self.shipped = 1;
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
            libc: self.libc,
            origin: self.origin,
            shipped: self.shipped,
            has_install_script: self.has_install_script,
            ..Meta::default()
        }
    }
}

/// One folder that a package ships in its own `node_modules`, as the lockfile holds it: the
/// package that stands for the folder, and the row that places it when the package.json above it
/// does not declare the folder's name. The resolver builds them from the folder on disk and the
/// loader of bun.lock from the entry's key and its `name@version`. Both build them here, so that
/// a fresh resolve and a reload hold the same package and the same row.
pub struct ShippedIdentity<'a> {
    folder_name: &'a [u8],
    name: &'a [u8],
    /// `npm:<name>@<version>`, with the version as a resolution prints it.
    specifier: Box<[u8]>,
    version_at: usize,
    /// Its tags are slices of `specifier`.
    version: SemverVersion,
}

impl<'a> ShippedIdentity<'a> {
    /// `folder_name` is `name` or `@scope/name`. `package_json_name` and `version` are as the
    /// folder's package.json has them, or as bun.lock printed them. The package is named after
    /// the folder if bun.lock cannot hold the other name.
    ///
    /// `None` if bun.lock could not give the package back: the folder is not recorded then.
    pub fn new(
        folder_name: &'a [u8],
        package_json_name: Option<&'a [u8]>,
        version: &[u8],
    ) -> Option<Self> {
        if !alias_is_safe_install_target(folder_name)
            || !dependency::is_safe_lockfile_package_name(folder_name)
        {
            return None;
        }
        let name = package_json_name
            .filter(|name| dependency::is_safe_lockfile_package_name(name))
            .unwrap_or(folder_name);

        // A package.json may say `v1.0.0` or `1.0.0rc.1`. A resolution prints `1.0.0` and
        // `1.0.0-rc.1`, which is all that a reload has.
        let declared = SemverVersion::parse_exact(SlicedString::init(version, version))?;
        let mut specifier = Vec::with_capacity(b"npm:@".len() + name.len() + version.len());
        specifier.extend_from_slice(b"npm:");
        specifier.extend_from_slice(name);
        specifier.push(b'@');
        let version_at = specifier.len();
        write!(specifier, "{}", declared.fmt(version))
            .expect("formatting into a Vec is infallible");
        let specifier = specifier.into_boxed_slice();

        let printed = &specifier[version_at..];
        // `1.0.0-a.tgz` is a version that bun.lock reads back as the path of a tarball.
        if DependencyTag::infer(printed) != DependencyTag::Npm {
            return None;
        }
        let version = SemverVersion::parse_exact(SlicedString::init(&specifier, printed))?;

        Some(Self {
            folder_name,
            name,
            specifier,
            version_at,
            version,
        })
    }

    pub fn count_package(&self, builder: &mut LockfileStringBuilder<'_>) {
        builder.count(self.name);
        self.version.count(&self.specifier, builder);
    }

    /// The package, marked as shipped, with no rows. It has no tarball of its own, so it has no
    /// URL and no integrity.
    pub fn append_package(&self, builder: &mut LockfileStringBuilder<'_>) -> Package {
        let name = builder.append::<ExternalString>(self.name);
        let mut package = Package {
            name: name.value,
            name_hash: name.hash,
            resolution: Resolution::init(TaggedValue::Npm(VersionedURL {
                url: String::default(),
                version: self.version.append(&self.specifier, builder),
            })),
            ..Package::default()
        };
        package.meta.mark_shipped();
        package
    }

    pub fn count_synthetic_row(&self, builder: &mut LockfileStringBuilder<'_>) {
        builder.count(self.folder_name);
        builder.count(self.requested());
    }

    /// The row of the package or shipped package above the folder, if its package.json does not
    /// declare the folder's name. Bind it to the shipped package: nothing resolves it.
    pub fn append_synthetic_row(&self, builder: &mut LockfileStringBuilder<'_>) -> Dependency {
        let name = builder.append::<ExternalString>(self.folder_name);
        let requested = builder.append::<String>(self.requested());
        Self::bundled_row(name, requested, builder.string_bytes.as_slice())
    }

    /// `append_synthetic_row` for a caller that counts no strings first.
    pub fn synthetic_row(&self, string_buf: &mut StringBuf<'_>) -> Result<Dependency, AllocError> {
        let name = string_buf.append_external(self.folder_name)?;
        let requested = string_buf.append(self.requested())?;
        Ok(Self::bundled_row(
            name,
            requested,
            string_buf.bytes.as_slice(),
        ))
    }

    /// What the synthetic row asks for: the shipped version, and as an npm alias does, the name
    /// of the package too if the folder has another name.
    fn requested(&self) -> &[u8] {
        if self.folder_name == self.name {
            &self.specifier[self.version_at..]
        } else {
            &self.specifier
        }
    }

    fn bundled_row(name: ExternalString, requested: String, string_bytes: &[u8]) -> Dependency {
        let sliced = requested.sliced(string_bytes);
        Dependency {
            name: name.value,
            name_hash: name.hash,
            // No dependency group, so bun.lock prints nothing of the row.
            behavior: Behavior::BUNDLED,
            version: dependency::parse_with_tag(
                name.value,
                Some(name.hash),
                sliced.slice,
                DependencyTag::Npm,
                &sliced,
                None,
                None,
            )
            .unwrap_or_default(),
        }
    }
}
