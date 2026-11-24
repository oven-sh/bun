//! https://learn.microsoft.com/en-us/windows/win32/wer/collecting-user-mode-dumps

use core::ffi::c_void;
use core::ptr;
use std::os::windows::io::AsRawHandle as _;

use bun_core::{Mutex, WStr, wstr};
use bun_windows_sys::{CREATE_NEW, DELETE, FILE_DISPOSITION_INFORMATION, GENERIC_WRITE, HRESULT};

use super::registry::Key;
use super::{self as w, BOOL, DWORD, HANDLE, Win32Error, nt};

#[link(name = "kernel32")]
unsafe extern "system" {
    safe fn GetProcessId(Process: HANDLE) -> DWORD;
    fn K32GetModuleBaseNameW(
        hProcess: HANDLE,
        hModule: HANDLE,
        lpBaseName: *mut u16,
        nSize: DWORD,
    ) -> DWORD;
}

#[link(name = "ole32")]
unsafe extern "system" {
    fn CoTaskMemFree(pv: *mut c_void);
}

fn query_image_name(process: HANDLE) -> Option<Vec<u16>> {
    let mut name = [0; 260];
    // SAFETY: `name` is writable for the length passed.
    let len = unsafe {
        K32GetModuleBaseNameW(
            process,
            ptr::null_mut(),
            name.as_mut_ptr(),
            name.len() as DWORD,
        )
    };
    let name = name.get(..len as usize).filter(|name| !name.is_empty());
    name.map(<[u16]>::to_vec)
}

fn query_default_folder() -> Option<Vec<u16>> {
    type SHGetKnownFolderPath =
        extern "system" fn(&[u32; 4], DWORD, HANDLE, &mut *mut u16) -> HRESULT;
    const FOLDERID_LOCAL_APP_DATA: [u32; 4] = [0xF1B3_2785, 0x4FCF_6FBA, 0x8E7B_559D, 0x9170_157F];
    // SAFETY: the signature matches `shlobj_core.h`.
    let get_folder: SHGetKnownFolderPath =
        unsafe { w::load_export(wstr!("shell32.dll"), c"SHGetKnownFolderPath") }?;
    let mut path = ptr::null_mut();
    let result = get_folder(&FOLDERID_LOCAL_APP_DATA, 0, ptr::null_mut(), &mut path);
    // SAFETY: `path` is NUL-terminated on success, and is to be freed in either case.
    unsafe {
        let folder = (result == 0).then(|| {
            [
                bun_core::ffi::wstr_units(path),
                bun_core::w!("\\CrashDumps"),
            ]
            .concat()
        });
        CoTaskMemFree(path.cast());
        folder
    }
}

/// `None` unless local dumps are enabled and the handle allows reading the memory of the process.
fn prepare_dump_path(process: HANDLE) -> Option<Vec<u16>> {
    let key = Key::open(wstr!(
        "SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting\\LocalDumps"
    ))?;
    let image_name = query_image_name(process)?;
    let mut path = key
        .query_wide_string(wstr!("DumpFolder"))
        .or_else(query_default_folder)?;
    path.push(0);
    let _ = w::CreateDirectoryW(WStr::from_slice_with_nul(&path));
    path.pop();
    path.push(b'\\'.into());
    path.extend(image_name);
    path.extend(format!(".{}.dmp\0", GetProcessId(process)).encode_utf16());
    Some(path)
}

pub(super) fn write_if_enabled(process: HANDLE) -> Result<(), Win32Error> {
    type MiniDumpWriteDump =
        extern "system" fn(HANDLE, DWORD, HANDLE, u32, usize, usize, usize) -> BOOL;
    const WITH_FULL_MEMORY: u32 = 0x2;
    const IGNORE_INACCESSIBLE_MEMORY: u32 = 0x2_0000;
    const WITH_AVX_XSTATE_CONTEXT: u32 = 0x20_0000;
    /// DbgHelp is single-threaded.
    static DBGHELP_LOCK: Mutex<()> = Mutex::new(());

    let Some(path) = prepare_dump_path(process) else {
        return Ok(());
    };
    // SAFETY: the signature matches `minidumpapiset.h`, with null for the optional pointers.
    let write_dump: MiniDumpWriteDump =
        unsafe { w::load_export(wstr!("dbghelp.dll"), c"MiniDumpWriteDump") }
            .ok_or_else(Win32Error::get)?;
    let path = WStr::from_slice_with_nul(&path);
    let file = w::CreateFileW(path, GENERIC_WRITE | DELETE, 0, CREATE_NEW, 0)?;
    let file = file.as_raw_handle();
    let kind = WITH_FULL_MEMORY | IGNORE_INACCESSIBLE_MEMORY | WITH_AVX_XSTATE_CONTEXT;
    let _guard = DBGHELP_LOCK.lock();
    let pid = GetProcessId(process);
    w::check(write_dump(process, pid, file, kind, 0, 0, 0)).inspect_err(|_| {
        let _ = nt::set_file_info(file, FILE_DISPOSITION_INFORMATION { DeleteFile: 1 });
    })
}
