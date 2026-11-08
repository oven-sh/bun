use core::cmp::Ordering;
use core::mem::ManuallyDrop;

use bun_paths::strings;
use bun_semver as Semver;
use bun_semver::{SlicedString, String};

use crate::hosted_git_info;
use crate::repository::Repository;
use crate::{PackageManager, PackageNameHash};

// ──────────────────────────────────────────────────────────────────────────
// NpmAliasRegistry — exposes only the one `PackageManager` method `parse`
// actually touches (`known_npm_aliases.put`) so `parse_with_tag` can take an
// `Option<&mut dyn NpmAliasRegistry>` and stay decoupled from the full
// `PackageManager` surface.
// ──────────────────────────────────────────────────────────────────────────

pub trait NpmAliasRegistry {
    /// Takes the alias's text, because a parsed `Version` is only valid together with the buffer it
    /// was parsed from.
    fn record_npm_alias(&mut self, hash: PackageNameHash, specifier: &[u8]);
}

impl NpmAliasRegistry for PackageManager {
    #[inline]
    fn record_npm_alias(&mut self, hash: PackageNameHash, specifier: &[u8]) {
        self.known_npm_aliases.record_npm_alias(hash, specifier);
    }
}

/// Field-level impl so callers that have already split-borrowed
/// `PackageManager` (e.g. they hold `&mut manager.lockfile` for a
/// `StringBuilder`) can pass `&mut manager.known_npm_aliases` directly to
/// `Dependency::clone_in` / `OverrideMap::clone` instead of a full
/// `&mut PackageManager`.
impl NpmAliasRegistry for crate::package_manager_real::NpmAliasMap {
    #[inline]
    fn record_npm_alias(&mut self, hash: PackageNameHash, specifier: &[u8]) {
        // An install parses the same alias several times. Skip the allocation if it is unchanged.
        if self.get(&hash).is_some_and(|known| **known == *specifier) {
            return;
        }
        self.insert(hash, Box::from(specifier));
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
    ) -> Result<Dependency, crate::Error>;
    fn clone_with_different_buffers<SB: StringBuilderLike, PM: NpmAliasRegistry>(
        &self,
        package_manager: &mut PM,
        name_buf: &[u8],
        version_buf: &[u8],
        builder: &mut SB,
    ) -> Result<Dependency, crate::Error>;
    fn realname(&self) -> String;
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
    /// Forwards to the module-level `is_tarball`.
    #[inline]
    fn is_tarball(dependency: &[u8]) -> bool {
        is_tarball(dependency)
    }

    /// Forwards to the module-level `split_name_and_maybe_version`.
    #[inline]
    fn split_name_and_maybe_version(str: &[u8]) -> (&[u8], Option<&[u8]>) {
        split_name_and_maybe_version(str)
    }

    /// Strips a leading `@scope/` if present.
    fn unscoped_package_name(name: &[u8]) -> &[u8] {
        if name.is_empty() || name[0] != b'@' {
            return name;
        }
        let name_ = &name[1..];
        match bun_core::strings::index_of_char_usize(name_, b'/') {
            Some(i) => &name_[i + 1..],
            None => name,
        }
    }

    /// Forwards to the module-level `parse_with_optional_tag`.
    ///
    /// `alias_hash`, `log`, and `package_manager` accept either the bare value
    /// (`u64` / `&mut Log` / `&mut PackageManager`) or `Option<_>` via
    /// `impl Into<Option<_>>`.
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

    fn count_with_different_buffers<SB: StringBuilderLike>(
        &self,
        name_buf: &[u8],
        version_buf: &[u8],
        builder: &mut SB,
    ) {
        builder.count(self.name.slice(name_buf));
        builder.count(self.version.literal.slice(version_buf));
        if self.version.tag == Tag::Workspace {
            builder.count(self.version.workspace().slice(version_buf));
        }
    }

    fn count<SB: StringBuilderLike>(&self, buf: &[u8], builder: &mut SB) {
        self.count_with_different_buffers(buf, buf, builder);
    }

