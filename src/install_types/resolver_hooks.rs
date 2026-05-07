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

// ─── npm::{Negatable, OperatingSystem, Libc, Architecture} ────────────────
// MOVE_DOWN from `bun_install::npm` (port of `install/npm.zig`) so both
// `bun_resolver` (package.json `os`/`cpu` arrays) and `bun_install` (manifest
// parsing, lockfile serialization) name the SAME bit-layout. The bit positions
// are load-bearing — they round-trip through `bun.lock` and the npm manifest
// cache; the Zig spec starts at `1 << 1` (bit 0 is never set).
//
// `Negatable::from_json` stays in `bun_install::npm` because it depends on the
// `JsonExprView` trait (which abstracts over `bun_logger::js_ast::Expr` and
// `bun_js_parser::Expr`), neither of which is reachable from this crate.

/// Common shape of [`OperatingSystem`]/[`Architecture`]/[`Libc`] (Zig: `enum(uN)
/// { none = 0, all = all_value, _ }` open-enum with associated bit consts).
pub trait NegatableEnum: Copy + Eq {
    type Int: 'static
        + Copy
        + Eq
        + core::ops::BitOr<Output = Self::Int>
        + core::ops::BitAnd<Output = Self::Int>
        + core::ops::Not<Output = Self::Int>
        + Default;
    const NONE: Self;
    const ALL: Self;
    const ALL_VALUE: Self::Int;
    fn name_map() -> &'static phf::Map<&'static [u8], Self::Int>;
    fn name_map_kvs() -> &'static [(&'static [u8], Self::Int)];
    fn has(self, other: Self::Int) -> bool;
    fn to_raw(self) -> Self::Int;
    fn from_raw(n: Self::Int) -> Self;
}

/// Port of `install/npm.zig` `Negatable(T)` — accumulates an `os`/`cpu`/`libc`
/// allowlist+blocklist from package.json string arrays, then collapses to a
/// single bitset via [`combine`](Self::combine).
#[derive(Clone, Copy)]
pub struct Negatable<T: NegatableEnum> {
    pub added: T,
    pub removed: T,
    pub had_wildcard: bool,
    pub had_unrecognized_values: bool,
}

impl<T: NegatableEnum> Default for Negatable<T> {
    fn default() -> Self {
        Self {
            added: T::NONE,
            removed: T::NONE,
            had_wildcard: false,
            had_unrecognized_values: false,
        }
    }
}

impl<T: NegatableEnum> Negatable<T> {
    // https://github.com/pnpm/pnpm/blob/1f228b0aeec2ef9a2c8577df1d17186ac83790f9/config/package-is-installable/src/checkPlatform.ts#L56-L86
    // https://github.com/npm/cli/blob/fefd509992a05c2dfddbe7bc46931c42f1da69d7/node_modules/npm-install-checks/lib/index.js#L2-L96
    pub fn combine(self) -> T {
        let added = if self.had_wildcard { T::ALL_VALUE } else { self.added.to_raw() };
        let removed = self.removed.to_raw();
        let zero = T::Int::default();

        // If none were added or removed, all are allowed
        if added == zero && removed == zero {
            if self.had_unrecognized_values {
                return T::NONE;
            }
            // []
            return T::ALL;
        }

        // If none were added, but some were removed, return the inverse of the removed
        if added == zero && removed != zero {
            // ["!linux", "!darwin"]
            return T::from_raw(T::ALL_VALUE & !removed);
        }

        if removed == zero {
            // ["linux", "darwin"]
            return T::from_raw(added);
        }

        // - ["linux", "!darwin"]
        T::from_raw(added & !removed)
    }

    pub fn apply(&mut self, str: &[u8]) {
        if str.is_empty() {
            return;
        }

        if str == b"any" {
            self.had_wildcard = true;
            return;
        }

        if str == b"none" {
            self.had_unrecognized_values = true;
            return;
        }

        let is_not = str[0] == b'!';
        let offset: usize = is_not as usize;

        let Some(&field) = T::name_map().get(&str[offset..]) else {
            if !is_not {
                self.had_unrecognized_values = true;
            }
            return;
        };

        if is_not {
            self.removed = T::from_raw(self.removed.to_raw() | field);
        } else {
            self.added = T::from_raw(self.added.to_raw() | field);
        }
    }

