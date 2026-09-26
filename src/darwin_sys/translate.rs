//! Numbers that shared code and code for macOS both handle.
//!
//! A file is opened with flags that the caller made from bun's `O`, a path is relative to a directory
//! that may be `AT_FDCWD`. In the image those have the values of the image's C library everywhere in
//! bun's code, the code for macOS included (`crate::libc`), and they become the values of macOS here,
//! where a function of macOS is about to get them. What only macOS has (`F_GETPATH`, `COPYFILE_DATA`)
//! has the value of macOS everywhere and is not translated.

use crate::generated::{constants as macos, constants_for_bun as image, flag_pairs};

/// Reading, writing or both: the same three numbers on both systems. `O_ACCMODE` of the image's C
/// library is not this mask: it has the bit of `O_PATH` in it, which is `O_SYMLINK` on macOS.
const ACCESS: i32 = 3;

/// The flags of `open` for macOS. A flag that macOS does not have is left out, as `O::PATH` is 0 in a
/// build of bun for macOS.
pub fn open_flags(of_image: i32) -> i32 {
    let mut of_macos = of_image & ACCESS;
    let mut rest = of_image & !ACCESS;
    // `O_SYNC` of Linux has the bit of `O_DSYNC` in it.
    if rest & image::O_SYNC == image::O_SYNC {
        of_macos |= macos::O_SYNC;
        rest &= !image::O_SYNC;
    }
    for &(flag, flag_of_macos) in flag_pairs::OPEN {
        if flag != 0 && rest & flag == flag {
            of_macos |= flag_of_macos;
        }
    }
    of_macos
}

/// The flags of the image for flags of macOS: what `fcntl(F_GETFL)` answers.
pub fn open_flags_to_image(of_macos: i32) -> i32 {
    let mut of_image = of_macos & ACCESS;
    let rest = of_macos & !ACCESS;
    for &(flag, flag_of_macos) in flag_pairs::OPEN {
        if flag_of_macos != 0 && rest & flag_of_macos == flag_of_macos {
            of_image |= flag;
        }
    }
    of_image
}

/// The flags of a function whose name ends in `at` (`AT_SYMLINK_NOFOLLOW`, `AT_REMOVEDIR`) for macOS.
/// `AT_EACCESS` and `AT_REMOVEDIR` are one number in the image and two on macOS. Here the number is
/// `AT_REMOVEDIR`; `faccessat`, the one function that takes `AT_EACCESS`, has [`access_flags`].
pub fn at_flags(of_image: i32) -> i32 {
    let mut of_macos = 0;
    for &(flag, flag_of_macos) in flag_pairs::AT {
        if flag_of_macos == macos::AT_EACCESS {
            continue;
        }
        if flag != 0 && of_image & flag == flag {
            of_macos |= flag_of_macos;
        }
    }
    of_macos
}

/// The flags of `faccessat` for macOS.
pub fn access_flags(of_image: i32) -> i32 {
    let mut of_macos = 0;
    if of_image & image::AT_EACCESS != 0 {
        of_macos |= macos::AT_EACCESS;
    }
    if of_image & image::AT_SYMLINK_NOFOLLOW != 0 {
        of_macos |= macos::AT_SYMLINK_NOFOLLOW;
    }
    of_macos
}

/// A directory descriptor for macOS: `AT_FDCWD` has another number there, every other descriptor is
/// the number that the host gave it.
#[inline]
pub fn directory(of_image: i32) -> i32 {
    if of_image == image::AT_FDCWD {
        macos::AT_FDCWD
    } else {
        of_image
    }
}

/// The flags of `recv` and `send` for macOS.
pub fn message_flags(of_image: i32) -> i32 {
    const PAIRS: &[(i32, i32)] = &[
        (::libc::MSG_OOB, macos::MSG_OOB),
        (::libc::MSG_PEEK, macos::MSG_PEEK),
        (::libc::MSG_DONTROUTE, macos::MSG_DONTROUTE),
        (::libc::MSG_WAITALL, macos::MSG_WAITALL),
        (::libc::MSG_DONTWAIT, macos::MSG_DONTWAIT),
        (::libc::MSG_EOR, macos::MSG_EOR),
        (::libc::MSG_TRUNC, macos::MSG_TRUNC),
        (::libc::MSG_CTRUNC, macos::MSG_CTRUNC),
        (::libc::MSG_NOSIGNAL, macos::MSG_NOSIGNAL),
    ];
    let mut of_macos = 0;
    for &(flag, flag_of_macos) in PAIRS {
        if of_image & flag != 0 {
            of_macos |= flag_of_macos;
        }
    }
    of_macos
}
