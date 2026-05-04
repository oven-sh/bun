use core::cmp::Ordering;
use core::mem::ManuallyDrop;

use bun_logger as logger;
use bun_semver as Semver;
use bun_semver::{SlicedString, String};
use bun_str::strings;

use crate::hosted_git_info;
use crate::install::{Features, PackageManager, PackageNameHash};
use crate::repository::Repository;

// ──────────────────────────────────────────────────────────────────────────
// URI
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub enum URI {
    Local(String),
    Remote(String),
}

impl URI {
    pub fn eql(lhs: URI, rhs: URI, lhs_buf: &[u8], rhs_buf: &[u8]) -> bool {
        match (lhs, rhs) {
            (URI::Local(l), URI::Local(r)) => {
                strings::eql_long(l.slice(lhs_buf), r.slice(rhs_buf), true)
            }
            (URI::Remote(l), URI::Remote(r)) => {
                strings::eql_long(l.slice(lhs_buf), r.slice(rhs_buf), true)
            }
            _ => false,
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum URITag {
    Local,
    Remote,
}

// ──────────────────────────────────────────────────────────────────────────
// Dependency
// ──────────────────────────────────────────────────────────────────────────

pub struct Dependency {
    pub name_hash: PackageNameHash,
    pub name: String,
    pub version: Version,

    /// This is how the dependency is specified in the package.json file.
    /// This allows us to track whether a package originated in any permutation of:
    /// - `dependencies`
    /// - `devDependencies`
    /// - `optionalDependencies`
    /// - `peerDependencies`
    /// Technically, having the same package name specified under multiple fields is invalid
    /// But we don't want to allocate extra arrays for them. So we use a bitfield instead.
    pub behavior: Behavior,
}

impl Default for Dependency {
    fn default() -> Self {
        Dependency {
            name_hash: 0,
            name: String::default(),
            version: Version::default(),
            behavior: Behavior::default(),
        }
    }
}

impl Dependency {
    /// Sorting order for dependencies is:
    /// 1. [ `peerDependencies`, `optionalDependencies`, `devDependencies`, `dependencies` ]
    /// 2. name ASC
    /// "name" must be ASC so that later, when we rebuild the lockfile
    /// we insert it back in reverse order without an extra sorting pass
    pub fn is_less_than(string_buf: &[u8], lhs: &Dependency, rhs: &Dependency) -> bool {
        let behavior = lhs.behavior.cmp(rhs.behavior);
        if behavior != Ordering::Equal {
            return behavior == Ordering::Less;
        }

        let lhs_name = lhs.name.slice(string_buf);
        let rhs_name = rhs.name.slice(string_buf);
        strings::cmp_strings_asc((), lhs_name, rhs_name)
    }

    pub fn count_with_different_buffers<SB: StringBuilderLike>(
        &self,
        name_buf: &[u8],
        version_buf: &[u8],
        builder: &mut SB,
    ) {
        builder.count(self.name.slice(name_buf));
        builder.count(self.version.literal.slice(version_buf));
    }

    pub fn count<SB: StringBuilderLike>(&self, buf: &[u8], builder: &mut SB) {
        self.count_with_different_buffers(buf, buf, builder);
    }

    pub fn clone<SB: StringBuilderLike>(
        &self,
        package_manager: &mut PackageManager,
        buf: &[u8],
        builder: &mut SB,
    ) -> Result<Dependency, bun_core::Error> {
        // TODO(port): narrow error set
        self.clone_with_different_buffers(package_manager, buf, buf, builder)
    }

    pub fn clone_with_different_buffers<SB: StringBuilderLike>(
        &self,
        package_manager: &mut PackageManager,
        name_buf: &[u8],
        version_buf: &[u8],
        builder: &mut SB,
    ) -> Result<Dependency, bun_core::Error> {
        // TODO(port): narrow error set
        let out_slice = builder.lockfile().buffers.string_bytes.as_slice();
        let new_literal = builder.append_string(self.version.literal.slice(version_buf));
        let sliced = new_literal.sliced(out_slice);
        let new_name = builder.append_string(self.name.slice(name_buf));

        Ok(Dependency {
            name_hash: self.name_hash,
            name: new_name,
            version: parse_with_tag(
                new_name,
                Some(Semver::string::Builder::string_hash(new_name.slice(out_slice))),
                new_literal.slice(out_slice),
                self.version.tag,
                &sliced,
                None,
                Some(package_manager),
            )
            .unwrap_or_default(),
            behavior: self.behavior,
        })
    }

    /// Get the name of the package as it should appear in a remote registry.
    #[inline]
    pub fn realname(&self) -> String {
        // SAFETY: union field access guarded by tag
        unsafe {
            match self.version.tag {
                Tag::DistTag => self.version.value.dist_tag.name,
                Tag::Git => self.version.value.git.package_name,
                Tag::Github => self.version.value.github.package_name,
                Tag::Npm => self.version.value.npm.name,
                Tag::Tarball => self.version.value.tarball.package_name,
                _ => self.name,
            }
        }
    }

    #[inline]
    pub fn is_aliased(&self, buf: &[u8]) -> bool {
        // SAFETY: union field access guarded by tag
        unsafe {
            match self.version.tag {
                Tag::Npm => !self.version.value.npm.name.eql(self.name, buf, buf),
                Tag::DistTag => !self.version.value.dist_tag.name.eql(self.name, buf, buf),
                Tag::Git => !self.version.value.git.package_name.eql(self.name, buf, buf),
                Tag::Github => !self.version.value.github.package_name.eql(self.name, buf, buf),
                Tag::Tarball => !self.version.value.tarball.package_name.eql(self.name, buf, buf),
                _ => false,
            }
        }
    }

    pub fn eql(a: &Dependency, b: &Dependency, lhs_buf: &[u8], rhs_buf: &[u8]) -> bool {
        a.name_hash == b.name_hash
            && a.name.len() == b.name.len()
            && a.version.eql(&b.version, lhs_buf, rhs_buf)
    }
}

// TODO(port): `comptime StringBuilder: type` param replaced with trait bound;
// the only methods called are `.count`, `.append(String, ...)`, and `.lockfile`.
pub trait StringBuilderLike {
    fn count(&mut self, s: &[u8]);
    fn append_string(&mut self, s: &[u8]) -> String;
    fn lockfile(&self) -> &crate::lockfile::Lockfile;
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
    pub log: &'a mut logger::Log,
    pub buffer: &'a [u8],
    pub package_manager: Option<&'a mut PackageManager>,
}

pub fn to_dependency(this: External, ctx: &mut Context<'_>) -> Dependency {
    let name = String {
        bytes: this[0..8].try_into().unwrap(),
    };
    // SAFETY: same-size POD bitcast
    let name_hash: u64 = u64::from_ne_bytes(this[8..16].try_into().unwrap());
    Dependency {
        name,
        name_hash,
        behavior: Behavior::from_bits_retain(this[16]),
        version: Version::to_version(
            name,
            name_hash,
            this[17..SIZE].try_into().unwrap(),
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
                return i > if let Some(index) = at_index { index + 1 } else { 0 };
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

pub struct Version {
    pub tag: Tag,
    pub literal: String,
    pub value: Value,
}

impl Default for Version {
    fn default() -> Self {
        Version {
            tag: Tag::Uninitialized,
            literal: String::default(),
            value: Value { uninitialized: () },
        }
    }
}

pub type VersionExternal = [u8; 9];

impl Version {
    #[inline]
    pub fn npm(&self) -> Option<&NpmInfo> {
        if self.tag == Tag::Npm {
            // SAFETY: tag-guarded union access
            Some(unsafe { &*self.value.npm })
        } else {
            None
        }
    }

    // Zig: `pub const zeroed = Version{};` — a const value. Rust can't const-init
    // (Default::default() isn't const), so callers should use `Version::zeroed()`
    // or `Version::default()` instead.
    #[inline]
    pub fn zeroed() -> Version {
        Version::default()
    }

    pub fn clone<SB: StringBuilderLike>(
        &self,
        buf: &[u8],
        builder: &mut SB,
    ) -> Result<Version, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(Version {
            tag: self.tag,
            literal: builder.append_string(self.literal.slice(buf)),
            // TODO(port): Value::clone not defined in this file; assumed on Value
            value: self.value.clone(self.tag, buf, builder)?,
        })
    }

    pub fn is_less_than(string_buf: &[u8], lhs: &Version, rhs: &Version) -> bool {
        debug_assert!(lhs.tag == rhs.tag);
        strings::cmp_strings_asc((), lhs.literal.slice(string_buf), rhs.literal.slice(string_buf))
    }

    pub fn is_less_than_with_tag(string_buf: &[u8], lhs: &Version, rhs: &Version) -> bool {
        let tag_order = lhs.tag.cmp(rhs.tag);
        if tag_order != Ordering::Equal {
            return tag_order == Ordering::Less;
        }

        strings::cmp_strings_asc((), lhs.literal.slice(string_buf), rhs.literal.slice(string_buf))
    }

    pub fn to_version(
        alias: String,
        alias_hash: PackageNameHash,
        bytes: VersionExternal,
        ctx: &mut Context<'_>,
    ) -> Version {
        let slice = String {
            bytes: bytes[1..9].try_into().unwrap(),
        };
        // SAFETY: bytes[0] was written by to_external from a valid Tag
        let tag: Tag = unsafe { core::mem::transmute::<u8, Tag>(bytes[0]) };
        let sliced = slice.sliced(ctx.buffer);
        parse_with_tag(
            alias,
            Some(alias_hash),
            sliced.slice,
            tag,
            &sliced,
            Some(ctx.log),
            ctx.package_manager.as_deref_mut(),
        )
        .unwrap_or_default()
    }

    #[inline]
    pub fn to_external(&self) -> VersionExternal {
        let mut bytes: VersionExternal = [0u8; 9];
        bytes[0] = self.tag as u8;
        bytes[1..9].copy_from_slice(&self.literal.bytes);
        bytes
    }

    #[inline]
    pub fn eql(&self, rhs: &Version, lhs_buf: &[u8], rhs_buf: &[u8]) -> bool {
        if self.tag != rhs.tag {
            return false;
        }

        // SAFETY: every union access below is guarded by self.tag == rhs.tag
        unsafe {
            match self.tag {
                // if the two versions are identical as strings, it should often be faster to compare that than the actual semver version
                // semver ranges involve a ton of pointer chasing
                Tag::Npm => {
                    strings::eql_long(
                        self.literal.slice(lhs_buf),
                        rhs.literal.slice(rhs_buf),
                        true,
                    ) || self.value.npm.eql(&rhs.value.npm, lhs_buf, rhs_buf)
                }
                Tag::Folder | Tag::DistTag => {
                    self.literal.eql(rhs.literal, lhs_buf, rhs_buf)
                }
                Tag::Git => self.value.git.eql(&rhs.value.git, lhs_buf, rhs_buf),
                Tag::Github => self.value.github.eql(&rhs.value.github, lhs_buf, rhs_buf),
                Tag::Tarball => self
                    .value
                    .tarball
                    .eql(&rhs.value.tarball, lhs_buf, rhs_buf),
                Tag::Symlink => self.value.symlink.eql(rhs.value.symlink, lhs_buf, rhs_buf),
                Tag::Workspace => {
                    self.value.workspace.eql(rhs.value.workspace, lhs_buf, rhs_buf)
                }
                _ => true,
            }
        }
    }
}

impl Drop for Version {
    fn drop(&mut self) {
        if self.tag == Tag::Npm {
            // SAFETY: tag-guarded union access; npm.version owns heap data
            unsafe {
                ManuallyDrop::drop(&mut self.value.npm);
            }
        }
        // other variants are POD / borrowed-slice-backed
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Version::Tag
// ──────────────────────────────────────────────────────────────────────────

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Tag {
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
    /// https://docs.npmjs.com/cli/v8/commands/npm-link#synopsis
    /// https://stackoverflow.com/questions/51954956/whats-the-difference-between-yarn-link-and-npm-link
    Symlink = 5,

    /// Local path specified under `workspaces`
    Workspace = 6,

    /// Git Repository (via `git` CLI)
    Git = 7,

    /// GitHub Repository (via REST API)
    Github = 8,

    Catalog = 9,
}

pub static TAG_MAP: phf::Map<&'static [u8], Tag> = phf::phf_map! {
    b"npm" => Tag::Npm,
    b"dist_tag" => Tag::DistTag,
    b"tarball" => Tag::Tarball,
    b"folder" => Tag::Folder,
    b"symlink" => Tag::Symlink,
    b"workspace" => Tag::Workspace,
    b"git" => Tag::Git,
    b"github" => Tag::Github,
    b"catalog" => Tag::Catalog,
};

impl Tag {
    pub fn cmp(self, other: Tag) -> Ordering {
        // TODO: align with yarn
        (self as u8).cmp(&(other as u8))
    }

    #[inline]
    pub fn is_npm(self) -> bool {
        (self as u8) < 3
    }

    pub fn infer(dependency: &[u8]) -> Tag {
        // empty string means `latest`
        if dependency.is_empty() {
            return Tag::DistTag;
        }

        if strings::starts_with_windows_drive_letter(dependency)
            && bun_paths::is_sep(dependency[2])
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
                                    if hosted_git_info::is_github_shorthand(
                                        &url[b"hub:".len()..],
                                    ) {
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

                        if let Ok(Some(info)) =
                            hosted_git_info::HostedGitInfo::from_url(dependency)
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

                        if let Ok(Some(info)) =
                            hosted_git_info::HostedGitInfo::from_url(dependency)
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
                    let remain = &dependency
                        [b"npm:".len() + (dependency[b"npm:".len()] == b'@') as usize..];
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

pub struct NpmInfo {
    pub name: String,
    pub version: Semver::Query::Group,
    pub is_alias: bool,
}

impl NpmInfo {
    fn eql(&self, that: &NpmInfo, this_buf: &[u8], that_buf: &[u8]) -> bool {
        self.name.eql(that.name, this_buf, that_buf) && self.version.eql(&that.version)
    }
}

#[derive(Clone, Copy)]
pub struct TagInfo {
    pub name: String,
    pub tag: String,
}

impl TagInfo {
    fn eql(&self, that: &TagInfo, this_buf: &[u8], that_buf: &[u8]) -> bool {
        self.name.eql(that.name, this_buf, that_buf)
            && self.tag.eql(that.tag, this_buf, that_buf)
    }
}

#[derive(Clone, Copy)]
pub struct TarballInfo {
    pub uri: URI,
    pub package_name: String,
}

impl Default for TarballInfo {
    fn default() -> Self {
        TarballInfo {
            uri: URI::Local(String::default()),
            package_name: String::default(),
        }
    }
}

impl TarballInfo {
    fn eql(&self, that: &TarballInfo, this_buf: &[u8], that_buf: &[u8]) -> bool {
        URI::eql(self.uri, that.uri, this_buf, that_buf)
    }
}

/// Untagged union; discriminant is stored in `Version.tag`.
#[repr(C)]
pub union Value {
    pub uninitialized: (),

    pub npm: ManuallyDrop<NpmInfo>,
    pub dist_tag: TagInfo,
    pub tarball: TarballInfo,
    pub folder: String,

    /// Equivalent to npm link
    pub symlink: String,

    pub workspace: String,
    pub git: ManuallyDrop<Repository>,
    pub github: ManuallyDrop<Repository>,

    // dep version without 'catalog:' protocol
    // empty string == default catalog
    pub catalog: String,
}

impl Value {
    // TODO(port): `clone` is called in Version::clone but not defined in
    // dependency.zig — likely lives elsewhere or relies on Zig copy semantics.
    pub fn clone<SB: StringBuilderLike>(
        &self,
        _tag: Tag,
        _buf: &[u8],
        _builder: &mut SB,
    ) -> Result<Value, bun_core::Error> {
        // TODO(port): implement Value::clone (not in source file)
        unreachable!("Value::clone: port pending")
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
        if strings::starts_with_windows_drive_letter(&dep[i..]) {
            return Some(&dep[i..]);
        }
    }

    None
}

#[inline]
pub fn parse(
    alias: String,
    alias_hash: Option<PackageNameHash>,
    dependency: &[u8],
    sliced: &SlicedString,
    log: Option<&mut logger::Log>,
    manager: Option<&mut PackageManager>,
) -> Option<Version> {
    let dep = strings::trim_left(dependency, b" \t\n\r");
    parse_with_tag(alias, alias_hash, dep, Tag::infer(dep), sliced, log, manager)
}

pub fn parse_with_optional_tag(
    alias: String,
    alias_hash: Option<PackageNameHash>,
    dependency: &[u8],
    tag: Option<Tag>,
    sliced: &SlicedString,
    log: Option<&mut logger::Log>,
    package_manager: Option<&mut PackageManager>,
) -> Option<Version> {
    let dep = strings::trim_left(dependency, b" \t\n\r");
    parse_with_tag(
        alias,
        alias_hash,
        dep,
        tag.unwrap_or_else(|| Tag::infer(dep)),
        sliced,
        log,
        package_manager,
    )
}

pub fn parse_with_tag(
    alias: String,
    alias_hash: Option<PackageNameHash>,
    dependency: &[u8],
    tag: Tag,
    sliced: &SlicedString,
    log_: Option<&mut logger::Log>,
    package_manager: Option<&mut PackageManager>,
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

            let version = match Semver::Query::parse(input, sliced.sub(input)) {
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
                    pm.known_npm_aliases
                        .put(alias_hash.unwrap(), &result)
                        .expect("unreachable");
                    // TODO(port): Zig moves `result` into map by value; here we
                    // can't both store and return ownership. Phase B: clone or
                    // change map value type.
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
            let owner_str: &[u8] = info.user.as_deref().unwrap_or(b"");
            let repo_str: &[u8] = &info.project;
            let committish_str: &[u8] = info.committish.as_deref().unwrap_or(b"");

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
                        logger::Loc::EMPTY,
                        format_args!(
                            "invalid or unsupported dependency \"{}\"",
                            bstr::BStr::new(dependency)
                        ),
                    )
                    .expect("unreachable");
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
                            if dependency.len() > protocol + 1
                                && dependency[protocol + 1] == b'/'
                            {
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
                        logger::Loc::EMPTY,
                        format_args!("Unsupported protocol {}", bstr::BStr::new(dependency)),
                    )
                    .expect("unreachable");
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

            let trimmed = strings::trim(group, strings::WHITESPACE_CHARS);

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
// Behavior
// ──────────────────────────────────────────────────────────────────────────

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub struct Behavior: u8 {
        // bit 0: _unused_1
        const PROD      = 1 << 1;
        const OPTIONAL  = 1 << 2;
        const DEV       = 1 << 3;
        const PEER      = 1 << 4;
        const WORKSPACE = 1 << 5;
        /// Is not set for transitive bundled dependencies
        const BUNDLED   = 1 << 6;
        // bit 7: _unused_2
    }
}

impl Behavior {
    #[inline]
    pub fn is_prod(self) -> bool {
        self.contains(Behavior::PROD)
    }

    #[inline]
    pub fn is_optional(self) -> bool {
        self.contains(Behavior::OPTIONAL) && !self.contains(Behavior::PEER)
    }

    #[inline]
    pub fn is_optional_peer(self) -> bool {
        self.contains(Behavior::OPTIONAL) && self.contains(Behavior::PEER)
    }

    #[inline]
    pub fn is_dev(self) -> bool {
        self.contains(Behavior::DEV)
    }

    #[inline]
    pub fn is_peer(self) -> bool {
        self.contains(Behavior::PEER)
    }

    #[inline]
    pub fn is_workspace(self) -> bool {
        self.contains(Behavior::WORKSPACE)
    }

    #[inline]
    pub fn is_bundled(self) -> bool {
        self.contains(Behavior::BUNDLED)
    }

    #[inline]
    pub fn eq(lhs: Behavior, rhs: Behavior) -> bool {
        lhs.bits() == rhs.bits()
    }

    #[inline]
    pub fn includes(lhs: Behavior, rhs: Behavior) -> bool {
        lhs.bits() & rhs.bits() != 0
    }

    #[inline]
    pub fn add(self, kind: Behavior) -> Behavior {
        // TODO(port): Zig took `@Type(.enum_literal)`; callers now pass Behavior::FLAG
        self | kind
    }

    #[inline]
    pub fn with(self, kind: Behavior, value: bool) -> Behavior {
        // TODO(port): renamed from `set` (collides with bitflags::Flags::set)
        let mut new = self;
        new.set(kind, value);
        new
    }

    #[inline]
    pub fn cmp(self, rhs: Behavior) -> Ordering {
        if Behavior::eq(self, rhs) {
            return Ordering::Equal;
        }

        if self.is_workspace() != rhs.is_workspace() {
            // ensure workspaces are placed at the beginning
            return if self.is_workspace() {
                Ordering::Less
            } else {
                Ordering::Greater
            };
        }

        if self.is_dev() != rhs.is_dev() {
            return if self.is_dev() {
                Ordering::Less
            } else {
                Ordering::Greater
            };
        }

        if self.is_optional() != rhs.is_optional() {
            return if self.is_optional() {
                Ordering::Less
            } else {
                Ordering::Greater
            };
        }

        if self.is_prod() != rhs.is_prod() {
            return if self.is_prod() {
                Ordering::Less
            } else {
                Ordering::Greater
            };
        }

        if self.is_peer() != rhs.is_peer() {
            return if self.is_peer() {
                Ordering::Less
            } else {
                Ordering::Greater
            };
        }

        Ordering::Equal
    }

    #[inline]
    pub fn is_required(self) -> bool {
        !self.is_optional()
    }

    pub fn is_enabled(self, features: Features) -> bool {
        self.is_prod()
            || (features.optional_dependencies && self.is_optional())
            || (features.dev_dependencies && self.is_dev())
            || (features.peer_dependencies && self.is_peer())
            || (features.workspaces && self.is_workspace())
    }
}

const _: () = assert!(Behavior::PROD.bits() == (1 << 1));
const _: () = assert!(Behavior::OPTIONAL.bits() == (1 << 2));
const _: () = assert!(Behavior::DEV.bits() == (1 << 3));
const _: () = assert!(Behavior::PEER.bits() == (1 << 4));
const _: () = assert!(Behavior::WORKSPACE.bits() == (1 << 5));

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/dependency.zig (1340 lines)
//   confidence: medium
//   todos:      10
//   notes:      Value is untagged union (ManuallyDrop fields); Value::clone body missing in source; allocator params dropped; *_jsc aliases removed; Behavior.set renamed to with(); Version::zeroed is fn() not const
// ──────────────────────────────────────────────────────────────────────────