    /// writes to a one line json array with a trailing comma and space, or writes a string
    pub fn to_json(field: T, writer: &mut impl core::fmt::Write) -> core::fmt::Result {
        if field == T::NONE {
            // [] means everything, so unrecognized value
            return writer.write_str(r#""none""#);
        }

        let kvs = T::name_map_kvs();
        let mut removed: u8 = 0;
        for kv in kvs {
            if !field.has(kv.1) {
                removed += 1;
            }
        }
        let included = kvs.len() - usize::from(removed);
        let print_included = usize::from(removed) > kvs.len() - usize::from(removed);

        let one = (print_included && included == 1) || (!print_included && removed == 1);

        if !one {
            writer.write_str("[ ")?;
        }

        for kv in kvs {
            let has = field.has(kv.1);
            if has && print_included {
                write!(writer, r#""{}""#, bstr::BStr::new(kv.0))?;
                if one {
                    return Ok(());
                }
                writer.write_str(", ")?;
            } else if !has && !print_included {
                write!(writer, r#""!{}""#, bstr::BStr::new(kv.0))?;
                if one {
                    return Ok(());
                }
                writer.write_str(", ")?;
            }
        }

        writer.write_char(']')
    }
}

/// Zig: `pub fn negatable(this: T) Negatable(T)` — provided as a blanket ext
/// so each enum doesn't repeat the constructor.
pub trait NegatableExt: NegatableEnum {
    #[inline]
    fn negatable(self) -> Negatable<Self> {
        Negatable {
            added: self,
            removed: Self::NONE,
            had_wildcard: false,
            had_unrecognized_values: false,
        }
    }
}
impl<T: NegatableEnum> NegatableExt for T {}

// ──────────────────────────────────────────────────────────────────────────

/// https://nodejs.org/api/os.html#osplatform
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub struct OperatingSystem(pub u16);

impl OperatingSystem {
    pub const NONE: Self = Self(0);
    pub const ALL: Self = Self(Self::ALL_VALUE);

    pub const AIX: u16 = 1 << 1;
    pub const DARWIN: u16 = 1 << 2;
    pub const FREEBSD: u16 = 1 << 3;
    pub const LINUX: u16 = 1 << 4;
    pub const OPENBSD: u16 = 1 << 5;
    pub const SUNOS: u16 = 1 << 6;
    pub const WIN32: u16 = 1 << 7;
    pub const ANDROID: u16 = 1 << 8;

    pub const ALL_VALUE: u16 = Self::AIX
        | Self::DARWIN
        | Self::FREEBSD
        | Self::LINUX
        | Self::OPENBSD
        | Self::SUNOS
        | Self::WIN32
        | Self::ANDROID;

    #[cfg(all(target_os = "linux", not(target_os = "android")))]
    pub const CURRENT: Self = Self(Self::LINUX);
    #[cfg(target_os = "android")]
    pub const CURRENT: Self = Self(Self::ANDROID);
    #[cfg(target_os = "macos")]
    pub const CURRENT: Self = Self(Self::DARWIN);
    #[cfg(windows)]
    pub const CURRENT: Self = Self(Self::WIN32);
    #[cfg(target_os = "freebsd")]
    pub const CURRENT: Self = Self(Self::FREEBSD);

    #[cfg(target_os = "linux")]
    pub const CURRENT_NAME: &'static str = "linux";
    #[cfg(target_os = "macos")]
    pub const CURRENT_NAME: &'static str = "darwin";
    #[cfg(windows)]
    pub const CURRENT_NAME: &'static str = "win32";
    #[cfg(target_os = "freebsd")]
    pub const CURRENT_NAME: &'static str = "freebsd";

    #[inline] pub const fn none() -> Self { Self::NONE }
    #[inline] pub const fn all() -> Self { Self::ALL }
    #[inline] pub fn is_match(self, target: Self) -> bool { (self.0 & target.0) != 0 }
    #[inline] pub fn has(self, other: u16) -> bool { (self.0 & other) != 0 }
    #[inline] pub fn negatable(self) -> Negatable<Self> { NegatableExt::negatable(self) }

    // Order MUST match Zig's `ComptimeStringMap.kvs` (= `precomputed.sorted_kvs`, sorted by
    // (key.len asc, then bytewise asc) — src/collections/comptime_string_map.zig:21-27,66).
    // `Negatable::to_json` iterates this to serialize bun.lock `"os"` arrays; mismatched
    // order yields non-byte-identical lockfiles vs. Zig.
    pub const NAME_MAP_KVS: &'static [(&'static [u8], u16)] = &[
        (b"aix", Self::AIX),
        (b"linux", Self::LINUX),
        (b"sunos", Self::SUNOS),
        (b"win32", Self::WIN32),
        (b"darwin", Self::DARWIN),
        (b"android", Self::ANDROID),
        (b"freebsd", Self::FREEBSD),
        (b"openbsd", Self::OPENBSD),
    ];
}

pub static OPERATING_SYSTEM_NAME_MAP: phf::Map<&'static [u8], u16> = phf::phf_map! {
    b"aix" => OperatingSystem::AIX,
    b"darwin" => OperatingSystem::DARWIN,
    b"freebsd" => OperatingSystem::FREEBSD,
    b"linux" => OperatingSystem::LINUX,
    b"openbsd" => OperatingSystem::OPENBSD,
    b"sunos" => OperatingSystem::SUNOS,
    b"win32" => OperatingSystem::WIN32,
    b"android" => OperatingSystem::ANDROID,
};

