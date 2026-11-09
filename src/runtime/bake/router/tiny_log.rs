//! A small fixed-size log for router errors.

use core::fmt;

use bun_collections::BoundedArray;
use bun_core::Output;
use bun_paths::MAX_PATH_BYTES;

use super::*;

const TINY_LOG_CAP: usize = 512
    + if MAX_PATH_BYTES < 4096 {
        MAX_PATH_BYTES
    } else {
        4096
    };

/// Non-allocating single message log, specialized for the messages from the route pattern parsers.
/// DevServer uses this to special-case the printing of these messages to highlight the offending part of the filename
pub(crate) struct TinyLog {
    pub(crate) msg: BoundedArray<u8, TINY_LOG_CAP>,
    pub(crate) cursor_at: u32,
    pub(crate) cursor_len: u32,
}

impl TinyLog {
    pub(crate) fn empty() -> TinyLog {
        TinyLog {
            cursor_at: u32::MAX,
            cursor_len: 0,
            msg: BoundedArray::default(),
        }
    }

    pub(crate) fn fail(
        &mut self,
        args: fmt::Arguments<'_>,
        cursor_at: usize,
        cursor_len: usize,
    ) -> PatternParseError {
        self.write(args);
        self.cursor_at = u32::try_from(cursor_at).expect("int cast");
        self.cursor_len = u32::try_from(cursor_len).expect("int cast");
        PatternParseError::InvalidRoutePattern
    }

    pub(crate) fn write(&mut self, args: fmt::Arguments<'_>) {
        use std::io::Write as _;
        // Note: BoundedArray exposes no `buffer_mut()`; format into a stack
        // scratch buffer (same capacity) and copy into the BoundedArray.
        let mut buf = [0u8; TINY_LOG_CAP];
        let mut cursor: &mut [u8] = &mut buf[..];
        let len = match cursor.write_fmt(args) {
            Ok(()) => TINY_LOG_CAP - cursor.len(),
            Err(_) => {
                // truncation should never happen because the buffer is HUGE. handle it anyways
                buf[TINY_LOG_CAP - 3..].copy_from_slice(b"...");
                TINY_LOG_CAP
            }
        };
        self.msg.clear();
        self.msg.resize(len).unwrap();
        self.msg.slice().copy_from_slice(&buf[..len]);
    }

    pub(crate) fn print(&self, rel_path: &[u8]) {
        let cursor_at = self.cursor_at as usize;
        let cursor_len = self.cursor_len as usize;
        let after = &rel_path[cursor_at..];
        Output::err_generic(
            "\"{}<blue>{}<r>{}\" is not a valid route",
            (
                bstr::BStr::new(&rel_path[0..cursor_at]),
                bstr::BStr::new(&after[0..cursor_len.min(after.len())]),
                bstr::BStr::new(&after[cursor_len.min(after.len())..]),
            ),
        );
        let w = Output::error_writer_buffered();
        if writer_splat_byte_all(w, b' ', "error: \"".len() + cursor_at).is_err() {
            return;
        }
        if Output::enable_ansi_colors_stderr() {
            let symbols = bun_core::fmt::TableSymbols::UNICODE;
            bun_core::pretty_error!("<blue>{}", symbols.top_column_sep());
            if cursor_len > 1 {
                if writer_splat_bytes_all(w, symbols.horizontal_edge(), cursor_len - 1).is_err() {
                    return;
                }
            }
        } else {
            if cursor_len <= 1 {
                if w.write_all(b"|").is_err() {
                    return;
                }
            } else {
                if writer_splat_byte_all(w, b'-', cursor_len - 1).is_err() {
                    return;
                }
            }
        }
        if w.write_all(b"\n").is_err() {
            return;
        }
        if writer_splat_byte_all(w, b' ', "error: \"".len() + cursor_at).is_err() {
            return;
        }
        if w.write_all(self.msg.const_slice()).is_err() {
            return;
        }
        bun_core::pretty_error!("<r>\n");
        Output::flush();
    }
}

/// Local shim — `bun_core::io::Writer` exposes only `write_all`/`print`.
fn writer_splat_byte_all(w: &mut bun_core::io::Writer, byte: u8, n: usize) -> crate::Result<()> {
    let chunk = [byte; 256];
    let mut remain = n;
    while remain > 0 {
        let take = remain.min(chunk.len());
        w.write_all(&chunk[..take])?;
        remain -= take;
    }
    Ok(())
}

fn writer_splat_bytes_all(
    w: &mut bun_core::io::Writer,
    bytes: &str,
    n: usize,
) -> crate::Result<()> {
    for _ in 0..n {
        w.write_all(bytes.as_bytes())?;
    }
    Ok(())
}
