#![cfg(windows)]

//! Child-process handle class — the `uv_process_t` replacement: spawn with
//! CRT-exact argument quoting, env-block construction and PATH search; exit
//! observation through a thread-pool wait posted to the loop; kill/liveness
//! probes with the Windows-specific disambiguation dance.
//!
//! Design decisions (named project outcomes, not oversights):
//!
//! - **Exit observation is decoupled from keep-alive.** The exit wait posts a
//!   completion packet whose request never counts toward `active_reqs`
//!   (`req_submitted_uncounted`, the POLL-26 pattern): a ref'd process holds
//!   the loop open through ordinary handle accounting, an unref'd one does
//!   not — but its exit callback STILL fires whenever the loop runs, because
//!   delivery rides the packet, not the ref state. libuv coupled the two,
//!   which is exactly the upstream "unref'd children never report exit" bug
//!   this class regression-tests. // quirk: PROC-45
//! - **Explicit inheritance lists.** Every spawn passes
//!   PROC_THREAD_ATTRIBUTE_HANDLE_LIST naming exactly the child's stdio
//!   duplicates (alongside the lpReserved2 CRT blob — the two compose), so
//!   concurrent spawns can no longer cross-leak each other's pipe ends. This
//!   is the fix libuv documented but never shipped on v1.x. // quirk: PROC-33
//! - **Suspend → job-assign → resume for NON-detached children.** Upstream
//!   suspends only detached children (which are never job-assigned) and
//!   leaves the assign-before-run race open for the children that ARE; the
//!   ledger's corrected pattern is implemented here. // quirk: PROC-41
//! - **Env entries are deduplicated, last-wins.** libuv keeps caller
//!   duplicates (its embedder dedupes in JS); this engine owns the contract
//!   instead so every consumer gets JS-object assignment semantics.
//!   // quirk: PROC-10
//! - **Kill failures are a typed enum**, not fake errno: the ESRCH/EINVAL/
//!   ENOSYS shapes the probes *derive* have no Win32 spelling, and inventing
//!   one would violate the raw-codes-out crate policy. // quirk: PROC-52

use core::ffi::c_void;
use core::mem;
use core::ptr;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
// std Once (not bun_threading): bun_threading pulls bun_alloc, which would
// break this crate's natively-linkable test binary (see Cargo.toml); it
// guards one cold path (global job creation).
#[allow(clippy::disallowed_types)]
use std::sync::Once;

use bun_windows_sys::kernel32::{
    DuplicateHandle, GetExitCodeProcess, GetFileType, GetStdHandle,
    SetHandleInformation,
};
use bun_windows_sys::{
    AssignProcessToJobObject, BOOL, BOOLEAN, CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW,
    CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, CSTR_EQUAL, CloseHandle, CompareStringOrdinal,
    CreateFileW, CreateJobObjectW, DETACHED_PROCESS, DUPLICATE_SAME_ACCESS, DWORD,
    DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, FALSE, FILE_ATTRIBUTE_DIRECTORY,
    FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
    FILE_TYPE_CHAR, FILE_TYPE_DISK, FILE_TYPE_PIPE, FILE_TYPE_REMOTE, FILE_TYPE_UNKNOWN,
    GetCurrentDirectoryW, GetCurrentProcess, GetEnvironmentVariableW, GetFileAttributesW,
    GetShortPathNameW, GetStartupInfoW, HANDLE, HANDLE_FLAG_INHERIT, INFINITE,
    INVALID_FILE_ATTRIBUTES, INVALID_HANDLE_VALUE, InitializeProcThreadAttributeList,
    JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation, MAX_PATH,
    NeedCurrentDirectoryForExePathW, OPEN_EXISTING, OpenProcess, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    PROCESS_INFORMATION, PROCESS_QUERY_INFORMATION, PROCESS_TERMINATE, RegisterWaitForSingleObject,
    ResumeThread, SECURITY_ATTRIBUTES, STARTF_USESHOWWINDOW, STARTF_USESTDHANDLES, STARTUPINFOEXW,
    STARTUPINFOW, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STILL_ACTIVE, SW_HIDE,
    SW_SHOWDEFAULT, SYNCHRONIZE, SetInformationJobObject, SetLastError, TRUE, TerminateProcess,
    UnregisterWait, UnregisterWaitEx, UpdateProcThreadAttribute, WAIT_OBJECT_0, WAIT_TIMEOUT, WORD,
    WT_EXECUTEINWAITTHREAD, WT_EXECUTEONLYONCE, WaitForSingleObject, Win32Error,
    kernel32::CreateProcessW,
};

use crate::event_loop::Loop;
use crate::handle::HandleCore;
use crate::req::{Req, ReqKind};
use crate::signal::NSIG;

// ── signals & flags ─────────────────────────────────────────────────────────

// The libuv-numbered signal constants consumers pass to `kill`. One table:
// the receive side (SIGHUP/SIGBREAK/SIGWINCH and the NSIG validation limit
// imported below) lives in signal.rs. // quirk: SIGEV-07
pub const SIGINT: i32 = 2;
pub const SIGQUIT: i32 = 3;
pub const SIGKILL: i32 = 9;
pub const SIGTERM: i32 = 15;

/// No console + own process group; never breaks away from a foreign job.
/// // quirk: PROC-40
pub const PROCESS_DETACHED: u32 = 1 << 0;
/// Join args with single spaces, zero escaping (cmd.exe/msiexec parsing).
/// // quirk: PROC-04
pub const PROCESS_VERBATIM_ARGUMENTS: u32 = 1 << 1;
/// Legacy combined hide: both of the two flags below. // quirk: PROC-39
pub const PROCESS_HIDE: u32 = 1 << 2;
pub const PROCESS_HIDE_CONSOLE: u32 = 1 << 3;
pub const PROCESS_HIDE_GUI: u32 = 1 << 4;
/// Try the literal extension-less name — honored only when the file spec
/// contains a directory component (upstream asymmetry kept). // quirk: PROC-17
pub const PROCESS_FILE_PATH_EXACT_NAME: u32 = 1 << 5;

// CRT lowio flag bytes for the lpReserved2 blob. // quirk: PROC-26
const FOPEN: u8 = 0x01;
const FPIPE: u8 = 0x08;
const FDEV: u8 = 0x40;

/// cbReserved2 is a WORD and libuv pins fd count to a byte-safe 255.
/// // quirk: PROC-25, PROC-59
const MAX_STDIO_COUNT: usize = 255;

const SP: u16 = b' ' as u16;
const TAB: u16 = b'\t' as u16;
const QUOTE: u16 = b'"' as u16;
const APOS: u16 = b'\'' as u16;
const BACKSLASH: u16 = b'\\' as u16;
const FWDSLASH: u16 = b'/' as u16;
const COLON: u16 = b':' as u16;
const SEMI: u16 = b';' as u16;
const EQ: u16 = b'=' as u16;
const DOT: u16 = b'.' as u16;

/// Required child env vars, sorted, injected from the parent when the caller
/// block omits them (SYSTEMROOT alone kills winsock). // quirk: PROC-08
const REQUIRED_VARS: [&[u8]; 11] = [
    b"HOMEDRIVE",
    b"HOMEPATH",
    b"LOGONSERVER",
    b"PATH",
    b"SYSTEMDRIVE",
    b"SYSTEMROOT",
    b"TEMP",
    b"USERDOMAIN",
    b"USERNAME",
    b"USERPROFILE",
    b"WINDIR",
];

static NUL_NAME: [u16; 4] = [b'N' as u16, b'U' as u16, b'L' as u16, 0];
static EMPTY_WIDE: [u16; 1] = [0];

// ── callback types ──────────────────────────────────────────────────────────

/// Exit callback: `(loop, data, exit_status, term_signal)`. `exit_status` is
/// the child's full 32-bit exit code zero-extended (NTSTATUS crash codes >
/// i32::MAX are real exit codes); negative only when `GetExitCodeProcess`
/// itself failed, carrying `-(raw Win32 code)`. `term_signal` is nonzero only
/// for kills through THIS handle's [`ProcessHandle::kill`]. // quirk: PROC-47,
/// PROC-55
pub type ProcessExitCb = unsafe fn(&mut Loop, *mut c_void, i64, i32);
/// Close callback, run from the endgame once the exit slot drained; only
/// then may the owner free the handle box.
pub type ProcessCloseCb = unsafe fn(&mut Loop, *mut c_void);

/// How [`ProcessHandle::kill`] / [`kill_pid`] fail. Typed because the
/// probe-derived POSIX shapes (ESRCH/EINVAL/ENOSYS) have no Win32 spelling;
/// `Os` carries the raw code per crate policy.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum KillError {
    /// The process already exited (consumers map to ESRCH). // quirk: PROC-52
    NotFound,
    /// Signal number outside `[0, NSIG)` (EINVAL shape). // quirk: PROC-51
    InvalidSignal,
    /// In-range signal with no Windows emulation (ENOSYS shape).
    Unsupported,
    /// Raw OS failure (consumers translate exactly once).
    Os(Win32Error),
}

