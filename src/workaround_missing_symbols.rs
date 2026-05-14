use core::ffi::{c_char, c_int};

// On linux, bun overrides the libc symbols for various functions.
// This is to compensate for older glibc versions.
#[cfg(target_os = "linux")]
pub mod linux {
    use core::ffi::{c_char, c_int};
    use bun_sys::linux as os_linux;

    fn simulate_libc_errno(rc: usize) -> c_int {
        // @bitCast(rc) — usize → isize is a same-width bit reinterpretation
        let signed = rc as isize;
        let is_err = signed > -4096 && signed < 0;
        let int: c_int = c_int::try_from(if is_err { -signed } else { 0 }).expect("int cast");
        // SAFETY: errno_location() returns a valid thread-local *mut c_int
        // TODO(port): std.c._errno() — confirm bun_sys exposes the libc errno lvalue
        unsafe { *bun_sys::c::errno_location() = int; }
        if is_err { -1 } else { int }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn stat(path: *const c_char, buf: *mut os_linux::Stat) -> c_int {
        // https://git.musl-libc.org/cgit/musl/tree/src/stat/stat.c
        // SAFETY: path is a valid NUL-terminated string and buf points to a valid Stat (caller contract of libc stat)
        let rc = unsafe { os_linux::fstatat(os_linux::AT_FDCWD, path, buf, 0) };
        simulate_libc_errno(rc)
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn lstat(path: *const c_char, buf: *mut os_linux::Stat) -> c_int {
        // https://git.musl-libc.org/cgit/musl/tree/src/stat/lstat.c
        // SAFETY: caller contract of libc lstat
        let rc = unsafe { os_linux::fstatat(os_linux::AT_FDCWD, path, buf, os_linux::AT_SYMLINK_NOFOLLOW) };
        simulate_libc_errno(rc)
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn fstat(fd: c_int, buf: *mut os_linux::Stat) -> c_int {
        // SAFETY: caller contract of libc fstat
        let rc = unsafe { os_linux::fstat(fd, buf) };
        simulate_libc_errno(rc)
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn fstatat(dirfd: i32, path: *const c_char, buf: *mut os_linux::Stat, flags: u32) -> c_int {
        // SAFETY: caller contract of libc fstatat
        let rc = unsafe { os_linux::fstatat(dirfd, path, buf, flags) };
        simulate_libc_errno(rc)
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn statx(dirfd: i32, path: *const c_char, flags: u32, mask: u32, buf: *mut os_linux::Statx) -> c_int {
        // SAFETY: caller contract of libc statx
        let rc = unsafe { os_linux::statx(dirfd, path, flags, mask, buf) };
        simulate_libc_errno(rc)
    }

    pub use bun_sys::c::memmem;

    // Zig: `pub const stat64 = stat;` + `comptime { @export(&stat, .{ .name = "stat64" }); }`
    // Rust cannot export one fn body under two link names; emit thin wrappers that
    // serve both as the Rust-side alias and the exported `*64` symbol.
    #[unsafe(no_mangle)]
    pub extern "C" fn stat64(path: *const c_char, buf: *mut os_linux::Stat) -> c_int {
        stat(path, buf)
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn lstat64(path: *const c_char, buf: *mut os_linux::Stat) -> c_int {
        lstat(path, buf)
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn fstat64(fd: c_int, buf: *mut os_linux::Stat) -> c_int {
        fstat(fd, buf)
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn fstatat64(dirfd: i32, path: *const c_char, buf: *mut os_linux::Stat, flags: u32) -> c_int {
        fstatat(dirfd, path, buf, flags)
    }
}

#[cfg(target_os = "macos")]
pub mod darwin {
    use core::ffi::{c_char, c_int};
    use bun_sys::Stat;

    pub use bun_sys::c::memmem;

    // The symbol name depends on the arch.

    #[cfg(target_arch = "aarch64")]
    unsafe extern "C" {
        #[link_name = "lstat"]
        pub fn lstat(path: *const c_char, buf: *mut Stat) -> c_int;
        #[link_name = "fstat"]
        pub fn fstat(fd: i32, buf: *mut Stat) -> c_int;
        #[link_name = "stat"]
        pub fn stat(path: *const c_char, buf: *mut Stat) -> c_int;
    }

    #[cfg(not(target_arch = "aarch64"))]
    unsafe extern "C" {
        #[link_name = "lstat64"]
        pub fn lstat(path: *const c_char, buf: *mut Stat) -> c_int;
        #[link_name = "fstat64"]
        pub fn fstat(fd: i32, buf: *mut Stat) -> c_int;
        #[link_name = "stat64"]
        pub fn stat(path: *const c_char, buf: *mut Stat) -> c_int;
    }
}

#[cfg(windows)]
pub mod windows {
    use core::ffi::{c_char, c_int};

    /// Windows doesn't have memmem, so we need to implement it
    /// This is used in src/string/immutable.zig
    #[unsafe(no_mangle)]
    pub extern "C" fn memmem(
        haystack: *const u8,
        haystacklen: usize,
        needle: *const u8,
        needlelen: usize,
    ) -> *const u8 {
        // Handle null pointers
        if haystack.is_null() || needle.is_null() {
            return core::ptr::null();
        }

        // Handle empty needle case
        if needlelen == 0 {
            return haystack;
        }

        // Handle case where needle is longer than haystack
        if needlelen > haystacklen {
            return core::ptr::null();
        }

        // SAFETY: haystack/needle are non-null and caller guarantees they span haystacklen/needlelen bytes
        let hay = unsafe { core::slice::from_raw_parts(haystack, haystacklen) };
        let nee = unsafe { core::slice::from_raw_parts(needle, needlelen) };

        // PORT NOTE: Zig used std.mem.indexOf; use a plain windowed scan here to
        // avoid depending on bun_str (which itself calls memmem on Windows).
        let Some(i) = hay.windows(needlelen).position(|w| w == nee) else {
            return core::ptr::null();
        };
        // SAFETY: i < haystacklen, in-bounds offset
        unsafe { hay.as_ptr().add(i) }
    }

    // TODO(port): Zig source declares all three with a (path, *Stat) signature; fstat
    // likely wants (fd: c_int, *Stat) — matching Zig verbatim for Phase A.
    unsafe extern "C" {
        /// lstat is implemented in workaround-missing-symbols.cpp
        #[link_name = "lstat64"]
        pub fn lstat(path: *const c_char, buf: *mut bun_sys::c::Stat) -> c_int;
        /// fstat is implemented in workaround-missing-symbols.cpp
        #[link_name = "fstat64"]
        pub fn fstat(path: *const c_char, buf: *mut bun_sys::c::Stat) -> c_int;
        /// stat is implemented in workaround-missing-symbols.cpp
        #[link_name = "stat64"]
        pub fn stat(path: *const c_char, buf: *mut bun_sys::c::Stat) -> c_int;
    }
}

#[cfg(target_os = "freebsd")]
pub mod freebsd {
    use core::ffi::{c_char, c_int};

    pub use bun_sys::c::memmem;

    // FreeBSD has plain stat/fstat/lstat (no 64-suffix; off_t is always
    // 64-bit). Zig's std.c only exports darwin's `stat$INODE64`, so bind
    // them directly.
    unsafe extern "C" {
        pub fn lstat(path: *const c_char, buf: *mut bun_sys::c::Stat) -> c_int;
        pub fn fstat(fd: c_int, buf: *mut bun_sys::c::Stat) -> c_int;
        pub fn stat(path: *const c_char, buf: *mut bun_sys::c::Stat) -> c_int;
    }
}

#[cfg(target_os = "linux")]
pub use linux as current;
#[cfg(windows)]
pub use windows as current;
#[cfg(target_os = "macos")]
pub use darwin as current;
#[cfg(target_os = "freebsd")]
pub use freebsd as current;
#[cfg(target_family = "wasm")]
pub mod current {}

// ported from: src/workaround_missing_symbols.zig
