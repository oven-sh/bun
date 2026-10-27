use crate::mal_prelude::*;

use bun_paths::resolve_path::{self, platform};

#[cfg(any(windows, target_os = "macos"))]
type PathMap = bun_collections::CaseInsensitiveAsciiStringArrayHashMap<()>;
#[cfg(not(any(windows, target_os = "macos")))]
type PathMap = bun_collections::StringArrayHashMap<()>;

/// How an output file reaches its path.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum OutputWrite {
    /// `open(O_TRUNC)`: a symlink or a second hard link at the path is written through.
    Truncate,
    /// `rename`: only the directory entry at the path is replaced.
    Rename,
}

impl OutputWrite {
    /// The compiled executable is moved into place. On Windows a move to another volume is a copy, which writes through a link.
    pub const EXECUTABLE: Self = if cfg!(windows) {
        Self::Truncate
    } else {
        Self::Rename
    };
}

/// An output that would replace `input`. Its text is the build error.
pub struct Refusal {
    input: Box<[u8]>,
    /// What the user can change to move the output.
    option: &'static str,
}

impl Refusal {
    /// A chunk, an asset, a source map, a bytecode file or the executable.
    pub fn output(input: Box<[u8]>) -> Self {
        Self {
            input,
            option: "outdir or outfile",
        }
    }

    pub fn metafile(input: Box<[u8]>) -> Self {
        Self {
            input,
            option: "metafile path",
        }
    }
}

impl core::fmt::Display for Refusal {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(
            f,
            "Refusing to overwrite input file {}. Please choose a different {}",
            bun_core::fmt::quote(&self.input),
            self.option,
        )
    }
}

/// Absolute paths of every input file that the build read from disk.
#[derive(Default)]
pub struct InputPathSet {
    paths: PathMap,
    /// `(st_dev, st_ino)` of each path, filled on the first destination that needs it.
    identities: std::cell::OnceCell<Vec<Option<(u64, u64)>>>,
    /// `realpath` of each output subdirectory.
    real_parents: std::cell::RefCell<bun_collections::StringHashMap<RealPath>>,
    /// Real paths of files, and of directories whose every file is an input, read outside the module graph.
    roots: Vec<Box<[u8]>>,
}

impl InputPathSet {
    /// Every `file:` namespace input that the build read from disk. A file at the path of an in-memory file can be the previous run's output.
    pub(crate) fn from_graph(
        graph: &crate::Graph::Graph<'_>,
        in_memory_files: Option<&crate::bundle_v2::FileMap>,
    ) -> Self {
        Self::from_paths(
            graph
                .input_files
                .items_source()
                .iter()
                .map(|source| &source.path)
                .filter(|path| path.namespace == b"file")
                .map(|path| path.text)
                .filter(|path| !in_memory_files.is_some_and(|files| files.contains(path))),
        )
    }

    pub fn from_paths<'a>(paths: impl Iterator<Item = &'a [u8]>) -> Self {
        let mut set = PathMap::default();
        for path in paths {
            if bun_paths::is_absolute(path) {
                bun_core::handle_oom(set.get_or_put(path));
            }
        }
        Self {
            paths: set,
            ..Default::default()
        }
    }

    pub fn is_empty(&self) -> bool {
        self.paths.count() == 0 && self.roots.is_empty()
    }

    /// `path` is a file, or a directory whose every file is an input (`--asset`).
    pub fn add_root(&mut self, path: &[u8]) {
        let root = resolve_output_root(path);
        if !root.unknown {
            self.roots.push(root.real);
        }
    }

    /// The input that writing `dest_path` under `root` would replace, relative to the working directory.
    pub fn overwritten_by(
        &self,
        root: &OutputRoot,
        dest_path: &[u8],
        write: OutputWrite,
    ) -> Option<Box<[u8]>> {
        if self.is_empty() || root.unknown {
            return None;
        }
        let mut abs_buf = bun_paths::path_buffer_pool::get();
        let owned_abs;
        let abs: &[u8] = if has_parent_segment(dest_path) {
            owned_abs = physical_dest(&root.real, dest_path)?;
            &owned_abs
        } else if let Some(abs) = join_abs_buf(&root.real, dest_path, &mut abs_buf) {
            abs
        } else {
            owned_abs = join_abs(&root.real, dest_path);
            &owned_abs
        };
        let real_path;
        let link_target;

        let input: &[u8] = if let Some(index) = self.paths.get_index(abs) {
            &self.paths.keys()[index]
        } else {
            if root.missing
                && resolve_path::is_parent_or_equal(&root.real, abs)
                    != resolve_path::ParentEqual::Unrelated
            {
                return None;
            }
            let real: &[u8] = match self.through_real_parent(&root.real, abs) {
                RealPath::Missing => return None,
                RealPath::Same | RealPath::Unknown => abs,
                RealPath::Other(path) => {
                    real_path = path;
                    &real_path
                }
            };
            // `abs` and `real` name one directory entry. A syscall takes the one that fits a path buffer.
            let entry = if abs.len() < bun_paths::MAX_PATH_BYTES {
                abs
            } else {
                real
            };
            if let Some(index) = self
                .paths
                .get_index(real)
                .or_else(|| self.index_of_unresolved(root, dest_path))
            {
                &self.paths.keys()[index]
            } else if self.is_under_a_root(real, entry) {
                real
            } else if write == OutputWrite::Rename {
                return None;
            } else if let Some(target) = self.link_target_under_a_root(entry) {
                link_target = target;
                &link_target
            } else {
                &self.paths.keys()[self.index_of_same_file(entry)?]
            }
        };
        let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir();
        let mut rel: Box<[u8]> = Box::from(resolve_path::relative(top_level_dir, input));
        resolve_path::platform_to_posix_in_place(&mut rel);
        Some(rel)
    }
}

