//! Signals, as far as Windows has them.

use core::ffi::{c_int, c_void};
use core::ptr;

use bun_sys::{E, Error, Tag};

use super::win32::{self, BOOL, DWORD, HANDLE, INVALID_HANDLE_VALUE};

pub const SIGINT: c_int = 2;
pub const SIGQUIT: c_int = 3;
pub const SIGKILL: c_int = 9;
pub const SIGTERM: c_int = 15;
/// One past the highest signal number (`SIGWINCH`, 28).
pub const NSIG: c_int = 29;

/// Sends `signum` to the process behind `process`.
///
/// `SIGTERM`, `SIGKILL`, `SIGINT` and `SIGQUIT` end it with exit code 1
/// (`SIGQUIT` after writing a dump where the system collects dumps); 0 only
/// probes (`ESRCH` once it has exited); any other signal is `ENOSYS`, and a
/// number that is not a signal `EINVAL`.
pub fn kill(process: HANDLE, signum: c_int) -> Result<(), Error> {
    if !(0..NSIG).contains(&signum) {
        return Err(Error::from_code(E::EINVAL, Tag::kill));
    }

    match signum {
        SIGQUIT | SIGTERM | SIGKILL | SIGINT => {
            if signum == SIGQUIT {
                write_minidump(process);
            }
            if win32::TerminateProcess(process, 1) != 0 {
                return Ok(());
            }
            let err = win32::GetLastError();
            // TerminateProcess on a process that has exited fails with
            // ERROR_ACCESS_DENIED.
            if err == win32::ERROR_ACCESS_DENIED {
                let mut status: DWORD = 0;
                // SAFETY: `status` is a valid out-pointer.
                if unsafe { win32::GetExitCodeProcess(process, &mut status) } != 0
                    && status != win32::STILL_ACTIVE
                {
                    return Err(Error::from_code(E::ESRCH, Tag::kill));
                }
                // 259 is also a legal exit code, so ask the handle. It may
                // not be signalled yet for a process that only just exited,
                // which then reports EPERM instead of ESRCH.
                if win32::WaitForSingleObject(process, 0) == win32::WAIT_OBJECT_0 {
                    return Err(Error::from_code(E::ESRCH, Tag::kill));
                }
            }
            Err(win32::sys_error(err, Tag::kill))
        }
        0 => {
            let mut status: DWORD = 0;
            // SAFETY: `status` is a valid out-pointer.
            if unsafe { win32::GetExitCodeProcess(process, &mut status) } == 0 {
                return Err(win32::last_error(Tag::kill));
            }
            if status != win32::STILL_ACTIVE {
                return Err(Error::from_code(E::ESRCH, Tag::kill));
            }
            match win32::WaitForSingleObject(process, 0) {
                win32::WAIT_OBJECT_0 => Err(Error::from_code(E::ESRCH, Tag::kill)),
                win32::WAIT_TIMEOUT => Ok(()),
                win32::WAIT_FAILED => Err(win32::last_error(Tag::kill)),
                _ => Err(Error::from_code(E::EUNKNOWN, Tag::kill)),
            }
        }
        _ => Err(Error::from_code(E::ENOSYS, Tag::kill)),
    }
}

/// [`kill`] by process id. Pid 0 is this process, not a process group; a pid
/// that names no process is `ESRCH`.
pub fn kill_pid(pid: c_int, signum: c_int) -> Result<(), Error> {
    if pid == 0 {
        return kill(win32::GetCurrentProcess(), signum);
    }
    // SAFETY: by-value arguments only.
    let process = unsafe {
        win32::OpenProcess(
            win32::PROCESS_TERMINATE | win32::PROCESS_QUERY_INFORMATION | win32::SYNCHRONIZE,
            0,
            pid as DWORD,
        )
    };
    if process.is_null() {
        return Err(match win32::GetLastError() {
            win32::ERROR_INVALID_PARAMETER => Error::from_code(E::ESRCH, Tag::kill),
            err => win32::sys_error(err, Tag::kill),
        });
    }
    let result = kill(process, signum);
    // SAFETY: `process` is a handle this function owns.
    unsafe { win32::CloseHandle(process) };
    result
}

