//! Runs a program that `fuzzilli_compile_loop` compiled, runs the same file with `bun run`, and compares how the two ended.

use core::ffi::c_char;
use core::time::Duration;
use std::time::Instant;

use bun_core::{ZBox, strings, zstr};
use bun_sys::{Fd, File};

pub(crate) struct Limits {
    pub(crate) cpu_seconds: u32,
    pub(crate) wall_seconds: u32,
    pub(crate) memory_bytes: u64,
}

/// The exit code of the process that compiled and ran one program.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum Verdict {
    Same = 0,
    RefusedByTheBuild = 1,
    SameFailure = 2,
    DocumentedDifference = 3,
    PlainBunIsUnsteady = 4,
    NeitherFinished = 5,
    PlainBunCrashed = 6,
    CompiledProgramIsUnsteady = 7,
    PlainBunRefusesTheFile = 8,
}

/// An exit code above this one is a finding. The rest of it is the signal that Fuzzilli hears of.
pub(crate) const FINDING: u8 = 128;

const VERDICT_NAMES: [&str; 9] = [
    "same",
    "refused-by-the-build",
    "same-failure",
    "documented-difference",
    "plain-bun-is-unsteady",
    "neither-finished",
    "plain-bun-crashed",
    "compiled-program-is-unsteady",
    "plain-bun-refuses-the-file",
];

pub(crate) fn name_of_exit_code(code: u8) -> String {
    match VERDICT_NAMES.get(usize::from(code)) {
        Some(name) => (*name).to_owned(),
        None if code > FINDING => format!("finding-{}", code - FINDING),
        None => format!("exit-code-{code}"),
    }
}

const MAX_OUTPUT_BYTES: usize = 1 << 20;
const MAX_KEPT_OUTPUT_BYTES: usize = 64 << 10;
const MAX_INDEX_BYTES: libc::off_t = 1 << 20;
const FUZZILLI_DESCRIPTORS: core::ops::RangeInclusive<i32> = 100..=103;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum End {
    Exited(i32),
    Signaled(i32),
    HitALimit,
}

struct Run {
    end: End,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

impl Run {
    fn agrees_with(&self, other: &Run) -> bool {
        self.end == other.end && self.stdout == other.stdout
    }
}

pub(crate) struct Program<'a> {
    pub(crate) path: &'a [u8],
    pub(crate) text: &'a [u8],
    pub(crate) graph: Fd,
    pub(crate) hides_function_text: bool,
    pub(crate) limits: &'a Limits,
}

/// What a compiled program says when it does something that docs/compiler/compatibility.mdx lists.
const DOCUMENTED_MESSAGES: [&[u8]; 4] = [
    b"read-only in a compiled executable",
    b"Attempted to assign to readonly property",
    b"this executable was compiled assuming",
    b"Maximum call stack size exceeded",
];

/// What a program names when its output depends on something that docs/compiler/compatibility.mdx lists, or on the collector.
const DOCUMENTED_NAMES: [&[u8]; 12] = [
    b"eval(",
    b"Function(",
    b".caller",
    b".stack",
    b".message",
    b"WeakRef",
    b"FinalizationRegistry",
    b"import.meta",
    b"__filename",
    b"__dirname",
    b".argv",
    b".raw",
];

/// What `bun run` says when it refuses a file that the compiler builds.
const REFUSALS_OF_BUN_RUN: [&[u8]; 5] = [
    b"is a constant",
    b"Left side of assignment is not a reference",
    b"Unexpected token '...'",
    b"Unexpected private name",
    b"Ambiguous unary expression",
];

