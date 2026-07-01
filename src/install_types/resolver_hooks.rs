//! Shared install↔resolver type surface.
//!
//! MOVE_DOWN from `bun_install` so `bun_resolver` can spell these types
//! without an upward dep edge (resolver→install would cycle through
//! install→resolver). The behaviourful `PackageManager` itself stays in
//! `bun_install`; the resolver talks to it through the opaque
//! [`PackageManagerHandle`] + `bun_pm_*` link fns below, whose bodies live
//! next to the implementation (`bun_install::auto_installer`).
//!
//! Every value type here is the SINGLE canonical definition — `bun_install`
//! re-exports them (`pub use bun_install_types::…`); there is exactly one
//! nominal type per name.

use core::cmp::Ordering;
use core::ffi::c_void;
use core::marker::PhantomData;
use core::mem::ManuallyDrop;
use core::ptr::NonNull;

use bun_core::strings;
use bun_semver::version::VersionInt;
use bun_semver::{
    self as semver, ExternalString, String as SemverString, Version as SemverVersion,
};

// ─── Identity / sentinel ──────────────────────────────────────────────────

pub type PackageID = u32;
pub type DependencyID = u32;
pub type PackageNameHash = u64;
pub type TruncatedPackageNameHash = u32;
pub const INVALID_PACKAGE_ID: PackageID = PackageID::MAX;
pub const INVALID_DEPENDENCY_ID: DependencyID = DependencyID::MAX;

// ─── ExternalSlice ────────────────────────────────────────────────────────
// An `(off, len)` index pair into a
// flat backing buffer (lockfile string-bytes / dependencies / resolutions).
// Generic over element type; storage is two u32s with a phantom marker.

#[repr(C)]
pub struct ExternalSlice<T> {
    pub off: u32,
    pub len: u32,
    _marker: PhantomData<T>,
}

// Manual impls: the `(off, len)` pair is unconditionally
// copyable/comparable regardless of `Type`. `#[derive]` would add spurious
// `T: Copy/Clone/Default/PartialEq` bounds via `PhantomData<T>`, breaking
// by-value `self` methods for non-`Copy` element types (e.g. `Dependency`).
impl<T> Copy for ExternalSlice<T> {}
impl<T> Clone for ExternalSlice<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Default for ExternalSlice<T> {
    #[inline]
    fn default() -> Self {
        Self {
            off: 0,
            len: 0,
            _marker: PhantomData,
        }
    }
}
impl<T> PartialEq for ExternalSlice<T> {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.off == other.off && self.len == other.len
    }
}
impl<T> Eq for ExternalSlice<T> {}
impl<T> core::fmt::Debug for ExternalSlice<T> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("ExternalSlice")
            .field("off", &self.off)
            .field("len", &self.len)
            .finish()
    }
}

impl<T> ExternalSlice<T> {
    #[inline]
    pub const fn new(off: u32, len: u32) -> Self {
        Self {
            off,
            len,
            _marker: PhantomData,
        }
    }

    pub const INVALID: Self = Self {
        off: u32::MAX,
        len: u32::MAX,
        _marker: PhantomData,
    };

    #[inline]
    pub fn is_invalid(self) -> bool {
        self.off == u32::MAX && self.len == u32::MAX
    }

    #[inline]
    pub fn contains(self, id: u32) -> bool {
        id >= self.off && (id as u64) < self.len as u64 + self.off as u64
    }

    #[inline]
    pub fn get(self, in_: &[T]) -> &[T] {
        // Compute the sum in usize so
        // the release-mode clamp applies instead of a debug u32-overflow panic.
        let end = in_.len().min(self.off as usize + self.len as usize);
        debug_assert!(self.off as usize + self.len as usize <= in_.len());
        &in_[self.off as usize..end]
    }

    #[inline]
    pub fn mut_(self, in_: &mut [T]) -> &mut [T] {
        let end = in_.len().min(self.off as usize + self.len as usize);
        debug_assert!(self.off as usize + self.len as usize <= in_.len());
        &mut in_[self.off as usize..end]
    }

    #[inline]
    pub fn begin(self) -> u32 {
        self.off
    }

    #[inline]
    pub fn end(self) -> u32 {
        self.off + self.len
    }

    pub fn init(buf: &[T], in_: &[T]) -> Self {
        // if cfg!(debug_assertions) {
        //     debug_assert!(buf.as_ptr() as usize <= in_.as_ptr() as usize);
        //     debug_assert!((in_.as_ptr() as usize + in_.len()) <= (buf.as_ptr() as usize + buf.len()));
        // }
        Self {
            off: ((in_.as_ptr() as usize - buf.as_ptr() as usize) / core::mem::size_of::<T>())
                as u32,
            len: in_.len() as u32,
            _marker: PhantomData,
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone, Default, Debug)]
pub struct ExternalStringMap {
    pub name: ExternalStringList,
    pub value: ExternalStringList,
}

pub type ExternalStringList = ExternalSlice<ExternalString>;
pub type ExternalPackageNameHashList = ExternalSlice<PackageNameHash>;
pub type VersionSlice = ExternalSlice<SemverVersion>;
pub type DependencySlice = ExternalSlice<Dependency>;
pub type ResolutionSlice = ExternalSlice<PackageID>;

// ─── Dependency / Behavior ────────────────────────────────────────────────

pub mod behavior {
    bitflags::bitflags! {
        /// Bit 0 and
        /// bit 7 are reserved so the on-disk
        /// lockfile encoding stays byte-compatible.
        #[repr(transparent)]
        #[derive(Default, Clone, Copy, PartialEq, Eq, Hash)]
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
    /// (name, getter) table over the named flag bits (skipping the reserved
    /// bit-0 and bit-7 padding bits). Used by debug JSON serialization in
    /// place of field reflection.
    pub const NAMED_FLAGS: &'static [(&'static str, fn(&Behavior) -> bool)] = &[
        ("prod", |b| b.contains(Behavior::PROD)),
        ("optional", |b| b.contains(Behavior::OPTIONAL)),
        ("dev", |b| b.contains(Behavior::DEV)),
        ("peer", |b| b.contains(Behavior::PEER)),
        ("workspace", |b| b.contains(Behavior::WORKSPACE)),
        ("bundled", |b| b.contains(Behavior::BUNDLED)),
    ];

