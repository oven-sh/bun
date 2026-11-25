//! Process creation and termination.

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ptr;
use std::os::windows::io::{
    AsHandle as _, AsRawHandle as _, BorrowedHandle, FromRawHandle as _, OwnedHandle,
};
use std::sync::OnceLock;

use bun_core::{SignalCode, WStr};
use bun_windows_sys::externs::{self, WAIT_OBJECT_0};

use super::{
    BOOL, DWORD, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, HANDLE, HPCON,
    INVALID_FILE_ATTRIBUTES, INVALID_HANDLE_VALUE, NTSTATUS, PROCESS_INFORMATION, PseudoConsole,
    STARTUPINFOEXW, STARTUPINFOW, Win32Error, Win32ErrorExt as _, check, fill_utf16_buf, kernel32,
    kernel32_2,
};
use crate::windows_format::{command_line, crt_descriptors, environment};
use crate::{E, File};

#[link(name = "kernel32")]
unsafe extern "system" {
    fn NeedCurrentDirectoryForExePathW(ExeName: *const u16) -> BOOL;
}

#[link(name = "ntdll")]
unsafe extern "system" {
    safe fn RtlGetLastNtStatus() -> NTSTATUS;
}

fn with_wstr<R>(text: &mut Vec<u16>, f: impl FnOnce(&WStr) -> R) -> R {
    text.push(0);
    let result = f(WStr::from_slice_with_nul(text));
    text.pop();
    result
}

fn resolve_full_path(mut path: Vec<u16>) -> Result<Vec<u16>, Win32Error> {
    with_wstr(&mut path, super::get_full_path_name)
}

fn resolve_short_path(full_path: &[u16]) -> Result<Vec<u16>, Win32Error> {
    let mut path = command_line::add_verbatim_prefix(full_path);
    let short = with_wstr(&mut path, super::get_short_path_name)?;
    Ok(command_line::strip_verbatim_prefix(&short))
}

fn current_directory() -> Result<Vec<u16>, Win32Error> {
    fill_utf16_buf(|buffer| {
        // SAFETY: `buffer` is writable for the length passed.
        unsafe {
            externs::GetCurrentDirectoryW(buffer.len() as DWORD, buffer.as_mut_ptr()) as usize
        }
    })
}

fn read_env_var(name: &[u16]) -> Option<Vec<u16>> {
    super::getenv_w_allow_empty(WStr::from_slice_with_nul(&[name, &[0]].concat()))
}

/// `CreateProcessW` checks the file header before the extension.
fn has_dos_signature(path: &mut Vec<u16>) -> bool {
    let access = externs::GENERIC_READ;
    let share = crate::FILE_SHARE;
    let open = |path: &WStr| super::CreateFileW(path, access, share, externs::OPEN_EXISTING, 0);
    let mut magic = [0; 2];
    with_wstr(path, open).is_ok_and(|file| File::from(file).read_all(&mut magic).is_ok())
        && magic == *b"MZ"
}

/// Members are terminated when this process exits. Their children do not become members.
fn global_job() -> Option<BorrowedHandle<'static>> {
    static JOB: OnceLock<Option<OwnedHandle>> = OnceLock::new();
    let job = JOB.get_or_init(|| {
        let job = super::CreateJobObjectA().ok()?;
        let flags =
            super::JOB_LIMIT_FLAGS_KILL_TREE_ON_CLOSE | super::JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
        super::set_job_limit_flags(&job, flags).ok()?;
        // The first member fixes the job's position in the job hierarchy. If it is a Store app, no other process can join.
        let _ = super::AssignProcessToJobObject(&job, super::GetCurrentProcess());
        Some(job)
    });
    job.as_ref().map(OwnedHandle::as_handle)
}

/// A CRT file descriptor of the child.
pub struct Descriptor {
    handle: OwnedHandle,
    flags: u8,
}

impl Descriptor {
    pub fn from_pipe(handle: OwnedHandle) -> Result<Descriptor, Win32Error> {
        super::make_inheritable(handle.as_raw_handle())?;
        let flags = crt_descriptors::FOPEN | crt_descriptors::FPIPE;
        Ok(Descriptor { handle, flags })
    }