impl Program<'_> {
    /// Returns the exit code for the process that compiled this program.
    pub(crate) fn compare_with_plain_bun(&self) -> u8 {
        let compiled = self.run_compiled();
        let plain = self.run_plain();
        if compiled.agrees_with(&plain) {
            return match plain.end {
                End::Exited(0) => Verdict::Same,
                End::Exited(_) => Verdict::SameFailure,
                End::HitALimit => Verdict::NeitherFinished,
                End::Signaled(_) => {
                    self.report("bun-run-signal", &compiled, &plain);
                    Verdict::PlainBunCrashed
                }
            } as u8;
        }
        if matches!(plain.end, End::Signaled(_)) {
            self.report("bun-run-signal", &compiled, &plain);
            return Verdict::PlainBunCrashed as u8;
        }
        if plain.end == End::HitALimit {
            return Verdict::NeitherFinished as u8;
        }
        if !matches!(compiled.end, End::Signaled(_)) && self.differs_as_documented(&compiled) {
            return Verdict::DocumentedDifference as u8;
        }
        if plain.stdout.is_empty()
            && REFUSALS_OF_BUN_RUN
                .iter()
                .any(|message| strings::contains(&plain.stderr, message))
        {
            return Verdict::PlainBunRefusesTheFile as u8;
        }
        if !self.run_plain().agrees_with(&plain) {
            return Verdict::PlainBunIsUnsteady as u8;
        }
        if self.run_compiled().agrees_with(&plain) {
            self.report("unsteady", &compiled, &plain);
            return Verdict::CompiledProgramIsUnsteady as u8;
        }
        let (kind, signal) = match compiled.end {
            End::Signaled(signal) => ("signal", signal),
            End::HitALimit => ("limit", libc::SIGALRM),
            End::Exited(_) if compiled.end != plain.end => ("exit-code", libc::SIGUSR2),
            End::Exited(_) => ("stdout", libc::SIGUSR1),
        };
        self.report(kind, &compiled, &plain);
        FINDING + u8::try_from(signal).unwrap_or(0)
    }

    /// Prints how the two runs differ and keeps the program.
    fn report(&self, kind: &str, compiled: &Run, plain: &Run) {
        let (compiled_line, plain_line) = first_difference(&compiled.stdout, &plain.stdout);
        let shorten =
            |line: &[u8]| String::from_utf8_lossy(&line[..line.len().min(400)]).into_owned();
        let summary = format!(
            "compiled: {:?}\nbun run:  {:?}\ncompiled: {}\nbun run:  {}\n",
            compiled.end,
            plain.end,
            shorten(compiled_line),
            shorten(plain_line),
        );
        let stderr_tail = &compiled.stderr[compiled.stderr.len().saturating_sub(1500)..];
        let text = format!(
            "fuzzilli: the compiled program and bun run differ: {kind}\n{summary}compiled: {} bytes\nbun run:  {} bytes\nthe compiled program's stderr ends:\n{}\n",
            compiled.stdout.len(),
            plain.stdout.len(),
            String::from_utf8_lossy(stderr_tail),
        );
        let _ = bun_sys::write(Fd::stderr(), text.as_bytes());
        keep_find(
            kind,
            summary.as_bytes(),
            &[
                ("program.js", self.text),
                ("report.txt", text.as_bytes()),
                ("compiled.stdout", &compiled.stdout),
                ("compiled.stderr", &compiled.stderr),
                ("bun-run.stdout", &plain.stdout),
                ("bun-run.stderr", &plain.stderr),
            ],
        );
    }

    fn differs_as_documented(&self, compiled: &Run) -> bool {
        let says = |message: &&[u8]| {
            strings::contains(&compiled.stderr, message)
                || strings::contains(&compiled.stdout, message)
        };
        DOCUMENTED_MESSAGES.iter().any(says)
            || DOCUMENTED_NAMES
                .iter()
                .any(|name| strings::contains(self.text, name))
    }

    fn run_compiled(&self) -> Run {
        // SAFETY: takes integers.
        unsafe { libc::lseek(self.graph.native(), 0, libc::SEEK_SET) };
        let graph_flag = format!("--aot-graph-fd={}", self.graph.native());
        run(
            &[b"run", graph_flag.as_bytes(), self.path],
            &[b"BUN_JSC_useJIT="],
            None,
            Some(self.graph),
            &[self.path, b".compiled"].concat(),
            self.limits,
        )
    }

    fn run_plain(&self) -> Run {
        run(
            &[b"run", self.path],
            &[b"SHM_ID="],
            self.hides_function_text
                .then_some(&b"BUN_FUZZILLI_HIDES_FUNCTION_TEXT=1"[..]),
            None,
            &[self.path, b".plain"].concat(),
            self.limits,
        )
    }
}

