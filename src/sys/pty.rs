//! Pseudo-terminal creation: `openpty(3)` on POSIX, ConPTY on Windows.

#[cfg(unix)]
pub use posix::*;
#[cfg(windows)]
pub use win::*;

/// ConPTY's `COORD.X/Y` are i16; clamp the u16 cols/rows to its range.
#[inline]
pub fn clamp_to_coord(v: u16) -> i16 {
    i16::try_from(v.min(i16::MAX as u16)).unwrap()
}

#[cfg(unix)]
mod posix {
    use core::ffi::c_int;

    use bun_core::Winsize;

    use crate::Fd;

    // `openpty` accepts a `termios*`; only ever passed as null here, so the
    // layout is never relied on.
    #[repr(C)]
    pub struct OpenPtyTermios {
        _opaque: [u8; 0],
    }

    type OpenPtyFn = unsafe extern "C" fn(
        amaster: *mut c_int,
        aslave: *mut c_int,
        name: *mut u8,
        termp: *const OpenPtyTermios,
        winp: *const Winsize,
    ) -> c_int;

    /// `openpty` lives in libutil on glibc, which may not be linked; resolve
    /// it at runtime.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn openpty_fn() -> Option<OpenPtyFn> {
        use core::ffi::c_void;

        /// Evaluated once, inside `dlsym_with_handle!`'s `Once`.
        fn handle() -> Option<*mut c_void> {
            const LIB_NAMES: [&bun_core::ZStr; 3] = [
                bun_core::zstr!("libutil.so"),
                bun_core::zstr!("libutil.so.1"),
                bun_core::zstr!("libc.so.6"),
            ];
            LIB_NAMES
                .into_iter()
                .find_map(|lib_name| crate::dlopen(lib_name, crate::RTLD::LAZY))
        }

        crate::dlsym_with_handle!(OpenPtyFn, "openpty", handle())
    }

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    fn openpty_fn() -> Option<OpenPtyFn> {
        // libc on macOS, libutil (linked) on FreeBSD.
        unsafe extern "C" {
            fn openpty(
                amaster: *mut c_int,
                aslave: *mut c_int,
                name: *mut u8,
                termp: *const OpenPtyTermios,
                winp: *const Winsize,
            ) -> c_int;
        }
        Some(openpty)
    }

    #[cfg(not(any(
        target_os = "macos",
        target_os = "linux",
        target_os = "android",
        target_os = "freebsd"
    )))]
    fn openpty_fn() -> Option<OpenPtyFn> {
        None
    }

    pub enum OpenPtyError {
        /// `openpty` could not be resolved on this system.
        NotSupported,
        Failed,
    }

    pub struct PtyPair {
        pub master: Fd,
        pub slave: Fd,
    }

    /// `openpty(3)` with the given initial window size.
    pub fn openpty(winsize: &Winsize) -> Result<PtyPair, OpenPtyError> {
        let Some(openpty) = openpty_fn() else {
            return Err(OpenPtyError::NotSupported);
        };
        let mut master: c_int = -1;
        let mut slave: c_int = -1;
        // SAFETY: out-params are live locals; name/termp may be null.
        let rc = unsafe {
            openpty(
                &raw mut master,
                &raw mut slave,
                core::ptr::null_mut(),
                core::ptr::null(),
                core::ptr::from_ref(winsize),
            )
        };
        if rc != 0 {
            return Err(OpenPtyError::Failed);
        }
        Ok(PtyPair {
            master: Fd::from_native(master),
            slave: Fd::from_native(slave),
        })
    }

    /// `cfsetispeed` + `cfsetospeed`.
    pub fn cfsetspeed(t: &mut crate::posix::Termios, speed: libc::speed_t) {
        // SAFETY: `t` is a valid termios.
        unsafe {
            libc::cfsetispeed(core::ptr::from_mut(t), speed);
            libc::cfsetospeed(core::ptr::from_mut(t), speed);
        }
    }

    /// `ioctl(fd, TIOCSWINSZ, winsize)`.
    pub fn set_winsize(fd: Fd, winsize: &Winsize) -> Result<(), crate::Error> {
        // SAFETY: TIOCSWINSZ reads a `struct winsize` from the pointer.
        let rc = unsafe {
            libc::ioctl(
                fd.native(),
                libc::TIOCSWINSZ as _,
                core::ptr::from_ref(winsize),
            )
        };
        if rc != 0 {
            return Err(crate::err_with(crate::Tag::ioctl));
        }
        Ok(())
    }
}