/// One child stdio slot. The engine duplicates every supplied handle into a
/// transient inheritable copy (closed on all paths after CreateProcess); the
/// caller keeps ownership of the original. // quirk: PROC-33, PROC-38
#[derive(Copy, Clone, Debug)]
pub enum Stdio {
    /// fds 0-2 get an inheritable NUL device; fds > 2 stay closed.
    /// // quirk: PROC-29
    Ignore,
    /// A handle the embedder created for the child (pipe client end from
    /// `pipe::create_pair`, opened file). Invalid handles are an error.
    Raw(HANDLE),
    /// The caller's own existing fd handle (`stdio: 'inherit'`). Invalid
    /// handles on fds 0-2 are forgiven (GUI parents have no stdio); also the
    /// only shape that suppresses CREATE_NO_WINDOW. // quirk: PROC-32, PROC-39
    InheritFd(HANDLE),
}

pub struct ProcessOptions<'a> {
    /// WTF-8 program to search for (PATH + .com/.exe walk); what runs.
    pub file: &'a [u8],
    /// WTF-8 argv as the child observes it — `args[0]` is NOT replaced by
    /// the resolved path. // quirk: PROC-05
    pub args: &'a [&'a [u8]],
    /// WTF-8 `NAME=value` entries; `None` inherits the parent environment.
    pub env: Option<&'a [&'a [u8]]>,
    /// WTF-8 working directory; `None` inherits the parent's.
    pub cwd: Option<&'a [u8]>,
    /// `PROCESS_*` bits.
    pub flags: u32,
    /// Slots beyond index 2 become child fds 3.. via the CRT blob.
    pub stdio: &'a [Stdio],
    /// ConPTY: `HPCON` from `CreatePseudoConsole`. When set, `stdio` must
    /// be empty — the pseudoconsole IS the child's console and stdio; the
    /// CRT blob is skipped and std handles are NULL (terminal#15814).
    pub pseudoconsole: Option<HANDLE>,
}

// ── WTF-8 → UTF-16 ──────────────────────────────────────────────────────────

/// One generalized-UTF-8 code point (surrogates allowed — that is WTF-8);
/// `-1` = invalid. Port of libuv `uv__wtf8_decode1` with slice bounds.
/// // quirk: PROC-06
fn wtf8_decode1(src: &[u8], i: &mut usize) -> i32 {
    let b1 = src[*i];
    *i += 1;
    if b1 <= 0x7F {
        return i32::from(b1);
    }
    if b1 < 0xC2 {
        return -1; // continuation byte or overlong-2-byte lead
    }
    let mut cp = u32::from(b1);
    let Some(&b2) = src.get(*i) else { return -1 };
    *i += 1;
    if b2 & 0xC0 != 0x80 {
        return -1;
    }
    cp = (cp << 6) | u32::from(b2 & 0x3F);
    if b1 <= 0xDF {
        return (0x7FF & cp) as i32;
    }
    let Some(&b3) = src.get(*i) else { return -1 };
    *i += 1;
    if b3 & 0xC0 != 0x80 {
        return -1;
    }
    cp = (cp << 6) | u32::from(b3 & 0x3F);
    if b1 <= 0xEF {
        return (0xFFFF & cp) as i32;
    }
    let Some(&b4) = src.get(*i) else { return -1 };
    *i += 1;
    if b4 & 0xC0 != 0x80 {
        return -1;
    }
    cp = (cp << 6) | u32::from(b4 & 0x3F);
    if b1 <= 0xF4 {
        cp &= 0x1F_FFFF;
        if cp <= 0x10_FFFF {
            return cp as i32;
        }
    }
    -1
}

/// Appends `src` (WTF-8 — lone surrogates round-trip) to `out` as UTF-16.
/// Invalid encoding and embedded NULs (which would truncate the
/// NUL-delimited structures handed to CreateProcessW) are INVALID_PARAMETER,
/// the raw shape of libuv's UV_EINVAL here. // quirk: PROC-06
fn wtf8_to_utf16(src: &[u8], out: &mut Vec<u16>) -> Result<(), Win32Error> {
    if src.contains(&0) {
        return Err(Win32Error::INVALID_PARAMETER);
    }
    let mut i = 0;
    while i < src.len() {
        let cp = wtf8_decode1(src, &mut i);
        if cp < 0 {
            return Err(Win32Error::INVALID_PARAMETER);
        }
        if cp > 0xFFFF {
            out.push((((cp - 0x10000) >> 10) + 0xD800) as u16);
            out.push((((cp - 0x10000) & 0x3FF) + 0xDC00) as u16);
        } else {
            out.push(cp as u16);
        }
    }
    Ok(())
}

fn ascii_to_utf16(s: &[u8]) -> Vec<u16> {
    s.iter().map(|&b| u16::from(b)).collect()
}

// ── argument quoting ────────────────────────────────────────────────────────

/// MS CRT reverse-construction quoting: append the quoted form of `src` to
/// `dst`. Backslashes are doubled only in the shadow of a quote (including
/// the closing quote), which the backwards walk with `quote_hit` makes
/// linear. Expected I/O table (process.c:480-496):
/// `hello"world` → `"hello\"world"`, `hello\world` → `hello\world`,
/// `hello\"world` → `"hello\\\"world"`, `hello world\` → `"hello world\\"`.
/// // quirk: PROC-01
fn quote_cmd_arg(src: &[u16], dst: &mut Vec<u16>) {
    if src.is_empty() {
        // A bare empty arg vanishes and shifts the child's argv.
        // // quirk: PROC-02
        dst.push(QUOTE);
        dst.push(QUOTE);
        return;
    }
    // Quote only when needed — space/tab/quote is the FULL trigger set
    // (`&|^` matter to cmd.exe, not to argv parsing); unnecessary quotes
    // confuse older programs. // quirk: PROC-03
    if !src.iter().any(|&c| c == SP || c == TAB || c == QUOTE) {
        dst.extend_from_slice(src);
        return;
    }
    if !src.iter().any(|&c| c == QUOTE || c == BACKSLASH) {
        dst.push(QUOTE);
        dst.extend_from_slice(src);
        dst.push(QUOTE);
        return;
    }
    dst.push(QUOTE);
    let start = dst.len();
    let mut quote_hit = true;
    for &c in src.iter().rev() {
        dst.push(c);
        if quote_hit && c == BACKSLASH {
            dst.push(BACKSLASH);
        } else if c == QUOTE {
            quote_hit = true;
            dst.push(BACKSLASH);
        } else {
            quote_hit = false;
        }
    }
    dst[start..].reverse();
    dst.push(QUOTE);
}

/// The full lpCommandLine (NUL-terminated, mutable — CreateProcessW may
/// scribble on it). Verbatim mode joins raw with single spaces.
/// // quirk: PROC-04
fn make_command_line(args: &[&[u8]], verbatim: bool) -> Result<Vec<u16>, Win32Error> {
    let mut out = Vec::new();
    let mut tmp = Vec::new();
    for (i, arg) in args.iter().enumerate() {
        if i > 0 {
            out.push(SP);
        }
        tmp.clear();
        wtf8_to_utf16(arg, &mut tmp)?;
        if verbatim {
            out.extend_from_slice(&tmp);
        } else {
            quote_cmd_arg(&tmp, &mut out);
        }
    }
    out.push(0);
    Ok(out)
}

// ── environment block ───────────────────────────────────────────────────────

/// Name span: up to the first `=` — `SYSTEM`, `SYSTEMROOT`, `SYSTEMROOTED`
/// are three distinct variables. // quirk: PROC-11
fn env_name_len(e: &[u16]) -> usize {
    e.iter().position(|&c| c == EQ).unwrap_or(e.len())
}

/// CompareStringOrdinal with ignore-case — the OS's ordinal-uppercase table
/// is the sort contract; never a CRT/locale or Rust casefold. // quirk: PROC-10
fn ordinal_ci_cmp(a: &[u16], b: &[u16]) -> core::cmp::Ordering {
    // SAFETY: both slices are live with exact lengths; no NUL termination
    // is required by the explicit-length form.
    let r = unsafe {
        CompareStringOrdinal(
            a.as_ptr(),
            a.len() as core::ffi::c_int,
            b.as_ptr(),
            b.len() as core::ffi::c_int,
            TRUE,
        )
    };
    debug_assert!(r != 0, "CompareStringOrdinal failed");
    r.cmp(&CSTR_EQUAL)
}

/// Fetch an env var (name WITHOUT NUL) into owned memory, looping while a
/// concurrent writer races the size probe; gives up (treated as absent)
/// rather than aborting like upstream. // quirk: PROC-63, PROC-13
fn get_env_var(name: &[u16]) -> Option<Vec<u16>> {
    let mut name_z = name.to_vec();
    name_z.push(0);
    // SAFETY: name_z is NUL-terminated; null buffer + 0 size is the
    // documented probe form.
    let mut size = unsafe { GetEnvironmentVariableW(name_z.as_ptr(), ptr::null_mut(), 0) };
    for _ in 0..8 {
        if size == 0 {
            return None; // absent (PROC-09: skip silently)
        }
        let mut buf = vec![0u16; size as usize];
        // SAFETY: buf is sized to `size`; name_z NUL-terminated.
        let r = unsafe { GetEnvironmentVariableW(name_z.as_ptr(), buf.as_mut_ptr(), size) };
        if r == 0 {
            return None;
        }
        if r < size {
            buf.truncate(r as usize);
            return Some(buf);
        }
        size = r; // grew concurrently — re-fetch with the new size
    }
    None
}

