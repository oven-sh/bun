use std::io::Write as _;

use bun_core::{env_var, fmt as bun_fmt, output, ZStr};
use bun_sys::{self, Fd, File, O};
use parking_lot::Mutex;

use crate::watcher_impl::{ChangedFilePath, WatchEvent, Watcher};

/// Optional trace file for debugging watcher events.
// PORTING.md §Concurrency: Zig used a bare `var trace_file: ?File = null` plus
// the implicit single-threaded init/watcher-thread/deinit ordering. Rust
// `static mut` is forbidden — wrap in `parking_lot::Mutex` (cheap when
// uncontended; only the watcher thread touches this after init).
static TRACE_FILE: Mutex<Option<File>> = Mutex::new(None);

/// Initialize trace file if BUN_WATCHER_TRACE env var is set.
/// Only checks once on first call.
pub fn init() {
    let mut slot = TRACE_FILE.lock();
    if slot.is_some() {
        return;
    }

    if let Some(trace_path) = env_var::BUN_WATCHER_TRACE.get() {
        if !trace_path.is_empty() {
            #[cfg(any())]
            {
                // TODO(b2-blocked): bun_sys::open_a (non-sentinel open)
                let flags = O::WRONLY | O::CREAT | O::APPEND;
                let mode = 0o644;
                if let Ok(fd) = bun_sys::open_a(trace_path, flags, mode) {
                    *slot = Some(File::from_fd(fd));
                }
                // Silently ignore errors opening trace file
            }
            let _ = trace_path;
        }
    }
}

/// Write trace events to the trace file if enabled.
/// This is called from the watcher thread, so no locking is needed.
/// Events are assumed to be already deduped by path.
pub fn write_events(watcher: &Watcher, events: &[WatchEvent], changed_files: &[ChangedFilePath]) {
    #[cfg(any())]
    {
        // TODO(b2-blocked): bun_sys::File::buffered_writer
        // TODO(b2-blocked): bun_collections::MultiArrayElement (derive) —
        // `watcher.watchlist.slice().file_path()` typed-column accessor.
        let guard = TRACE_FILE.lock();
        let Some(file) = guard.as_ref() else {
            return;
        };

        let mut buffer = [0u8; 4096];
        let buffered = file.buffered_writer(&mut buffer);
        // `defer buffered.flush() catch |err| { Output.err(...) }`
        let mut writer = scopeguard::guard(buffered, |mut w| {
            if let Err(err) = w.flush() {
                output::err(&err, format_args!("Failed to flush watcher trace file"));
            }
        });

        // Get current timestamp
        // PORT NOTE: std.time.milliTimestamp() — std::time is not in the banned
        // I/O set; revisit if a `bun_core::time` helper exists.
        let timestamp: i64 = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| i64::try_from(d.as_millis()).unwrap())
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
    let _ = (watcher, events, changed_files);
}

/// Close the trace file if open
// PORT NOTE: free-function `deinit` (no `self`), so this stays a plain fn
// rather than `impl Drop`.
pub fn deinit() {
    if let Some(file) = TRACE_FILE.lock().take() {
        let _ = file.close();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/watcher/WatcherTrace.zig (112 lines)
//   confidence: medium
//   todos:      3
//   notes:      static-mut global → parking_lot::Mutex (PORTING.md §Concurrency); bun_sys buffered-writer API + MultiArrayList column accessor need Phase B wiring; bitflags iter_names() replaces comptime field reflection over Op
// ──────────────────────────────────────────────────────────────────────────