impl NegatableEnum for OperatingSystem {
    type Int = u16;
    const NONE: Self = Self::NONE;
    const ALL: Self = Self::ALL;
    const ALL_VALUE: u16 = Self::ALL_VALUE;
    fn name_map() -> &'static phf::Map<&'static [u8], u16> { &OPERATING_SYSTEM_NAME_MAP }
    fn name_map_kvs() -> &'static [(&'static [u8], u16)] { Self::NAME_MAP_KVS }
    fn has(self, other: u16) -> bool { Self::has(self, other) }
    fn to_raw(self) -> u16 { self.0 }
    fn from_raw(n: u16) -> Self { Self(n) }
}

// ──────────────────────────────────────────────────────────────────────────

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub struct Libc(pub u8);

impl Libc {
    pub const NONE: Self = Self(0);
    pub const ALL: Self = Self(Self::ALL_VALUE);

    pub const GLIBC: u8 = 1 << 1;
    pub const MUSL: u8 = 1 << 2;

    pub const ALL_VALUE: u8 = Self::GLIBC | Self::MUSL;

    // TODO: (matches Zig — runtime libc detection)
    pub const CURRENT: Self = Self(Self::GLIBC);

    #[inline] pub const fn none() -> Self { Self::NONE }
    #[inline] pub const fn all() -> Self { Self::ALL }
    #[inline] pub fn is_match(self, target: Self) -> bool { (self.0 & target.0) != 0 }
    #[inline] pub fn has(self, other: u8) -> bool { (self.0 & other) != 0 }
    #[inline] pub fn negatable(self) -> Negatable<Self> { NegatableExt::negatable(self) }

    // Order MUST match Zig's `ComptimeStringMap.kvs` (sorted by (key.len asc, bytewise asc)).
    pub const NAME_MAP_KVS: &'static [(&'static [u8], u8)] = &[
        (b"musl", Self::MUSL),
        (b"glibc", Self::GLIBC),
    ];
}

pub static LIBC_NAME_MAP: phf::Map<&'static [u8], u8> = phf::phf_map! {
    b"glibc" => Libc::GLIBC,
    b"musl" => Libc::MUSL,
};

impl NegatableEnum for Libc {
    type Int = u8;
    const NONE: Self = Self::NONE;
    const ALL: Self = Self::ALL;
    const ALL_VALUE: u8 = Self::ALL_VALUE;
    fn name_map() -> &'static phf::Map<&'static [u8], u8> { &LIBC_NAME_MAP }
    fn name_map_kvs() -> &'static [(&'static [u8], u8)] { Self::NAME_MAP_KVS }
    fn has(self, other: u8) -> bool { Self::has(self, other) }
    fn to_raw(self) -> u8 { self.0 }
    fn from_raw(n: u8) -> Self { Self(n) }
}

// ──────────────────────────────────────────────────────────────────────────

/// https://docs.npmjs.com/cli/v8/configuring-npm/package-json#cpu
/// https://nodejs.org/api/os.html#osarch
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub struct Architecture(pub u16);

impl Architecture {
    pub const NONE: Self = Self(0);
    pub const ALL: Self = Self(Self::ALL_VALUE);

    pub const ARM: u16 = 1 << 1;
    pub const ARM64: u16 = 1 << 2;
    pub const IA32: u16 = 1 << 3;
    pub const MIPS: u16 = 1 << 4;
    pub const MIPSEL: u16 = 1 << 5;
    pub const PPC: u16 = 1 << 6;
    pub const PPC64: u16 = 1 << 7;
    pub const S390: u16 = 1 << 8;
    pub const S390X: u16 = 1 << 9;
    pub const X32: u16 = 1 << 10;
    pub const X64: u16 = 1 << 11;

    pub const ALL_VALUE: u16 = Self::ARM
        | Self::ARM64
        | Self::IA32
        | Self::MIPS
        | Self::MIPSEL
        | Self::PPC
        | Self::PPC64
        | Self::S390
        | Self::S390X
        | Self::X32
        | Self::X64;