    #[inline]
    pub fn is_prod(self) -> bool {
        self.contains(Self::PROD)
    }
    /// Peer-optionals are reported separately.
    #[inline]
    pub fn is_optional(self) -> bool {
        self.contains(Self::OPTIONAL) && !self.contains(Self::PEER)
    }
    #[inline]
    pub fn is_optional_peer(self) -> bool {
        self.contains(Self::OPTIONAL) && self.contains(Self::PEER)
    }
    #[inline]
    pub fn is_dev(self) -> bool {
        self.contains(Self::DEV)
    }
    #[inline]
    pub fn is_peer(self) -> bool {
        self.contains(Self::PEER)
    }
    #[inline]
    pub fn is_workspace(self) -> bool {
        self.contains(Self::WORKSPACE)
    }
    #[inline]
    pub fn is_bundled(self) -> bool {
        self.contains(Self::BUNDLED)
    }
    #[inline]
    pub fn includes(self, rhs: Self) -> bool {
        self.intersects(rhs)
    }
    #[inline]
    pub fn is_required(self) -> bool {
        !self.is_optional()
    }

    #[inline]
    pub fn eq(lhs: Behavior, rhs: Behavior) -> bool {
        lhs.bits() == rhs.bits()
    }

    #[inline]
    pub fn add(self, kind: Behavior) -> Behavior {
        self | kind
    }

    /// Named `with` so it doesn't collide with `bitflags::Flags::set`.
    #[inline]
    pub fn with(self, kind: Behavior, value: bool) -> Behavior {
        let mut new = self;
        new.set(kind, value);
        new
    }

    /// Toggles the OPTIONAL bit in place.
    #[inline]
    pub fn set_optional(&mut self, value: bool) {
        self.set(Behavior::OPTIONAL, value);
    }

    pub fn is_enabled(self, features: Features) -> bool {
        self.is_prod()
            || (features.optional_dependencies && self.is_optional())
            || (features.dev_dependencies && self.is_dev())
            || (features.peer_dependencies && self.is_peer())
            || (features.workspaces && self.is_workspace())
    }