    /// Named `clone_in` so it doesn't shadow
    /// `std::clone::Clone::clone` (callers in `migration.rs` / `PackageManager.rs`
    /// rely on the trait method for shallow copy).
    fn clone_in<SB: StringBuilderLike, PM: NpmAliasRegistry>(
        &self,
        package_manager: &mut PM,
        buf: &[u8],
        builder: &mut SB,
    ) -> Result<Dependency, crate::Error> {
        self.clone_with_different_buffers(package_manager, buf, buf, builder)
    }

    fn clone_with_different_buffers<SB: StringBuilderLike, PM: NpmAliasRegistry>(
        &self,
        package_manager: &mut PM,
        name_buf: &[u8],
        version_buf: &[u8],
        builder: &mut SB,
    ) -> Result<Dependency, crate::Error> {
        // `append_string` may reallocate `string_bytes`, invalidating any
        // prior slice. Append first, then borrow the (now-stable) buffer.
        let new_literal = builder.append_string(self.version.literal.slice(version_buf));
        let new_name = builder.append_string(self.name.slice(name_buf));

        // A workspace edge's path is not always its literal: `Package::parse` links an npm range
        // (`^1`, `*`, `npm:pkg@1`) to a workspace and keeps the range as the literal.
        let version = if self.version.tag == Tag::Workspace {
            Version {
                tag: Tag::Workspace,
                literal: new_literal,
                value: Value {
                    workspace: builder.append_string(self.version.workspace().slice(version_buf)),
                },
            }
        } else {
            let out_slice = builder.string_bytes();
            let sliced = new_literal.sliced(out_slice);
            parse_with_tag(
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
            .unwrap_or_default()
        };

        Ok(Dependency {
            name_hash: self.name_hash,
            name: new_name,
            version,
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

    fn eql(&self, b: &Dependency, lhs_buf: &[u8], rhs_buf: &[u8]) -> bool {
        self.name_hash == b.name_hash
            && self.name.len() == b.name.len()
            && self.version.eql(&b.version, lhs_buf, rhs_buf)
    }
    #[inline]
    fn is_remote_tarball(dep: &[u8]) -> bool {
        is_remote_tarball(dep)
    }

    /// Compat: dependents call `Dependency::parse` as an associated fn;
    /// the actual implementation is a free fn. Delegate so downstream callers
    /// (`bun_install_jsc`) keep type-checking.
    ///
    /// `alias_hash`, `log`, and `manager` accept either bare values or
    /// `Option<_>`.
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

// Uses the `bun_semver::StringBuilder` trait
// (count / append<T> / append_string). The only extra method needed here is
// access to the FULL backing buffer, which is intentionally NOT on the base trait since
// `semver_string::Builder`'s isolated Box<[u8]> would be wrong for callers
// that need the lockfile's full string_bytes.
pub trait StringBuilderLike: bun_semver::StringBuilder {
    /// Full backing string buffer.
    fn string_bytes(&self) -> &[u8];
}

// single-impl monomorphization is intentional — `semver_string::Builder` is
// never used here, and its isolated Box<[u8]> can't satisfy
// `builder.lockfile.buffers.string_bytes`.
impl<'a> StringBuilderLike for crate::lockfile_real::StringBuilder<'a> {
    #[inline]
    fn string_bytes(&self) -> &[u8] {
        self.string_bytes.as_slice()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// External serialization
// ──────────────────────────────────────────────────────────────────────────

pub(crate) type External = [u8; SIZE];

const SIZE: usize = core::mem::size_of::<VersionExternal>()
    + core::mem::size_of::<PackageNameHash>()
    + core::mem::size_of::<Behavior>()
    + core::mem::size_of::<String>();

pub struct Context<'a> {
    // allocator dropped (global mimalloc)
    pub(crate) log: &'a mut bun_ast::Log,
    pub(crate) buffer: &'a [u8],
}

pub(crate) fn to_dependency(this: External, ctx: &mut Context<'_>) -> Dependency {
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

pub(crate) fn to_external(this: &Dependency) -> External {
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
pub(crate) fn is_scp_like_path(dependency: &[u8]) -> bool {
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
pub(crate) fn is_github_tarball_path(dependency: &[u8]) -> bool {
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
fn is_tarball(dependency: &[u8]) -> bool {
    has_suffix_ignore_ascii_case(dependency, b".tgz")
        || has_suffix_ignore_ascii_case(dependency, b".tar.gz")
        || has_suffix_ignore_ascii_case(dependency, b".tar")
}

#[inline]
fn has_suffix_ignore_ascii_case(s: &[u8], suffix: &[u8]) -> bool {
    s.len() >= suffix.len() && s[s.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
}

/// the input is assumed to be either a remote or local tarball
#[inline]
pub(crate) fn is_remote_tarball(dependency: &[u8]) -> bool {
    dependency.starts_with(b"https://") || dependency.starts_with(b"http://")
}

/// Matches `2x`, `1beta` and `v2x`. Like in npm-package-arg, a word that only starts like a version
/// is a tag.
fn is_dist_tag_with_leading_digit(dependency: &[u8]) -> bool {
    // The usual case is `1.2.3`. Three numbers leave no room for a wildcard, and the caller parses
    // it again.
    if dependency.len() <= 17 {
        let mut dots = 0;
        let mut after_digit = false;
        let is_plain = dependency.iter().all(|&byte| match byte {
            b'0'..=b'9' => {
                after_digit = true;
                true
            }
            b'.' if after_digit => {
                after_digit = false;
                dots += 1;
                true
            }
            _ => false,
        });
        if is_plain && after_digit && dots == 2 {
            return false;
        }
    }
    if strings::index_of_any(dependency, b"|+ \t\n\r\x0B\x0C").is_some() {
        return false;
    }
    let parsed = Semver::Version::parse_utf8(dependency);
    !parsed.valid && parsed.wildcard != Semver::query::Wildcard::None
}

// ──────────────────────────────────────────────────────────────────────────
// Compat aliases: dependents reference `dependency::version::Tag`,
// `dependency::VersionTag`, `Dependency::is_remote_tarball`, and a `tarball`
// submodule. `Tag` lives at top level here — keep both paths so dependents
// type-check.
// ──────────────────────────────────────────────────────────────────────────
pub use Tag as VersionTag;
pub mod version {
    pub use super::Tag;
}
pub mod tarball {
    pub use super::{TarballInfo, URI as Uri};
}

/// Turns `foo@1.1.1` into `foo`, `1.1.1`, or `@foo/bar@1.1.1` into `@foo/bar`, `1.1.1`, or `foo` into `foo`, `null`.
fn split_name_and_maybe_version(str: &[u8]) -> (&[u8], Option<&[u8]>) {
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
pub(crate) enum SplitNameError {
    #[error("MissingVersion")]
    MissingVersion,
}

pub(crate) fn split_name_and_version(str: &[u8]) -> Result<(&[u8], &[u8]), SplitNameError> {
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

/// An untrusted name or alias becomes a directory under `node_modules/` and is printed.
pub(crate) fn is_safe_install_folder_name(name: &[u8]) -> bool {
    if name.is_empty() || name.len() > 255 + 1 + 255 {
        return false;
    }

    // A single pass, because this runs for every dependency in a lockfile, on names of about a
    // dozen bytes.
    let is_safe_component =
        |component: &[u8]| component.len() <= 255 && !matches!(component, b"" | b"." | b"..");
    let mut component_start = 0;
    for (i, &byte) in name.iter().enumerate() {
        match byte {
            b'/' => {
                if !is_safe_component(&name[component_start..i]) {
                    return false;
                }
                component_start = i + 1;
            }
            b'\\' | b':' => return false,
            0xC2 if matches!(name.get(i + 1), Some(0x80..=0x9F)) => return false,
            _ if byte.is_ascii_control() => return false,
            _ => {}
        }
    }
    is_safe_component(&name[component_start..])
}

/// Matches C0 controls, DEL and UTF-8 encoded C1 controls (`C2 80`..`C2 9F`), which terminals
/// interpret.
pub(crate) fn contains_control_character(name: &[u8]) -> bool {
    name.iter().enumerate().any(|(i, &byte)| {
        byte.is_ascii_control()
            || (byte == 0xC2
                && name
                    .get(i + 1)
                    .is_some_and(|next| (0x80..=0x9F).contains(next)))
    })
}

/// A name that bun.lock's `"<name>@<resolution>"` keys can round-trip.
pub(crate) fn is_safe_lockfile_package_name(name: &[u8]) -> bool {
    is_safe_install_folder_name(name) && !strings::contains_char(&name[1..], b'@')
}

/// For a package whose package.json has no name. For example, `https://host/foo.tgz?token=x` gives
/// `foo`.
pub(crate) fn fallback_package_name(location: &[u8]) -> &[u8] {
    let path = match strings::index_of_any(location, b"?#") {
        Some(end) if strings::contains(location, b"://") => &location[..end],
        _ => location,
    };
    let basename = bun_paths::basename(path);
    let name = strings::without_suffix_comptime(
        strings::without_suffix_comptime(basename, b".tgz"),
        b".tar.gz",
    );
    if is_safe_lockfile_package_name(name) {
        name
    } else {
        b"unnamed-package"
    }
}

/// A `link:` target names a directory unless it is a package name (a `bun link` registration).
pub(crate) fn is_link_path(target: &[u8]) -> bool {
    !target.is_empty() && !strings::is_npm_package_name(target)
}

/// Why the resolver and both linkers refuse one (`Lockfile::is_trusted_folder_dependency`).
pub(crate) const LINK_PATH_RULE: &str =
    "only the root package.json, a workspace, or a top-level override may link to a path";

/// The `./` keeps `is_link_path` true when the directory is read back.
pub(crate) fn link_path_for_lockfile(folder: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    if folder.is_empty() {
        return b".".into();
    }
    if matches!(folder, b"." | b"..")
        || folder.starts_with(b"./")
        || folder.starts_with(b"../")
        || bun_paths::is_absolute(folder)
    {
        return folder.into();
    }
    [b"./".as_slice(), folder].concat().into()
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

pub(crate) type VersionExternal = [u8; 9];

pub trait VersionExt {
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
    fn to_version(
        alias: String,
        alias_hash: PackageNameHash,
        bytes: VersionExternal,
        ctx: &mut Context<'_>,
    ) -> Version {
        let slice = String {
            bytes: bytes[1..9].try_into().expect("infallible: size matches"),
        };
        if !slice.is_inline() {
            let ptr = slice.ptr();
            if (ptr.off as usize).saturating_add(ptr.len as usize) > ctx.buffer.len() {
                return Version::default();
            }
        }
        // bytes[0] was written by `to_external` from a valid `Tag`; decode by
        // exhaustive match so a corrupt lockfile byte degrades to an
        // uninitialized version (and a logged error) instead of aborting.
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
            n => {
                ctx.log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!("Corrupt lockfile: invalid dependency version tag {n}"),
                );
                Tag::Uninitialized
            }
        };
        let sliced = slice.sliced(ctx.buffer);
        parse_with_tag(
            alias,
            Some(alias_hash),
            sliced.slice,
            tag,
            &sliced,
            Some(ctx.log),
            None,
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
            Tag::Folder | Tag::DistTag | Tag::Symlink => {
                self.literal.eql(rhs.literal, lhs_buf, rhs_buf)
            }
            Tag::Git => Repository::eql(self.git(), rhs.git(), lhs_buf, rhs_buf),
            Tag::Github => Repository::eql(self.github(), rhs.github(), lhs_buf, rhs_buf),
            Tag::Tarball => self.tarball().eql(rhs.tarball(), lhs_buf, rhs_buf),
            Tag::Workspace => self.workspace().eql(*rhs.workspace(), lhs_buf, rhs_buf),
            Tag::Catalog => self.catalog().eql(*rhs.catalog(), lhs_buf, rhs_buf),
            _ => true,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Version::Tag
// ──────────────────────────────────────────────────────────────────────────

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
            // Platform-native separator only
            // (`/` on POSIX, `/` or `\` on Windows).
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
            // 2x
            b'0'..=b'9' => {
                if is_tarball(dependency) {
                    return Tag::Tarball;
                }
                if is_dist_tag_with_leading_digit(dependency) {
                    return Tag::DistTag;
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
                                // is a Git URL shall be moved to npm_package_arg when that
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
                                // bun.lock writes a `git://` dependency's resolution as `git+git:`.
                                if url.starts_with(b"+ssh:")
                                    || url.starts_with(b"+file:")
                                    || url.starts_with(b"+git:")
                                {
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
            // httplatest
            b'h' => {
                if dependency.starts_with(b"http:") || dependency.starts_with(b"https:") {
                    let mut url = &dependency[b"http".len()..];
                    if url.starts_with(b"://") {
                        url = &url[b"://".len()..];
                    } else if url.starts_with(b"s://") {
                        url = &url[b"s://".len()..];
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

                    if let Ok(Some(info)) = hosted_git_info::HostedGitInfo::from_url(dependency) {
                        return hgi_to_tag(&info);
                    }

                    return Tag::Tarball;
                }
            }
            // ssh://git@example.com/repo.git, but not sshlatest
            b's' => {
                // never a github shortcut (`hgi_to_tag`)
                if dependency.starts_with(b"ssh:") {
                    return Tag::Git;
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
                if let Some(target) = dependency.strip_prefix(b"npm:") {
                    return match split_npm_alias(target) {
                        (_, Some(version)) => Tag::infer(version),
                        (_, None) => Tag::Npm,
                    };
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
                    b'0'..=b'9' if !is_dist_tag_with_leading_digit(dependency) => Tag::Npm,
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
// Free functions: parse
// ──────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub(crate) fn is_windows_abs_path_with_leading_slashes(dep: &[u8]) -> Option<&[u8]> {
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

/// A literal can have leading whitespace, so classify and parse these bytes instead of the raw
/// literal.
#[inline]
pub fn trim_literal(literal: &[u8]) -> &[u8] {
    strings::trim_left(literal, b" \t\n\r")
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
    let dep = trim_literal(dependency);
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

pub(crate) fn parse_with_optional_tag<'a, 'b>(
    alias: String,
    alias_hash: impl Into<Option<PackageNameHash>>,
    dependency: &[u8],
    tag: Option<Tag>,
    sliced: &SlicedString,
    log: impl Into<Option<&'a mut bun_ast::Log>>,
    package_manager: impl Into<Option<&'b mut PackageManager>>,
) -> Option<Version> {
    let dep = trim_literal(dependency);
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

/// Splits the text after `npm:`. For example, `@scope/name@version` gives (`@scope/name`,
/// `version`).
fn split_npm_alias(target: &[u8]) -> (&[u8], Option<&[u8]>) {
    let scope = target.starts_with(b"@") as usize;
    match strings::index_of_char_usize(&target[scope..], b'@') {
        Some(at) => (&target[..scope + at], Some(&target[scope + at + 1..])),
        None => (target, None),
    }
}

/// As in Yarn, `npm:^1.0.0` and `npm:1.0.0` are ranges for the dependency's own name. As in npm,
/// `npm:x`, `npm:1` and `npm:1.x` are aliases, because `x`, `1` and `1.x` are valid package names.
#[cold]
fn is_range_after_npm_protocol(target: &[u8]) -> bool {
    (strings::index_of_any(target, b"^~><=*| ").is_some()
        || Semver::Version::parse_exact(SlicedString::init(target, target)).is_some())
        && Tag::infer(target) == Tag::Npm
}

/// `npm:^1.0.0` -> `^1.0.0`. An alias such as `npm:name@^1.0.0` is returned unchanged.
pub(crate) fn without_npm_protocol(literal: &[u8]) -> &[u8] {
    match literal.strip_prefix(b"npm:") {
        Some(target)
            if split_npm_alias(target).1.is_none() && is_range_after_npm_protocol(target) =>
        {
            target
        }
        _ => literal,
    }
}

/// Matches `npm:`, `npm:@1.0.0` and `npm:@scope/@1`. These still parse, because a lockfile may have
/// one.
pub(crate) fn nameless_npm_alias(literal: &[u8]) -> Option<&[u8]> {
    let (name, _) = split_npm_alias(trim_literal(literal).strip_prefix(b"npm:")?);
    is_scoped_package_name(name).is_err().then_some(name)
}

pub(crate) fn parse_with_tag(
    alias: String,
    alias_hash: Option<PackageNameHash>,
    dependency: &[u8],
    tag: Tag,
    sliced: &SlicedString,
    log_: Option<&mut bun_ast::Log>,
    package_manager: Option<&mut dyn NpmAliasRegistry>,
) -> Option<Version> {
    // `to_version` (bun.lockb) and `clone_with_different_buffers` pass the literal untrimmed.
    let dependency = trim_literal(dependency);
    match tag {
        Tag::Npm => {
            let mut input = dependency;

            let mut is_alias = false;
            let name = if let Some(target) = input.strip_prefix(b"npm:") {
                let (name, version) = split_npm_alias(target);
                if version.is_none() && is_range_after_npm_protocol(target) {
                    input = target;
                    alias
                } else {
                    is_alias = true;
                    input = version.unwrap_or_else(|| &target[target.len()..]);
                    sliced.sub(name).value()
                }
            } else {
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

            if is_alias && nameless_npm_alias(dependency).is_none() {
                if let Some(pm) = package_manager {
                    pm.record_npm_alias(alias_hash.unwrap(), dependency);
                }
            }

            Some(result)
        }
        Tag::DistTag => {
            let mut tag_to_use = sliced.sub(dependency).value();

            let actual = if let Some(target) = dependency.strip_prefix(b"npm:") {
                // npm:@foo/bar@latest
                let (name, dist_tag) = split_npm_alias(target);
                tag_to_use = sliced
                    .sub(dist_tag.unwrap_or_else(|| &target[target.len()..]))
                    .value();
                sliced.sub(name).value()
            } else {
                alias
            };

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
                                &input[0..index]
                            } else {
                                input
                            })
                            .value(),
                        committish: if let Some(index) = hash_index {
                            sliced.sub(&input[index + 1..]).value()
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

            // `info` is percent-decoded, and a `String` can only point into `dependency`.
            let (before_fragment, fragment) =
                strings::split_once_char(dependency, b'#').unwrap_or((dependency, b""));
            let find = |part: &[u8]| {
                if part.is_empty() {
                    return Some(String::default());
                }
                let at = strings::index_of(before_fragment, part)?;
                Some(sliced.sub(&before_fragment[at..at + part.len()]).value())
            };
            let committish = match info.committish() {
                None => String::default(),
                // `/tree/<committish>`
                Some(in_path) if fragment.is_empty() => find(in_path)?,
                // The URL parser drops these, and they must not end up in the request either.
                Some(_) if contains_control_character(fragment) => return None,
                // The fragment goes into the request as written, and GitHub decodes it.
                Some(_) => sliced.sub(fragment).value(),
            };

            Some(Version {
                literal: sliced.value(),
                value: Value {
                    github: ManuallyDrop::new(Repository {
                        owner: find(info.user().unwrap_or(b""))?,
                        repo: find(info.project())?,
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
                            bun_core::fmt::for_terminal(bstr::BStr::new(dependency))
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
                        uri: URI::Local(sliced.sub(dependency).value()),
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
                    if protocol == 1 && strings::starts_with_windows_drive_letter_t(dependency) {
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
                        format_args!(
                            "Unsupported protocol {}",
                            bun_core::fmt::for_terminal(bstr::BStr::new(dependency))
                        ),
                    );
                }
                return None;
            }

            Some(Version {
                value: Value {
                    folder: sliced.sub(dependency).value(),
                },
                tag: Tag::Folder,
                literal: sliced.value(),
            })
        }
        Tag::Uninitialized => Some(Version {
            tag: Tag::Uninitialized,
            literal: sliced.value(),
            value: Value::default(),
        }),
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
                    symlink: sliced.sub(dependency).value(),
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
            // bun.lockb stores the tag beside the literal.
            let group = dependency.strip_prefix(b"catalog:")?;

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