    pub fn duplicate(handle: HANDLE) -> Result<Descriptor, Win32Error> {
        let handle = super::duplicate_handle_inheritable(handle)?;
        let flags = match super::file_type(handle.as_raw_handle())? {
            super::FILE_TYPE_DISK => crt_descriptors::FOPEN,
            super::FILE_TYPE_PIPE => crt_descriptors::FOPEN | crt_descriptors::FPIPE,
            _ => crt_descriptors::FOPEN | crt_descriptors::FDEV,
        };
        Ok(Descriptor { handle, flags })
    }

    /// Not cached: duplicates of a synchronous handle share one lock.
    pub fn open_null_device(is_input: bool) -> Result<Descriptor, Win32Error> {
        let access = if is_input {
            externs::GENERIC_READ
        } else {
            externs::GENERIC_WRITE | externs::FILE_READ_ATTRIBUTES
        };
        let share = externs::FILE_SHARE_READ | externs::FILE_SHARE_WRITE;
        let name = bun_core::wstr!("\\\\.\\NUL");
        let handle = super::CreateFileW(name, access, share, externs::OPEN_EXISTING, 0)?;
        super::make_inheritable(handle.as_raw_handle())?;
        let flags = crt_descriptors::FOPEN | crt_descriptors::FDEV;
        Ok(Descriptor { handle, flags })
    }
}

#[derive(Copy, Clone)]
pub enum Console<'a> {
    Shared,
    /// A new console without a window.
    Hidden,
    Pseudo(&'a PseudoConsole),
}

/// Inheritable handles that the child gets besides its descriptors. They have the same values in the child.
#[derive(Copy, Clone)]
pub enum InheritedHandles {
    Explicit(Option<HANDLE>),
    /// For a child that replaces this process, as with `exec`.
    All,
}

/// The strings are UTF-16 and contain no NUL.
pub struct Invocation {
    pub file: Vec<u16>,
    /// Includes `argv[0]`.
    pub arguments: Vec<Vec<u16>>,
    pub has_verbatim_arguments: bool,
    pub environment: Vec<Vec<u16>>,
    /// `None` is the current directory of this process.
    pub cwd: Option<Vec<u16>>,
}

pub struct Options<'a> {
    /// At least three, at most `crt_descriptors::MAX_COUNT`. Ignored with `Console::Pseudo`.
    pub descriptors: &'a [Option<Descriptor>],
    pub inherited_handles: InheritedHandles,
    pub console: Console<'a>,
    pub hide_window: bool,
    /// The child has no console and is not terminated when this process exits.
    pub is_detached: bool,
    /// A job to assign the child to at creation.
    pub job: Option<BorrowedHandle<'a>>,
}

pub struct Child {
    pub handle: OwnedHandle,
    pub pid: u32,
}

/// Borrows the attribute values. `DeleteProcThreadAttributeList` only ends that borrow, so it is not called.
struct ProcThreadAttributeList<'a> {
    storage: [usize; 16],
    _values: core::marker::PhantomData<&'a [HANDLE]>,
}

impl<'a> ProcThreadAttributeList<'a> {
    fn new(attribute_count: DWORD) -> Result<Box<Self>, Win32Error> {
        let mut this = Box::new(ProcThreadAttributeList {
            storage: [0; 16],
            _values: core::marker::PhantomData,
        });
        let mut size = size_of_val(&this.storage);
        // SAFETY: `storage` is writable for `size` bytes.
        check(unsafe {
            externs::InitializeProcThreadAttributeList(
                this.as_mut_ptr(),
                attribute_count,
                0,
                &raw mut size,
            )
        })?;
        Ok(this)
    }

    fn as_mut_ptr(&mut self) -> *mut u8 {
        self.storage.as_mut_ptr().cast()
    }

