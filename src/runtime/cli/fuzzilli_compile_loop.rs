//! `bun build --compile --aot <file>` started by Fuzzilli, in a build with `--fuzzilli=on`: compiles every program
//! Fuzzilli sends, each in a fork of this process, and writes no executable. test/aot/fuzz/fuzzilli/README.md says how to run it.

use core::sync::atomic::{AtomicU64, Ordering};
use core::time::Duration;
use std::sync::Arc;

use bun_core::{Global, Output, ZBox, zstr};
use bun_options_types::aot_options::Preload;
use bun_sys::{Fd, File};

use super::compile_command::{CompileProduct, compile_from_context, print_log};
use crate::cli::command::{Context, ContextData};

const CONTROL_READ: i32 = 100;
const CONTROL_WRITE: i32 = 101;
const DATA_READ: i32 = 102;

const DEFAULT_CPU_SECONDS: u32 = 30;
const DEFAULT_MEMORY_MEGABYTES: u32 = 4096;
const INTERNAL_ERROR_PREFIX: &[u8] = b"internal compiler error";
/// Fuzzilli sends it when it starts, to see that it notices a crash.
const CRASH_REQUEST: &[u8] = b"fuzzilli('FUZZILLI_CRASH', 0)";

unsafe extern "C" {
    safe fn Bun__REPRL__resetCoverage();
    #[cfg(bun_asan)]
    safe fn pas_scavenger_suspend();
}

/// Resident bytes when the current build began. 0: no build is running.
static RESIDENT_BYTES_AT_START: AtomicU64 = AtomicU64::new(0);

pub(crate) fn is_started_by_fuzzilli() -> bool {
    [CONTROL_READ, CONTROL_WRITE, DATA_READ]
        .into_iter()
        .all(|descriptor| bun_sys::fstat(Fd::from_native(descriptor)).is_ok())
}

struct Channel {
    control_read: File,
    control_write: File,
    data_read: File,
    entry_point: ZBox,
    cpu_seconds: u32,
    memory_bytes: u64,
}

pub(crate) fn compile_programs(ctx: Context<'_>) -> ! {
    let [entry_point] = &mut ctx.args.entry_points[..] else {
        stop("Expected one entry point: the file that each program is written to");
    };
    let placeholder = add_prefix(entry_point, b"empty.");
    *entry_point = add_prefix(entry_point, b"");
    let channel = Arc::new(Channel {
        control_read: File::from_fd(Fd::from_native(CONTROL_READ)),
        control_write: File::from_fd(Fd::from_native(CONTROL_WRITE)),
        data_read: File::from_fd(Fd::from_native(DATA_READ)),
        entry_point: ZBox::from_bytes(&entry_point[..]),
        cpu_seconds: read_limit(zstr!("BUN_FUZZILLI_CPU_SECONDS"), DEFAULT_CPU_SECONDS),
        memory_bytes: u64::from(read_limit(
            zstr!("BUN_FUZZILLI_MEMORY_MEGABYTES"),
            DEFAULT_MEMORY_MEGABYTES,
        )) << 20,
    });
    // A build that folds a call of a built-in makes a VM in the forked process. That VM only interprets.
    if bun_core::getenv_z(zstr!("BUN_JSC_useJIT")) != Some(&b"0"[..]) {
        stop("Expected BUN_JSC_useJIT=0 in the environment");
    }
    channel.greet();
    // A new process has only the thread that forked, so that thread does all the work of a build.
    bun_sema_driver::run_regions_inline_on_this_thread();
    grow_stack_to(bun_sema_driver::WORKER_STACK_SIZE);
    // The build lists the folder before the first program is there.
    for path in [&*placeholder, channel.entry_point.as_bytes()] {
        if File::write_file(Fd::cwd(), &ZBox::from_bytes(path), b"").is_err() {
            stop("The entry point could not be written");
        }
    }

    let defines = ctx.args.define.clone();
    let compile = |ctx: &mut ContextData| {
        // SAFETY: nothing else borrows the log between two builds.
        unsafe { ctx.log_mut() }.reset();
        ctx.args.define.clone_from(&defines);
        let compiled = compile_from_context(ctx, CompileProduct::GraphBytes);
        matches!(compiled, Ok(Ok(_)))
    };
    // The tables that the first build of a process fills are filled once.
    if !compile(ctx) {
        print_log(ctx.log_ref());
        stop("An empty program could not be compiled");
    }
    set_preload(
        ctx,
        Some(Preload {
            placeholder_entry_point: placeholder,
            on_loaded: Arc::new(move || channel.fork_for_each_program()),
            is_loaded: Arc::default(),
        }),
    );
    let mut is_compiled = compile(ctx);
    // --no-builtin-modules makes a build quicker and leaves out helpers that some syntax needs.
    if reports_internal_error(ctx) && set_omits_builtin_modules(ctx, false) {
        is_compiled = compile(ctx);
    }
    if !is_compiled {
        print_log(ctx.log_ref());
    }
    if reports_internal_error(ctx) {
        stop("The compiler reported an internal error");
    }
    Output::flush();
    // SAFETY: no preconditions.
    unsafe { libc::_exit(i32::from(!is_compiled)) }
}

