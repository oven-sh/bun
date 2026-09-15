//! Process creation on Windows: `CreateProcessW` with an explicit handle list.

use core::ffi::c_void;
use core::ptr;
use core::sync::atomic::Ordering;

use bun_core::DecodeWindows;
use bun_sys::{E, Fd, Tag};

use crate::spawn_process::{ExtraPipe, SpawnOptions, SpawnResult, Stdio};
use crate::{Argv, Envp};

pub mod args;
pub mod env;
pub mod job;
pub mod kill;
pub mod search_path;
pub mod stdio;
pub mod win32;

pub use kill::{kill, kill_pid};

use stdio::{ChildFd, ChildPipe};
use win32::{DWORD, HANDLE, INVALID_HANDLE_VALUE};

/// Windows-only spawn options.
#[derive(Clone, Copy)]
pub struct WindowsOptions {
    /// Join the arguments with spaces as they are instead of quoting them.
    pub verbatim_arguments: bool,
    /// No console window and a hidden main window for the child.
    pub hide_window: bool,
    /// Give the child an overlapped end of the pipe for stdin/stdout/stderr
    /// (`Stdio::Buffer`). Only for a child known to do overlapped I/O on its
    /// std handles. Pipes at fd 3 and above always have an overlapped child end.
    pub overlapped_stdio: [bool; 3],
}

impl Default for WindowsOptions {
    fn default() -> Self {
        Self {
            verbatim_arguments: false,
            hide_window: true,
            overlapped_stdio: [false; 3],
        }
    }
}

/// The handles the child inherits, and the parent ends of the pipes made for it.
/// Every fd of the child has a handle of its own: its C runtime closes them one
/// by one, and a value in two slots would be closed twice.
struct ChildStdio {
    fds: Vec<ChildFd>,
    /// Child-side handles this spawn made, closed once the child has its copies
    /// (or was not created); a pipe only reports EOF when no writer is left.
    to_close: Vec<HANDLE>,
    parent_ends: Vec<HANDLE>,
    keep_parent_ends: bool,
}

impl Drop for ChildStdio {
    fn drop(&mut self) {
        for &handle in &self.to_close {
            // SAFETY: handles this spawn created and still owns.
            unsafe { win32::CloseHandle(handle) };
        }
        if !self.keep_parent_ends {
            for &handle in &self.parent_ends {
                // SAFETY: see above.
                unsafe { win32::CloseHandle(handle) };
            }
        }
    }
}

impl ChildStdio {
    fn nul(&mut self, writable: bool) -> Result<ChildFd, DWORD> {
        let handle = stdio::open_nul(writable)?;
        self.to_close.push(handle);
        Ok(ChildFd {
            handle,
            crt_flags: stdio::FOPEN | stdio::FDEV,
        })
    }

    /// Another fd for what `fd` is open on (`2>&1`): a second handle to the
    /// same file object, so the two share its position.
    fn alias(&mut self, fd: ChildFd) -> Result<ChildFd, DWORD> {
        if fd.handle == INVALID_HANDLE_VALUE {
            return Ok(fd);
        }
        let handle = stdio::duplicate_inheritable(fd.handle)?;
        self.to_close.push(handle);
        Ok(ChildFd {
            handle,
            crt_flags: fd.crt_flags,
        })
    }

    fn inherit(&mut self, source: HANDLE) -> Result<ChildFd, DWORD> {
        let handle = stdio::duplicate_inheritable(source)?;
        self.to_close.push(handle);
        Ok(ChildFd {
            handle,
            crt_flags: stdio::crt_flags_for(handle)?,
        })
    }

    fn pipe(&mut self, child: ChildPipe) -> Result<(ChildFd, Fd), DWORD> {
        let pair = stdio::create_pipe_pair(child)?;
        self.to_close.push(pair.child);
        self.parent_ends.push(pair.parent);
        Ok((
            ChildFd {
                handle: pair.child,
                crt_flags: stdio::FOPEN | stdio::FPIPE,
            },
            Fd::from_system(pair.parent),
        ))
    }
}