/// Build the CreateProcessW environment block: UTF-16 entries, sorted
/// case-insensitively by name, deduplicated last-wins, required vars merged
/// in from the parent, double-NUL terminated. // quirk: PROC-07, PROC-08,
/// PROC-10, PROC-12
fn make_env_block(entries: &[&[u8]]) -> Result<Vec<u16>, Win32Error> {
    make_env_block_with(entries, get_env_var)
}

/// `fetch` is the parent-environment lookup, injectable so the merge logic
/// (including the absent-from-parent skip) is testable hermetically.
fn make_env_block_with(
    entries: &[&[u8]],
    fetch: impl Fn(&[u16]) -> Option<Vec<u16>>,
) -> Result<Vec<u16>, Win32Error> {
    // Entries without '=' are dropped; a leading-'=' hidden entry (=C:=...)
    // has the '=' at position 0 and is KEPT. // quirk: PROC-12
    let mut converted: Vec<Vec<u16>> = Vec::with_capacity(entries.len());
    for e in entries {
        if !e.contains(&b'=') {
            continue;
        }
        let mut u = Vec::new();
        wtf8_to_utf16(e, &mut u)?;
        converted.push(u);
    }

    // Stable sort by name: hidden entries (name length 0) order first, and
    // equal names keep caller order so dedup below is last-wins.
    // // quirk: PROC-10
    converted.sort_by(|a, b| ordinal_ci_cmp(&a[..env_name_len(a)], &b[..env_name_len(b)]));
    let mut deduped: Vec<Vec<u16>> = Vec::with_capacity(converted.len());
    for e in converted {
        let nl = env_name_len(&e);
        let replaces = nl != 0
            && deduped.last().is_some_and(|p| {
                let pl = env_name_len(p);
                pl != 0 && ordinal_ci_cmp(&p[..pl], &e[..nl]) == core::cmp::Ordering::Equal
            });
        if replaces {
            *deduped.last_mut().expect("guarded by replaces") = e;
        } else {
            deduped.push(e); // hidden entries never dedup (=C: vs =D:)
        }
    }

    // Sorted merge with the required-var table; each missing var is fetched
    // ONCE into owned memory (no probe-vs-fill TOCTOU). // quirk: PROC-08,
    // PROC-13
    let required: Vec<Vec<u16>> = REQUIRED_VARS.iter().map(|n| ascii_to_utf16(n)).collect();
    let mut out: Vec<u16> = Vec::new();
    let mut di = 0;
    let mut ri = 0;
    while di < deduped.len() || ri < required.len() {
        let cmp = if ri >= required.len() {
            core::cmp::Ordering::Greater
        } else if di >= deduped.len() {
            core::cmp::Ordering::Less
        } else {
            let e = &deduped[di];
            ordinal_ci_cmp(&required[ri], &e[..env_name_len(e)])
        };
        match cmp {
            core::cmp::Ordering::Less => {
                // Required var the caller omitted: copy from the parent, or
                // skip silently when the parent lacks it too (service
                // sessions have no LOGONSERVER). // quirk: PROC-09
                if let Some(val) = fetch(&required[ri]) {
                    out.extend_from_slice(&required[ri]);
                    out.push(EQ);
                    out.extend_from_slice(&val);
                    out.push(0);
                }
                ri += 1;
            }
            core::cmp::Ordering::Equal => {
                out.extend_from_slice(&deduped[di]);
                out.push(0);
                di += 1;
                ri += 1;
            }
            core::cmp::Ordering::Greater => {
                out.extend_from_slice(&deduped[di]);
                out.push(0);
                di += 1;
            }
        }
    }
    // Trailing block terminator; an empty set yields the accepted
    // single-NUL block. // quirk: PROC-07
    out.push(0);
    Ok(out)
}

/// PATH from the CHILD's built block (execvp semantics), matched
/// case-insensitively — real machines spell it `Path`. // quirk: PROC-14
fn find_path_in_block(block: &[u16]) -> Option<Vec<u16>> {
    let mut i = 0;
    while i < block.len() && block[i] != 0 {
        let len = block[i..]
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(block.len() - i);
        let e = &block[i..i + len];
        if e.len() >= 5
            && e[4] == EQ
            && ascii_lower(e[0]) == u16::from(b'p')
            && ascii_lower(e[1]) == u16::from(b'a')
            && ascii_lower(e[2]) == u16::from(b't')
            && ascii_lower(e[3]) == u16::from(b'h')
        {
            return Some(e[5..].to_vec());
        }
        i += len + 1;
    }
    None
}

// ── executable search ───────────────────────────────────────────────────────

fn is_sep(c: u16) -> bool {
    c == BACKSLASH || c == FWDSLASH
}

fn is_sep_or_colon(c: u16) -> bool {
    is_sep(c) || c == COLON
}

fn ascii_lower(c: u16) -> u16 {
    if (b'A' as u16..=b'Z' as u16).contains(&c) {
        c + 0x20
    } else {
        c
    }
}

/// Join a PATH/dir entry with cwd + name + appended extension, classifying
/// the entry into the five Windows path shapes first. Pure (no probe);
/// returns a NUL-terminated buffer. // quirk: PROC-21
fn join_candidate(dir: &[u16], name: &[u16], ext: &[u16], cwd: &[u16]) -> Vec<u16> {
    let mut cwd_part: &[u16] = cwd;
    let mut dir_part: &[u16] = dir;
    if dir.len() > 2 && is_sep(dir[0]) && is_sep(dir[1]) {
        cwd_part = &[]; // UNC — ignore cwd (slashes interchangeable)
    } else if !dir.is_empty() && is_sep(dir[0]) {
        cwd_part = &cwd[..cwd.len().min(2)]; // rooted: keep the drive prefix
    } else if dir.len() >= 2 && dir[1] == COLON && (dir.len() < 3 || !is_sep(dir[2])) {
        // Drive-RELATIVE (`D:x`): same drive as cwd → substitute the full
        // cwd; another drive → use the entry as-is.
        if cwd.len() < 2 || ascii_lower(cwd[0]) != ascii_lower(dir[0]) || cwd[1] != COLON {
            cwd_part = &[];
        } else {
            dir_part = &dir[2..];
        }
    } else if dir.len() > 2 && dir[1] == COLON {
        cwd_part = &[]; // drive-absolute
    }

    let mut out = Vec::with_capacity(cwd_part.len() + dir_part.len() + name.len() + ext.len() + 4);
    out.extend_from_slice(cwd_part);
    if !cwd_part.is_empty() && !out.last().is_some_and(|&c| is_sep_or_colon(c)) {
        out.push(BACKSLASH);
    }
    out.extend_from_slice(dir_part);
    if !dir_part.is_empty() && !out.last().is_some_and(|&c| is_sep_or_colon(c)) {
        out.push(BACKSLASH);
    }
    out.extend_from_slice(name);
    if !ext.is_empty() {
        // A name already ending in '.' gets no second dot. // quirk: PROC-16
        if !name.is_empty() && out.last() != Some(&DOT) {
            out.push(DOT);
        }
        out.extend_from_slice(ext);
    }
    out.push(0);
    out
}

/// Existence gate: attributes valid, not a directory; reparse points pass
/// (symlinked binaries), no execute-bit concept. // quirk: PROC-23
fn probe_executable(path_z: &[u16]) -> bool {
    debug_assert_eq!(path_z.last(), Some(&0));
    // SAFETY: NUL-terminated by construction (join_candidate).
    let attrs = unsafe { GetFileAttributesW(path_z.as_ptr()) };
    attrs != INVALID_FILE_ATTRIBUTES && attrs & FILE_ATTRIBUTE_DIRECTORY == 0
}

/// Extension walk: literal (when allowed), then `.com`, then `.exe` —
/// APPENDED, never substituted; first existing match wins and the search
/// never resumes after a CreateProcess failure. // quirk: PROC-16, PROC-23
fn path_search_walk_ext(
    dir: &[u16],
    name: &[u16],
    cwd: &[u16],
    try_exact: bool,
) -> Option<Vec<u16>> {
    const COM: [u16; 3] = [b'c' as u16, b'o' as u16, b'm' as u16];
    const EXE: [u16; 3] = [b'e' as u16, b'x' as u16, b'e' as u16];
    if try_exact {
        let c = join_candidate(dir, name, &[], cwd);
        if probe_executable(&c) {
            return Some(c);
        }
    }
    for ext in [&COM, &EXE] {
        let c = join_candidate(dir, name, ext, cwd);
        if probe_executable(&c) {
            return Some(c);
        }
    }
    None
}