fn first_difference<'a>(a: &'a [u8], b: &'a [u8]) -> (&'a [u8], &'a [u8]) {
    let mut lines = strings::split(a, b"\n").zip(strings::split(b, b"\n"));
    lines.find(|(a, b)| a != b).unwrap_or((b"", b""))
}

/// Keeps a program under `BUN_FUZZILLI_FINDS`, whatever Fuzzilli does with it. `files` starts with the program.
/// Programs with the same `kind` and `summary`, numbers aside, share a folder. It holds one program of each order of
/// size, so of a reduction it keeps the small steps.
pub(crate) fn keep_find(kind: &str, summary: &[u8], files: &[(&str, &[u8])]) {
    let Some(root) = bun_core::getenv_z(zstr!("BUN_FUZZILLI_FINDS")) else {
        return;
    };
    let mut words = summary.to_vec();
    words.retain(|byte| !byte.is_ascii_hexdigit());
    let group = format!("{kind}-{:08x}", bun_wyhash::hash(&words) & 0xffff_ffff);
    let size = files.first().map_or(0, |(_, program)| program.len());
    let name = format!("{group}/{}", size.max(1).ilog2());
    let folder = [root, b"/", name.as_bytes()].concat();

    let index = ZBox::from_bytes(&[root, b"/index.txt"].concat());
    let flags = libc::O_WRONLY | libc::O_APPEND | libc::O_CREAT | libc::O_CLOEXEC;
    let _ = bun_sys::mkdir_recursive(&[root, b"/", group.as_bytes()].concat());
    // SAFETY: the path ends with a NUL.
    let index = unsafe { libc::open(index.as_ptr(), flags, 0o644) };
    // SAFETY: takes integers.
    let is_full = unsafe { libc::lseek(index, 0, libc::SEEK_END) } > MAX_INDEX_BYTES;
    if index >= 0 && !is_full && bun_sys::mkdir(&ZBox::from_bytes(&folder), 0o755).is_ok() {
        for (position, (file_name, bytes)) in files.iter().enumerate() {
            let path = ZBox::from_bytes(&[&folder[..], b"/", file_name.as_bytes()].concat());
            let limit = if position == 0 {
                bytes.len()
            } else {
                MAX_KEPT_OUTPUT_BYTES
            };
            let _ = File::write_file(Fd::cwd(), &path, &bytes[..bytes.len().min(limit)]);
        }
        let _ = bun_sys::write(Fd::from_native(index), format!("{name}\n").as_bytes());
    }
    // SAFETY: takes an integer.
    unsafe { libc::close(index) };
}

fn open_output(path: &[u8], suffix: &[u8]) -> i32 {
    let path = ZBox::from_bytes(&[path, suffix].concat());
    let flags = libc::O_RDWR | libc::O_CREAT | libc::O_TRUNC | libc::O_CLOEXEC;
    // SAFETY: the path ends with a NUL.
    unsafe { libc::open(path.as_ptr(), flags, 0o600) }
}

fn read_output(descriptor: i32) -> Vec<u8> {
    let mut bytes = vec![0u8; MAX_OUTPUT_BYTES];
    let mut length = 0;
    while length < bytes.len() {
        let rest = &mut bytes[length..];
        let offset = libc::off_t::try_from(length).unwrap_or(0);
        // SAFETY: the kernel writes at most `rest.len()` bytes into `rest`.
        let count =
            unsafe { libc::pread(descriptor, rest.as_mut_ptr().cast(), rest.len(), offset) };
        let Ok(count @ 1..) = usize::try_from(count) else {
            break;
        };
        length += count;
    }
    bytes.truncate(length);
    // SAFETY: takes an integer.
    unsafe { libc::close(descriptor) };
    bytes
}

