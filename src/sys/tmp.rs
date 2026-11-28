use core::ops::Deref;

use bun_core::ZStr;

use crate::{AsFd, CloseOnDrop, Dir, Error, Fd, Mode, O};

/// The path of something that is removed when this drops.
#[must_use]
pub struct RemoveOnDrop<N: Deref<Target = ZStr>, D: AsFd, const TREE: bool> {
    dir: D,
    /// `keep` takes it.
    name: Option<N>,
}

pub type UnlinkOnDrop<N, D = Fd> = RemoveOnDrop<N, D, false>;
pub type DeleteTreeOnDrop<N, D = Fd> = RemoveOnDrop<N, D, true>;

impl<N: Deref<Target = ZStr>, D: AsFd, const TREE: bool> RemoveOnDrop<N, D, TREE> {
    pub fn new(dir: D, name: N) -> Self {
        Self {
            dir,
            name: Some(name),
        }
    }

    pub fn dir(&self) -> D {
        self.dir
    }

    /// Leaves it on disk.
    pub fn keep(mut self) -> N {
        self.name.take().expect("taken once")
    }

    pub fn rename_to(self, dir: impl AsFd, name: &ZStr) -> crate::Result<()> {
        crate::renameat(self.dir, &self, dir, name)?;
        self.keep();
        Ok(())
    }
}

impl<'a, D: AsFd, const TREE: bool> RemoveOnDrop<&'a ZStr, D, TREE> {
    /// Outlives `self`.
    pub fn name(&self) -> &'a ZStr {
        self.name.expect("taken once")
    }
}

impl<N: Deref<Target = ZStr>, D: AsFd, const TREE: bool> Deref for RemoveOnDrop<N, D, TREE> {
    type Target = ZStr;
    fn deref(&self) -> &ZStr {
        self.name.as_deref().expect("taken once")
    }
}

impl<N: Deref<Target = ZStr>, D: AsFd, const TREE: bool> Drop for RemoveOnDrop<N, D, TREE> {
    fn drop(&mut self) {
        let Some(name) = self.name.as_deref() else {
            return;
        };
        let dir = self.dir.as_fd();
        if TREE {
            let _ = Dir::borrow(&dir).delete_tree(name);
        } else if crate::unlinkat(dir, name).is_err() && cfg!(windows) && dir == Fd::cwd() {
            // `unlinkat` does not resolve `..` there.
            let _ = crate::unlink(name);
        }
    }
}

/// An open file that is unlinked on drop.
pub struct Tmpfile<N: Deref<Target = ZStr>, D: AsFd = Fd> {
    pub file: CloseOnDrop,
    /// After `file`: Windows can't remove every file that is open.
    entry: UnlinkOnDrop<N, D>,
}

impl<N: Deref<Target = ZStr>, D: AsFd> Tmpfile<N, D> {
    pub fn create(destination_dir: D, tmpfilename: N) -> crate::Result<Self> {
        Self::create_with_mode(destination_dir, tmpfilename, 0o644)
    }

    pub fn create_with_mode(destination_dir: D, tmpfilename: N, perm: Mode) -> crate::Result<Self> {
        let flags = O::CREAT | O::EXCL | O::CLOEXEC | O::WRONLY;
        Self::open(destination_dir, tmpfilename, flags, perm)
    }

    pub fn open(dir: D, name: N, flags: i32, perm: Mode) -> crate::Result<Self> {
        Ok(Self {
            file: crate::openat(dir, &name, flags, perm).map(CloseOnDrop::new)?,
            entry: UnlinkOnDrop::new(dir, name),
        })
    }

    pub fn name(&self) -> &ZStr {
        &self.entry
    }

    /// A failure hands the file back.
    pub fn finish(self, destname: &ZStr) -> Result<(), (Error, Self)> {
        let dir = self.entry.dir.as_fd();
        self.finish_at(dir, destname)
    }

    /// To end up on another file system, the file has to be open for reading too.
    pub fn finish_at(self, to_dir: Fd, destname: &ZStr) -> Result<(), (Error, Self)> {
        let dir = self.entry.dir.as_fd();
        match crate::move_file_z_with_handle(self.file.fd(), dir, &self.entry, to_dir, destname) {
            Ok(()) => {
                self.keep();
                Ok(())
            }
            Err(err) => Err((err, self)),
        }
    }

    /// Closes the file and leaves it on disk.
    pub fn keep(self) -> N {
        self.entry.keep()
    }

    pub fn close(self) -> UnlinkOnDrop<N, D> {
        self.entry
    }
}