/// msvcrt `_spawnvp`-equivalent executable search. `path` is the child's
/// PATH (already absent when unset — the search still works). Returns the
/// NUL-terminated absolute candidate. // quirk: PROC-15, PROC-16
fn search_path(file: &[u16], cwd: &[u16], path: Option<&[u16]>, flags: u32) -> Option<Vec<u16>> {
    // Empty / "." would resolve to `<dir>\.exe` — a plantable hidden file;
    // ".." rejected for the same reason (Bun extension). // quirk: PROC-22
    if file.is_empty() || file.len() <= 2 && file.iter().all(|&c| c == DOT) {
        return None;
    }
    let name_start = file
        .iter()
        .rposition(|&c| is_sep(c) || c == COLON)
        .map_or(0, |p| p + 1);
    let (dir, name) = file.split_at(name_start);
    let dot = name.iter().position(|&c| c == DOT);
    let name_has_ext = dot.is_some_and(|d| d + 1 < name.len());

    if !dir.is_empty() {
        // EXACT_NAME is honored only here, with a dir component — bare-name
        // PATH lookups keep the 15-year precedence. // quirk: PROC-17
        let exact = name_has_ext || flags & PROCESS_FILE_PATH_EXACT_NAME != 0;
        return path_search_walk_ext(dir, name, cwd, exact);
    }

    // cwd before PATH only when NoDefaultCurrentDirectoryInExePath says so.
    // // quirk: PROC-18
    // SAFETY: static NUL-terminated empty name (the documented probe form).
    if unsafe { NeedCurrentDirectoryForExePathW(EMPTY_WIDE.as_ptr()) } != 0 {
        if let Some(r) = path_search_walk_ext(&[], name, cwd, name_has_ext) {
            return Some(r);
        }
    }

    let p = path?;
    let mut dir_end = 0usize;
    loop {
        if dir_end >= p.len() {
            return None;
        }
        // Advance past the separator — except at the very start unless the
        // first char IS one (the historical infinite-loop fix).
        // // quirk: PROC-20
        if dir_end != 0 || p[0] == SEMI {
            dir_end += 1;
        }
        let dir_start = dir_end;
        let mut scan = dir_end;
        // Quoted entries (either quote char) protect embedded semicolons;
        // an unterminated quote runs to end-of-string. // quirk: PROC-19
        if scan < p.len() && (p[scan] == QUOTE || p[scan] == APOS) {
            let q = p[scan];
            scan = p[scan + 1..]
                .iter()
                .position(|&c| c == q)
                .map_or(p.len(), |k| scan + 1 + k);
        }
        dir_end = p[scan.min(p.len())..]
            .iter()
            .position(|&c| c == SEMI)
            .map_or(p.len(), |k| scan + k);
        if dir_end == dir_start {
            continue; // zero-length slice (doubled `;;`) // quirk: PROC-20
        }
        let mut s = dir_start;
        let mut e = dir_end;
        if p[s] == QUOTE || p[s] == APOS {
            s += 1;
        }
        if e > s && (p[e - 1] == QUOTE || p[e - 1] == APOS) {
            e -= 1;
        }
        if let Some(r) = path_search_walk_ext(&p[s..e], name, cwd, name_has_ext) {
            return Some(r);
        }
    }
}

// ── cwd resolution ──────────────────────────────────────────────────────────

/// Probe-then-fill with growth re-check. // quirk: PROC-63
fn current_directory() -> Result<Vec<u16>, Win32Error> {
    // SAFETY: documented probe form (0, NULL).
    let mut size = unsafe { GetCurrentDirectoryW(0, ptr::null_mut()) };
    for _ in 0..8 {
        if size == 0 {
            return Err(Win32Error::get());
        }
        let mut buf = vec![0u16; size as usize];
        // SAFETY: buf is sized to `size`.
        let r = unsafe { GetCurrentDirectoryW(size, buf.as_mut_ptr()) };
        if r == 0 {
            return Err(Win32Error::get());
        }
        if r < size {
            buf.truncate(r as usize);
            return Ok(buf);
        }
        size = r + 1;
    }
    Err(Win32Error::INSUFFICIENT_BUFFER)
}

/// 8.3 short form of `long` (no trailing NUL in/out). Fails when the volume
/// has 8.3 generation disabled — no fallback exists; `\\?\` is rejected by
/// CreateProcessW's lpCurrentDirectory. // quirk: PROC-24
fn short_path_name(long: &[u16]) -> Result<Vec<u16>, Win32Error> {
    let mut long_z = long.to_vec();
    long_z.push(0);
    // SAFETY: long_z NUL-terminated; probe form (NULL, 0).
    let mut size = unsafe { GetShortPathNameW(long_z.as_ptr(), ptr::null_mut(), 0) };
    for _ in 0..8 {
        if size == 0 {
            return Err(Win32Error::get());
        }
        let mut buf = vec![0u16; size as usize];
        // SAFETY: buf is sized to `size`.
        let r = unsafe { GetShortPathNameW(long_z.as_ptr(), buf.as_mut_ptr(), size) };
        if r == 0 {
            return Err(Win32Error::get());
        }
        if r < size {
            buf.truncate(r as usize);
            return Ok(buf);
        }
        size = r;
    }
    Err(Win32Error::INSUFFICIENT_BUFFER)
}

fn resolve_cwd(opt: Option<&[u8]>) -> Result<Vec<u16>, Win32Error> {
    let mut cwd = match opt {
        Some(b) => {
            let mut v = Vec::new();
            wtf8_to_utf16(b, &mut v)?;
            v
        }
        None => current_directory()?,
    };
    // lpCurrentDirectory is capped at MAX_PATH even for longPathAware
    // processes; 8.3-shorten or fail. // quirk: PROC-24
    if cwd.len() >= MAX_PATH {
        cwd = short_path_name(&cwd)?;
    }
    Ok(cwd)
}

// ── child stdio (lpReserved2 CRT blob) ──────────────────────────────────────

/// The CRT fd blob: `int count; uint8 crt_flags[count]; HANDLE handles[count]`
/// — the handle array is misaligned by layout, so all access is byte copies.
/// Owns the inheritable duplicates; Drop closes them on EVERY exit path,
/// success included. // quirk: PROC-25, PROC-27, PROC-38
struct ChildStdio {
    blob: Vec<u8>,
    count: usize,
}

impl ChildStdio {
    fn new(count: usize) -> ChildStdio {
        let size = 4 + count + count * size_of::<HANDLE>();
        let mut blob = vec![0u8; size];
        blob[..4].copy_from_slice(&(count as u32).to_ne_bytes());
        // 0xFF-fill the handle slots: INVALID_HANDLE_VALUE is all-FF bytes.
        // // quirk: PROC-27
        for b in &mut blob[4 + count..] {
            *b = 0xFF;
        }
        ChildStdio { blob, count }
    }

    fn handle_off(&self, i: usize) -> usize {
        4 + self.count + i * size_of::<HANDLE>()
    }

    fn set(&mut self, i: usize, handle: HANDLE, crt: u8) {
        debug_assert!(i < self.count);
        self.blob[4 + i] = crt;
        let off = self.handle_off(i);
        self.blob[off..off + size_of::<usize>()]
            .copy_from_slice(&handle.expose_provenance().to_ne_bytes());
    }

    fn handle(&self, i: usize) -> HANDLE {
        let off = self.handle_off(i);
        let mut bytes = [0u8; size_of::<usize>()];
        bytes.copy_from_slice(&self.blob[off..off + size_of::<usize>()]);
        ptr::with_exposed_provenance_mut(usize::from_ne_bytes(bytes))
    }

    fn size(&self) -> WORD {
        debug_assert!(self.blob.len() <= WORD::MAX as usize);
        self.blob.len() as WORD
    }

    /// The unique live handles for PROC_THREAD_ATTRIBUTE_HANDLE_LIST — the
    /// list must name every handle the child needs and nothing else.
    /// // quirk: PROC-33
    fn inheritable_handles(&self) -> Vec<HANDLE> {
        let mut out: Vec<HANDLE> = Vec::with_capacity(self.count);
        for i in 0..self.count {
            let h = self.handle(i);
            if h != INVALID_HANDLE_VALUE && !out.contains(&h) {
                out.push(h);
            }
        }
        out
    }
}

impl Drop for ChildStdio {
    fn drop(&mut self) {
        for i in 0..self.count {
            let h = self.handle(i);
            if h != INVALID_HANDLE_VALUE {
                // SAFETY: every non-INVALID slot is an owned duplicate or
                // NUL handle created by build_child_stdio. // quirk: PROC-38
                unsafe { CloseHandle(h) };
            }
        }
    }
}

/// Inheritable duplicate, filtering the values DuplicateHandle would
/// "successfully" duplicate into poison: NULL, INVALID, and the CRT's
/// `(HANDLE)-2` no-console sentinel. // quirk: PROC-30
fn duplicate_inheritable(handle: HANDLE) -> Result<HANDLE, Win32Error> {
    let a = handle.addr();
    if a == 0 || a == usize::MAX || a == usize::MAX - 1 {
        return Err(Win32Error::INVALID_HANDLE);
    }
    let mut dup: HANDLE = ptr::null_mut();
    // SAFETY: pseudo process handles; valid out-pointer; the source handle
    // is the caller's contract.
    let ok = unsafe {
        DuplicateHandle(
            GetCurrentProcess(),
            handle,
            GetCurrentProcess(),
            &raw mut dup,
            0,
            TRUE,
            DUPLICATE_SAME_ACCESS,
        )
    };
    if ok == 0 {
        return Err(Win32Error::get());
    }
    Ok(dup)
}

