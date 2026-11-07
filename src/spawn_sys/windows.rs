//! Starts, waits for and ends processes on Windows. What a child can observe is what it observes under Node.js.

use core::cmp::Ordering as Order;
use core::ffi::{c_char, c_int, c_void};
use core::ptr::{from_ref, null_mut};
use core::sync::atomic::Ordering;

use bun_core::ffi::zeroed;
use bun_core::path_sep::is_sep_any_t;
use bun_core::{SignalCode, ZStr, strings, w};
use bun_sys::windows::pipe::{self, End};
use bun_sys::windows::{
    BOOL, CREATE_UNICODE_ENVIRONMENT, DWORD, EXTENDED_STARTUPINFO_PRESENT, FILE_TYPE_CHAR,
    FILE_TYPE_DISK, FILE_TYPE_PIPE, FILE_TYPE_REMOTE, FILETIME, GetFileType, HANDLE, HPCON,
    INFINITE, INVALID_FILE_ATTRIBUTES, INVALID_HANDLE_VALUE, PROC_THREAD_ATTRIBUTE_JOB_LIST,
    Win32Error, getenv_w, kernel32,
};
use bun_sys::{E, Fd, FdExt as _, O, Tag};
use bun_windows_sys::externs::{
    CloseHandle, CreateFileW, DUPLICATE_SAME_ACCESS, FALSE, FILE_ATTRIBUTE_DIRECTORY,
    FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
    GetCurrentDirectoryW, GetFileAttributesW, GetProcessTimes, InitializeProcThreadAttributeList,
    OPEN_EXISTING, OpenProcess, PROCESS_INFORMATION, SECURITY_ATTRIBUTES, STARTF_USESTDHANDLES,
    STARTUPINFOEXW, SYNCHRONIZE, TRUE, UpdateProcThreadAttribute, WAIT_FAILED, WAIT_OBJECT_0,
    WAIT_TIMEOUT, peb,
};

use crate::spawn_process::{
    ExtraPipe, IoCounters, PidT, SpawnOptions, SpawnResult, Stdio, StdioKind, WinRusage,
};
use crate::{Argv, Envp};

type Win32Result<T> = Result<T, Win32Error>;

const STILL_ACTIVE: DWORD = 259;
const PROCESS_TERMINATE: DWORD = 0x0001;
const PROCESS_QUERY_INFORMATION: DWORD = 0x0400;

const DETACHED_PROCESS: DWORD = 0x0000_0008;
const CREATE_NEW_PROCESS_GROUP: DWORD = 0x0000_0200;
const CREATE_NO_WINDOW: DWORD = 0x0800_0000;
const STARTF_USESHOWWINDOW: DWORD = 0x0000_0001;
const SW_HIDE: u16 = 0;
const SW_SHOWDEFAULT: u16 = 10;
const PROC_THREAD_ATTRIBUTE_HANDLE_LIST: usize = 0x0002_0002;
const PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE: usize = 0x0002_0016;

const NUL: u16 = 0;
const TAB: u16 = b'\t' as u16;
const SPACE: u16 = b' ' as u16;
const QUOTE: u16 = b'"' as u16;
const APOSTROPHE: u16 = b'\'' as u16;
const DOT: u16 = b'.' as u16;
const SLASH: u16 = b'/' as u16;
const COLON: u16 = b':' as u16;
const QUESTION_MARK: u16 = b'?' as u16;
const SEMICOLON: u16 = b';' as u16;
const EQUALS: u16 = b'=' as u16;
const BACKSLASH: u16 = b'\\' as u16;

unsafe extern "system" {
    fn DeleteProcThreadAttributeList(list: *mut u8);
    fn NeedCurrentDirectoryForExePathW(exe_name: *const u16) -> BOOL;
    safe fn GetProcessIoCounters(process: HANDLE, counters: &mut IoCounters) -> BOOL;
}

fn close(handle: HANDLE) {
    // SAFETY: every caller owns `handle` and does not use it again.
    let _ = unsafe { CloseHandle(handle) };
}

/// Appends `bytes` as UTF-16: an unpaired surrogate (WTF-8) is kept, and what is not UTF-8 becomes U+FFFD.
fn push_wide(out: &mut Vec<u16>, bytes: &[u8]) {
    let start = out.len();
    out.resize(start + bytes.len(), 0);
    let len = strings::convert_utf8_to_utf16_in_buffer(&mut out[start..], bytes).len();
    out.truncate(start + len);
}

/// # Safety
/// `list` is a null-terminated array of NUL-terminated strings, all of which outlive `'a`.
unsafe fn c_strings<'a>(list: *const *const c_char) -> impl Iterator<Item = &'a [u8]> {
    (0..).map_while(move |i| {
        // SAFETY: nothing past the terminator is read.
        let item = unsafe { *list.add(i) };
        // SAFETY: caller contract.
        (!item.is_null()).then(|| unsafe { bun_core::ffi::cstr(item) }.to_bytes())
    })
}

// ── Which file to run ──

fn lowercase(unit: u16) -> u16 {
    match u8::try_from(unit) {
        Ok(ascii) => ascii.to_ascii_lowercase().into(),
        Err(_) => unit,
    }
}

fn push_separator(path: &mut Vec<u16>) {
    if path
        .last()
        .is_some_and(|&last| !is_sep_any_t(last) && last != COLON)
    {
        path.push(BACKSLASH);
    }
}