    pub fn cmp(self, rhs: Self) -> core::cmp::Ordering {
        use core::cmp::Ordering::*;
        if self == rhs {
            return Equal;
        }
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

const _: () = assert!(Behavior::PROD.bits() == (1 << 1));
const _: () = assert!(Behavior::OPTIONAL.bits() == (1 << 2));
const _: () = assert!(Behavior::DEV.bits() == (1 << 3));
const _: () = assert!(Behavior::PEER.bits() == (1 << 4));
const _: () = assert!(Behavior::WORKSPACE.bits() == (1 << 5));

#[derive(Default, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")] // "npm"/"dist_tag"/"github"/...
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

/// Resolver-visible projection of `install::dependency::Version`. The resolver
/// only reads `.tag` and round-trips the whole value through
/// [`PackageManagerRef`]
/// methods; the parsed `Version.Value` union is install-internal and is stored
/// here as an opaque inline buffer so the struct stays `Send`/`Clone`.
///
/// `#[repr(C)]` + identical field order make this layout-compatible with
/// `bun_install::dependency::Version`; `bun_install::auto_installer` asserts
/// `size_of`/`align_of` equality at compile time so the lockfile dependency
/// buffer can be reinterpreted without copying.
// ─── Dependency.Version.Value payload types ───────────────────────────────
// MOVE_DOWN from `bun_install::dependency` — every variant is either a
// `Semver.String` handle, a `Repository`, or a `Semver.Query.Group` (all
// lower-tier `bun_semver` data), so the full union is spellable here. Putting
// the real union in this crate lets the resolver inspect
// `value.npm.version.is_exact()` directly and
// round-trip the parsed value through [`PackageManagerRef`] without type
// erasure.

#[derive(Clone, Copy)]
pub enum URI {
    Local(SemverString),
    Remote(SemverString),
}

impl URI {
    pub fn eql(lhs: URI, rhs: URI, lhs_buf: &[u8], rhs_buf: &[u8]) -> bool {
        match (lhs, rhs) {
            (URI::Local(l), URI::Local(r)) | (URI::Remote(l), URI::Remote(r)) => {
                strings::eql_long(l.slice(lhs_buf), r.slice(rhs_buf), true)
            }
            _ => false,
        }
    }
}

pub struct NpmInfo {
    pub name: SemverString,
    pub version: semver::query::Group,
    pub is_alias: bool,
}

impl Clone for NpmInfo {
    fn clone(&self) -> Self {
        Self {
            name: self.name,
            version: self.version.clone(),
            is_alias: self.is_alias,
        }
    }
}

impl NpmInfo {
    pub fn eql(&self, that: &NpmInfo, this_buf: &[u8], that_buf: &[u8]) -> bool {
        self.name.eql(that.name, this_buf, that_buf) && self.version.eql(&that.version)
    }
}

#[derive(Clone, Copy)]
pub struct TagInfo {
    pub name: SemverString,
    pub tag: SemverString,
}

impl TagInfo {
    pub fn eql(&self, that: &TagInfo, this_buf: &[u8], that_buf: &[u8]) -> bool {
        self.name.eql(that.name, this_buf, that_buf) && self.tag.eql(that.tag, this_buf, that_buf)
    }
}

#[derive(Clone, Copy)]
pub struct TarballInfo {
    pub uri: URI,
    pub package_name: SemverString,
}

impl Default for TarballInfo {
    fn default() -> Self {
        TarballInfo {
            uri: URI::Local(SemverString::default()),
            package_name: SemverString::default(),
        }
    }
}

impl TarballInfo {
    pub fn eql(&self, that: &TarballInfo, this_buf: &[u8], that_buf: &[u8]) -> bool {
        URI::eql(self.uri, that.uri, this_buf, that_buf)
    }
}

/// Untagged union; the discriminant
/// lives in [`DependencyVersion::tag`]. The `npm` arm owns a `Box` linked list
/// (`Semver.Query.Group`) and is `ManuallyDrop`-wrapped because the union has
/// no tag; [`DependencyVersion`]'s `Drop`/`Clone` dispatch on `tag` to free /
/// deep-copy it. `git`/`github` (`Repository`) hold no heap data.
#[repr(C)]
pub union DependencyVersionValue {
    pub uninitialized: (),

    pub npm: ManuallyDrop<NpmInfo>,
    pub dist_tag: TagInfo,
    pub tarball: TarballInfo,
    pub folder: SemverString,

    /// Equivalent to npm link
    pub symlink: SemverString,

    pub workspace: SemverString,
    pub git: ManuallyDrop<Repository>,
    pub github: ManuallyDrop<Repository>,

    /// dep version without 'catalog:' protocol — empty string == default catalog
    pub catalog: SemverString,
}

impl Default for DependencyVersionValue {
    #[inline]
    fn default() -> Self {
        DependencyVersionValue { uninitialized: () }
    }
}

// No `Clone for DependencyVersionValue`: a tag-blind bitwise clone would double-free `npm`.

#[repr(C)]
pub struct DependencyVersion {
    pub tag: DependencyVersionTag,
    pub literal: SemverString,
    pub value: DependencyVersionValue,
}

impl Default for DependencyVersion {
    fn default() -> Self {
        Self {
            tag: DependencyVersionTag::Uninitialized,
            literal: SemverString::default(),
            value: DependencyVersionValue { uninitialized: () },
        }
    }
}

impl Clone for DependencyVersion {
    fn clone(&self) -> Self {
        let value = match self.tag {
            DependencyVersionTag::Npm => DependencyVersionValue {
                // SAFETY: tag == Npm, so `npm` is the active arm.
                npm: ManuallyDrop::new(unsafe { (*self.value.npm).clone() }),
            },
            // SAFETY: all non-`npm` arms hold no heap; a bitwise read is a true clone.
            _ => unsafe { core::ptr::read(&raw const self.value) },
        };
        Self {
            tag: self.tag,
            literal: self.literal,
            value,
        }
    }
}

impl Drop for DependencyVersion {
    fn drop(&mut self) {
        if self.tag == DependencyVersionTag::Npm {
            // SAFETY: tag == Npm, so `npm` is the active arm.
            unsafe { ManuallyDrop::drop(&mut self.value.npm) };
        }
    }
}

impl DependencyVersion {
    // Tag-checked accessors for the untagged [`DependencyVersionValue`] union.
    // Every payload is POD/arena-backed (`SemverString` handles, `Repository`,
    // `ManuallyDrop<NpmInfo>` over an arena-owned linked list), so reading the
    // "wrong" variant is not UB — it yields garbage. `_mut` variants let the
    // handful of mutate-in-place call sites (`runTasks.rs` package-name
    // back-patching, `Package.rs` workspace resolution) write through the
    // active arm without an `unsafe` block apiece.
    bun_core::extern_union_accessors! {
        tag: tag as DependencyVersionTag, value: value;
        Npm       => npm: NpmInfo,            mut npm_mut;
        DistTag   => dist_tag: TagInfo,       mut dist_tag_mut;
        Tarball   => tarball: TarballInfo,    mut tarball_mut;
        Folder    => folder: SemverString,    mut folder_mut;
        Symlink   => symlink: SemverString,   mut symlink_mut;
        Workspace => workspace: SemverString, mut workspace_mut;
        Git       => git: Repository,         mut git_mut;
        Github    => github: Repository,      mut github_mut;
        Catalog   => catalog: SemverString,   mut catalog_mut;
    }

    #[inline]
    pub fn try_npm(&self) -> Option<&NpmInfo> {
        (self.tag == DependencyVersionTag::Npm).then(|| self.npm())
    }

    /// Returns false for non-npm tags.
    #[inline]
    pub fn is_exact_npm(&self) -> bool {
        self.try_npm().is_some_and(|n| n.version.is_exact())
    }
}

/// Field order mirrors `bun_install::dependency::Dependency` (`name_hash`,
/// `name`, `version`, `behavior`) and both are `#[repr(C)]` so the lockfile's
/// `&[bun_install::Dependency]` is reinterpretable as `&[Self]` (asserted in
/// `bun_install::auto_installer`).
#[repr(C)]
#[derive(Default)]
pub struct Dependency {
    pub name_hash: PackageNameHash,
    pub name: SemverString,
    pub version: DependencyVersion,
    pub behavior: Behavior,
}

impl Clone for Dependency {
    #[inline]
    fn clone(&self) -> Self {
        Self {
            name_hash: self.name_hash,
            name: self.name,
            version: self.version.clone(),
            behavior: self.behavior,
        }
    }
}

impl Dependency {
    /// Sorting order for dependencies is:
    /// 1. [`peerDependencies`, `optionalDependencies`, `devDependencies`, `dependencies`]
    /// 2. name ASC
    /// "name" must be ASC so that later, when we rebuild the lockfile, we
    /// insert it back in reverse order without an extra sorting pass.
    ///
    /// Lives here so the lockfile
    /// stringifier (`bun.lock.rs`) can sort `&[Dependency]` without an upward
    /// `bun_install` edge or an extension trait.
    pub fn is_less_than(string_buf: &[u8], lhs: &Dependency, rhs: &Dependency) -> bool {
        let behavior = lhs.behavior.cmp(rhs.behavior);
        if behavior != Ordering::Equal {
            return behavior == Ordering::Less;
        }
        let lhs_name = lhs.name.slice(string_buf);
        let rhs_name = rhs.name.slice(string_buf);
        bun_core::strings::cmp_strings_asc((), lhs_name, rhs_name)
    }

    /// Total-order comparator for `slice::sort_by`. Same key as
    /// [`is_less_than`](Self::is_less_than).
    pub fn cmp(string_buf: &[u8], lhs: &Dependency, rhs: &Dependency) -> Ordering {
        let behavior = lhs.behavior.cmp(rhs.behavior);
        if behavior != Ordering::Equal {
            return behavior;
        }
        lhs.name.slice(string_buf).cmp(rhs.name.slice(string_buf))
    }
}

// ─── npm::{Negatable, OperatingSystem, Libc, Architecture} ────────────────
// MOVE_DOWN from `bun_install::npm` so both
// `bun_resolver` (package.json `os`/`cpu` arrays) and `bun_install` (manifest
// parsing, lockfile serialization) name the SAME bit-layout. The bit positions
// are load-bearing — they round-trip through `bun.lock` and the npm manifest
// cache; the bit values start at `1 << 1` (bit 0 is never set).

/// Common shape of [`OperatingSystem`]/[`Architecture`]/[`Libc`].
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
    /// Length-gated exact match.
    fn lookup_name(key: &[u8]) -> Option<Self::Int>;
    fn name_map_kvs() -> &'static [(&'static [u8], Self::Int)];
    fn has(self, other: Self::Int) -> bool;
    fn to_raw(self) -> Self::Int;
    fn from_raw(n: Self::Int) -> Self;
}

