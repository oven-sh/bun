//! As much of SQLite as storing takes.

use core::ffi::{CStr, c_char, c_int, c_uint, c_void};
use core::ptr::{null, null_mut};

use bun_core::ZStr;

type Handle = *mut c_void;

/// `SQLiteLibrary` in DesktopSQLite.cpp
#[repr(C)]
struct Library {
    open: unsafe extern "C" fn(*const c_char, *mut Handle, c_int, *const c_char) -> c_int,
    close: unsafe extern "C" fn(Handle) -> c_int,
    execute: unsafe extern "C" fn(Handle, *const c_char, Handle, Handle, Handle) -> c_int,
    prepare: unsafe extern "C" fn(Handle, *const u8, c_int, c_uint, *mut Handle, Handle) -> c_int,
    step: unsafe extern "C" fn(Handle) -> c_int,
    reset: unsafe extern "C" fn(Handle) -> c_int,
    finalize: unsafe extern "C" fn(Handle) -> c_int,
    bind_null: unsafe extern "C" fn(Handle, c_int) -> c_int,
    bind_integer: unsafe extern "C" fn(Handle, c_int, i64) -> c_int,
    bind_real: unsafe extern "C" fn(Handle, c_int, f64) -> c_int,
    bind_text: unsafe extern "C" fn(Handle, c_int, *const u8, u64, Handle, u8) -> c_int,
    bind_blob: unsafe extern "C" fn(Handle, c_int, *const u8, u64, Handle) -> c_int,
    column_type: unsafe extern "C" fn(Handle, c_int) -> c_int,
    column_integer: unsafe extern "C" fn(Handle, c_int) -> i64,
    column_real: unsafe extern "C" fn(Handle, c_int) -> f64,
    column_blob: unsafe extern "C" fn(Handle, c_int) -> *const u8,
    column_bytes: unsafe extern "C" fn(Handle, c_int) -> c_int,
}

unsafe extern "C" {
    safe fn Bun__Desktop__loadSQLite() -> Option<&'static Library>;
}

/// A result code.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct SqlError(c_int);

impl SqlError {
    const CANNOT_OPEN: SqlError = SqlError(14);

    pub fn is_damage(self) -> bool {
        matches!(self.0 & 0xff, 11 | 26)
    }

    pub fn is_lack_of_space(self) -> bool {
        matches!(self.0 & 0xff, 13 | 18)
    }
}

pub(super) type Result<T = ()> = core::result::Result<T, SqlError>;

fn check(code: c_int) -> Result {
    if code == 0 {
        Ok(())
    } else {
        Err(SqlError(code))
    }
}

#[derive(Clone, Copy)]
pub(super) enum Value<'v> {
    Null,
    Integer(i64),
    Real(f64),
    Text(&'v [u8]),
    Blob(&'v [u8]),
}

pub(super) struct Row<'r>(&'r Library, Handle);

impl Row<'_> {
    pub(super) fn is_null(&self, column: c_int) -> bool {
        const NULL: c_int = 5;
        // SAFETY: the statement is at a row.
        unsafe { (self.0.column_type)(self.1, column) == NULL }
    }

    pub(super) fn integer(&self, column: c_int) -> i64 {
        // SAFETY: the statement is at a row.
        unsafe { (self.0.column_integer)(self.1, column) }
    }

    pub(super) fn real(&self, column: c_int) -> f64 {
        // SAFETY: the statement is at a row.
        unsafe { (self.0.column_real)(self.1, column) }
    }

    /// Not of a number, which would be converted in place.
    pub(super) fn bytes(&self, column: c_int) -> &[u8] {
        // SAFETY: they stay until the statement moves on, which it does not while there is a `Row`.
        unsafe {
            let start = (self.0.column_blob)(self.1, column);
            if start.is_null() {
                &[]
            } else {
                core::slice::from_raw_parts(start, (self.0.column_bytes)(self.1, column) as usize)
            }
        }
    }
}

pub(super) struct Connection {
    library: &'static Library,
    handle: Handle,
    statements: Vec<(&'static str, Handle)>,
}

// SAFETY: SQLite only wants one thread at a time to use it.
unsafe impl Send for Connection {}

impl Connection {
    pub(super) const READ_ONLY: c_int = 1;
    pub(super) const READ_WRITE: c_int = 2 | 4;
    pub(super) const URI: c_int = 0x40;

