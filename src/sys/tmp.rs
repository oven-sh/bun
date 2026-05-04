use bun_str::ZStr;

use crate::{Errno, Fd, O};

// O_TMPFILE doesn't seem to work very well.
const ALLOW_TMPFILE: bool = false;

// To be used with files
// not folders!
pub struct Tmpfile<'a> {
    pub destination_dir: Fd,
    // TODO(port): lifetime — borrowed from caller for the lifetime of the Tmpfile
    pub tmpfilename: &'a ZStr,
    pub fd: Fd,
    pub using_tmpfile: bool,
}

impl<'a> Default for Tmpfile<'a> {
    fn default() -> Self {
        Self {
            destination_dir: Fd::invalid(),
            tmpfilename: ZStr::EMPTY,
            fd: Fd::invalid(),
            using_tmpfile: ALLOW_TMPFILE,
        }
    }
}

impl<'a> Tmpfile<'a> {
    pub fn create(destination_dir: Fd, tmpfilename: &'a ZStr) -> crate::Result<Tmpfile<'a>> {
        let perm = 0o644;
        let mut tmpfile = Tmpfile {
            destination_dir,
            tmpfilename,
            ..Default::default()
        };

        'open: loop {
            if ALLOW_TMPFILE {
                // TODO(port): dead branch (ALLOW_TMPFILE = false); Rust still type-checks it,
                // so O::TMPFILE / make_libuv_owned_fd must exist or this block needs #[cfg].
                match crate::openat(
                    destination_dir,
                    ZStr::from_lit(b".\0"),
                    O::WRONLY | O::TMPFILE | O::CLOEXEC,
                    perm,
                ) {
                    Ok(fd) => {
                        tmpfile.fd = match crate::make_libuv_owned_fd(
                            fd,
                            crate::Syscall::Open,
                            crate::CloseOnFail,
                        ) {
                            Ok(owned_fd) => owned_fd,
                            Err(err) => return Err(err),
                        };
                        break 'open;
                    }
                    Err(err) => match err.get_errno() {
                        Errno::INVAL | Errno::OPNOTSUPP | Errno::NOSYS => {
                            tmpfile.using_tmpfile = false;
                        }
                        _ => return Err(err),
                    },
                }
            }

            tmpfile.fd = match crate::openat(
                destination_dir,
                tmpfilename,
                O::CREAT | O::CLOEXEC | O::WRONLY,
                perm,
            ) {
                Ok(fd) => match fd.make_libuv_owned_for_syscall(crate::Syscall::Open, crate::CloseOnFail) {
                    Ok(owned_fd) => owned_fd,
                    Err(err) => return Err(err),
                },
                Err(err) => return Err(err),
            };
            break 'open;
        }

        Ok(tmpfile)
    }

    // TODO(port): narrow error set
    pub fn finish(&mut self, destname: &ZStr) -> Result<(), bun_core::Error> {
        if ALLOW_TMPFILE {
            if self.using_tmpfile {
                let mut retry = true;
                // SAFETY: basename returns a suffix of `destname`, which is NUL-terminated,
                // so the suffix is also NUL-terminated at the same position.
                let basename: &ZStr = unsafe {
                    let b = bun_paths::basename(destname.as_bytes());
                    ZStr::from_raw(b.as_ptr(), b.len())
                };
                while retry {
                    let ret = crate::linkat_tmpfile(self.fd, self.destination_dir, basename);
                    match ret {
                        Ok(()) => {
                            return Ok(());
                        }
                        Err(err) => {
                            if err.get_errno() == Errno::EXIST && retry {
                                let _ = crate::unlinkat(self.destination_dir, basename);
                                retry = false;
                                continue;
                            } else {
                                ret.unwrap()?;
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }

        crate::move_file_z_with_handle(
            self.fd,
            self.destination_dir,
            self.tmpfilename,
            self.destination_dir,
            destname,
        )?;
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys/tmp.zig (89 lines)
//   confidence: medium
//   todos:      3
//   notes:      ALLOW_TMPFILE=false dead branches still type-check in Rust; may need #[cfg] gating if O::TMPFILE/linkat_tmpfile absent. Tmpfile borrows tmpfilename via <'a>.
// ──────────────────────────────────────────────────────────────────────────
