//! `bun_sema` with Bun's parser in front of it and the file system underneath: what its tests and the `bun-sema`
//! command line tool are made of. The bundler does not use this crate.

pub mod baseline;
pub mod compare;
pub mod hir_dump;
pub mod native;

use bun_sema::atom::Interner;
use bun_sema::hir;

/// Parses `text` with default options. The extension of `path` says what kind of file it is.
pub fn parse(
    path: &str,
    text: &[u8],
    atoms: &Interner,
    experimental_decorators: bool,
) -> hir::File {
    bun_js_parser::sema::summarize(path.as_bytes(), text, atoms, experimental_decorators, false)
}

pub const STACK: usize = 256 << 20;

/// Runs `work(i)` for every `i` below `count`, on `threads` threads with room to recurse.
pub fn for_each_parallel(threads: usize, count: usize, work: impl Fn(usize) + Sync) {
    let next = std::sync::atomic::AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..threads.max(1) {
            std::thread::Builder::new()
                .stack_size(STACK)
                .spawn_scoped(scope, || {
                    native::set_stack_size(STACK - (1 << 20));
                    loop {
                        let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        if i >= count {
                            break;
                        }
                        work(i);
                    }
                })
                .unwrap();
        }
    });
}

/// The real file system.
pub struct Disk {
    pub threads: usize,
}

impl bun_sema::resolve::Host for Disk {
    fn read(&self, path: &str) -> Option<std::borrow::Cow<'static, [u8]>> {
        std::fs::read(path).ok().map(Into::into)
    }
    fn is_file(&self, path: &str) -> bool {
        std::fs::metadata(path).is_ok_and(|m| m.is_file())
    }
    fn is_dir(&self, path: &str) -> bool {
        std::fs::metadata(path).is_ok_and(|m| m.is_dir())
    }
    fn realpath(&self, path: &str) -> String {
        std::fs::canonicalize(path)
            .map_or_else(|_| path.to_owned(), |p| p.to_string_lossy().into_owned())
    }
    fn list_dir(&self, path: &str) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(path) else {
            return Vec::new();
        };
        entries
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect()
    }
    fn parse(
        &self,
        path: &str,
        text: &[u8],
        atoms: &Interner,
        options: &bun_sema::resolve::Options,
    ) -> hir::File {
        let every_file_is_a_module =
            options.module_detection == bun_sema::resolve::ModuleDetection::Force;
        bun_js_parser::sema::summarize(
            path.as_bytes(),
            text,
            atoms,
            options.experimental_decorators,
            every_file_is_a_module,
        )
    }
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        for_each_parallel(self.threads, count, work);
    }
}

/// Every TypeScript file under `dir`, sorted. `node_modules` is not gone into.
pub fn source_files(dir: &str) -> Vec<String> {
    fn walk(dir: &std::path::Path, out: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let Ok(meta) = std::fs::metadata(&path) else {
                continue;
            };
            if meta.is_dir() {
                if name != "node_modules" && !name.starts_with('.') {
                    walk(&path, out);
                }
            } else if [".ts", ".tsx", ".mts", ".cts"]
                .iter()
                .any(|e| name.ends_with(e))
            {
                out.push(path.to_string_lossy().into_owned());
            }
        }
    }
    let mut out = Vec::new();
    walk(std::path::Path::new(dir), &mut out);
    out.sort();
    out
}

/// Where TypeScript's `lib.*.d.ts` are: `BUN_SEMA_TS_LIB`, or a `typescript` package near `tree`.
pub fn find_lib_dir(tree: &str) -> Option<String> {
    if let Ok(dir) = std::env::var("BUN_SEMA_TS_LIB") {
        return Some(dir);
    }
    let mut dir = tree.to_owned();
    loop {
        for package in ["typescript", "@typescript/old"] {
            let candidate = format!("{dir}/node_modules/{package}/lib");
            if std::path::Path::new(&format!("{candidate}/lib.es5.d.ts")).is_file() {
                return Some(candidate);
            }
        }
        let parent = bun_sema::resolve::parent_dir(&dir).to_owned();
        if parent == dir || parent.is_empty() {
            return None;
        }
        dir = parent;
    }
}

