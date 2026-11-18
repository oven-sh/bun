//! `app.requestSingleInstanceLock()`: the first instance listens, and the others say what they were started with.

use crate::prelude::*;
use crate::{files, paths, process};

use system::Lock;

state!(fn lock() -> RefCell<Option<Lock>>);

fn received(message: &[u8]) -> JsResult<()> {
    use bun_jsc::StringJsc as _;
    use bun_ui::protocol::SystemCommand;
    let parsed = bun_core::String::clone_utf8(message).to_js_by_parse_json(global());
    let Some(message) = catch(parsed)?.ok().filter(|it| it.is_object()) else {
        return Ok(());
    };
    let arguments = get(message, "argv")?;
    if !is_held() || !arguments.is_array() {
        return Ok(());
    }
    let token = get(message, "token")?;
    if token.is_string() {
        tell_system(SystemCommand::ActivationToken(text_of(token)?.into()))?;
    }
    let details = [
        arguments,
        get(message, "cwd")?,
        get(message, "additionalData")?,
    ];
    announce(crate::app::object(), "second-instance", &details)
}

#[cfg(unix)]
mod system {
    use super::*;

    pub(super) struct Lock {
        socket: String,
    }

    impl Drop for Lock {
        fn drop(&mut self) {
            // An empty message ends the thread if the file is gone by then.
            let connection = std::os::unix::net::UnixStream::connect(&self.socket);
            files::remove(&self.socket);
            drop(connection);
        }
    }

    fn base36(mut number: u64) -> String {
        let mut digits = Vec::new();
        loop {
            digits.insert(
                0,
                b"0123456789abcdefghijklmnopqrstuvwxyz"[(number % 36) as usize],
            );
            number /= 36;
            if number == 0 {
                return string(&digits);
            }
        }
    }

    pub(super) fn place() -> JsResult<String> {
        let data = paths::path("userData")?;
        let name = format!(
            "bun-desktop-{}.sock",
            base36(bun_wyhash::hash(data.as_bytes()))
        );
        // The path of a socket has about 100 bytes. macOS gives each user a temporary directory of their own.
        let directory = match IS_MAC {
            true => paths::temporary()?,
            false => process::variable("XDG_RUNTIME_DIR")?.unwrap_or(data),
        };
        Ok(files::join(&[&directory, &name]))
    }

    pub(super) fn take(socket: &str, message: &[u8]) -> std::io::Result<Option<Lock>> {
        use core::time::Duration;
        use std::io::{Read as _, Write as _};
        use std::os::unix::fs::MetadataExt as _;
        use std::os::unix::net::{UnixListener, UnixStream};

        const PATIENCE: Option<Duration> = Some(Duration::from_secs(5));
        if let Ok(mut first) = UnixStream::connect(socket) {
            first.set_write_timeout(PATIENCE)?;
            // An instance that is stuck still holds the lock.
            let _ = first.write_all(message);
            return Ok(None);
        }
        let _ = files::make_directory(files::parent(socket).unwrap_or("/"), 0o700);
        // Left by an instance that was killed.
        files::remove(socket);
        let listener = UnixListener::bind(socket)?;
        let inode = |path: &str| {
            std::path::Path::new(path)
                .metadata()
                .ok()
                .map(|it| it.ino())
        };
        let (path, bound, app) = (
            socket.to_owned(),
            inode(socket),
            later::Remote::to_this_thread(),
        );
        let listen = move || {
            for connection in listener.incoming().map_while(Result::ok) {
                let mut message = Vec::new();
                let _ = connection.set_read_timeout(PATIENCE);
                let _ = connection.take(1 << 20).read_to_end(&mut message);
                if inode(&path) != bound {
                    break;
                }
                app.post(move |_| received(&message));
            }
        };
        (std::thread::Builder::new()
            .name("Single instance".into())
            .stack_size(128 << 10))
        .spawn(listen)?;
        Ok(Some(Lock {
            socket: socket.into(),
        }))
    }
}

/// Whoever has the file open is the first. The name of the pipe is in it, so that no other user can take that name first.
#[cfg(windows)]
mod system {
    use core::ffi::c_void;
    use core::ptr::null_mut;
    use core::sync::atomic::{AtomicBool, Ordering};
    use core::time::Duration;
    use std::os::windows::io::{AsRawHandle as _, OwnedHandle};
    use std::sync::Arc;
    use std::time::Instant;

    use bun_sys::Fd;
    use bun_sys::windows::private_folder::make_inbound_pipe;
    use bun_sys::windows::{
        CreateFileW, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, GENERIC_READ,
        GENERIC_WRITE, OPEN_EXISTING,
    };

    use super::*;
    use crate::text;
    use crate::win32::{self, Wide};

