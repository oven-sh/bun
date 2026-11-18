//! Tells `perf` and other profilers of the system what generated code is called.
//!
//! <https://github.com/torvalds/linux/blob/master/tools/perf/Documentation/jitdump-specification.txt>

use std::sync::OnceLock;

use bun_engine_platform::clock::monotonic_seconds;
use bun_sys::{Fd, File, O};
use bun_threading::Guarded;

struct Dump {
    file: File,
    count: u64,
}

static DIRECTORY: OnceLock<Box<[u8]>> = OnceLock::new();
static DUMP: OnceLock<Guarded<Dump>> = OnceLock::new();

fn timestamp() -> [u8; 8] {
    ((monotonic_seconds() * 1e9) as u64).to_le_bytes()
}

fn header() -> Vec<u8> {
    const MAGIC: u32 = 0x4a69_5444;
    const VERSION: u32 = 1;
    const SIZE: u32 = 40;
    const ELF_MACHINE: u32 = if cfg!(target_arch = "x86_64") {
        62
    } else {
        183
    };
    let words = [MAGIC, VERSION, SIZE, ELF_MACHINE, 0, std::process::id()];
    [
        words.map(u32::to_le_bytes).as_flattened(),
        &timestamp(),
        &[0; 8],
    ]
    .concat()
}

fn write_code(address: usize, length: usize, name: &str) {
    const CODE_LOAD: u32 = 0;
    const FIXED_SIZE: usize = 56;
    let Some(mut dump) = DUMP.get().map(Guarded::lock) else {
        return;
    };
    // SAFETY: it has just been linked.
    let code =
        unsafe { core::slice::from_raw_parts(core::ptr::with_exposed_provenance(address), length) };
    let size = (FIXED_SIZE + name.len() + 1 + length) as u32;
    let ids = [
        std::process::id(),
        bun_threading::current_thread_id() as u32,
    ];
    let place = [address as u64, address as u64, length as u64, dump.count];
    let record = [
        [CODE_LOAD, size].map(u32::to_le_bytes).as_flattened(),
        &timestamp(),
        ids.map(u32::to_le_bytes).as_flattened(),
        place.map(u64::to_le_bytes).as_flattened(),
        name.as_bytes(),
        &[0],
        code,
    ]
    .concat();
    let _ = dump.file.write_all(&record);
    dump.count += 1;
}

/// `perf record` notes what is mapped for execution, and so where to look.
#[cfg(any(target_os = "linux", target_os = "android"))]
fn announce(file: &File) {
    let protection = libc::PROT_READ | libc::PROT_EXEC;
    let (anywhere, descriptor) = (core::ptr::null_mut(), file.fd().native());
    // SAFETY: a new mapping, which nothing looks at.
    unsafe { libc::mmap(anywhere, 1, protection, libc::MAP_PRIVATE, descriptor, 0) };
}

#[cfg(not(any(target_os = "linux", target_os = "android")))]
fn announce(_: &File) {}

/// Before `start_jit_dump`.
pub fn set_jit_dump_directory(directory: &[u8]) {
    let _ = DIRECTORY.set(directory.into());
}

/// Once, before any code is generated.
pub fn start_jit_dump() {
    let directory = (DIRECTORY.get().map(|it| &**it))
        .or_else(bun_core::env_var::TMPDIR::get)
        .unwrap_or(b"/tmp");
    let name = format!("/jit-{}.dump", std::process::id());
    let path = [directory, name.as_bytes()].concat();
    let flags = O::RDWR | O::CREAT | O::EXCL | O::CLOEXEC;
    let Ok(file) = File::openat(Fd::cwd(), &path, flags, 0o600) else {
        return;
    };
    announce(&file);
    let _ = file.write_all(&header());
    let _ = DUMP.set(Guarded::new(Dump { file, count: 0 }));
    bun_engine_exec_memory::set_observer(write_code);
}
