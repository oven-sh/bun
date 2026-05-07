//! Shared install↔resolver type surface.
//!
//! MOVE_DOWN from `bun_install` so `bun_resolver` can spell these types
//! without an upward dep edge (resolver→install would cycle through
//! install→resolver). The behaviourful `PackageManager` itself stays in
//! `bun_install`; the resolver talks to it through the [`AutoInstaller`]
//! trait below, which `bun_install::PackageManager` implements.
//!
//! Nothing here carries a stubbed/panicking default body — the trait is pure,
//! and the value types are the canonical on-disk shapes (re-exported by
//! `bun_install`).

use bun_semver::String as SemverString;

// ─── Identity / sentinel ──────────────────────────────────────────────────

pub type PackageID = u32;
pub type DependencyID = u32;
pub const INVALID_PACKAGE_ID: PackageID = PackageID::MAX;
pub const INVALID_DEPENDENCY_ID: DependencyID = DependencyID::MAX;

// ─── Dependency / Behavior ────────────────────────────────────────────────

pub mod behavior {
    bitflags::bitflags! {
        /// Port of `install/dependency.zig` `Behavior` (packed u8). Bit 0 and
        /// bit 7 are reserved (`_unused_1`/`_unused_2` in Zig) so the on-disk
        /// lockfile encoding stays byte-compatible.
        #[derive(Default, Clone, Copy, PartialEq, Eq)]
        pub struct Behavior: u8 {
            const PROD      = 1 << 1;
            const OPTIONAL  = 1 << 2;
            const DEV       = 1 << 3;
            const PEER      = 1 << 4;
            const WORKSPACE = 1 << 5;
            /// Is not set for transitive bundled dependencies
            const BUNDLED   = 1 << 6;
        }
    }
}
pub use behavior::Behavior;

impl Behavior {
    #[inline] pub fn is_prod(self) -> bool { self.contains(Self::PROD) }
    /// Zig: `optional and !peer` — peer-optionals are reported separately.
    #[inline] pub fn is_optional(self) -> bool {
        self.contains(Self::OPTIONAL) && !self.contains(Self::PEER)
    }
    #[inline] pub fn is_optional_peer(self) -> bool {
        self.contains(Self::OPTIONAL) && self.contains(Self::PEER)
    }
    #[inline] pub fn is_dev(self) -> bool { self.contains(Self::DEV) }
    #[inline] pub fn is_peer(self) -> bool { self.contains(Self::PEER) }
    #[inline] pub fn is_workspace(self) -> bool { self.contains(Self::WORKSPACE) }
    #[inline] pub fn is_bundled(self) -> bool { self.contains(Self::BUNDLED) }
    #[inline] pub fn includes(self, rhs: Self) -> bool { self.intersects(rhs) }
    #[inline] pub fn is_required(self) -> bool { !self.is_optional() }

    pub fn is_enabled(self, features: Features) -> bool {
        self.is_prod()
            || (features.optional_dependencies && self.is_optional())
            || (features.dev_dependencies && self.is_dev())
            || (features.peer_dependencies && self.is_peer())
            || (features.workspaces && self.is_workspace())
    }

    pub fn cmp(self, rhs: Self) -> core::cmp::Ordering {
        use core::cmp::Ordering::*;
        if self == rhs { return Equal; }
        // ensure workspaces are placed at the beginning
        if self.is_workspace() != rhs.is_workspace() {
            return if self.is_workspace() { Less } else { Greater };
        }
        if self.is_dev() != rhs.is_dev() {
            return if self.is_dev() { Less } else { Greater };
        }
        if self.is_optional() != rhs.is_optional() {
            return if self.is_optional() { Less } else { Greater };
        }
        if self.is_prod() != rhs.is_prod() {
            return if self.is_prod() { Less } else { Greater };
        }
        if self.is_peer() != rhs.is_peer() {
            return if self.is_peer() { Less } else { Greater };
        }
        Equal
    }
}

/// Port of `install/dependency.zig` `Version.Tag`.
#[derive(Default, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum DependencyVersionTag {
    #[default]
    Uninitialized = 0,
    /// Semver range
    Npm = 1,
    /// NPM dist tag, e.g. "latest"
    DistTag = 2,
    /// URI to a .tgz or .tar.gz
    Tarball = 3,
    /// Local folder
    Folder = 4,
    /// link:path
    Symlink = 5,
    /// Local path specified under `workspaces`
    Workspace = 6,
    /// Git Repository (via `git` CLI)
    Git = 7,
    /// GitHub Repository (via REST API)
    Github = 8,
    Catalog = 9,
}