/// CRT flag byte from the handle's kind. GetFileType has an in-band error
/// code: UNKNOWN + a clean last-error is a legitimately unknown device.
/// // quirk: PROC-26
fn crt_flags_for(handle: HANDLE) -> Result<u8, Win32Error> {
    // GetFileType only SETS the last error on failure — clear it first so a
    // stale code can't fail a healthy UNKNOWN classification.
    SetLastError(0);
    match GetFileType(handle) {
        FILE_TYPE_DISK => Ok(FOPEN),
        FILE_TYPE_PIPE => Ok(FOPEN | FPIPE),
        FILE_TYPE_CHAR | FILE_TYPE_REMOTE => Ok(FOPEN | FDEV),
        FILE_TYPE_UNKNOWN => {
            let e = Win32Error::get();
            if e == Win32Error::SUCCESS {
                Ok(FOPEN | FDEV)
            } else {
                Err(e)
            }
        }
        // GetFileType returns no other values; treat as the UNKNOWN+error arm.
        _ => Err(Win32Error::INVALID_PARAMETER),
    }
}

/// Inheritable NUL device with the exact asymmetric masks: read for fd 0,
/// write + READ_ATTRIBUTES for fd 1/2 (children probe their own stdout).
/// // quirk: PROC-29
fn create_nul_handle(access: DWORD) -> Result<HANDLE, Win32Error> {
    let mut sa = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as DWORD,
        lpSecurityDescriptor: ptr::null_mut(),
        bInheritHandle: TRUE, // inheritable at creation, never a two-step
    };
    // SAFETY: static NUL-terminated name; sa is a valid local.
    let h = unsafe {
        CreateFileW(
            NUL_NAME.as_ptr(),
            access,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &raw mut sa,
            OPEN_EXISTING,
            0,
            ptr::null_mut(),
        )
    };
    if h == INVALID_HANDLE_VALUE {
        return Err(Win32Error::get());
    }
    Ok(h)
}

fn build_child_stdio(stdio: &[Stdio]) -> Result<ChildStdio, Win32Error> {
    if stdio.len() > MAX_STDIO_COUNT {
        return Err(Win32Error::NOT_SUPPORTED); // quirk: PROC-25, PROC-59
    }
    let count = stdio.len().max(3); // quirk: PROC-29
    let mut cs = ChildStdio::new(count);
    for i in 0..count {
        let spec = stdio.get(i).copied().unwrap_or(Stdio::Ignore);
        match spec {
            Stdio::Ignore => {
                if i <= 2 {
                    let access = if i == 0 {
                        FILE_GENERIC_READ
                    } else {
                        FILE_GENERIC_WRITE | FILE_READ_ATTRIBUTES
                    };
                    let nul = create_nul_handle(access)?;
                    cs.set(i, nul, FOPEN | FDEV);
                }
            }
            Stdio::Raw(h) => {
                let dup = duplicate_inheritable(h)?;
                match crt_flags_for(dup) {
                    Ok(crt) => cs.set(i, dup, crt),
                    Err(e) => {
                        // SAFETY: dup created above, not yet in the blob.
                        unsafe { CloseHandle(dup) };
                        return Err(e);
                    }
                }
            }
            Stdio::InheritFd(h) => {
                let dup = match duplicate_inheritable(h) {
                    Ok(d) => d,
                    // GUI parents legitimately have no stdio 0-2; the slot
                    // stays closed instead of failing the spawn.
                    // // quirk: PROC-32
                    Err(Win32Error::INVALID_HANDLE) if i <= 2 => continue,
                    Err(e) => return Err(e),
                };
                match crt_flags_for(dup) {
                    Ok(crt) => cs.set(i, dup, crt),
                    Err(e) => {
                        // SAFETY: dup created above, not yet in the blob.
                        unsafe { CloseHandle(dup) };
                        return Err(e);
                    }
                }
            }
        }
    }
    Ok(cs)
}

// ── proc-thread attribute list ──────────────────────────────────────────────

/// RAII PROC_THREAD_ATTRIBUTE_HANDLE_LIST wrapper. usize-backed for pointer
/// alignment; deleted on drop after CreateProcessW. // quirk: PROC-33
struct AttrList {
    buf: Vec<usize>,
}

impl AttrList {
    fn new(count: u32) -> Result<AttrList, Win32Error> {
        let mut size = 0usize;
        // SAFETY: documented sizing call — null list, out-size pointer; it
        // "fails" with INSUFFICIENT_BUFFER and writes the needed size.
        unsafe { InitializeProcThreadAttributeList(ptr::null_mut(), count, 0, &raw mut size) };
        if size == 0 {
            return Err(Win32Error::get());
        }
        let mut buf = vec![0usize; size.div_ceil(size_of::<usize>())];
        // SAFETY: buf is sized and aligned for the attribute list.
        let ok = unsafe {
            InitializeProcThreadAttributeList(
                buf.as_mut_ptr().cast::<u8>(),
                count,
                0,
                &raw mut size,
            )
        };
        if ok == 0 {
            return Err(Win32Error::get());
        }
        Ok(AttrList { buf })
    }

    /// ConPTY idiom: the HPCON itself is `lpValue` (not a pointer to it) —
    /// byte-for-byte the contract in vendor libuv process.c / MS docs.
    fn set_pseudoconsole(&mut self, hpcon: HANDLE) -> Result<(), Win32Error> {
        // SAFETY: list initialized in new(); attribute fits the sized list.
        let ok = unsafe {
            UpdateProcThreadAttribute(
                self.as_mut_ptr(),
                0,
                bun_windows_sys::PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                hpcon,
                size_of::<HANDLE>(),
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(Win32Error::get());
        }
        Ok(())
    }

    fn as_mut_ptr(&mut self) -> *mut u8 {
        self.buf.as_mut_ptr().cast::<u8>()
    }

    /// `handles` must stay alive until the list is dropped (the kernel reads
    /// the buffer at CreateProcessW time).
    fn set_handle_list(&mut self, handles: &[HANDLE]) -> Result<(), Win32Error> {
        debug_assert!(!handles.is_empty());
        // SAFETY: initialized list; value buffer outlives the list per the
        // method contract.
        let ok = unsafe {
            UpdateProcThreadAttribute(
                self.as_mut_ptr(),
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                handles.as_ptr().cast::<c_void>(),
                size_of_val(handles),
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(Win32Error::get());
        }
        Ok(())
    }
}

impl Drop for AttrList {
    fn drop(&mut self) {
        // SAFETY: initialized in new(); deleted exactly once.
        unsafe { DeleteProcThreadAttributeList(self.as_mut_ptr()) };
    }
}

// ── creation flags ──────────────────────────────────────────────────────────

/// Pure flag computation. CREATE_NO_WINDOW only when no stdio slot inherits
/// a parent fd (an inherited fd implies the child may need the parent
/// console); SW_HIDE is the independent GUI axis. Non-detached children are
/// CREATE_SUSPENDED for the job-assign window. // quirk: PROC-39, PROC-40,
/// PROC-41
fn creation_flags(flags: u32, any_inherit_fd: bool) -> (DWORD, WORD) {
    let mut pf: DWORD = CREATE_UNICODE_ENVIRONMENT; // quirk: PROC-07
    if flags & (PROCESS_HIDE | PROCESS_HIDE_CONSOLE) != 0 && !any_inherit_fd {
        pf |= CREATE_NO_WINDOW;
    }
    let show: WORD = if flags & (PROCESS_HIDE | PROCESS_HIDE_GUI) != 0 {
        SW_HIDE
    } else {
        SW_SHOWDEFAULT
    };
    if flags & PROCESS_DETACHED != 0 {
        // Deliberately NOT CREATE_BREAKAWAY_FROM_JOB: that fails the entire
        // spawn under foreign no-breakaway job control. // quirk: PROC-40
        pf |= DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
    } else {
        pf |= CREATE_SUSPENDED; // quirk: PROC-41
    }
    (pf, show)
}

// ── global kill-on-close job ────────────────────────────────────────────────

static JOB_ONCE: Once = Once::new();
static JOB_HANDLE: AtomicUsize = AtomicUsize::new(0);

/// The process-wide kill-on-close job: members die when the parent does.
/// Created once; the handle deliberately leaks (closing it would kill every
/// child). Null when creation failed (degraded: no kill-tree). The current
/// process self-assigns immediately so the first-use-binds-a-Store-app
/// kernel bug can't poison the handle. // quirk: PROC-42, PROC-44
pub(crate) fn global_job() -> HANDLE {
    JOB_ONCE.call_once(|| {
        // SAFETY: null attributes (non-inheritable) and anonymous name.
        let job = unsafe { CreateJobObjectW(ptr::null_mut(), ptr::null()) };
        if job.is_null() {
            return;
        }
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
            BasicLimitInformation: bun_windows_sys::JOBOBJECT_BASIC_LIMIT_INFORMATION {
                PerProcessUserTimeLimit: 0,
                PerJobUserTimeLimit: 0,
                // SILENT_BREAKAWAY: only explicitly-assigned processes are
                // members, so grandchildren keep their own job freedom;
                // DIE_ON_UNHANDLED_EXCEPTION suppresses WER modals.
                // // quirk: PROC-42
                LimitFlags: JOB_OBJECT_LIMIT_BREAKAWAY_OK
                    | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK
                    | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
                    | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                MinimumWorkingSetSize: 0,
                MaximumWorkingSetSize: 0,
                ActiveProcessLimit: 0,
                Affinity: 0,
                PriorityClass: 0,
                SchedulingClass: 0,
            },
            IoInfo: bun_windows_sys::IO_COUNTERS::default(),
            ProcessMemoryLimit: 0,
            JobMemoryLimit: 0,
            PeakProcessMemoryUsed: 0,
            PeakJobMemoryUsed: 0,
        };
        // SAFETY: job is a fresh handle; info is a valid local of the
        // documented size for this class.
        let ok = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&raw mut info).cast::<c_void>(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as DWORD,
            )
        };
        if ok == 0 {
            // A job without KILL_ON_JOB_CLOSE is no kill-tree at all and a
            // job without DIE_ON_UNHANDLED_EXCEPTION re-enables WER modals
            // for members — degrade to no job rather than a broken one.
            // SAFETY: job created above, never published.
            unsafe { CloseHandle(job) };
            return;
        }
        // Self-assign so the FIRST AssignProcessToJobObject never targets a
        // Windows-Store process (kernel handle-poisoning bug); failure is
        // tolerable (already inside a non-nestable foreign job).
        // // quirk: PROC-44
        // SAFETY: fresh job + pseudo self handle.
        unsafe { AssignProcessToJobObject(job, GetCurrentProcess()) };
        JOB_HANDLE.store(job.expose_provenance(), Ordering::Release);
    });
    let bits = JOB_HANDLE.load(Ordering::Acquire);
    if bits == 0 {
        ptr::null_mut()
    } else {
        ptr::with_exposed_provenance_mut(bits)
    }
}

