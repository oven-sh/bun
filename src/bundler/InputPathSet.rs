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

/// Absolute paths of every input file that exists on disk.
#[derive(Default)]
pub struct InputPathSet {
    paths: PathMap,
    /// `(st_dev, st_ino)` of each path, filled on the first destination that needs it.
    identities: std::cell::OnceCell<Vec<Option<(u64, u64)>>>,
    /// `realpath` of each output subdirectory, `None` when it has no symlink in it or does not exist.
    real_parents: std::cell::RefCell<bun_collections::StringHashMap<Option<Box<[u8]>>>>,
    /// Real paths of files, and of directories whose every file is an input, read outside the module graph.
    roots: Vec<Box<[u8]>>,
}

impl InputPathSet {
    /// Every `file:` namespace input of the parse graph.
    pub(crate) fn from_graph(graph: &crate::Graph::Graph<'_>) -> Self {
        Self::from_paths(
            graph
                .input_files
                .items_source()
                .iter()
                .map(|source| &source.path)
                .filter(|path| path.namespace == b"file")
                .map(|path| path.text),
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
        self.roots.push(resolve_output_root(path));
    }

    /// The input that writing `dest_path` under `root` would replace, relative to the working directory.
    pub fn overwritten_by(
        &self,
        root: &[u8],
        dest_path: &[u8],
        write: OutputWrite,
    ) -> Option<Box<[u8]>> {
        if self.is_empty() {
            return None;
        }
        let mut abs_buf = bun_paths::path_buffer_pool::get();
        let abs =
            resolve_path::join_abs_string_buf::<platform::Auto>(root, &mut abs_buf.0, &[dest_path]);
        let real = self.through_real_parent(root, abs);
        let real: &[u8] = real.as_deref().unwrap_or(abs);

        let input: &[u8] = if let Some(index) = self
            .paths
            .get_index(abs)
            .or_else(|| self.paths.get_index(real))
        {
            &self.paths.keys()[index]
        } else if self.is_under_a_root(real) {
            real
        } else if write == OutputWrite::Truncate {
            &self.paths.keys()[self.index_of_same_file(abs)?]
        } else {
            return None;
        };
        let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
        let mut rel: Box<[u8]> = Box::from(resolve_path::relative(top_level_dir, input));
        resolve_path::platform_to_posix_in_place(&mut rel);
        Some(rel)
    }
}

impl InputPathSet {
    /// `abs` with its directory symlink-resolved, when that differs. `root` is symlink-free already.
    fn through_real_parent(&self, root: &[u8], abs: &[u8]) -> Option<Box<[u8]>> {
        let parent = bun_paths::dirname(abs)?;
        if resolve_path::is_parent_or_equal(parent, root) != resolve_path::ParentEqual::Unrelated {
            return None;
        }
        let mut real_parents = self.real_parents.borrow_mut();
        if real_parents.get(parent).is_none() {
            let mut z_buf = bun_paths::path_buffer_pool::get();
            let mut real_parent_buf = bun_paths::path_buffer_pool::get();
            let real_parent: Option<Box<[u8]>> =
                bun_sys::realpath(resolve_path::z(parent, &mut z_buf), &mut real_parent_buf)
                    .ok()
                    .filter(|real| *real != parent)
                    .map(Box::from);
            bun_core::handle_oom(real_parents.put(parent, real_parent));
        }
        let real_parent = real_parents.get(parent)?.as_deref()?;
        let mut buf = bun_paths::path_buffer_pool::get();
        Some(Box::from(
            resolve_path::join_abs_string_buf::<platform::Auto>(
                real_parent,
                &mut buf.0,
                &[bun_paths::basename(abs)],
            ),
        ))
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

/// The absolute, symlink-resolved output directory. Empty `root_path` is the working directory.
pub fn resolve_output_root(root_path: &[u8]) -> Box<[u8]> {
    let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
    let mut abs_buf = bun_paths::path_buffer_pool::get();
    let abs = resolve_path::join_abs_string_buf::<platform::Auto>(
        top_level_dir,
        &mut abs_buf.0,
        &[root_path],
    );
    let mut z_buf = bun_paths::path_buffer_pool::get();
    let abs_z = resolve_path::z(abs, &mut z_buf);
    let mut real_buf = bun_paths::path_buffer_pool::get();
    match bun_sys::realpath(abs_z, &mut real_buf) {
        Ok(real) => Box::from(real),
        Err(_) => Box::from(abs),
    }
}
