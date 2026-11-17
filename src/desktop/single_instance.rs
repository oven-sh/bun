//! `app.requestSingleInstanceLock()`: the first instance listens on a socket, and the others say what they were started with.

use crate::prelude::*;
use crate::{files, paths, process};

state!(fn lock() -> RefCell<Option<Lock>>);

struct Lock {
    socket: String,
}

impl Drop for Lock {
    fn drop(&mut self) {
        // An empty message ends the thread if the file is gone by then.
        #[cfg(unix)]
        let connection = std::os::unix::net::UnixStream::connect(&self.socket);
        files::remove(&self.socket);
        #[cfg(unix)]
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

fn socket() -> JsResult<String> {
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

#[cfg(unix)]
fn received(message: &[u8]) -> JsResult<()> {
    use bun_jsc::StringJsc as _;
    let parsed = bun_core::String::clone_utf8(message).to_js_by_parse_json(global());
    let Some(message) = catch(parsed)?.ok().filter(|it| it.is_object()) else {
        return Ok(());
    };
    let arguments = get(message, "argv")?;
    if !is_held() || !arguments.is_array() {
        return Ok(());
    }
    let details = [
        arguments,
        get(message, "cwd")?,
        get(message, "additionalData")?,
    ];
    announce(crate::app::object(), "second-instance", &details)
}

#[cfg(unix)]
fn take(socket: String, message: &[u8]) -> std::io::Result<Option<Lock>> {
    use core::time::Duration;
    use std::io::{Read as _, Write as _};
    use std::os::unix::fs::MetadataExt as _;
    use std::os::unix::net::{UnixListener, UnixStream};

    const PATIENCE: Option<Duration> = Some(Duration::from_secs(5));
    if let Ok(mut first) = UnixStream::connect(&socket) {
        first.set_write_timeout(PATIENCE)?;
        // An instance that is stuck still holds the lock.
        let _ = first.write_all(message);
        return Ok(None);
    }
    let _ = files::make_directory(files::parent(&socket).unwrap_or("/"), 0o700);
    // Left by an instance that was killed.
    files::remove(&socket);
    let listener = UnixListener::bind(&socket)?;
    let inode = |path: &str| {
        std::path::Path::new(path)
            .metadata()
            .ok()
            .map(|it| it.ino())
    };
    let (path, bound, app) = (
        socket.clone(),
        inode(&socket),
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
    Ok(Some(Lock { socket }))
}

#[cfg(not(unix))]
fn take(socket: String, _: &[u8]) -> std::io::Result<Option<Lock>> {
    Ok(Some(Lock { socket }))
}

pub(crate) fn request(additional_data: JSValue) -> JsResult<bool> {
    if is_held() {
        return Ok(true);
    }
    let message = object!({
        "argv": get(process::object(), "argv")?,
        "cwd": files::absolute("."),
        "additionalData": additional_data,
    });
    let message = message.json_stringify_fast(global())?;
    let taken = take(socket()?, &message.to_utf8()).map_err(|it| error(format_args!("{it}")))?;
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
