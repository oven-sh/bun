//! Starting and ending processes.

use core::cell::Cell;
use core::ffi::{c_int, c_void};
use core::ptr;
use std::os::windows::io::{
    AsHandle as _, AsRawHandle as _, BorrowedHandle, FromRawHandle as _, OwnedHandle,
};
use std::sync::OnceLock;

use bun_core::WStr;
use bun_windows_sys::externs::{self, WAIT_OBJECT_0};

use super::{
    BOOL, DWORD, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, HANDLE, HPCON,
    INVALID_HANDLE_VALUE, NTSTATUS, PROCESS_INFORMATION, PseudoConsole, STARTUPINFOEXW,
    STARTUPINFOW, Win32Error, Win32ErrorExt as _, check, grow_to_fit, kernel32, kernel32_2,
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

fn with_nul<R>(text: &mut Vec<u16>, f: impl FnOnce(&WStr) -> R) -> R {
    text.push(0);
    let result = f(WStr::from_slice_with_nul(text));
    text.pop();
    result
}

fn full_path(mut path: Vec<u16>) -> Result<Vec<u16>, Win32Error> {
    with_nul(&mut path, super::full_path)
}

fn short_path(full_path: &[u16]) -> Result<Vec<u16>, Win32Error> {
    let mut path = command_line::with_verbatim_prefix(full_path);
    let short = with_nul(&mut path, super::short_path)?;
    Ok(command_line::without_verbatim_prefix(&short))
}

fn current_directory() -> Result<Vec<u16>, Win32Error> {
    grow_to_fit(|buffer| {
        // SAFETY: `buffer` has the length that is passed.
        unsafe {
            externs::GetCurrentDirectoryW(buffer.len() as DWORD, buffer.as_mut_ptr()) as usize
        }
    })
}

fn variable(name: &[u16]) -> Option<Vec<u16>> {
    super::getenv_w_allow_empty(WStr::from_slice_with_nul(&[name, &[0]].concat()))
}

/// The system goes by the header of a file before it goes by its name.
fn is_image(path: &mut Vec<u16>) -> bool {
    let (access, share) = (externs::GENERIC_READ, crate::FILE_SHARE);
    let open = |path: &WStr| super::CreateFileW(path, access, share, externs::OPEN_EXISTING, 0);
    let mut magic = [0; 2];
    with_nul(path, open).is_ok_and(|file| File::from(file).read_all(&mut magic).is_ok())
        && magic == *b"MZ"
}

/// Its members end with this process. Their children are not members.
fn job() -> Option<BorrowedHandle<'static>> {
    static JOB: OnceLock<Option<OwnedHandle>> = OnceLock::new();
    let job = JOB.get_or_init(|| {
        let job = super::CreateJobObjectA().ok()?;
        let flags =
            super::JOB_LIMIT_FLAGS_KILL_TREE_ON_CLOSE | super::JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
        super::set_job_limit_flags(&job, flags).ok()?;
        // The first member fixes the place of a job among the other jobs. If that is a Store app, nothing else can join.
        let _ = super::AssignProcessToJobObject(&job, super::GetCurrentProcess());
        Some(job)
    });
    job.as_ref().map(OwnedHandle::as_handle)
}

/// A file descriptor of the new process.
pub struct Descriptor {
    handle: OwnedHandle,
    flags: u8,
}

impl Descriptor {
    pub fn pipe(handle: OwnedHandle) -> Result<Descriptor, Win32Error> {
        super::make_inheritable(handle.as_raw_handle())?;
        let flags = crt_descriptors::OPEN | crt_descriptors::PIPE;
        Ok(Descriptor { handle, flags })
    }

    pub fn duplicate(handle: HANDLE) -> Result<Descriptor, Win32Error> {
        let handle = super::duplicate_handle_inheritable(handle)?;
        let flags = match super::file_type(handle.as_raw_handle())? {
            super::FILE_TYPE_DISK => crt_descriptors::OPEN,
            super::FILE_TYPE_PIPE => crt_descriptors::OPEN | crt_descriptors::PIPE,
            _ => crt_descriptors::OPEN | crt_descriptors::DEVICE,
        };
        Ok(Descriptor { handle, flags })
    }

