use core::cmp::Ordering;
use core::fmt;

use bstr::BStr;

use bun_alloc::AllocError;
use bun_core::fmt::{PathFormatOptions, PathSep, fmt_path_u8 as fmt_path};
use bun_semver as semver;
use bun_semver::String;
// PORT NOTE: Zig `String.Buf` → `bun_semver::string::Buf<'_>`.
use bun_core::strings;
use bun_semver::string::Buf as StringBuf;
use bun_semver::version::VersionInt;

use crate::dependency::{self, DependencyExt as _, TagExt as _};
use crate::repository::{Repository, RepositoryExt as _};
use crate::versioned_url::VersionedURLType;

pub type Resolution = ResolutionType<u64>;
pub type OldV2Resolution = ResolutionType<u32>;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ResolutionType<SemverInt: VersionInt> {
    pub tag: Tag,
    pub _padding: [u8; 7],
    pub value: Value<SemverInt>,
}

/// Compat alias for the stub-era flat `npm` field type. Identical layout to
/// `VersionedURLType<u64>` (`{ version, url }`); kept so existing
/// `Value { npm: NpmVersionInfo { .. } }` initializers keep resolving.
pub type NpmVersionInfo = VersionedURLType<u64>;

impl<SemverInt: VersionInt> Default for ResolutionType<SemverInt> {
    fn default() -> Self {
        Self {
            tag: Tag::Uninitialized,
            _padding: [0; 7],
            value: Value { uninitialized: () },
        }
    }
}

/// Rust-side equivalent of `bun.meta.Tagged(Value, Tag)` — a tagged view of `Value`
/// used by [`ResolutionType::init`] / [`value_init`] to construct a zero-padded union.
// `Tag` is a `#[repr(transparent)] struct Tag(u8)` with sparse `pub const`
// associated values; the derive maps `Self::Variant` → `Tag::Variant` by name.
#[derive(bun_core::EnumTag)]
#[enum_tag(existing = Tag)]
pub enum TaggedValue<SemverInt: VersionInt> {
    Uninitialized,
    Root,
    Npm(VersionedURLType<SemverInt>),
    Folder(String),
    LocalTarball(String),
    Github(Repository),
    Git(Repository),
    Symlink(String),
    Workspace(String),
    RemoteTarball(String),
    SingleFileModule(String),
}

impl<SemverInt: VersionInt> ResolutionType<SemverInt> {
    /// Const-evaluable zeroed sentinel. Mirrors `Default::default()` but usable
    /// in `const` / `static` position (e.g. dummy `&'static Resolution` returns).
    /// Only the tag/padding are guaranteed zero — the union payload is the
    /// `uninitialized` variant, which is the only field a `Tag::Uninitialized`
    /// reader may legally access.
    pub const ZEROED: Self = Self {
        tag: Tag::Uninitialized,
        _padding: [0; 7],
        value: Value { uninitialized: () },
    };

    /// Use like Resolution.init(.{ .npm = VersionedURL{ ... } })
    #[inline]
    pub fn init(value: TaggedValue<SemverInt>) -> Self {
        Self {
            tag: value.tag(),
            _padding: [0; 7],
            value: value_init(value),
        }
    }

    /// Port of `Resolution.init(.{ .root = {} })` — convenience constructor.
    #[inline]
    pub fn init_root() -> Self {
        Self::init(TaggedValue::Root)
    }

    /// Port of `Resolution.init(.{ .symlink = s })` — convenience constructor.
    #[inline]
    pub fn init_symlink(s: String) -> Self {
        Self::init(TaggedValue::Symlink(s))
    }

    // ── Tag-checked union accessors ────────────────────────────────────────
    // Every `Value` payload is `Copy` (`String` handles, `Repository`,
    // `VersionedURLType`) and the union is zero-initialized, so reading the
    // wrong variant is well-defined garbage — the macro debug-asserts the tag.
    bun_core::extern_union_accessors! {
        tag: tag as Tag, value: value;
        Npm              => npm: VersionedURLType<SemverInt>, mut npm_mut;
        Folder           => folder: String;
        LocalTarball     => local_tarball: String;
        RemoteTarball    => remote_tarball: String;
        Workspace        => workspace: String;
        Symlink          => symlink: String;
        SingleFileModule => single_file_module: String;
        Git              => git: Repository, mut git_mut;
        Github           => github: Repository, mut github_mut;
    }
    /// `git` or `github` payload — they share the [`Repository`] shape.
    #[inline]
    pub fn repository(&self) -> &Repository {
        debug_assert!(self.tag == Tag::Git || self.tag == Tag::Github);
        // SAFETY: `git` and `github` occupy the same union slot type
        // (`Repository`); tag asserted to be one of the two.
        unsafe { &(*core::ptr::from_ref(&self.value)).git }
    }