    /// SAFETY: `value` and `size` are valid for `attribute`, and what `value` points to lives for `'a`.
    unsafe fn set(
        &mut self,
        attribute: usize,
        value: *const c_void,
        size: usize,
    ) -> Result<(), Win32Error> {
        // SAFETY: fn contract, and `new` initialized the list.
        check(unsafe {
            externs::UpdateProcThreadAttribute(
                self.as_mut_ptr(),
                0,
                attribute,
                value,
                size,
                ptr::null_mut(),
                ptr::null_mut(),
            )
        })
    }

    fn set_handles(&mut self, attribute: usize, handles: &'a [HANDLE]) -> Result<(), Win32Error> {
        // SAFETY: both callers pass an attribute whose value is an array of handles.
        unsafe { self.set(attribute, handles.as_ptr().cast(), size_of_val(handles)) }
    }
}

/// The NUL-terminated string arguments of `CreateProcessW`.
pub struct Command {
    program: Vec<u16>,
    command_line: Vec<u16>,
    cwd: Vec<u16>,
    environment: Vec<u16>,
    /// `program` may be an app execution alias, which starts in its own job.
    is_reparse_point: bool,
}

impl Command {
    pub fn resolve(invocation: Invocation) -> Result<Command, E> {
        const MAX_PATH: usize = 260;
        let mut cwd = invocation
            .cwd
            .map_or_else(current_directory, resolve_full_path)
            .map_err(Win32Error::to_node_errno)?;
        // `CreateProcessW` fails unless the directory, a separator and a NUL fit in `MAX_PATH`, even for an inherited directory.
        if cwd.len() + 2 > MAX_PATH {
            cwd = resolve_short_path(&cwd).map_err(Win32Error::to_node_errno)?;
        }
        let entries = invocation.environment.into_iter();
        let environment = environment::build(entries, read_env_var, super::to_upper);

        let search = command_line::SearchOptions {
            cwd: &cwd,
            path_env: &environment.path_env,
            // SAFETY: the name is NUL-terminated.
            should_check_cwd: unsafe { NeedCurrentDirectoryForExePathW(WStr::EMPTY.as_ptr()) } != 0,
        };
        let program_attributes = Cell::new(0);
        let is_file = |path: &mut Vec<u16>| {
            // An app execution alias cannot be opened.
            let attributes = with_wstr(path, super::GetFileAttributesW);
            program_attributes.set(attributes.unwrap_or(INVALID_FILE_ATTRIBUTES));
            program_attributes.get() & FILE_ATTRIBUTE_DIRECTORY == 0
        };
        let found = command_line::find_program(&invocation.file, &search, is_file);
        let mut program = found.ok_or(E::ENOENT)?;
        let full_path = resolve_full_path(program.clone()).map_err(Win32Error::to_node_errno)?;
        let arguments = &invocation.arguments;
        let is_verbatim = invocation.has_verbatim_arguments;
        let is_batch_file =
            command_line::is_batch_file(&full_path) && !has_dos_signature(&mut program);
        let command_line = if is_batch_file {
            if program.starts_with(&super::LONG_PATH_PREFIX) && full_path != program {
                return Err(E::EINVAL);
            }
            program.resize(MAX_PATH, 0);
            let len =
                super::GetSystemDirectoryW(&mut program).map_err(Win32Error::to_node_errno)?;
            program.truncate(len);
            program.extend_from_slice(bun_core::w!("\\cmd.exe"));
            let arguments = arguments.get(1..).unwrap_or_default();
            command_line::build_batch_command(&full_path, arguments, is_verbatim)
        } else if is_verbatim {
            Ok(command_line::join_verbatim(arguments))
        } else {
            command_line::join(arguments)
        };
        let mut command_line = command_line.map_err(|_| E::EINVAL)?;
        for text in [&mut program, &mut command_line, &mut cwd] {
            text.push(0);
        }
        Ok(Command {
            program,
            command_line,
            cwd,
            environment: environment.block,
            is_reparse_point: !is_batch_file
                && program_attributes.get() & FILE_ATTRIBUTE_REPARSE_POINT != 0,
        })
    }
}

