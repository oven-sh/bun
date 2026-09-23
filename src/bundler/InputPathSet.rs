use crate::mal_prelude::*;

use bun_paths::resolve_path::{self, platform};

#[cfg(any(windows, target_os = "macos"))]
type PathMap = bun_collections::CaseInsensitiveAsciiStringArrayHashMap<()>;
#[cfg(not(any(windows, target_os = "macos")))]
type PathMap = bun_collections::StringArrayHashMap<()>;

/// Absolute paths of every input file that exists on disk.
#[derive(Default)]
pub struct InputPathSet {
    paths: PathMap,
    /// `(st_dev, st_ino)` of each path, filled on the first destination that needs it.
    identities: std::cell::OnceCell<Vec<Option<(u64, u64)>>>,
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
            identities: Default::default(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.paths.count() == 0
    }

    /// The input that writing `dest_path` under `root` would replace, relative to the working directory.
    pub fn overwritten_by(&self, root: &[u8], dest_path: &[u8]) -> Option<Box<[u8]>> {
        if self.is_empty() {
            return None;
        }
        let abs = resolve_path::join_abs_string::<platform::Auto>(root, &[dest_path]);
        let index = match self.paths.get_index(abs) {
            Some(index) => index,
            None => self.index_of_same_file(abs)?,
        };
        let input = &self.paths.keys()[index];
        let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
        let mut rel: Box<[u8]> = Box::from(resolve_path::relative(top_level_dir, input));
        resolve_path::platform_to_posix_in_place(&mut rel);
        Some(rel)
    }
}

impl InputPathSet {
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