    pub fn null_device(is_input: bool) -> Result<Descriptor, Win32Error> {
        static HANDLES: [OnceLock<OwnedHandle>; 2] = [OnceLock::new(), OnceLock::new()];
        let cached = &HANDLES[usize::from(is_input)];
        let handle = match cached.get() {
            Some(handle) => handle,
            None => {
                let access = match is_input {
                    true => externs::GENERIC_READ,
                    false => externs::GENERIC_WRITE | externs::FILE_READ_ATTRIBUTES,
                };
                let share = externs::FILE_SHARE_READ | externs::FILE_SHARE_WRITE;
                let name = bun_core::wstr!("\\\\.\\NUL");
                let handle = super::CreateFileW(name, access, share, externs::OPEN_EXISTING, 0)?;
                cached.get_or_init(|| handle)
            }
        };
        Ok(Descriptor {
            handle: super::duplicate_handle_inheritable(handle.as_raw_handle())?,
            flags: crt_descriptors::OPEN | crt_descriptors::DEVICE,
        })
    }
}

#[derive(Copy, Clone)]
pub enum Console<'a> {
    Shared,
    /// One of its own, without a window.
    Hidden,
    Pseudo(&'a PseudoConsole),
}

/// Inheritable handles, which the new process knows by their values.
#[derive(Copy, Clone)]
pub enum Inherited {
    Only(Option<HANDLE>),
    /// For a process that takes the place of this one.
    All,
}

/// The system takes a NUL for the end of a string.
pub struct Invocation {
    pub file: Vec<u16>,
    /// With the name of the program.
    pub arguments: Vec<Vec<u16>>,
    pub has_verbatim_arguments: bool,
    pub environment: Vec<Vec<u16>>,
    /// `None` is that of this process.
    pub cwd: Option<Vec<u16>>,
}

pub struct Options<'a> {
    /// At least three, at most `crt_descriptors::MAX_COUNT`. They are not used with a pseudo console.
    pub descriptors: &'a [Option<Descriptor>],
    pub inherited: Inherited,
    pub console: Console<'a>,
    pub hides_window: bool,
    /// It has no console, and outlives this process.
    pub is_detached: bool,
    /// To be a member of from the start.
    pub job: Option<BorrowedHandle<'a>>,
}

pub struct Child {
    pub handle: OwnedHandle,
    pub id: u32,
}

/// Borrows the values of its attributes. Deleting the list only lets go of them.
struct Attributes<'a> {
    list: [usize; 16],
    _values: core::marker::PhantomData<&'a [HANDLE]>,
}

impl<'a> Attributes<'a> {
    fn new(count: DWORD) -> Result<Box<Self>, Win32Error> {
        let mut this = Box::new(Attributes {
            list: [0; 16],
            _values: core::marker::PhantomData,
        });
        let mut size = size_of_val(&this.list);
        // SAFETY: `list` has the size that is passed.
        check(unsafe {
            externs::InitializeProcThreadAttributeList(this.as_ptr(), count, 0, &raw mut size)
        })?;
        Ok(this)
    }

    fn as_ptr(&mut self) -> *mut u8 {
        self.list.as_mut_ptr().cast()
    }

    /// SAFETY: `value` and `size` are what `attribute` takes, and what they point to lives for `'a`.
    unsafe fn set(
        &mut self,
        attribute: usize,
        value: *const c_void,
        size: usize,
    ) -> Result<(), Win32Error> {
        let (list, previous, returned) = (self.as_ptr(), ptr::null_mut(), ptr::null_mut());
        // SAFETY: fn contract, and `new` has initialized the list.
        check(unsafe {
            externs::UpdateProcThreadAttribute(list, 0, attribute, value, size, previous, returned)
        })
    }

    fn set_handles(&mut self, attribute: usize, handles: &'a [HANDLE]) -> Result<(), Win32Error> {
        // SAFETY: both callers pass an attribute that is an array of handles.
        unsafe { self.set(attribute, handles.as_ptr().cast(), size_of_val(handles)) }
    }
}

/// What `CreateProcessW` takes.
pub struct Command {
    program: Vec<u16>,
    line: Vec<u16>,
    cwd: Vec<u16>,
    environment: Vec<u16>,
    /// An app execution alias starts in a job of its own.
    can_be_alias: bool,
}