    pub fn is_git(&self) -> bool {
        self.tag.is_git()
    }

    pub fn can_enqueue_install_task(&self) -> bool {
        self.tag.can_enqueue_install_task()
    }

    pub fn from_text_lockfile(
        res_str: &[u8],
        string_buf: &mut StringBuf,
    ) -> Result<Self, FromTextLockfileError> {
        if res_str.starts_with(b"root:") {
            return Ok(Self::init(TaggedValue::Root));
        }

        if let Some(link) = strings::without_prefix_if_possible_comptime(res_str, b"link:") {
            return Ok(Self::init(TaggedValue::Symlink(string_buf.append(link)?)));
        }

        if let Some(workspace) =
            strings::without_prefix_if_possible_comptime(res_str, b"workspace:")
        {
            return Ok(Self::init(TaggedValue::Workspace(
                string_buf.append(workspace)?,
            )));
        }

        if let Some(folder) = strings::without_prefix_if_possible_comptime(res_str, b"file:") {
            return Ok(Self::init(TaggedValue::Folder(string_buf.append(folder)?)));
        }

        match dependency::VersionTag::infer(res_str) {
            dependency::VersionTag::Git => Ok(Self::init(TaggedValue::Git(
                Repository::parse_append_git(res_str, string_buf)?,
            ))),
            dependency::VersionTag::Github => Ok(Self::init(TaggedValue::Github(
                Repository::parse_append_github(res_str, string_buf)?,
            ))),
            dependency::VersionTag::Tarball => {
                if dependency::is_remote_tarball(res_str) {
                    return Ok(Self::init(TaggedValue::RemoteTarball(
                        string_buf.append(res_str)?,
                    )));
                }

                Ok(Self::init(TaggedValue::LocalTarball(
                    string_buf.append(res_str)?,
                )))
            }
            dependency::VersionTag::Npm => {
                let version_literal = string_buf.append(res_str)?;
                let parsed = semver::VersionType::<SemverInt>::parse(
                    version_literal.sliced(string_buf.bytes.as_slice()),
                );

                if !parsed.valid {
                    return Err(FromTextLockfileError::UnexpectedResolution);
                }

                if parsed.version.major.is_none()
                    || parsed.version.minor.is_none()
                    || parsed.version.patch.is_none()
                {
                    return Err(FromTextLockfileError::UnexpectedResolution);
                }

                Ok(Self {
                    tag: Tag::Npm,
                    _padding: [0; 7],
                    value: Value {
                        npm: VersionedURLType {
                            version: parsed.version.min(),

                            // will fill this later
                            url: String::default(),
                        },
                    },
                })
            }

            // covered above
            dependency::VersionTag::Workspace => Err(FromTextLockfileError::UnexpectedResolution),
            dependency::VersionTag::Symlink => Err(FromTextLockfileError::UnexpectedResolution),
            dependency::VersionTag::Folder => Err(FromTextLockfileError::UnexpectedResolution),

            // even though it's a dependency type, it's not
            // possible for 'catalog:' to be written to the
            // lockfile for any resolution because the install
            // will fail it it's not successfully replaced by
            // a version
            dependency::VersionTag::Catalog => Err(FromTextLockfileError::UnexpectedResolution),

            // should not happen
            dependency::VersionTag::DistTag => Err(FromTextLockfileError::UnexpectedResolution),
            dependency::VersionTag::Uninitialized => {
                Err(FromTextLockfileError::UnexpectedResolution)
            }
        }
    }