/// `dir\name.ext` as seen from `cwd`, NUL-terminated, if that is a file.
fn join_and_test(mut dir: &[u16], name: &[u16], ext: &[u16], mut cwd: &[u16]) -> Option<Vec<u16>> {
    if dir.len() > 2 && is_sep_any_t(dir[0]) && is_sep_any_t(dir[1]) {
        // \\server\share
        cwd = &[];
    } else if dir.first().is_some_and(|&first| is_sep_any_t(first)) {
        // \dir, on the drive of `cwd`
        cwd = &cwd[..cwd.len().min(2)];
    } else if dir.len() >= 2 && dir[1] == COLON && (dir.len() < 3 || !is_sep_any_t(dir[2])) {
        // D:dir, which is relative to `cwd` if that is on D:
        if cwd.len() >= 2 && cwd[1] == COLON && lowercase(cwd[0]) == lowercase(dir[0]) {
            dir = &dir[2..];
        } else {
            cwd = &[];
        }
    } else if dir.len() > 2 && dir[1] == COLON {
        // D:\dir
        cwd = &[];
    }

    let mut path = Vec::with_capacity(cwd.len() + dir.len() + name.len() + ext.len() + 4);
    path.extend_from_slice(cwd);
    push_separator(&mut path);
    let cwd_end = path.len();
    path.extend_from_slice(dir);
    if path.len() > cwd_end {
        push_separator(&mut path);
    }
    path.extend_from_slice(name);
    if !ext.is_empty() {
        if name.last().is_some_and(|&last| last != DOT) {
            path.push(DOT);
        }
        path.extend_from_slice(ext);
    }
    path.push(NUL);

    // Not opened: that fails for an app execution alias, which `CreateProcessW` can run.
    // SAFETY: NUL-terminated above.
    let attributes = unsafe { GetFileAttributesW(path.as_ptr()) };
    (attributes != INVALID_FILE_ATTRIBUTES && attributes & FILE_ATTRIBUTE_DIRECTORY == 0)
        .then_some(path)
}

/// The extensions are appended, never substituted. The first hit is final, whether or not it can be run.
fn search_directory(dir: &[u16], name: &[u16], cwd: &[u16], exact_first: bool) -> Option<Vec<u16>> {
    exact_first
        .then(|| join_and_test(dir, name, &[], cwd))
        .flatten()
        .or_else(|| join_and_test(dir, name, w!("com"), cwd))
        .or_else(|| join_and_test(dir, name, w!("exe"), cwd))
}

/// `file` as cmd.exe would find it from `cwd` and `path`, NUL-terminated, with `.com` and `.exe` in place of `PATHEXT`.
fn search_path(file: &[u16], cwd: &[u16], path: Option<&[u16]>) -> Option<Vec<u16>> {
    if file.is_empty() || file == [DOT] {
        return None;
    }

    let name_start = file
        .iter()
        .rposition(|&unit| is_sep_any_t(unit) || unit == COLON)
        .map_or(0, |i| i + 1);
    let (dir, name) = file.split_at(name_start);
    let has_extension =
        strings::index_of_any16(name, &[DOT]).is_some_and(|dot| dot + 1 < name.len());

    if !dir.is_empty() {
        return search_directory(dir, name, cwd, has_extension);
    }

    // SAFETY: the argument is a NUL-terminated string.
    if unsafe { NeedCurrentDirectoryForExePathW(w!("\0").as_ptr()) } != FALSE {
        if let Some(found) = search_directory(&[], name, cwd, has_extension) {
            return Some(found);
        }
    }

    let mut rest = path?;
    while !rest.is_empty() {
        // A quoted part may have semicolons in it.
        let quoted = match rest[0] {
            quote @ (QUOTE | APOSTROPHE) => {
                strings::index_of_any16(&rest[1..], &[quote]).map_or(rest.len(), |i| i + 1)
            }
            _ => 0,
        };
        let end = strings::index_of_any16(&rest[quoted..], &[SEMICOLON])
            .map_or(rest.len(), |i| quoted + i);
        let mut dir = &rest[..end];
        rest = rest.get(end + 1..).unwrap_or_default();

        if let [QUOTE | APOSTROPHE, unquoted @ ..] = dir {
            dir = unquoted;
        }
        if let [unquoted @ .., QUOTE | APOSTROPHE] = dir {
            dir = unquoted;
        }
        if dir.is_empty() {
            continue;
        }
        if let Some(found) = search_directory(dir, name, cwd, has_extension) {
            return Some(found);
        }
    }
    None
}

// ── Command line ──

/// Appends `arg` so that `CommandLineToArgvW` and the C runtime read one argument, quoted only if it has to be.
fn quote_argument(arg: &[u16], out: &mut Vec<u16>) {
    if arg.is_empty() {
        out.extend_from_slice(&[QUOTE, QUOTE]);
        return;
    }
    // Quotes do no harm where they are not needed.
    let needs_quotes = |unit: &u16| {
        matches!(
            *unit,
            SPACE | TAB | QUOTE | 0x2000..=0x200A | 0x25CB | 0x3000
        )
    };
    if !arg.iter().any(needs_quotes) {
        out.extend_from_slice(arg);
        return;
    }
    out.push(QUOTE);
    if strings::index_of_any16(arg, &[QUOTE, BACKSLASH]).is_none() {
        out.extend_from_slice(arg);
    } else {
        // Backwards: a run of backslashes is doubled only if it ends at a quote (the closing one too), and a quote gets one more.
        let start = out.len();
        let mut before_quote = true;
        for &unit in arg.iter().rev() {
            out.push(unit);
            if before_quote && unit == BACKSLASH {
                out.push(BACKSLASH);
            } else if unit == QUOTE {
                before_quote = true;
                out.push(BACKSLASH);
            } else {
                before_quote = false;
            }
        }
        out[start..].reverse();
    }
    out.push(QUOTE);
}

