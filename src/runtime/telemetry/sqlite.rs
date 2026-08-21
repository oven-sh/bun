//! C ABI for the bun:sqlite integration (JSSQLStatement.cpp).

use core::ffi::c_char;

use bun_jsc::JSGlobalObject;
use bun_telemetry::db::{self, ConnectionInfo, System};
use bun_telemetry::{Instrument, NativeSpan};

/// Start a SQLite query span. Returns a pool handle (to be passed to
/// `Bun__Telemetry__sqliteEnd`) or 0 when not recording.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__sqliteBegin(
    global: &JSGlobalObject,
    file: *const c_char,
    file_len: usize,
) -> u64 {
    if !bun_telemetry::enabled(Instrument::Sqlite) {
        return 0;
    }
    // SAFETY: caller passes a valid (ptr,len) or (null,0).
    let file: &[u8] = if file.is_null() {
        b""
    } else {
        unsafe { core::slice::from_raw_parts(file.cast::<u8>(), file_len) }
    };
    // `db.namespace` for SQLite is the main database file's base name.
    let name = bun_paths::basename(file);
    let span = db::begin(
        global.as_ptr().cast(),
        System::Sqlite,
        &ConnectionInfo {
            host: b"",
            port: 0,
            namespace: name,
        },
    );
    if bun_telemetry::pool::with_ref(span, |s| s.is_recording()) != Some(true) {
        crate::telemetry::discard_native(span);
        return 0;
    }
    span.0
}

/// Finish a span from `Bun__Telemetry__sqliteBegin`. `errcode == 0` ⇒ ok.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Telemetry__sqliteEnd(
    span: u64,
    sql: *const c_char,
    sql_len: usize,
    errcode: i32,
    errmsg: *const c_char,
) {
    if span == 0 {
        return;
    }
    let span = NativeSpan(span);
    let sql: &[u8] = if sql.is_null() {
        b""
    } else {
        unsafe { core::slice::from_raw_parts(sql.cast::<u8>(), sql_len) }
    };
    if errcode == 0 {
        db::end(span, sql, None, None);
    } else {
        let code = sqlite_code_name(errcode);
        let msg: &[u8] = if errmsg.is_null() {
            b""
        } else {
            unsafe { core::ffi::CStr::from_ptr(errmsg) }.to_bytes()
        };
        db::end(span, sql, None, Some((code.as_bytes(), msg)));
    }
}

fn sqlite_code_name(code: i32) -> &'static str {
    match code & 0xff {
        1 => "SQLITE_ERROR",
        2 => "SQLITE_INTERNAL",
        3 => "SQLITE_PERM",
        4 => "SQLITE_ABORT",
        5 => "SQLITE_BUSY",
        6 => "SQLITE_LOCKED",
        7 => "SQLITE_NOMEM",
        8 => "SQLITE_READONLY",
        9 => "SQLITE_INTERRUPT",
        10 => "SQLITE_IOERR",
        11 => "SQLITE_CORRUPT",
        12 => "SQLITE_NOTFOUND",
        13 => "SQLITE_FULL",
        14 => "SQLITE_CANTOPEN",
        15 => "SQLITE_PROTOCOL",
        16 => "SQLITE_EMPTY",
        17 => "SQLITE_SCHEMA",
        18 => "SQLITE_TOOBIG",
        19 => "SQLITE_CONSTRAINT",
        20 => "SQLITE_MISMATCH",
        21 => "SQLITE_MISUSE",
        22 => "SQLITE_NOLFS",
        23 => "SQLITE_AUTH",
        24 => "SQLITE_FORMAT",
        25 => "SQLITE_RANGE",
        26 => "SQLITE_NOTADB",
        _ => "SQLITE_ERROR",
    }
}
