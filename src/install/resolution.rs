use core::cmp::Ordering;
use core::fmt;

use bstr::BStr;

use bun_alloc::AllocError;
use bun_core::fmt::{fmt_path, PathFormatOptions, PathSep};
use bun_semver as semver;
use bun_semver::String;
// TODO(port): String::Buf is a nested type in Zig; map to the Rust equivalent in bun_semver
use bun_semver::StringBuf;
use bun_str::strings;

use crate::dependency::{self, Dependency};
use crate::repository::Repository;
use crate::versioned_url::VersionedURLType;

pub type Resolution = ResolutionType<u64>;
pub type OldV2Resolution = ResolutionType<u32>;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ResolutionType<SemverInt: Copy> {
    pub tag: Tag,
    _padding: [u8; 7],
    pub value: Value<SemverInt>,
}

impl<SemverInt: Copy> Default for ResolutionType<SemverInt> {
    fn default() -> Self {
        Self {
            tag: Tag::Uninitialized,
            _padding: [0; 7],
            value: Value { uninitialized: () },
        }
    }
}

/// Rust-side equivalent of `bun.meta.Tagged(Value, Tag)` — a tagged view of `Value`
/// used by `ResolutionType::init` / `Value::init` to construct a zero-padded union.
pub enum TaggedValue<SemverInt: Copy> {
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

impl<SemverInt: Copy> TaggedValue<SemverInt> {
    #[inline]
    fn tag(&self) -> Tag {
        match self {
            TaggedValue::Uninitialized => Tag::Uninitialized,
            TaggedValue::Root => Tag::Root,
            TaggedValue::Npm(_) => Tag::Npm,
            TaggedValue::Folder(_) => Tag::Folder,
            TaggedValue::LocalTarball(_) => Tag::LocalTarball,
            TaggedValue::Github(_) => Tag::Github,
            TaggedValue::Git(_) => Tag::Git,
            TaggedValue::Symlink(_) => Tag::Symlink,
            TaggedValue::Workspace(_) => Tag::Workspace,
            TaggedValue::RemoteTarball(_) => Tag::RemoteTarball,
            TaggedValue::SingleFileModule(_) => Tag::SingleFileModule,
        }
    }
}

impl<SemverInt: Copy> ResolutionType<SemverInt> {
    /// Use like Resolution.init(.{ .npm = VersionedURL{ ... } })
    #[inline]
    pub fn init(value: TaggedValue<SemverInt>) -> Self {
        Self {
            tag: value.tag(),
            _padding: [0; 7],
            value: Value::init(value),
        }
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

        if let Some(link) = strings::without_prefix_if_possible(res_str, b"link:") {
            return Ok(Self::init(TaggedValue::Symlink(string_buf.append(link)?)));
        }

        if let Some(workspace) = strings::without_prefix_if_possible(res_str, b"workspace:") {
            return Ok(Self::init(TaggedValue::Workspace(
                string_buf.append(workspace)?,
            )));
        }

        if let Some(folder) = strings::without_prefix_if_possible(res_str, b"file:") {
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
                if Dependency::is_remote_tarball(res_str) {
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
                let parsed =
                    semver::Version::parse(version_literal.sliced(string_buf.bytes.as_slice()));

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
            strings::without_prefix_if_possible(res_str, b"https://codeload.github.com/")
        {
            let Some(user_end) = strings::index_of_char(user_repo_tar_committish, b'/') else {
                return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
            };
            let user = &user_repo_tar_committish[..user_end];
            let repo_tar_committish = &user_repo_tar_committish[user_end + 1..];

            let Some(repo_end) = strings::index_of_char(repo_tar_committish, b'/') else {
                return Err(FromPnpmLockfileError::InvalidPnpmLockfile);
            };
            let repo = &repo_tar_committish[..repo_end];
            let tar_committish = &repo_tar_committish[repo_end + 1..];

            let Some(tar_end) = strings::index_of_char(tar_committish, b'/') else {
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

        if let Some(path) = strings::without_prefix_if_possible(res_str, b"file:") {
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
                if Dependency::is_remote_tarball(res_str) {
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

        // SAFETY: tag was checked equal above; each arm reads the union field
        // corresponding to that tag.
        unsafe {
            match self.tag {
                Tag::Npm => self.value.npm.order(&rhs.value.npm, lhs_buf, rhs_buf),
                Tag::LocalTarball => self
                    .value
                    .local_tarball
                    .order(&rhs.value.local_tarball, lhs_buf, rhs_buf),
                Tag::Folder => self.value.folder.order(&rhs.value.folder, lhs_buf, rhs_buf),
                Tag::RemoteTarball => self
                    .value
                    .remote_tarball
                    .order(&rhs.value.remote_tarball, lhs_buf, rhs_buf),
                Tag::Workspace => self
                    .value
                    .workspace
                    .order(&rhs.value.workspace, lhs_buf, rhs_buf),
                Tag::Symlink => self
                    .value
                    .symlink
                    .order(&rhs.value.symlink, lhs_buf, rhs_buf),
                Tag::SingleFileModule => self.value.single_file_module.order(
                    &rhs.value.single_file_module,
                    lhs_buf,
                    rhs_buf,
                ),
                Tag::Git => self.value.git.order(&rhs.value.git, lhs_buf, rhs_buf),
                Tag::Github => self.value.github.order(&rhs.value.github, lhs_buf, rhs_buf),
                _ => Ordering::Equal,
            }
        }
    }

    // TODO(port): Builder trait bound — Zig used `comptime Builder: type`; callers pass
    // a string-builder with `.count(&[u8])` and `.append::<String>(&[u8]) -> String`.
    pub fn count<B>(&self, buf: &[u8], builder: &mut B)
    where
        B: StringBuilderLike,
    {
        // SAFETY: each arm reads the union field corresponding to self.tag.
        unsafe {
            match self.tag {
                Tag::Npm => self.value.npm.count(buf, builder),
                Tag::LocalTarball => builder.count(self.value.local_tarball.slice(buf)),
                Tag::Folder => builder.count(self.value.folder.slice(buf)),
                Tag::RemoteTarball => builder.count(self.value.remote_tarball.slice(buf)),
                Tag::Workspace => builder.count(self.value.workspace.slice(buf)),
                Tag::Symlink => builder.count(self.value.symlink.slice(buf)),
                Tag::SingleFileModule => builder.count(self.value.single_file_module.slice(buf)),
                Tag::Git => self.value.git.count(buf, builder),
                Tag::Github => self.value.github.count(buf, builder),
                _ => {}
            }
        }
    }

    pub fn clone<B>(&self, buf: &[u8], builder: &mut B) -> Self
    where
        B: StringBuilderLike,
    {
        // SAFETY: each arm reads the union field corresponding to self.tag.
        let value = unsafe {
            match self.tag {
                Tag::Npm => Value::init(TaggedValue::Npm(self.value.npm.clone(buf, builder))),
                Tag::LocalTarball => Value::init(TaggedValue::LocalTarball(
                    builder.append_string(self.value.local_tarball.slice(buf)),
                )),
                Tag::Folder => Value::init(TaggedValue::Folder(
                    builder.append_string(self.value.folder.slice(buf)),
                )),
                Tag::RemoteTarball => Value::init(TaggedValue::RemoteTarball(
                    builder.append_string(self.value.remote_tarball.slice(buf)),
                )),
                Tag::Workspace => Value::init(TaggedValue::Workspace(
                    builder.append_string(self.value.workspace.slice(buf)),
                )),
                Tag::Symlink => Value::init(TaggedValue::Symlink(
                    builder.append_string(self.value.symlink.slice(buf)),
                )),
                Tag::SingleFileModule => Value::init(TaggedValue::SingleFileModule(
                    builder.append_string(self.value.single_file_module.slice(buf)),
                )),
                Tag::Git => Value::init(TaggedValue::Git(self.value.git.clone(buf, builder))),
                Tag::Github => {
                    Value::init(TaggedValue::Github(self.value.github.clone(buf, builder)))
                }
                Tag::Root => Value::init(TaggedValue::Root),
                Tag::Uninitialized => Value::init(TaggedValue::Uninitialized),
                _ => panic!(
                    "Internal error: unexpected resolution tag: {}",
                    self.tag.0
                ),
            }
        };
        Self {
            tag: self.tag,
            _padding: [0; 7],
            value,
        }
    }

    pub fn copy(&self) -> Self {
        // SAFETY: each arm reads the union field corresponding to self.tag.
        unsafe {
            match self.tag {
                Tag::Npm => Self::init(TaggedValue::Npm(self.value.npm)),
                Tag::LocalTarball => Self::init(TaggedValue::LocalTarball(self.value.local_tarball)),
                Tag::Folder => Self::init(TaggedValue::Folder(self.value.folder)),
                Tag::RemoteTarball => {
                    Self::init(TaggedValue::RemoteTarball(self.value.remote_tarball))
                }
                Tag::Workspace => Self::init(TaggedValue::Workspace(self.value.workspace)),
                Tag::Symlink => Self::init(TaggedValue::Symlink(self.value.symlink)),
                Tag::SingleFileModule => {
                    Self::init(TaggedValue::SingleFileModule(self.value.single_file_module))
                }
                Tag::Git => Self::init(TaggedValue::Git(self.value.git)),
                Tag::Github => Self::init(TaggedValue::Github(self.value.github)),
                Tag::Root => Self::init(TaggedValue::Root),
                Tag::Uninitialized => Self::init(TaggedValue::Uninitialized),
                _ => panic!(
                    "Internal error: unexpected resolution tag: {}",
                    self.tag.0
                ),
            }
        }
    }

    pub fn fmt<'a>(&'a self, string_bytes: &'a [u8], path_sep: PathSep) -> Formatter<'a, SemverInt> {
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

        // SAFETY: tag was checked equal above; each arm reads the union field
        // corresponding to that tag.
        unsafe {
            match self.tag {
                Tag::Root => true,
                Tag::Npm => self.value.npm.eql(&rhs.value.npm),
                Tag::LocalTarball => self.value.local_tarball.eql(
                    &rhs.value.local_tarball,
                    lhs_string_buf,
                    rhs_string_buf,
                ),
                Tag::Folder => {
                    self.value
                        .folder
                        .eql(&rhs.value.folder, lhs_string_buf, rhs_string_buf)
                }
                Tag::RemoteTarball => self.value.remote_tarball.eql(
                    &rhs.value.remote_tarball,
                    lhs_string_buf,
                    rhs_string_buf,
                ),
                Tag::Workspace => {
                    self.value
                        .workspace
                        .eql(&rhs.value.workspace, lhs_string_buf, rhs_string_buf)
                }
                Tag::Symlink => {
                    self.value
                        .symlink
                        .eql(&rhs.value.symlink, lhs_string_buf, rhs_string_buf)
                }
                Tag::SingleFileModule => self.value.single_file_module.eql(
                    &rhs.value.single_file_module,
                    lhs_string_buf,
                    rhs_string_buf,
                ),
                Tag::Git => self
                    .value
                    .git
                    .eql(&rhs.value.git, lhs_string_buf, rhs_string_buf),
                Tag::Github => {
                    self.value
                        .github
                        .eql(&rhs.value.github, lhs_string_buf, rhs_string_buf)
                }
                _ => unreachable!(),
            }
        }
    }
}

// TODO(port): this trait stands in for the duck-typed `Builder` Zig comptime param.
// Phase B should unify with the real string-builder trait used by lockfile cloning.
pub trait StringBuilderLike {
    fn count(&mut self, s: &[u8]);
    fn append_string(&mut self, s: &[u8]) -> String;
}

pub struct StorePathFormatter<'a, SemverInt: Copy> {
    res: &'a ResolutionType<SemverInt>,
    string_buf: &'a [u8],
    // opts: String.StorePathFormatter.Options,
}

impl<'a, SemverInt: Copy> fmt::Display for StorePathFormatter<'a, SemverInt> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let string_buf = self.string_buf;
        let res = &self.res.value;
        // SAFETY: each arm reads the union field corresponding to self.res.tag.
        unsafe {
            match self.res.tag {
                Tag::Root => writer.write_str("root"),
                Tag::Npm => write!(writer, "{}", res.npm.version.fmt(string_buf)),
                Tag::LocalTarball => {
                    write!(writer, "{}", res.local_tarball.fmt_store_path(string_buf))
                }
                Tag::RemoteTarball => {
                    write!(writer, "{}", res.remote_tarball.fmt_store_path(string_buf))
                }
                Tag::Folder => write!(writer, "{}", res.folder.fmt_store_path(string_buf)),
                Tag::Git => write!(writer, "{}", res.git.fmt_store_path("git+", string_buf)),
                Tag::Github => {
                    write!(writer, "{}", res.github.fmt_store_path("github+", string_buf))
                }
                Tag::Workspace => write!(writer, "{}", res.workspace.fmt_store_path(string_buf)),
                Tag::Symlink => write!(writer, "{}", res.symlink.fmt_store_path(string_buf)),
                Tag::SingleFileModule => {
                    write!(writer, "{}", res.single_file_module.fmt_store_path(string_buf))
                }
                _ => Ok(()),
            }
        }
    }
}

pub struct URLFormatter<'a, SemverInt: Copy> {
    resolution: &'a ResolutionType<SemverInt>,

    buf: &'a [u8],
}

impl<'a, SemverInt: Copy> fmt::Display for URLFormatter<'a, SemverInt> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let buf = self.buf;
        let value = &self.resolution.value;
        // SAFETY: each arm reads the union field corresponding to self.resolution.tag.
        unsafe {
            match self.resolution.tag {
                Tag::Npm => write!(writer, "{}", BStr::new(value.npm.url.slice(buf))),
                Tag::LocalTarball => fmt_path(
                    value.local_tarball.slice(buf),
                    PathFormatOptions {
                        path_sep: PathSep::Posix,
                        ..Default::default()
                    },
                )
                .fmt(writer),
                Tag::Folder => write!(writer, "{}", BStr::new(value.folder.slice(buf))),
                Tag::RemoteTarball => {
                    write!(writer, "{}", BStr::new(value.remote_tarball.slice(buf)))
                }
                Tag::Git => value.git.format_as("git+", buf, writer),
                Tag::Github => value.github.format_as("github:", buf, writer),
                Tag::Workspace => {
                    write!(writer, "workspace:{}", BStr::new(value.workspace.slice(buf)))
                }
                Tag::Symlink => write!(writer, "link:{}", BStr::new(value.symlink.slice(buf))),
                Tag::SingleFileModule => write!(
                    writer,
                    "module:{}",
                    BStr::new(value.single_file_module.slice(buf))
                ),
                _ => Ok(()),
            }
        }
    }
}

pub struct Formatter<'a, SemverInt: Copy> {
    resolution: &'a ResolutionType<SemverInt>,
    buf: &'a [u8],
    path_sep: PathSep,
}