    pub fn from_pnpm_lockfile(
        res_str: &[u8],
        string_buf: &mut StringBuf,
    ) -> Result<Resolution, FromPnpmLockfileError> {
        if let Some(user_repo_tar_committish) =
            strings::without_prefix_if_possible_comptime(res_str, b"https://codeload.github.com/")
        {
            let Some(user_end) = strings::index_of_char_usize(user_repo_tar_committish, b'/')
            else {
                return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
            };
            let user = &user_repo_tar_committish[..user_end];
            let repo_tar_committish = &user_repo_tar_committish[user_end + 1..];

            let Some(repo_end) = strings::index_of_char_usize(repo_tar_committish, b'/') else {
                return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
            };
            let repo = &repo_tar_committish[..repo_end];
            let tar_committish = &repo_tar_committish[repo_end + 1..];

            let Some(tar_end) = strings::index_of_char_usize(tar_committish, b'/') else {
                return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
            };
            let committish = &tar_committish[tar_end + 1..];

            return Ok(Resolution::init(TaggedValue::Github(Repository {
                owner: string_buf.append(user)?,
                repo: string_buf.append(repo)?,
                committish: string_buf.append(committish)?,
                ..Default::default()
            })));
        }

        if let Some(path) = strings::without_prefix_if_possible_comptime(res_str, b"file:") {
            if res_str.ends_with(b".tgz") {
                return Ok(Resolution::init(TaggedValue::LocalTarball(
                    string_buf.append(path)?,
                )));
            }
            return Ok(Resolution::init(TaggedValue::Folder(
                string_buf.append(path)?,
            )));
        }

        match dependency::VersionTag::infer(res_str) {
            dependency::VersionTag::Git => Ok(Resolution::init(TaggedValue::Git(
                Repository::parse_append_git(res_str, string_buf)?,
            ))),
            dependency::VersionTag::Github => Ok(Resolution::init(TaggedValue::Github(
                Repository::parse_append_github(res_str, string_buf)?,
            ))),
            dependency::VersionTag::Tarball => {
                if dependency::is_remote_tarball(res_str) {
                    return Ok(Resolution::init(TaggedValue::RemoteTarball(
                        string_buf.append(res_str)?,
                    )));
                }
                Ok(Resolution::init(TaggedValue::LocalTarball(
                    string_buf.append(res_str)?,
                )))
            }
            dependency::VersionTag::Npm => {
                let version_literal = string_buf.append(res_str)?;
                // PORT NOTE: this fn returns `Resolution` (= `ResolutionType<u64>`),
                // not `Self`, so parse at `u64` regardless of the impl's SemverInt.
                let parsed =
                    semver::Version::parse(version_literal.sliced(string_buf.bytes.as_slice()));

                if !parsed.valid {
                    return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
                }

                if parsed.version.major.is_none()
                    || parsed.version.minor.is_none()
                    || parsed.version.patch.is_none()
                {
                    return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
                }

                Ok(Resolution::init(TaggedValue::Npm(VersionedURLType {
                    version: parsed.version.min(),
                    // set afterwards
                    url: String::default(),
                })))
            }

            dependency::VersionTag::Workspace => Err(FromPnpmLockfileError::InvalidPnpmLockfile),
            dependency::VersionTag::Symlink => Err(FromPnpmLockfileError::InvalidPnpmLockfile),
            dependency::VersionTag::Folder => Err(FromPnpmLockfileError::InvalidPnpmLockfile),
            dependency::VersionTag::Catalog => Err(FromPnpmLockfileError::InvalidPnpmLockfile),
            dependency::VersionTag::DistTag => Err(FromPnpmLockfileError::InvalidPnpmLockfile),
            dependency::VersionTag::Uninitialized => {
                Err(FromPnpmLockfileError::InvalidPnpmLockfile)
            }
        }
    }

    pub fn order(&self, rhs: &Self, lhs_buf: &[u8], rhs_buf: &[u8]) -> Ordering {
        if self.tag != rhs.tag {
            return self.tag.0.cmp(&rhs.tag.0);
        }

        match self.tag {
            Tag::Npm => self.npm().order(rhs.npm(), lhs_buf, rhs_buf),
            Tag::LocalTarball => self
                .local_tarball()
                .order(rhs.local_tarball(), lhs_buf, rhs_buf),
            Tag::Folder => self.folder().order(rhs.folder(), lhs_buf, rhs_buf),
            Tag::RemoteTarball => {
                self.remote_tarball()
                    .order(rhs.remote_tarball(), lhs_buf, rhs_buf)
            }
            Tag::Workspace => self.workspace().order(rhs.workspace(), lhs_buf, rhs_buf),
            Tag::Symlink => self.symlink().order(rhs.symlink(), lhs_buf, rhs_buf),
            Tag::SingleFileModule => {
                self.single_file_module()
                    .order(rhs.single_file_module(), lhs_buf, rhs_buf)
            }
            Tag::Git => self.git().order(rhs.git(), lhs_buf, rhs_buf),
            Tag::Github => self.github().order(rhs.github(), lhs_buf, rhs_buf),
            _ => Ordering::Equal,
        }
    }

    pub fn count<B>(&self, buf: &[u8], builder: &mut B)
    where
        B: StringBuilderLike,
    {
        match self.tag {
            Tag::Npm => self.npm().count(buf, builder),
            Tag::LocalTarball => builder.count(self.local_tarball().slice(buf)),
            Tag::Folder => builder.count(self.folder().slice(buf)),
            Tag::RemoteTarball => builder.count(self.remote_tarball().slice(buf)),
            Tag::Workspace => builder.count(self.workspace().slice(buf)),
            Tag::Symlink => builder.count(self.symlink().slice(buf)),
            Tag::SingleFileModule => builder.count(self.single_file_module().slice(buf)),
            Tag::Git => self.git().count(buf, builder),
            Tag::Github => self.github().count(buf, builder),
            _ => {}
        }
    }