/// Accumulates an `os`/`cpu`/`libc`
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
        let added = if self.had_wildcard {
            T::ALL_VALUE
        } else {
            self.added.to_raw()
        };
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

        let Some(field) = T::lookup_name(&str[offset..]) else {
            if !is_not {
                self.had_unrecognized_values = true;
            }
            return;
        };

        // Applying a recognised token resets `had_wildcard` /
        // `had_unrecognized_values` to their defaults, so `["any","linux"]`
        // collapses to LINUX (wildcard cleared).
        if is_not {
            *self = Self {
                added: self.added,
                removed: T::from_raw(self.removed.to_raw() | field),
                ..Default::default()
            };
        } else {
            *self = Self {
                added: T::from_raw(self.added.to_raw() | field),
                removed: self.removed,
                ..Default::default()
            };
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

/// Provided as a blanket ext so each enum doesn't repeat the constructor.
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

// ─── negatable_names! ─────────────────────────────────────────────────────
// Single source of truth for the name↔bit table of a `NegatableEnum` newtype.
//
// A hand-maintained `NAME_MAP_KVS` const + a separate lookup table per type
// would be two parallel tables with an add-a-variant-forget-the-other drift
// hazard.
//
// This macro keeps the single-source property: caller supplies ONE
// `b"name" => BIT` list (already in `(key.len asc, bytewise asc)` order — that
// order is LOAD-BEARING: `Negatable::to_json` iterates it to serialize bun.lock
// `"os"/"cpu"/"libc"` arrays, whose byte order is part of the lockfile
// output format).
// The macro then expands BOTH the inherent `NAME_MAP_KVS` const (kept inherent
// so non-trait callers like `lockfile_json_stringify_for_debugging` still
// path-qualify it) AND the full `NegatableEnum` impl, whose `lookup_name`
// delegates to a `comptime_string_map!` built from the same list (length
// dispatch + constant-length word compares).
macro_rules! negatable_names {
    ($ty:ident : $int:ty, $map:ident => [ $( $key:literal => $bit:ident ),+ $(,)? ]) => {
        bun_core::comptime_string_map! {
            static $map: $int = { $( $key => <$ty>::$bit ),+ };
        }
        impl $ty {
            pub const NAME_MAP_KVS: &'static [(&'static [u8], $int)] =
                &[ $( ($key, <$ty>::$bit) ),+ ];
        }
        impl NegatableEnum for $ty {
            type Int = $int;
            const NONE: Self = <$ty>::NONE;
            const ALL: Self = <$ty>::ALL;
            const ALL_VALUE: $int = <$ty>::ALL_VALUE;
            #[inline]
            fn lookup_name(key: &[u8]) -> Option<$int> {
                $map.get(key).copied()
            }
            #[inline] fn name_map_kvs() -> &'static [(&'static [u8], $int)] { <$ty>::NAME_MAP_KVS }
            #[inline] fn has(self, other: $int) -> bool { <$ty>::has(self, other) }
            #[inline] fn to_raw(self) -> $int { self.0 }
            #[inline] fn from_raw(n: $int) -> Self { Self(n) }
        }
    };
}

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

    // NB: NODE not NPM — package.json `os` field uses process.platform values
    // ("win32").
    pub const CURRENT_NAME: &'static str = bun_core::env::OS_NAME_NODE;

    #[inline]
    pub const fn none() -> Self {
        Self::NONE
    }
    #[inline]
    pub const fn all() -> Self {
        Self::ALL
    }
    #[inline]
    pub fn is_match(self, target: Self) -> bool {
        (self.0 & target.0) != 0
    }
    #[inline]
    pub fn has(self, other: u16) -> bool {
        (self.0 & other) != 0
    }
    #[inline]
    pub fn negatable(self) -> Negatable<Self> {
        NegatableExt::negatable(self)
    }
}

negatable_names! { OperatingSystem: u16, OPERATING_SYSTEM_NAMES => [
    b"aix" => AIX, b"linux" => LINUX, b"sunos" => SUNOS, b"win32" => WIN32,
    b"darwin" => DARWIN, b"android" => ANDROID, b"freebsd" => FREEBSD, b"openbsd" => OPENBSD,
] }

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

    // TODO: runtime libc detection
    pub const CURRENT: Self = Self(Self::GLIBC);

    #[inline]
    pub const fn none() -> Self {
        Self::NONE
    }
    #[inline]
    pub const fn all() -> Self {
        Self::ALL
    }
    #[inline]
    pub fn is_match(self, target: Self) -> bool {
        (self.0 & target.0) != 0
    }
    #[inline]
    pub fn has(self, other: u8) -> bool {
        (self.0 & other) != 0
    }
    #[inline]
    pub fn negatable(self) -> Negatable<Self> {
        NegatableExt::negatable(self)
    }
}

negatable_names! { Libc: u8, LIBC_NAMES => [ b"musl" => MUSL, b"glibc" => GLIBC ] }

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

    #[inline]
    pub const fn none() -> Self {
        Self::NONE
    }
    #[inline]
    pub const fn all() -> Self {
        Self::ALL
    }
    #[inline]
    pub fn is_match(self, target: Self) -> bool {
        (self.0 & target.0) != 0
    }
    #[inline]
    pub fn has(self, other: u16) -> bool {
        (self.0 & other) != 0
    }
    #[inline]
    pub fn negatable(self) -> Negatable<Self> {
        NegatableExt::negatable(self)
    }
}

negatable_names! { Architecture: u16, ARCHITECTURE_NAMES => [
    b"arm" => ARM, b"ppc" => PPC, b"x32" => X32, b"x64" => X64,
    b"ia32" => IA32, b"mips" => MIPS, b"s390" => S390,
    b"arm64" => ARM64, b"ppc64" => PPC64, b"s390x" => S390X, b"mipsel" => MIPSEL,
] }

// ─── Repository (data) ────────────────────────────────────────────────────
// MOVE_DOWN from `bun_install::repository` — the on-disk lockfile shape
// (`extern struct` of five `Semver.String` handles). Install-tier behaviour
// (git CLI exec, parse, fmt, download/checkout) stays in
// `bun_install::repository::RepositoryExt`; only data + buffer-relative
// comparators live here so [`ResolutionValue`] / [`DependencyVersionValue`]
// name a real type instead of an opaque blob.

