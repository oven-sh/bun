use std::io::Write as _;

use bun_core::{ZStr, env_var, fmt as bun_fmt, output};
use bun_sys::{Fd, File, O};
use bun_threading::Guarded;

use crate::watcher_impl::{ChangedFilePath, WatchEvent, WatchList};

/// Optional trace file for debugging watcher events.
// PORTING.md §Concurrency: Zig used a bare `var trace_file: ?File = null` plus
// the implicit single-threaded init/watcher-thread/deinit ordering. Rust
// `static mut` is forbidden — wrap in `bun_threading::Guarded` (cheap when
// uncontended; only the watcher thread touches this after init).
static TRACE_FILE: Guarded<Option<File>> = Guarded::new(None);

/// Initialize trace file if BUN_WATCHER_TRACE env var is set.
/// Only checks once on first call.
pub fn init() {
    let mut slot = TRACE_FILE.lock();
    if slot.is_some() {
        return;
    }

    if let Some(trace_path) = env_var::BUN_WATCHER_TRACE.get() {
        if !trace_path.is_empty() {
            let flags = O::WRONLY | O::CREAT | O::APPEND;
            let mode = 0o644;
            // Silently ignore errors opening trace file
            *slot = File::openat(Fd::cwd(), trace_path, flags, mode).ok();
        }
    }
}

/// Write trace events to the trace file if enabled.
/// This is called from the watcher thread, so no locking is needed.
/// Events are assumed to be already deduped by path.
pub fn write_events(
    watchlist: &WatchList,
    events: &[WatchEvent],
    changed_files: &[ChangedFilePath],
) {
    use crate::watcher_impl::WatchItemColumns;
    let guard = TRACE_FILE.lock();
    let Some(file) = guard.as_ref() else {
        return;
    };

    // PORT NOTE: Zig passed a stack `[4096]u8` to `bufferedWriter(&buffer)`;
    // `bun_sys::File::buffered_writer()` wraps `std::io::BufWriter` which
    // owns its own heap buffer. Same observable behaviour.
    let buffered = file.buffered_writer();
    // `defer buffered.flush() catch |err| { Output.err(...) }`
    let mut writer = scopeguard::guard(buffered, |mut w| {
        if let Err(err) = w.flush() {
            // PORT NOTE: Zig passed the error-union tag (`@errorName`). The
            // BufWriter wrapper surfaces a `std::io::Error`; print its display
            // as the tag — same observable text minus the `error.` prefix.
            // TODO(port): map io::Error → bun_sys::Error once a helper exists.
            let mut name_buf = [0u8; 64];
            let name = {
                use std::io::Write as _;
                let mut c = std::io::Cursor::new(&mut name_buf[..]);
                let _ = write!(c, "{}", err.kind());
                let n = c.position() as usize;
                // SAFETY: `write!(.., "{}", io::ErrorKind)` emits an ASCII variant
                // name (`NotFound`, `PermissionDenied`, …) — pure-ASCII output.
                unsafe { core::str::from_utf8_unchecked(&name_buf[..n]) }
            };
            output::err(name, "Failed to flush watcher trace file", ());
        }
    });

    // Get current timestamp
    // PORT NOTE: std.time.milliTimestamp() — std::time is not in the banned
    // I/O set; revisit if a `bun_core::time` helper exists.
    let timestamp: i64 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).expect("int cast"))
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

    let watchlist_slice = watchlist.slice();
    let file_paths = watchlist_slice.items_file_path();

    let mut first_file = true;
    for event in events {
        let file_path: &[u8] = if (event.index as usize) < file_paths.len() {
            &file_paths[event.index as usize]
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
        if write!(
            writer,
            "{}",
            bun_fmt::format_json_string_utf8(file_path, Default::default())
        )
        .is_err()
        {
            return;
        }
        if writer.write_all(b":{\"events\":[").is_err() {
            return;
        }

        // Write array of event types.
        // PORT NOTE: Zig walks `std.meta.fields(Op)` (lowercase field names).
        // bitflags `iter_names()` yields SCREAMING_CASE const names; use the
        // shared lowercase OP_NAMES table so trace JSON matches Zig exactly.
        let mut first = true;
        for &(flag, name) in crate::watcher_impl::OP_NAMES {
            if !event.op.contains(flag) {
                continue;
            }
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
                        bun_fmt::format_json_string_utf8(name.as_bytes(), Default::default())
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
    if let Some(file) = TRACE_FILE.lock().take() {
        let _ = file.close();
    }
}

// ported from: src/watcher/WatcherTrace.zig