enum Slot {
    Fd(ChildFd),
    /// The parent end of a pipe made for this slot.
    Piped(ChildFd, Fd),
    /// A handle the caller supplied.
    Supplied(ChildFd, Fd),
}

fn make_slot(
    stdio: &mut ChildStdio,
    option: &Stdio,
    index: usize,
    options: &SpawnOptions,
) -> Result<Slot, bun_sys::Error> {
    let spawn_error = |code: DWORD| win32::sys_error(code, Tag::uv_spawn);
    let duplex = |overlapped: bool| ChildPipe {
        readable: true,
        writable: true,
        overlapped,
    };
    match option {
        Stdio::Inherit => {
            let source = Fd::from_crt(index as i32).native();
            match stdio.inherit(source) {
                Ok(fd) => Ok(Slot::Fd(fd)),
                // A process without a console has no std handles to pass on.
                Err(win32::ERROR_INVALID_HANDLE) if index <= 2 => Ok(Slot::Fd(ChildFd::CLOSED)),
                Err(code) => Err(spawn_error(code)),
            }
        }
        Stdio::Ignore => {
            if index <= 2 {
                stdio.nul(index != 0).map(Slot::Fd).map_err(spawn_error)
            } else {
                Ok(Slot::Fd(ChildFd::CLOSED))
            }
        }
        Stdio::Ipc if index <= 2 => stdio.nul(index != 0).map(Slot::Fd).map_err(spawn_error),
        Stdio::Ipc => stdio
            .pipe(duplex(true))
            .map(|(fd, parent)| Slot::Piped(fd, parent))
            .map_err(spawn_error),
        Stdio::Buffer | Stdio::SocketFd => {
            let overlapped = index > 2 || options.windows.overlapped_stdio[index];
            stdio
                .pipe(duplex(overlapped))
                .map(|(fd, parent)| Slot::Piped(fd, parent))
                .map_err(spawn_error)
        }
        Stdio::Path(path) => {
            let access = match index {
                0 => bun_sys::O::RDONLY,
                1 | 2 => bun_sys::O::WRONLY,
                _ => bun_sys::O::RDWR,
            };
            let handle = bun_sys::open_a(path, access | bun_sys::O::CREAT, 0o664)?.native();
            stdio.to_close.push(handle);
            if win32::SetHandleInformation(
                handle,
                win32::HANDLE_FLAG_INHERIT,
                win32::HANDLE_FLAG_INHERIT,
            ) == 0
            {
                return Err(win32::last_error(Tag::uv_spawn));
            }
            Ok(Slot::Fd(ChildFd {
                handle,
                crt_flags: stdio::crt_flags_for(handle).map_err(spawn_error)?,
            }))
        }
        Stdio::Pipe(fd) => match stdio.inherit(fd.native()) {
            Ok(child) => Ok(Slot::Supplied(child, *fd)),
            Err(win32::ERROR_INVALID_HANDLE)
                if matches!(fd.decode_windows(), DecodeWindows::Crt(0..=2)) =>
            {
                Ok(Slot::Fd(ChildFd::CLOSED))
            }
            Err(code) => Err(spawn_error(code)),
        },
        Stdio::Dup2(_) => unreachable!("resolved by the caller"),
    }
}

/// Owns a `PROC_THREAD_ATTRIBUTE_LIST`. The values it points at are borrowed
/// until `CreateProcessW` returns.
struct AttributeList {
    // Pointer-aligned backing storage.
    buf: Vec<usize>,
}