#[repr(C)]
#[derive(Copy, Default)]
pub struct Repository {
    pub owner: SemverString,
    pub repo: SemverString,
    pub committish: SemverString,
    pub resolved: SemverString,
    pub package_name: SemverString,
}

// Manual `Clone` so the inherent buffer-relative `clone(&self, buf, builder)`
// below does not collide with a derived `clone(&self)` at method-resolution
// time for the 2-arg call sites in `bun_install::resolution`.
impl Clone for Repository {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}

impl Repository {
    pub fn order(&self, rhs: &Repository, lhs_buf: &[u8], rhs_buf: &[u8]) -> Ordering {
        let owner_order = self.owner.order(rhs.owner, lhs_buf, rhs_buf);
        if owner_order != Ordering::Equal {
            return owner_order;
        }
        let repo_order = self.repo.order(rhs.repo, lhs_buf, rhs_buf);
        if repo_order != Ordering::Equal {
            return repo_order;
        }
        self.committish.order(rhs.committish, lhs_buf, rhs_buf)
    }

    pub fn count<B: bun_semver::StringBuilder>(&self, buf: &[u8], builder: &mut B) {
        builder.count(self.owner.slice(buf));
        builder.count(self.repo.slice(buf));
        builder.count(self.committish.slice(buf));
        builder.count(self.resolved.slice(buf));
        builder.count(self.package_name.slice(buf));
    }

    /// Re-interns each field
    /// into `builder`. Named `clone` so existing `repo.clone(buf, builder)`
    /// call sites resolve; bitwise copy goes through `Copy`/`*repo`.
    pub fn clone<B: bun_semver::StringBuilder>(&self, buf: &[u8], builder: &mut B) -> Repository {
        Repository {
            owner: builder.append::<SemverString>(self.owner.slice(buf)),
            repo: builder.append::<SemverString>(self.repo.slice(buf)),
            committish: builder.append::<SemverString>(self.committish.slice(buf)),
            resolved: builder.append::<SemverString>(self.resolved.slice(buf)),
            package_name: builder.append::<SemverString>(self.package_name.slice(buf)),
        }
    }

    pub fn eql(&self, rhs: &Repository, lhs_buf: &[u8], rhs_buf: &[u8]) -> bool {
        if !self.owner.eql(rhs.owner, lhs_buf, rhs_buf) {
            return false;
        }
        if !self.repo.eql(rhs.repo, lhs_buf, rhs_buf) {
            return false;
        }
        if self.resolved.is_empty() || rhs.resolved.is_empty() {
            return self.committish.eql(rhs.committish, lhs_buf, rhs_buf);
        }
        self.resolved.eql(rhs.resolved, lhs_buf, rhs_buf)
    }
}

// ─── VersionedURL ─────────────────────────────────────────────────────────
// Lives here so `bun_install::resolution::Value`
// can name the `npm` arm's payload without an upward edge.

pub type VersionedURL = VersionedURLType<u64>;
pub type OldV2VersionedURL = VersionedURLType<u32>;

#[repr(C)]
pub struct VersionedURLType<SemverInt: bun_semver::version::VersionInt> {
    pub url: SemverString,
    pub version: bun_semver::VersionType<SemverInt>,
}

// Manual `Copy`/`Clone` so the inherent buffer-relative `clone(&self, buf,
// builder)` below does not collide with a derived `clone(&self)` at
// method-resolution time, and to avoid the spurious `SemverInt: Copy` bound
// `#[derive]` would add (it is `Copy` via `VersionInt`, but the derive macro
// can't see through the trait bound).
impl<SemverInt: bun_semver::version::VersionInt> Copy for VersionedURLType<SemverInt> {}
impl<SemverInt: bun_semver::version::VersionInt> Clone for VersionedURLType<SemverInt> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<SemverInt: bun_semver::version::VersionInt> Default for VersionedURLType<SemverInt> {
    #[inline]
    fn default() -> Self {
        Self {
            url: SemverString::default(),
            version: bun_semver::VersionType::default(),
        }
    }
}

impl<SemverInt: bun_semver::version::VersionInt> VersionedURLType<SemverInt> {
    #[inline]
    pub fn eql(&self, other: &Self) -> bool {
        self.version.eql(other.version)
    }

    #[inline]
    pub fn order(&self, other: &Self, lhs_buf: &[u8], rhs_buf: &[u8]) -> core::cmp::Ordering {
        self.version.order(other.version, lhs_buf, rhs_buf)
    }

    pub fn count<B: bun_semver::StringBuilder>(&self, buf: &[u8], builder: &mut B) {
        self.version.count(buf, builder);
        builder.count(self.url.slice(buf));
    }

    pub fn clone<B: bun_semver::StringBuilder>(&self, buf: &[u8], builder: &mut B) -> Self {
        Self {
            version: self.version.append(buf, builder),
            url: builder.append::<SemverString>(self.url.slice(buf)),
        }
    }
}

impl VersionedURLType<u32> {
    #[inline]
    pub fn migrate(self) -> VersionedURLType<u64> {
        VersionedURLType {
            url: self.url,
            version: self.version.migrate(),
        }
    }
}

// ─── Resolution ───────────────────────────────────────────────────────────

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

/// Every
/// payload is `()`, a `Semver.String` handle, a [`Repository`], or a
/// [`VersionedURLType`] — all lower-tier `bun_semver` data, so the real union
/// lives here (not an opaque `[u64; N]`). `bun_install::resolution` re-exports
/// this and wraps it with constructors/formatters.
#[repr(C)]
#[derive(Clone, Copy)]
pub union ResolutionValue<I: VersionInt> {
    pub uninitialized: (),
    pub root: (),
    pub npm: VersionedURLType<I>,
    pub folder: SemverString,
    pub local_tarball: SemverString,
    pub github: Repository,
    pub git: Repository,
    pub symlink: SemverString,
    pub workspace: SemverString,
    pub remote_tarball: SemverString,
    pub single_file_module: SemverString,
}

impl<I: VersionInt> Default for ResolutionValue<I> {
    #[inline]
    fn default() -> Self {
        ResolutionValue { uninitialized: () }
    }
}

/// Layout is `{ tag: u8, _pad: [7]u8, value: Value }` so the on-disk lockfile
/// encoding stays byte-compatible.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Resolution {
    pub tag: ResolutionTag,
    pub _padding: [u8; 7],
    pub value: ResolutionValue<u64>,
}