    #[cfg(target_arch = "aarch64")]
    pub const CURRENT: Self = Self(Self::ARM64);
    #[cfg(target_arch = "x86_64")]
    pub const CURRENT: Self = Self(Self::X64);

    #[cfg(target_arch = "aarch64")]
    pub const CURRENT_NAME: &'static str = "arm64";
    #[cfg(target_arch = "x86_64")]
    pub const CURRENT_NAME: &'static str = "x64";

    #[inline] pub const fn none() -> Self { Self::NONE }
    #[inline] pub const fn all() -> Self { Self::ALL }
    #[inline] pub fn is_match(self, target: Self) -> bool { (self.0 & target.0) != 0 }
    #[inline] pub fn has(self, other: u16) -> bool { (self.0 & other) != 0 }
    #[inline] pub fn negatable(self) -> Negatable<Self> { NegatableExt::negatable(self) }

    // Order MUST match Zig's `ComptimeStringMap.kvs` (= `precomputed.sorted_kvs`, sorted by
    // (key.len asc, then bytewise asc) — src/collections/comptime_string_map.zig:21-27,66).
    // `Negatable::to_json` iterates this to serialize bun.lock `"cpu"` arrays; mismatched
    // order yields non-byte-identical lockfiles vs. Zig.
    pub const NAME_MAP_KVS: &'static [(&'static [u8], u16)] = &[
        (b"arm", Self::ARM),
        (b"ppc", Self::PPC),
        (b"x32", Self::X32),
        (b"x64", Self::X64),
        (b"ia32", Self::IA32),
        (b"mips", Self::MIPS),
        (b"s390", Self::S390),
        (b"arm64", Self::ARM64),
        (b"ppc64", Self::PPC64),
        (b"s390x", Self::S390X),
        (b"mipsel", Self::MIPSEL),
    ];
}

pub static ARCHITECTURE_NAME_MAP: phf::Map<&'static [u8], u16> = phf::phf_map! {
    b"arm" => Architecture::ARM,
    b"arm64" => Architecture::ARM64,
    b"ia32" => Architecture::IA32,
    b"mips" => Architecture::MIPS,
    b"mipsel" => Architecture::MIPSEL,
    b"ppc" => Architecture::PPC,
    b"ppc64" => Architecture::PPC64,
    b"s390" => Architecture::S390,
    b"s390x" => Architecture::S390X,
    b"x32" => Architecture::X32,
    b"x64" => Architecture::X64,
};

impl NegatableEnum for Architecture {
    type Int = u16;
    const NONE: Self = Self::NONE;
    const ALL: Self = Self::ALL;
    const ALL_VALUE: u16 = Self::ALL_VALUE;
    fn name_map() -> &'static phf::Map<&'static [u8], u16> { &ARCHITECTURE_NAME_MAP }
    fn name_map_kvs() -> &'static [(&'static [u8], u16)] { Self::NAME_MAP_KVS }
    fn has(self, other: u16) -> bool { Self::has(self, other) }
    fn to_raw(self) -> u16 { self.0 }
    fn from_raw(n: u16) -> Self { Self(n) }
}

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
    Git = 32,
    Symlink = 64,
    Workspace = 72,
    RemoteTarball = 80,
    SingleFileModule = 100,
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

impl Features {
    pub fn behavior(self) -> Behavior {
        let mut out: u8 = 0;
        out |= (self.dependencies as u8) << 1;
        out |= (self.optional_dependencies as u8) << 2;
        out |= (self.dev_dependencies as u8) << 3;
        out |= (self.peer_dependencies as u8) << 4;
        out |= (self.workspaces as u8) << 5;
        Behavior::from_bits_retain(out)
    }

    const fn base() -> Self {
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

    pub const MAIN: Self = Self {
        check_for_duplicate_dependencies: true,
        dev_dependencies: true,
        is_main: true,
        optional_dependencies: true,
        trusted_dependencies: true,
        patched_dependencies: true,
        workspaces: true,
        ..Self::base()
    };

    pub const FOLDER: Self = Self {
        dev_dependencies: true,
        optional_dependencies: true,
        ..Self::base()
    };

    pub const WORKSPACE: Self = Self {
        dev_dependencies: true,
        optional_dependencies: true,
        trusted_dependencies: true,
        ..Self::base()
    };

    pub const LINK: Self = Self {
        dependencies: false,
        peer_dependencies: false,
        ..Self::base()
    };

    pub const NPM: Self = Self {
        optional_dependencies: true,
        ..Self::base()
    };

    pub const TARBALL: Self = Self::NPM;

    pub const NPM_MANIFEST: Self = Self {
        optional_dependencies: true,
        ..Self::base()
    };
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