    /// Named `clone_into` (not `clone`) to avoid shadowing `Clone::clone` now
    /// that `ResolutionType: Clone + Copy`. Mirrors Zig
    /// `Resolution.clone(buf, Builder, builder)`.
    pub fn clone_into<B>(&self, buf: &[u8], builder: &mut B) -> Self
    where
        B: StringBuilderLike,
    {
        let value = match self.tag {
            Tag::Npm => value_init(TaggedValue::Npm(self.npm().clone(buf, builder))),
            Tag::LocalTarball => value_init(TaggedValue::LocalTarball(
                builder.append::<String>(self.local_tarball().slice(buf)),
            )),
            Tag::Folder => value_init(TaggedValue::Folder(
                builder.append::<String>(self.folder().slice(buf)),
            )),
            Tag::RemoteTarball => value_init(TaggedValue::RemoteTarball(
                builder.append::<String>(self.remote_tarball().slice(buf)),
            )),
            Tag::Workspace => value_init(TaggedValue::Workspace(
                builder.append::<String>(self.workspace().slice(buf)),
            )),
            Tag::Symlink => value_init(TaggedValue::Symlink(
                builder.append::<String>(self.symlink().slice(buf)),
            )),
            Tag::SingleFileModule => value_init(TaggedValue::SingleFileModule(
                builder.append::<String>(self.single_file_module().slice(buf)),
            )),
            Tag::Git => value_init(TaggedValue::Git(self.git().clone(buf, builder))),
            Tag::Github => value_init(TaggedValue::Github(self.github().clone(buf, builder))),
            Tag::Root => value_init(TaggedValue::Root),
            Tag::Uninitialized => value_init(TaggedValue::Uninitialized),
            _ => panic!("Internal error: unexpected resolution tag: {}", self.tag.0),
        };
        Self {
            tag: self.tag,
            _padding: [0; 7],
            value,
        }
    }

    pub fn copy(&self) -> Self {
        match self.tag {
            Tag::Npm => Self::init(TaggedValue::Npm(*self.npm())),
            Tag::LocalTarball => Self::init(TaggedValue::LocalTarball(*self.local_tarball())),
            Tag::Folder => Self::init(TaggedValue::Folder(*self.folder())),
            Tag::RemoteTarball => Self::init(TaggedValue::RemoteTarball(*self.remote_tarball())),
            Tag::Workspace => Self::init(TaggedValue::Workspace(*self.workspace())),
            Tag::Symlink => Self::init(TaggedValue::Symlink(*self.symlink())),
            Tag::SingleFileModule => {
                Self::init(TaggedValue::SingleFileModule(*self.single_file_module()))
            }
            Tag::Git => Self::init(TaggedValue::Git(*self.git())),
            Tag::Github => Self::init(TaggedValue::Github(*self.github())),
            Tag::Root => Self::init(TaggedValue::Root),
            Tag::Uninitialized => Self::init(TaggedValue::Uninitialized),
            _ => panic!("Internal error: unexpected resolution tag: {}", self.tag.0),
        }
    }

    pub fn fmt<'a>(
        &'a self,
        string_bytes: &'a [u8],
        path_sep: PathSep,
    ) -> Formatter<'a, SemverInt> {
        Formatter {
            resolution: self,
            buf: string_bytes,
            path_sep,
        }
    }

    pub fn fmt_store_path<'a>(&'a self, string_buf: &'a [u8]) -> StorePathFormatter<'a, SemverInt> {
        StorePathFormatter {
            res: self,
            string_buf,
        }
    }

    pub fn fmt_url<'a>(&'a self, string_bytes: &'a [u8]) -> URLFormatter<'a, SemverInt> {
        URLFormatter {
            resolution: self,
            buf: string_bytes,
        }
    }

    pub fn fmt_for_debug<'a>(&'a self, string_bytes: &'a [u8]) -> DebugFormatter<'a, SemverInt> {
        DebugFormatter {
            resolution: self,
            buf: string_bytes,
        }
    }

    pub fn eql(&self, rhs: &Self, lhs_string_buf: &[u8], rhs_string_buf: &[u8]) -> bool {
        if self.tag != rhs.tag {
            return false;
        }

        match self.tag {
            Tag::Root => true,
            Tag::Npm => self.npm().eql(rhs.npm()),
            Tag::LocalTarball => {
                self.local_tarball()
                    .eql(*rhs.local_tarball(), lhs_string_buf, rhs_string_buf)
            }
            Tag::Folder => self
                .folder()
                .eql(*rhs.folder(), lhs_string_buf, rhs_string_buf),
            Tag::RemoteTarball => {
                self.remote_tarball()
                    .eql(*rhs.remote_tarball(), lhs_string_buf, rhs_string_buf)
            }
            Tag::Workspace => {
                self.workspace()
                    .eql(*rhs.workspace(), lhs_string_buf, rhs_string_buf)
            }
            Tag::Symlink => self
                .symlink()
                .eql(*rhs.symlink(), lhs_string_buf, rhs_string_buf),
            Tag::SingleFileModule => self.single_file_module().eql(
                *rhs.single_file_module(),
                lhs_string_buf,
                rhs_string_buf,
            ),
            Tag::Git => self.git().eql(rhs.git(), lhs_string_buf, rhs_string_buf),
            Tag::Github => self
                .github()
                .eql(rhs.github(), lhs_string_buf, rhs_string_buf),
            _ => unreachable!(),
        }
    }
}