/// Loads the program `tree/tsconfig.json` describes, starting from the sources under `tree/<root>` for each root.
/// The project of the tsconfig.json at `config`, which names its `files`.
pub fn load_project(config: &str) -> bun_sema::program::Files {
    let disk = Disk { threads: 1 };
    let mut options =
        bun_sema::resolve::Options::from_tsconfig(&disk, config).expect("tsconfig.json");
    options.lib_dir =
        find_lib_dir(config).expect("TypeScript's lib directory (set BUN_SEMA_TS_LIB)");
    // `BUN_SEMA_TRANSIENT=1`: as `bun check` does it.
    options.drops_what_nothing_refers_to = std::env::var_os("BUN_SEMA_TRANSIENT").is_some();
    // The checker asks `options.files` which files are root files.
    let files = options.files.clone();
    bun_sema::program::Files::load(&disk, options, &files)
}

pub fn load_tree(tree: &str, roots: &[&str], threads: usize) -> bun_sema::program::Files {
    let disk = Disk { threads };
    let mut options =
        bun_sema::resolve::Options::from_tsconfig(&disk, &format!("{tree}/tsconfig.json"))
            .expect("tsconfig.json");
    options.lib_dir = find_lib_dir(tree).expect("TypeScript's lib directory (set BUN_SEMA_TS_LIB)");
    options.drops_what_nothing_refers_to = std::env::var_os("BUN_SEMA_TRANSIENT").is_some();
    let mut files = Vec::new();
    for root in roots {
        files.extend(source_files(&format!("{tree}/{root}")));
    }
    bun_sema::program::Files::load(&disk, options, &files)
}

/// The most memory the process has had resident, in bytes.
/// How many instructions the process has gone through and how many cycles that took, on all threads. The first hardly differs from one run to
/// the next, which the time taken does. (0, 0) where it cannot be told.
pub fn instructions_and_cycles() -> (u64, u64) {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: all zeros is a `rusage_info_v4`.
        let mut info: libc::rusage_info_v4 = unsafe { core::mem::zeroed() };
        // SAFETY: `info` is what `RUSAGE_INFO_V4` fills in, and outlives the call.
        let failed = unsafe {
            libc::proc_pid_rusage(libc::getpid(), libc::RUSAGE_INFO_V4, (&raw mut info).cast())
        };
        if failed == 0 {
            return (info.ri_instructions, info.ri_cycles);
        }
    }
    (0, 0)
}

/// How much memory the process has right now, as the system counts it against it. 0 where it cannot be told.
pub fn memory_now() -> u64 {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: all zeros is a `rusage_info_v4`.
        let mut info: libc::rusage_info_v4 = unsafe { core::mem::zeroed() };
        // SAFETY: `info` is what `RUSAGE_INFO_V4` fills in, and outlives the call.
        let failed = unsafe {
            libc::proc_pid_rusage(libc::getpid(), libc::RUSAGE_INFO_V4, (&raw mut info).cast())
        };
        if failed == 0 {
            return info.ri_phys_footprint;
        }
    }
    0
}

/// How many columns the terminal standard output goes to has. 0 if it goes elsewhere.
pub fn terminal_width() -> usize {
    // SAFETY: all zeros is a `winsize`, which the call fills in.
    unsafe {
        let mut size: libc::winsize = core::mem::zeroed();
        if libc::ioctl(1, libc::TIOCGWINSZ, &raw mut size) == 0 {
            usize::from(size.ws_col)
        } else {
            0
        }
    }
}

/// The most memory the process has had at any time, as the system counts it against it. What has been given back and not been taken yet, which
/// `getrusage` counts, is not in it.
pub fn peak_memory() -> u64 {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: all zeros is a `rusage_info_v4`.
        let mut info: libc::rusage_info_v4 = unsafe { core::mem::zeroed() };
        // SAFETY: `info` is what `RUSAGE_INFO_V4` fills in, and outlives the call.
        let failed = unsafe {
            libc::proc_pid_rusage(libc::getpid(), libc::RUSAGE_INFO_V4, (&raw mut info).cast())
        };
        if failed == 0 {
            return info.ri_lifetime_max_phys_footprint;
        }
    }
    peak_rss()
}

pub fn peak_rss() -> u64 {
    #[repr(C)]
    struct Rusage {
        times: [i64; 4],
        max_rss: i64,
        rest: [i64; 13],
    }
    unsafe extern "C" {
        fn getrusage(who: i32, usage: *mut Rusage) -> i32;
    }
    let mut usage = Rusage {
        times: [0; 4],
        max_rss: 0,
        rest: [0; 13],
    };
    // SAFETY: `usage` has the layout of `struct rusage` on 64-bit macOS and Linux, and outlives the call.
    if unsafe { getrusage(0, &mut usage) } != 0 {
        return 0;
    }
    // Bytes on macOS, kilobytes on Linux.
    if cfg!(target_os = "macos") {
        usage.max_rss as u64
    } else {
        usage.max_rss as u64 * 1024
    }
}