type HKEY = *mut c_void;
const HKEY_LOCAL_MACHINE: HKEY = 0x8000_0002_u32 as i32 as isize as HKEY;
const KEY_QUERY_VALUE: DWORD = 0x0001;
const RRF_RT_ANY: DWORD = 0x0000_FFFF;
const CREATE_NEW: DWORD = 1;
const FILE_ATTRIBUTE_NORMAL: DWORD = 0x80;
const FILE_DISPOSITION_INFO_CLASS: c_int = 4;
const MINIDUMP_WITH_FULL_MEMORY: DWORD = 0x0000_0002;
const MINIDUMP_IGNORE_INACCESSIBLE_MEMORY: DWORD = 0x0002_0000;
const MINIDUMP_WITH_AVX_XSTATE_CONTEXT: DWORD = 0x0020_0000;
/// Makes Wine include ELF modules in a dump.
const SYMOPT_WINE_WITH_NATIVE_MODULES: DWORD = 0x4000_0000;

#[repr(C)]
struct GUID {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

const FOLDERID_LOCAL_APP_DATA: GUID = GUID {
    data1: 0xf1b3_2785,
    data2: 0x6fba,
    data3: 0x4fcf,
    data4: [0x9d, 0x55, 0x7b, 0x8e, 0x7f, 0x15, 0x70, 0x91],
};

unsafe extern "system" {
    fn RegOpenKeyExW(
        hKey: HKEY,
        lpSubKey: *const u16,
        ulOptions: DWORD,
        samDesired: DWORD,
        phkResult: *mut HKEY,
    ) -> i32;
    fn RegGetValueW(
        hkey: HKEY,
        lpSubKey: *const u16,
        lpValue: *const u16,
        dwFlags: DWORD,
        pdwType: *mut DWORD,
        pvData: *mut c_void,
        pcbData: *mut DWORD,
    ) -> i32;
    fn RegCloseKey(hKey: HKEY) -> i32;
    fn SHGetKnownFolderPath(
        rfid: *const GUID,
        dwFlags: DWORD,
        hToken: HANDLE,
        ppszPath: *mut *mut u16,
    ) -> i32;
    fn CoTaskMemFree(pv: *mut c_void);
    fn K32GetModuleBaseNameW(
        hProcess: HANDLE,
        hModule: *mut c_void,
        lpBaseName: *mut u16,
        nSize: DWORD,
    ) -> DWORD;
    fn CreateDirectoryW(lpPathName: *const u16, lpSecurityAttributes: *mut c_void) -> BOOL;
    fn SetFileInformationByHandle(
        hFile: HANDLE,
        FileInformationClass: c_int,
        lpFileInformation: *const c_void,
        dwBufferSize: DWORD,
    ) -> BOOL;
    fn SymGetOptions() -> DWORD;
    fn SymSetOptions(SymOptions: DWORD) -> DWORD;
    fn MiniDumpWriteDump(
        hProcess: HANDLE,
        ProcessId: DWORD,
        hFile: HANDLE,
        DumpType: DWORD,
        ExceptionParam: *const c_void,
        UserStreamParam: *const c_void,
        CallbackParam: *const c_void,
    ) -> BOOL;
}

fn wide_z(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(core::iter::once(0)).collect()
}

fn until_nul(s: &[u16]) -> &[u16] {
    &s[..s.iter().position(|&c| c == 0).unwrap_or(s.len())]
}

/// Writes a full-memory dump of `process` as `<image name>.<pid>.dmp`, if the
/// machine is set up to collect user-mode dumps (the `LocalDumps` key of
/// Windows Error Reporting exists): into its `DumpFolder`, by default
/// `%LOCALAPPDATA%\CrashDumps`, which is created when missing, as WER does.
/// Every failure is ignored; the caller ends the process either way.
fn write_minidump(process: HANDLE) {
    let mut key: HKEY = ptr::null_mut();
    let subkey = wide_z(r"SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps");
    // SAFETY: `subkey` is NUL-terminated; `key` is a valid out-pointer.
    if unsafe {
        RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            0,
            KEY_QUERY_VALUE,
            &mut key,
        )
    } != 0
    {
        return;
    }