/// Resolver-visible projection of `install::dependency::Version`. The full
/// `Version.Value` union references `bun_semver::query::Group` (a
/// self-referential linked list that is `!Clone`/`!Send`); the resolver only
/// reads `.tag` and `.value.npm.version.is_exact()`, so the value payload is
/// an opaque, install-supplied box.
#[derive(Default, Clone)]
pub struct DependencyVersion {
    pub tag: DependencyVersionTag,
    pub literal: SemverString,
    /// Opaque payload owned by `bun_install` (the parsed `Version.Value`).
    /// The resolver never inspects it directly — it round-trips through
    /// [`AutoInstaller`] methods.
    pub value: Option<core::ptr::NonNull<()>>,
}

#[derive(Default, Clone)]
pub struct Dependency {
    pub name: SemverString,
    pub name_hash: u64,
    pub behavior: Behavior,
    pub version: DependencyVersion,
}

// ─── npm::{Architecture, OperatingSystem} ─────────────────────────────────
// Bitflag sets keyed by short arch/os strings (install/npm.zig). The resolver
// only constructs them from package.json `os`/`cpu` arrays via
// `none().negatable().apply(str).combine()`; `bun_install` consumes the bits.

macro_rules! os_arch_flags {
    ($name:ident, $bits:ty, [$( $variant:ident = $lit:literal => $bit:expr ),* $(,)?]) => {
        bitflags::bitflags! {
            #[derive(Default, Clone, Copy, PartialEq, Eq)]
            pub struct $name: $bits {
                $( const $variant = 1 << $bit; )*
            }
        }
        impl $name {
            #[inline] pub fn none() -> Self { Self::empty() }
            #[inline] pub fn negatable(self) -> Negatable<$name> { Negatable { has: self, not: Self::empty() } }
            // NOTE: `bitflags!` already generates an inherent `from_name(&str)`;
            // use a distinct identifier so the two don't collide (E0592).
            fn from_npm_name(s: &[u8]) -> Option<Self> {
                match s { $( $lit => Some(Self::$variant), )* _ => None }
            }
        }
        impl Negatable<$name> {
            /// Port of `npm.zig` `Negatable.apply` — `!foo` clears, `foo` sets.
            pub fn apply(&mut self, s: &[u8]) {
                let (neg, key) = if let Some(rest) = s.strip_prefix(b"!") { (true, rest) } else { (false, s) };
                if let Some(bit) = <$name>::from_npm_name(key) {
                    if neg { self.not |= bit; } else { self.has |= bit; }
                }
            }
            #[inline] pub fn combine(self) -> $name {
                if self.has.is_empty() { <$name>::all() & !self.not } else { self.has & !self.not }
            }
        }
    };
}

#[derive(Default, Clone, Copy)]
pub struct Negatable<T: Copy> { pub has: T, pub not: T }

os_arch_flags!(Architecture, u16, [
    ARM     = b"arm"     => 0,
    ARM64   = b"arm64"   => 1,
    IA32    = b"ia32"    => 2,
    MIPS    = b"mips"    => 3,
    MIPSEL  = b"mipsel"  => 4,
    PPC     = b"ppc"     => 5,
    PPC64   = b"ppc64"   => 6,
    S390X   = b"s390x"   => 7,
    X64     = b"x64"     => 8,
    LOONG64 = b"loong64" => 9,
    RISCV64 = b"riscv64" => 10,
]);

os_arch_flags!(OperatingSystem, u16, [
    AIX     = b"aix"     => 0,
    DARWIN  = b"darwin"  => 1,
    FREEBSD = b"freebsd" => 2,
    LINUX   = b"linux"   => 3,
    OPENBSD = b"openbsd" => 4,
    SUNOS   = b"sunos"   => 5,
    WIN32   = b"win32"   => 6,
    ANDROID = b"android" => 7,
]);

// ─── Resolution ───────────────────────────────────────────────────────────

/// Port of `install/resolution.zig` `Resolution.Tag`.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum ResolutionTag {
    #[default]
    Uninitialized = 0,
    Root = 1,
    Npm = 2,
    Folder = 4,
    LocalTarball = 8,
    Github = 16,
    Gitlab = 24,
    Git = 32,
    Symlink = 64,
    Workspace = 72,
    RemoteTarball = 80,
    Single = 100,
}