// PORT NOTE: the duck-typed `Builder` Zig comptime param maps to the
// `bun_semver::StringBuilder` trait (`count` + `append<T>`); local alias kept
// so dependents that named `resolution::StringBuilderLike` still resolve.
pub use bun_semver::StringBuilder as StringBuilderLike;

pub struct StorePathFormatter<'a, SemverInt: VersionInt> {
    res: &'a ResolutionType<SemverInt>,
    string_buf: &'a [u8],
    // opts: String.StorePathFormatter.Options,
}

impl<'a, SemverInt: VersionInt> fmt::Display for StorePathFormatter<'a, SemverInt> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let string_buf = self.string_buf;
        let res = self.res;
        match res.tag {
            Tag::Root => writer.write_str("root"),
            Tag::Npm => write!(writer, "{}", res.npm().version.fmt(string_buf)),
            Tag::LocalTarball => {
                write!(writer, "{}", res.local_tarball().fmt_store_path(string_buf))
            }
            Tag::RemoteTarball => {
                write!(
                    writer,
                    "{}",
                    res.remote_tarball().fmt_store_path(string_buf)
                )
            }
            Tag::Folder => write!(writer, "{}", res.folder().fmt_store_path(string_buf)),
            Tag::Git => write!(writer, "{}", res.git().fmt_store_path("git+", string_buf)),
            Tag::Github => {
                write!(
                    writer,
                    "{}",
                    res.github().fmt_store_path("github+", string_buf)
                )
            }
            Tag::Workspace => write!(writer, "{}", res.workspace().fmt_store_path(string_buf)),
            Tag::Symlink => write!(writer, "{}", res.symlink().fmt_store_path(string_buf)),
            Tag::SingleFileModule => {
                write!(
                    writer,
                    "{}",
                    res.single_file_module().fmt_store_path(string_buf)
                )
            }
            _ => Ok(()),
        }
    }
}

pub struct URLFormatter<'a, SemverInt: VersionInt> {
    resolution: &'a ResolutionType<SemverInt>,

    buf: &'a [u8],
}

impl<'a, SemverInt: VersionInt> URLFormatter<'a, SemverInt> {
    /// Byte-exact port of Zig `URLFormatter.format` (`writer.writeAll` / `{s}`).
    ///
    /// Prefer this over the `Display` impl whenever the output is persisted to
    /// disk (yarn.lock, lockfile JSON): `core::fmt::Display` routes through
    /// `&str` and the `BStr` adapter is *lossy* on non-UTF-8 bytes (a Linux
    /// folder/tarball path under a Latin-1 directory would emit U+FFFD instead
    /// of the original byte). `write_to` mirrors Zig's `writeAll(slice)` and
    /// pushes the lockfile string-buffer bytes through unchanged.
    pub fn write_to<W>(&self, writer: &mut W) -> Result<(), bun_core::Error>
    where
        W: bun_core::io::Write + ?Sized,
    {
        let buf = self.buf;
        let res = self.resolution;
        match res.tag {
            Tag::Npm => writer.write_all(res.npm().url.slice(buf)),
            Tag::LocalTarball => write!(
                writer,
                "{}",
                fmt_path(
                    res.local_tarball().slice(buf),
                    PathFormatOptions {
                        path_sep: PathSep::Posix,
                        ..Default::default()
                    },
                )
            ),
            Tag::Folder => writer.write_all(res.folder().slice(buf)),
            Tag::RemoteTarball => writer.write_all(res.remote_tarball().slice(buf)),
            // PORT NOTE: `Repository::format_as` still goes through `fmt::Write`
            // (and uses `BStr` internally); git/github URLs are ASCII in
            // practice so byte-exactness is preserved. A follow-up shard owns
            // `repository.rs` if that ever needs a byte-level path too.
            Tag::Git => write!(writer, "{}", res.git().fmt("git+", buf)),
            Tag::Github => write!(writer, "{}", res.github().fmt("github:", buf)),
            Tag::Workspace => {
                writer.write_all(b"workspace:")?;
                writer.write_all(res.workspace().slice(buf))
            }
            Tag::Symlink => {
                writer.write_all(b"link:")?;
                writer.write_all(res.symlink().slice(buf))
            }
            Tag::SingleFileModule => {
                writer.write_all(b"module:")?;
                writer.write_all(res.single_file_module().slice(buf))
            }
            _ => Ok(()),
        }
    }
}