impl AttributeList {
    fn new(count: DWORD) -> Result<Self, DWORD> {
        let mut size: usize = 0;
        // SAFETY: the sizing call; it fails with ERROR_INSUFFICIENT_BUFFER by design.
        unsafe { win32::InitializeProcThreadAttributeList(ptr::null_mut(), count, 0, &mut size) };
        let mut buf = vec![0usize; size.div_ceil(size_of::<usize>())];
        // SAFETY: `buf` holds at least `size` bytes.
        if unsafe {
            win32::InitializeProcThreadAttributeList(buf.as_mut_ptr().cast(), count, 0, &mut size)
        } == 0
        {
            return Err(win32::GetLastError());
        }
        Ok(Self { buf })
    }

    /// # Safety
    /// `value` must stay valid, unmoved, until this list is dropped.
    unsafe fn set(
        &mut self,
        attribute: usize,
        value: *const c_void,
        size: usize,
    ) -> Result<(), DWORD> {
        // SAFETY: the list was initialized in `new`; `value` per the caller.
        if unsafe {
            win32::UpdateProcThreadAttribute(
                self.buf.as_mut_ptr().cast(),
                0,
                attribute,
                value,
                size,
                ptr::null_mut(),
                ptr::null_mut(),
            )
        } == 0
        {
            return Err(win32::GetLastError());
        }
        Ok(())
    }

    fn as_mut_ptr(&mut self) -> *mut u8 {
        self.buf.as_mut_ptr().cast()
    }
}

impl Drop for AttributeList {
    fn drop(&mut self) {
        // SAFETY: initialized in `new`.
        unsafe { win32::DeleteProcThreadAttributeList(self.buf.as_mut_ptr().cast()) };
    }
}

fn c_str_bytes<'a>(s: *const core::ffi::c_char) -> &'a [u8] {
    // SAFETY: callers pass NUL-terminated strings (`spawn_process_windows` contract).
    unsafe { core::ffi::CStr::from_ptr(s) }.to_bytes()
}

/// # Safety
/// `list` is null or points to a null-terminated array of NUL-terminated strings.
unsafe fn c_str_array<'a>(list: *const *const core::ffi::c_char) -> impl Iterator<Item = &'a [u8]> {
    let mut i = 0usize;
    core::iter::from_fn(move || {
        if list.is_null() {
            return None;
        }
        // SAFETY: the array is null-terminated and `i` has not passed the terminator.
        let s = unsafe { *list.add(i) };
        if s.is_null() {
            return None;
        }
        i += 1;
        Some(c_str_bytes(s))
    })
}

fn file_exists(path: &[u16]) -> bool {
    // SAFETY: `path` is NUL-terminated (`search_path` contract).
    let attributes = unsafe { win32::GetFileAttributesW(path.as_ptr()) };
    attributes != win32::INVALID_FILE_ATTRIBUTES
        && attributes & win32::FILE_ATTRIBUTE_DIRECTORY == 0
}

fn current_directory() -> Result<Vec<u16>, DWORD> {
    let mut buf: Vec<u16> = vec![0; win32::MAX_PATH];
    loop {
        // SAFETY: `buf` holds `buf.len()` units.
        let n =
            unsafe { win32::GetCurrentDirectoryW(buf.len() as DWORD, buf.as_mut_ptr()) } as usize;
        if n == 0 {
            return Err(win32::GetLastError());
        }
        if n < buf.len() {
            buf.truncate(n);
            return Ok(buf);
        }
        buf.resize(n, 0);
    }
}

/// Starts the program `argv` names.
///
/// `options.argv0`, else `argv[0]`, names the image; it is looked up with the
/// rules in [`search_path`] against the child's directory and `PATH`. A null
/// `envp` gives the child this process's environment. Pipes are created here;
/// their parent ends come back in the result as overlapped, non-inheritable
/// handles that are not associated with any completion port.
///
/// # Safety
/// `argv` must point to a null-terminated array of NUL-terminated C strings
/// with at least one element; `envp` must be null or point to such an array.
/// Both must remain valid for the duration of the call.
pub unsafe fn spawn_process_windows(
    options: &SpawnOptions,
    argv: Argv,
    envp: Envp,
) -> crate::Result<bun_sys::Result<SpawnResult>> {
    bun_analytics::features::spawn.fetch_add(1, Ordering::Relaxed);
    // SAFETY: forwarded from this function's contract.
    Ok(unsafe { spawn(options, argv, envp) })
}

