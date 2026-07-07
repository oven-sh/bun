//! `bun.Output.buffered_stdin` — the process-global buffered stdin,
//! `bun.deprecated.BufferedReader(4096, File.Reader)`. Used by the
//! `prompt()`/`bun init`/`bun publish` line reads.

use bun_core::RacyCell;
use bun_core::deprecated::BufferedReader;

use crate::{Fd, FileReader};

/// 4 KiB buffered reader over the process stdin.
pub type BufferedStdin = BufferedReader<4096, FileReader>;

static BUFFERED_STDIN: RacyCell<BufferedStdin> = RacyCell::new(BufferedStdin {
    unbuffered_reader: FileReader({
        #[cfg(windows)]
        {
            Fd::INVALID // set in init()
        }
        #[cfg(not(windows))]
        {
            Fd::stdin()
        }
    }),
    buf: [0; 4096],
    start: 0,
    end: 0,
});

/// Windows startup fd fixup: the cached stdin HANDLE does not exist at
/// static-init time, so `windows_stdio::init` (via `Output::stdio::init`)
/// is followed by this call before anything reads stdin.
#[cfg(windows)]
pub fn init() {
    // SAFETY: BUFFERED_STDIN is a static initialized at startup before use.
    unsafe {
        (*BUFFERED_STDIN.get()).unbuffered_reader = FileReader(Fd::stdin());
    }
}

/// `bun.Output.buffered_stdin` — raw pointer to the process-global 4 KiB
/// buffered stdin.
///
/// Returns `*mut` (not `&'static mut`) to avoid handing out two live aliasing
/// `&mut` to the same static (PORTING.md §Forbidden); callers materialise the
/// `&mut` at the use site.
///
/// SAFETY: the static is single-threaded by construction (only ever touched
/// from the main JS/CLI thread while blocked on user input).
#[inline]
pub fn buffered_stdin() -> *mut BufferedStdin {
    BUFFERED_STDIN.get()
}

/// Convenience for `bun.Output.buffered_stdin.reader().readUntilDelimiterArrayList`.
#[inline]
pub fn buffered_stdin_read_until_delimiter(
    out: &mut Vec<u8>,
    delimiter: u8,
    max_size: usize,
) -> Result<(), bun_core::Error> {
    // SAFETY: single-threaded static; only live `&mut` for this call's duration.
    read_until_delimiter_array_list(unsafe { &mut *buffered_stdin() }, out, delimiter, max_size)
}

/// Fill `dest` from the buffer, refilling from
/// the underlying fd until `dest` is full or EOF. Returns `Ok(0)` on EOF.
///
/// Matches std `BufferedReader.read` fill-to-completion semantics
/// (loops on the underlying fd), not POSIX partial-read.
pub fn read(reader: &mut BufferedStdin, dest: &mut [u8]) -> Result<usize, bun_core::Error> {
    let fd = reader.unbuffered_reader.0;
    let mut written: usize = 0;
    loop {
        let current = &reader.buf[reader.start..reader.end];
        if !current.is_empty() {
            let n = current.len().min(dest.len() - written);
            dest[written..written + n].copy_from_slice(&current[..n]);
            reader.start += n;
            written += n;
            if written == dest.len() {
                return Ok(written);
            }
        }
        let remaining = dest.len() - written;
        if remaining >= reader.buf.len() {
            // Large dest tail: bypass the buffer.
            let n = crate::read(fd, &mut dest[written..])?;
            if n == 0 {
                return Ok(written);
            }
            written += n;
            if written == dest.len() {
                return Ok(written);
            }
            continue;
        }
        reader.end = crate::read(fd, &mut reader.buf)?;
        reader.start = 0;
        if reader.end == 0 {
            return Ok(written);
        }
    }
}

/// Read one byte — `Err` on I/O error *or* EOF (`EndOfStream`).
pub fn read_byte(reader: &mut BufferedStdin) -> Result<u8, bun_core::Error> {
    if reader.start < reader.end {
        let b = reader.buf[reader.start];
        reader.start += 1;
        return Ok(b);
    }
    let mut one = [0u8; 1];
    match read(reader, &mut one)? {
        0 => Err(bun_core::err!(EndOfStream)),
        _ => Ok(one[0]),
    }
}

/// Appends bytes (not
/// including `delimiter`) into `out`; errors with `StreamTooLong`
/// semantics if `out.len()` would exceed `max_size`.
pub fn read_until_delimiter_array_list(
    reader: &mut BufferedStdin,
    out: &mut Vec<u8>,
    delimiter: u8,
    max_size: usize,
) -> Result<(), bun_core::Error> {
    out.clear();
    loop {
        if out.len() >= max_size {
            return Err(bun_core::err!(StreamTooLong));
        }
        let b = read_byte(reader)?;
        if b == delimiter {
            return Ok(());
        }
        out.push(b);
    }
}