// ── inherited-blob hygiene ──────────────────────────────────────────────────

/// Treat an inbound lpReserved2 as hostile: verify shape before walking.
/// // quirk: PROC-35
fn stdio_verify(buffer: *const u8, size: WORD) -> bool {
    if buffer.is_null() {
        return false;
    }
    let size = size as usize;
    if size < 4 {
        return false;
    }
    let mut count_bytes = [0u8; 4];
    // SAFETY: size >= 4 verified; the caller's pointer covers `size` bytes.
    unsafe { ptr::copy_nonoverlapping(buffer, count_bytes.as_mut_ptr(), 4) };
    let count = u32::from_ne_bytes(count_bytes) as usize;
    if count > 256 {
        return false;
    }
    size >= 4 + count + count * size_of::<HANDLE>()
}

/// Best-effort de-inheriting of the std handles and CRT-blob handles WE
/// inherited, so a leaky parent's handles don't cascade into our children.
/// Errors deliberately ignored — the handles may be closed or invalid.
/// // quirk: PROC-34
pub fn disable_stdio_inheritance() {
    for selector in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
        let h = GetStdHandle(selector);
        if !h.is_null() && h != INVALID_HANDLE_VALUE {
            SetHandleInformation(h, HANDLE_FLAG_INHERIT, 0);
        }
    }
    let mut si = STARTUPINFOW {
        cb: size_of::<STARTUPINFOW>() as DWORD,
        lpReserved: ptr::null_mut(),
        lpDesktop: ptr::null_mut(),
        lpTitle: ptr::null_mut(),
        dwX: 0,
        dwY: 0,
        dwXSize: 0,
        dwYSize: 0,
        dwXCountChars: 0,
        dwYCountChars: 0,
        dwFillAttribute: 0,
        dwFlags: 0,
        wShowWindow: 0,
        cbReserved2: 0,
        lpReserved2: ptr::null_mut(),
        hStdInput: ptr::null_mut(),
        hStdOutput: ptr::null_mut(),
        hStdError: ptr::null_mut(),
    };
    // SAFETY: valid out-struct with cb set; GetStartupInfoW cannot fail.
    unsafe { GetStartupInfoW(&raw mut si) };
    if !stdio_verify(si.lpReserved2, si.cbReserved2) {
        return;
    }
    let buffer = si.lpReserved2;
    let mut count_bytes = [0u8; 4];
    // SAFETY: stdio_verify proved the blob holds `4 + count + 8*count`
    // bytes; all reads below stay inside that span.
    unsafe {
        ptr::copy_nonoverlapping(buffer, count_bytes.as_mut_ptr(), 4);
        let count = u32::from_ne_bytes(count_bytes) as usize;
        for i in 0..count {
            let off = 4 + count + i * size_of::<HANDLE>();
            let mut hb = [0u8; size_of::<usize>()];
            ptr::copy_nonoverlapping(buffer.add(off), hb.as_mut_ptr(), size_of::<usize>());
            let h: HANDLE = ptr::with_exposed_provenance_mut(usize::from_ne_bytes(hb));
            if h != INVALID_HANDLE_VALUE && !h.is_null() {
                SetHandleInformation(h, HANDLE_FLAG_INHERIT, 0);
            }
        }
    }
}

// ── the handle ──────────────────────────────────────────────────────────────

/// A spawned child on the IOCP loop. Heap-pinned by its owner from spawn
/// until the close callback; destruction is the deferred endgame protocol.
#[repr(C)]
pub struct ProcessHandle {
    core: HandleCore,
    /// Closed EAGERLY at exit dispatch (a held process handle is an
    /// invisible zombie); INVALID afterwards. // quirk: PROC-48
    process: HANDLE,
    /// Thread-pool wait registration; null when retired. Consumed by exit
    /// dispatch (non-blocking) or close (blocking drain). // quirk: PROC-45,
    /// PROC-46
    wait: HANDLE,
    /// IOCP snapshot the wait callback posts to (written before
    /// registration — the registration call is the synchronization point).
    exit_iocp: HANDLE,
    pid: DWORD,
    /// Recorded by a successful kill THROUGH THIS HANDLE; kills by pid or
    /// external terminations observe signal 0. // quirk: PROC-55
    exit_signal: i32,
    /// ESRCH latch: exit observed, handle closed — kill() short-circuits.
    /// // quirk: PROC-48
    reaped: bool,
    /// Set by the wait callback before it posts; read on the loop thread
    /// after the blocking unregister, deciding whether a packet is in
    /// flight. // quirk: PROC-46
    exit_posted: AtomicBool,
    exit_req: Req,
    exit_cb: Option<ProcessExitCb>,
    exit_data: *mut c_void,
    close_cb: Option<ProcessCloseCb>,
    close_data: *mut c_void,
}

/// Wait-thread callback: the process handle signaled. Sets the pending flag
/// then posts — both complete before UnregisterWaitEx's blocking drain can
/// return, which is what makes close()'s flag read race-free.
/// // quirk: PROC-45, PROC-46
unsafe extern "system" fn process_exit_wait_cb(context: *mut c_void, timed_out: BOOLEAN) {
    debug_assert!(timed_out == 0, "INFINITE wait cannot time out"); // quirk: PROC-62
    let h = context.cast::<ProcessHandle>();
    // SAFETY: the handle is pinned until the exit slot drains (endgame
    // gating); the one-shot wait fires at most once, and registration
    // happens-before this callback.
    unsafe {
        (*h).exit_req.set_success(0);
        (*h).exit_posted.store(true, Ordering::Release);
        // `exit_posted` latched true above: a lost packet would wedge the
        // close gate forever. Must stay the last `h`-touching statement — a
        // successful post may let the loop thread free `h`.
        crate::event_loop::post_or_die((*h).exit_iocp, 0, 0, (*h).exit_req.overlapped_ptr(), "process exit");
    }
}