/// NUL-terminated.
///
/// # Safety
/// As [`c_strings`].
unsafe fn command_line(argv: Argv, verbatim: bool) -> Vec<u16> {
    let mut line = Vec::new();
    let mut arg = Vec::new();
    // SAFETY: caller contract.
    for bytes in unsafe { c_strings(argv) } {
        if !line.is_empty() {
            line.push(SPACE);
        }
        if verbatim {
            push_wide(&mut line, bytes);
        } else {
            arg.clear();
            push_wide(&mut arg, bytes);
            quote_argument(&arg, &mut line);
        }
    }
    line.push(NUL);
    line
}

// ── Environment ──

/// A child that lacks one gets this process's: Winsock, for one, does not start without `SYSTEMROOT`. Sorted, NUL-terminated.
const REQUIRED_VARIABLES: [&[u16]; 11] = [
    w!("HOMEDRIVE\0"),
    w!("HOMEPATH\0"),
    w!("LOGONSERVER\0"),
    w!("PATH\0"),
    w!("SYSTEMDRIVE\0"),
    w!("SYSTEMROOT\0"),
    w!("TEMP\0"),
    w!("USERDOMAIN\0"),
    w!("USERNAME\0"),
    w!("USERPROFILE\0"),
    w!("WINDIR\0"),
];

/// The order that `GetEnvironmentVariableW` expects a block to be in.
fn compare_names(a: &[u16], b: &[u16]) -> Order {
    // SAFETY: both pointers are valid for the lengths that go with them.
    let result = unsafe {
        kernel32::CompareStringOrdinal(
            a.as_ptr(),
            a.len() as c_int,
            b.as_ptr(),
            b.len() as c_int,
            TRUE,
        )
    };
    result.cmp(&kernel32::CSTR_EQUAL)
}

/// `NAME=value\0` for each variable, sorted by name, and one more NUL.
///
/// # Safety
/// As [`c_strings`].
unsafe fn environment_block(envp: Envp) -> Vec<u16> {
    struct Variable {
        start: usize,
        name_len: usize,
        end: usize,
    }

    let mut units = Vec::new();
    let mut variables = Vec::new();
    // SAFETY: caller contract.
    for bytes in unsafe { c_strings(envp) } {
        let start = units.len();
        push_wide(&mut units, bytes);
        // The name of `=C:=C:\dir`, where cmd.exe keeps the current directory of a drive, is empty.
        match strings::index_of_any16(&units[start..], &[EQUALS]) {
            Some(name_len) => variables.push(Variable {
                start,
                name_len,
                end: units.len(),
            }),
            None => units.truncate(start),
        }
    }
    let name = |variable: &Variable| &units[variable.start..variable.start + variable.name_len];
    variables.sort_by(|a, b| compare_names(name(a), name(b)));
    // A child finds the first of the names that differ in case at most, so that is the one given last.
    variables.dedup_by(|later, earlier| {
        let is_same =
            later.name_len != 0 && compare_names(name(later), name(earlier)) == Order::Equal;
        if is_same {
            core::mem::swap(later, earlier);
        }
        is_same
    });

    let mut block = Vec::with_capacity(units.len() + variables.len() + 1);
    let mut required = REQUIRED_VARIABLES.iter().copied().peekable();
    let mut given = variables.iter().peekable();
    loop {
        let order = match (required.peek(), given.peek()) {
            (None, None) => break,
            (None, Some(_)) => Order::Greater,
            (Some(_), None) => Order::Less,
            (Some(required), Some(given)) => {
                compare_names(&required[..required.len() - 1], name(given))
            }
        };
        if order != Order::Greater {
            let required = required.next().unwrap();
            if order == Order::Less {
                if let Some(value) = getenv_w(required) {
                    block.extend_from_slice(&required[..required.len() - 1]);
                    block.push(EQUALS);
                    block.extend_from_slice(&value);
                    block.push(NUL);
                }
                continue;
            }
        }
        let given = given.next().unwrap();
        block.extend_from_slice(&units[given.start..given.end]);
        block.push(NUL);
    }
    if block.is_empty() {
        block.push(NUL);
    }
    block.push(NUL);
    block
}

fn path_variable(block: &[u16]) -> Option<&[u16]> {
    block
        .split(|&unit| unit == NUL)
        .take_while(|variable| !variable.is_empty())
        .find_map(|variable| {
            let (name, value) = variable.split_at_checked(5)?;
            strings::eql_case_insensitive_t(name, b"PATH=").then_some(value)
        })
}

// ── Current directory ──

fn current_directory() -> Win32Result<Vec<u16>> {
    let mut cwd = vec![0u16; 260];
    loop {
        // SAFETY: `cwd` is valid for the length that goes with it.
        let len = unsafe { GetCurrentDirectoryW(cwd.len() as DWORD, cwd.as_mut_ptr()) } as usize;
        if len == 0 {
            return Err(Win32Error::get());
        }
        // What does not fit is answered with the size that it takes.
        if len < cwd.len() {
            cwd.truncate(len);
            return Ok(cwd);
        }
        cwd.resize(len, 0);
    }
}

/// The limit of `CreateProcessW` for a current directory, long path support or not.
const MAX_CWD: usize = 258;

