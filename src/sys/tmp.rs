use bun_core::ZStr;

use crate::{E, ErrorCase, Fd, FdExt, O, Tag};

// O_TMPFILE doesn't seem to work very well.
const ALLOW_TMPFILE: bool = false;

// To be used with files
// not folders!
pub struct Tmpfile<'a> {
    pub destination_dir: Fd,
    // BORROW_PARAM (Tmpfile.zig:5): caller-supplied tmp name, valid for the
    // lifetime of the Tmpfile.
    pub tmpfilename: &'a ZStr,
    pub fd: Fd,
    pub using_tmpfile: bool,
}

impl<'a> Tmpfile<'a> {
    pub fn create(destination_dir: Fd, tmpfilename: &'a ZStr) -> crate::Result<Tmpfile<'a>> {
        let perm = 0o644;
        let mut tmpfile = Tmpfile {
            destination_dir,
            tmpfilename,
            fd: Fd::INVALID,
            using_tmpfile: ALLOW_TMPFILE,
        };

        'open: loop {
            // ALLOW_TMPFILE = false (Zig comment: O_TMPFILE doesn't seem to work
            // very well). Dead in Zig too, but Zig comptime drops it; Rust still
            // type-checks `if false` bodies, so the body must resolve.
            if ALLOW_TMPFILE {
                // SAFETY: literal is NUL-terminated; len excludes the NUL.
                let dot = ZStr::from_static(b".\0");
                match crate::openat(
                    destination_dir,
                    dot,
                    O::WRONLY | O::TMPFILE | O::CLOEXEC,
                    perm,
                ) {
                    Ok(fd) => {
                        tmpfile.fd =
                            fd.make_lib_uv_owned_for_syscall(Tag::open, ErrorCase::CloseOnFail)?;
                        break 'open;
                    }
                    // PORT NOTE: Zig matched .OPNOTSUPP; on Linux that aliases ENOTSUP.
                    Err(err) => match err.get_errno() {
                        E::EINVAL | E::ENOTSUP | E::ENOSYS => {
                            tmpfile.using_tmpfile = false;
                        }
                        _ => return Err(err),
                    },
                }
            }

            tmpfile.fd = crate::openat(
                destination_dir,
                tmpfilename,
                O::CREAT | O::CLOEXEC | O::WRONLY,
                perm,
            )?
            .make_lib_uv_owned_for_syscall(Tag::open, ErrorCase::CloseOnFail)?;
            break 'open;
        }

        Ok(tmpfile)
    }

    // TODO(port): narrow error set
    pub fn finish(&mut self, destname: &ZStr) -> Result<(), bun_core::Error> {
        // ALLOW_TMPFILE = false dead branch — see `create()` note above.
        if ALLOW_TMPFILE && self.using_tmpfile {
            let mut retry = true;
            // SAFETY: basename returns a suffix of `destname`, which is NUL-terminated,
            // so the suffix is also NUL-terminated at the same position.
            let basename: &ZStr = unsafe {
                let b = bun_paths::basename(destname.as_bytes());
                ZStr::from_raw(b.as_ptr(), b.len())
            };
            while retry {
                match crate::linkat_tmpfile(self.fd, self.destination_dir, basename) {
                    Ok(()) => return Ok(()),
                    Err(err) if err.get_errno() == E::EEXIST && retry => {
                        let _ = crate::unlinkat(self.destination_dir, basename);
                        retry = false;
                    }
                    Err(err) => return Err(err.into()),
                }
            }
        }

        crate::move_file_z_with_handle(
            self.fd,
            self.destination_dir,
            self.tmpfilename,
            self.destination_dir,
            destname,
        )
    }
}

// ported from: src/sys/tmp.zig