impl Command {
    pub fn resolve(invocation: Invocation) -> Result<Command, E> {
        let error = Win32Error::to_node_e;
        let cwd = invocation.cwd.map_or_else(current_directory, full_path);
        let mut cwd = cwd.map_err(error)?;
        // It fails if there is no room for a separator and a NUL, also if the directory is inherited.
        if cwd.len() + 2 > super::MAX_PATH {
            cwd = short_path(&cwd).map_err(error)?;
        }
        let entries = invocation.environment.into_iter();
        let environment = environment::build(entries, variable, super::to_upper);

        let search = command_line::Search {
            cwd: &cwd,
            path: &environment.path,
            // SAFETY: the name ends with a NUL.
            includes_cwd: unsafe { NeedCurrentDirectoryForExePathW(WStr::EMPTY.as_ptr()) } != 0,
        };
        let attributes = Cell::new(0);
        let is_file = |path: &mut Vec<u16>| {
            // An app execution alias cannot be opened.
            attributes.set(with_nul(path, super::GetFileAttributesW).unwrap_or(DWORD::MAX));
            attributes.get() & FILE_ATTRIBUTE_DIRECTORY == 0
        };
        let found = command_line::find_program(&invocation.file, &search, is_file);
        let mut program = found.ok_or(E::ENOENT)?;
        let script = full_path(program.clone()).map_err(error)?;
        let (arguments, is_verbatim) = (&invocation.arguments, invocation.has_verbatim_arguments);
        let is_batch_file = command_line::is_batch_file(&script) && !is_image(&mut program);
        let line = if is_batch_file {
            if program.starts_with(&super::LONG_PATH_PREFIX) && script != program {
                return Err(E::EINVAL);
            }
            program.resize(super::MAX_PATH, 0);
            let len = super::GetSystemDirectoryW(&mut program).map_err(error)?;
            program.truncate(len);
            program.extend_from_slice(bun_core::w!("\\cmd.exe"));
            let arguments = arguments.get(1..).unwrap_or_default();
            command_line::join_for_batch_file(&script, arguments, is_verbatim)
        } else if is_verbatim {
            Ok(command_line::join_verbatim(arguments))
        } else {
            command_line::join(arguments)
        };
        let mut line = line.map_err(|_| E::EINVAL)?;
        for text in [&mut program, &mut line, &mut cwd] {
            text.push(0);
        }
        Ok(Command {
            program,
            line,
            cwd,
            environment: environment.units,
            can_be_alias: !is_batch_file && attributes.get() & FILE_ATTRIBUTE_REPARSE_POINT != 0,
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
    const HANDLE_LIST: usize = 0x2_0002;
    const JOB_LIST: usize = super::PROC_THREAD_ATTRIBUTE_JOB_LIST as usize;
    const PSEUDOCONSOLE: usize = 0x2_0016;

    assert!(options.descriptors.len() <= crt_descriptors::MAX_COUNT);
    let mut flags = CREATE_UNICODE_ENVIRONMENT | super::EXTENDED_STARTUPINFO_PRESENT;
    if let Console::Hidden = options.console {
        flags |= CREATE_NO_WINDOW;
    }
    if options.is_detached {
        flags |= DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
    }
    let mut startup = STARTUPINFOEXW {
        StartupInfo: STARTUPINFOW {
            cb: size_of::<STARTUPINFOEXW>() as DWORD,
            dwFlags: super::STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW,
            wShowWindow: if options.hides_window {
                SW_HIDE
            } else {
                SW_SHOWDEFAULT
            },
            ..bun_core::ffi::zeroed()
        },
        lpAttributeList: ptr::null_mut(),
    };
    let (mut handles, mut inherits_all) = (Vec::new(), false);
    let mut block = Vec::new();
    if !matches!(options.console, Console::Pseudo(_)) {
        let raw = |it: &Option<Descriptor>| Some(it.as_ref()?.handle.as_raw_handle());
        let standard = |index: usize| raw(&options.descriptors[index]);
        startup.StartupInfo.hStdInput = standard(0).unwrap_or(INVALID_HANDLE_VALUE);
        startup.StartupInfo.hStdOutput = standard(1).unwrap_or(INVALID_HANDLE_VALUE);
        startup.StartupInfo.hStdError = standard(2).unwrap_or(INVALID_HANDLE_VALUE);
        handles.extend(options.descriptors.iter().filter_map(raw));
        match options.inherited {
            Inherited::Only(handle) => handles.extend(handle),
            Inherited::All => inherits_all = true,
        }
        let entries = (options.descriptors.iter())
            .map(|it| Some((it.as_ref()?.flags, raw(it)?.addr())))
            .collect::<Vec<_>>();
        block = crt_descriptors::encode(&entries);
        startup.StartupInfo.lpReserved2 = block.as_mut_ptr();
    }
    startup.StartupInfo.cbReserved2 = block.len() as u16;

    let can_be_alias = command.can_be_alias;
    let mut create = |jobs: &[HANDLE]| {
        let mut attributes = Attributes::new(3)?;
        if !handles.is_empty() && !inherits_all {
            attributes.set_handles(HANDLE_LIST, &handles)?;
        }
        if !jobs.is_empty() {
            attributes.set_handles(JOB_LIST, jobs)?;
        }
        if let Console::Pseudo(console) = options.console {
            // SAFETY: the value is the handle itself, which is open while it is borrowed.
            unsafe { attributes.set(PSEUDOCONSOLE, console.as_raw(), size_of::<HPCON>()) }?;
        }
        startup.lpAttributeList = attributes.as_ptr();
        let mut process: PROCESS_INFORMATION = bun_core::ffi::zeroed();
        // SAFETY: the strings end with a NUL and the environment with two, and what `startup` points to is in this frame. On success both handles are new.
        unsafe {
            check(kernel32::CreateProcessW(
                command.program.as_ptr(),
                command.line.as_mut_ptr(),
                ptr::null_mut(),
                ptr::null_mut(),
                (!handles.is_empty() || inherits_all).into(),
                flags,
                command.environment.as_mut_ptr().cast(),
                command.cwd.as_ptr(),
                (&raw mut startup).cast(),
                &raw mut process,
            ))?;
            drop(OwnedHandle::from_raw_handle(process.hThread));
            Ok(Child {
                handle: OwnedHandle::from_raw_handle(process.hProcess),
                id: process.dwProcessId,
            })
        }
    };
    let jobs = [(!options.is_detached).then(job).flatten(), options.job];
    let jobs = jobs.into_iter().flatten();
    let job_list: Vec<_> = jobs.clone().map(|job| job.as_raw_handle()).collect();
    let created = (!can_be_alias).then(|| create(&job_list));
    match created {
        // The jobs that this process has been put in since may not go with them.
        Some(Err(
            Win32Error::ACCESS_DENIED | Win32Error::INVALID_PARAMETER | Win32Error::NOT_SUPPORTED,
        ))
        | None => create(&[]).inspect(|child| {
            for job in jobs {
                let _ = super::AssignProcessToJobObject(&job, child.handle.as_raw_handle());
            }
        }),
        Some(result) => result,
    }
    .map_err(Win32Error::to_node_e)
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

/// As Node.js has it: 0 asks whether the process is there, and those that would end it do.
pub fn kill(process: HANDLE, signal: c_int) -> Result<(), E> {
    const STATUS_PROCESS_IS_TERMINATING: NTSTATUS = NTSTATUS(0xC000_010A);
    match signal {
        0 if has_exited(process).map_err(Win32Error::to_e)? => Err(E::ESRCH),
        0 => Ok(()),
        // SIGINT, SIGQUIT, SIGKILL, SIGTERM
        2 | 3 | 9 | 15 => check(kernel32::TerminateProcess(process, 1)).map_err(|err| {
            let is_gone = err == Win32Error::ACCESS_DENIED
                && (RtlGetLastNtStatus() == STATUS_PROCESS_IS_TERMINATING
                    || has_exited(process) == Ok(true));
            if is_gone { E::ESRCH } else { err.to_e() }
        }),
        1..=28 => Err(E::ENOSYS),
        _ => Err(E::EINVAL),
    }
}

/// 0 is this process.
pub fn kill_by_id(id: u32, signal: c_int) -> Result<(), E> {
    const PROCESS_TERMINATE: DWORD = 0x1;
    let access =
        PROCESS_TERMINATE | super::PROCESS_QUERY_LIMITED_INFORMATION | externs::SYNCHRONIZE;
    super::process_info::with_process(id, access, |process| kill(process, signal))
}

/// Returns an error number of Node.js.
#[unsafe(no_mangle)]
extern "C" fn Bun__killProcess(id: c_int, signal: c_int) -> c_int {
    match kill_by_id(id as u32, signal) {
        Ok(()) => 0,
        Err(errno) => crate::Error::from_code(errno, crate::Tag::kill).js_errno(),
    }
}