/// `cwd` by the 8.3 names of its components if it has them. Otherwise it is left alone, and the spawn fails.
fn shorten_cwd(cwd: &mut Vec<u16>) {
    let is_prefixed = matches!(cwd.as_slice(), [first, second, QUESTION_MARK, fourth, ..]
        if is_sep_any_t(*first) && is_sep_any_t(*second) && is_sep_any_t(*fourth));
    let path = &cwd[if is_prefixed { 4 } else { 0 }..];
    // A path this long is sure to be taken only with `\\?\`, which the result drops: cmd.exe refuses such a current directory.
    let (prefix, rest, without_prefix): (&[u16], &[u16], &[u16]) = match path {
        [u, n, c, fourth, rest @ ..]
            if is_prefixed
                && [*u | 0x20, *n | 0x20, *c | 0x20] == *w!("unc")
                && is_sep_any_t(*fourth) =>
        {
            (w!("\\\\?\\UNC\\"), rest, w!("\\\\"))
        }
        [first, second, rest @ ..]
            if !is_prefixed && is_sep_any_t(*first) && is_sep_any_t(*second) =>
        {
            (w!("\\\\?\\UNC\\"), rest, w!("\\\\"))
        }
        [_, COLON, third, ..] if is_sep_any_t(*third) => (w!("\\\\?\\"), path, &[]),
        // `\\?\Volume{…}\` has no other form.
        _ if is_prefixed => (&[], cwd, &[]),
        _ => return,
    };
    let mut long = [prefix, rest, &[NUL]].concat();
    // Which is taken as it is.
    for unit in &mut long {
        if *unit == SLASH {
            *unit = BACKSLASH;
        }
    }

    let mut short = vec![0u16; long.len()];
    // SAFETY: `long` is NUL-terminated, and `short` is valid for the length that goes with it.
    let len = unsafe {
        kernel32::GetShortPathNameW(long.as_ptr(), short.as_mut_ptr(), short.len() as DWORD)
    };
    if len == 0 || len as usize >= short.len() {
        return;
    }
    *cwd = [without_prefix, &short[prefix.len()..len as usize]].concat();
}

// ── Standard I/O ──

// What the C runtime keeps about a descriptor.
const FOPEN: u8 = 0x01;
const FPIPE: u8 = 0x08;
const FDEV: u8 = 0x40;

/// A descriptor of the child.
#[derive(Clone, Copy)]
struct Slot {
    flags: u8,
    handle: HANDLE,
}

impl Slot {
    const CLOSED: Slot = Slot {
        flags: 0,
        handle: INVALID_HANDLE_VALUE,
    };
}

struct ChildStdio {
    slots: Vec<Slot>,
    /// The inheritable handles in `slots`, each once. They are made for this spawn only.
    inheritable: Vec<HANDLE>,
    /// This process's ends of the pipes in `slots`, until the spawn has worked.
    ours: Vec<Fd>,
    /// Whether a slot is something that this process already had, which may be its console.
    inherits: bool,
}

impl Drop for ChildStdio {
    fn drop(&mut self) {
        for &handle in &self.inheritable {
            close(handle);
        }
        for fd in self.ours.drain(..) {
            fd.close();
        }
    }
}

impl ChildStdio {
    fn add(&mut self, handle: HANDLE, flags: u8) {
        self.inheritable.push(handle);
        self.slots.push(Slot { flags, handle });
    }

    fn add_closed(&mut self) {
        self.slots.push(Slot::CLOSED);
    }

    /// A program may not cope without the first three descriptors.
    fn add_null_device(&mut self) -> Win32Result<()> {
        let access = if self.slots.is_empty() {
            FILE_GENERIC_READ
        } else {
            FILE_GENERIC_WRITE | FILE_READ_ATTRIBUTES
        };
        let mut security = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as DWORD,
            lpSecurityDescriptor: null_mut(),
            bInheritHandle: TRUE,
        };
        // SAFETY: the name is NUL-terminated, and `security` outlives the call.
        let handle = unsafe {
            CreateFileW(
                w!("NUL\0").as_ptr(),
                access,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                &raw mut security,
                OPEN_EXISTING,
                0,
                null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(Win32Error::get());
        }
        self.add(handle, FOPEN | FDEV);
        Ok(())
    }

    /// `false` if `source` is no handle at all.
    fn add_duplicate(&mut self, source: HANDLE) -> Win32Result<bool> {
        self.inherits = true;
        // -2: the C runtime's standard handle of a process without a console, and the current thread to `DuplicateHandle`.
        if source.is_null() || source == INVALID_HANDLE_VALUE || source as isize == -2 {
            return Ok(false);
        }
        let process = kernel32::GetCurrentProcess();
        let mut handle: HANDLE = null_mut();
        // SAFETY: `handle` outlives the call.
        let ok = unsafe {
            kernel32::DuplicateHandle(
                process,
                source,
                process,
                &raw mut handle,
                0,
                TRUE,
                DUPLICATE_SAME_ACCESS,
            )
        };
        if ok == FALSE {
            return Err(Win32Error::get());
        }
        let flags = match GetFileType(handle) {
            FILE_TYPE_DISK => FOPEN,
            FILE_TYPE_PIPE => FOPEN | FPIPE,
            FILE_TYPE_CHAR | FILE_TYPE_REMOTE => FOPEN | FDEV,
            _ => match Win32Error::get() {
                Win32Error::SUCCESS => FOPEN | FDEV,
                error => {
                    close(handle);
                    return Err(error);
                }
            },
        };
        self.add(handle, flags);
        Ok(true)
    }

    /// `path` is what `fs.openSync` takes: `nul` is the device, and `\a` is on the current drive.
    fn add_file(&mut self, path: &[u8], flags: i32) -> bun_sys::Result<()> {
        let path = bun_sys::to_posix_path(path)
            .map_err(|errno| bun_sys::Error::new(errno, Tag::open).with_path(path))?;
        let file = bun_sys::File::open(ZStr::from_cstr(&path), flags | O::CREAT, 0o644)?;
        self.add_duplicate(file.handle().native()).map_err(error)?;
        Ok(())
    }