impl Channel {
    fn greet(&self) {
        let mut greeting = [0u8; 4];
        if self.control_write.write_all(b"HELO").is_err()
            || self.control_read.read_all(&mut greeting).ok() != Some(4)
            || greeting != *b"HELO"
        {
            stop("The handshake with Fuzzilli failed");
        }
    }

    /// Waits for the next program and writes it to the entry point.
    fn receive_program(&self) {
        let mut command = [0u8; 4];
        match self.control_read.read_all(&mut command) {
            Ok(0) => Global::exit(0),
            Ok(4) if command == *b"exec" => {}
            _ => stop("Expected the command \"exec\""),
        }
        let mut size = [0u8; 8];
        if self.control_read.read_all(&mut size).ok() != Some(8) {
            stop("Expected the size of a program");
        }
        let Ok(size) = usize::try_from(u64::from_le_bytes(size)) else {
            stop("The program is too large");
        };
        let mut text = vec![0u8; size];
        if self.data_read.pread_all(&mut text, 0).ok() != Some(size)
            || File::write_file(Fd::cwd(), &self.entry_point, &text).is_err()
        {
            stop("The program could not be copied to the entry point");
        }
        if bun_core::strings::contains(&text, CRASH_REQUEST) {
            stop("The program asked for a crash");
        }
    }

    /// Returns once for each program, in a process of its own. The caller's process tells Fuzzilli how each of them ended.
    fn fork_for_each_program(&self) {
        Bun__REPRL__resetCoverage();
        // A build with the address sanitizer allocates with libpas. A forked process would wait forever for a lock that its scavenger thread held.
        #[cfg(bun_asan)]
        pas_scavenger_suspend();
        loop {
            self.receive_program();
            Output::flush();
            // SAFETY: the threads that the new process lacks hold no lock: they wait for work.
            let child = unsafe { libc::fork() };
            if child == 0 {
                #[cfg(target_os = "linux")]
                // SAFETY: takes integers.
                unsafe {
                    libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
                }
                limit_cpu_time(self.cpu_seconds);
                RESIDENT_BYTES_AT_START.store(resident_bytes().max(1), Ordering::Relaxed);
                watch_memory(self.memory_bytes);
                return;
            }
            let mut ended = 0;
            // SAFETY: the kernel writes one integer.
            if child < 0 || unsafe { libc::waitpid(child, &raw mut ended, 0) } != child {
                stop("The process for a program could not be started");
            }
            // The low byte is a signal, the next one an exit code.
            let status = match libc::WIFSIGNALED(ended) {
                true => libc::WTERMSIG(ended).cast_unsigned(),
                false => libc::WEXITSTATUS(ended).cast_unsigned() << 8,
            };
            if self.control_write.write_all(&status.to_le_bytes()).is_err() {
                Global::exit(0);
            }
        }
    }
}