pub fn spawn(mut command: Command, options: &Options<'_>) -> Result<Child, E> {
    const DETACHED_PROCESS: DWORD = 0x8;
    const CREATE_NEW_PROCESS_GROUP: DWORD = 0x200;
    const CREATE_UNICODE_ENVIRONMENT: DWORD = 0x400;
    const CREATE_NO_WINDOW: DWORD = 0x0800_0000;
    const STARTF_USESHOWWINDOW: DWORD = 0x1;
    const SW_HIDE: u16 = 0;
    const SW_SHOWDEFAULT: u16 = 10;
    const PROC_THREAD_ATTRIBUTE_HANDLE_LIST: usize = 0x2_0002;
    const PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE: usize = 0x2_0016;

    assert!(options.descriptors.len() <= crt_descriptors::MAX_COUNT);
    let mut flags = CREATE_UNICODE_ENVIRONMENT | super::EXTENDED_STARTUPINFO_PRESENT;
    if let Console::Hidden = options.console {
        flags |= CREATE_NO_WINDOW;
    }
    if options.is_detached {
        flags |= DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
    }
    let mut startup_info = STARTUPINFOEXW {
        StartupInfo: STARTUPINFOW {
            cb: size_of::<STARTUPINFOEXW>() as DWORD,
            dwFlags: super::STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW,
            wShowWindow: if options.hide_window {
                SW_HIDE
            } else {
                SW_SHOWDEFAULT
            },
            ..bun_core::ffi::zeroed()
        },
        lpAttributeList: ptr::null_mut(),
    };
    let mut handles = Vec::new();
    let mut should_inherit_all = false;
    let mut descriptor_block = Vec::new();
    if !matches!(options.console, Console::Pseudo(_)) {
        let raw_handle =
            |descriptor: &Option<Descriptor>| Some(descriptor.as_ref()?.handle.as_raw_handle());
        let std_handle = |fd: usize| raw_handle(&options.descriptors[fd]);
        startup_info.StartupInfo.hStdInput = std_handle(0).unwrap_or(INVALID_HANDLE_VALUE);
        startup_info.StartupInfo.hStdOutput = std_handle(1).unwrap_or(INVALID_HANDLE_VALUE);
        startup_info.StartupInfo.hStdError = std_handle(2).unwrap_or(INVALID_HANDLE_VALUE);
        handles.extend(options.descriptors.iter().filter_map(raw_handle));
        match options.inherited_handles {
            InheritedHandles::Explicit(handle) => handles.extend(handle),
            InheritedHandles::All => should_inherit_all = true,
        }
        let entries = options
            .descriptors
            .iter()
            .map(|descriptor| Some((descriptor.as_ref()?.flags, raw_handle(descriptor)?.addr())))
            .collect::<Vec<_>>();
        descriptor_block = crt_descriptors::encode(&entries);
        startup_info.StartupInfo.lpReserved2 = descriptor_block.as_mut_ptr();
    }
    startup_info.StartupInfo.cbReserved2 = descriptor_block.len() as u16;

    let is_reparse_point = command.is_reparse_point;
    let mut create_process = |jobs: &[HANDLE]| {
        let mut attributes = ProcThreadAttributeList::new(3)?;
        if !handles.is_empty() && !should_inherit_all {
            attributes.set_handles(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &handles)?;
        }
        if !jobs.is_empty() {
            attributes.set_handles(super::PROC_THREAD_ATTRIBUTE_JOB_LIST as usize, jobs)?;
        }
        if let Console::Pseudo(console) = options.console {
            // SAFETY: the value of this attribute is the `HPCON` itself, which is open while `console` is borrowed.
            unsafe {
                attributes.set(
                    PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                    console.as_raw(),
                    size_of::<HPCON>(),
                )
            }?;
        }
        startup_info.lpAttributeList = attributes.as_mut_ptr();
        let mut process_info: PROCESS_INFORMATION = bun_core::ffi::zeroed();
        // SAFETY: the strings are NUL-terminated, the environment block ends with two NULs, and what
        // `startup_info` points to outlives the call. On success both handles are new.
        unsafe {
            check(kernel32::CreateProcessW(
                command.program.as_ptr(),
                command.command_line.as_mut_ptr(),
                ptr::null_mut(),
                ptr::null_mut(),
                (!handles.is_empty() || should_inherit_all).into(),
                flags,
                command.environment.as_mut_ptr().cast(),
                command.cwd.as_ptr(),
                (&raw mut startup_info).cast(),
                &raw mut process_info,
            ))?;
            drop(OwnedHandle::from_raw_handle(process_info.hThread));
            Ok(Child {
                handle: OwnedHandle::from_raw_handle(process_info.hProcess),
                pid: process_info.dwProcessId,
            })
        }
    };
    let jobs = [
        (!options.is_detached).then(global_job).flatten(),
        options.job,
    ];
    let jobs = jobs.into_iter().flatten();
    let job_handles: Vec<_> = jobs.clone().map(|job| job.as_raw_handle()).collect();
    let first_attempt =
        (!is_reparse_point && !job_handles.is_empty()).then(|| create_process(&job_handles));
    match first_attempt {
        // Jobs that this process joined after `jobs` were created can conflict with them.
        Some(Err(
            Win32Error::ACCESS_DENIED | Win32Error::INVALID_PARAMETER | Win32Error::NOT_SUPPORTED,
        ))
        | None => create_process(&[]).inspect(|child| {
            for job in jobs {
                let _ = super::AssignProcessToJobObject(&job, child.handle.as_raw_handle());
            }
        }),
        Some(result) => result,
    }
    .map_err(Win32Error::to_node_errno)
}