    /// Returns this process's end, which is for the event loop.
    fn add_pipe(&mut self, child_end_overlapped: bool) -> bun_sys::Result<Fd> {
        let [ours, theirs] = pipe::pair(
            End {
                overlapped: true,
                inheritable: false,
            },
            End {
                overlapped: child_end_overlapped,
                inheritable: true,
            },
        )?;
        self.ours.push(ours);
        self.add(theirs.native(), FOPEN | FPIPE);
        Ok(ours)
    }

    /// `int count; unsigned char flags[count]; HANDLE handles[count];`, unaligned.
    fn reserved2(&self) -> Vec<u8> {
        let mut block = Vec::with_capacity(4 + self.slots.len() * (1 + size_of::<HANDLE>()));
        block.extend_from_slice(&(self.slots.len() as c_int).to_ne_bytes());
        block.extend(self.slots.iter().map(|slot| slot.flags));
        for slot in &self.slots {
            block.extend_from_slice(&(slot.handle as usize).to_ne_bytes());
        }
        block
    }
}

/// The job that ends children along with this process.
mod job {
    use core::ptr::{from_mut, null, null_mut};
    use core::sync::atomic::{AtomicPtr, Ordering};

    use bun_core::ffi::zeroed;
    use bun_sys::windows::{
        DWORD, HANDLE, JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    };
    use bun_windows_sys::externs::{FALSE, SECURITY_ATTRIBUTES, SetInformationJobObject};

    unsafe extern "system" {
        fn CreateJobObjectW(attributes: *mut SECURITY_ATTRIBUTES, name: *const u16) -> HANDLE;
    }

    static CURRENT: AtomicPtr<core::ffi::c_void> = AtomicPtr::new(null_mut());

    /// `KILL_ON_JOB_CLOSE`: members end with this process, however it ends. `SILENT_BREAKAWAY_OK`: their children are no members.
    pub(super) fn create() -> Option<HANDLE> {
        // SAFETY: both arguments are optional.
        let job = unsafe { CreateJobObjectW(null_mut(), null()) };
        if job.is_null() {
            return None;
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_BREAKAWAY_OK
            | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK
            | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
            | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: `limits` is what this information class takes.
        let ok = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                from_mut(&mut limits).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as DWORD,
            )
        };
        if ok == FALSE {
            super::close(job);
            return None;
        }
        Some(job)
    }

    pub(super) fn current() -> Option<HANDLE> {
        let job = CURRENT.load(Ordering::Acquire);
        if !job.is_null() {
            return Some(job);
        }
        let job = create()?;
        match CURRENT.compare_exchange(null_mut(), job, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => Some(job),
            Err(winner) => {
                super::close(job);
                Some(winner)
            }
        }
    }

    /// Neither is closed, now or later: both have children in them.
    pub(super) fn replace(old: HANDLE, new: HANDLE) {
        let _ = CURRENT.compare_exchange(old, new, Ordering::AcqRel, Ordering::Acquire);
    }
}

// ── CreateProcessW ──

struct AttributeList(Vec<usize>);

impl AttributeList {
    fn new(count: DWORD) -> Win32Result<Self> {
        let mut size = 0usize;
        // SAFETY: with no buffer this only reports the size, by failing.
        let _ = unsafe { InitializeProcThreadAttributeList(null_mut(), count, 0, &raw mut size) };
        let mut buffer = vec![0usize; size.div_ceil(size_of::<usize>())];
        // SAFETY: `buffer` has the `size` bytes asked for.
        if unsafe {
            InitializeProcThreadAttributeList(buffer.as_mut_ptr().cast(), count, 0, &raw mut size)
        } == FALSE
        {
            return Err(Win32Error::get());
        }
        Ok(Self(buffer))
    }

    fn as_mut_ptr(&mut self) -> *mut u8 {
        self.0.as_mut_ptr().cast()
    }

    /// # Safety
    /// The list keeps `value`, which has to stay valid for `size` bytes for as long as the list is used.
    unsafe fn set(
        &mut self,
        attribute: usize,
        value: *const c_void,
        size: usize,
    ) -> Win32Result<()> {
        // SAFETY: the list is initialized; for `value`, caller contract.
        let ok = unsafe {
            UpdateProcThreadAttribute(
                self.as_mut_ptr(),
                0,
                attribute,
                value,
                size,
                null_mut(),
                null_mut(),
            )
        };
        if ok == FALSE {
            return Err(Win32Error::get());
        }
        Ok(())
    }
}

impl Drop for AttributeList {
    fn drop(&mut self) {
        // SAFETY: initialized by `new`.
        unsafe { DeleteProcThreadAttributeList(self.as_mut_ptr()) };
    }
}

/// Strings are NUL-terminated.
struct Request<'a> {
    application: &'a [u16],
    command_line: &'a mut [u16],
    /// `None`: a copy of this process's.
    environment: Option<&'a [u16]>,
    cwd: &'a [u16],
    flags: DWORD,
    show_window: u16,
    /// `None`: the child's console supplies them.
    stdio: Option<&'a ChildStdio>,
    pseudoconsole: Option<HPCON>,
}

