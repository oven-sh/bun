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
        Self { paths: set }
    }

    /// The input that writing `dest_path` under `root` would replace, relative
    /// to the working directory.
    pub fn overwritten_by(&self, root: &[u8], dest_path: &[u8]) -> Option<Box<[u8]>> {
        let abs = resolve_path::join_abs_string::<platform::Auto>(root, &[dest_path]);
        let index = self.paths.get_index(abs)?;
        let input = &self.paths.keys()[index];
        let top_level_dir = bun_resolver::fs::FileSystem::get().top_level_dir;
        let mut rel: Box<[u8]> = Box::from(resolve_path::relative(top_level_dir, input));
        resolve_path::platform_to_posix_in_place(&mut rel);
        Some(rel)
    }
}

/// The absolute, symlink-resolved output directory. An empty `root_path` is
/// the working directory.
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
