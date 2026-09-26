//! Which arm of `host_select!` the image takes, and the three places of bun that have the arm
//! `linux_and_windows_host`: their code for Windows is not in the image, so a Windows host runs their
//! code for Linux, as it did before they had arms.
//!
//! Nothing here prints through `bun_sys`: with `BUN_PORTABLE_HOST_OS=win32` that is bun's code for
//! Windows, which stops on a host that is not Windows. One line for each place, so that the output
//! says how far the image came.

use bun_core::ZStr;
use bun_sys::Fd;

fn put(text: &[u8]) {
    // SAFETY: the bytes of a slice, to the standard output.
    let _ = unsafe { libc::write(1, text.as_ptr().cast(), text.len()) };
}

fn arm() -> &'static str {
    bun_core::host_select! {
        linux_and_windows_host => { "linux" }
        macos => { "macos" }
    }
}

fn place(name: &str, found: bool) {
    put(format!("{{\"step\":\"place\",\"of\":\"{name}\",\"found\":{found}}}\n").as_bytes());
}

pub fn print() -> bool {
    put(format!("{{\"step\":\"arm\",\"taken\":\"{}\"}}\n", arm()).as_bytes());

    // SAFETY: a NUL-terminated path.
    let directory = unsafe { libc::open(c".".as_ptr(), libc::O_RDONLY | libc::O_DIRECTORY) };
    if directory < 0 {
        return false;
    }
    let fd = Fd::from_native(directory);
    let mut bytes = [0u8; 1024];
    // SAFETY: the buffer has the bytes that it is said to have.
    let raw = unsafe { bun_core::fd_path_raw(fd, bytes.as_mut_ptr(), bytes.len()) };
    place("fd_path_raw", raw > 0);
    // The code for Linux of the two others goes on into what bun has for the host: `Fd::native` as
    // an integer, `bun_sys::readlink`.
    let mut buffer = bun_paths::path_buffer_pool::get();
    let path = bun_sys::get_fd_path(fd, &mut buffer).map(|path| path.len());
    place("get_fd_path", path.is_ok_and(|length| length > 0));
    place(
        "lstatat",
        bun_sys::lstatat(fd, ZStr::from_static(b".\0")).is_ok(),
    );
    // SAFETY: the descriptor that was opened above.
    unsafe { libc::close(directory) };
    true
}