    let mut basename = [0u16; win32::MAX_PATH];
    // SAFETY: `basename` holds MAX_PATH units.
    unsafe {
        K32GetModuleBaseNameW(
            process,
            ptr::null_mut(),
            basename.as_mut_ptr(),
            win32::MAX_PATH as DWORD,
        )
    };
    let pid = win32::GetProcessId(process);

    let mut folder_buf = [0u16; win32::MAX_PATH];
    let mut folder_bytes = size_of_val(&folder_buf) as DWORD;
    let mut value_type: DWORD = 0;
    let value_name = wide_z("DumpFolder");
    // SAFETY: `folder_buf` holds `folder_bytes` bytes; the other pointers are
    // valid for the call.
    let status = unsafe {
        RegGetValueW(
            key,
            ptr::null(),
            value_name.as_ptr(),
            RRF_RT_ANY,
            &mut value_type,
            folder_buf.as_mut_ptr().cast(),
            &mut folder_bytes,
        )
    };
    // SAFETY: `key` was opened above.
    unsafe { RegCloseKey(key) };

    let mut dump_name: Vec<u16> = Vec::with_capacity(win32::MAX_PATH);
    if status == 0 {
        dump_name.extend_from_slice(until_nul(&folder_buf));
    } else {
        let mut local_app_data: *mut u16 = ptr::null_mut();
        // SAFETY: `local_app_data` is a valid out-pointer; the string it
        // receives is NUL-terminated and freed below.
        unsafe {
            let found = SHGetKnownFolderPath(
                &FOLDERID_LOCAL_APP_DATA,
                0,
                ptr::null_mut(),
                &mut local_app_data,
            ) >= 0
                && !local_app_data.is_null();
            if found {
                let mut len = 0usize;
                while *local_app_data.add(len) != 0 {
                    len += 1;
                }
                dump_name.extend_from_slice(core::slice::from_raw_parts(local_app_data, len));
            }
            CoTaskMemFree(local_app_data.cast());
            if !found {
                return;
            }
        }
        dump_name.extend(r"\CrashDumps".encode_utf16());
    }

    dump_name.push(0);
    // SAFETY: `dump_name` is NUL-terminated.
    unsafe { CreateDirectoryW(dump_name.as_ptr(), ptr::null_mut()) };
    dump_name.pop();

    dump_name.push(b'\\' as u16);
    dump_name.extend_from_slice(until_nul(&basename));
    dump_name.extend(format!(".{pid}.dmp").encode_utf16());
    dump_name.push(0);
    if dump_name.len() > win32::MAX_PATH {
        return;
    }

    // SAFETY: `dump_name` is NUL-terminated.
    let file = unsafe {
        win32::CreateFileW(
            dump_name.as_ptr(),
            win32::GENERIC_WRITE,
            0,
            ptr::null_mut(),
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL,
            ptr::null_mut(),
        )
    };
    if file == INVALID_HANDLE_VALUE {
        return;
    }

    // Delete-on-close until the dump is complete, so a failed one leaves no file.
    let set_delete_on_close = |delete: bool| {
        // FILE_DISPOSITION_INFO: one BOOLEAN.
        let info = u8::from(delete);
        // SAFETY: `info` is valid for the one byte passed.
        unsafe {
            SetFileInformationByHandle(
                file,
                FILE_DISPOSITION_INFO_CLASS,
                ptr::from_ref(&info).cast(),
                size_of::<u8>() as DWORD,
            )
        };
    };
    set_delete_on_close(true);

    // SAFETY: `process` and `file` are valid handles; the optional parameters
    // are null.
    unsafe {
        let sym_options = SymGetOptions();
        SymSetOptions(sym_options | SYMOPT_WINE_WITH_NATIVE_MODULES);
        if MiniDumpWriteDump(
            process,
            pid,
            file,
            MINIDUMP_WITH_FULL_MEMORY
                | MINIDUMP_IGNORE_INACCESSIBLE_MEMORY
                | MINIDUMP_WITH_AVX_XSTATE_CONTEXT,
            ptr::null(),
            ptr::null(),
            ptr::null(),
        ) != 0
        {
            set_delete_on_close(false);
        }
        SymSetOptions(sym_options);
        win32::CloseHandle(file);
    }
}