impl<'a, SemverInt: Copy> fmt::Display for Formatter<'a, SemverInt> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let buf = self.buf;
        let value = &self.resolution.value;
        // SAFETY: each arm reads the union field corresponding to self.resolution.tag.
        unsafe {
            match self.resolution.tag {
                Tag::Npm => value.npm.version.fmt(buf).fmt(writer),
                Tag::LocalTarball => fmt_path(
                    value.local_tarball.slice(buf),
                    PathFormatOptions {
                        path_sep: self.path_sep,
                        ..Default::default()
                    },
                )
                .fmt(writer),
                Tag::Folder => fmt_path(
                    value.folder.slice(buf),
                    PathFormatOptions {
                        path_sep: self.path_sep,
                        ..Default::default()
                    },
                )
                .fmt(writer),
                Tag::RemoteTarball => {
                    write!(writer, "{}", BStr::new(value.remote_tarball.slice(buf)))
                }
                Tag::Git => value.git.format_as("git+", buf, writer),
                Tag::Github => value.github.format_as("github:", buf, writer),
                Tag::Workspace => write!(
                    writer,
                    "workspace:{}",
                    fmt_path(
                        value.workspace.slice(buf),
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
                        value.symlink.slice(buf),
                        PathFormatOptions {
                            path_sep: self.path_sep,
                            ..Default::default()
                        },
                    )
                ),
                Tag::SingleFileModule => write!(
                    writer,
                    "module:{}",
                    BStr::new(value.single_file_module.slice(buf))
                ),
                _ => Ok(()),
            }
        }
    }
}