    const PREFIX: &str = "\\\\.\\pipe\\bun-desktop-";
    /// The pipe holds that much, so nobody waits for an instance that is stuck.
    const LONGEST: usize = 1 << 20;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn ConnectNamedPipe(pipe: *mut c_void, overlapped: *mut c_void) -> i32;
        fn PeekNamedPipe(
            pipe: *mut c_void,
            buffer: *mut c_void,
            size: u32,
            read: *mut u32,
            available: &mut u32,
            left: *mut u32,
        ) -> i32;
        safe fn DisconnectNamedPipe(pipe: *mut c_void) -> i32;
        safe fn GetNamedPipeServerProcessId(pipe: *mut c_void, id: &mut u32) -> i32;
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        safe fn AllowSetForegroundWindow(process: u32) -> i32;
    }

    pub(super) struct Lock {
        _file: OwnedHandle,
        pipe: String,
        is_released: Arc<AtomicBool>,
    }

    impl Drop for Lock {
        fn drop(&mut self) {
            self.is_released.store(true, Ordering::Relaxed);
            drop(connect(&self.pipe));
        }
    }

    fn descriptor(handle: &OwnedHandle) -> Fd {
        Fd::from_system(handle.as_raw_handle())
    }

    fn write(to: &OwnedHandle, mut bytes: &[u8]) {
        while let Ok(count @ 1..) = bun_sys::write(descriptor(to), bytes) {
            bytes = &bytes[count..];
        }
    }

    fn receive(pipe: &OwnedHandle) -> Vec<u8> {
        const PATIENCE: Duration = Duration::from_millis(500);
        let (mut all, mut part, mut available) = (Vec::new(), [0; 4096], 0);
        let (start, none) = (Instant::now(), null_mut());
        // SAFETY: what is null is optional.
        while unsafe {
            PeekNamedPipe(
                pipe.as_raw_handle(),
                null_mut(),
                0,
                none,
                &mut available,
                none,
            )
        } != 0
            && all.len() < LONGEST
            && start.elapsed() < PATIENCE
        {
            if available == 0 {
                std::thread::sleep(Duration::from_millis(1));
            } else if let Ok(count) = bun_sys::read(descriptor(pipe), &mut part) {
                all.extend_from_slice(&part[..count]);
            }
        }
        all
    }

    fn connect(pipe: &str) -> Option<OwnedHandle> {
        // Or else the other side could act as this one.
        const ANONYMOUSLY: u32 = 0x10_0000;
        let name = Wide::new(pipe);
        CreateFileW(name.as_wstr(), GENERIC_WRITE, 0, OPEN_EXISTING, ANONYMOUSLY).ok()
    }

    /// `None` if it is worth another try.
    fn tell_first(file: &Wide, message: &[u8]) -> Option<()> {
        let (shared, mut name) = (
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            [0; 64],
        );
        let file = CreateFileW(file.as_wstr(), GENERIC_READ, shared, OPEN_EXISTING, 0).ok()?;
        let length = (bun_sys::read(descriptor(&file), &mut name).ok()).filter(|it| *it > 0)?;
        let random = name[..length].strip_prefix(PREFIX.as_bytes());
        if !random.is_some_and(|it| it.iter().all(u8::is_ascii_hexdigit)) {
            return Some(());
        }
        let (pipe, mut first) = (connect(&string(&name[..length]))?, 0);
        write(&pipe, &message[..message.len().min(LONGEST)]);
        // It acts when the pipe is closed.
        GetNamedPipeServerProcessId(pipe.as_raw_handle(), &mut first);
        AllowSetForegroundWindow(first);
        Some(())
    }

    pub(super) fn place() -> JsResult<String> {
        Ok(files::join(&[&paths::path("userData")?, "lockfile"]))
    }

    pub(super) fn take(file: &str, message: &[u8]) -> std::io::Result<Option<Lock>> {
        let _ = files::make_directory(files::parent(file).unwrap_or("."), 0o700);
        let file = Wide::new(file);
        // The first may be starting, listening to another one, or leaving.
        for _ in 0..500 {
            if let Some(file) = win32::create_lock(&file)? {
                return listen(file).map(Some);
            }
            if tell_first(&file, message).is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        Ok(None)
    }

    fn listen(file: OwnedHandle) -> std::io::Result<Lock> {
        let random = u128::from_ne_bytes(text::random_bytes());
        let name = format!("{PREFIX}{random:x}");
        let pipe = make_inbound_pipe(Wide::new(&name).as_wstr(), LONGEST as u32)
            .map_err(|it| std::io::Error::from_raw_os_error(it.0.into()))?;
        write(&file, name.as_bytes());
        let (is_released, app) = (
            Arc::new(AtomicBool::new(false)),
            later::Remote::to_this_thread(),
        );
        let ends = Arc::clone(&is_released);
        let listen = move || {
            loop {
                // SAFETY: it waits, so there is nothing to tell the result in.
                unsafe { ConnectNamedPipe(pipe.as_raw_handle(), null_mut()) };
                let message = receive(&pipe);
                if ends.load(Ordering::Relaxed) || DisconnectNamedPipe(pipe.as_raw_handle()) == 0 {
                    break;
                }
                app.post(move |_| received(&message));
            }
        };
        (std::thread::Builder::new()
            .name("Single instance".into())
            .stack_size(128 << 10))
        .spawn(listen)?;
        Ok(Lock {
            _file: file,
            pipe: name,
            is_released,
        })
    }
}

pub(crate) fn request(additional_data: JSValue) -> JsResult<bool> {
    if is_held() {
        return Ok(true);
    }
    let message = object!({
        "argv": get(process::object(), "argv")?,
        "cwd": files::absolute("."),
        "additionalData": additional_data,
        "token": process::variable("XDG_ACTIVATION_TOKEN")?,
    });
    let message = message.json_stringify_fast(global())?;
    let taken = system::take(&system::place()?, &message.to_utf8())
        .map_err(|it| error(format_args!("{it}")))?;
    lock().replace(taken);
    process::at_exit(release);
    Ok(is_held())
}

pub(crate) fn is_held() -> bool {
    lock().borrow().is_some()
}

pub(crate) fn release() {
    lock().take();
}
