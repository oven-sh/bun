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
        self.roots.push(resolve_output_root(path).real);
    }

    /// The input that writing `dest_path` under `root` would replace, relative to the working directory.
    pub fn overwritten_by(
        &self,
        root: &OutputRoot,
        dest_path: &[u8],
        write: OutputWrite,
    ) -> Option<Box<[u8]>> {
        if self.is_empty() {
            return None;
        }
        let mut abs_buf = bun_paths::path_buffer_pool::get();
        let physical_abs;
        let abs: &[u8] = match physical_dest(&root.real, dest_path) {
            Some(path) => {
                physical_abs = path;
                &physical_abs
            }
            None => resolve_path::join_abs_string_buf::<platform::Auto>(
                &root.real,
                &mut abs_buf.0,
                &[dest_path],
            ),
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
                RealPath::Same => abs,
                RealPath::Other(path) => {
                    real_path = path;
                    &real_path
                }
            };
            if let Some(index) = self
                .paths
                .get_index(real)
                .or_else(|| self.index_of_unresolved(root, dest_path))
            {
                &self.paths.keys()[index]
            } else if self.is_under_a_root(real) {
                real
            } else if write == OutputWrite::Rename {
                return None;
            } else if let Some(target) = self.link_target_under_a_root(abs) {
                link_target = target;
                &link_target
            } else {
                &self.paths.keys()[self.index_of_same_file(abs)?]
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
                let mut buf = bun_paths::path_buffer_pool::get();
                RealPath::Other(Box::from(
                    resolve_path::join_abs_string_buf::<platform::Auto>(
                        real_parent,
                        &mut buf.0,
                        &[bun_paths::basename(abs)],
                    ),
                ))
            }
            Some(RealPath::Missing) => RealPath::Missing,
            Some(RealPath::Same) | None => RealPath::Same,
        }
    }

    /// The inputs keep the spelling the resolver saw. On Windows `realpath` rewrites a subst or mapped drive.
    fn index_of_unresolved(&self, root: &OutputRoot, dest_path: &[u8]) -> Option<usize> {
        let unresolved = root.unresolved.as_deref()?;
        if has_parent_segment(dest_path) {
            return None;
        }
        let mut buf = bun_paths::path_buffer_pool::get();
        self.paths
            .get_index(resolve_path::join_abs_string_buf::<platform::Auto>(
                unresolved,
                &mut buf.0,
                &[dest_path],
            ))
    }

    /// A symlink at the destination whose target is a root, or is in a root directory.
    fn link_target_under_a_root(&self, abs: &[u8]) -> Option<Box<[u8]>> {
        if self.roots.is_empty() {
            return None;
        }
        let mut z_buf = bun_paths::path_buffer_pool::get();
        let abs_z = resolve_path::z(abs, &mut z_buf);
        let link = bun_sys::lstat(abs_z).ok()?;
        if bun_sys::kind_from_mode(link.st_mode as bun_sys::Mode) != bun_sys::FileKind::SymLink {
            return None;
        }
        let mut target_buf = bun_paths::path_buffer_pool::get();
        let target = bun_sys::realpath(abs_z, &mut target_buf).ok()?;
        self.is_under_a_root(target).then(|| Box::from(target))
    }

    /// An existing file that is a root, or is in a root directory.
    fn is_under_a_root(&self, real: &[u8]) -> bool {
        if !self.roots.iter().any(|root| {
            resolve_path::is_parent_or_equal(root, real) != resolve_path::ParentEqual::Unrelated
        }) {
            return false;
        }
        let mut z_buf = bun_paths::path_buffer_pool::get();
        bun_sys::lstat(resolve_path::z(real, &mut z_buf)).is_ok()
    }

    /// A write to a symlink, or to a file with another hard link, lands in a file that has a second name.
    fn index_of_same_file(&self, abs: &[u8]) -> Option<usize> {
        let mut z_buf = bun_paths::path_buffer_pool::get();
        let abs_z = resolve_path::z(abs, &mut z_buf);
        let link = bun_sys::lstat(abs_z).ok()?;
        let is_symlink =
            bun_sys::kind_from_mode(link.st_mode as bun_sys::Mode) == bun_sys::FileKind::SymLink;
        let written = if is_symlink {
            bun_sys::stat(abs_z).ok()?
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
                        let st = bun_sys::stat(resolve_path::z(input, &mut buf)).ok()?;
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
}

impl RealPath {
    fn of(dir: &[u8]) -> Self {
        let mut z_buf = bun_paths::path_buffer_pool::get();
        let mut real_buf = bun_paths::path_buffer_pool::get();
        match bun_sys::realpath(resolve_path::z(dir, &mut z_buf), &mut real_buf) {
            Ok(real) if real != dir => Self::Other(Box::from(real)),
            Err(err) if err.get_errno() == bun_sys::E::ENOENT => Self::Missing,
            _ => Self::Same,
        }
    }

    /// `dir` as the kernel resolves it: a symlink before the `..` after it, and the part that does not exist by name.
    fn resolve(dir: &[u8]) -> Box<[u8]> {
        match Self::of(dir) {
            Self::Other(real) => real,
            Self::Same => Box::from(dir),
            Self::Missing => Self::resolve_missing(dir),
        }
    }

    /// A path that `realpath` does not find: its parent as the kernel resolves it, then its own name.
    fn resolve_missing(dir: &[u8]) -> Box<[u8]> {
        let Some(parent) = bun_paths::dirname(dir).filter(|parent| parent.len() < dir.len()) else {
            return Box::from(dir);
        };
        let name = bun_paths::basename(dir);
        let parent = Self::resolve(parent);
        let mut buf = bun_paths::path_buffer_pool::get();
        let joined =
            resolve_path::join_abs_string_buf::<platform::Auto>(&parent, &mut buf.0, &[name]);
        // `new/../out`: `new` does not exist, and `out` can exist and be a symlink.
        if name != b".." && has_parent_segment(dir) {
            if let Self::Other(real) = Self::of(joined) {
                return real;
            }
        }
        Box::from(joined)
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

/// `path` under `base`, with its `..` segments kept.
fn raw_join<'a>(
    base: &[u8],
    path: &'a [u8],
    buf: &'a mut bun_core::PathBuffer,
) -> Option<&'a [u8]> {
    if bun_paths::is_absolute(path) {
        return Some(path);
    }
    let len = base.len() + 1 + path.len();
    if len > buf.0.len() {
        return None;
    }
    buf.0[..base.len()].copy_from_slice(base);
    buf.0[base.len()] = bun_paths::SEP;
    buf.0[base.len() + 1..len].copy_from_slice(path);
    Some(&buf.0[..len])
}

/// Where a write to `dest_path` under `root` lands, for a path with a `..` in it.
fn physical_dest(root: &[u8], dest_path: &[u8]) -> Option<Box<[u8]>> {
    if !has_parent_segment(dest_path) {
        return None;
    }
    let mut raw_buf = bun_paths::path_buffer_pool::get();
    let raw = raw_join(root, dest_path, &mut raw_buf)?;
    let parent = RealPath::resolve(bun_paths::dirname(raw)?);
    let mut buf = bun_paths::path_buffer_pool::get();
    Some(Box::from(
        resolve_path::join_abs_string_buf::<platform::Auto>(
            &parent,
            &mut buf.0,
            &[bun_paths::basename(raw)],
        ),
    ))
}

/// The absolute directory that output files are written under.
pub struct OutputRoot {
    /// Symlink-resolved.
    real: Box<[u8]>,
    /// As joined from the working directory, when that differs from `real`.
    unresolved: Option<Box<[u8]>>,
    /// The directory does not exist yet.
    missing: bool,
}

/// Empty `root_path` is the working directory.
pub fn resolve_output_root(root_path: &[u8]) -> OutputRoot {
    let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir();
    let mut abs_buf = bun_paths::path_buffer_pool::get();
    let abs = resolve_path::join_abs_string_buf::<platform::Auto>(
        top_level_dir,
        &mut abs_buf.0,
        &[root_path],
    );
    let has_parent = has_parent_segment(root_path);
    let mut raw_buf = bun_paths::path_buffer_pool::get();
    let raw: &[u8] = if has_parent {
        raw_join(top_level_dir, root_path, &mut raw_buf).unwrap_or(abs)
    } else {
        abs
    };
    let (real, missing) = match RealPath::of(raw) {
        RealPath::Other(real) => (Some(real), false),
        RealPath::Same => (None, false),
        RealPath::Missing => {
            let real = RealPath::resolve_missing(raw);
            // After a `..`, the directory can be one that exists.
            let missing = !has_parent || matches!(RealPath::of(&real), RealPath::Missing);
            (Some(real), missing)
        }
    };
    match real.filter(|real| **real != *abs) {
        Some(real) => OutputRoot {
            // `abs` is a second spelling of `real` only when both name one directory. After a `..` it can name another.
            unresolved: (!has_parent || *RealPath::resolve(abs) == *real).then(|| Box::from(abs)),
            real,
            missing,
        },
        None => OutputRoot {
            real: Box::from(abs),
            unresolved: None,
            missing,
        },
    }
}