unsafe fn spawn(options: &SpawnOptions, argv: Argv, envp: Envp) -> bun_sys::Result<SpawnResult> {
    let spawn_error = |code: DWORD| win32::sys_error(code, Tag::uv_spawn);

    if options.uid.is_some() || options.gid.is_some() {
        return Err(bun_sys::Error::from_code(E::ENOTSUP, Tag::uv_spawn));
    }

    // SAFETY: `argv` has at least one element (caller contract).
    let file = c_str_bytes(options.argv0.unwrap_or_else(|| unsafe { *argv }));
    let mut application: Vec<u16> = Vec::new();
    args::push_wtf8(&mut application, file);

    // SAFETY: caller contract.
    let mut command_line = args::make_command_line(
        unsafe { c_str_array(argv) },
        options.windows.verbatim_arguments,
    );

    let mut env_block: Option<Vec<u16>> = if envp.is_null() {
        None
    } else {
        // SAFETY: caller contract.
        Some(env::make_env_block(
            unsafe { c_str_array(envp) },
            env::compare_names_ordinal,
            env::parent_value,
        ))
    };

    // NUL-terminated when present.
    let mut cwd: Option<Vec<u16>> = None;
    if !options.cwd.is_empty() {
        let mut wide: Vec<u16> = Vec::new();
        args::push_wtf8(&mut wide, &options.cwd);
        wide.push(0);
        // lpCurrentDirectory is limited to MAX_PATH; the short form may fit.
        if wide.len() > win32::MAX_PATH {
            let capacity = wide.len();
            // SAFETY: in-place conversion; `wide` holds `capacity` units and is NUL-terminated.
            let n = unsafe {
                win32::GetShortPathNameW(wide.as_ptr(), wide.as_mut_ptr(), capacity as DWORD)
            } as usize;
            if n == 0 {
                return Err(win32::last_error(Tag::uv_spawn));
            }
            if n < capacity {
                wide.truncate(n + 1);
            }
        }
        cwd = Some(wide);
    }

    let application_path = {
        let inherited_cwd;
        let search_cwd: &[u16] = match &cwd {
            Some(cwd) => &cwd[..cwd.len() - 1],
            None if search_path::needs_cwd(&application) => {
                inherited_cwd = current_directory().map_err(spawn_error)?;
                &inherited_cwd
            }
            None => &[],
        };
        let mut parent_path: Vec<u16> = Vec::new();
        let mut cwd_first = false;
        let path: &[u16] = if search_path::needs_path(&application) {
            // SAFETY: an empty NUL-terminated string.
            cwd_first = unsafe { win32::NeedCurrentDirectoryForExePathW([0u16].as_ptr()) } != 0;
            match env_block.as_deref().and_then(env::find_path) {
                Some(path) => path,
                None => {
                    env::parent_value(env::PATH, &mut parent_path);
                    &parent_path
                }
            }
        } else {
            &[]
        };
        search_path::search_path(&application, search_cwd, path, cwd_first, &mut file_exists)
    };
    let Some(application_path) = application_path else {
        return Err(spawn_error(win32::ERROR_FILE_NOT_FOUND));
    };

    let stdio_count = 3 + options.extra_fds.len();
    if stdio_count > stdio::MAX_STDIO {
        return Err(spawn_error(win32::ERROR_NOT_SUPPORTED));
    }

    let mut result = SpawnResult::default();
    let mut child_stdio = ChildStdio {
        fds: Vec::new(),
        to_close: Vec::new(),
        parent_ends: Vec::new(),
        keep_parent_ends: false,
    };
    // A child on a pseudoconsole gets its std handles from it and nothing else.
    let use_stdio = options.pseudoconsole.is_none();
    let mut any_inherited = false;
    if use_stdio {
        child_stdio.fds = vec![ChildFd::CLOSED; stdio_count];
        let std_options: [&Stdio; 3] = [&options.stdin, &options.stdout, &options.stderr];
        let mut parent_fds: [Option<Fd>; 3] = [None; 3];
        let mut inherited = [false; 3];
        for (i, &option) in std_options.iter().enumerate() {
            if matches!(option, Stdio::Dup2(_)) {
                continue;
            }
            inherited[i] = matches!(option, Stdio::Inherit | Stdio::Path(_) | Stdio::Pipe(_));
            match make_slot(&mut child_stdio, option, i, options)? {
                Slot::Fd(fd) => child_stdio.fds[i] = fd,
                Slot::Piped(fd, parent) | Slot::Supplied(fd, parent) => {
                    child_stdio.fds[i] = fd;
                    parent_fds[i] = Some(parent);
                }
            }
        }
        for (i, &option) in std_options.iter().enumerate() {
            if let Stdio::Dup2(dup2) = option {
                let to = dup2.to as usize;
                let target = child_stdio.fds[to];
                child_stdio.fds[i] = child_stdio.alias(target).map_err(spawn_error)?;
                inherited[i] = inherited[to];
            }
        }
        any_inherited = inherited.contains(&true);
        [result.stdin, result.stdout, result.stderr] = parent_fds;

        result.extra_pipes.reserve_exact(options.extra_fds.len());
        for (i, option) in options.extra_fds.iter().enumerate() {
            if matches!(option, Stdio::Dup2(_)) {
                panic!("TODO dup2 extra fd");
            }
            any_inherited |= matches!(option, Stdio::Inherit | Stdio::Path(_) | Stdio::Pipe(_));
            result
                .extra_pipes
                .push(match make_slot(&mut child_stdio, option, 3 + i, options)? {
                    Slot::Fd(fd) => {
                        child_stdio.fds[3 + i] = fd;
                        ExtraPipe::Unavailable
                    }
                    Slot::Piped(fd, parent) => {
                        child_stdio.fds[3 + i] = fd;
                        ExtraPipe::OwnedFd(parent)
                    }
                    Slot::Supplied(fd, parent) => {
                        child_stdio.fds[3 + i] = fd;
                        ExtraPipe::UnownedFd(parent)
                    }
                });
        }
    } else {
        result
            .extra_pipes
            .resize_with(options.extra_fds.len(), || ExtraPipe::Unavailable);
    }

    let mut crt_block = stdio::make_crt_block(&child_stdio.fds);
    let handle_list = stdio::make_handle_list(&child_stdio.fds);

    // SAFETY: all-zero is a valid STARTUPINFOEXW.
    let mut startup: win32::STARTUPINFOEXW = unsafe { core::mem::zeroed() };
    // Always STARTF_USESTDHANDLES: without it the system duplicates this
    // process's own std handles into the child, handle list or not, which
    // would also override a pseudoconsole.
    startup.StartupInfo.dwFlags = win32::STARTF_USESTDHANDLES | win32::STARTF_USESHOWWINDOW;
    if use_stdio {
        startup.StartupInfo.cbReserved2 = crt_block.len() as u16;
        startup.StartupInfo.lpReserved2 = crt_block.as_mut_ptr();
        startup.StartupInfo.hStdInput = child_stdio.fds[0].handle;
        startup.StartupInfo.hStdOutput = child_stdio.fds[1].handle;
        startup.StartupInfo.hStdError = child_stdio.fds[2].handle;
    }
    startup.StartupInfo.wShowWindow = if options.windows.hide_window {
        win32::SW_HIDE
    } else {
        win32::SW_SHOWDEFAULT
    };

    let mut process_flags = win32::CREATE_UNICODE_ENVIRONMENT;
    // CREATE_NO_WINDOW puts the child on a console of its own, where console
    // handles inherited from this process do not work.
    if use_stdio && options.windows.hide_window && !any_inherited {
        process_flags |= win32::CREATE_NO_WINDOW;
    }
    if options.detached {
        // Not CREATE_BREAKAWAY_FROM_JOB: it fails the call under a job that
        // does not allow breakaway, and the job children are put in lets
        // their own children break away silently anyway.
        process_flags |= win32::DETACHED_PROCESS | win32::CREATE_NEW_PROCESS_GROUP;
    }

    let mut job: HANDLE = if options.detached {
        ptr::null_mut()
    } else {
        job::global_job().map_err(spawn_error)?
    };

    // SAFETY: all-zero is a valid PROCESS_INFORMATION.
    let mut info: win32::PROCESS_INFORMATION = unsafe { core::mem::zeroed() };
    loop {
        let attribute_count = DWORD::from(!handle_list.is_empty())
            + DWORD::from(!job.is_null())
            + DWORD::from(options.pseudoconsole.is_some());
        let mut attributes = if attribute_count == 0 {
            None
        } else {
            Some(AttributeList::new(attribute_count).map_err(spawn_error)?)
        };
        if let Some(attributes) = &mut attributes {
            // SAFETY: `handle_list`, `job` and the pseudoconsole outlive `attributes`.
            unsafe {
                if !handle_list.is_empty() {
                    attributes
                        .set(
                            win32::PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                            handle_list.as_ptr().cast(),
                            size_of_val(handle_list.as_slice()),
                        )
                        .map_err(spawn_error)?;
                }
                if !job.is_null() {
                    attributes
                        .set(
                            win32::PROC_THREAD_ATTRIBUTE_JOB_LIST,
                            ptr::from_ref(&job).cast(),
                            size_of::<HANDLE>(),
                        )
                        .map_err(spawn_error)?;
                }
                if let Some(pseudoconsole) = options.pseudoconsole {
                    attributes
                        .set(
                            win32::PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                            pseudoconsole.cast_const(),
                            size_of::<win32::HPCON>(),
                        )
                        .map_err(spawn_error)?;
                }
            }
        }
        let extended = match &mut attributes {
            Some(attributes) => {
                startup.StartupInfo.cb = size_of::<win32::STARTUPINFOEXW>() as DWORD;
                startup.lpAttributeList = attributes.as_mut_ptr();
                win32::EXTENDED_STARTUPINFO_PRESENT
            }
            None => {
                startup.StartupInfo.cb = size_of::<win32::STARTUPINFOW>() as DWORD;
                startup.lpAttributeList = ptr::null_mut();
                0
            }
        };

        // SAFETY: every pointer is valid for the call; the strings are NUL-terminated.
        let created = unsafe {
            win32::CreateProcessW(
                application_path.as_ptr(),
                command_line.as_mut_ptr(),
                ptr::null_mut(),
                ptr::null_mut(),
                // A handle list requires it, and restricts it to the list.
                i32::from(!handle_list.is_empty()),
                process_flags | extended,
                env_block
                    .as_mut()
                    .map_or(ptr::null_mut(), |block| block.as_mut_ptr().cast()),
                cwd.as_ref().map_or(ptr::null(), |cwd| cwd.as_ptr()),
                ptr::from_mut(&mut startup).cast(),
                &mut info,
            )
        };
        if created != 0 {
            break;
        }
        let code = win32::GetLastError();
        // A process in a job that cannot nest (before Windows 8, or an odd
        // sandbox) cannot put its children in another job. Such a parent must
        // still be able to spawn: go without ending the child with us.
        if code == win32::ERROR_ACCESS_DENIED && !job.is_null() {
            job = ptr::null_mut();
            continue;
        }
        return Err(spawn_error(code));
    }

    // SAFETY: the thread handle is ours and unused.
    unsafe { win32::CloseHandle(info.hThread) };

    child_stdio.keep_parent_ends = true;
    result.pid = info.dwProcessId as crate::PidT;
    result.process_handle = info.hProcess;
    Ok(result)
}
