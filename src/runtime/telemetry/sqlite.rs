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
    let file: &[u8] = if file.is_null() {
        b""
    } else {
        // SAFETY: caller passes a valid (ptr,len) or (null,0).
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
    let recording = super::local(global)
        .and_then(|l| bun_telemetry::pool::with_ref(&l.pool, span, |s| s.is_recording()));
    if recording != Some(true) {
        crate::telemetry::discard_native(global, span);
        return 0;
    }
    span.0
}

/// Finish a span from `Bun__Telemetry__sqliteBegin`. `errcode == 0` ⇒ ok.
#[unsafe(no_mangle)]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn Bun__Telemetry__sqliteEnd(
    global: &JSGlobalObject,
    span: u64,
    sql: *const c_char,
    sql_len: usize,
    errcode: i32,
    code_name: *const c_char,
    errmsg: *const c_char,
) {
    if span == 0 {
        return;
    }
    let span = NativeSpan(span);
    let sql: &[u8] = if sql.is_null() {
        b""
    } else {
        // SAFETY: caller passes a valid (ptr,len) or (null,0).
        unsafe { core::slice::from_raw_parts(sql.cast::<u8>(), sql_len) }
    };
    let g = global.as_ptr().cast();
    if errcode == 0 {
        db::end(g, span, sql, None, None);
    } else {
        let code: &[u8] = if code_name.is_null() {
            b"SQLITE_ERROR"
        } else {
            // SAFETY: non-null `code_name` is a static string from sqliteCodeName().
            unsafe { core::ffi::CStr::from_ptr(code_name) }.to_bytes()
        };
        let msg: &[u8] = if errmsg.is_null() {
            b""
        } else {
            // SAFETY: non-null `errmsg` is sqlite3_errmsg()'s NUL-terminated string.
            unsafe { core::ffi::CStr::from_ptr(errmsg) }.to_bytes()
        };
        db::end(
            g,
            span,
            sql,
            None,
            Some(db::DbError {
                ty: code,
                message: msg,
                from_server: true,
            }),
        );
    }
}