impl Request<'_> {
    fn create(&mut self, job: Option<HANDLE>) -> Win32Result<PROCESS_INFORMATION> {
        let mut startup: STARTUPINFOEXW = zeroed();
        startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as DWORD;
        // Without `STARTF_USESTDHANDLES` the child may get duplicates of this process's handles, which win over a pseudoconsole.
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
        startup.StartupInfo.wShowWindow = self.show_window;

        let mut reserved2;
        // What the child inherits.
        let mut handles: &[HANDLE] = &[];
        if let Some(stdio) = self.stdio {
            reserved2 = stdio.reserved2();
            startup.StartupInfo.cbReserved2 = reserved2.len() as u16;
            startup.StartupInfo.lpReserved2 = reserved2.as_mut_ptr();
            startup.StartupInfo.hStdInput = stdio.slots[0].handle;
            startup.StartupInfo.hStdOutput = stdio.slots[1].handle;
            startup.StartupInfo.hStdError = stdio.slots[2].handle;
            handles = &stdio.inheritable;
        }

        let mut attributes = AttributeList::new(3)?;
        // SAFETY: what the list is given lives until the end of this function, as the list does.
        unsafe {
            // An empty list is an error.
            if !handles.is_empty() {
                attributes.set(
                    PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                    handles.as_ptr().cast(),
                    size_of_val(handles),
                )?;
            }
            // In the job from its first instruction, rather than from some time after it started.
            if let Some(job) = &job {
                attributes.set(
                    PROC_THREAD_ATTRIBUTE_JOB_LIST,
                    from_ref(job).cast(),
                    size_of::<HANDLE>(),
                )?;
            }
            if let Some(pseudoconsole) = self.pseudoconsole {
                attributes.set(
                    PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                    pseudoconsole,
                    size_of::<HPCON>(),
                )?;
            }
        }
        startup.lpAttributeList = attributes.as_mut_ptr();

        // A child inherits whether Ctrl+C is ignored (a process started detached ignores it), and its terminal's Ctrl+C is meant for it.
        let changes_ctrl_c = self.pseudoconsole.map(|_| IGNORES_CTRL_C.write());
        let _keeps_ctrl_c = changes_ctrl_c.is_none().then(|| IGNORES_CTRL_C.read());
        // SAFETY: the block and its parameters last as long as the process.
        let ignores_ctrl_c = changes_ctrl_c.is_some()
            && unsafe { (*(*peb()).ProcessParameters).ConsoleFlags } & 1 != 0;
        if ignores_ctrl_c {
            kernel32::SetConsoleCtrlHandler(None, FALSE);
        }
        let mut info: PROCESS_INFORMATION = zeroed();
        // The application is named in full: the search of `CreateProcessW` starts at bun.exe and goes by this process's `PATH`.
        // SAFETY: the strings are NUL-terminated, the environment ends with an empty string, and
        // everything that `startup` points to is alive.
        let ok = unsafe {
            kernel32::CreateProcessW(
                self.application.as_ptr(),
                self.command_line.as_mut_ptr(),
                null_mut(),
                null_mut(),
                BOOL::from(!handles.is_empty()),
                self.flags,
                self.environment
                    .map_or(null_mut(), |block| block.as_ptr().cast_mut().cast()),
                self.cwd.as_ptr(),
                &raw mut startup.StartupInfo,
                &raw mut info,
            )
        };
        let result = if ok == FALSE {
            Err(Win32Error::get())
        } else {
            Ok(info)
        };
        if ignores_ctrl_c {
            kernel32::SetConsoleCtrlHandler(None, TRUE);
        }
        result
    }

    fn create_in_job(&mut self) -> Win32Result<PROCESS_INFORMATION> {
        let Some(current) = job::current() else {
            return self.create(None);
        };
        match self.create(Some(current)) {
            Err(Win32Error::ACCESS_DENIED) => {}
            result => return result,
        }
        // A job takes no more members once this process joined a later job, or if its first member was a packaged app.
        if let Some(fresh) = job::create() {
            match self.create(Some(fresh)) {
                Ok(info) => {
                    job::replace(current, fresh);
                    return Ok(info);
                }
                Err(error) => {
                    close(fresh);
                    if error != Win32Error::ACCESS_DENIED {
                        return Err(error);
                    }
                }
            }
        }
        self.create(None)
    }
}

/// Stands for the attribute of this process that every thread's `CreateProcessW` hands down.
static IGNORES_CTRL_C: bun_core::RwLock<()> = bun_core::RwLock::new(());

/// `CreateProcessW` takes 32,767 units, the NUL included.
const MAX_COMMAND_LINE: usize = 32_767;

/// The limit is Node's; the size of `lpReserved2` would allow for more.
const MAX_STDIO: usize = 255;

/// # Safety
/// `argv` is a null-terminated array of NUL-terminated strings, and `envp` is one or null, which
/// gives the child a copy of this process's environment. So is `options.argv0`, a string.
pub unsafe fn spawn_process_windows(
    options: &SpawnOptions,
    argv: Argv,
    envp: Envp,
) -> crate::Result<bun_sys::Result<SpawnResult>> {
    bun_analytics::features::spawn.fetch_add(1, Ordering::Relaxed);
    // SAFETY: caller contract.
    Ok(unsafe { spawn(options, argv, envp) })
}

fn error(code: Win32Error) -> bun_sys::Error {
    bun_sys::Error::from_win32(code, Tag::CreateProcessW)
}