/// Resolver-visible projection of `install::resolution::Resolution`. The full
/// `Value` union is install-internal; the resolver only reads `.tag` and
/// round-trips the whole value through [`AutoInstaller`] methods.
#[derive(Clone, Default)]
pub struct Resolution {
    pub tag: ResolutionTag,
    /// Opaque install-owned payload (the `Resolution.Value` union).
    pub value: [u64; 4],
}

impl Resolution {
    pub const ROOT: Self = Self { tag: ResolutionTag::Root, value: [0; 4] };
}

// ─── PreinstallState / Features / misc ────────────────────────────────────

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum PreinstallState {
    Unknown = 0,
    Done,
    Extract,
    Extracting,
    CalcPatchHash,
    CalcingPatchHash,
    ApplyPatch,
    ApplyingPatch,
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct Features {
    pub dependencies: bool,
    pub dev_dependencies: bool,
    pub is_main: bool,
    pub optional_dependencies: bool,
    pub peer_dependencies: bool,
    pub trusted_dependencies: bool,
    pub workspaces: bool,
    pub patched_dependencies: bool,
    pub check_for_duplicate_dependencies: bool,
}
impl Default for Features {
    fn default() -> Self {
        Self {
            dependencies: true,
            dev_dependencies: false,
            is_main: false,
            optional_dependencies: false,
            peer_dependencies: true,
            trusted_dependencies: false,
            workspaces: false,
            patched_dependencies: false,
            check_for_duplicate_dependencies: false,
        }
    }
}

#[derive(Default, Clone, Copy)]
pub struct TaskCallbackContext {
    pub root_request_id: u32,
}

/// Port of `install.zig` `PackageManager.WakeHandler` — opaque
/// (ctx-ptr + 2 fn-ptrs) handle the runtime installs to nudge the JS
/// event loop when a network task completes. The resolver only stores
/// and forwards it; the fields are `Option` so `Default` is all-None
/// (Zig: `.{ }` zero-init).
#[derive(Default, Clone)]
pub struct WakeHandler {
    pub context: Option<core::ptr::NonNull<core::ffi::c_void>>,
    pub handler: Option<fn(*mut core::ffi::c_void)>,
    pub on_dependency_error: Option<fn(*mut core::ffi::c_void, &Dependency, DependencyID, bun_core::Error)>,
}

// ─── DependencyGroup (lockfile::Package::DependencyGroup) ─────────────────

#[derive(Clone, Copy)]
pub struct DependencyGroup {
    pub prop: &'static [u8],
    pub field: &'static [u8],
    pub behavior: Behavior,
}
impl DependencyGroup {
    pub const DEPENDENCIES: Self =
        Self { prop: b"dependencies", field: b"dependencies", behavior: Behavior::PROD };
    pub const DEV: Self =
        Self { prop: b"devDependencies", field: b"dev_dependencies", behavior: Behavior::DEV };
    pub const OPTIONAL: Self = Self {
        prop: b"optionalDependencies",
        field: b"optional_dependencies",
        behavior: Behavior::OPTIONAL,
    };
    pub const PEER: Self = Self {
        prop: b"peerDependencies",
        field: b"peer_dependencies",
        behavior: Behavior::PEER,
    };
}

// ─── EnqueueResult ────────────────────────────────────────────────────────

pub enum EnqueueResult {
    Resolution { package_id: PackageID, resolution: Resolution },
    Pending(DependencyID),
    NotFound,
    Failure(bun_core::Error),
}

// ─── Lockfile slice handles ───────────────────────────────────────────────
// Port of `install/lockfile.zig` `ExternalSlice` — `(off, len)` into a flat
// backing buffer. Generic over element type so the same shape serves
// `dependencies`/`resolutions`.

#[derive(Clone, Copy, Default)]
pub struct ExternalSlice<T> {
    pub off: u32,
    pub len: u32,
    _marker: core::marker::PhantomData<T>,
}
impl<T> ExternalSlice<T> {
    #[inline]
    pub fn get<'a>(&self, buf: &'a [T]) -> &'a [T] {
        &buf[self.off as usize..(self.off + self.len) as usize]
    }
}

pub type DependencySlice = ExternalSlice<Dependency>;
pub type ResolutionSlice = ExternalSlice<PackageID>;

// ─── AutoInstaller trait ──────────────────────────────────────────────────

