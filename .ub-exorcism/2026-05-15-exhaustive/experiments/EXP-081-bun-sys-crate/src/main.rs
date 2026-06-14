#[cfg(unix)]
fn main() {
    use std::os::unix::ffi::OsStrExt;

    let root = std::env::temp_dir().join(format!(
        "bun-exp-081-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("entry"), b"x").unwrap();

    let c_path = std::ffi::CString::new(root.as_os_str().as_bytes()).unwrap();
    let raw_fd = unsafe {
        libc::open(
            c_path.as_ptr(),
            // Miri's POSIX shim currently rejects O_DIRECTORY, so this direct
            // witness uses a plain read-only directory fd. The iterator under
            // test still receives a real directory fd and exercises Bun's
            // actual getdents-backed `WrappedIterator`.
            libc::O_RDONLY | libc::O_CLOEXEC,
        )
    };
    assert!(raw_fd >= 0, "libc::open failed");
    let fd = bun_sys::fd::Fd::from_native(raw_fd);
    let mut iter = bun_sys::dir_iterator::iterate(fd);

    let entry = loop {
        let Some(entry) = iter.next().unwrap() else {
            panic!("expected at least one non-dot entry");
        };
        if entry.name.slice_u8() == b"entry" {
            break entry;
        }
    };

    drop(iter);

    let bytes = entry.name.slice_u8();
    std::hint::black_box(bytes[0]);
}

#[cfg(not(unix))]
fn main() {
    panic!("EXP-081 direct POSIX witness is unix-only");
}