impl ProcessHandle {
    /// Spawn a child. All failures are synchronous raw Win32 codes — a
    /// search miss is FILE_NOT_FOUND, a non-PE image surfaces
    /// BAD_EXE_FORMAT, a bad cwd ERROR_DIRECTORY (consumers map once at
    /// their boundary). On `Err` nothing needs closing. // quirk: PROC-50,
    /// PROC-58, PROC-64
    ///
    /// # Safety
    /// `lp` must be a valid pinned loop outliving the handle; every handle
    /// in `options.stdio` must be valid (or an intentional invalid for the
    /// fd 0-2 forgiveness); `exit_data` must be valid whenever `exit_cb` can
    /// run; the returned box must stay alive until the close callback runs.
    pub unsafe fn spawn(
        lp: *mut Loop,
        options: &ProcessOptions<'_>,
        exit_cb: Option<ProcessExitCb>,
        exit_data: *mut c_void,
    ) -> Result<Box<ProcessHandle>, Win32Error> {
        if options.file.is_empty() || options.args.is_empty() {
            return Err(Win32Error::INVALID_PARAMETER); // quirk: PROC-59
        }

        let mut application = Vec::new();
        wtf8_to_utf16(options.file, &mut application)?;
        let mut arguments = make_command_line(
            options.args,
            options.flags & PROCESS_VERBATIM_ARGUMENTS != 0,
        )?;
        let env_block = match options.env {
            Some(e) => Some(make_env_block(e)?),
            None => None,
        };
        let cwd = resolve_cwd(options.cwd)?;
        // The child's PATH decides the search (execvp semantics); only an
        // env-less spawn consults the parent's. Both may be absent.
        // // quirk: PROC-14, PROC-15
        let path = match &env_block {
            Some(b) => find_path_in_block(b),
            None => get_env_var(&ascii_to_utf16(b"PATH")),
        };

        // ConPTY supersedes stdio wholesale (enforced below). An empty
        // ChildStdio keeps `handle_list` empty → bInheritHandles FALSE →
        // the terminal child inherits nothing. // quirk: PROC-33
        let stdio = if options.pseudoconsole.is_some() {
            ChildStdio::new(0)
        } else {
            build_child_stdio(options.stdio)?
        };

        // search_path resolves lpApplicationName; lpCommandLine stays the
        // caller's argv — CreateProcess never parses the command line to
        // find the image (the classic unquoted-path hole). // quirk: PROC-05
        let Some(app_path) = search_path(&application, &cwd, path.as_deref(), options.flags) else {
            return Err(Win32Error::FILE_NOT_FOUND); // quirk: PROC-58
        };

        // The explicit inheritance list (composes with the lpReserved2
        // blob): exactly the child's handles, nothing else in the process
        // leaks in. Empty list (all slots forgiven, or a ConPTY spawn) →
        // `bInheritHandles` FALSE → inherit nothing. // quirk: PROC-33
        let handle_list = stdio.inheritable_handles();
        let mut attrs = if let Some(hpcon) = options.pseudoconsole {
            // The pseudoconsole supersedes stdio wholesale; a caller mixing
            // them is a contract violation, not a silent ignore.
            if !options.stdio.is_empty() {
                return Err(Win32Error::INVALID_PARAMETER);
            }
            let mut a = AttrList::new(1)?;
            a.set_pseudoconsole(hpcon)?;
            Some(a)
        } else if handle_list.is_empty() {
            None
        } else {
            let mut a = AttrList::new(1)?;
            a.set_handle_list(&handle_list)?;
            Some(a)
        };

        let any_inherit_fd = options
            .stdio
            .iter()
            .any(|s| matches!(s, Stdio::InheritFd(_)));
        let (mut process_flags, show) = creation_flags(options.flags, any_inherit_fd);
        if attrs.is_some() {
            process_flags |= EXTENDED_STARTUPINFO_PRESENT;
        }

        let mut six = STARTUPINFOEXW {
            StartupInfo: STARTUPINFOW {
                cb: if attrs.is_some() {
                    size_of::<STARTUPINFOEXW>() as DWORD
                } else {
                    size_of::<STARTUPINFOW>() as DWORD
                },
                lpReserved: ptr::null_mut(),
                lpDesktop: ptr::null_mut(),
                lpTitle: ptr::null_mut(),
                dwX: 0,
                dwY: 0,
                dwXSize: 0,
                dwYSize: 0,
                dwXCountChars: 0,
                dwYCountChars: 0,
                dwFillAttribute: 0,
                dwFlags: STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW,
                wShowWindow: show,
                // ConPTY: NULL std handles + no CRT blob — non-NULL handles
                // would override the pseudoconsole (terminal#15814).
                // Otherwise the blob and STARTF_USESTDHANDLES carry the SAME
                // handles — both views must agree. // quirk: PROC-25, PROC-28
                cbReserved2: if options.pseudoconsole.is_some() {
                    0
                } else {
                    stdio.size()
                },
                lpReserved2: if options.pseudoconsole.is_some() {
                    ptr::null_mut()
                } else {
                    stdio.blob.as_ptr().cast_mut()
                },
                hStdInput: if options.pseudoconsole.is_some() {
                    ptr::null_mut()
                } else {
                    stdio.handle(0)
                },
                hStdOutput: if options.pseudoconsole.is_some() {
                    ptr::null_mut()
                } else {
                    stdio.handle(1)
                },
                hStdError: if options.pseudoconsole.is_some() {
                    ptr::null_mut()
                } else {
                    stdio.handle(2)
                },
            },
            lpAttributeList: attrs.as_mut().map_or(ptr::null_mut(), |a| a.as_mut_ptr()),
        };

        let mut cwd_z = cwd;
        cwd_z.push(0);
        let mut info = PROCESS_INFORMATION {
            hProcess: ptr::null_mut(),
            hThread: ptr::null_mut(),
            dwProcessId: 0,
            dwThreadId: 0,
        };
        // SAFETY: app_path/arguments/cwd_z are NUL-terminated and live; the
        // env block (when present) is double-NUL terminated; six and info
        // are valid locals; the attribute list and stdio blob outlive the
        // call (dropped at scope end).
        let ok = unsafe {
            CreateProcessW(
                app_path.as_ptr(),
                arguments.as_mut_ptr(),
                ptr::null_mut(),
                ptr::null_mut(),
                BOOL::from(!handle_list.is_empty()),
                process_flags,
                env_block
                    .as_ref()
                    .map_or(ptr::null_mut(), |b| b.as_ptr().cast_mut().cast::<c_void>()),
                cwd_z.as_ptr(),
                &raw mut six.StartupInfo,
                &raw mut info,
            )
        };
        if ok == 0 {
            return Err(Win32Error::get()); // quirk: PROC-50
        }

        if process_flags & CREATE_SUSPENDED != 0 {
            // Suspended → job-assigned → resumed: the child cannot exit (or
            // spawn a subtree) before the kill-on-close membership exists.
            // // quirk: PROC-41, PROC-42
            let job = global_job();
            if !job.is_null() {
                // SAFETY: both handles are live.
                let assigned = unsafe { AssignProcessToJobObject(job, info.hProcess) };
                if assigned == 0 {
                    // ACCESS_DENIED = we run under foreign non-nestable job
                    // control; anything else is equally non-fatal — degraded
                    // kill-tree, never a failed spawn (tier-0 has no
                    // logger). // quirk: PROC-43
                    let _ = Win32Error::get();
                }
            }
            // SAFETY: hThread is the fresh primary thread handle.
            if unsafe { ResumeThread(info.hThread) } == DWORD::MAX {
                let err = Win32Error::get();
                // SAFETY: both handles owned here; the child never ran.
                unsafe {
                    TerminateProcess(info.hProcess, 1); // quirk: PROC-41
                    CloseHandle(info.hThread);
                    CloseHandle(info.hProcess);
                }
                return Err(err);
            }
        }

        let mut h = Box::new(ProcessHandle {
            // SAFETY: fn contract — the loop outlives the handle; the box is
            // the required heap pinning.
            core: unsafe { HandleCore::new(lp, process_endgame) },
            process: info.hProcess,
            wait: ptr::null_mut(),
            // SAFETY: lp is valid per the fn contract.
            exit_iocp: unsafe { (*lp).iocp() },
            pid: info.dwProcessId,
            exit_signal: 0,
            reaped: false,
            exit_posted: AtomicBool::new(false),
            exit_req: Req::new(ReqKind::ProcessExit, ptr::null_mut()),
            exit_cb,
            exit_data,
            close_cb: None,
            close_data: ptr::null_mut(),
        });
        let hp: *mut ProcessHandle = &raw mut *h;
        h.exit_req = Req::new(ReqKind::ProcessExit, hp.cast::<c_void>());
        h.exit_req.prime_pending();

        let mut wait: HANDLE = ptr::null_mut();
        // SAFETY: the box is fully initialized; a child that already exited
        // fires the callback immediately, which only touches fields written
        // above. // quirk: PROC-45
        let ok = unsafe {
            RegisterWaitForSingleObject(
                &raw mut wait,
                info.hProcess,
                process_exit_wait_cb,
                hp.cast::<c_void>(),
                INFINITE,
                WT_EXECUTEINWAITTHREAD | WT_EXECUTEONLYONCE,
            )
        };
        if ok == 0 {
            // A running child with no working exit watch must never be
            // reported as spawned: kill it and fail. // quirk: PROC-62
            let err = Win32Error::get();
            // SAFETY: both handles owned here; the box dies without a wait
            // registration referencing it.
            unsafe {
                TerminateProcess(info.hProcess, 1);
                CloseHandle(info.hThread);
                CloseHandle(info.hProcess);
            }
            return Err(err);
        }
        h.wait = wait;
        // SAFETY: the primary-thread handle is not used further.
        unsafe { CloseHandle(info.hThread) };

        h.core.start();
        // The exit slot gates the endgame but does NOT hold the loop open:
        // a ref'd handle pins the loop via handle accounting, an unref'd one
        // does not — yet its exit packet still dispatches. The handle-lifetime
        // decoupling. // quirk: PROC-45
        h.core.req_submitted_uncounted();
        Ok(h)
    }

    #[inline]
    pub fn pid(&self) -> u32 {
        self.pid
    }
    /// The borrowed process handle (rusage/GetProcessTimes queries);
    /// INVALID_HANDLE_VALUE once the exit was observed — the handle is
    /// closed eagerly, so consumers must query before/within the exit
    /// callback. // quirk: PROC-48
    #[inline]
    pub fn raw_handle(&self) -> HANDLE {
        self.process
    }
    #[inline]
    pub fn is_closing(&self) -> bool {
        self.core.is_closing()
    }
    /// Exit already observed (the handle is reaped; kill returns NotFound).
    #[inline]
    pub fn has_exited(&self) -> bool {
        self.reaped
    }
    #[inline]
    pub fn has_ref(&self) -> bool {
        self.core.has_ref()
    }

    /// Drop the loop keep-alive WITHOUT losing exit observation — the exit
    /// callback still fires whenever the loop runs. // quirk: PROC-45
    pub fn unref(&mut self) {
        self.core.unref();
    }
    /// Restore the keep-alive dropped by [`unref`](Self::unref).
    pub fn ref_(&mut self) {
        self.core.ref_();
    }

