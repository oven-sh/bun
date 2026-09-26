//! Steps for every host that is not Windows: functions of `bun_sys` that bun has for POSIX, and that
//! its code for macOS does in another way than its code for Linux.

use bun_sys::{Fd, File, O, RenameMode, Renameat2Flags};

use crate::json::Report;
use crate::{Work, kind_name, stat_fields, z};

pub(crate) fn steps(report: &mut Report, work: &Work, root_fd: Fd) {
    let renamed = work.path(b"a/renamed.txt");
    let link = work.path(b"a/link");

    report.step(
        "renameat2, no replace, destination exists",
        b"a/renamed.txt -> a/copy.txt",
        bun_sys::renameat2(
            root_fd,
            z(b"a/renamed.txt\0"),
            root_fd,
            z(b"a/copy.txt\0"),
            Renameat2Flags {
                mode: RenameMode::NoReplace,
                nofollow: false,
            },
        ),
    );
    report.step(
        "renameat2, no replace",
        b"a/copy.txt -> a/moved.txt",
        bun_sys::renameat2(
            root_fd,
            z(b"a/copy.txt\0"),
            root_fd,
            z(b"a/moved.txt\0"),
            Renameat2Flags {
                mode: RenameMode::NoReplace,
                nofollow: false,
            },
        ),
    );
    report.step(
        "renameat, back",
        b"a/moved.txt -> a/copy.txt",
        bun_sys::renameat(root_fd, z(b"a/moved.txt\0"), root_fd, z(b"a/copy.txt\0")),
    );

    report.begin("lchmod");
    report.string("path", b"a/copy.txt");
    match bun_sys::lchmod(z(&work.path(b"a/copy.txt")), 0o640)
        .and_then(|()| bun_sys::stat(z(&work.path(b"a/copy.txt"))))
    {
        Ok(stat) => {
            report.number("mode", (stat.st_mode as i64) & 0o777);
            report.end_ok();
        }
        Err(error) => report.end_error(&error),
    }

    report.begin("realpath, of a link");
    report.string("path", b"a/link");
    {
        let mut buffer = bun_paths::path_buffer_pool::get();
        match bun_sys::realpath(z(&link), &mut buffer) {
            Ok(path) => {
                report.boolean(
                    "ends_with slice-tree/a/renamed.txt",
                    path.ends_with(b"slice-tree/a/renamed.txt"),
                );
                report.end_ok();
            }
            Err(error) => report.end_error(&error),
        }
    }

    report.begin("stat, times");
    report.string("path", b"a/renamed.txt");
    match bun_sys::stat(z(&renamed)) {
        Ok(stat) => {
            let birth = bun_sys::stat_birthtime(&stat);
            let modified = bun_sys::stat_mtime(&stat);
            report.boolean("has a time of birth", birth.sec > 0);
            report.boolean(
                "born before it was last written",
                (birth.sec, birth.nsec) <= (modified.sec, modified.nsec),
            );
            report.end_ok();
        }
        Err(error) => report.end_error(&error),
    }

    report.begin("exists_at");
    report.boolean(
        "a/renamed.txt",
        bun_sys::exists_at(root_fd, z(b"a/renamed.txt\0")),
    );
    report.boolean(
        "a/missing.txt",
        bun_sys::exists_at(root_fd, z(b"a/missing.txt\0")),
    );
    report.boolean(
        "from the working directory",
        bun_sys::exists_at(Fd::cwd(), z(&renamed)),
    );
    report.end_ok();

    report.begin("lstatat, link");
    report.string("path", b"a/link");
    match bun_sys::lstatat(root_fd, z(b"a/link\0")) {
        Ok(stat) => {
            report.string(
                "kind",
                kind_name(bun_sys::kind_from_mode(stat.st_mode as bun_sys::Mode)).as_bytes(),
            );
            report.end_ok();
        }
        Err(error) => report.end_error(&error),
    }
    report.begin("fstatat, through the link");
    report.string("path", b"a/link");
    match bun_sys::fstatat(root_fd, z(b"a/link\0")) {
        Ok(stat) => {
            stat_fields(report, &stat);
            report.end_ok();
        }
        Err(error) => report.end_error(&error),
    }
    report.begin("fstatat, missing");
    report.string("path", b"a/missing.txt");
    match bun_sys::fstatat(root_fd, z(b"a/missing.txt\0")) {
        Ok(stat) => {
            stat_fields(report, &stat);
            report.end_ok();
        }
        Err(error) => report.end_error(&error),
    }

    // The flags of an open file, and a second descriptor for it.
    report.begin("flags of a descriptor");
    report.string("path", b"a/copy.txt");
    match bun_sys::open(z(&work.path(b"a/copy.txt")), O::WRONLY | O::APPEND, 0) {
        Ok(fd) => {
            let file = File::from_fd(fd);
            match bun_sys::get_fcntl_flags(fd) {
                Ok(flags) => {
                    let flags = flags as i32;
                    report.boolean("append", flags & O::APPEND != 0);
                    report.boolean("write only", flags & O::ACCMODE == O::WRONLY);
                    report.boolean("non blocking", flags & O::NONBLOCK != 0);
                    report.end_ok();
                }
                Err(error) => report.end_error(&error),
            }
            report.begin("dup, and write through it");
            match bun_sys::dup(fd) {
                Ok(second) => {
                    let second = File::from_fd(second);
                    match second.write_all(b"!") {
                        Ok(()) => report.end_ok(),
                        Err(error) => report.end_error(&error),
                    }
                }
                Err(error) => report.end_error(&error),
            }
            drop(file);
        }
        Err(error) => report.end_error(&error),
    }
    report.begin("read what was written through the second descriptor");
    match bun_sys::open(z(&work.path(b"a/copy.txt")), O::RDONLY, 0)
        .and_then(|fd| File::from_fd(fd).read_to_end())
    {
        Ok(bytes) => {
            report.string("content", &bytes);
            report.end_ok();
        }
        Err(error) => report.end_error(&error),
    }
}