pub struct DebugFormatter<'a, SemverInt: Copy> {
    resolution: &'a ResolutionType<SemverInt>,
    buf: &'a [u8],
}

impl<'a, SemverInt: Copy> fmt::Display for DebugFormatter<'a, SemverInt> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        writer.write_str("Resolution{ .")?;
        writer.write_str(self.resolution.tag.name().unwrap_or("invalid"))?;
        writer.write_str(" = ")?;
        // SAFETY: each arm reads the union field corresponding to self.resolution.tag.
        unsafe {
            match self.resolution.tag {
                Tag::Npm => self.resolution.value.npm.version.fmt(self.buf).fmt(writer)?,
                Tag::LocalTarball => write!(
                    writer,
                    "{}",
                    BStr::new(self.resolution.value.local_tarball.slice(self.buf))
                )?,
                Tag::Folder => write!(
                    writer,
                    "{}",
                    BStr::new(self.resolution.value.folder.slice(self.buf))
                )?,
                Tag::RemoteTarball => write!(
                    writer,
                    "{}",
                    BStr::new(self.resolution.value.remote_tarball.slice(self.buf))
                )?,
                Tag::Git => self
                    .resolution
                    .value
                    .git
                    .format_as("git+", self.buf, writer)?,
                Tag::Github => self
                    .resolution
                    .value
                    .github
                    .format_as("github:", self.buf, writer)?,
                Tag::Workspace => write!(
                    writer,
                    "workspace:{}",
                    BStr::new(self.resolution.value.workspace.slice(self.buf))
                )?,
                Tag::Symlink => write!(
                    writer,
                    "link:{}",
                    BStr::new(self.resolution.value.symlink.slice(self.buf))
                )?,
                Tag::SingleFileModule => write!(
                    writer,
                    "module:{}",
                    BStr::new(self.resolution.value.single_file_module.slice(self.buf))
                )?,
                _ => writer.write_str("{}")?,
            }
        }
        writer.write_str(" }")
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub union Value<SemverInt: Copy> {
    pub uninitialized: (),
    pub root: (),

    pub npm: VersionedURLType<SemverInt>,

    pub folder: String,

    /// File path to a tarball relative to the package root
    pub local_tarball: String,

    pub github: Repository,

    pub git: Repository,

    /// global link
    pub symlink: String,

    pub workspace: String,

    /// URL to a tarball.
    pub remote_tarball: String,

    pub single_file_module: String,
}