fn resident_bytes_of(process: libc::pid_t) -> u64 {
    let Ok(text) = File::read_from(Fd::cwd(), format!("/proc/{process}/statm").as_bytes()) else {
        return 0;
    };
    let pages = strings::split(&text, b" ")
        .nth(1)
        .and_then(|field| core::str::from_utf8(field).ok()?.parse::<u64>().ok());
    pages.unwrap_or(0) * 4096
}

fn set_limit(resource: libc::__rlimit_resource_t, soft: u64, hard: u64) {
    let limit = libc::rlimit {
        rlim_cur: soft,
        rlim_max: hard,
    };
    // SAFETY: the kernel reads one `rlimit`.
    unsafe { libc::setrlimit(resource, &raw const limit) };
}

/// Starts Bun with `arguments` and this process's environment, less the variables that start with one of `removed`.
fn run(
    arguments: &[&[u8]],
    removed: &[&[u8]],
    added: Option<&[u8]>,
    keeps_open: Option<Fd>,
    output_path: &[u8],
    limits: &Limits,
) -> Run {
    let executable = bun_core::self_exe_path().expect("Bun knows its own path");
    let mut owned_arguments = vec![ZBox::from_bytes(b"bun")];
    owned_arguments.extend(arguments.iter().map(|argument| ZBox::from_bytes(argument)));
    let mut argument_pointers: Vec<*const c_char> = owned_arguments
        .iter()
        .map(|argument| argument.as_ptr())
        .collect();
    argument_pointers.push(core::ptr::null());

    let added = added.map(ZBox::from_bytes);
    let mut environment: Vec<*const c_char> = Vec::new();
    let mut variable = bun_core::c_environ();
    // SAFETY: `environ` is an array of NUL-terminated strings that ends with a null pointer, and nothing changes it here.
    unsafe {
        while !(*variable).is_null() {
            let text = core::ffi::CStr::from_ptr(*variable).to_bytes();
            if !removed.iter().any(|prefix| text.starts_with(prefix)) {
                environment.push(*variable);
            }
            variable = variable.add(1);
        }
    }
    environment.extend(added.as_ref().map(|variable| variable.as_ptr()));
    environment.push(core::ptr::null());

    let stdout = open_output(output_path, b".stdout");
    let stderr = open_output(output_path, b".stderr");
    // SAFETY: the new process only makes system calls until it is replaced.
    let child = unsafe { libc::fork() };
    if child == 0 {
        set_limit(
            libc::RLIMIT_CPU,
            u64::from(limits.cpu_seconds),
            u64::from(limits.cpu_seconds) + 1,
        );
        set_limit(
            libc::RLIMIT_FSIZE,
            MAX_OUTPUT_BYTES as u64,
            MAX_OUTPUT_BYTES as u64,
        );
        // SAFETY: every pointer is to a NUL-terminated string or to an array of them that ends with a null pointer.
        unsafe {
            libc::setpgid(0, 0);
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
            let null = libc::open(c"/dev/null".as_ptr(), libc::O_RDONLY);
            libc::dup2(null, 0);
            libc::dup2(stdout, 1);
            libc::dup2(stderr, 2);
            for descriptor in FUZZILLI_DESCRIPTORS {
                libc::close(descriptor);
            }
            if let Some(descriptor) = keeps_open {
                let flags = libc::fcntl(descriptor.native(), libc::F_GETFD);
                libc::fcntl(
                    descriptor.native(),
                    libc::F_SETFD,
                    flags & !libc::FD_CLOEXEC,
                );
            }
            libc::execve(
                executable.as_ptr(),
                argument_pointers.as_ptr(),
                environment.as_ptr(),
            );
            libc::_exit(127);
        }
    }

    let deadline = Instant::now() + Duration::from_secs(u64::from(limits.wall_seconds));
    let mut pause = Duration::from_micros(200);
    let mut hit_a_limit = child < 0;
    let mut status = 0;
    // SAFETY: the kernel writes one integer.
    while child > 0 && unsafe { libc::waitpid(child, &raw mut status, libc::WNOHANG) } == 0 {
        std::thread::sleep(pause);
        pause = (pause * 5 / 4).min(Duration::from_millis(10));
        if !hit_a_limit
            && (Instant::now() > deadline || resident_bytes_of(child) > limits.memory_bytes)
        {
            hit_a_limit = true;
            // SAFETY: takes integers.
            unsafe { libc::kill(-child, libc::SIGKILL) };
        }
    }
    if child > 0 {
        // What the program started and left behind.
        // SAFETY: takes integers.
        unsafe { libc::kill(-child, libc::SIGKILL) };
    }
    let end = match libc::WIFSIGNALED(status) {
        _ if hit_a_limit => End::HitALimit,
        true if matches!(libc::WTERMSIG(status), libc::SIGXCPU | libc::SIGXFSZ) => End::HitALimit,
        true => End::Signaled(libc::WTERMSIG(status)),
        false => End::Exited(libc::WEXITSTATUS(status)),
    };
    Run {
        end,
        stdout: remove_details_of_errors(&read_output(stdout)),
        stderr: read_output(stderr),
    }
}

