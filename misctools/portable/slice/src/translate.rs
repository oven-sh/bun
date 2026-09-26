//! What the image turns the numbers of its own C library into where it calls macOS: the flags of
//! `open`, the flags of the functions that end in `at`, `AT_FDCWD`, error numbers. One line for each,
//! with the number of the image and the number for macOS. The translation is plain arithmetic, so
//! this runs on every host; `test.ts` has the numbers of macOS from its headers to compare with.

use bun_darwin_sys::{errno, translate};

use crate::json::Report;

pub fn print() -> bool {
    let mut report = Report::new();
    let mut line = |what: &str, name: &str, of_image: i64, of_macos: i64| {
        report.begin(what);
        report.string("of", name.as_bytes());
        report.number("image", of_image);
        report.number("macos", of_macos);
        report.end_ok();
    };
    for (name, flags) in [
        ("O_RDONLY", libc::O_RDONLY),
        ("O_WRONLY", libc::O_WRONLY),
        ("O_RDWR", libc::O_RDWR),
        ("O_CREAT", libc::O_CREAT),
        ("O_EXCL", libc::O_EXCL),
        ("O_NOCTTY", libc::O_NOCTTY),
        ("O_TRUNC", libc::O_TRUNC),
        ("O_APPEND", libc::O_APPEND),
        ("O_NONBLOCK", libc::O_NONBLOCK),
        ("O_DSYNC", libc::O_DSYNC),
        ("O_SYNC", libc::O_SYNC),
        ("O_CLOEXEC", libc::O_CLOEXEC),
        ("O_DIRECTORY", libc::O_DIRECTORY),
        ("O_NOFOLLOW", libc::O_NOFOLLOW),
        ("O_PATH", libc::O_PATH),
        ("O_NOATIME", libc::O_NOATIME),
        ("O_DIRECT", libc::O_DIRECT),
        ("O_LARGEFILE", libc::O_LARGEFILE),
        (
            "O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC",
            libc::O_WRONLY | libc::O_CREAT | libc::O_TRUNC | libc::O_CLOEXEC,
        ),
        (
            "O_RDONLY | O_DIRECTORY | O_CLOEXEC",
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
        ),
        (
            "O_RDWR | O_APPEND | O_NONBLOCK | O_EXCL | O_NOFOLLOW | O_SYNC",
            libc::O_RDWR
                | libc::O_APPEND
                | libc::O_NONBLOCK
                | libc::O_EXCL
                | libc::O_NOFOLLOW
                | libc::O_SYNC,
        ),
        (
            "O_PATH | O_DIRECTORY | O_CLOEXEC",
            libc::O_PATH | libc::O_DIRECTORY | libc::O_CLOEXEC,
        ),
    ] {
        line(
            "flags of open",
            name,
            i64::from(flags),
            i64::from(translate::open_flags(flags)),
        );
    }
    for (name, flags) in [
        ("O_WRONLY | O_APPEND", 0x1 | 0x8),
        ("O_RDWR | O_NONBLOCK", 0x2 | 0x4),
        ("O_RDONLY | O_CLOEXEC", 0x0100_0000),
    ] {
        line(
            "flags of open, from macOS",
            name,
            i64::from(translate::open_flags_to_image(flags)),
            i64::from(flags),
        );
    }
    for (name, flags) in [
        ("AT_SYMLINK_NOFOLLOW", libc::AT_SYMLINK_NOFOLLOW),
        ("AT_REMOVEDIR", libc::AT_REMOVEDIR),
        ("AT_SYMLINK_FOLLOW", libc::AT_SYMLINK_FOLLOW),
    ] {
        line(
            "flags of a function with a directory",
            name,
            i64::from(flags),
            i64::from(translate::at_flags(flags)),
        );
    }
    for (name, flags) in [
        ("AT_EACCESS", libc::AT_EACCESS),
        (
            "AT_EACCESS | AT_SYMLINK_NOFOLLOW",
            libc::AT_EACCESS | libc::AT_SYMLINK_NOFOLLOW,
        ),
    ] {
        line(
            "flags of faccessat",
            name,
            i64::from(flags),
            i64::from(translate::access_flags(flags)),
        );
    }
    for (name, fd) in [("AT_FDCWD", libc::AT_FDCWD), ("5", 5), ("0", 0)] {
        line(
            "directory",
            name,
            i64::from(fd),
            i64::from(translate::directory(fd)),
        );
    }
    for (name, flags) in [
        ("MSG_PEEK", libc::MSG_PEEK),
        ("MSG_DONTWAIT", libc::MSG_DONTWAIT),
        ("MSG_WAITALL", libc::MSG_WAITALL),
        ("MSG_NOSIGNAL", libc::MSG_NOSIGNAL),
    ] {
        line(
            "flags of recv and send",
            name,
            i64::from(flags),
            i64::from(translate::message_flags(flags)),
        );
    }
    // Every error number of macOS, and the way back.
    for of_macos in 1..=106 {
        let of_image = errno::to_image(of_macos);
        line(
            "error of macOS",
            "",
            i64::from(of_image),
            i64::from(of_macos),
        );
    }
    for of_image in 1..=137 {
        line(
            "error of the image",
            "",
            i64::from(of_image),
            i64::from(errno::to_macos(of_image)),
        );
    }
    report.print()
}