unsafe fn spawn(options: &SpawnOptions, argv: Argv, envp: Envp) -> bun_sys::Result<SpawnResult> {
    if options.uid.is_some() || options.gid.is_some() {
        return Err(error(Win32Error::NOT_SUPPORTED));
    }
    // SAFETY: `argv` has its terminator at least.
    let file = options.argv0.unwrap_or_else(|| unsafe { *argv });
    if file.is_null() {
        return Err(error(Win32Error::INVALID_PARAMETER));
    }
    let mut application = Vec::new();
    // SAFETY: caller contract.
    push_wide(
        &mut application,
        unsafe { bun_core::ffi::cstr(file) }.to_bytes(),
    );

    // SAFETY: caller contract.
    let mut command_line = unsafe { command_line(argv, options.windows.verbatim_arguments) };
    // SAFETY: caller contract.
    let environment = (!envp.is_null()).then(|| unsafe { environment_block(envp) });

    let mut cwd = Vec::new();
    if options.cwd.is_empty() {
        cwd = current_directory().map_err(error)?;
    } else {
        push_wide(&mut cwd, &options.cwd);
    }
    if cwd.len() > MAX_CWD {
        shorten_cwd(&mut cwd);
    }

    let inherited_path;
    let path = match environment.as_deref().and_then(path_variable) {
        Some(path) => Some(path),
        None => {
            inherited_path = getenv_w(w!("PATH\0"));
            inherited_path.as_deref()
        }
    };

    let mut result = SpawnResult::default();
    let mut stdio = ChildStdio {
        slots: Vec::with_capacity(3 + options.extra_fds.len()),
        inheritable: Vec::with_capacity(3 + options.extra_fds.len()),
        ours: Vec::new(),
        inherits: false,
    };
    if options.pseudoconsole.is_none() {
        if 3 + options.extra_fds.len() > MAX_STDIO {
            return Err(error(Win32Error::NOT_SUPPORTED));
        }
        open_stdio(options, &mut stdio, &mut result)?;
    }

    let Some(application) = search_path(&application, &cwd, path) else {
        return Err(error(Win32Error::FILE_NOT_FOUND));
    };
    if command_line.len() > MAX_COMMAND_LINE {
        return Err(error(Win32Error::FILENAME_EXCED_RANGE));
    }
    cwd.push(NUL);

    let mut flags = CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT;
    if options.pseudoconsole.is_none() {
        // A child with a hidden console of its own has no use for handles to this process's console.
        if options.windows.hide_window && !stdio.inherits {
            flags |= CREATE_NO_WINDOW;
        }
        if options.detached {
            flags |= DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
        }
    }

    let mut request = Request {
        application: &application,
        command_line: &mut command_line,
        environment: environment.as_deref(),
        cwd: &cwd,
        flags,
        show_window: if options.windows.hide_window {
            SW_HIDE
        } else {
            SW_SHOWDEFAULT
        },
        stdio: options.pseudoconsole.is_none().then_some(&stdio),
        pseudoconsole: options.pseudoconsole,
    };
    let info = if options.detached {
        request.create(None)
    } else {
        request.create_in_job()
    }
    .map_err(|code| match code {
        // The current directory is not one. Node reports that like a missing file.
        Win32Error::DIRECTORY => bun_sys::Error::from_code(E::ENOENT, Tag::CreateProcessW),
        code => error(code),
    })?;
    close(info.hThread);

    stdio.ours.clear();
    result.pid = info.dwProcessId as PidT;
    result.process_handle = Some(Fd::from_system(info.hProcess));
    Ok(result)
}

fn open_stdio(
    options: &SpawnOptions,
    stdio: &mut ChildStdio,
    result: &mut SpawnResult,
) -> bun_sys::Result<()> {
    let standard = [
        (&options.stdin, &mut result.stdin),
        (&options.stdout, &mut result.stdout),
        (&options.stderr, &mut result.stderr),
    ];
    for (i, (option, ours)) in standard.into_iter().enumerate() {
        match option {
            Stdio::Inherit => {
                if !stdio
                    .add_duplicate(Fd::from_crt(i as c_int).native())
                    .map_err(error)?
                {
                    stdio.add_closed();
                }
            }
            Stdio::Ignore | Stdio::Ipc => stdio.add_null_device().map_err(error)?,
            Stdio::Path(path) => {
                stdio.add_file(path, if i == 0 { O::RDONLY } else { O::WRONLY })?;
            }
            // Few programs can do anything with a standard handle that is overlapped.
            Stdio::Buffer => {
                *ours = Some(stdio.add_pipe(options.windows.overlapped_stdio[i])?);
            }
            Stdio::Pipe(fd) => {
                if !stdio.add_duplicate(fd.native()).map_err(error)? {
                    return Err(error(Win32Error::INVALID_HANDLE));
                }
                *ours = Some(*fd);
            }
            // Filled in below, once the slot that it refers to is.
            Stdio::Dup2(_) => stdio.add_closed(),
            Stdio::SocketFd => unreachable!("SocketFd at stdin/stdout/stderr"),
        }
    }
    for option in [&options.stdin, &options.stdout, &options.stderr] {
        if let Stdio::Dup2(dup2) = option {
            let index = |kind: StdioKind| match kind {
                StdioKind::Stdin => 0,
                StdioKind::Stdout => 1,
                StdioKind::Stderr => 2,
            };
            // A handle of its own, as `dup2` makes a descriptor of its own: the child may close either.
            let to = stdio.slots[index(dup2.to)].handle;
            if stdio.add_duplicate(to).map_err(error)? {
                stdio.slots.swap_remove(index(dup2.out));
            }
        }
    }

    result.extra_pipes.reserve_exact(options.extra_fds.len());
    for (i, option) in options.extra_fds.iter().enumerate() {
        result.extra_pipes.push(match option {
            Stdio::Inherit => {
                if !stdio
                    .add_duplicate(Fd::from_crt(3 + i as c_int).native())
                    .map_err(error)?
                {
                    return Err(error(Win32Error::INVALID_HANDLE));
                }
                ExtraPipe::Unavailable
            }
            Stdio::Ignore => {
                stdio.add_closed();
                ExtraPipe::Unavailable
            }
            Stdio::Path(path) => {
                stdio.add_file(path, O::RDWR)?;
                ExtraPipe::Unavailable
            }
            Stdio::Ipc | Stdio::Buffer | Stdio::SocketFd => {
                ExtraPipe::OwnedFd(stdio.add_pipe(true)?)
            }
            Stdio::Pipe(fd) => {
                if !stdio.add_duplicate(fd.native()).map_err(error)? {
                    return Err(error(Win32Error::INVALID_HANDLE));
                }
                ExtraPipe::UnownedFd(*fd)
            }
            Stdio::Dup2(_) => panic!("TODO dup2 extra fd"),
        });
    }
    Ok(())
}