// PORT NOTE: kept for the ~dozen call sites that interpolate into
// `format_args!` for terminal/log output (Output::err, pretty_errorln, …),
// where lossy U+FFFD on the rare non-UTF-8 byte is acceptable. File-producing
// callers MUST use [`URLFormatter::write_to`] instead.
impl<'a, SemverInt: VersionInt> fmt::Display for URLFormatter<'a, SemverInt> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let buf = self.buf;
        let res = self.resolution;
        match res.tag {
            Tag::Npm => write!(writer, "{}", BStr::new(res.npm().url.slice(buf))),
            Tag::LocalTarball => fmt_path(
                res.local_tarball().slice(buf),
                PathFormatOptions {
                    path_sep: PathSep::Posix,
                    ..Default::default()
                },
            )
            .fmt(writer),
            Tag::Folder => write!(writer, "{}", BStr::new(res.folder().slice(buf))),
            Tag::RemoteTarball => {
                write!(writer, "{}", BStr::new(res.remote_tarball().slice(buf)))
            }
            Tag::Git => res.git().format_as("git+", buf, writer),
            Tag::Github => res.github().format_as("github:", buf, writer),
            Tag::Workspace => {
                write!(
                    writer,
                    "workspace:{}",
                    BStr::new(res.workspace().slice(buf))
                )
            }
            Tag::Symlink => write!(writer, "link:{}", BStr::new(res.symlink().slice(buf))),
            Tag::SingleFileModule => write!(
                writer,
                "module:{}",
                BStr::new(res.single_file_module().slice(buf))
            ),
            _ => Ok(()),
        }
    }
}

pub struct Formatter<'a, SemverInt: VersionInt> {
    resolution: &'a ResolutionType<SemverInt>,
    buf: &'a [u8],
    path_sep: PathSep,
}

impl<'a, SemverInt: VersionInt> Formatter<'a, SemverInt> {
    /// Byte-exact port of Zig `Formatter.format`. See [`URLFormatter::write_to`]
    /// for rationale — `Display` is lossy on non-UTF-8 path bytes; this writes
    /// the lockfile string-buffer slices verbatim via `write_all`, matching
    /// Zig's `writer.writeAll` / `{s}`.
    pub fn write_to<W>(&self, writer: &mut W) -> Result<(), bun_core::Error>
    where
        W: bun_core::io::Write + ?Sized,
    {
        let buf = self.buf;
        let res = self.resolution;
        match res.tag {
            Tag::Npm => write!(writer, "{}", res.npm().version.fmt(buf)),
            Tag::LocalTarball => write!(
                writer,
                "{}",
                fmt_path(
                    res.local_tarball().slice(buf),
                    PathFormatOptions {
                        path_sep: self.path_sep,
                        ..Default::default()
                    },
                )
            ),
            Tag::Folder => write!(
                writer,
                "{}",
                fmt_path(
                    res.folder().slice(buf),
                    PathFormatOptions {
                        path_sep: self.path_sep,
                        ..Default::default()
                    },
                )
            ),
            Tag::RemoteTarball => writer.write_all(res.remote_tarball().slice(buf)),
            Tag::Git => write!(writer, "{}", res.git().fmt("git+", buf)),
            Tag::Github => write!(writer, "{}", res.github().fmt("github:", buf)),
            Tag::Workspace => {
                writer.write_all(b"workspace:")?;
                write!(
                    writer,
                    "{}",
                    fmt_path(
                        res.workspace().slice(buf),
                        PathFormatOptions {
                            path_sep: self.path_sep,
                            ..Default::default()
                        },
                    )
                )
            }
            Tag::Symlink => {
                writer.write_all(b"link:")?;
                write!(
                    writer,
                    "{}",
                    fmt_path(
                        res.symlink().slice(buf),
                        PathFormatOptions {
                            path_sep: self.path_sep,
                            ..Default::default()
                        },
                    )
                )
            }
            Tag::SingleFileModule => {
                writer.write_all(b"module:")?;
                writer.write_all(res.single_file_module().slice(buf))
            }
            _ => Ok(()),
        }
    }
}