impl Default for Resolution {
    #[inline]
    fn default() -> Self {
        Self {
            tag: ResolutionTag::Uninitialized,
            _padding: [0; 7],
            value: ResolutionValue { uninitialized: () },
        }
    }
}

impl Resolution {
    pub const ROOT: Self = Self {
        tag: ResolutionTag::Root,
        _padding: [0; 7],
        value: ResolutionValue { root: () },
    };
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
    #[inline]
    pub const fn main() -> Self {
        Self::MAIN
    }
    #[inline]
    pub const fn npm() -> Self {
        Self::NPM
    }
    #[inline]
    pub const fn folder() -> Self {
        Self::FOLDER
    }
    #[inline]
    pub const fn workspace() -> Self {
        Self::WORKSPACE
    }
    #[inline]
    pub const fn link() -> Self {
        Self::LINK
    }
    #[inline]
    pub const fn tarball() -> Self {
        Self::TARBALL
    }

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

bun_opaque::opaque_ffi! {
    /// The JS module-loader queue (`bun_jsc::AsyncModule::Queue`) that wants
    /// waking. Opaque here: this carrier crate sits below both `bun_install`
    /// (PackageManager) and `bun_jsc` (Queue).
    pub struct WakeHandlerOwner;
}

// Bodies live in `bun_jsc::AsyncModule` next to `Queue`, the single owner type.
unsafe extern "Rust" {
    /// Nudge the JS event loop from a resolver network task. `package_manager`
    /// stays erased and is forwarded verbatim, never dereferenced here.
    ///
    /// May be called from thread-pool / HTTP-callback threads.
    fn __bun_wake_handler_wake(owner: NonNull<WakeHandlerOwner>, package_manager: *mut c_void);
    /// Report a dependency resolution failure to the module-loader queue.
    fn __bun_wake_handler_on_dependency_error(
        owner: NonNull<WakeHandlerOwner>,
        dep: &Dependency,
        id: DependencyID,
        err: bun_core::Error,
    );
}

#[derive(Default, Copy, Clone)]
pub struct WakeHandler(pub Option<NonNull<WakeHandlerOwner>>);

impl WakeHandler {
    #[inline]
    pub fn is_set(self) -> bool {
        self.0.is_some()
    }

    /// `package_manager` is forwarded to the registered handler verbatim and
    /// never dereferenced here.
    #[inline]
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn wake(self, package_manager: *mut c_void) {
        if let Some(owner) = self.0 {
            // SAFETY: `owner` is the live `Queue` registered by the producer
            // (owner outlives the handler registration).
            unsafe { __bun_wake_handler_wake(owner, package_manager) }
        }
    }

    #[inline]
    pub fn on_dependency_error(self, dep: &Dependency, id: DependencyID, err: bun_core::Error) {
        if let Some(owner) = self.0 {
            // SAFETY: same owner-liveness contract as `wake`.
            unsafe { __bun_wake_handler_on_dependency_error(owner, dep, id, err) }
        }
    }
}

// ─── DependencyGroup (lockfile::Package::DependencyGroup) ─────────────────
//
// Canonical {package.json key, snake_case field, Behavior bit} triple for the
// four dependency sections. Callers that iterate sections build their OWN
// ordered slice from the named constants below — there is intentionally no
// single `ALL` array because iteration order is load-bearing and diverges per
// caller (PackageJSONEditor precedence ≠ migration.rs scan order ≠ `bun pack`
// edit order). `FOUR` is provided only as an *unordered set* for callers that
// genuinely do not care about precedence.

#[derive(Clone, Copy)]
pub struct DependencyGroup {
    pub prop: &'static [u8],
    pub field: &'static [u8],
    pub behavior: Behavior,
}
impl DependencyGroup {
    pub const DEPENDENCIES: Self = Self {
        prop: b"dependencies",
        field: b"dependencies",
        behavior: Behavior::PROD,
    };
    pub const DEV: Self = Self {
        prop: b"devDependencies",
        field: b"dev_dependencies",
        behavior: Behavior::DEV,
    };
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
    pub const WORKSPACES: Self = Self {
        prop: b"workspaces",
        field: b"workspaces",
        behavior: Behavior::WORKSPACE,
    };

    /// Unordered set of the four package.json dependency sections. Use the
    /// named constants and build your own ordered array when iteration order
    /// matters (it usually does — see module comment).
    pub const FOUR: [Self; 4] = [Self::DEPENDENCIES, Self::DEV, Self::OPTIONAL, Self::PEER];

    /// Reverse map a [`Behavior`] back to the package.json section key. Tests
    /// dev → optional → peer → prod; falls through to `"dependencies"` for
    /// PROD/WORKSPACE/BUNDLED/empty.
    #[inline]
    pub fn prop_for_behavior(b: Behavior) -> &'static [u8] {
        if b.is_dev() {
            Self::DEV.prop
        } else if b.is_optional() {
            Self::OPTIONAL.prop
        } else if b.is_peer() {
            Self::PEER.prop
        } else {
            Self::DEPENDENCIES.prop
        }
    }

    /// Exact-match a package.json section key back to its group.
    #[inline]
    pub fn from_prop(prop: &[u8]) -> Option<Self> {
        match prop {
            b"dependencies" => Some(Self::DEPENDENCIES),
            b"devDependencies" => Some(Self::DEV),
            b"optionalDependencies" => Some(Self::OPTIONAL),
            b"peerDependencies" => Some(Self::PEER),
            _ => None,
        }
    }
}

// ─── EnqueueResult ────────────────────────────────────────────────────────

pub enum EnqueueResult {
    Resolution {
        package_id: PackageID,
        resolution: Resolution,
    },
    Pending(DependencyID),
    NotFound,
    Failure(bun_core::Error),
}

// ─── PackageManager link surface ──────────────────────────────────────────

bun_opaque::opaque_ffi! {
    /// The process-static `bun_install::PackageManager` singleton, opaque
    /// here because this carrier crate sits below `bun_install`. Only ever
    /// observed by pointer; obtained from the `bun_package_manager_init`
    /// link fn (declared in `bun_resolver`) and dispatched through
    /// [`PackageManagerRef`].
    pub struct PackageManagerHandle;
}