impl InputPathSet {
    /// `abs` with its directory symlink-resolved. `root` is symlink-free already.
    fn through_real_parent(&self, root: &[u8], abs: &[u8]) -> RealPath {
        let Some(parent) = bun_paths::dirname(abs) else {
            return RealPath::Same;
        };
        if resolve_path::is_parent_or_equal(parent, root) != resolve_path::ParentEqual::Unrelated {
            return RealPath::Same;
        }
        let mut real_parents = self.real_parents.borrow_mut();
        if real_parents.get(parent).is_none() {
            bun_core::handle_oom(real_parents.put(parent, RealPath::of(parent)));
        }
        match real_parents.get(parent) {
            Some(RealPath::Other(real_parent)) => {
                RealPath::Other(join_abs(real_parent, bun_paths::basename(abs)))
            }
            Some(RealPath::Missing) => RealPath::Missing,
            Some(RealPath::Same | RealPath::Unknown) | None => RealPath::Same,
        }
    }

    /// The inputs keep the spelling the resolver saw. On Windows `realpath` rewrites a subst or mapped drive.
    fn index_of_unresolved(&self, root: &OutputRoot, dest_path: &[u8]) -> Option<usize> {
        let unresolved = root.unresolved.as_deref()?;
        if has_parent_segment(dest_path) {
            return None;
        }
        self.paths
            .get_index(join_abs_scratch(unresolved, dest_path))
    }

    /// A symlink at the destination whose target is a root, or is in a root directory.
    fn link_target_under_a_root(&self, entry: &[u8]) -> Option<Box<[u8]>> {
        if self.roots.is_empty() {
            return None;
        }
        let mut z_buf = bun_paths::path_buffer_pool::get();
        let entry_z = path_z(entry, &mut z_buf)?;
        let link = bun_sys::lstat(entry_z).ok()?;
        if bun_sys::kind_from_mode(link.st_mode as bun_sys::Mode) != bun_sys::FileKind::SymLink {
            return None;
        }
        let mut target_buf = bun_paths::path_buffer_pool::get();
        let target = bun_sys::realpath(entry_z, &mut target_buf).ok()?;
        self.is_under_a_root(target, target)
            .then(|| Box::from(target))
    }

    /// An existing file that is a root, or is in a root directory. `entry` is a spelling of `real` for `lstat`.
    fn is_under_a_root(&self, real: &[u8], entry: &[u8]) -> bool {
        if !self.roots.iter().any(|root| {
            resolve_path::is_parent_or_equal(root, real) != resolve_path::ParentEqual::Unrelated
        }) {
            return false;
        }
        let mut z_buf = bun_paths::path_buffer_pool::get();
        path_z(entry, &mut z_buf).is_some_and(|entry_z| bun_sys::lstat(entry_z).is_ok())
    }