fn reports_internal_error(ctx: &ContextData) -> bool {
    let mut messages = ctx.log_ref().msgs.iter();
    messages.any(|message| message.data.text.starts_with(INTERNAL_ERROR_PREFIX))
}

/// Returns whether that changed the option.
fn set_omits_builtin_modules(ctx: &mut ContextData, omits: bool) -> bool {
    let Some(options) = ctx.bundler_options.aot.as_mut() else {
        return false;
    };
    core::mem::replace(&mut options.omits_builtin_modules, omits) != omits
}

fn set_preload(ctx: &mut ContextData, preload: Option<Preload>) {
    let Some(options) = ctx.bundler_options.aot.as_mut() else {
        stop("Expected --aot");
    };
    options.preload = preload;
}

/// Fuzzilli starts all its instances with the same arguments: `a/program.js` becomes `a/123.program.js`.
fn add_prefix(path: &[u8], prefix: &[u8]) -> Box<[u8]> {
    let name_start = bun_core::strings::last_index_of_char(path, b'/').map_or(0, |slash| slash + 1);
    let (folder, name) = path.split_at(name_start);
    let process_id = std::process::id().to_string();
    [folder, process_id.as_bytes(), b".", prefix, name]
        .concat()
        .into()
}

/// The threads that compile in other builds of Bun have this much.
fn grow_stack_to(bytes: u32) {
    let mut limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: the kernel writes one `rlimit`.
    unsafe { libc::getrlimit(libc::RLIMIT_STACK, &raw mut limit) };
    let bytes = libc::rlim_t::from(bytes);
    if limit.rlim_cur < bytes {
        limit.rlim_cur = bytes.min(limit.rlim_max);
        // SAFETY: the kernel reads one `rlimit`.
        unsafe { libc::setrlimit(libc::RLIMIT_STACK, &raw const limit) };
    }
}

fn read_limit(name: &bun_core::ZStr, default: u32) -> u32 {
    bun_core::getenv_z(name)
        .and_then(|text| core::str::from_utf8(text).ok()?.parse().ok())
        .unwrap_or(default)
}

/// Ends by a signal, which Fuzzilli keeps and reduces.
fn stop(reason: &str) -> ! {
    Output::flush();
    let _ = bun_sys::write(Fd::stderr(), format!("fuzzilli: {reason}\n").as_bytes());
    // SAFETY: no preconditions.
    unsafe { libc::abort() }
}

/// A build that takes more processor time ends by SIGXCPU.
fn limit_cpu_time(seconds: u32) {
    let mut used = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: the kernel writes one `timespec`.
    unsafe { libc::clock_gettime(libc::CLOCK_PROCESS_CPUTIME_ID, &raw mut used) };
    let used_seconds = libc::rlim_t::try_from(used.tv_sec).unwrap_or(0);
    let limit = libc::rlimit {
        rlim_cur: used_seconds + 1 + libc::rlim_t::from(seconds),
        rlim_max: libc::RLIM_INFINITY,
    };
    // SAFETY: the kernel reads one `rlimit`.
    unsafe { libc::setrlimit(libc::RLIMIT_CPU, &raw const limit) };
}

fn resident_bytes() -> u64 {
    let Ok(text) = File::read_from(Fd::cwd(), b"/proc/self/statm") else {
        return 0;
    };
    let pages = bun_core::strings::split(&text, b" ")
        .nth(1)
        .and_then(|field| core::str::from_utf8(field).ok()?.parse::<u64>().ok());
    pages.unwrap_or(0) * 4096
}

/// A build that grows the process by more than `limit` bytes ends by SIGABRT.
fn watch_memory(limit: u64) {
    let watcher = std::thread::Builder::new()
        .name("fuzzilli memory".into())
        .stack_size(256 << 10);
    let started = watcher.spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(50));
            let at_start = RESIDENT_BYTES_AT_START.load(Ordering::Relaxed);
            if at_start != 0 && resident_bytes().saturating_sub(at_start) > limit {
                stop("The build used more memory than BUN_FUZZILLI_MEMORY_MEGABYTES");
            }
        }
    });
    if started.is_err() {
        stop("The thread that watches memory could not be started");
    }
}