    pub(super) fn open(file: &ZStr, flags: c_int) -> Result<Connection> {
        let mut connection = Connection {
            library: Bun__Desktop__loadSQLite().ok_or(SqlError::CANNOT_OPEN)?,
            handle: null_mut(),
            statements: Vec::new(),
        };
        // SAFETY: the name ends with a zero. There is a handle to close even if it fails.
        check(unsafe {
            (connection.library.open)(file.as_ptr(), &raw mut connection.handle, flags, null())
        })?;
        Ok(connection)
    }

    pub(super) fn execute(&mut self, statements: &CStr) -> Result {
        // SAFETY: the handle is open.
        check(unsafe {
            (self.library.execute)(
                self.handle,
                statements.as_ptr(),
                null_mut(),
                null_mut(),
                null_mut(),
            )
        })
    }

    fn prepare(&mut self, text: &'static str) -> Result<Handle> {
        const PERSISTENT: c_uint = 1;
        if let Some(known) = self.statements.iter().find(|it| core::ptr::eq(it.0, text)) {
            return Ok(known.1);
        }
        let mut statement = null_mut();
        // SAFETY: the handle is open.
        check(unsafe {
            (self.library.prepare)(
                self.handle,
                text.as_ptr(),
                text.len() as c_int,
                PERSISTENT,
                &raw mut statement,
                null_mut(),
            )
        })?;
        self.statements.push((text, statement));
        Ok(statement)
    }

    /// `values` has one for each parameter.
    pub(super) fn each(
        &mut self,
        text: &'static str,
        values: &[Value<'_>],
        mut visit: impl FnMut(&Row<'_>),
    ) -> Result {
        const UTF8: u8 = 1;
        const ROW: c_int = 100;
        const DONE: c_int = 101;
        let (statement, library) = (self.prepare(text)?, self.library);
        // SAFETY: the statement is only stepped while `values` are there, and all of them are bound anew the next time.
        unsafe {
            for (value, at) in values.iter().zip(1..) {
                check(match *value {
                    Value::Null => (library.bind_null)(statement, at),
                    Value::Integer(it) => (library.bind_integer)(statement, at, it),
                    Value::Real(it) => (library.bind_real)(statement, at, it),
                    Value::Text(it) => (library.bind_text)(
                        statement,
                        at,
                        it.as_ptr(),
                        it.len() as u64,
                        null_mut(),
                        UTF8,
                    ),
                    Value::Blob(it) => {
                        (library.bind_blob)(statement, at, it.as_ptr(), it.len() as u64, null_mut())
                    }
                })?;
            }
            let end = loop {
                match (library.step)(statement) {
                    ROW => visit(&Row(library, statement)),
                    end => break end,
                }
            };
            (library.reset)(statement);
            check(if end == DONE { 0 } else { end })
        }
    }

    pub(super) fn run(&mut self, text: &'static str, values: &[Value<'_>]) -> Result {
        self.each(text, values, |_| {})
    }

    pub(super) fn all<T>(
        &mut self,
        text: &'static str,
        values: &[Value<'_>],
        mut read: impl FnMut(&Row<'_>) -> T,
    ) -> Result<Vec<T>> {
        let mut rows = Vec::new();
        self.each(text, values, |it| rows.push(read(it)))?;
        Ok(rows)
    }

    pub(super) fn one<T>(
        &mut self,
        text: &'static str,
        values: &[Value<'_>],
        mut read: impl FnMut(&Row<'_>) -> T,
    ) -> Result<Option<T>> {
        let mut found = None;
        self.each(text, values, |it| found = Some(read(it)))?;
        Ok(found)
    }

    pub(super) fn atomically<T, E: From<SqlError>>(
        &mut self,
        steps: impl FnOnce(&mut Connection) -> core::result::Result<T, E>,
    ) -> core::result::Result<T, E> {
        self.run("BEGIN IMMEDIATE", &[])?;
        let result = steps(self).and_then(|it| Ok(self.run("COMMIT", &[]).map(|()| it)?));
        if result.is_err() {
            let _ = self.run("ROLLBACK", &[]);
        }
        result
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        // SAFETY: nothing uses them any more.
        unsafe {
            self.statements
                .iter()
                .for_each(|it| _ = (self.library.finalize)(it.1));
            (self.library.close)(self.handle);
        }
    }
}
