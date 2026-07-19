use bun_collections::VecExt;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsResult};
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_sys::{self as sys, Fd, FdExt as _};

// `bun.jsc.WebCore` lives in this crate (not `bun_jsc`); alias so the body can
// say `webcore::ReadableStream` / `webcore::body::Value`.
use crate::webcore;
use crate::webcore::blob::store::Data as StoreData;
use crate::webcore::node_types::{PathLike, PathOrFileDescriptor};

// `bun.jsc.Subprocess.StdioKind` is owned by `process.rs` (defined there to
// keep `process` leaf; `subprocess` re-exports it).
use crate::api::bun_process::{self as process, Dup2 as ProcessDup2, StdioKind};

// `SpawnOptions.Stdio` is platform-dependent: process.rs exposes `PosixStdio` /
// `WindowsStdio`; alias the active one as `SpawnOptionsStdio` so the body stays
// platform-neutral.
#[cfg(not(windows))]
pub(crate) type SpawnOptionsStdio = process::PosixStdio;
#[cfg(windows)]
pub(crate) type SpawnOptionsStdio = process::WindowsStdio;

// `bun.FD.Stdio` (the StdIn/StdOut/StdErr tag enum) is `bun_core::Stdio`,
// re-exported through `bun_sys`.
use sys::Stdio as FdStdio;

// `const log = bun.sys.syslog;`
bun_output::define_scoped_log!(log, SYS, visible);

/// Payload of `Stdio::Capture`.
#[derive(Clone, Copy)]
pub struct Capture {
    // BACKREF: raw pointer to a capture buffer owned by the shell interpreter.
    // The shell keeps the buffer alive for the lifetime
    // of the spawned process; this struct never frees it.
    pub buf: *mut Vec<u8>,
}

/// Payload of `Stdio::Dup2`.
#[derive(Clone, Copy)]
pub struct Dup2 {
    pub out: StdioKind,
    pub to: StdioKind,
}

// Constructed/matched in many other files (subprocess, shell); boxing `Blob`
// would ripple through all of them.
#[allow(clippy::large_enum_variant)]
pub enum Stdio {
    Inherit,
    Capture(Capture),
    Ignore,
    Fd(Fd),
    Dup2(Dup2),
    Path(PathLike),
    Blob(webcore::blob::Any),
    ArrayBuffer(jsc::array_buffer::ArrayBufferStrong),
    /// Bytes copied from a user-supplied ArrayBuffer/TypedArray stdin. Owned
    /// natively so the pipe writer needs no GC root for the async drain.
    OwnedBuffer(Vec<u8>),
    Memfd(Fd),
    Pipe,
    /// Like `Pipe` at indices >= 3, but the parent end of the socketpair is
    /// stored as `ExtraPipe::UnownedFd` so `Subprocess::finalize_streams`
    /// never closes it; the caller reads the fd from `.stdio[i]` and is
    /// responsible for closing it. Used by `node:child_process` which wraps
    /// extra `"pipe"` slots in `net.connect({fd})` (usockets then owns the
    /// fd). Only valid at indices >= 3.
    SocketFd,
    Ipc,
    ReadableStream(webcore::ReadableStream),
}

// These live at module scope and callers reference them as `stdio::Result` etc.

pub enum ResultT<T> {
    Result(T),
    Err(ToSpawnOptsError),
}

pub type Result = ResultT<SpawnOptionsStdio>;

pub enum ToSpawnOptsError {
    StdinUsedAsOut,
    OutUsedAsStdin,
    BlobUsedAsOut,
    UvPipe(sys::E),
}

impl ToSpawnOptsError {
    pub fn to_str(&self) -> &'static [u8] {
        match self {
            Self::StdinUsedAsOut => b"Stdin cannot be used for stdout or stderr",
            Self::OutUsedAsStdin => b"Stdout and stderr cannot be used for stdin",
            Self::BlobUsedAsOut => b"Blobs are immutable, and cannot be used for stdout/stderr",
            Self::UvPipe(_) => panic!("TODO"),
        }
    }

    pub fn throw_js(&self, global: &JSGlobalObject) -> jsc::JsError {
        global.throw(format_args!("{}", bstr::BStr::new(self.to_str())))
    }
}

impl Stdio {
    pub fn byte_slice(&self) -> &[u8] {
        match self {
            // SAFETY: `buf` is a live backref owned by the caller (shell); the
            // returned slice borrows `self` and the caller guarantees the
            // Vec<u8> outlives this Stdio.
            Self::Capture(c) => unsafe { (*c.buf).slice() },
            Self::ArrayBuffer(ab) => ab.array_buffer.byte_slice(),
            Self::OwnedBuffer(b) => b,
            Self::Blob(blob) => blob.slice(),
            _ => &[],
        }
    }