#[cfg(windows)]
mod win {
    use super::clamp_to_coord;
    use core::sync::atomic::{AtomicU32, Ordering};

    use crate::Fd;
    use crate::windows;

    /// Inbox kernel32's HPCON layout. Stable ABI since build 17763: documented
    /// as "part of an ABI shared with the rest of the operating system" in
    /// microsoft/terminal `src/winconpty/winconpty.h`.
    #[repr(C)]
    struct PseudoConsoleLayout {
        h_signal: windows::HANDLE,
        h_pty_reference: windows::HANDLE,
        h_conpty_process: windows::HANDLE,
    }

    /// An open ConPTY handle from `CreatePseudoConsole`. `Send`: may be closed
    /// from another thread.
    pub struct PseudoConsole(windows::HPCON);

    // SAFETY: an HPCON is a process-wide kernel32 object; Close/Resize are
    // documented as callable from any thread.
    unsafe impl Send for PseudoConsole {}

    impl PseudoConsole {
        /// The raw handle, for `uv_process_options_t.pseudoconsole`.
        #[inline]
        pub fn raw(&self) -> windows::HPCON {
            self.0
        }

        /// `ResizePseudoConsole`; returns the HRESULT.
        pub fn resize(&self, cols: u16, rows: u16) -> i32 {
            let size = windows::COORD {
                X: clamp_to_coord(cols),
                Y: clamp_to_coord(rows),
            };
            // SAFETY: `self.0` is an open HPCON.
            unsafe { windows::ResizePseudoConsole(self.0, size) }
        }

        /// Close this HPCON's ConDrv `\Reference` handle so conhost exits on
        /// its own once the last attached client disconnects. Equivalent to
        /// kernel32's `ReleasePseudoConsole` (Windows 11 24H2+) /
        /// conpty.dll's `ConptyReleasePseudoConsole`; neither is exported from
        /// the inbox kernel32 on older builds so this reaches into the struct
        /// directly. `ClosePseudoConsole` later skips the field when it reads
        /// null. Further spawns against this pseudoconsole are impossible
        /// afterwards.
        pub fn release_reference(&self) {
            let pc = self.0.cast::<PseudoConsoleLayout>();
            // SAFETY: inbox `CreatePseudoConsole` heap-allocates a
            // `PseudoConsole` and returns it as the HPCON.
            unsafe {
                let r#ref = (*pc).h_pty_reference;
                if !r#ref.is_null() && r#ref != windows::INVALID_HANDLE_VALUE {
                    let _ = windows::CloseHandle(r#ref);
                    (*pc).h_pty_reference = core::ptr::null_mut();
                }
            }
        }

        /// `ClosePseudoConsole`. On Windows < 11 24H2 this blocks until the
        /// output pipe is drained.
        pub fn close(self) {
            // SAFETY: `self.0` is an open HPCON, consumed here.
            unsafe { windows::ClosePseudoConsole(self.0) };
        }
    }

    pub struct ConPty {
        /// Overlapped server end we read the console's output from (libuv-owned).
        pub read_fd: Fd,
        /// Overlapped server end we write the console's input to (libuv-owned).
        pub write_fd: Fd,
        pub hpcon: PseudoConsole,
    }

    pub enum CreatePtyError {
        OpenPtyFailed,
        DupFailed,
    }

    struct PipePair {
        server: windows::HANDLE,
        client: windows::HANDLE,
    }

    static PIPE_SERIAL: AtomicU32 = AtomicU32::new(0);

    fn close_handle(h: windows::HANDLE) {
        // SAFETY: `h` is an open handle owned by the caller.
        let _ = unsafe { windows::CloseHandle(h) };
    }