// Everything `bun_resolver`'s auto-install path needs from
// `bun_install::PackageManager` + its `Lockfile`. Bodies live in
// `bun_install::auto_installer` next to the single implementation; each fn is
// the corresponding `PackageManager` operation with the receiver spelled as
// the typed opaque handle.
//
// SAFETY (caller contract, every fn): `pm` is the live handle returned by
// `bun_package_manager_init`. The read fns take `pm: &PackageManagerHandle`
// (a shared reborrow — no `&mut PackageManager` may be live for the call) and
// tie every lifetime-carrying return to that borrow; the mutating fns take
// `pm: NonNull<..>` with the caller holding exclusive access to the pointee
// for the duration of the call.
unsafe extern "Rust" {
    // ── Lockfile reads ────────────────────────────────────────────────────
    fn bun_pm_lockfile_packages_len(pm: &PackageManagerHandle) -> usize;
    fn bun_pm_lockfile_package_dependencies(
        pm: &PackageManagerHandle,
        id: PackageID,
    ) -> DependencySlice;
    fn bun_pm_lockfile_package_resolutions(
        pm: &PackageManagerHandle,
        id: PackageID,
    ) -> ResolutionSlice;
    fn bun_pm_lockfile_package_resolution(pm: &PackageManagerHandle, id: PackageID) -> Resolution;
    fn bun_pm_lockfile_dependencies_buf<'a>(pm: &'a PackageManagerHandle) -> &'a [Dependency];
    fn bun_pm_lockfile_resolutions_buf<'a>(pm: &'a PackageManagerHandle) -> &'a [PackageID];
    fn bun_pm_lockfile_string_bytes<'a>(pm: &'a PackageManagerHandle) -> &'a [u8];
    fn bun_pm_lockfile_resolve(
        pm: &PackageManagerHandle,
        name: &[u8],
        version: &DependencyVersion,
    ) -> Option<PackageID>;
    fn bun_pm_lockfile_legacy_package_to_dependency_id(
        pm: &PackageManagerHandle,
        package_id: PackageID,
    ) -> core::result::Result<DependencyID, bun_core::Error>;
    /// Project a `SemverString` into the lockfile's `string_bytes` buffer.
    /// The returned slice borrows from either the lockfile (heap buffer,
    /// via `pm`) or `s` (inline small-string); `'a` covers both.
    fn bun_pm_lockfile_str<'a>(pm: &'a PackageManagerHandle, s: &'a SemverString) -> &'a [u8];

    // ── Lockfile writes ───────────────────────────────────────────────────
    /// Port of `lockfile.appendPackage(Package.fromPackageJSON(...))` —
    /// collapsed because `Package` itself is install-internal. Returns the
    /// id assigned to the appended package.
    fn bun_pm_lockfile_append_from_package_json(
        pm: NonNull<PackageManagerHandle>,
        package_json: PackageJsonRef<'_>,
        features: Features,
    ) -> core::result::Result<PackageID, bun_core::Error>;
    fn bun_pm_lockfile_append_root_stub(
        pm: NonNull<PackageManagerHandle>,
    ) -> core::result::Result<PackageID, bun_core::Error>;

    // ── PackageManager ops ────────────────────────────────────────────────
    fn bun_pm_set_on_wake(pm: NonNull<PackageManagerHandle>, handler: WakeHandler);
    fn bun_pm_path_for_resolution<'b>(
        pm: NonNull<PackageManagerHandle>,
        package_id: PackageID,
        resolution: &Resolution,
        buf: &'b mut [u8],
    ) -> core::result::Result<&'b [u8], bun_core::Error>;
    fn bun_pm_get_preinstall_state(
        pm: &PackageManagerHandle,
        package_id: PackageID,
    ) -> PreinstallState;
    fn bun_pm_enqueue_package_for_download(
        pm: NonNull<PackageManagerHandle>,
        name: &[u8],
        dependency_id: DependencyID,
        package_id: PackageID,
        resolution: &Resolution,
        ctx: TaskCallbackContext,
        patch_name_and_version_hash: Option<u64>,
    ) -> core::result::Result<(), bun_core::Error>;
    fn bun_pm_resolve_from_disk_cache(
        pm: NonNull<PackageManagerHandle>,
        name: &[u8],
        version: &DependencyVersion,
    ) -> Option<PackageID>;
    fn bun_pm_enqueue_dependency_to_root(
        pm: NonNull<PackageManagerHandle>,
        name: &[u8],
        version: &DependencyVersion,
        version_buf: &[u8],
        behavior: Behavior,
    ) -> EnqueueResult;

    // ── Dependency parsing ────────────────────────────────────────────────
    // `parse_with_tag` records `npm:`-aliased deps into
    // `pm.known_npm_aliases`, so parsing takes the (mutable) manager handle
    // even though it is otherwise pure.
    fn bun_pm_parse_dependency(
        pm: NonNull<PackageManagerHandle>,
        name: SemverString,
        name_hash: Option<u64>,
        version: &[u8],
        sliced: &bun_semver::SlicedString,
        log: Option<&mut bun_ast::Log>,
    ) -> Option<DependencyVersion>;
    fn bun_pm_parse_dependency_with_tag(
        pm: NonNull<PackageManagerHandle>,
        name: SemverString,
        name_hash: u64,
        version: &[u8],
        tag: DependencyVersionTag,
        sliced: &bun_semver::SlicedString,
        log: Option<&mut bun_ast::Log>,
    ) -> Option<DependencyVersion>;
    /// Pure string classification, but the table lives in `bun_install`.
    fn bun_pm_infer_dependency_tag(
        pm: &PackageManagerHandle,
        dependency: &[u8],
    ) -> DependencyVersionTag;
}

/// Copyable typed handle to the auto-install `PackageManager` singleton.
///
/// The resolver caches the raw [`PackageManagerHandle`] pointer and calls
/// through these inherent wrappers, which forward to the `bun_pm_*` link fns
/// above. Being `Copy`, it carries no aliasing guarantee of its own — the
/// exclusivity contract lives on [`Self::from_handle`].
#[derive(Clone, Copy)]
pub struct PackageManagerRef(NonNull<PackageManagerHandle>);

// `&self` on the read accessors is deliberate: their returned borrows are
// anchored to the handle borrow (a by-value receiver would let them float).
#[allow(clippy::trivially_copy_pass_by_ref)]
impl PackageManagerRef {
    /// # Safety
    /// `pm` must be the live handle returned by `bun_package_manager_init`
    /// (the process-static `PackageManager` singleton), and no other Rust
    /// reference to the pointee may be live while methods on the returned
    /// value run.
    #[inline]
    pub unsafe fn from_handle(pm: NonNull<PackageManagerHandle>) -> Self {
        Self(pm)
    }