// PORT NOTE: kept for terminal/log call sites (Output::err, tree printer, …).
// Persisted-to-disk callers (Yarn.rs) MUST use [`Formatter::write_to`].
impl<'a, SemverInt: VersionInt> fmt::Display for Formatter<'a, SemverInt> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let buf = self.buf;
        let res = self.resolution;
        match res.tag {
            Tag::Npm => res.npm().version.fmt(buf).fmt(writer),
            Tag::LocalTarball => fmt_path(
                res.local_tarball().slice(buf),
                PathFormatOptions {
                    path_sep: self.path_sep,
                    ..Default::default()
                },
            )
            .fmt(writer),
            Tag::Folder => fmt_path(
                res.folder().slice(buf),
                PathFormatOptions {
                    path_sep: self.path_sep,
                    ..Default::default()
                },
            )
            .fmt(writer),
            Tag::RemoteTarball => {
                write!(writer, "{}", BStr::new(res.remote_tarball().slice(buf)))
            }
            Tag::Git => res.git().format_as("git+", buf, writer),
            Tag::Github => res.github().format_as("github:", buf, writer),
            Tag::Workspace => write!(
                writer,
                "workspace:{}",
                fmt_path(
                    res.workspace().slice(buf),
                    PathFormatOptions {
                        path_sep: self.path_sep,
                        ..Default::default()
                    },
                )
            ),
            Tag::Symlink => write!(
                writer,
                "link:{}",
                fmt_path(
                    res.symlink().slice(buf),
                    PathFormatOptions {
                        path_sep: self.path_sep,
                        ..Default::default()
                    },
                )
            ),
            Tag::SingleFileModule => write!(
                writer,
                "module:{}",
                BStr::new(res.single_file_module().slice(buf))
            ),
            _ => Ok(()),
        }
    }
}

pub struct DebugFormatter<'a, SemverInt: VersionInt> {
    resolution: &'a ResolutionType<SemverInt>,
    buf: &'a [u8],
}

impl<'a, SemverInt: VersionInt> fmt::Display for DebugFormatter<'a, SemverInt> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        writer.write_str("Resolution{ .")?;
        writer.write_str(self.resolution.tag.name().unwrap_or("invalid"))?;
        writer.write_str(" = ")?;
        match self.resolution.tag {
            Tag::Npm => self.resolution.npm().version.fmt(self.buf).fmt(writer)?,
            Tag::LocalTarball => write!(
                writer,
                "{}",
                BStr::new(self.resolution.local_tarball().slice(self.buf))
            )?,
            Tag::Folder => write!(
                writer,
                "{}",
                BStr::new(self.resolution.folder().slice(self.buf))
            )?,
            Tag::RemoteTarball => write!(
                writer,
                "{}",
                BStr::new(self.resolution.remote_tarball().slice(self.buf))
            )?,
            Tag::Git => self.resolution.git().format_as("git+", self.buf, writer)?,
            Tag::Github => self
                .resolution
                .github()
                .format_as("github:", self.buf, writer)?,
            Tag::Workspace => write!(
                writer,
                "workspace:{}",
                BStr::new(self.resolution.workspace().slice(self.buf))
            )?,
            Tag::Symlink => write!(
                writer,
                "link:{}",
                BStr::new(self.resolution.symlink().slice(self.buf))
            )?,
            Tag::SingleFileModule => write!(
                writer,
                "module:{}",
                BStr::new(self.resolution.single_file_module().slice(self.buf))
            )?,
            _ => writer.write_str("{}")?,
        }
        writer.write_str(" }")
    }
}

/// Re-export of the lower-tier `#[repr(C)]` union — `bun_install_types` owns the
/// data definition so the resolver-side `hooks::Resolution` and the install-side
/// [`ResolutionType`] share the SAME nominal `value` type. Sharing the nominal
/// type (rather than a layout-identical local duplicate) lets
/// `auto_installer::resolution_from_hooks` copy `value` by plain assignment
/// instead of `transmute`. Constructors that need the install-side
/// zero-padded-init contract live below as free fns ([`value_zero`] /
/// [`value_init`]) since inherent impls on a foreign type are forbidden.
pub type Value<SemverInt> = bun_install_types::resolver_hooks::ResolutionValue<SemverInt>;

#[inline]
pub fn value_zero<SemverInt: VersionInt>() -> Value<SemverInt> {
    // SAFETY: all-zero is a valid Value — every variant is POD with a valid
    // all-zero representation (Semver String, Repository, VersionedURLType are
    // all #[repr(C)] with no NonNull/NonZero fields).
    unsafe { bun_core::ffi::zeroed_unchecked() }
}

