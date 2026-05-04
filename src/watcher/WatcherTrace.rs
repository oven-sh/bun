use std::io::Write as _;

use bun_core::{env_var, fmt as bun_fmt, output};
use bun_str::ZStr;
use bun_sys::{self, Fd, File, O};

use super::{WatchEvent, Watcher};

/// Optional trace file for debugging watcher events
// SAFETY: `init` is called once before the watcher thread starts; `write_events`
// is only called from the (single) watcher thread; `deinit` is called after the
// watcher thread has joined. No concurrent access — mirrors the Zig `var`.
// TODO(port): consider wrapping in a `SyncUnsafeCell`/`OnceLock` in Phase B.
static mut TRACE_FILE: Option<File> = None;

/// Initialize trace file if BUN_WATCHER_TRACE env var is set.
/// Only checks once on first call.
pub fn init() {
    // SAFETY: see TRACE_FILE doc — single-threaded at this point.
    unsafe {
        if (*core::ptr::addr_of!(TRACE_FILE)).is_some() {
            return;
        }
    }

    if let Some(trace_path) = env_var::BUN_WATCHER_TRACE.get() {
        if !trace_path.is_empty() {
            let flags = O::WRONLY | O::CREAT | O::APPEND;
            let mode = 0o644;
            match bun_sys::open_a(trace_path, flags, mode) {
                Ok(fd) => {
                    // SAFETY: see TRACE_FILE doc.
                    unsafe {
                        *core::ptr::addr_of_mut!(TRACE_FILE) = Some(File { handle: fd });
                    }
                }
                Err(_) => {
                    // Silently ignore errors opening trace file
                }
            }
        }
    }
}

/// Write trace events to the trace file if enabled.
/// This is called from the watcher thread, so no locking is needed.
/// Events are assumed to be already deduped by path.
pub fn write_events(
    watcher: &Watcher,
    events: &[WatchEvent],
    changed_files: &[Option<&ZStr>],
) {
    // SAFETY: see TRACE_FILE doc — only the watcher thread reaches here.
    let Some(file) = (unsafe { (*core::ptr::addr_of!(TRACE_FILE)).as_ref() }) else {
        return;
    };

    let mut buffer = [0u8; 4096];
    // TODO(port): `file.writer().adaptToNewApi(&buffer)` — assumes
    // `bun_sys::File::buffered_writer` yields a `std::io::Write` over the
    // stack buffer. Adjust to the real bun_sys API in Phase B.
    let buffered = file.buffered_writer(&mut buffer);
    // `defer buffered.flush() catch |err| { Output.err(...) }`
    let mut writer = scopeguard::guard(buffered, |mut w| {
        if let Err(err) = w.flush() {
            // TODO(port): exact bun_core::output::err signature
            output::err(&err, "Failed to flush watcher trace file");
        }
    });

    // Get current timestamp
    // PORT NOTE: std.time.milliTimestamp() — std::time is not in the banned
    // I/O set; revisit if a `bun_core::time` helper exists.
    let timestamp: i64 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    // Write: { "timestamp": number, "files": { ... } }
    if writer.write_all(b"{\"timestamp\":").is_err() {
        return;
    }
    if write!(writer, "{}", timestamp).is_err() {
        return;
    }
    if writer.write_all(b",\"files\":{").is_err() {
        return;
    }

    let watchlist_slice = watcher.watchlist.slice();
    // TODO(port): MultiArrayList column accessor — `.items(.file_path)`
    let file_paths = watchlist_slice.file_path();

    let mut first_file = true;
    for event in events {
        let file_path: &[u8] = if (event.index as usize) < file_paths.len() {
            file_paths[event.index as usize]
        } else {
            b"(unknown)"
        };
        let names = event.names(changed_files);

        if !first_file {
            if writer.write_all(b",").is_err() {
                return;
            }
        }
        first_file = false;

        // Write path as key
        if write!(writer, "{}", bun_fmt::format_json_string_utf8(file_path)).is_err() {
            return;
        }
        if writer.write_all(b":{\"events\":[").is_err() {
            return;
        }

        // Write array of event types.
        // PORT NOTE: Zig used `std.meta.fields(@TypeOf(event.op))` + `inline for`
        // to walk every `bool` field of the packed-struct `Op`. In Rust `Op` is
        // a `bitflags!` type (per PORTING.md), so `iter_names()` yields exactly
        // the set bool flags by name — same observable output.
        let mut first = true;
        for (name, _flag) in event.op.iter_names() {
            if !first {
                if writer.write_all(b",").is_err() {
                    return;
                }
            }
            if write!(writer, "\"{}\"", name).is_err() {
                return;
            }
            first = false;
        }
        if writer.write_all(b"]").is_err() {
            return;
        }

        // Only write "changed" field if there are changed files
        let mut has_changed = false;
        for name_opt in names {
            if name_opt.is_some() {
                has_changed = true;
                break;
            }
        }

        if has_changed {
            if writer.write_all(b",\"changed\":[").is_err() {
                return;
            }
            first = true;
            for name_opt in names {
                if let Some(name) = name_opt {
                    if !first {
                        if writer.write_all(b",").is_err() {
                            return;
                        }
                    }
                    first = false;
                    if write!(
                        writer,
                        "{}",
                        bun_fmt::format_json_string_utf8(name.as_bytes())
                    )
                    .is_err()
                    {
                        return;
                    }
                }
            }
            if writer.write_all(b"]").is_err() {
                return;
            }
        }

        if writer.write_all(b"}").is_err() {
            return;
        }
    }

    if writer.write_all(b"}}\n").is_err() {
        return;
    }
}

/// Close the trace file if open
// PORT NOTE: free-function `deinit` (no `self`), so this stays a plain fn
// rather than `impl Drop`.
pub fn deinit() {
    // SAFETY: see TRACE_FILE doc — called after watcher thread has stopped.
    unsafe {
        if let Some(file) = (*core::ptr::addr_of_mut!(TRACE_FILE)).take() {
            file.close();
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/watcher/WatcherTrace.zig (112 lines)
//   confidence: medium
//   todos:      3
//   notes:      static-mut global + bun_sys buffered-writer API + MultiArrayList column accessor need Phase B wiring; bitflags iter_names() replaces comptime field reflection over Op
// ──────────────────────────────────────────────────────────────────────────