/// `console.log(error)` prints lines of the source, which an executable doesn't have, a message, whose words can differ, and a stack.
fn remove_details_of_errors(output: &[u8]) -> Vec<u8> {
    let mut kept = Vec::with_capacity(output.len());
    for line in strings::split(output, b"\n") {
        let text = line.trim_ascii_start();
        let digits = text.iter().take_while(|byte| byte.is_ascii_digit()).count();
        let is_source_line = digits > 0 && text[digits..].starts_with(b" | ");
        let is_marker =
            !text.is_empty() && text.iter().all(|byte| matches!(byte, b'^' | b'~' | b' '));
        if is_source_line || is_marker || text.starts_with(b"at ") {
            continue;
        }
        let end = strings::index_of(line, b"Error: ").map_or(line.len(), |at| at + b"Error".len());
        let mut rest = &line[..end];
        // The name of a function under a computed key.
        while let Some(at) = strings::index_of(rest, b"[Function: ") {
            kept.extend_from_slice(&rest[..at + b"[Function".len()]);
            rest = &rest[at..];
            rest =
                &rest[strings::index_of_char(rest, b']').map_or(rest.len(), |end| end as usize)..];
        }
        kept.extend_from_slice(rest);
        kept.push(b'\n');
    }
    kept
}

/// The names that a program from Fuzzilli declares outside every block. Fuzzilli indents what is inside one.
pub(crate) fn find_top_level_names(text: &[u8]) -> Vec<&[u8]> {
    const KEYWORDS: [&[u8]; 8] = [
        b"const ",
        b"let ",
        b"var ",
        b"class ",
        b"function ",
        b"function* ",
        b"async function ",
        b"async function* ",
    ];
    let name_of = |line: &'_ [u8]| -> Option<usize> {
        let keyword = KEYWORDS.iter().find(|keyword| line.starts_with(keyword))?;
        Some(keyword.len())
    };
    let mut names = Vec::new();
    for line in strings::split(text, b"\n") {
        let Some(start) = name_of(line) else { continue };
        let rest = &line[start..];
        let length = rest
            .iter()
            .position(|byte| !(byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$')))
            .unwrap_or(rest.len());
        if length > 0 && !names.contains(&&rest[..length]) {
            names.push(&rest[..length]);
        }
    }
    names
}