    /// A write to a symlink, or to a file with another hard link, lands in a file that has a second name.
    fn index_of_same_file(&self, entry: &[u8]) -> Option<usize> {
        let mut z_buf = bun_paths::path_buffer_pool::get();
        let entry_z = path_z(entry, &mut z_buf)?;
        let link = bun_sys::lstat(entry_z).ok()?;
        let is_symlink =
            bun_sys::kind_from_mode(link.st_mode as bun_sys::Mode) == bun_sys::FileKind::SymLink;
        let written = if is_symlink {
            bun_sys::stat(entry_z).ok()?
        } else if link.st_nlink > 1 {
            link
        } else {
            return None;
        };
        let written = (written.st_dev as u64, written.st_ino as u64);
        self.identities
            .get_or_init(|| {
                self.paths
                    .keys()
                    .iter()
                    .map(|input| {
                        let mut buf = bun_paths::path_buffer_pool::get();
                        let st = bun_sys::stat(path_z(input, &mut buf)?).ok()?;
                        Some((st.st_dev as u64, st.st_ino as u64))
                    })
                    .collect()
            })
            .iter()
            .position(|identity| *identity == Some(written))
    }
}

/// What `realpath` finds for the directory of an output file.
enum RealPath {
    /// No such directory, so no file is in it.
    Missing,
    /// The path has no symlink in it.
    Same,
    Other(Box<[u8]>),
    /// No answer: the path does not fit a path buffer, or `realpath` failed for another reason.
    Unknown,
}

impl RealPath {
    fn of(dir: &[u8]) -> Self {
        let mut z_buf = bun_paths::path_buffer_pool::get();
        let mut real_buf = bun_paths::path_buffer_pool::get();
        match path_z(dir, &mut z_buf).map(|dir_z| bun_sys::realpath(dir_z, &mut real_buf)) {
            Some(Ok(real)) if real != dir => Self::Other(Box::from(real)),
            Some(Ok(_)) => Self::Same,
            Some(Err(err)) if err.get_errno() == bun_sys::E::ENOENT => Self::Missing,
            _ => Self::Unknown,
        }
    }

    /// `dir` as the kernel resolves it. `None` when a `..` in it leads where `realpath` does not say.
    fn resolve(dir: &[u8]) -> Option<Box<[u8]>> {
        match Self::of(dir) {
            Self::Other(real) => Some(real),
            Self::Same => Some(Box::from(dir)),
            Self::Missing => Self::resolve_missing(dir),
            Self::Unknown => (!has_parent_segment(dir)).then(|| Box::from(dir)),
        }
    }

    /// A path that `realpath` does not find: its nearest directory that exists, then the names after it.
    fn resolve_missing(dir: &[u8]) -> Option<Box<[u8]>> {
        let mut missing: Vec<&[u8]> = Vec::new();
        let mut nearest = dir;
        let mut resolved: Box<[u8]> = loop {
            let Some(parent) =
                bun_paths::dirname(nearest).filter(|parent| parent.len() < nearest.len())
            else {
                break Box::from(nearest);
            };
            missing.push(nearest);
            nearest = parent;
            match Self::of(nearest) {
                Self::Other(real) => break real,
                Self::Same => break Box::from(nearest),
                Self::Unknown if has_parent_segment(nearest) => return None,
                Self::Unknown => break Box::from(nearest),
                Self::Missing => {}
            }
        };
        for dir in missing.into_iter().rev() {
            let name = bun_paths::basename(dir);
            resolved = join_abs(&resolved, name);
            // `new/../out`: `new` does not exist, and `out` can exist and be a symlink.
            if name != b".." && has_parent_segment(dir) {
                match Self::of(&resolved) {
                    Self::Other(real) => resolved = real,
                    Self::Unknown => return None,
                    Self::Same | Self::Missing => {}
                }
            }
        }
        Some(resolved)
    }
}

/// Joining collapses `dir/..` by name. The kernel resolves `dir` first, and `dir` can be a symlink.
fn has_parent_segment(path: &[u8]) -> bool {
    if !bun_core::strings::contains(path, b"..") {
        return false;
    }
    if cfg!(windows) {
        bun_core::strings::split_any(path, b"/\\").any(|segment| segment == b"..")
    } else {
        bun_core::strings::split(path, b"/").any(|segment| segment == b"..")
    }
}

