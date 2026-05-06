#![allow(dead_code)]

use bun_collections::ByteList;
use bun_core::Output;
use bun_jsc::{self as jsc, JSGlobalObject, JSValue, JsResult};
use bun_sys::{self as sys, Fd, FdExt as _};
#[cfg(windows)]
use bun_sys::windows::libuv as uv;

// `bun.jsc.WebCore` lives in this crate (not `bun_jsc`); alias so the body can
// say `webcore::ReadableStream` / `webcore::body::Value` per the .zig spec.
use crate::webcore;
use crate::webcore::blob::store::Data as StoreData;
use crate::webcore::node_types::{PathLike, PathOrFileDescriptor};

// `bun.jsc.Subprocess.StdioKind` is owned by `process.rs` (defined there to
// keep `process` leaf; `subprocess` re-exports it).
use crate::api::bun_process::{self as process, StdioKind, Dup2 as ProcessDup2};

// `SpawnOptions.Stdio` in Zig is a platform-dependent nested decl. Rust enums
// can't nest type decls, so process.rs exposes `PosixStdio` / `WindowsStdio`;
// alias the active one as `SpawnOptionsStdio` so the body stays platform-neutral.
#[cfg(not(windows))]
pub type SpawnOptionsStdio = process::PosixStdio;
#[cfg(windows)]
pub type SpawnOptionsStdio = process::WindowsStdio;

// `bun.FD.Stdio` (the StdIn/StdOut/StdErr tag enum) is `bun_core::Stdio`,
// re-exported through `bun_sys`. Alias so `FdStdio::StdIn` etc. read as the
// Zig `bun.FD.Stdio.std_in`.
use sys::Stdio as FdStdio;

bun_output::declare_scope!(SYS, visible);
// `const log = bun.sys.syslog;`
macro_rules! log {
    ($($t:tt)*) => { bun_output::scoped_log!(SYS, $($t)*) };
}

/// Anonymous payload of `Stdio::Capture` in Zig: `struct { buf: *bun.ByteList }`.
#[derive(Clone, Copy)]
pub struct Capture {
    // TODO(port): lifetime — Zig holds a raw `*bun.ByteList` backref owned
    // elsewhere (shell). LIFETIMES.tsv has no row; treating as BACKREF.
    pub buf: *mut ByteList,
}

/// Anonymous payload of `Stdio::Dup2` in Zig.
#[derive(Clone, Copy)]
pub struct Dup2 {
    pub out: StdioKind,
    pub to: StdioKind,
}

pub enum Stdio {
    Inherit,
    Capture(Capture),
    Ignore,
    Fd(Fd),
    Dup2(Dup2),
    Path(PathLike),
    Blob(webcore::blob::Any),
    ArrayBuffer(jsc::array_buffer::ArrayBufferStrong),
    Memfd(Fd),
    Pipe,
    Ipc,
    ReadableStream(webcore::ReadableStream),
}

