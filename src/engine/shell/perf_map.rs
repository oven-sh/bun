//! What `perf` needs to know about generated code.

use std::fs::File;
use std::io::Write;
use std::sync::{LazyLock, Mutex};

/// The pieces of code are in the same order in both files.
pub(crate) fn record(start: usize, len: usize, name: &str) {
    static FILES: LazyLock<Mutex<[File; 2]>> = LazyLock::new(|| {
        let create =
            |extension| File::create(format!("/tmp/perf-{}.{extension}", std::process::id()));
        Mutex::new(["map", "code"].map(|it| create(it).expect("a directory for temporary files")))
    });
    // SAFETY: it has just been linked.
    let code =
        unsafe { core::slice::from_raw_parts(core::ptr::with_exposed_provenance(start), len) };
    if let Ok(mut files) = FILES.lock() {
        let _ = writeln!(files[0], "{start:x} {len:x} {}", name.replace('\n', " "))
            .and_then(|()| files[1].write_all(code));
    }
}