/// To avoid undefined memory between union values, we must zero initialize the union first.
pub fn value_init<SemverInt: VersionInt>(field: TaggedValue<SemverInt>) -> Value<SemverInt> {
    let mut value = value_zero::<SemverInt>();
    match field {
        TaggedValue::Uninitialized => value.uninitialized = (),
        TaggedValue::Root => value.root = (),
        TaggedValue::Npm(v) => value.npm = v,
        TaggedValue::Folder(v) => value.folder = v,
        TaggedValue::LocalTarball(v) => value.local_tarball = v,
        TaggedValue::Github(v) => value.github = v,
        TaggedValue::Git(v) => value.git = v,
        TaggedValue::Symlink(v) => value.symlink = v,
        TaggedValue::Workspace(v) => value.workspace = v,
        TaggedValue::RemoteTarball(v) => value.remote_tarball = v,
        TaggedValue::SingleFileModule(v) => value.single_file_module = v,
    }
    value
}

// Zig `enum(u8) { ..., _ }` is non-exhaustive — values outside the named set are
// valid (lockfile bytes may carry unknown tags, and every `switch` has an `else`
// arm). A `#[repr(u8)] enum` would be UB for such values, so Tag is a transparent
// u8 newtype with associated consts. Const patterns (structural `PartialEq`) keep
// `match tag { Tag::Npm => ... }` working, and the `_` arms in callers stay live.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, core::marker::ConstParamTy)]
pub struct Tag(pub u8);

impl Default for Tag {
    #[inline]
    fn default() -> Self {
        Tag::Uninitialized
    }
}

#[allow(non_upper_case_globals)]
impl Tag {
    pub const Uninitialized: Tag = Tag(0);
    pub const Root: Tag = Tag(1);
    pub const Npm: Tag = Tag(2);
    pub const Folder: Tag = Tag(4);

    pub const LocalTarball: Tag = Tag(8);

    pub const Github: Tag = Tag(16);

    pub const Git: Tag = Tag(32);

    pub const Symlink: Tag = Tag(64);

    pub const Workspace: Tag = Tag(72);

    pub const RemoteTarball: Tag = Tag(80);

    // This is a placeholder for now.
    // But the intent is to eventually support URL imports at the package manager level.
    //
    // There are many ways to do it, but perhaps one way to be maximally compatible is just removing the protocol part of the URL.
    //
    // For example, bun would transform this input:
    //
    //   import _ from "https://github.com/lodash/lodash/lodash.min.js";
    //
    // Into:
    //
    //   import _ from "github.com/lodash/lodash/lodash.min.js";
    //
    // github.com would become a package, with it's own package.json
    // This is similar to how Go does it, except it wouldn't clone the whole repo.
    // There are more efficient ways to do this, e.g. generate a .bun file just for all URL imports.
    // There are questions of determinism, but perhaps that's what Integrity would do.
    pub const SingleFileModule: Tag = Tag(100);
}

impl Tag {
    pub fn is_git(self) -> bool {
        self == Tag::Git || self == Tag::Github
    }

    pub fn can_enqueue_install_task(self) -> bool {
        self == Tag::Npm
            || self == Tag::LocalTarball
            || self == Tag::RemoteTarball
            || self == Tag::Git
            || self == Tag::Github
    }

    /// Mirrors `bun.tagName(Tag, tag)` — returns the Zig snake_case tag name,
    /// or `None` for an unnamed (non-exhaustive) value.
    pub fn name(self) -> Option<&'static str> {
        Some(match self {
            Tag::Uninitialized => "uninitialized",
            Tag::Root => "root",
            Tag::Npm => "npm",
            Tag::Folder => "folder",
            Tag::LocalTarball => "local_tarball",
            Tag::Github => "github",
            Tag::Git => "git",
            Tag::Symlink => "symlink",
            Tag::Workspace => "workspace",
            Tag::RemoteTarball => "remote_tarball",
            Tag::SingleFileModule => "single_file_module",
            _ => return None,
        })
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum FromTextLockfileError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("unexpected resolution")]
    UnexpectedResolution,
    #[error("invalid semver")]
    InvalidSemver,
}

bun_core::oom_from_alloc!(FromTextLockfileError);

bun_core::named_error_set!(FromTextLockfileError);

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum FromPnpmLockfileError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("invalid pnpm lockfile")]
    InvalidPnpmLockfile,
}

bun_core::oom_from_alloc!(FromPnpmLockfileError);

bun_core::named_error_set!(FromPnpmLockfileError);

// ported from: src/install/resolution.zig