// In Zig these are `Stdio.Result` / `Stdio.ResultT` / `Stdio.ToSpawnOptsError`.
// Rust enums cannot nest type decls, so they live at module scope and callers
// reference them as `stdio::Result` etc.

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
            // ByteList outlives this Stdio.
            Self::Capture(c) => unsafe { (*c.buf).slice() },
            Self::ArrayBuffer(ab) => ab.array_buffer.byte_slice(),
            Self::Blob(blob) => blob.slice(),
            _ => &[],
        }
    }

    pub fn can_use_memfd(&self, is_sync: bool, has_max_buffer: bool) -> bool {
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (is_sync, has_max_buffer);
            return false;
        }

        #[cfg(target_os = "linux")]
        match self {
            Self::Blob(blob) => !blob.needs_to_read_file(),
            Self::Memfd(_) | Self::ArrayBuffer(_) => true,
            Self::Pipe => is_sync && !has_max_buffer,
            _ => false,
        }
    }

    pub fn use_memfd(&mut self, index: u32) -> bool {
        #[cfg(not(target_os = "linux"))]
        {
            let _ = index;
            return false;
        }

        #[cfg(target_os = "linux")]
        {
            use crate::api::bun_process::spawn_sys;
            if !spawn_sys::can_use_memfd() {
                return false;
            }
            let label: &'static [u8] = match index {
                0 => b"spawn_stdio_stdin",
                1 => b"spawn_stdio_stdout",
                2 => b"spawn_stdio_stderr",
                _ => b"spawn_stdio_memory_file",
            };

            let fd = match spawn_sys::memfd_create(label, spawn_sys::MemfdFlag::CrossProcess) {
                Ok(fd) => fd,
                Err(_) => return false,
            };

            let mut remain = self.byte_slice();

            if !remain.is_empty() {
                // Hint at the size of the file
                let _ = sys::ftruncate(fd, i64::try_from(remain.len()).unwrap());
            }

            // Dump all the bytes in there
            let mut written: i64 = 0;
            while !remain.is_empty() {
                match sys::pwrite(fd, remain, written) {
                    Err(err) => {
                        if err.get_errno() == sys::E::EAGAIN {
                            continue;
                        }

                        Output::debug_warn(format_args!(
                            "Failed to write to memfd: {}",
                            <&'static str>::from(err.get_errno()),
                        ));
                        fd.close();
                        return false;
                    }
                    Ok(result) => {
                        if result == 0 {
                            Output::debug_warn(format_args!("Failed to write to memfd: EOF"));
                            fd.close();
                            return false;
                        }
                        written += i64::try_from(result).unwrap();
                        remain = &remain[result..];
                    }
                }
            }

            // PORT NOTE: reshaped for borrowck — `remain` borrows `*self`, so we
            // must drop it before mutating `self`. Shadowing ends the borrow here.
            let _ = remain;

            // PORT NOTE: in Zig only `.array_buffer` / `.blob` are explicitly
            // deinit'd before reassignment. In Rust, assigning to `*self` drops
            // the previous variant via `Drop`, which has equivalent behaviour
            // for those arms and is a no-op for others (and additionally closes
            // a prior `.memfd`, which Zig left open — arguably a leak fix).
            *self = Stdio::Memfd(fd);
            true
        }
    }

    #[cfg(not(windows))]
    fn to_posix(&mut self, i: i32) -> Result {
        let result = match self {
            Self::Blob(blob) => 'brk: {
                let fd = FdStdio::from_int(i).unwrap().fd();
                if blob.needs_to_read_file() {
                    if let Some(store) = blob.store() {
                        if let jsc::node::PathOrFd::Fd(store_fd) = store.data.file.pathlike {
                            if store_fd == fd {
                                break 'brk SpawnOptionsStdio::Inherit;
                            }

                            if let Some(tag) = store_fd.stdio_tag() {
                                match tag {
                                    FdStdio::StdIn => {
                                        if i == 1 || i == 2 {
                                            return ResultT::Err(ToSpawnOptsError::StdinUsedAsOut);
                                        }
                                    }
                                    FdStdio::StdOut | FdStdio::StdErr => {
                                        if i == 0 {
                                            return ResultT::Err(ToSpawnOptsError::OutUsedAsStdin);
                                        }
                                    }
                                }
                            }

                            break 'brk SpawnOptionsStdio::Pipe(store_fd);
                        }

                        break 'brk SpawnOptionsStdio::Path(
                            store.data.file.pathlike.path().slice().to_vec().into_boxed_slice(),
                        );
                    }
                }

                if i == 1 || i == 2 {
                    return ResultT::Err(ToSpawnOptsError::BlobUsedAsOut);
                }

                SpawnOptionsStdio::Buffer
            }
            Self::Dup2(d) => SpawnOptionsStdio::Dup2(ProcessDup2 { out: d.out, to: d.to }),
            Self::Capture(_) | Self::Pipe | Self::ArrayBuffer(_) | Self::ReadableStream(_) => {
                SpawnOptionsStdio::Buffer
            }
            Self::Ipc => SpawnOptionsStdio::Ipc,
            Self::Fd(fd) => SpawnOptionsStdio::Pipe(*fd),
            Self::Memfd(fd) => SpawnOptionsStdio::Pipe(*fd),
            Self::Path(pathlike) => {
                SpawnOptionsStdio::Path(pathlike.slice().to_vec().into_boxed_slice())
            }
            Self::Inherit => SpawnOptionsStdio::Inherit,
            Self::Ignore => SpawnOptionsStdio::Ignore,
        };
        ResultT::Result(result)
    }

    #[cfg(windows)]
    fn to_windows(&mut self, i: i32) -> Result {
        let result = match self {
            Self::Blob(blob) => 'brk: {
                let fd = FdStdio::from_int(i).unwrap().fd();
                if blob.needs_to_read_file() {
                    if let Some(store) = blob.store() {
                        if let jsc::node::PathOrFd::Fd(store_fd) = store.data.file.pathlike {
                            if store_fd == fd {
                                break 'brk SpawnOptionsStdio::Inherit;
                            }

                            if let Some(tag) = store_fd.stdio_tag() {
                                match tag {
                                    FdStdio::StdIn => {
                                        if i == 1 || i == 2 {
                                            return ResultT::Err(ToSpawnOptsError::StdinUsedAsOut);
                                        }
                                    }
                                    FdStdio::StdOut | FdStdio::StdErr => {
                                        if i == 0 {
                                            return ResultT::Err(ToSpawnOptsError::OutUsedAsStdin);
                                        }
                                    }
                                }
                            }

                            break 'brk SpawnOptionsStdio::Pipe(store_fd);
                        }

                        break 'brk SpawnOptionsStdio::Path(
                            store.data.file.pathlike.path().slice().to_vec().into_boxed_slice(),
                        );
                    }
                }

                if i == 1 || i == 2 {
                    return ResultT::Err(ToSpawnOptsError::BlobUsedAsOut);
                }

                SpawnOptionsStdio::Buffer(create_zeroed_pipe())
            }
            Self::Ipc => SpawnOptionsStdio::Ipc(create_zeroed_pipe()),
            Self::Capture(_) | Self::Pipe | Self::ArrayBuffer(_) | Self::ReadableStream(_) => {
                SpawnOptionsStdio::Buffer(create_zeroed_pipe())
            }
            Self::Fd(fd) => SpawnOptionsStdio::Pipe(*fd),
            Self::Dup2(d) => SpawnOptionsStdio::Dup2(ProcessDup2 { out: d.out, to: d.to }),
            Self::Path(pathlike) => {
                SpawnOptionsStdio::Path(pathlike.slice().to_vec().into_boxed_slice())
            }
            Self::Inherit => SpawnOptionsStdio::Inherit,
            Self::Ignore => SpawnOptionsStdio::Ignore,

            Self::Memfd(_) => panic!("This should never happen"),
        };
        ResultT::Result(result)
    }

    pub fn to_sync(&mut self, i: u32) {
        // Piping an empty stdin doesn't make sense
        if i == 0 && matches!(self, Self::Pipe) {
            *self = Self::Ignore;
        }
    }

    /// On windows this function allocates a `*mut uv::Pipe` (via `Box::into_raw`);
    /// the caller must transfer ownership (e.g. into `WindowsStdioResult::Buffer`
    /// via `Box::from_raw`) or free it with `close_and_destroy`.
    pub fn as_spawn_option(&mut self, i: i32) -> Result {
        #[cfg(windows)]
        {
            self.to_windows(i)
        }
        #[cfg(not(windows))]
        {
            self.to_posix(i)
        }
    }

    pub fn is_piped(&self) -> bool {
        match self {
            Self::Capture(_)
            | Self::ArrayBuffer(_)
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
        body: &mut jsc::webcore::body::Value,
        is_sync: bool,
    ) -> JsResult<()> {
        body.to_blob_if_possible();

        if let Some(blob) = body.try_use_as_any_blob() {
            return out_stdio.extract_blob(global, blob, i);
        }

        match body {
            jsc::webcore::body::Value::Null | jsc::webcore::body::Value::Empty => {
                *out_stdio = Stdio::Ignore;
                return Ok(());
            }
            jsc::webcore::body::Value::Used => {
                return Err(global
                    .err(jsc::ErrorCode::BODY_ALREADY_USED, format_args!("Body already used"))
                    .throw());
            }
            jsc::webcore::body::Value::Error(err) => {
                return Err(global.throw_value(err.to_js(global)));
            }

            // handled above.
            jsc::webcore::body::Value::Blob(_)
            | jsc::webcore::body::Value::WTFStringImpl(_)
            | jsc::webcore::body::Value::InternalBlob(_) => unreachable!(),
            jsc::webcore::body::Value::Locked(_) => {
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
                    _ => unreachable!(),
                }

                let stream_value = body.to_readable_stream(global)?;

                let Some(stream) =
                    jsc::webcore::ReadableStream::from_js(stream_value, global)?
                else {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "Failed to create ReadableStream"
                    )));
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
            } else if str.eql_comptime(b"ipc") {
                *out_stdio = Stdio::Ipc;
            } else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "stdio must be an array of 'inherit', 'pipe', 'ignore', Bun.file(pathOrFd), number, or null"
                )));
            }
            return Ok(());
        } else if value.is_number() {
            let fd = value.as_file_descriptor();
            let file_fd = fd.uv();
            if file_fd < 0 {
                return Err(global.throw_invalid_arguments(format_args!(
                    "file descriptor must be a positive integer"
                )));
            }

            if file_fd >= i32::MAX as _ {
                let mut formatter = jsc::console_object::Formatter { global, ..Default::default() };
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
                        if i == 1 && tag == FdStdio::StdOut {
                            *out_stdio = Stdio::Inherit;
                            return Ok(());
                        } else if i == 2 && tag == FdStdio::StdErr {
                            *out_stdio = Stdio::Inherit;
                            return Ok(());
                        }
                    }
                }
            }

            *out_stdio = Stdio::Fd(fd);
            return Ok(());
        } else if let Some(blob) = value.as_::<jsc::webcore::Blob>() {
            return out_stdio.extract_blob(global, jsc::webcore::blob::Any::Blob(blob.dupe()), i);
        } else if let Some(req) = value.as_::<jsc::webcore::Request>() {
            return Self::extract_body_value(out_stdio, global, i, req.get_body_value(), is_sync);
        } else if let Some(res) = value.as_::<jsc::webcore::Response>() {
            return Self::extract_body_value(out_stdio, global, i, res.get_body_value(), is_sync);
        }

        if let Some(stream_) = jsc::webcore::ReadableStream::from_js(value, global)? {
            let mut stream = stream_;
            if let Some(blob) = stream.to_any_blob(global) {
                return out_stdio.extract_blob(global, blob, i);
            }

            let name: &'static [u8] = match i {
                0 => b"stdin",
                1 => b"stdout",
                2 => b"stderr",
                _ => unreachable!(),
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
            // Change in Bun v1.0.34: don't throw for empty ArrayBuffer
            if array_buffer.byte_slice().is_empty() {
                *out_stdio = Stdio::Ignore;
                return Ok(());
            }

            *out_stdio = Stdio::ArrayBuffer(jsc::array_buffer::Strong {
                array_buffer,
                held: jsc::Strong::create(array_buffer.value, global),
            });
            return Ok(());
        }

        Err(global.throw_invalid_arguments(format_args!(
            "stdio must be an array of 'inherit', 'ignore', or null"
        )))
    }

    pub fn extract_blob(
        &mut self,
        global: &JSGlobalObject,
        blob: jsc::webcore::blob::Any,
        i: i32,
    ) -> JsResult<()> {
        let fd = FdStdio::from_int(i).unwrap().fd();

        if blob.needs_to_read_file() {
            if let Some(store) = blob.store() {
                if let jsc::node::PathOrFd::Fd(store_fd) = store.data.file.pathlike {
                    if store_fd == fd {
                        *self = Stdio::Inherit;
                    } else {
                        // TODO: is this supposed to be `store.data.file.pathlike.fd`?
                        if let Some(tag) = FdStdio::from_int(i) {
                            match tag {
                                FdStdio::StdIn => {
                                    if i == 1 || i == 2 {
                                        return Err(global.throw_invalid_arguments(format_args!(
                                            "stdin cannot be used for stdout or stderr"
                                        )));
                                    }
                                }
                                FdStdio::StdOut | FdStdio::StdErr => {
                                    if i == 0 {
                                        return Err(global.throw_invalid_arguments(format_args!(
                                            "stdout and stderr cannot be used for stdin"
                                        )));
                                    }
                                }
                            }
                        }

                        *self = Stdio::Fd(store_fd);
                    }

                    return Ok(());
                }

                *self = Stdio::Path(store.data.file.pathlike.path().clone());
                return Ok(());
            }
        }

        if i == 1 || i == 2 {
            return Err(global.throw_invalid_arguments(format_args!(
                "Blobs are immutable, and cannot be used for stdout/stderr"
            )));
        }

        // Instead of writing an empty blob, lets just make it /dev/null
        if blob.fast_size() == 0 {
            *self = Stdio::Ignore;
            return Ok(());
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
    // `bun.new` → Box::into_raw(Box::new(..)). WindowsSpawnOptions.Stdio.{buffer,ipc}
    // store the pipe as a raw FFI-owned `*mut uv::Pipe` so `spawn_process_windows`
    // can transfer sole ownership into `WindowsStdioResult::Buffer` via
    // `Box::from_raw` without aliasing a live `Box` (which would double-free).
    // SAFETY: all-zero is a valid uv::Pipe (#[repr(C)] POD; libuv treats a
    // zeroed pipe as "uninitialized" and `pipe.loop == null` is the sentinel).
    Box::into_raw(Box::new(unsafe { core::mem::zeroed::<uv::Pipe>() }))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/spawn/stdio.zig (507 lines)
//   confidence: medium
//   todos:      3
//   notes:      Nested Stdio.* types hoisted to module scope; cross-crate paths (Subprocess.StdioKind, SpawnOptions, webcore::body::Value, Fd::Stdio, PathOrFd) are best-guess and need Phase B fixup; use_memfd Drop semantics differ slightly (see PORT NOTE); create_zeroed_pipe returns Box<uv::Pipe> per LIFETIMES.tsv (OWNED).
// ──────────────────────────────────────────────────────────────────────────
