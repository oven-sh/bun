use core::cmp::Ordering;
use core::mem::ManuallyDrop;

use bun_paths::strings;
use bun_semver as Semver;
use bun_semver::{SlicedString, String};

use crate::hosted_git_info;
use crate::repository::Repository;
use crate::{Features, PackageManager, PackageNameHash};

// ──────────────────────────────────────────────────────────────────────────
// NpmAliasRegistry — exposes only the one `PackageManager` method `parse`
// actually touches (`known_npm_aliases.put`) so `parse_with_tag` can take an
// `Option<&mut dyn NpmAliasRegistry>` and stay decoupled from the full
// `PackageManager` surface (Zig threads `*PackageManager` directly).
// ──────────────────────────────────────────────────────────────────────────

pub trait NpmAliasRegistry {
    fn record_npm_alias(&mut self, hash: PackageNameHash, version: &Version);
}

impl NpmAliasRegistry for PackageManager {
    #[inline]
    fn record_npm_alias(&mut self, hash: PackageNameHash, version: &Version) {
        // Zig: `pm.known_npm_aliases.put(hash, result)`.
        self.known_npm_aliases.insert(hash, Clone::clone(version));
    }
}

/// Field-level impl so callers that have already split-borrowed
/// `PackageManager` (e.g. they hold `&mut manager.lockfile` for a
/// `StringBuilder`) can pass `&mut manager.known_npm_aliases` directly to
/// `Dependency::clone_in` / `OverrideMap::clone` instead of a full
/// `&mut PackageManager`.
impl NpmAliasRegistry for crate::package_manager_real::NpmAliasMap {
    #[inline]
    fn record_npm_alias(&mut self, hash: PackageNameHash, version: &Version) {
        self.insert(hash, Clone::clone(version));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// URI
// ──────────────────────────────────────────────────────────────────────────

// MOVE_DOWN: data structs (`URI`, `NpmInfo`, `TagInfo`, `TarballInfo`,
// `Value`, `Version`, `Dependency`, `Behavior`) and their `Default`/`Clone`/
// `eql` impls now live in `bun_install_types::resolver_hooks` so the resolver
// and `bun_install` share ONE definition (no opaque round-trip blob).
// Install-tier behaviour (parsing, builder-clone, comparators, JSON, ...) is
// provided below as extension traits so existing `Type::method(...)` /
// `value.method(...)` call sites resolve via UFCS once the trait is in scope.
pub use bun_install_types::resolver_hooks::{
    Behavior, Dependency, DependencyVersion as Version, DependencyVersionTag as Tag,
    DependencyVersionValue as Value, NpmInfo, TagInfo, TarballInfo, URI,
};

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum URITag {
    Local,
    Remote,
}

// ──────────────────────────────────────────────────────────────────────────
// Dependency
// ──────────────────────────────────────────────────────────────────────────

pub trait DependencyExt {
    fn is_tarball(dependency: &[u8]) -> bool;
    fn split_name_and_maybe_version(str: &[u8]) -> (&[u8], Option<&[u8]>);
    fn unscoped_package_name(name: &[u8]) -> &[u8];
    fn parse_with_optional_tag<'a, 'b>(
        alias: String,
        alias_hash: impl Into<Option<PackageNameHash>>,
        dependency: &[u8],
        tag: Option<version::Tag>,
        sliced: &SlicedString,
        log: impl Into<Option<&'a mut bun_ast::Log>>,
        package_manager: impl Into<Option<&'b mut PackageManager>>,
    ) -> Option<Version>;
    fn is_less_than(string_buf: &[u8], lhs: &Dependency, rhs: &Dependency) -> bool;
    fn cmp(string_buf: &[u8], lhs: &Dependency, rhs: &Dependency) -> Ordering;
    fn count_with_different_buffers<SB: StringBuilderLike>(
        &self,
        name_buf: &[u8],
        version_buf: &[u8],
        builder: &mut SB,
    );
    fn count<SB: StringBuilderLike>(&self, buf: &[u8], builder: &mut SB);
    fn clone_in<SB: StringBuilderLike, PM: NpmAliasRegistry>(
        &self,
        package_manager: &mut PM,
        buf: &[u8],
        builder: &mut SB,
    ) -> Result<Dependency, bun_core::Error>;
    fn clone_with_different_buffers<SB: StringBuilderLike, PM: NpmAliasRegistry>(
        &self,
        package_manager: &mut PM,
        name_buf: &[u8],
        version_buf: &[u8],
        builder: &mut SB,
    ) -> Result<Dependency, bun_core::Error>;
    fn realname(&self) -> String;
    fn is_aliased(&self, buf: &[u8]) -> bool;
    fn eql(&self, b: &Dependency, lhs_buf: &[u8], rhs_buf: &[u8]) -> bool;
    fn is_remote_tarball(dep: &[u8]) -> bool;
    fn parse<'a, 'b>(
        alias: String,
        alias_hash: impl Into<Option<PackageNameHash>>,
        dependency: &[u8],
        sliced: &SlicedString,
        log: impl Into<Option<&'a mut bun_ast::Log>>,
        manager: impl Into<Option<&'b mut PackageManager>>,
    ) -> Option<Version>;
}

impl DependencyExt for Dependency {
    /// Forwards to the module-level `is_tarball` (Zig: `Dependency.isTarball`).
    #[inline]
    fn is_tarball(dependency: &[u8]) -> bool {
        is_tarball(dependency)
    }

    /// Forwards to the module-level free fn (Zig file-struct method:
    /// `Dependency.splitNameAndMaybeVersion`).
    #[inline]
    fn split_name_and_maybe_version(str: &[u8]) -> (&[u8], Option<&[u8]>) {
        split_name_and_maybe_version(str)
    }

    /// Zig: `Dependency.unscopedPackageName`. Strips a leading `@scope/` if present.
    fn unscoped_package_name(name: &[u8]) -> &[u8] {
        if name.is_empty() || name[0] != b'@' {
            return name;
        }
        let name_ = &name[1..];
        match bun_core::index_of_char(name_, b'/') {
            Some(i) => &name_[i as usize + 1..],
            None => name,
        }
    }

    /// Forwards to the module-level `parse_with_optional_tag`
    /// (Zig: `Dependency.parseWithOptionalTag`).
    ///
    /// `alias_hash`, `log`, and `package_manager` accept either the bare value
    /// (`u64` / `&mut Log` / `&mut PackageManager`) or `Option<_>` — Zig callers
    /// pass both forms (`null` vs pointer) and the port keeps that ergonomics
    /// via `impl Into<Option<_>>`.
    #[inline]
    fn parse_with_optional_tag<'a, 'b>(
        alias: String,
        alias_hash: impl Into<Option<PackageNameHash>>,
        dependency: &[u8],
        tag: Option<version::Tag>,
        sliced: &SlicedString,
        log: impl Into<Option<&'a mut bun_ast::Log>>,
        package_manager: impl Into<Option<&'b mut PackageManager>>,
    ) -> Option<Version> {
        parse_with_optional_tag(
            alias,
            alias_hash,
            dependency,
            tag,
            sliced,
            log,
            package_manager,
        )
    }

    /// Sorting order for dependencies is:
    /// 1. [ `peerDependencies`, `optionalDependencies`, `devDependencies`, `dependencies` ]
    /// 2. name ASC
    /// "name" must be ASC so that later, when we rebuild the lockfile
    /// we insert it back in reverse order without an extra sorting pass
    fn is_less_than(string_buf: &[u8], lhs: &Dependency, rhs: &Dependency) -> bool {
        let behavior = lhs.behavior.cmp(rhs.behavior);
        if behavior != Ordering::Equal {
            return behavior == Ordering::Less;
        }

        let lhs_name = lhs.name.slice(string_buf);
        let rhs_name = rhs.name.slice(string_buf);
        strings::cmp_strings_asc(&(), lhs_name, rhs_name)
    }

    /// Total-order comparator for `slice::sort_by` (Zig's `std.sort.pdq`
    /// accepts a strict-weak `lessThan`; Rust's sort requires a full
    /// `Ordering`). Same key as `is_less_than`: behavior group, then name ASC.
    fn cmp(string_buf: &[u8], lhs: &Dependency, rhs: &Dependency) -> Ordering {
        let behavior = lhs.behavior.cmp(rhs.behavior);
        if behavior != Ordering::Equal {
            return behavior;
        }
        lhs.name.slice(string_buf).cmp(rhs.name.slice(string_buf))
    }

    fn count_with_different_buffers<SB: StringBuilderLike>(
        &self,
        name_buf: &[u8],
        version_buf: &[u8],
        builder: &mut SB,
    ) {
        builder.count(self.name.slice(name_buf));
        builder.count(self.version.literal.slice(version_buf));
    }

    fn count<SB: StringBuilderLike>(&self, buf: &[u8], builder: &mut SB) {
        self.count_with_different_buffers(buf, buf, builder);
    }

    /// Zig: `Dependency.clone`. Renamed to `clone_in` so it doesn't shadow
    /// `std::clone::Clone::clone` (callers in `migration.rs` / `PackageManager.rs`
    /// rely on the trait method for shallow copy).
    fn clone_in<SB: StringBuilderLike, PM: NpmAliasRegistry>(
        &self,
        package_manager: &mut PM,
        buf: &[u8],
        builder: &mut SB,
    ) -> Result<Dependency, bun_core::Error> {
        // TODO(port): narrow error set
        self.clone_with_different_buffers(package_manager, buf, buf, builder)
    }

    fn clone_with_different_buffers<SB: StringBuilderLike, PM: NpmAliasRegistry>(
        &self,
        package_manager: &mut PM,
        name_buf: &[u8],
        version_buf: &[u8],
        builder: &mut SB,
    ) -> Result<Dependency, bun_core::Error> {
        // TODO(port): narrow error set
        // PORT NOTE: reshaped for borrowck — Zig captured `out_slice` first, but
        // `append_string` may reallocate `string_bytes`, invalidating the slice.
        // Append first, then borrow the (now-stable) buffer.
        let new_literal = builder.append_string(self.version.literal.slice(version_buf));
        let new_name = builder.append_string(self.name.slice(name_buf));
        let out_slice = builder.string_bytes();
        let sliced = new_literal.sliced(out_slice);

        Ok(Dependency {
            name_hash: self.name_hash,
            name: new_name,
            version: parse_with_tag(
                new_name,
                Some(Semver::string::Builder::string_hash(
                    new_name.slice(out_slice),
                )),
                new_literal.slice(out_slice),
                self.version.tag,
                &sliced,
                None,
                Some(package_manager as &mut dyn NpmAliasRegistry),
            )
            .unwrap_or_default(),
            behavior: self.behavior,
        })
    }

    /// Get the name of the package as it should appear in a remote registry.
    #[inline]
    fn realname(&self) -> String {
        match self.version.tag {
            Tag::DistTag => self.version.dist_tag().name,
            Tag::Git => self.version.git().package_name,
            Tag::Github => self.version.github().package_name,
            Tag::Npm => self.version.npm().name,
            Tag::Tarball => self.version.tarball().package_name,
            _ => self.name,
        }
    }

    #[inline]
    fn is_aliased(&self, buf: &[u8]) -> bool {
        match self.version.tag {
            Tag::Npm => !self.version.npm().name.eql(self.name, buf, buf),
            Tag::DistTag => !self.version.dist_tag().name.eql(self.name, buf, buf),
            Tag::Git => !self.version.git().package_name.eql(self.name, buf, buf),
            Tag::Github => !self.version.github().package_name.eql(self.name, buf, buf),
            Tag::Tarball => !self.version.tarball().package_name.eql(self.name, buf, buf),
            _ => false,
        }
    }

    fn eql(&self, b: &Dependency, lhs_buf: &[u8], rhs_buf: &[u8]) -> bool {
        self.name_hash == b.name_hash
            && self.name.len() == b.name.len()
            && self.version.eql(&b.version, lhs_buf, rhs_buf)
    }
    #[inline]
    fn is_remote_tarball(dep: &[u8]) -> bool {
        is_remote_tarball(dep)
    }

    /// Stub-compat: B-1 stub exposed `Dependency::parse` as an associated fn;
    /// real port has it as a free fn. Delegate so downstream callers
    /// (`bun_install_jsc`) keep type-checking.
    ///
    /// `alias_hash`, `log`, and `manager` accept either bare values or
    /// `Option<_>` (Zig callers pass both `null` and concrete pointers).
    #[inline]
    fn parse<'a, 'b>(
        alias: String,
        alias_hash: impl Into<Option<PackageNameHash>>,
        dependency: &[u8],
        sliced: &SlicedString,
        log: impl Into<Option<&'a mut bun_ast::Log>>,
        manager: impl Into<Option<&'b mut PackageManager>>,
    ) -> Option<Version> {
        parse(alias, alias_hash, dependency, sliced, log, manager)
    }
}

// PORT NOTE: Zig copies `Dependency`/`Version` by value (POD struct semantics);
// the linked-list memory under `Semver::query::Group` is arena-owned and never
// freed through these handles. Rust can't `derive(Clone)` because `Value` is
// an untagged union with `ManuallyDrop` fields, so we implement a shallow
// bitwise clone matching Zig's copy semantics.

// `comptime StringBuilder: type` param maps onto `bun_semver::StringBuilder`
// (count / append<T> / append_string). The only extra method needed here is
// access to the FULL backing buffer (Zig: `builder.lockfile.buffers
// .string_bytes.items`), which is intentionally NOT on the base trait since
// `semver_string::Builder`'s isolated Box<[u8]> would be wrong for callers
// that need the lockfile's full string_bytes.
pub trait StringBuilderLike: bun_semver::StringBuilder {
    /// Full backing string buffer (Zig: `builder.lockfile.buffers.string_bytes.items`).
    fn string_bytes(&self) -> &[u8];
}

// PORT NOTE: single-impl monomorphization is intentional. Every Zig call site
// of `Dependency.count`/`clone`/`*WithDifferentBuffers` passes
// `*Lockfile.StringBuilder` (Package.zig, OverrideMap.zig, CatalogMap.zig,
// install_with_manager.zig) — `semver_string::Builder` is never used here, and
// its isolated Box<[u8]> can't satisfy `builder.lockfile.buffers.string_bytes`.
impl<'a> StringBuilderLike for crate::lockfile_real::StringBuilder<'a> {
    #[inline]
    fn string_bytes(&self) -> &[u8] {
        self.string_bytes.as_slice()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// External serialization
// ──────────────────────────────────────────────────────────────────────────

pub type External = [u8; SIZE];

const SIZE: usize = core::mem::size_of::<VersionExternal>()
    + core::mem::size_of::<PackageNameHash>()
    + core::mem::size_of::<Behavior>()
    + core::mem::size_of::<String>();

pub struct Context<'a> {
    // allocator dropped (global mimalloc)
    pub log: &'a mut bun_ast::Log,
    pub buffer: &'a [u8],
    pub package_manager: Option<&'a mut PackageManager>,
}

pub fn to_dependency(this: External, ctx: &mut Context<'_>) -> Dependency {
    let name = String {
        bytes: this[0..8].try_into().expect("infallible: size matches"),
    };
    // SAFETY: same-size POD bitcast
    let name_hash: u64 =
        u64::from_ne_bytes(this[8..16].try_into().expect("infallible: size matches"));
    Dependency {
        name,
        name_hash,
        behavior: Behavior::from_bits_retain(this[16]),
        version: Version::to_version(
            name,
            name_hash,
            this[17..SIZE].try_into().expect("infallible: size matches"),
            ctx,
        ),
    }
}

pub fn to_external(this: &Dependency) -> External {
    let mut bytes: External = [0u8; SIZE];
    bytes[0..8].copy_from_slice(&this.name.bytes);
    bytes[8..16].copy_from_slice(&this.name_hash.to_ne_bytes());
    bytes[16] = this.behavior.bits();
    bytes[17..SIZE].copy_from_slice(&this.version.to_external());
    bytes
}

// ──────────────────────────────────────────────────────────────────────────
// Path / specifier classifiers
// ──────────────────────────────────────────────────────────────────────────

#[inline]
pub fn is_scp_like_path(dependency: &[u8]) -> bool {
    // Shortest valid expression: h:p
    if dependency.len() < 3 {
        return false;
    }

    let mut at_index: Option<usize> = None;

    for (i, &c) in dependency.iter().enumerate() {
        match c {
            b'@' => {
                if at_index.is_none() {
                    at_index = Some(i);
                }
            }
            b':' => {
                if dependency[i..].starts_with(b"://") {
                    return false;
                }
                return i > if let Some(index) = at_index {
                    index + 1
                } else {
                    0
                };
            }
            b'/' => {
                return if let Some(index) = at_index {
                    i > index + 1
                } else {
                    false
                };
            }
            _ => {}
        }
    }

    false
}

/// Github allows for the following format of URL:
/// https://github.com/<org>/<repo>/tarball/<ref>
/// This is a legacy (but still supported) method of retrieving a tarball of an
/// entire source tree at some git reference. (ref = branch, tag, etc. Note: branch
/// can have arbitrary number of slashes)
///
/// This also checks for a github url that ends with ".tar.gz"
#[inline]
pub fn is_github_tarball_path(dependency: &[u8]) -> bool {
    if is_tarball(dependency) {
        return true;
    }

    let mut parts = strings::split(dependency, b"/");

    let mut n_parts: usize = 0;

    while let Some(part) = parts.next() {
        n_parts += 1;
        if n_parts == 3 {
            return part == b"tarball";
        }
    }

    false
}

// This won't work for query string params, but I'll let someone file an issue
// before I add that.
#[inline]
pub fn is_tarball(dependency: &[u8]) -> bool {
    dependency.ends_with(b".tgz") || dependency.ends_with(b".tar.gz")
}

/// the input is assumed to be either a remote or local tarball
#[inline]
pub fn is_remote_tarball(dependency: &[u8]) -> bool {
    dependency.starts_with(b"https://") || dependency.starts_with(b"http://")
}

// ──────────────────────────────────────────────────────────────────────────
// Stub-compat aliases: B-1 stub exposed `dependency::version::Tag`,
// `dependency::VersionTag`, `Dependency::is_remote_tarball`, and a `tarball`
// submodule. Real Zig nests `Tag` under `Dependency.Version`, but Phase-A
// flattened to top-level — keep both paths so dependents type-check.
// ──────────────────────────────────────────────────────────────────────────
pub use Tag as VersionTag;
pub mod version {
    pub use super::Tag;
}
pub mod tarball {
    pub use super::{TarballInfo, URI as Uri};
}

pub fn split_version_and_maybe_name(str: &[u8]) -> (&[u8], Option<&[u8]>) {
    if let Some(at_index) = strings::index_of_char(str, b'@') {
        let at_index = at_index as usize;
        if at_index != 0 {
            return (&str[at_index + 1..], Some(&str[0..at_index]));
        }

        let Some(second) = strings::index_of_char(&str[1..], b'@') else {
            return (str, None);
        };
        let second_at_index = second as usize + 1;

        return (&str[second_at_index + 1..], Some(&str[0..second_at_index]));
    }

    (str, None)
}

/// Turns `foo@1.1.1` into `foo`, `1.1.1`, or `@foo/bar@1.1.1` into `@foo/bar`, `1.1.1`, or `foo` into `foo`, `null`.
pub fn split_name_and_maybe_version(str: &[u8]) -> (&[u8], Option<&[u8]>) {
    if let Some(at_index) = strings::index_of_char(str, b'@') {
        let at_index = at_index as usize;
        if at_index != 0 {
            return (
                &str[0..at_index],
                if at_index + 1 < str.len() {
                    Some(&str[at_index + 1..])
                } else {
                    None
                },
            );
        }

        let Some(second) = strings::index_of_char(&str[1..], b'@') else {
            return (str, None);
        };
        let second_at_index = second as usize + 1;

        return (
            &str[0..second_at_index],
            if second_at_index + 1 < str.len() {
                Some(&str[second_at_index + 1..])
            } else {
                None
            },
        );
    }

    (str, None)
}

pub fn split_name_and_version_or_latest(str: &[u8]) -> (&[u8], &[u8]) {
    let (name, version) = split_name_and_maybe_version(str);
    (name, version.unwrap_or(b"latest"))
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum SplitNameError {
    #[error("MissingVersion")]
    MissingVersion,
}

pub fn split_name_and_version(str: &[u8]) -> Result<(&[u8], &[u8]), SplitNameError> {
    let (name, version) = split_name_and_maybe_version(str);
    Ok((name, version.ok_or(SplitNameError::MissingVersion)?))
}

pub fn unscoped_package_name(name: &[u8]) -> &[u8] {
    if name[0] != b'@' {
        return name;
    }
    let name_ = &name[1..];
    let Some(slash) = strings::index_of_char(name_, b'/') else {
        return name;
    };
    &name_[slash as usize + 1..]
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum PackageNameError {
    #[error("InvalidPackageName")]
    InvalidPackageName,
}

pub fn is_scoped_package_name(name: &[u8]) -> Result<bool, PackageNameError> {
    if name.is_empty() {
        return Err(PackageNameError::InvalidPackageName);
    }

    if name[0] != b'@' {
        return Ok(false);
    }

    if let Some(slash) = strings::index_of_char(name, b'/') {
        let slash = slash as usize;
        if slash != 1 && slash != name.len() - 1 {
            return Ok(true);
        }
    }

    Err(PackageNameError::InvalidPackageName)
}

/// assumes version is valid
pub fn without_build_tag(version: &[u8]) -> &[u8] {
    if let Some(plus) = strings::index_of_char(version, b'+') {
        &version[0..plus as usize]
    } else {
        version
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Version
// ──────────────────────────────────────────────────────────────────────────

pub type VersionExternal = [u8; 9];

pub trait VersionExt {
    fn zeroed() -> Version;
    fn clone_in<SB: StringBuilderLike>(
        &self,
        buf: &[u8],
        builder: &mut SB,
    ) -> Result<Version, bun_core::Error>;
    fn is_less_than(string_buf: &[u8], lhs: &Version, rhs: &Version) -> bool;
    fn is_less_than_with_tag(string_buf: &[u8], lhs: &Version, rhs: &Version) -> bool;
    fn to_version(
        alias: String,
        alias_hash: PackageNameHash,
        bytes: VersionExternal,
        ctx: &mut Context<'_>,
    ) -> Version;
    fn to_external(&self) -> VersionExternal;
    fn eql(&self, rhs: &Version, lhs_buf: &[u8], rhs_buf: &[u8]) -> bool;
}

impl VersionExt for Version {
    // Zig: `pub const zeroed = Version{};` — a const value. Rust can't const-init
    // (Default::default() isn't const), so callers should use `Version::zeroed()`
    // or `Version::default()` instead.
    #[inline]
    fn zeroed() -> Version {
        Version::default()
    }

    /// Zig: `Version.clone`. Renamed to `clone_in` so it doesn't shadow
    /// `std::clone::Clone::clone`.
    fn clone_in<SB: StringBuilderLike>(
        &self,
        buf: &[u8],
        builder: &mut SB,
    ) -> Result<Version, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(Version {
            tag: self.tag,
            literal: builder.append_string(self.literal.slice(buf)),
            // TODO(port): Value::clone not defined in this file; assumed on Value
            value: self.value.clone_in(self.tag, buf, builder)?,
        })
    }

    fn is_less_than(string_buf: &[u8], lhs: &Version, rhs: &Version) -> bool {
        debug_assert!(lhs.tag == rhs.tag);
        strings::cmp_strings_asc(
            &(),
            lhs.literal.slice(string_buf),
            rhs.literal.slice(string_buf),
        )
    }

    fn is_less_than_with_tag(string_buf: &[u8], lhs: &Version, rhs: &Version) -> bool {
        let tag_order = lhs.tag.cmp(rhs.tag);
        if tag_order != Ordering::Equal {
            return tag_order == Ordering::Less;
        }

        strings::cmp_strings_asc(
            &(),
            lhs.literal.slice(string_buf),
            rhs.literal.slice(string_buf),
        )
    }

    fn to_version(
        alias: String,
        alias_hash: PackageNameHash,
        bytes: VersionExternal,
        ctx: &mut Context<'_>,
    ) -> Version {
        let slice = String {
            bytes: bytes[1..9].try_into().expect("infallible: size matches"),
        };
        // bytes[0] was written by `to_external` from a valid `Tag`; decode by
        // exhaustive match so a corrupt lockfile byte traps instead of
        // producing an invalid discriminant.
        let tag: Tag = match bytes[0] {
            0 => Tag::Uninitialized,
            1 => Tag::Npm,
            2 => Tag::DistTag,
            3 => Tag::Tarball,
            4 => Tag::Folder,
            5 => Tag::Symlink,
            6 => Tag::Workspace,
            7 => Tag::Git,
            8 => Tag::Github,
            9 => Tag::Catalog,
            n => unreachable!("invalid Dependency.Version.Tag {n}"),
        };
        let sliced = slice.sliced(ctx.buffer);
        parse_with_tag(
            alias,
            Some(alias_hash),
            sliced.slice,
            tag,
            &sliced,
            Some(ctx.log),
            ctx.package_manager
                .as_deref_mut()
                .map(|m| m as &mut dyn NpmAliasRegistry),
        )
        .unwrap_or_default()
    }

    #[inline]
    fn to_external(&self) -> VersionExternal {
        let mut bytes: VersionExternal = [0u8; 9];
        bytes[0] = self.tag as u8;
        bytes[1..9].copy_from_slice(&self.literal.bytes);
        bytes
    }

    #[inline]
    fn eql(&self, rhs: &Version, lhs_buf: &[u8], rhs_buf: &[u8]) -> bool {
        if self.tag != rhs.tag {
            return false;
        }

        match self.tag {
            // if the two versions are identical as strings, it should often be faster to compare that than the actual semver version
            // semver ranges involve a ton of pointer chasing
            Tag::Npm => {
                strings::eql_long(
                    self.literal.slice(lhs_buf),
                    rhs.literal.slice(rhs_buf),
                    true,
                ) || self.npm().eql(rhs.npm(), lhs_buf, rhs_buf)
            }
            Tag::Folder | Tag::DistTag => self.literal.eql(rhs.literal, lhs_buf, rhs_buf),
            Tag::Git => Repository::eql(self.git(), rhs.git(), lhs_buf, rhs_buf),
            Tag::Github => Repository::eql(self.github(), rhs.github(), lhs_buf, rhs_buf),
            Tag::Tarball => self.tarball().eql(rhs.tarball(), lhs_buf, rhs_buf),
            Tag::Symlink => self.symlink().eql(*rhs.symlink(), lhs_buf, rhs_buf),
            Tag::Workspace => self.workspace().eql(*rhs.workspace(), lhs_buf, rhs_buf),
            _ => true,
        }
    }
}

// PORT NOTE: no `Drop for Version`. Zig treats `Version` as POD — the
// `Semver::query::Group` linked list under `.npm` is arena-allocated and
// outlives any individual `Version` copy. Adding `Drop` here would make
// `Dependency`/`Version` non-clonable and break the shallow-copy contract
// the lockfile buffers rely on.

// ──────────────────────────────────────────────────────────────────────────
// Version::Tag
// ──────────────────────────────────────────────────────────────────────────

// PORT NOTE: Zig `Tag.map = bun.ComptimeStringMap(Tag, ...)`. Was a `phf::Map`
// in the Phase-A draft; rewritten as a length-gated match (cf. 12577e958d71
// clap::find_param) — 9 entries with near-unique lengths, so a single `usize`
// compare rejects almost every miss before touching bytes, and hits resolve in
// ≤3 slice compares with no hashing or static-init overhead.
#[inline]
pub fn tag_from_bytes(bytes: &[u8]) -> Option<Tag> {
    match bytes.len() {
        3 => match bytes {
            b"npm" => Some(Tag::Npm),
            b"git" => Some(Tag::Git),
            _ => None,
        },
        6 => match bytes {
            b"folder" => Some(Tag::Folder),
            b"github" => Some(Tag::Github),
            _ => None,
        },
        7 => match bytes {
            b"tarball" => Some(Tag::Tarball),
            b"symlink" => Some(Tag::Symlink),
            b"catalog" => Some(Tag::Catalog),
            _ => None,
        },
        8 if bytes == b"dist_tag" => Some(Tag::DistTag),
        9 if bytes == b"workspace" => Some(Tag::Workspace),
        _ => None,
    }
}

pub trait TagExt {
    fn cmp(self, other: Tag) -> Ordering;
    fn is_npm(self) -> bool;
    fn infer(dependency: &[u8]) -> Tag;
}

impl TagExt for Tag {
    fn cmp(self, other: Tag) -> Ordering {
        // TODO: align with yarn
        (self as u8).cmp(&(other as u8))
    }

    #[inline]
    fn is_npm(self) -> bool {
        (self as u8) < 3
    }

    fn infer(dependency: &[u8]) -> Tag {
        // empty string means `latest`
        if dependency.is_empty() {
            return Tag::DistTag;
        }

        if strings::starts_with_windows_drive_letter_t(dependency)
            // PORT NOTE: Zig `std.fs.path.isSep` — platform-native separator only
            // (`/` on POSIX, `/` or `\` on Windows). NOT `isSepAny`.
            && {
                #[cfg(windows)]
                { matches!(dependency[2], b'/' | b'\\') }
                #[cfg(not(windows))]
                { dependency[2] == b'/' }
            }
        {
            if is_tarball(dependency) {
                return Tag::Tarball;
            }
            return Tag::Folder;
        }

        // PERF(port): was stack-fallback allocator (1024B); now uses global mimalloc — profile in Phase B

        match dependency[0] {
            // =1
            // >1.2
            // >=1.2.3
            // <1
            // <=1.2
            // ^1.2.3
            // *
            // || 1.x
            b'=' | b'>' | b'<' | b'^' | b'*' | b'|' => return Tag::Npm,
            // ./foo.tgz
            // ./path/to/foo
            // ../path/to/bar
            b'.' => {
                if is_tarball(dependency) {
                    return Tag::Tarball;
                }
                return Tag::Folder;
            }
            // ~1.2.3
            // ~/foo.tgz
            // ~/path/to/foo
            b'~' => {
                // https://docs.npmjs.com/cli/v8/configuring-npm/package-json#local-paths
                if dependency.len() > 1 && dependency[1] == b'/' {
                    if is_tarball(dependency) {
                        return Tag::Tarball;
                    }
                    return Tag::Folder;
                }
                return Tag::Npm;
            }
            // /path/to/foo
            // /path/to/foo.tgz
            b'/' => {
                if is_tarball(dependency) {
                    return Tag::Tarball;
                }
                return Tag::Folder;
            }
            // 1.2.3
            // 123.tar.gz
            b'0'..=b'9' => {
                if is_tarball(dependency) {
                    return Tag::Tarball;
                }
                return Tag::Npm;
            }
            // foo.tgz
            // foo/repo
            // file:path/to/foo
            // file:path/to/foo.tar.gz
            b'f' => {
                if dependency.starts_with(b"file:") {
                    if is_tarball(dependency) {
                        return Tag::Tarball;
                    }
                    return Tag::Folder;
                }
            }
            b'c' => {
                if dependency.starts_with(b"catalog:") {
                    return Tag::Catalog;
                }
            }
            // git_user/repo
            // git_tarball.tgz
            // github:user/repo
            // git@example.com/repo.git
            // git://user@example.com/repo.git
            b'g' => {
                if dependency.starts_with(b"git") {
                    let mut url = &dependency[b"git".len()..];
                    if url.len() > 2 {
                        match url[0] {
                            b':' => {
                                // TODO(markovejnovic): This check for testing whether the URL
                                // is a Git URL shall be moved to npm_package_arg.zig when that
                                // is implemented.
                                if url.starts_with(b"://") {
                                    url = &url[b"://".len()..];
                                    if url.starts_with(b"github.com/") {
                                        if hosted_git_info::is_github_shorthand(
                                            &url[b"github.com/".len()..],
                                        ) {
                                            return Tag::Github;
                                        }
                                    }

                                    if let Ok(Some(info)) =
                                        hosted_git_info::HostedGitInfo::from_url(dependency)
                                    {
                                        return hgi_to_tag(&info);
                                    }

                                    return Tag::Git;
                                }
                            }
                            b'+' => {
                                if url.starts_with(b"+ssh:") || url.starts_with(b"+file:") {
                                    return Tag::Git;
                                }
                                if url.starts_with(b"+http") {
                                    url = &url[b"+http".len()..];
                                    let advanced = url.len() > 2
                                        && match url[0] {
                                            b':' => 'brk: {
                                                if url.starts_with(b"://") {
                                                    url = &url[b"://".len()..];
                                                    break 'brk true;
                                                }
                                                false
                                            }
                                            b's' => 'brk: {
                                                if url.starts_with(b"s://") {
                                                    url = &url[b"s://".len()..];
                                                    break 'brk true;
                                                }
                                                false
                                            }
                                            _ => false,
                                        };
                                    if advanced {
                                        if url.starts_with(b"github.com/") {
                                            if hosted_git_info::is_github_shorthand(
                                                &url[b"github.com/".len()..],
                                            ) {
                                                return Tag::Github;
                                            }
                                        }

                                        if let Ok(Some(info)) =
                                            hosted_git_info::HostedGitInfo::from_url(dependency)
                                        {
                                            return hgi_to_tag(&info);
                                        }

                                        return Tag::Git;
                                    }
                                }
                            }
                            b'h' => {
                                if url.starts_with(b"hub:") {
                                    if hosted_git_info::is_github_shorthand(&url[b"hub:".len()..]) {
                                        return Tag::Github;
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            // hello/world
            // hello.tar.gz
            // https://github.com/user/repo
            b'h' => {
                if dependency.starts_with(b"http") {
                    let mut url = &dependency[b"http".len()..];
                    if url.len() > 2 {
                        match url[0] {
                            b':' => {
                                if url.starts_with(b"://") {
                                    url = &url[b"://".len()..];
                                }
                            }
                            b's' => {
                                if url.starts_with(b"s://") {
                                    url = &url[b"s://".len()..];
                                }
                            }
                            _ => {}
                        }

                        if url.starts_with(b"github.com/") {
                            let path = &url[b"github.com/".len()..];
                            if is_github_tarball_path(path) {
                                return Tag::Tarball;
                            }
                            if hosted_git_info::is_github_shorthand(path) {
                                return Tag::Github;
                            }
                        }

                        if let Ok(Some(info)) = hosted_git_info::HostedGitInfo::from_url(dependency)
                        {
                            return hgi_to_tag(&info);
                        }

                        return Tag::Tarball;
                    }
                }
            }
            b's' => {
                if dependency.starts_with(b"ssh") {
                    let mut url = &dependency[b"ssh".len()..];
                    if url.len() > 2 {
                        if url[0] == b':' {
                            if url.starts_with(b"://") {
                                url = &url[b"://".len()..];
                            }
                        }

                        if url.len() > 4 && &url[0..b"git@".len()] == b"git@" {
                            url = &url[b"git@".len()..];
                        }

                        let _ = url; // PORT NOTE: Zig mutates `url` but doesn't use it after this point

                        if let Ok(Some(info)) = hosted_git_info::HostedGitInfo::from_url(dependency)
                        {
                            return hgi_to_tag(&info);
                        }
                        return Tag::Git;
                    }
                }
            }
            // lisp.tgz
            // lisp/repo
            // link:path/to/foo
            b'l' => {
                if dependency.starts_with(b"link:") {
                    return Tag::Symlink;
                }
            }
            // newspeak.tgz
            // newspeak/repo
            // npm:package@1.2.3
            b'n' => {
                if dependency.starts_with(b"npm:") && dependency.len() > b"npm:".len() {
                    let remain =
                        &dependency[b"npm:".len() + (dependency[b"npm:".len()] == b'@') as usize..];
                    for (i, &c) in remain.iter().enumerate() {
                        if c == b'@' {
                            return Tag::infer(&remain[i + 1..]);
                        }
                    }

                    return Tag::Npm;
                }
            }
            // v1.2.3
            // verilog
            // verilog.tar.gz
            // verilog/repo
            // virt@example.com:repo.git
            b'v' => {
                if is_tarball(dependency) {
                    return Tag::Tarball;
                }
                if hosted_git_info::is_github_shorthand(dependency) {
                    return Tag::Github;
                }
                if is_scp_like_path(dependency) {
                    return Tag::Git;
                }
                if dependency.len() == 1 {
                    return Tag::DistTag;
                }
                return match dependency[1] {
                    b'0'..=b'9' => Tag::Npm,
                    _ => Tag::DistTag,
                };
            }
            // workspace:*
            // w00t
            // w00t.tar.gz
            // w00t/repo
            b'w' => {
                if dependency.starts_with(b"workspace:") {
                    return Tag::Workspace;
                }
            }
            // x
            // xyz.tar.gz
            // xyz/repo#main
            b'x' | b'X' => {
                if dependency.len() == 1 {
                    return Tag::Npm;
                }
                if dependency[1] == b'.' {
                    return Tag::Npm;
                }
            }
            b'p' => {
                // TODO(dylan-conway): apply .patch files on packages. In the future this could
                // return `Tag.git` or `Tag.npm`.
                if dependency.starts_with(b"patch:") {
                    return Tag::Npm;
                }
            }
            _ => {}
        }

        // foo.tgz
        // bar.tar.gz
        if is_tarball(dependency) {
            return Tag::Tarball;
        }

        // user/repo
        // user/repo#main
        if hosted_git_info::is_github_shorthand(dependency) {
            return Tag::Github;
        }

        // git@example.com:path/to/repo.git
        if is_scp_like_path(dependency) {
            if let Ok(Some(info)) = hosted_git_info::HostedGitInfo::from_url(dependency) {
                return hgi_to_tag(&info);
            }
            return Tag::Git;
        }

        // beta

        if strings::index_of_char(dependency, b'|').is_none() {
            return Tag::DistTag;
        }

        Tag::Npm
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Version payload types
// ──────────────────────────────────────────────────────────────────────────

pub trait ValueExt {
    fn clone_in<SB: StringBuilderLike>(
        &self,
        _tag: Tag,
        _buf: &[u8],
        _builder: &mut SB,
    ) -> Result<Value, bun_core::Error>;
}

impl ValueExt for Value {
    // TODO(port): `clone` is called in Version::clone but not defined in
    // dependency.zig — likely lives elsewhere or relies on Zig copy semantics.
    fn clone_in<SB: StringBuilderLike>(
        &self,
        _tag: Tag,
        _buf: &[u8],
        _builder: &mut SB,
    ) -> Result<Value, bun_core::Error> {
        // Zig copies the union by value into the new builder context; the only
        // builder-dependent piece is `literal`, which `Version::clone_in`
        // already re-appends. Match Zig's shallow copy here.
        Ok(Clone::clone(self))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Free functions: parse
// ──────────────────────────────────────────────────────────────────────────

pub fn is_windows_abs_path_with_leading_slashes(dep: &[u8]) -> Option<&[u8]> {
    let mut i: usize = 0;
    if dep.len() > 2 && dep[i] == b'/' {
        while dep[i] == b'/' {
            i += 1;

            // not possible to have windows drive letter and colon
            if i > dep.len() - 3 {
                return None;
            }
        }
        if strings::starts_with_windows_drive_letter_t(&dep[i..]) {
            return Some(&dep[i..]);
        }
    }

    None
}

#[inline]
pub fn parse<'a, 'b>(
    alias: String,
    alias_hash: impl Into<Option<PackageNameHash>>,
    dependency: &[u8],
    sliced: &SlicedString,
    log: impl Into<Option<&'a mut bun_ast::Log>>,
    manager: impl Into<Option<&'b mut PackageManager>>,
) -> Option<Version> {
    let dep = strings::trim_left(dependency, b" \t\n\r");
    parse_with_tag(
        alias,
        alias_hash.into(),
        dep,
        Tag::infer(dep),
        sliced,
        log.into(),
        manager.into().map(|m| m as &mut dyn NpmAliasRegistry),
    )
}

pub fn parse_with_optional_tag<'a, 'b>(
    alias: String,
    alias_hash: impl Into<Option<PackageNameHash>>,
    dependency: &[u8],
    tag: Option<Tag>,
    sliced: &SlicedString,
    log: impl Into<Option<&'a mut bun_ast::Log>>,
    package_manager: impl Into<Option<&'b mut PackageManager>>,
) -> Option<Version> {
    let dep = strings::trim_left(dependency, b" \t\n\r");
    parse_with_tag(
        alias,
        alias_hash.into(),
        dep,
        tag.unwrap_or_else(|| Tag::infer(dep)),
        sliced,
        log.into(),
        package_manager
            .into()
            .map(|m| m as &mut dyn NpmAliasRegistry),
    )
}

pub fn parse_with_tag(
    alias: String,
    alias_hash: Option<PackageNameHash>,
    dependency: &[u8],
    tag: Tag,
    sliced: &SlicedString,
    log_: Option<&mut bun_ast::Log>,
    package_manager: Option<&mut dyn NpmAliasRegistry>,
) -> Option<Version> {
    match tag {
        Tag::Npm => {
            let mut input = dependency;

            let mut is_alias = false;
            let name = 'brk: {
                if input.starts_with(b"npm:") {
                    is_alias = true;
                    let str = &input[b"npm:".len()..];
                    let mut i: usize = (!str.is_empty() && str[0] == b'@') as usize;

                    while i < str.len() {
                        if str[i] == b'@' {
                            input = &str[i + 1..];
                            break 'brk sliced.sub(&str[0..i]).value();
                        }
                        i += 1;
                    }

                    input = &str[i..];

                    break 'brk sliced.sub(&str[0..i]).value();
                }

                alias
            };

            is_alias = is_alias && alias_hash.is_some();

            // Strip single leading v
            // v1.0.0 -> 1.0.0
            // note: "vx" is valid, it becomes "x". "yarn add react@vx" -> "yarn add react@x" -> "yarn add react@17.0.2"
            if input.len() > 1 && input[0] == b'v' {
                input = &input[1..];
            }

            let version = match Semver::query::parse(input, sliced.sub(input)) {
                Ok(v) => v,
                Err(_e) => {
                    // error.OutOfMemory => bun.outOfMemory()
                    bun_core::out_of_memory();
                }
            };

            let result = Version {
                literal: sliced.value(),
                value: Value {
                    npm: ManuallyDrop::new(NpmInfo {
                        is_alias,
                        name,
                        version,
                    }),
                },
                tag: Tag::Npm,
            };

            if is_alias {
                if let Some(pm) = package_manager {
                    // Zig: `pm.known_npm_aliases.put(alias_hash.?, result)`.
                    pm.record_npm_alias(alias_hash.unwrap(), &result);
                }
            }

            Some(result)
        }
        Tag::DistTag => {
            let mut tag_to_use = sliced.value();

            let actual = if dependency.starts_with(b"npm:") && dependency.len() > b"npm:".len() {
                // npm:@foo/bar@latest
                sliced
                    .sub('brk: {
                        let mut i = b"npm:".len();

                        // npm:@foo/bar@latest
                        //     ^
                        i += (dependency[i] == b'@') as usize;

                        while i < dependency.len() {
                            // npm:@foo/bar@latest
                            //             ^
                            if dependency[i] == b'@' {
                                break;
                            }
                            i += 1;
                        }

                        tag_to_use = sliced.sub(&dependency[i + 1..]).value();
                        break 'brk &dependency[b"npm:".len()..i];
                    })
                    .value()
            } else {
                alias
            };

            // name should never be empty
            debug_assert!(!actual.is_empty());

            Some(Version {
                literal: sliced.value(),
                value: Value {
                    dist_tag: TagInfo {
                        name: actual,
                        tag: if tag_to_use.is_empty() {
                            String::from(b"latest")
                        } else {
                            tag_to_use
                        },
                    },
                },
                tag: Tag::DistTag,
            })
        }
        Tag::Git => {
            let mut input = dependency;
            if input.starts_with(b"git+") {
                input = &input[b"git+".len()..];
            }
            let hash_index = strings::last_index_of_char(input, b'#');

            Some(Version {
                literal: sliced.value(),
                value: Value {
                    git: ManuallyDrop::new(Repository {
                        owner: String::from(b""),
                        repo: sliced
                            .sub(if let Some(index) = hash_index {
                                &input[0..index as usize]
                            } else {
                                input
                            })
                            .value(),
                        committish: if let Some(index) = hash_index {
                            sliced.sub(&input[index as usize + 1..]).value()
                        } else {
                            String::from(b"")
                        },
                        ..Default::default()
                    }),
                },
                tag: Tag::Git,
            })
        }
        Tag::Github => {
            let info = match hosted_git_info::HostedGitInfo::from_url(dependency) {
                Ok(Some(info)) => info,
                Ok(None) | Err(_) => return None,
            };

            // Now we have parsed info, we need to find these substrings in the original dependency
            // to create String objects that point to the original buffer
            let owner_str: &[u8] = info.user().unwrap_or(b"");
            let repo_str: &[u8] = info.project();
            let committish_str: &[u8] = info.committish().unwrap_or(b"");

            // Find owner in dependency string
            let owner_idx = strings::index_of(dependency, owner_str);
            let owner = if let Some(idx) = owner_idx {
                let idx = idx as usize;
                sliced.sub(&dependency[idx..idx + owner_str.len()]).value()
            } else {
                String::from(b"")
            };

            // Find repo in dependency string
            let repo_idx = strings::index_of(dependency, repo_str);
            let repo = if let Some(idx) = repo_idx {
                let idx = idx as usize;
                sliced.sub(&dependency[idx..idx + repo_str.len()]).value()
            } else {
                String::from(b"")
            };

            // Find committish in dependency string
            let committish = if !committish_str.is_empty() {
                let committish_idx = strings::index_of(dependency, committish_str);
                if let Some(idx) = committish_idx {
                    let idx = idx as usize;
                    sliced
                        .sub(&dependency[idx..idx + committish_str.len()])
                        .value()
                } else {
                    String::from(b"")
                }
            } else {
                String::from(b"")
            };

            Some(Version {
                literal: sliced.value(),
                value: Value {
                    github: ManuallyDrop::new(Repository {
                        owner,
                        repo,
                        committish,
                        ..Default::default()
                    }),
                },
                tag: Tag::Github,
            })
        }
        Tag::Tarball => {
            if is_remote_tarball(dependency) {
                return Some(Version {
                    tag: Tag::Tarball,
                    literal: sliced.value(),
                    value: Value {
                        tarball: TarballInfo {
                            uri: URI::Remote(sliced.sub(dependency).value()),
                            package_name: String::default(),
                        },
                    },
                });
            } else if dependency.starts_with(b"file://") {
                return Some(Version {
                    tag: Tag::Tarball,
                    literal: sliced.value(),
                    value: Value {
                        tarball: TarballInfo {
                            uri: URI::Local(sliced.sub(&dependency[7..]).value()),
                            package_name: String::default(),
                        },
                    },
                });
            } else if dependency.starts_with(b"file:") {
                return Some(Version {
                    tag: Tag::Tarball,
                    literal: sliced.value(),
                    value: Value {
                        tarball: TarballInfo {
                            uri: URI::Local(sliced.sub(&dependency[5..]).value()),
                            package_name: String::default(),
                        },
                    },
                });
            } else if strings::index_of(dependency, b"://").is_some() {
                if let Some(log) = log_ {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!(
                            "invalid or unsupported dependency \"{}\"",
                            bstr::BStr::new(dependency)
                        ),
                    );
                }
                return None;
            }

            Some(Version {
                tag: Tag::Tarball,
                literal: sliced.value(),
                value: Value {
                    tarball: TarballInfo {
                        uri: URI::Local(sliced.value()),
                        package_name: String::default(),
                    },
                },
            })
        }
        Tag::Folder => {
            if let Some(protocol) = strings::index_of_char(dependency, b':') {
                let protocol = protocol as usize;
                if &dependency[0..protocol] == b"file" {
                    let folder: &[u8] = 'folder: {
                        // from npm:
                        //
                        // turn file://../foo into file:../foo
                        // https://github.com/npm/cli/blob/fc6e291e9c2154c2e76636cb7ebf0a17be307585/node_modules/npm-package-arg/lib/npa.js#L269
                        //
                        // something like this won't behave the same
                        // file://bar/../../foo
                        let maybe_dot_dot: &[u8] = 'maybe_dot_dot: {
                            if dependency.len() > protocol + 1 && dependency[protocol + 1] == b'/' {
                                if dependency.len() > protocol + 2
                                    && dependency[protocol + 2] == b'/'
                                {
                                    if dependency.len() > protocol + 3
                                        && dependency[protocol + 3] == b'/'
                                    {
                                        break 'maybe_dot_dot &dependency[protocol + 4..];
                                    }
                                    break 'maybe_dot_dot &dependency[protocol + 3..];
                                }
                                break 'maybe_dot_dot &dependency[protocol + 2..];
                            }
                            break 'folder &dependency[protocol + 1..];
                        };

                        if maybe_dot_dot.len() > 1
                            && maybe_dot_dot[0] == b'.'
                            && maybe_dot_dot[1] == b'.'
                        {
                            return Some(Version {
                                literal: sliced.value(),
                                value: Value {
                                    folder: sliced.sub(maybe_dot_dot).value(),
                                },
                                tag: Tag::Folder,
                            });
                        }

                        &dependency[protocol + 1..]
                    };

                    // from npm:
                    //
                    // turn /C:/blah info just C:/blah on windows
                    // https://github.com/npm/cli/blob/fc6e291e9c2154c2e76636cb7ebf0a17be307585/node_modules/npm-package-arg/lib/npa.js#L277
                    #[cfg(windows)]
                    {
                        if let Some(dep) = is_windows_abs_path_with_leading_slashes(folder) {
                            return Some(Version {
                                literal: sliced.value(),
                                value: Value {
                                    folder: sliced.sub(dep).value(),
                                },
                                tag: Tag::Folder,
                            });
                        }
                    }

                    return Some(Version {
                        literal: sliced.value(),
                        value: Value {
                            folder: sliced.sub(folder).value(),
                        },
                        tag: Tag::Folder,
                    });
                }

                // check for absolute windows paths
                #[cfg(windows)]
                {
                    if protocol == 1 && strings::starts_with_windows_drive_letter(dependency) {
                        return Some(Version {
                            literal: sliced.value(),
                            value: Value {
                                folder: sliced.sub(dependency).value(),
                            },
                            tag: Tag::Folder,
                        });
                    }

                    // from npm:
                    //
                    // turn /C:/blah info just C:/blah on windows
                    // https://github.com/npm/cli/blob/fc6e291e9c2154c2e76636cb7ebf0a17be307585/node_modules/npm-package-arg/lib/npa.js#L277
                    if let Some(dep) = is_windows_abs_path_with_leading_slashes(dependency) {
                        return Some(Version {
                            literal: sliced.value(),
                            value: Value {
                                folder: sliced.sub(dep).value(),
                            },
                            tag: Tag::Folder,
                        });
                    }
                }

                if let Some(log) = log_ {
                    log.add_error_fmt(
                        None,
                        bun_ast::Loc::EMPTY,
                        format_args!("Unsupported protocol {}", bstr::BStr::new(dependency)),
                    );
                }
                return None;
            }

            Some(Version {
                value: Value {
                    folder: sliced.value(),
                },
                tag: Tag::Folder,
                literal: sliced.value(),
            })
        }
        Tag::Uninitialized => None,
        Tag::Symlink => {
            if let Some(colon) = strings::index_of_char(dependency, b':') {
                return Some(Version {
                    value: Value {
                        symlink: sliced.sub(&dependency[colon as usize + 1..]).value(),
                    },
                    tag: Tag::Symlink,
                    literal: sliced.value(),
                });
            }

            Some(Version {
                value: Value {
                    symlink: sliced.value(),
                },
                tag: Tag::Symlink,
                literal: sliced.value(),
            })
        }
        Tag::Workspace => {
            let mut input = dependency;
            if input.starts_with(b"workspace:") {
                input = &input[b"workspace:".len()..];
            }
            Some(Version {
                value: Value {
                    workspace: sliced.sub(input).value(),
                },
                tag: Tag::Workspace,
                literal: sliced.value(),
            })
        }
        Tag::Catalog => {
            debug_assert!(dependency.starts_with(b"catalog:"));

            let group = &dependency[b"catalog:".len()..];

            let trimmed = strings::trim(group, &strings::WHITESPACE_CHARS);

            Some(Version {
                value: Value {
                    catalog: sliced.sub(trimmed).value(),
                },
                tag: Tag::Catalog,
                literal: sliced.value(),
            })
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Behavior — MOVE_DOWN: canonical definition lives in
// `bun_install_types::resolver_hooks` so `bun_resolver` and `bun_install`
// share one nominal type. Re-export it here for `crate::dependency::Behavior`.
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────

fn hgi_to_tag(info: &hosted_git_info::HostedGitInfo) -> Tag {
    match info.host_provider {
        hosted_git_info::HostProvider::Github => {
            if info.default_representation == hosted_git_info::Representation::Shortcut {
                Tag::Github
            } else {
                Tag::Git
            }
        }
        hosted_git_info::HostProvider::Bitbucket
        | hosted_git_info::HostProvider::Gitlab
        | hosted_git_info::HostProvider::Gist
        | hosted_git_info::HostProvider::Sourcehut => Tag::Git,
    }
}

// ported from: src/install/dependency.zig