/// Everything `bun_resolver`'s auto-install path needs from
/// `bun_install::PackageManager` + its `Lockfile`. `bun_install` implements
/// this for `PackageManager`; the resolver holds `Option<NonNull<dyn
/// AutoInstaller>>` and only enters the auto-install path when it is set.
///
/// No method has a default body — this is a pure capability interface, not a
/// stub. Calling through an unset `Option` is statically prevented by
/// `Resolver::use_package_manager()`.
pub trait AutoInstaller {
    // ── Lockfile reads ────────────────────────────────────────────────────
    fn lockfile_packages_len(&self) -> usize;
    fn lockfile_package_dependencies(&self, id: PackageID) -> DependencySlice;
    fn lockfile_package_resolutions(&self, id: PackageID) -> ResolutionSlice;
    fn lockfile_package_resolution(&self, id: PackageID) -> Resolution;
    fn lockfile_dependencies_buf(&self) -> &[Dependency];
    fn lockfile_resolutions_buf(&self) -> &[PackageID];
    fn lockfile_string_bytes(&self) -> &[u8];
    fn lockfile_resolve(&self, name: &[u8], version: &DependencyVersion) -> Option<PackageID>;
    fn lockfile_legacy_package_to_dependency_id(
        &self,
        package_id: PackageID,
    ) -> core::result::Result<DependencyID, bun_core::Error>;
    fn lockfile_str(&self, s: &SemverString) -> &[u8];

    // ── Lockfile writes ───────────────────────────────────────────────────
    /// Port of `lockfile.appendPackage(Package.fromPackageJSON(...))` —
    /// collapsed because `Package` itself is install-internal. Returns the
    /// id assigned to the appended package.
    fn lockfile_append_from_package_json(
        &mut self,
        package_json: &dyn PackageJsonView,
        features: Features,
    ) -> core::result::Result<PackageID, bun_core::Error>;
    fn lockfile_append_root_stub(&mut self) -> core::result::Result<PackageID, bun_core::Error>;

    // ── PackageManager ops ────────────────────────────────────────────────
    fn set_on_wake(&mut self, handler: WakeHandler);
    fn path_for_resolution<'b>(
        &self,
        package_id: PackageID,
        resolution: &Resolution,
        buf: &'b mut [u8],
    ) -> core::result::Result<&'b [u8], bun_core::Error>;
    fn get_preinstall_state(&self, package_id: PackageID) -> PreinstallState;
    fn enqueue_package_for_download(
        &mut self,
        name: &[u8],
        dependency_id: DependencyID,
        package_id: PackageID,
        resolution: &Resolution,
        ctx: TaskCallbackContext,
        patch_name_and_version_hash: Option<u64>,
    ) -> core::result::Result<(), bun_core::Error>;
    fn resolve_from_disk_cache(
        &mut self,
        name: &[u8],
        version: &DependencyVersion,
    ) -> Option<PackageID>;
    fn enqueue_dependency_to_root(
        &mut self,
        name: &[u8],
        version: &DependencyVersion,
        version_buf: &[u8],
        behavior: Behavior,
    ) -> EnqueueResult;

    // ── Dependency parsing (install/dependency.zig) ───────────────────────
    fn parse_dependency(
        &self,
        name: SemverString,
        name_hash: Option<u64>,
        version: &[u8],
        sliced: &bun_semver::SlicedString,
        log: *mut bun_logger::Log,
    ) -> Option<DependencyVersion>;
    fn parse_dependency_with_tag(
        &self,
        name: SemverString,
        name_hash: u64,
        version: &[u8],
        tag: DependencyVersionTag,
        sliced: &bun_semver::SlicedString,
        log: *mut bun_logger::Log,
    ) -> Option<DependencyVersion>;
}

/// Read-only view of `bun_resolver::PackageJSON` that
/// [`AutoInstaller::lockfile_append_from_package_json`] needs. Defined here
/// (not in `bun_resolver`) so `bun_install` can name it without depending on
/// the resolver crate at the trait-definition layer.
pub trait PackageJsonView {
    fn name(&self) -> &[u8];
    fn version(&self) -> &[u8];
    fn source_path(&self) -> &[u8];
    fn dependency_iter(&self) -> Box<dyn Iterator<Item = (&[u8], &Dependency)> + '_>;
}

/// Factory hook installed by `bun_install` so the resolver can lazily
/// construct a `PackageManager` (Zig: `PackageManager.initWithRuntime`). When
/// `None`, auto-install is unavailable and the resolver's
/// `use_package_manager()` short-circuits.
pub type InitAutoInstaller = fn(
    log: *mut bun_logger::Log,
    install_opts: *const (),
    env_loader: core::ptr::NonNull<core::ffi::c_void>,
) -> core::ptr::NonNull<dyn AutoInstaller>;

pub static INIT_AUTO_INSTALLER: parking_lot::RwLock<Option<InitAutoInstaller>> =
    parking_lot::RwLock::new(None);
