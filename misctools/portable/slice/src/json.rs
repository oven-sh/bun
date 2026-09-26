//! The output of the slice: one JSON object on each line.

use std::io::Write as _;

use bun_sys::{Error, Fd, File, Maybe};

pub struct Report {
    out: Vec<u8>,
    failed_to_print: bool,
    first_field: bool,
}

impl Report {
    pub fn new() -> Report {
        Report {
            out: Vec::new(),
            failed_to_print: false,
            first_field: true,
        }
    }

    fn key(&mut self, key: &str) {
        if !self.first_field {
            self.out.push(b',');
        }
        self.first_field = false;
        quoted(&mut self.out, key.as_bytes());
        self.out.push(b':');
    }

    pub fn begin(&mut self, step: &str) {
        self.out.push(b'{');
        self.first_field = true;
        self.string("step", step.as_bytes());
    }

    pub fn string(&mut self, key: &str, value: &[u8]) {
        self.key(key);
        quoted(&mut self.out, value);
    }

    pub fn number(&mut self, key: &str, value: i64) {
        self.key(key);
        let _ = write!(self.out, "{value}");
    }

    pub fn boolean(&mut self, key: &str, value: bool) {
        self.key(key);
        self.out
            .extend_from_slice(if value { b"true" } else { b"false" });
    }

    /// `[{"name": .., "kind": ..}, ..]`
    pub fn entries(&mut self, key: &str, entries: &[(Vec<u8>, &'static str)]) {
        self.key(key);
        self.out.push(b'[');
        for (index, (name, kind)) in entries.iter().enumerate() {
            if index > 0 {
                self.out.push(b',');
            }
            self.out.extend_from_slice(b"{\"name\":");
            quoted(&mut self.out, name);
            self.out.extend_from_slice(b",\"kind\":");
            quoted(&mut self.out, kind.as_bytes());
            self.out.push(b'}');
        }
        self.out.push(b']');
    }

    pub fn end_ok(&mut self) {
        self.boolean("ok", true);
        self.out.extend_from_slice(b"}\n");
    }

    /// The error as bun names it: the name of the errno, its number as the host has it, and the system
    /// call that bun attributes it to.
    pub fn end_error(&mut self, error: &Error) {
        self.boolean("ok", false);
        self.string("error", error.name());
        self.number("errno", host_errno(error));
        self.string("syscall", <&'static str>::from(error.syscall).as_bytes());
        self.out.extend_from_slice(b"}\n");
        #[cfg(bun_portable)]
        {
            // What the last function of macOS that was called directly left as its error.
            let of_macos = bun_darwin_sys::host_imports::take_last_error_of_macos();
            if of_macos != 0 {
                self.detail("error number of the last call of macOS");
                self.number("errno", i64::from(of_macos));
                self.end_line();
            }
        }
    }

    /// A line that says how something went, for the person who reads the output. It is not compared:
    /// what it says depends on the machine (the file system, the version of the system).
    pub fn detail(&mut self, what: &str) {
        self.out.push(b'{');
        self.first_field = true;
        self.string("detail", what.as_bytes());
    }

    pub fn step<T>(&mut self, step: &str, path: &[u8], result: Maybe<T>) {
        self.begin(step);
        if !path.is_empty() {
            self.string("path", path);
        }
        match result {
            Ok(_) => self.end_ok(),
            Err(error) => self.end_error(&error),
        }
    }

    /// Writes what was collected to the standard output. Returns whether all of it was written.
    pub fn print(&mut self) -> bool {
        if File::borrow(&Fd::stdout()).write_all(&self.out).is_err() {
            self.failed_to_print = true;
        }
        self.out.clear();
        !self.failed_to_print
    }
}

/// The number of the error on the host: the image has the numbers of Linux, and macOS has its own.
fn host_errno(error: &Error) -> i64 {
    #[cfg(bun_portable)]
    if bun_core::host::is_mac() {
        return i64::from(bun_darwin_sys::errno::to_macos(i32::from(error.errno)));
    }
    i64::from(error.errno)
}

fn quoted(out: &mut Vec<u8>, value: &[u8]) {
    out.push(b'"');
    for &byte in value {
        match byte {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            0..=0x1f => {
                let _ = write!(out, "\\u{byte:04x}");
            }
            _ => out.push(byte),
        }
    }
    out.push(b'"');
}

impl Report {
    /// Ends an object that has its own `ok`.
    pub fn end_line(&mut self) {
        self.out.extend_from_slice(b"}\n");
    }

    pub fn raw(&mut self, bytes: &[u8]) {
        self.out.extend_from_slice(bytes);
    }
}