pub fn exit_code(process: HANDLE) -> Result<u32, Win32Error> {
    let mut code = 0;
    check(kernel32_2::GetExitCodeProcess(process, &mut code)).map(|()| code)
}

fn has_exited(process: HANDLE) -> Result<bool, Win32Error> {
    const STILL_ACTIVE: u32 = 259;
    Ok(exit_code(process)? != STILL_ACTIVE
        || kernel32::WaitForSingleObject(process, 0) == WAIT_OBJECT_0)
}

/// Node.js semantics: signal 0 only checks that the process is running.
pub fn kill(process: HANDLE, signal: c_int) -> Result<(), E> {
    const STATUS_PROCESS_IS_TERMINATING: NTSTATUS = NTSTATUS(0xC000_010A);
    const SIGINT: c_int = SignalCode::SIGINT as c_int;
    const SIGQUIT: c_int = SignalCode::SIGQUIT as c_int;
    const SIGKILL: c_int = SignalCode::SIGKILL as c_int;
    const SIGTERM: c_int = SignalCode::SIGTERM as c_int;
    const MAX_SIGNAL: c_int = SignalCode::SIGWINCH as c_int;
    if signal == SIGQUIT {
        let _ = super::crash_dump::write_if_enabled(process);
    }
    match signal {
        0 if has_exited(process).map_err(Win32Error::to_e)? => Err(E::ESRCH),
        0 => Ok(()),
        SIGINT | SIGQUIT | SIGKILL | SIGTERM => check(kernel32::TerminateProcess(process, 1))
            .map_err(|err| {
                let is_terminating = err == Win32Error::ACCESS_DENIED
                    && (RtlGetLastNtStatus() == STATUS_PROCESS_IS_TERMINATING
                        || has_exited(process) == Ok(true));
                if is_terminating { E::ESRCH } else { err.to_e() }
            }),
        1..=MAX_SIGNAL => Err(E::ENOSYS),
        _ => Err(E::EINVAL),
    }
}

/// `pid` 0 is the current process.
pub fn kill_pid(pid: u32, signal: c_int) -> Result<(), E> {
    const PROCESS_TERMINATE: DWORD = 0x1;
    let access =
        PROCESS_TERMINATE | super::PROCESS_QUERY_LIMITED_INFORMATION | externs::SYNCHRONIZE;
    super::process_info::with_process(pid, access, |process| kill(process, signal))
}

/// Returns 0, or the `err.errno` value that Node.js reports.
#[unsafe(no_mangle)]
extern "C" fn Bun__killProcess(pid: c_int, signal: c_int) -> c_int {
    match kill_pid(pid as u32, signal) {
        Ok(()) => 0,
        Err(errno) => crate::Error::from_code(errno, crate::Tag::kill).js_errno(),
    }
}