/// `path` under `base`, normalized as the kernel reads it: on POSIX a `\` is a byte of a name. In a thread-local buffer.
fn join_abs_scratch<'a>(base: &'a [u8], path: &'a [u8]) -> &'a [u8] {
    if cfg!(windows) {
        return resolve_path::join_abs_string::<platform::Auto>(base, &[path]);
    }
    let parts = [base, path];
    resolve_path::join::<platform::Posix>(&parts[usize::from(bun_paths::is_absolute(path))..])
}

/// [`join_abs_scratch`] on the heap, so that a path longer than a path buffer fits.
fn join_abs(base: &[u8], path: &[u8]) -> Box<[u8]> {
    Box::from(join_abs_scratch(base, path))
}

/// [`join_abs_scratch`] into `buf`. `None` when the result does not fit.
fn join_abs_buf<'a>(
    base: &'a [u8],
    path: &[u8],
    buf: &'a mut bun_core::PathBuffer,
) -> Option<&'a [u8]> {
    if cfg!(windows) {
        return resolve_path::join_abs_string_buf_checked::<platform::Auto>(
            base,
            &mut buf.0,
            &[path],
        );
    }
    let parts = [base, path];
    let parts = &parts[usize::from(bun_paths::is_absolute(path))..];
    resolve_path::join_z_buf_checked::<platform::Posix>(&mut buf.0, parts).map(|abs| abs.as_bytes())
}

/// `path` for a syscall. `None` when it does not fit a path buffer: the check does not examine such a path.
fn path_z<'a>(path: &[u8], buf: &'a mut bun_core::PathBuffer) -> Option<&'a bun_core::ZStr> {
    (path.len() < bun_paths::MAX_PATH_BYTES).then(|| resolve_path::z(path, buf))
}

/// `path` under `base`, with its `..` segments kept.
fn raw_join(base: &[u8], path: &[u8]) -> Box<[u8]> {
    if bun_paths::is_absolute(path) {
        return Box::from(path);
    }
    bun_core::strings::concat(&[base, &[bun_paths::SEP], path])
}

/// Where a write to `dest_path`, which has a `..` in it, lands under `root`. `None` when only the kernel knows.
fn physical_dest(root: &[u8], dest_path: &[u8]) -> Option<Box<[u8]>> {
    let raw = raw_join(root, dest_path);
    let parent = RealPath::resolve(bun_paths::dirname(&raw)?)?;
    Some(join_abs(&parent, bun_paths::basename(&raw)))
}

/// The absolute directory that output files are written under.
pub struct OutputRoot {
    /// Symlink-resolved.
    real: Box<[u8]>,
    /// As joined from the working directory, when that differs from `real`.
    unresolved: Option<Box<[u8]>>,
    /// The directory does not exist yet.
    missing: bool,
    /// A `..` in the path leads where `realpath` does not say. Nothing under this root is examined.
    unknown: bool,
}

impl OutputRoot {
    fn unknown(abs: Box<[u8]>) -> Self {
        Self {
            real: abs,
            unresolved: None,
            missing: false,
            unknown: true,
        }
    }
}

/// Empty `root_path` is the working directory.
pub fn resolve_output_root(root_path: &[u8]) -> OutputRoot {
    let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir();
    let abs = join_abs(top_level_dir, root_path);
    let has_parent = has_parent_segment(root_path);
    let raw_root;
    let raw: &[u8] = if has_parent {
        raw_root = raw_join(top_level_dir, root_path);
        &raw_root
    } else {
        &abs
    };
    let (real, missing) = match RealPath::of(raw) {
        RealPath::Other(real) => (Some(real), false),
        RealPath::Same => (None, false),
        RealPath::Unknown if has_parent => return OutputRoot::unknown(abs),
        RealPath::Unknown => (None, false),
        RealPath::Missing => {
            let Some(real) = RealPath::resolve_missing(raw) else {
                return OutputRoot::unknown(abs);
            };
            // After a `..`, the directory can be one that exists.
            let missing = !has_parent || matches!(RealPath::of(&real), RealPath::Missing);
            (Some(real), missing)
        }
    };
    match real.filter(|real| **real != *abs) {
        Some(real) => OutputRoot {
            // `abs` is a second spelling of `real` only when both name one directory. After a `..` it can name another.
            unresolved: (!has_parent || RealPath::resolve(&abs).as_deref() == Some(&*real))
                .then_some(abs),
            real,
            missing,
            unknown: false,
        },
        None => OutputRoot {
            real: abs,
            unresolved: None,
            missing,
            unknown: false,
        },
    }
}
