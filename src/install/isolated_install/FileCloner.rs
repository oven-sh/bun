use bun_paths::path_options::{Kind, PathSeparators};
use bun_paths::{AutoRelPath, Path};
use bun_sys::{self as sys, Dir, Errno, Fd};

// macOS clonefileat only

// `cache_dir_subpath` is borrowed mutably (rather than owned) so the caller's
// path survives a clonefile→hardlink fallback (`continue 'backend` in
// `Installer::Task::run`). The borrow must be `&mut` because `Path::slice_z`
// writes the NUL terminator into the pooled buf.
#[allow(dead_code)]
pub(crate) struct FileCloner<'a> {
    pub cache_dir: Fd,
    pub cache_dir_subpath: &'a mut AutoRelPath,
    /// The OS path unit is `u8` on
    /// macOS (the only platform `clonefileat` exists on), so the unit param is
    /// spelled `u8` to keep this module compiling on Windows where `OSPathChar`
    /// would be `u16` and `slice_z()` would yield a `WStr`.
    pub dest_subpath: Path<u8, { Kind::ANY }, { PathSeparators::AUTO }>,
}

impl FileCloner<'_> {
    /// `clonefileat(2)` of the cached package into `parent`, named `name`.
    #[allow(dead_code)]
    fn clonefileat(&mut self, parent: &Dir, name: &bun_core::ZStr) -> sys::Result<()> {
        sys::clonefileat(
            self.cache_dir,
            self.cache_dir_subpath.slice_z(),
            parent.fd(),
            name,
        )
    }

    #[allow(dead_code)]
    pub(crate) fn clone(&mut self) -> sys::Result<()> {
        // `clonefileat(2)` resolves every component of a destination path, so
        // a symlink planted at this store entry's `node_modules` would carry
        // the clone out of the project. Open the parent through the installer's
        // own directories without following one, then clone relative to that
        // fd with the bare name: no component is resolved by path.
        let Some(parent_len) = self.dest_subpath.dirname().map(|parent| parent.len()) else {
            return Err(sys::Error::from_code(Errno::EINVAL, sys::Tag::clonefile)
                .with_path(self.dest_subpath.slice()));
        };
        let parent =
            crate::isolated_install::make_store_path(&self.dest_subpath.slice()[..parent_len])?;
        // The name is one package-name component. Copy it out, because
        // `clonefileat` borrows `self` mutably for the cache path.
        let mut name_buf = bun_paths::path_buffer_pool::get();
        let name_len = {
            let name = self.dest_subpath.basename();
            name_buf[..name.len()].copy_from_slice(name);
            name_buf[name.len()] = 0;
            name.len()
        };
        // SAFETY: NUL written at `name_buf[name_len]` above.
        let name = bun_core::ZStr::from_buf(&name_buf[..], name_len);

        match self.clonefileat(&parent, name) {
            Ok(()) => Ok(()),
            Err(err) if err.get_errno() == Errno::EEXIST => {
                // Stale leftover (an earlier crash, or a re-run after the
                // global-store staging directory wasn't cleaned). The
                // global-store entry is published by an entry-level
                // rename in `commitGlobalStoreEntry`, so it's always safe
                // to wipe and re-clone here — we're only ever writing
                // into a per-process staging directory or a project-local
                // path, never into a published shared directory.
                let _ = parent.delete_tree(name.as_bytes());
                self.clonefileat(&parent, name)
            }
            Err(err) => Err(err),
        }
    }
}
