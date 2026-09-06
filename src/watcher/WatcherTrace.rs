use std::io::Write as _;

use bun_core::{env_var, fmt as bun_fmt, output};
use bun_sys::{Fd, File, O};
use bun_threading::Guarded;

use crate::watcher_impl::{ChangedFilePath, WatchEvent, WatchList};

/// Optional trace file for debugging watcher events.
// Wrapped in `bun_threading::Guarded` (cheap when
// uncontended; only the watcher thread touches this after init).
static TRACE_FILE: Guarded<Option<File>> = Guarded::new(None);

/// Initialize trace file if BUN_WATCHER_TRACE env var is set.
/// Only checks once on first call.
pub(crate) fn init() {
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
pub(crate) fn write_events(
    watchlist: &WatchList,
    events: &[WatchEvent],
    changed_files: &[ChangedFilePath],
) {
    use crate::watcher_impl::WatchItemColumns;
    let guard = TRACE_FILE.lock();
    let Some(file) = guard.as_ref() else {
        return;
    };

    // `bun_sys::File::buffered_writer()` wraps `std::io::BufWriter` which
    // owns its own heap buffer.
    let buffered = file.buffered_writer();
    // `defer buffered.flush() catch |err| { Output.err(...) }`
    let mut writer = scopeguard::guard(buffered, |mut w| {
        if let Err(err) = w.flush() {
            let name = err.to_string();
            output::err(name.as_str(), "Failed to flush watcher trace file", ());
        }
    });

    // Get current timestamp. `std::time` is not in the banned I/O set;
    // revisit if a `bun_core::time` helper exists.
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
        // bitflags `iter_names()` yields SCREAMING_CASE const names; use the
        // shared lowercase OP_NAMES table so trace JSON keys stay lowercase.
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
            for name in names.iter().flatten() {
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
// free-function `deinit` (no `self`), so this stays a plain fn
// rather than `impl Drop`.
pub(crate) fn deinit() {
    let _ = TRACE_FILE.lock().take();
}
