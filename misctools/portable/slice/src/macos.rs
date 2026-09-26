//! Steps for a macOS host: what `bun_sys` and `bun_core` have for macOS only. A copy that the file
//! system makes without copying (`clonefile`), the copy that macOS makes itself (`copyfile`,
//! `fcopyfile`), the path of an open file (`fcntl(F_GETPATH)`).

use bun_sys::{Fd, File, Maybe, O};

use crate::json::Report;
use crate::{Work, z};

#[cfg(bun_portable)]
use bun_darwin_sys::constants::{COPYFILE_ACL, COPYFILE_DATA};
#[cfg(not(bun_portable))]
use bun_sys::c::{COPYFILE_ACL, COPYFILE_DATA};

fn read(work: &Work, relative: &[u8]) -> Maybe<Vec<u8>> {
    File::from_fd(bun_sys::open(z(&work.path(relative)), O::RDONLY, 0)?).read_to_end()
}

/// A copy by path the way bun's `fs.copyFile` makes one of a large file on macOS: `clonefile`, and
/// `copyfile` if that is refused. The file system decides (APFS clones; others do not, and nothing
/// clones from one volume to another), so which one it was is a detail.
fn clone_or_copy(report: &mut Report, what: &str, cloned: Maybe<()>, from: &[u8], to: &[u8]) -> Maybe<()> {
    match cloned {
        Ok(()) => {
            report.detail(what);
            report.string("way", b"clonefile");
            report.end_line();
            Ok(())
        }
        Err(error) => {
            report.detail(what);
            report.string("way", b"copyfile");
            report.string("clonefile was refused with", error.name());
            report.number("errno", i64::from(error_of_the_last_call()));
            report.end_line();
            bun_sys::copyfile(z(from), z(to), COPYFILE_ACL | COPYFILE_DATA)
        }
    }
}

/// The error number of macOS that the last call of a function of macOS left, and 0 from then on.
fn error_of_the_last_call() -> i32 {
    #[cfg(bun_portable)]
    {
        bun_darwin_sys::host_imports::take_last_error_of_macos()
    }
    #[cfg(not(bun_portable))]
    {
        0
    }
}

pub(crate) fn steps(report: &mut Report, work: &Work, root_fd: Fd) {
    let renamed = work.path(b"a/renamed.txt");

    // ── clonefile ──
    for (step, relative, by_descriptor) in [
        ("clonefile", &b"a/clone.txt"[..], 0),
        ("clonefileat", b"a/clone-at.txt", 1),
        ("clonefileat, from the working directory", b"a/clone-cwd.txt", 2),
    ] {
        let to = work.path(relative);
        let relative_z = [relative, b"\0"].concat();
        let cloned = match by_descriptor {
            0 => bun_sys::clonefile(z(&renamed), z(&to)),
            1 => bun_sys::clonefileat(root_fd, z(b"a/renamed.txt\0"), root_fd, z(&relative_z)),
            _ => bun_sys::clonefileat(Fd::cwd(), z(&renamed), Fd::cwd(), z(&to)),
        };
        let copied = clone_or_copy(report, step, cloned, &renamed, &to);
        report.begin(step);
        report.string("path", relative);
        match copied.and_then(|()| read(work, relative)) {
            Ok(bytes) => {
                report.string("content", &bytes);
                report.end_ok();
            }
            Err(error) => report.end_error(&error),
        }
    }
    // A file system that clones refuses because the destination is there, one that does not clone
    // refuses because it does not.
    report.begin("clonefile, destination exists");
    report.string("path", b"a/clone.txt");
    match bun_sys::clonefile(z(&renamed), z(&work.path(b"a/clone.txt"))) {
        Ok(()) => report.boolean("refused", false),
        Err(error) => {
            report.boolean("refused", true);
            report.end_ok();
            report.detail("clonefile, destination exists");
            report.string("refused with", error.name());
            report.number("errno", i64::from(error_of_the_last_call()));
            report.end_line();
            report.begin("clonefile, destination exists, the copy is as it was");
        }
    }
    match read(work, b"a/clone.txt") {
        Ok(bytes) => {
            report.string("content", &bytes);
            report.end_ok();
        }
        Err(error) => report.end_error(&error),
    }

    // ── fcopyfile ──
    report.begin("fcopyfile");
    report.string("path", b"a/renamed.txt -> a/fcopy.txt");
    let copied = (|| -> Maybe<Vec<u8>> {
        let from = File::from_fd(bun_sys::open(z(&renamed), O::RDONLY, 0)?);
        let to = File::from_fd(bun_sys::open(
            z(&work.path(b"a/fcopy.txt")),
            O::WRONLY | O::CREAT | O::TRUNC,
            0o644,
        )?);
        bun_sys::fcopyfile(from.handle(), to.handle(), COPYFILE_DATA)?;
        drop(to);
        read(work, b"a/fcopy.txt")
    })();
    match copied {
        Ok(bytes) => {
            report.string("content", &bytes);
            report.end_ok();
        }
        Err(error) => report.end_error(&error),
    }

    // ── the path of an open file ──
    report.begin("path of a descriptor");
    report.string("path", b"a/renamed.txt");
    match bun_sys::open(z(&renamed), O::RDONLY, 0) {
        Ok(fd) => {
            let file = File::from_fd(fd);
            let mut buffer = bun_paths::path_buffer_pool::get();
            match bun_sys::get_fd_path(fd, &mut buffer) {
                Ok(path) => {
                    report.boolean(
                        "ends_with slice-tree/a/renamed.txt",
                        path.ends_with(b"slice-tree/a/renamed.txt"),
                    );
                    report.boolean("absolute", path.starts_with(b"/"));
                    report.end_ok();
                }
                Err(error) => report.end_error(&error),
            }
            report.begin("path of a descriptor, bun_core");
            let mut bytes = [0u8; 4096];
            // SAFETY: the buffer has the 4096 bytes that it is said to have.
            let length = unsafe { bun_core::fd_path_raw(fd, bytes.as_mut_ptr(), bytes.len()) };
            report.number("result is positive", i64::from(length > 0));
            report.boolean(
                "ends_with slice-tree/a/renamed.txt",
                length > 0 && bytes[..length as usize].ends_with(b"slice-tree/a/renamed.txt"),
            );
            report.end_ok();
            drop(file);
        }
        Err(error) => report.end_error(&error),
    }
    report.begin("path of a descriptor, of a directory");
    {
        let mut buffer = bun_paths::path_buffer_pool::get();
        match bun_sys::get_fd_path(root_fd, &mut buffer) {
            Ok(path) => {
                report.boolean("ends_with slice-tree", path.ends_with(b"slice-tree"));
                report.end_ok();
            }
            Err(error) => report.end_error(&error),
        }
    }
    report.begin("path of a descriptor that is closed");
    {
        let mut buffer = bun_paths::path_buffer_pool::get();
        // No program has this many files open.
        match bun_sys::get_fd_path(Fd::from_native(1_000_000), &mut buffer) {
            Ok(_) => report.end_ok(),
            Err(error) => report.end_error(&error),
        }
    }
}