impl<SemverInt: Copy> Value<SemverInt> {
    #[inline]
    pub fn zero() -> Self {
        // SAFETY: all-zero is a valid Value — every variant is POD with a valid
        // all-zero representation (Semver String, Repository, VersionedURLType are
        // all #[repr(C)] with no NonNull/NonZero fields).
        unsafe { core::mem::zeroed() }
    }

    /// To avoid undefined memory between union values, we must zero initialize the union first.
    pub fn init(field: TaggedValue<SemverInt>) -> Self {
        let mut value = Self::zero();
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
}

// Zig `enum(u8) { ..., _ }` is non-exhaustive — values outside the named set are
// valid (lockfile bytes may carry unknown tags, and every `switch` has an `else`
// arm). A `#[repr(u8)] enum` would be UB for such values, so Tag is a transparent
// u8 newtype with associated consts. Const patterns (structural `PartialEq`) keep
// `match tag { Tag::Npm => ... }` working, and the `_` arms in callers stay live.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Tag(pub u8);

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

impl From<AllocError> for FromTextLockfileError {
    fn from(_: AllocError) -> Self {
        FromTextLockfileError::OutOfMemory
    }
}

impl From<FromTextLockfileError> for bun_core::Error {
    fn from(e: FromTextLockfileError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum FromPnpmLockfileError {
    #[error("out of memory")]
    OutOfMemory,
    #[error("invalid pnpm lockfile")]
    InvalidPnpmLockfile,
}

impl From<AllocError> for FromPnpmLockfileError {
    fn from(_: AllocError) -> Self {
        FromPnpmLockfileError::OutOfMemory
    }
}

impl From<FromPnpmLockfileError> for bun_core::Error {
    fn from(e: FromPnpmLockfileError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/resolution.zig (552 lines)
//   confidence: medium
//   todos:      2
//   notes:      extern union kept as #[repr(C)] union (lockfile binary layout); Tag is a transparent u8 newtype (Zig enum is non-exhaustive — lockfile bytes may carry unknown values); Builder comptime param modeled as StringBuilderLike trait
// ──────────────────────────────────────────────────────────────────────────
