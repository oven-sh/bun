use bun_core::ZStr;

use crate::{CloseOnDrop, Error, Fd, Mode, O, Tag};

// To be used with files
// not folders!
pub struct Tmpfile<'a> {
    pub file: CloseOnDrop,
    entry: UnlinkOnDrop<'a>,
}

struct UnlinkOnDrop<'a> {
    dir: Fd,
    name: &'a ZStr,
}

impl Drop for UnlinkOnDrop<'_> {
    fn drop(&mut self) {
        let _ = crate::unlinkat(self.dir, self.name);
    }
}

impl<'a> Tmpfile<'a> {
    pub fn create(destination_dir: Fd, tmpfilename: &'a ZStr) -> crate::Result<Tmpfile<'a>> {
        Self::create_with_mode(destination_dir, tmpfilename, 0o644)
    }

    pub fn create_with_mode(
        destination_dir: Fd,
        tmpfilename: &'a ZStr,
        perm: Mode,
    ) -> crate::Result<Tmpfile<'a>> {
        let file = crate::openat(
            destination_dir,
            tmpfilename,
            O::CREAT | O::EXCL | O::CLOEXEC | O::WRONLY,
            perm,
        )
        .map(CloseOnDrop::new)?;
        let entry = UnlinkOnDrop {
            dir: destination_dir,
            name: tmpfilename,
        };

        Ok(Tmpfile {
            file: file.make_lib_uv_owned_for_syscall(Tag::open)?,
            entry,
        })
    }

    /// A failure hands the file back.
    pub fn finish(self, destname: &ZStr) -> Result<(), (Error, Self)> {
        let UnlinkOnDrop { dir, name } = self.entry;
        match crate::move_file_z_with_handle(self.file.fd(), dir, name, dir, destname) {
            Ok(()) => {
                self.keep();
                Ok(())
            }
            Err(err) => Err((err, self)),
        }
    }

    /// Closes the file and leaves it on disk.
    pub fn keep(self) {
        let _ = core::mem::ManuallyDrop::new(self.entry);
    }
}