    /// Shared reborrow of the handle for the read-only link fns; the
    /// returned borrow (and everything the read fns derive from it) is tied
    /// to `&self`.
    #[inline]
    fn handle(&self) -> &PackageManagerHandle {
        // SAFETY: `from_handle` contract — the handle is live for `'self`.
        unsafe { self.0.as_ref() }
    }

    // ── Lockfile reads ────────────────────────────────────────────────────

    #[inline]
    pub fn lockfile_packages_len(&self) -> usize {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_lockfile_packages_len(self.handle()) }
    }

    #[inline]
    pub fn lockfile_package_dependencies(&self, id: PackageID) -> DependencySlice {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_lockfile_package_dependencies(self.handle(), id) }
    }

    #[inline]
    pub fn lockfile_package_resolutions(&self, id: PackageID) -> ResolutionSlice {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_lockfile_package_resolutions(self.handle(), id) }
    }

    #[inline]
    pub fn lockfile_package_resolution(&self, id: PackageID) -> Resolution {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_lockfile_package_resolution(self.handle(), id) }
    }

    #[inline]
    pub fn lockfile_dependencies_buf(&self) -> &[Dependency] {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_lockfile_dependencies_buf(self.handle()) }
    }

    #[inline]
    pub fn lockfile_resolutions_buf(&self) -> &[PackageID] {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_lockfile_resolutions_buf(self.handle()) }
    }

    #[inline]
    pub fn lockfile_string_bytes(&self) -> &[u8] {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_lockfile_string_bytes(self.handle()) }
    }

    #[inline]
    pub fn lockfile_resolve(&self, name: &[u8], version: &DependencyVersion) -> Option<PackageID> {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_lockfile_resolve(self.handle(), name, version) }
    }

    #[inline]
    pub fn lockfile_legacy_package_to_dependency_id(
        &self,
        package_id: PackageID,
    ) -> core::result::Result<DependencyID, bun_core::Error> {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_lockfile_legacy_package_to_dependency_id(self.handle(), package_id) }
    }

    #[inline]
    pub fn lockfile_str<'a>(&'a self, s: &'a SemverString) -> &'a [u8] {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_lockfile_str(self.handle(), s) }
    }

    // ── Lockfile writes ───────────────────────────────────────────────────

    #[inline]
    pub fn lockfile_append_from_package_json(
        self,
        package_json: PackageJsonRef<'_>,
        features: Features,
    ) -> core::result::Result<PackageID, bun_core::Error> {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_lockfile_append_from_package_json(self.0, package_json, features) }
    }

    #[inline]
    pub fn lockfile_append_root_stub(self) -> core::result::Result<PackageID, bun_core::Error> {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_lockfile_append_root_stub(self.0) }
    }

    // ── PackageManager ops ────────────────────────────────────────────────

    #[inline]
    pub fn set_on_wake(self, handler: WakeHandler) {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_set_on_wake(self.0, handler) }
    }

    #[inline]
    pub fn path_for_resolution<'b>(
        self,
        package_id: PackageID,
        resolution: &Resolution,
        buf: &'b mut [u8],
    ) -> core::result::Result<&'b [u8], bun_core::Error> {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_path_for_resolution(self.0, package_id, resolution, buf) }
    }

    #[inline]
    pub fn get_preinstall_state(&self, package_id: PackageID) -> PreinstallState {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_get_preinstall_state(self.handle(), package_id) }
    }

    #[inline]
    pub fn enqueue_package_for_download(
        self,
        name: &[u8],
        dependency_id: DependencyID,
        package_id: PackageID,
        resolution: &Resolution,
        ctx: TaskCallbackContext,
        patch_name_and_version_hash: Option<u64>,
    ) -> core::result::Result<(), bun_core::Error> {
        // SAFETY: `from_handle` contract.
        unsafe {
            bun_pm_enqueue_package_for_download(
                self.0,
                name,
                dependency_id,
                package_id,
                resolution,
                ctx,
                patch_name_and_version_hash,
            )
        }
    }

    #[inline]
    pub fn resolve_from_disk_cache(
        self,
        name: &[u8],
        version: &DependencyVersion,
    ) -> Option<PackageID> {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_resolve_from_disk_cache(self.0, name, version) }
    }

    #[inline]
    pub fn enqueue_dependency_to_root(
        self,
        name: &[u8],
        version: &DependencyVersion,
        version_buf: &[u8],
        behavior: Behavior,
    ) -> EnqueueResult {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_enqueue_dependency_to_root(self.0, name, version, version_buf, behavior) }
    }

    // ── Dependency parsing ────────────────────────────────────────────────

    #[inline]
    pub fn parse_dependency(
        self,
        name: SemverString,
        name_hash: Option<u64>,
        version: &[u8],
        sliced: &bun_semver::SlicedString,
        log: Option<&mut bun_ast::Log>,
    ) -> Option<DependencyVersion> {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_parse_dependency(self.0, name, name_hash, version, sliced, log) }
    }

    #[inline]
    pub fn parse_dependency_with_tag(
        self,
        name: SemverString,
        name_hash: u64,
        version: &[u8],
        tag: DependencyVersionTag,
        sliced: &bun_semver::SlicedString,
        log: Option<&mut bun_ast::Log>,
    ) -> Option<DependencyVersion> {
        // SAFETY: `from_handle` contract.
        unsafe {
            bun_pm_parse_dependency_with_tag(self.0, name, name_hash, version, tag, sliced, log)
        }
    }

    #[inline]
    pub fn infer_dependency_tag(&self, dependency: &[u8]) -> DependencyVersionTag {
        // SAFETY: `from_handle` contract.
        unsafe { bun_pm_infer_dependency_tag(self.handle(), dependency) }
    }
}

/// Borrowed install-side view of `bun_resolver::package_json::PackageJSON`,
/// built by `PackageJSON::as_install_ref()` at the auto-install call site.
#[derive(Clone, Copy)]
pub struct PackageJsonRef<'a> {
    pub name: &'a [u8],
    pub version: &'a [u8],
    pub arch: Architecture,
    pub os: OperatingSystem,
    /// Backing string-bytes buffer the dependency `SemverString`s slice into.
    pub dependency_source_buf: &'a [u8],
    pub dependencies: &'a bun_collections::ArrayHashMap<SemverString, Dependency>,
}