    /// Create one end of a pipe pair as an overlapped named pipe (server) and
    /// the other as a synchronous client. The "server" end is suitable for
    /// libuv (uv_pipe_open) and the "client" end for ConPTY (synchronous I/O).
    fn create_overlapped_pipe_pair(
        // PIPE_ACCESS_INBOUND: server reads, client writes.
        // PIPE_ACCESS_OUTBOUND: server writes, client reads.
        server_access: u32,
    ) -> Result<PipePair, CreatePtyError> {
        use windows::kernel32 as k32;
        const FILE_FLAG_FIRST_PIPE_INSTANCE: u32 = 0x00080000;

        let pid: u32 = windows::GetCurrentProcessId();
        let counter = PIPE_SERIAL.fetch_add(1, Ordering::Relaxed);
        let mut name_utf8_buf = [0u8; 96];
        let name = {
            use std::io::Write;
            let capacity = name_utf8_buf.len();
            let mut cursor = &mut name_utf8_buf[..];
            // An AppContainer may only create server pipes under
            // `\\.\pipe\LOCAL\`; insert the segment only then so the name is
            // unchanged outside one (matches libuv's uv__unique_pipe_name).
            let local = if windows::is_app_container() {
                r"LOCAL\"
            } else {
                ""
            };
            if write!(cursor, r"\\.\pipe\{local}bun-conpty-{pid}-{counter}").is_err() {
                return Err(CreatePtyError::OpenPtyFailed);
            }
            let written = capacity - cursor.len();
            &name_utf8_buf[..written]
        };
        let mut name_w_buf = [0u16; 97];
        let name_w_len = bun_core::convert_utf8_to_utf16_in_buffer(&mut name_w_buf, name).len();
        name_w_buf[name_w_len] = 0;
        let name_w = bun_core::WStr::from_buf(&name_w_buf[..], name_w_len);

        // SAFETY: name_w is NUL-terminated; all other params are valid per Win32.
        let server = unsafe {
            k32::CreateNamedPipeW(
                name_w.as_ptr(),
                server_access | windows::FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
                windows::PIPE_TYPE_BYTE | windows::PIPE_READMODE_BYTE | windows::PIPE_WAIT,
                1,
                65536,
                65536,
                0,
                core::ptr::null_mut(),
            )
        };
        if server == windows::INVALID_HANDLE_VALUE {
            return Err(CreatePtyError::OpenPtyFailed);
        }

        let client_access: u32 = if server_access == windows::PIPE_ACCESS_INBOUND {
            windows::GENERIC_WRITE
        } else {
            windows::GENERIC_READ
        };

        // SAFETY: name_w is NUL-terminated; all other params are valid per Win32.
        let client = unsafe {
            k32::CreateFileW(
                name_w.as_ptr(),
                client_access,
                0,
                core::ptr::null_mut(),
                windows::OPEN_EXISTING,
                0,
                core::ptr::null_mut(),
            )
        };
        if client == windows::INVALID_HANDLE_VALUE {
            close_handle(server);
            return Err(CreatePtyError::OpenPtyFailed);
        }

        Ok(PipePair { server, client })
    }

    /// Create a ConPTY of `cols`×`rows` with overlapped named-pipe server ends
    /// for reading its output and writing its input.
    pub fn create_conpty(cols: u16, rows: u16) -> Result<ConPty, CreatePtyError> {
        // Output pipe: ConPTY writes (client), we read (overlapped server).
        let out = create_overlapped_pipe_pair(windows::PIPE_ACCESS_INBOUND)?;
        // Input pipe: we write (overlapped server), ConPTY reads (client).
        let inp = match create_overlapped_pipe_pair(windows::PIPE_ACCESS_OUTBOUND) {
            Ok(p) => p,
            Err(e) => {
                close_handle(out.server);
                close_handle(out.client);
                return Err(e);
            }
        };

        let size = windows::COORD {
            X: clamp_to_coord(cols),
            Y: clamp_to_coord(rows),
        };
        let mut pc: windows::HPCON = core::ptr::null_mut();
        // SAFETY: inp.client/out.client are valid open HANDLEs; pc is a valid out-ptr.
        let hr = unsafe { windows::CreatePseudoConsole(size, inp.client, out.client, 0, &mut pc) };
        // ConPTY duplicated the client handles internally (or failed); close
        // our copies either way.
        close_handle(inp.client);
        close_handle(out.client);
        if hr < 0 {
            close_handle(out.server);
            close_handle(inp.server);
            return Err(CreatePtyError::OpenPtyFailed);
        }
        let hpcon = PseudoConsole(pc);

        // Wrap server (overlapped) ends as libuv-owned FDs so they can be
        // passed to BufferedReader/StreamingWriter.start() (uv_pipe_open).
        let read_fd = match Fd::from_system(out.server).make_libuv_owned() {
            Ok(fd) => fd,
            Err(_) => {
                hpcon.close();
                close_handle(out.server);
                close_handle(inp.server);
                return Err(CreatePtyError::DupFailed);
            }
        };
        let write_fd = match Fd::from_system(inp.server).make_libuv_owned() {
            Ok(fd) => fd,
            Err(_) => {
                hpcon.close();
                crate::FdExt::close(read_fd);
                close_handle(inp.server);
                return Err(CreatePtyError::DupFailed);
            }
        };

        Ok(ConPty {
            read_fd,
            write_fd,
            hpcon,
        })
    }
}