// ── Waiting and ending ──

/// The exit code of `process`, or `None` if it is still running and `block` is false.
pub fn wait(process: HANDLE, block: bool) -> bun_sys::Result<Option<u32>> {
    let failed = || bun_sys::Error::from_win32(Win32Error::get(), Tag::waitpid);
    match kernel32::WaitForSingleObject(process, if block { INFINITE } else { 0 }) {
        WAIT_OBJECT_0 => {}
        WAIT_TIMEOUT => return Ok(None),
        _ => return Err(failed()),
    }
    let mut code: DWORD = 0;
    if kernel32::GetExitCodeProcess(process, &mut code) == FALSE {
        return Err(failed());
    }
    Ok(Some(code))
}

const SIGINT: c_int = SignalCode::SIGINT as c_int;
const SIGQUIT: c_int = SignalCode::SIGQUIT as c_int;
const SIGKILL: c_int = SignalCode::SIGKILL as c_int;
const SIGTERM: c_int = SignalCode::SIGTERM as c_int;
/// As libuv's uv/win.h defines it, to take in SIGWINCH. The C runtime's is 23.
const NSIG: c_int = SignalCode::SIGWINCH as c_int + 1;

/// No signals: SIGINT, SIGQUIT, SIGKILL and SIGTERM end `process` with exit code 1, 0 asks whether it runs, the rest is ENOSYS.
pub fn kill(process: HANDLE, signal: c_int) -> bun_sys::Result<()> {
    let errno = |code: E| Err(bun_sys::Error::from_code(code, Tag::kill));
    let failed = |code: Win32Error| Err(bun_sys::Error::from_win32(code, Tag::kill));
    let exit_code = || {
        let mut code: DWORD = 0;
        (kernel32::GetExitCodeProcess(process, &mut code) != FALSE).then_some(code)
    };

    match signal {
        SIGINT | SIGQUIT | SIGKILL | SIGTERM => {
            if kernel32::TerminateProcess(process, 1) != FALSE {
                return Ok(());
            }
            let code = Win32Error::get();
            // Also the answer for a process that has ended, whose exit code can itself be `STILL_ACTIVE`.
            if code == Win32Error::ACCESS_DENIED
                && (exit_code().is_some_and(|code| code != STILL_ACTIVE)
                    || kernel32::WaitForSingleObject(process, 0) == WAIT_OBJECT_0)
            {
                return errno(E::ESRCH);
            }
            failed(code)
        }
        0 => match exit_code() {
            None => failed(Win32Error::get()),
            Some(STILL_ACTIVE) => match kernel32::WaitForSingleObject(process, 0) {
                WAIT_TIMEOUT => Ok(()),
                WAIT_OBJECT_0 => errno(E::ESRCH),
                WAIT_FAILED => failed(Win32Error::get()),
                _ => errno(E::EUNKNOWN),
            },
            Some(_) => errno(E::ESRCH),
        },
        1..NSIG => errno(E::ENOSYS),
        _ => errno(E::EINVAL),
    }
}

/// [`kill`] for a process that this one may not have started. 0 is this process.
pub fn kill_pid(pid: PidT, signal: c_int) -> bun_sys::Result<()> {
    if pid == 0 {
        return kill(kernel32::GetCurrentProcess(), signal);
    }
    // SAFETY: every argument is passed by value.
    let process = unsafe {
        OpenProcess(
            PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION | SYNCHRONIZE,
            FALSE,
            pid as DWORD,
        )
    };
    if process.is_null() {
        return Err(match Win32Error::get() {
            Win32Error::INVALID_PARAMETER => bun_sys::Error::from_code(E::ESRCH, Tag::kill),
            code => bun_sys::Error::from_win32(code, Tag::kill),
        });
    }
    let result = kill(process, signal);
    close(process);
    result
}

pub fn rusage(process: HANDLE) -> WinRusage {
    fn set(time: &mut crate::spawn_process::WinTimeval, ticks: FILETIME) {
        // 100 ns each.
        let ticks = u64::from(ticks.dwHighDateTime) << 32 | u64::from(ticks.dwLowDateTime);
        time.sec = (ticks / 10_000_000) as i64;
        time.usec = (ticks % 10_000_000 / 10) as i64;
    }

    let mut usage = WinRusage::default();

    let [mut created, mut exited, mut kernel, mut user]: [FILETIME; 4] = zeroed();
    if GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user) != FALSE {
        set(&mut usage.stime, kernel);
        set(&mut usage.utime, user);
    }

    let mut counters = IoCounters::default();
    if GetProcessIoCounters(process, &mut counters) != FALSE {
        usage.inblock = counters.ReadOperationCount;
        usage.oublock = counters.WriteOperationCount;
    }

    if let Ok(memory) = bun_sys::windows::GetProcessMemoryInfo(process) {
        usage.maxrss = memory.PeakWorkingSetSize as u64;
    }

    usage
}