    /// Signal emulation through the held process handle. TERM/KILL/INT/QUIT
    /// all TerminateProcess(handle, 1); 0 is the liveness probe; success
    /// records `signum` as the exit callback's term_signal. // quirk: PROC-51,
    /// PROC-55
    pub fn kill(&mut self, signum: i32) -> Result<(), KillError> {
        if self.reaped || self.process == INVALID_HANDLE_VALUE {
            return Err(KillError::NotFound); // quirk: PROC-48
        }
        kill_raw(self.process, signum)?;
        self.exit_signal = signum; // quirk: PROC-55
        Ok(())
    }

    /// Begin the asynchronous close. The wait registration is drained with
    /// the BLOCKING UnregisterWaitEx form — after it returns the callback
    /// either fully ran (its packet is consumed by dispatch, which sees
    /// CLOSING and skips the exit callback) or provably never will (the
    /// exit slot is retired here). Closing does NOT kill the child.
    /// // quirk: PROC-46, PROC-49
    pub fn close(&mut self, cb: Option<ProcessCloseCb>, data: *mut c_void) {
        self.close_cb = cb;
        self.close_data = data;
        let wait = mem::replace(&mut self.wait, ptr::null_mut());
        if !wait.is_null() {
            // SAFETY: `wait` is the live registration owned by this handle.
            let ok = unsafe { UnregisterWaitEx(wait, INVALID_HANDLE_VALUE) };
            // Failure means the callback may still fire into freed memory
            // later — unrecoverable. // quirk: PROC-46
            assert!(ok != 0, "UnregisterWaitEx: {:?}", Win32Error::get());
            if !self.exit_posted.load(Ordering::Acquire) {
                // The callback never ran: no packet is in flight, retire the
                // exit slot so the endgame becomes eligible.
                self.core.req_completed_uncounted();
            }
        }
        self.core.close();
    }
}

/// `kill(pid, signum)` without a held handle. pid 0 targets the current
/// process (POSIX group-kill approximated as self); a nonexistent pid is
/// ERROR_INVALID_PARAMETER from OpenProcess = NotFound. // quirk: PROC-54
pub fn kill_pid(pid: u32, signum: i32) -> Result<(), KillError> {
    let (handle, owned) = if pid == 0 {
        (GetCurrentProcess(), false)
    } else {
        // SYNCHRONIZE is load-bearing: without it the WaitForSingleObject
        // probes fail and the ESRCH disambiguation breaks. // quirk: PROC-54
        // SAFETY: by-value args; failure handled below.
        let h = unsafe {
            OpenProcess(
                PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION | SYNCHRONIZE,
                FALSE,
                pid,
            )
        };
        if h.is_null() {
            let err = Win32Error::get();
            return Err(if err == Win32Error::INVALID_PARAMETER {
                KillError::NotFound
            } else {
                KillError::Os(err)
            });
        }
        (h, true)
    };
    let result = kill_raw(handle, signum);
    if owned {
        // SAFETY: opened above, closed exactly once.
        unsafe { CloseHandle(handle) };
    }
    result
}

/// The shared signal-emulation core over a live process handle.
fn kill_raw(handle: HANDLE, signum: i32) -> Result<(), KillError> {
    if !(0..NSIG).contains(&signum) {
        return Err(KillError::InvalidSignal); // quirk: PROC-51
    }
    match signum {
        SIGTERM | SIGKILL | SIGINT | SIGQUIT => {
            // Killed processes conventionally exit 1. GenerateConsoleCtrlEvent
            // is deliberately not used (mis-targets shared consoles).
            // // quirk: PROC-51
            // SAFETY: handle is live per the callers' contracts.
            if unsafe { TerminateProcess(handle, 1) } != 0 {
                return Ok(());
            }
            let err = Win32Error::get();
            if err == Win32Error::ACCESS_DENIED {
                // Two-step already-exited probe; the residual race (exited
                // microseconds ago, handle not yet signaled) is a kernel
                // inconsistency not fixable from user space. // quirk: PROC-52
                let mut status: DWORD = 0;
                // SAFETY: valid out-pointer on a live handle.
                if unsafe { GetExitCodeProcess(handle, &raw mut status) } != 0
                    && status != STILL_ACTIVE
                {
                    return Err(KillError::NotFound);
                }
                // SAFETY: handle opened with SYNCHRONIZE per caller contract.
                if let Ok(WAIT_OBJECT_0) = unsafe { WaitForSingleObject(handle, 0) } {
                    return Err(KillError::NotFound);
                }
            }
            Err(KillError::Os(err))
        }
        0 => {
            // Liveness probe: GetExitCodeProcess alone is ambiguous (a child
            // can exit WITH code 259), so both checks run. // quirk: PROC-53
            let mut status: DWORD = 0;
            // SAFETY: valid out-pointer on a live handle.
            if unsafe { GetExitCodeProcess(handle, &raw mut status) } == 0 {
                return Err(KillError::Os(Win32Error::get()));
            }
            if status != STILL_ACTIVE {
                return Err(KillError::NotFound);
            }
            // SAFETY: handle has SYNCHRONIZE per caller contract.
            match unsafe { WaitForSingleObject(handle, 0) } {
                Ok(WAIT_OBJECT_0) => Err(KillError::NotFound),
                Ok(WAIT_TIMEOUT) => Ok(()),
                Ok(_) => Err(KillError::Os(Win32Error::GEN_FAILURE)),
                Err(e) => Err(KillError::Os(e)),
            }
        }
        _ => Err(KillError::Unsupported), // quirk: PROC-51
    }
}

// ── completion dispatch ─────────────────────────────────────────────────────

/// Exit packet dispatch. Runs on the loop thread; fires the exit callback
/// regardless of ref state (the handle-lifetime decoupling), unless the handle is
/// closing — close already drained the wait, so the packet only retires the
/// slot. // quirk: PROC-45, PROC-46
pub(crate) fn process_process_exit_req(loop_: &mut Loop, req: &mut Req) {
    let lp: *mut Loop = loop_;
    let h = req.data().cast::<ProcessHandle>();
    // SAFETY: `data` was set at spawn to the heap-pinned ProcessHandle, kept
    // alive until the exit slot drains (endgame protocol).
    unsafe {
        (*h).core.req_completed_uncounted();
        if (*h).core.is_closing() {
            return;
        }
        // The callback provably ran (it posted this packet): the
        // non-blocking unregister is safe here. // quirk: PROC-46
        let wait = mem::replace(&mut (*h).wait, ptr::null_mut());
        if !wait.is_null() {
            UnregisterWait(wait);
        }

        let mut status: DWORD = 0;
        // Full 32-bit code zero-extended: NTSTATUS crash values (0xC0000005)
        // are real exit codes and must not truncate. STILL_ACTIVE is
        // unambiguous here — the wait already signaled. // quirk: PROC-47
        let exit_code: i64 = if GetExitCodeProcess((*h).process, &raw mut status) != 0 {
            i64::from(status)
        } else {
            // Should never happen; negative = -(raw Win32 code) per the
            // ProcessExitCb contract.
            -i64::from(Win32Error::get().int())
        };

        // ESRCH latch first: kill-from-inside-the-exit-cb must see "already
        // reaped", and pid-reuse makes later by-pid work unsafe anyway.
        // // quirk: PROC-48
        (*h).reaped = true;

        // Inactive: no further events from this handle (a ref'd handle stops
        // holding the loop open once the child is gone).
        (*h).core.stop();

        // The process HANDLE stays open across the callback: exit-time rusage
        // (GetProcessTimes via raw_handle()) is queried from inside exit_cb —
        // the contract raw_handle() documents. The cb may also close() us;
        // both orders are safe because the eager close below re-checks.
        if let Some(cb) = (*h).exit_cb {
            cb(&mut *lp, (*h).exit_data, exit_code, (*h).exit_signal);
        }

        // Eager close: the kernel object dies now, not at the owner's
        // leisure. Guarded — an in-callback close() already released it.
        if (*h).process != INVALID_HANDLE_VALUE {
            CloseHandle((*h).process);
            (*h).process = INVALID_HANDLE_VALUE;
        }
    }
}

// ── endgame ─────────────────────────────────────────────────────────────────

/// The exit slot drained: the wait is already retired (close's blocking
/// drain or dispatch — never forced here) and the process handle is closed
/// if exit never dispatched. Fires the close callback; the owner frees the
/// box afterwards. // quirk: PROC-46, PROC-48
unsafe fn process_endgame(core: *mut HandleCore) {
    // SAFETY: the endgame drain passes the live, queued handle; `core` is
    // the first field of the #[repr(C)] ProcessHandle.
    unsafe {
        let h = core.cast::<ProcessHandle>();
        debug_assert!((*h).wait.is_null()); // quirk: PROC-46
        if (*h).process != INVALID_HANDLE_VALUE {
            CloseHandle((*h).process);
            (*h).process = INVALID_HANDLE_VALUE;
        }
        let lp = (*h).core.loop_;
        let data = (*h).close_data;
        if let Some(cb) = (*h).close_cb.take() {
            cb(&mut *lp, data);
        }
    }
}

#[cfg(test)]
mod tests;