    pub fn can_use_memfd(&self) -> bool {
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            return false;
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        match self {
            Self::Blob(blob) => !blob.needs_to_read_file(),
            Self::Memfd(_) | Self::ArrayBuffer(_) | Self::OwnedBuffer(_) => true,
            // `Self::Pipe` is never memfd: a memfd has no EOF signal, so a
            // grandchild still writing after the child exits would be lost.
            _ => false,
        }
    }

    pub fn use_memfd(&mut self, index: u32) -> bool {
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            let _ = index;
            return false;
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            use crate::api::bun_process::spawn_sys;
            if !spawn_sys::can_use_memfd() {
                return false;
            }
            let label: &core::ffi::CStr = match index {
                0 => c"spawn_stdio_stdin",
                1 => c"spawn_stdio_stdout",
                2 => c"spawn_stdio_stderr",
                _ => c"spawn_stdio_memory_file",
            };

            let fd = match spawn_sys::memfd_create(label, spawn_sys::MemfdFlag::CrossProcess) {
                Ok(fd) => fd,
                Err(_) => return false,
            };

            let mut remain = self.byte_slice();

            if !remain.is_empty() {
                // Hint at the size of the file
                let _ = sys::ftruncate(fd, i64::try_from(remain.len()).expect("int cast"));
            }

            // Dump all the bytes in there
            let mut written: i64 = 0;
            while !remain.is_empty() {
                match sys::pwrite(fd, remain, written) {
                    Err(err) => {
                        if err.get_errno() == sys::E::EAGAIN {
                            continue;
                        }

                        bun_core::debug_warn!(
                            "Failed to write to memfd: {}",
                            <&'static str>::from(err.get_errno()),
                        );
                        fd.close();
                        return false;
                    }
                    Ok(result) => {
                        if result == 0 {
                            bun_core::debug_warn!("Failed to write to memfd: EOF");
                            fd.close();
                            return false;
                        }
                        written += i64::try_from(result).expect("int cast");
                        remain = &remain[result..];
                    }
                }
            }

            // Note: reshaped for borrowck — `remain` borrows `*self`, so we
            // must drop it before mutating `self`. Shadowing ends the borrow here.
            let _ = remain;

            // Assigning to `*self` drops the previous variant via `Drop`
            // (and closes a prior `.memfd`).
            *self = Stdio::Memfd(fd);
            true
        }
    }

    pub fn to_sync(&mut self, i: u32) {
        // Piping an empty stdin doesn't make sense
        if i == 0 && matches!(self, Self::Pipe) {
            *self = Self::Ignore;
        }
    }

    /// On windows this function allocates a `*mut uv::Pipe` (via `heap::alloc`);
    /// the caller must transfer ownership (e.g. into `WindowsStdioResult::Buffer`
    /// via `heap::take`) or free it with `close_and_destroy`.
    pub fn as_spawn_option(&mut self, i: i32) -> Result {
        // `SpawnOptionsStdio` is already a cfg-gated alias to PosixStdio /
        // WindowsStdio; only three variant *constructors* differ in arity
        // between targets, so spell those per-cfg and share the rest.
        #[cfg(not(windows))]
        fn buffer() -> SpawnOptionsStdio {
            SpawnOptionsStdio::Buffer
        }
        #[cfg(windows)]
        fn buffer() -> SpawnOptionsStdio {
            SpawnOptionsStdio::Buffer(create_zeroed_pipe())
        }
        #[cfg(not(windows))]
        fn ipc() -> SpawnOptionsStdio {
            SpawnOptionsStdio::Ipc
        }
        #[cfg(windows)]
        fn ipc() -> SpawnOptionsStdio {
            SpawnOptionsStdio::Ipc(create_zeroed_pipe())
        }

        let result = match self {
            Self::Blob(blob) => 'brk: {
                let fd = FdStdio::from_int(i).map(FdStdio::fd);
                if blob.needs_to_read_file() {
                    if let Some(store) = blob.store() {
                        if let StoreData::File(ref file) = store.data {
                            match file.pathlike {
                                PathOrFileDescriptor::Fd(store_fd) => {
                                    if Some(store_fd) == fd {
                                        break 'brk SpawnOptionsStdio::Inherit;
                                    }

                                    if let Some(tag) = store_fd.stdio_tag() {
                                        match tag {
                                            FdStdio::StdIn => {
                                                if i == 1 || i == 2 {
                                                    return ResultT::Err(
                                                        ToSpawnOptsError::StdinUsedAsOut,
                                                    );
                                                }
                                            }
                                            FdStdio::StdOut | FdStdio::StdErr => {
                                                if i == 0 {
                                                    return ResultT::Err(
                                                        ToSpawnOptsError::OutUsedAsStdin,
                                                    );
                                                }
                                            }
                                        }
                                    }

                                    break 'brk SpawnOptionsStdio::Pipe(store_fd);
                                }
                                PathOrFileDescriptor::Path(ref path) => {
                                    break 'brk SpawnOptionsStdio::Path(
                                        path.slice().to_vec().into_boxed_slice(),
                                    );
                                }
                            }
                        }
                    }
                }

                if i == 1 || i == 2 {
                    return ResultT::Err(ToSpawnOptsError::BlobUsedAsOut);
                }

                buffer()
            }
            Self::Dup2(d) => SpawnOptionsStdio::Dup2(ProcessDup2 {
                out: d.out,
                to: d.to,
            }),
            Self::Capture(_)
            | Self::Pipe
            | Self::ArrayBuffer(_)
            | Self::OwnedBuffer(_)
            | Self::ReadableStream(_) => buffer(),
            #[cfg(not(windows))]
            Self::SocketFd => SpawnOptionsStdio::SocketFd,
            // Windows extra-stdio is a libuv pipe handle (no raw-fd ownership
            // to transfer), so `socket-fd` behaves identically to `pipe` there.
            #[cfg(windows)]
            Self::SocketFd => buffer(),
            Self::Ipc => ipc(),
            Self::Fd(fd) => SpawnOptionsStdio::Pipe(*fd),
            #[cfg(not(windows))]
            Self::Memfd(fd) => SpawnOptionsStdio::Pipe(*fd),
            #[cfg(windows)]
            Self::Memfd(_) => panic!("This should never happen"),
            Self::Path(pathlike) => {
                SpawnOptionsStdio::Path(pathlike.slice().to_vec().into_boxed_slice())
            }
            Self::Inherit => SpawnOptionsStdio::Inherit,
            Self::Ignore => SpawnOptionsStdio::Ignore,
        };
        ResultT::Result(result)
    }

    pub fn is_piped(&self) -> bool {
        match self {
            Self::Capture(_)
            | Self::ArrayBuffer(_)
            | Self::OwnedBuffer(_)
            | Self::Blob(_)
            | Self::Pipe
            | Self::ReadableStream(_) => true,
            Self::Ipc => cfg!(windows),
            _ => false,
        }
    }

    fn extract_body_value(
        out_stdio: &mut Stdio,
        global: &JSGlobalObject,
        i: i32,
        body: &mut webcore::body::Value,
        is_sync: bool,
    ) -> JsResult<()> {
        body.to_blob_if_possible();

        if let Some(blob) = body.try_use_as_any_blob() {
            return out_stdio.extract_blob(global, blob, i);
        }

        match body {
            webcore::body::Value::Null | webcore::body::Value::Empty => {
                *out_stdio = Stdio::Ignore;
                return Ok(());
            }
            webcore::body::Value::Used => {
                return Err(global
                    .err(
                        jsc::ErrorCode::BODY_ALREADY_USED,
                        format_args!("Body already used"),
                    )
                    .throw());
            }
            webcore::body::Value::Error(err) => {
                return Err(global.throw_value(err.to_js(global)));
            }

            // handled above.
            webcore::body::Value::Blob(_)
            | webcore::body::Value::WTFStringImpl(_)
            | webcore::body::Value::InternalBlob(_) => unreachable!(),
            webcore::body::Value::Locked(_) => {
                if is_sync {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "ReadableStream cannot be used in sync mode"
                    )));
                }

                match i {
                    0 => {}
                    1 => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "ReadableStream cannot be used for stdout yet. For now, do .stdout"
                        )));
                    }
                    2 => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "ReadableStream cannot be used for stderr yet. For now, do .stderr"
                        )));
                    }
                    _ => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "ReadableStream cannot be used for stdio[{i}] yet"
                        )));
                    }
                }

                let stream_value = body.to_readable_stream(global)?;

                let Some(stream) = webcore::ReadableStream::from_js(stream_value, global)? else {
                    return Err(global
                        .throw_invalid_arguments(format_args!("Failed to create ReadableStream")));
                };

                if stream.is_disturbed(global) {
                    return Err(global
                        .err(
                            jsc::ErrorCode::BODY_ALREADY_USED,
                            format_args!("ReadableStream has already been used"),
                        )
                        .throw());
                }

                *out_stdio = Stdio::ReadableStream(stream);
            }
        }

        Ok(())
    }

    pub fn extract(
        out_stdio: &mut Stdio,
        global: &JSGlobalObject,
        i: i32,
        value: JSValue,
        is_sync: bool,
    ) -> JsResult<()> {
        if value.is_empty() {
            return Ok(());
        }
        if value.is_undefined() {
            return Ok(());
        }
        if value.is_null() {
            *out_stdio = Stdio::Ignore;
            return Ok(());
        }

        if value.is_string() {
            let str = value.get_zig_string(global)?;
            if str.eql_comptime(b"inherit") {
                *out_stdio = Stdio::Inherit;
            } else if str.eql_comptime(b"ignore") {
                *out_stdio = Stdio::Ignore;
            } else if str.eql_comptime(b"pipe") || str.eql_comptime(b"overlapped") {
                *out_stdio = Stdio::Pipe;
            } else if str.eql_comptime(b"socket-fd") {
                if i < 3 {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "stdio: 'socket-fd' is only supported at indices >= 3"
                    )));
                }
                if is_sync {
                    // Bun.spawnSync's result has no .stdio, so the caller
                    // could never receive the fd it's supposed to own.
                    return Err(global.throw_invalid_arguments(format_args!(
                        "stdio: 'socket-fd' cannot be used with spawnSync"
                    )));
                }
                *out_stdio = Stdio::SocketFd;
            } else if str.eql_comptime(b"ipc") {
                *out_stdio = Stdio::Ipc;
            } else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "stdio must be an array of 'inherit', 'pipe', 'ignore', Bun.file(pathOrFd), number, or null"
                )));
            }
            return Ok(());
        } else if value.is_number() {
            // `bun.FD.fromUV(this.toInt32())` inlined here since the
            // upstream `bun_jsc::JSValue` doesn't expose a wrapper.
            let fd = Fd::from_uv(value.to_int32());
            let file_fd = fd.uv();
            if file_fd < 0 {
                return Err(global.throw_invalid_arguments(format_args!(
                    "file descriptor must be a positive integer"
                )));
            }

            if file_fd >= i32::MAX as _ {
                let mut formatter = jsc::console_object::Formatter::new(global);
                // `defer formatter.deinit()` — handled by Drop.
                return Err(global.throw_invalid_arguments(format_args!(
                    "file descriptor must be a valid integer, received: {}",
                    value.to_fmt(&mut formatter),
                )));
            }

            if let Some(tag) = fd.stdio_tag() {
                match tag {
                    FdStdio::StdIn => {
                        if i == 1 || i == 2 {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "stdin cannot be used for stdout or stderr"
                            )));
                        }

                        *out_stdio = Stdio::Inherit;
                        return Ok(());
                    }
                    FdStdio::StdOut | FdStdio::StdErr => {
                        if i == 0 {
                            return Err(global.throw_invalid_arguments(format_args!(
                                "stdout and stderr cannot be used for stdin"
                            )));
                        }
                        if (i == 1 && tag == FdStdio::StdOut) || (i == 2 && tag == FdStdio::StdErr)
                        {
                            *out_stdio = Stdio::Inherit;
                            return Ok(());
                        }
                    }
                }
            }

            *out_stdio = Stdio::Fd(fd);
            return Ok(());
        } else if let Some(blob) = value.as_class_ref::<webcore::Blob>() {
            // `as_class_ref` is the safe shared-borrow downcast (centralised
            // deref proof in `JSValue`); the JS wrapper roots the payload while
            // `value` is on the stack. `dupe()` only bumps the store refcount.
            return out_stdio.extract_blob(global, webcore::blob::Any::Blob(blob.dupe()), i);
        } else if let Some(req) = value.as_class_ref::<webcore::Request>() {
            return Self::extract_body_value(out_stdio, global, i, req.get_body_value(), is_sync);
        } else if let Some(res) = value.as_class_ref::<webcore::Response>() {
            return Self::extract_body_value(out_stdio, global, i, res.get_body_value(), is_sync);
        }

        if let Some(stream_) = webcore::ReadableStream::from_js(value, global)? {
            let mut stream = stream_;
            if let Some(blob) = stream.to_any_blob(global) {
                return out_stdio.extract_blob(global, blob, i);
            }

            let name: &'static [u8] = match i {
                0 => b"stdin",
                1 => b"stdout",
                2 => b"stderr",
                _ => {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "ReadableStream cannot be used for stdio[{i}] yet"
                    )));
                }
            };

            if is_sync {
                return Err(global.throw_invalid_arguments(format_args!(
                    "'{}' ReadableStream cannot be used in sync mode",
                    bstr::BStr::new(name),
                )));
            }

            if stream.is_disturbed(global) {
                return Err(global
                    .err(
                        jsc::ErrorCode::INVALID_STATE,
                        format_args!(
                            "'{}' ReadableStream has already been used",
                            bstr::BStr::new(name),
                        ),
                    )
                    .throw());
            }
            *out_stdio = Stdio::ReadableStream(stream);
            return Ok(());
        }

        if let Some(array_buffer) = value.as_array_buffer(global) {
            let bytes = array_buffer.byte_slice();
            // Change in Bun v1.0.34: don't throw for empty ArrayBuffer
            if bytes.is_empty() {
                *out_stdio = Stdio::Ignore;
                return Ok(());
            }

            // Copy into native memory so the async pipe writer owns the bytes
            // outright (no GC root required while draining stdin).
            *out_stdio = Stdio::OwnedBuffer(bytes.to_vec());
            return Ok(());
        }

        Err(global.throw_invalid_arguments(format_args!(
            "stdio must be an array of 'inherit', 'ignore', or null"
        )))
    }

    pub fn extract_blob(
        &mut self,
        global: &JSGlobalObject,
        blob: webcore::blob::Any,
        i: i32,
    ) -> JsResult<()> {
        let fd = FdStdio::from_int(i).map(FdStdio::fd);

        if blob.needs_to_read_file() {
            if let Some(store) = blob.store() {
                if let StoreData::File(ref file) = store.data {
                    match file.pathlike {
                        PathOrFileDescriptor::Fd(store_fd) => {
                            if Some(store_fd) == fd {
                                *self = Stdio::Inherit;
                            } else {
                                // TODO: is this supposed to be `store.data.file.pathlike.fd`?
                                if let Some(tag) = FdStdio::from_int(i) {
                                    match tag {
                                        FdStdio::StdIn => {
                                            if i == 1 || i == 2 {
                                                return Err(global.throw_invalid_arguments(
                                                    format_args!(
                                                        "stdin cannot be used for stdout or stderr"
                                                    ),
                                                ));
                                            }
                                        }
                                        FdStdio::StdOut | FdStdio::StdErr => {
                                            if i == 0 {
                                                return Err(global.throw_invalid_arguments(
                                                    format_args!(
                                                        "stdout and stderr cannot be used for stdin"
                                                    ),
                                                ));
                                            }
                                        }
                                    }
                                }

                                *self = Stdio::Fd(store_fd);
                            }

                            return Ok(());
                        }
                        PathOrFileDescriptor::Path(ref path) => {
                            *self = Stdio::Path(path.clone());
                            return Ok(());
                        }
                    }
                }
            }
        }

        if i == 1 || i == 2 {
            return Err(global.throw_invalid_arguments(format_args!(
                "Blobs are immutable, and cannot be used for stdout/stderr"
            )));
        }

        // Nothing to write: treat an empty blob the same as "ignore"
        // (/dev/null at fds 0-2, left closed at extra slots).
        if blob.fast_size() == 0 {
            *self = Stdio::Ignore;
            return Ok(());
        }

        if i != 0 {
            // The parent-side writer that pumps Blob bytes into the child's
            // pipe (`Writable::Buffer` / memfd) is only wired up for stdin.
            return Err(global
                .throw_invalid_arguments(format_args!("Blob cannot be used for stdio[{i}] yet")));
        }

        *self = Stdio::Blob(blob);
        Ok(())
    }
}

impl Drop for Stdio {
    fn drop(&mut self) {
        match self {
            Self::ArrayBuffer(_array_buffer) => {
                // `array_buffer.deinit()` — handled by field Drop.
            }
            Self::Blob(blob) => {
                blob.detach();
            }
            Self::Memfd(fd) => {
                fd.close();
            }
            Self::ReadableStream(_) => {
                // ReadableStream cleanup is handled by the subprocess
            }
            _ => {}
        }
    }
}

/// Allocate a zero-initialized uv.Pipe. Zero-init ensures `pipe.loop` is null
/// for pipes that never reach `uv_pipe_init`, so `closeAndDestroy` can tell
/// whether `uv_close` is needed.
#[cfg(windows)]
fn create_zeroed_pipe() -> *mut uv::Pipe {
    // `bun.new` → heap::alloc(Box::new(..)). WindowsSpawnOptions.Stdio.{buffer,ipc}
    // store the pipe as a raw FFI-owned `*mut uv::Pipe` so `spawn_process_windows`
    // can transfer sole ownership into `WindowsStdioResult::Buffer` via
    // `heap::take` without aliasing a live `Box` (which would double-free).
    bun_core::heap::into_raw(Box::new(bun_core::ffi::zeroed::<uv::Pipe>()))
}
