use bun_core::ZStr;

use crate::{Fd, FdExt, Mode, O, Tag};

// To be used with files
// not folders!
pub struct Tmpfile<'a> {
    destination_dir: Fd,
    // Caller-supplied tmp name, valid for the lifetime of the Tmpfile.
    tmpfilename: &'a ZStr,
    pub fd: Fd,
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
        let fd = crate::openat(
            destination_dir,
            tmpfilename,
            O::CREAT | O::EXCL | O::CLOEXEC | O::WRONLY,
            perm,
        )?
        .make_lib_uv_owned_for_syscall(Tag::open)?;

        Ok(Tmpfile {
            destination_dir,
            tmpfilename,
            fd,
        })
    }

    pub fn finish(&mut self, destname: &ZStr) -> crate::Result<()> {
        crate::move_file_z_with_handle(
            self.fd,
            self.destination_dir,
            self.tmpfilename,
            self.destination_dir,
            destname,
        )
    }
}
