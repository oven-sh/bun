//! What only Windows has.

use core::ffi::c_void;
use core::ptr::{null, null_mut};
use std::io;
use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};

use bun_sys::windows;

pub(crate) struct Wide(Vec<u16>);

impl Wide {
    pub(crate) fn new(text: &str) -> Wide {
        Wide(text.encode_utf16().chain([0]).collect())
    }

    pub(crate) fn as_ptr(&self) -> *const u16 {
        self.0.as_ptr()
    }

    pub(crate) fn as_wstr(&self) -> &bun_core::WStr {
        bun_core::WStr::from_slice_with_nul(&self.0)
    }
}

#[repr(C)]
struct Guid(u32, u16, u16, [u8; 8]);

#[repr(C)]
struct Blob {
    length: u32,
    bytes: *mut u8,
}

/// `STARTUPINFOEXW`
#[repr(C)]
struct StartupInfo {
    size: u32,
    texts: [usize; 3],
    numbers: [u32; 7],
    flags: u32,
    reserved: [usize; 2],
    standard: [*mut c_void; 3],
    attributes: *mut usize,
}

/// `PROCESS_INFORMATION`
#[repr(C)]
struct Started {
    handles: [*mut c_void; 2],
    ids: [u32; 2],
}

type Protect = unsafe extern "system" fn(
    from: &Blob,
    description: *const c_void,
    entropy: *const Blob,
    reserved: *const c_void,
    prompt: *const c_void,
    flags: u32,
    to: &mut Blob,
) -> i32;

#[link(name = "shell32")]
unsafe extern "system" {
    safe fn SHGetKnownFolderPath(id: &Guid, flags: u32, user: isize, path: &mut *mut u16) -> i32;
}

#[link(name = "ole32")]
unsafe extern "system" {
    fn CoTaskMemFree(memory: *mut c_void);
}

#[link(name = "kernel32")]
unsafe extern "system" {
    safe fn IsWow64Process2(process: isize, of_process: &mut u16, of_system: &mut u16) -> i32;
    fn CreateProcessW(
        program: *const u16,
        command_line: *mut u16,
        security_of_process: *const c_void,
        security_of_thread: *const c_void,
        inherits_handles: i32,
        flags: u32,
        environment: *const u16,
        directory: *const u16,
        how: &StartupInfo,
        started: &mut Started,
    ) -> i32;
    fn InitializeProcThreadAttributeList(
        list: *mut usize,
        count: u32,
        flags: u32,
        size: &mut usize,
    ) -> i32;
    fn UpdateProcThreadAttribute(
        list: *mut usize,
        flags: u32,
        attribute: usize,
        value: *const c_void,
        size: usize,
        previous: *mut c_void,
        returned: *mut usize,
    ) -> i32;
    fn DeleteProcThreadAttributeList(list: *mut usize);
    fn SetHandleInformation(handle: *mut c_void, mask: u32, flags: u32) -> i32;
    safe fn GetStdHandle(which: i32) -> *mut c_void;
    fn LocalFree(memory: *mut c_void) -> *mut c_void;
    safe fn SetProcessInformation(process: isize, kind: u32, it: &[u32; 3], size: u32) -> i32;
    fn GetUserPreferredUILanguages(
        flags: u32,
        count: &mut u32,
        names: *mut u16,
        length: &mut u32,
    ) -> i32;
}

#[link(name = "ntdll")]
unsafe extern "system" {
    safe fn NtSetTimerResolution(ticks: u32, is_set: bool, now: &mut u32) -> i32;
    safe fn RtlGetLastNtStatus() -> u32;
}

/// Threads sleep for multiples of 1 ms, and not of 15.6 ms.
pub(crate) fn set_fine_clock(is_on: bool) {
    const POWER_THROTTLING: u32 = 4;
    const IGNORE_TIMER_RESOLUTION: u32 = 4;
    // Even if no window is seen.
    let controlled = IGNORE_TIMER_RESOLUTION * u32::from(is_on);
    SetProcessInformation(-1, POWER_THROTTLING, &[1, controlled, 0], 12);
    NtSetTimerResolution(10_000, is_on, &mut 0);
}

#[link(name = "iphlpapi")]
unsafe extern "system" {
    safe fn GetBestInterfaceEx(address: &[u16; 14], index: &mut u32) -> u32;
}

#[link(name = "crypt32")]
unsafe extern "system" {
    fn CryptProtectData(
        from: &Blob,
        description: *const c_void,
        entropy: *const Blob,
        reserved: *const c_void,
        prompt: *const c_void,
        flags: u32,
        to: &mut Blob,
    ) -> i32;
    fn CryptUnprotectData(
        from: &Blob,
        description: *const c_void,
        entropy: *const Blob,
        reserved: *const c_void,
        prompt: *const c_void,
        flags: u32,
        to: &mut Blob,
    ) -> i32;
}

#[link(name = "advapi32")]
unsafe extern "system" {
    fn RegGetValueW(
        root: isize,
        key: *const u16,
        name: *const u16,
        flags: u32,
        kind: *mut u32,
        data: *mut c_void,
        size: *mut u32,
    ) -> i32;
    fn RegSetKeyValueW(
        root: isize,
        key: *const u16,
        name: *const u16,
        kind: u32,
        data: *const c_void,
        size: u32,
    ) -> i32;
    fn RegOpenKeyExW(
        root: isize,
        key: *const u16,
        options: u32,
        access: u32,
        opened: &mut isize,
    ) -> i32;
    fn RegEnumValueW(
        key: isize,
        index: u32,
        name: *mut u16,
        length: &mut u32,
        reserved: *mut u32,
        kind: *mut u32,
        data: *mut u8,
        size: *mut u32,
    ) -> i32;
    fn RegCloseKey(key: isize) -> i32;
    fn RegDeleteKeyValueW(root: isize, key: *const u16, name: *const u16) -> i32;
    fn RegDeleteTreeW(root: isize, key: *const u16) -> i32;
}

/// By a name that `app.getPath()` takes.
pub(crate) fn known_folder(name: &str) -> Option<String> {
    let id: u128 = match name {
        "home" => 0x5e6c858f_0e22_4760_9afe_ea3317b67173,
        "appData" | "cache" => 0x3eb685db_65f9_4cf6_a03a_e3ef65729f3d,
        "desktop" => 0xb4bfcc3a_db2c_424c_b029_7fe99a87c641,
        "documents" => 0xfdd39ad0_238f_46af_adb4_6c85480369c7,
        "downloads" => 0x374de290_123f_4565_9164_39c4925e467b,
        "music" => 0x4bd8d571_6d19_48d3_be97_422220080e43,
        "pictures" => 0x33e28130_4e1e_4676_835a_98395c3bc3bb,
        "videos" => 0x18989b1d_99b5_455b_841c_ab7c74e4ddfc,
        "recent" => 0xae50c081_ebd2_438a_8655_8a092e34987a,
        _ => return None,
    };
    let id = Guid(
        (id >> 96) as u32,
        (id >> 80) as u16,
        (id >> 64) as u16,
        (id as u64).to_be_bytes(),
    );
    let mut path = null_mut();
    let status = SHGetKnownFolderPath(&id, 0, 0, &mut path);
    // SAFETY: a terminated string unless it has failed, and the caller's to free in any case.
    unsafe {
        let found =
            (status >= 0).then(|| String::from_utf16_lossy(bun_core::ffi::wstr_units(path)));
        CoTaskMemFree(path.cast());
        found
    }
}

/// A process, and all that it starts. None outlives this one.
pub(crate) struct Family {
    job: OwnedHandle,
    head: OwnedHandle,
}

impl Family {
    pub(crate) fn of(id: u32) -> Option<Family> {
        const ASSIGN_AND_WAIT: u32 = 0x100 | 0x1 | 0x10_0000;
        let (job, head) = (
            windows::create_kill_on_close_job()?,
            windows::OpenProcess(ASSIGN_AND_WAIT, id).ok()?,
        );
        windows::AssignProcessToJobObject(&job, head.as_raw_handle()).ok()?;
        Some(Family { job, head })
    }

    /// The files that they have open cannot be removed.
    pub(crate) fn end(self) {
        drop(self.job);
        windows::kernel32::WaitForSingleObject(self.head.as_raw_handle(), 500);
    }
}

pub(crate) fn is_translated() -> bool {
    const ARM64: u16 = 0xAA64;
    let mut machine = 0;
    IsWow64Process2(-1, &mut 0, &mut machine);
    cfg!(target_arch = "x86_64") && machine == ARM64
}

/// Whether there is a route to an address that is nobody's.
pub(crate) fn has_network() -> bool {
    let (mut old, mut new) = ([0; 14], [0; 14]);
    old[..4].copy_from_slice(&[2, 0, 0x00c0, 0x0102]);
    new[..6].copy_from_slice(&[23, 0, 0, 0, 0x0120, 0xb80d]);
    [old, new]
        .iter()
        .any(|it| GetBestInterfaceEx(it, &mut 0) == 0)
}

pub(crate) fn preferred_languages() -> Vec<String> {
    const BY_NAME: u32 = 8;
    let listed = registry::list("Control Panel\\International\\User Profile", "Languages");
    if !listed.is_empty() {
        return listed;
    }
    let mut names = [0; 1024];
    let mut length = names.len() as u32;
    // SAFETY: the buffer with its length.
    unsafe { GetUserPreferredUILanguages(BY_NAME, &mut 0, names.as_mut_ptr(), &mut length) };
    texts_in(&names)
}

/// Each ends with a zero.
fn texts_in(units: &[u16]) -> Vec<String> {
    let all = String::from_utf16_lossy(units);
    (bun_core::strings::tokenize(all.as_bytes(), b"\0").map(crate::prelude::string)).collect()
}

fn with_key_of_user(how: Protect, data: &[u8]) -> io::Result<Vec<u8>> {
    const WITHOUT_ASKING: u32 = 1;
    let from = Blob {
        length: data.len().try_into().map_err(io::Error::other)?,
        bytes: data.as_ptr().cast_mut(),
    };
    let mut to = Blob {
        length: 0,
        bytes: null_mut(),
    };
    // SAFETY: it only reads `from`, and what it makes is the caller's to free.
    unsafe {
        if how(
            &from,
            null(),
            null(),
            null(),
            null(),
            WITHOUT_ASKING,
            &mut to,
        ) == 0
        {
            return Err(io::Error::last_os_error());
        }
        let made = bun_core::ffi::slice(to.bytes, to.length as usize).to_vec();
        LocalFree(to.bytes.cast());
        Ok(made)
    }
}

/// So that only this user can read it.
pub(crate) fn protect(data: &[u8]) -> io::Result<Vec<u8>> {
    with_key_of_user(CryptProtectData, data)
}

pub(crate) fn unprotect(data: &[u8]) -> io::Result<Vec<u8>> {
    with_key_of_user(CryptUnprotectData, data)
}

/// It is damaged, or the system does not have the key that protects it.
pub(crate) fn needs_another_key(failure_to_unprotect: &io::Error) -> bool {
    const INVALID_DATA: i32 = 13;
    const INVALID_PARAMETER: i32 = 87;
    const BAD_DATA: i32 = 0x8009_0005_u32 as i32;
    const BAD_KEY_STATE: i32 = 0x8009_000b_u32 as i32;
    matches!(
        failure_to_unprotect.raw_os_error(),
        Some(INVALID_DATA | INVALID_PARAMETER | BAD_DATA | BAD_KEY_STATE)
    )
}

/// It goes with the handle, and others can read it. `None` while it is another's.
pub(crate) fn create_lock(file: &Wide) -> io::Result<Option<OwnedHandle>> {
    use windows::{FILE_SHARE_READ, GENERIC_WRITE, Win32Error};
    const CREATE_ALWAYS: u32 = 2;
    const DELETE_ON_CLOSE: u32 = 0x400_0000;
    let (name, how) = (file.as_wstr(), DELETE_ON_CLOSE);
    match windows::CreateFileW(name, GENERIC_WRITE, FILE_SHARE_READ, CREATE_ALWAYS, how) {
        Ok(file) => Ok(Some(file)),
        Err(Win32Error::SHARING_VIOLATION) => Ok(None),
        Err(_) if RtlGetLastNtStatus() == windows::NTSTATUS::DELETE_PENDING.0 => Ok(None),
        Err(error) => Err(io::Error::from_raw_os_error(error.0.into())),
    }
}

pub(crate) fn take_turn(file: &str) -> Option<OwnedHandle> {
    let file = Wide::new(file);
    for _ in 0..500 {
        match create_lock(&file).ok()? {
            None => std::thread::sleep(core::time::Duration::from_millis(5)),
            lock => return lock,
        }
    }
    None
}

/// As `CommandLineToArgvW` takes it apart.
pub(crate) fn command_line(command: &[String]) -> String {
    let quote = |argument: &String| {
        let (mut quoted, mut backslashes) = (String::from('"'), 0);
        for it in argument.chars() {
            if it == '"' {
                quoted.extend(core::iter::repeat_n('\\', backslashes + 1));
            }
            backslashes = if it == '\\' { backslashes + 1 } else { 0 };
            quoted.push(it);
        }
        quoted.extend(core::iter::repeat_n('\\', backslashes));
        quoted + "\""
    };
    command.iter().map(quote).collect::<Vec<_>>().join(" ")
}

/// It outlives this process, and writes to where this one does.
pub(crate) fn start(command: &[String], environment: impl Iterator<Item = String>) {
    const WIDE_ENVIRONMENT: u32 = 0x400;
    const WITH_ATTRIBUTES: u32 = 0x8_0000;
    const OUTSIDE_THE_JOB: u32 = 0x100_0000;
    const INHERITED_HANDLES: usize = 0x2_0002;
    const HAS_STANDARD_HANDLES: u32 = 0x100;
    let environment: Vec<u16> = (environment.flat_map(|it| Wide::new(&it).0))
        .chain([0, 0])
        .collect();
    let Some(program) = command.first().map(|it| Wide::new(it)) else {
        return;
    };
    let pass_on = |which| {
        let handle = GetStdHandle(which);
        // SAFETY: it refuses what is not a handle.
        match unsafe { SetHandleInformation(handle, 1, 1) } {
            0 => null_mut(),
            _ => handle,
        }
    };
    let standard = [null_mut(), pass_on(-11), pass_on(-12)];
    let mut inherited: Vec<_> = standard.into_iter().filter(|it| !it.is_null()).collect();
    inherited.dedup();
    let mut attributes = [0; 16];
    let how = StartupInfo {
        size: size_of::<StartupInfo>() as u32,
        texts: [0; 3],
        numbers: [0; 7],
        flags: HAS_STANDARD_HANDLES,
        reserved: [0; 2],
        standard,
        attributes: attributes.as_mut_ptr(),
    };
    // SAFETY: buffers with their sizes, which outlive the list, and terminated strings, of which it may change the
    // second. The handles of what has been started are the caller's.
    unsafe {
        let mut size = size_of_val(&attributes);
        if InitializeProcThreadAttributeList(how.attributes, 1, 0, &mut size) == 0 {
            return;
        }
        let inherits = !inherited.is_empty()
            && UpdateProcThreadAttribute(
                how.attributes,
                0,
                INHERITED_HANDLES,
                inherited.as_ptr().cast(),
                size_of_val(&*inherited),
                null_mut(),
                null_mut(),
            ) != 0;
        // Not every job may be left.
        for leaves in [OUTSIDE_THE_JOB, 0] {
            let mut started = Started {
                handles: [null_mut(); 2],
                ids: [0; 2],
            };
            if CreateProcessW(
                program.as_ptr(),
                Wide::new(&command_line(command)).0.as_mut_ptr(),
                null(),
                null(),
                inherits.into(),
                WIDE_ENVIRONMENT | WITH_ATTRIBUTES | leaves,
                environment.as_ptr(),
                null(),
                &how,
                &mut started,
            ) != 0
            {
                (started.handles.into_iter()).for_each(|it| drop(OwnedHandle::from_raw_handle(it)));
                break;
            }
        }
        DeleteProcThreadAttributeList(how.attributes);
    }
}

/// Below `HKEY_CURRENT_USER`. The empty name is that of the default value.
pub(crate) mod registry {
    use super::*;

    const USER: isize = 0x8000_0001_u32 as i32 as isize;

    pub(crate) fn bytes(key: &str, name: &str) -> Option<Vec<u8>> {
        const ANY_KIND: u32 = 0xffff;
        let (key, name, mut data) = (Wide::new(key), Wide::new(name), vec![0u8; 1 << 16]);
        let mut size = data.len() as u32;
        // SAFETY: terminated strings, and the buffer with its size.
        let status = unsafe {
            RegGetValueW(
                USER,
                key.as_ptr(),
                name.as_ptr(),
                ANY_KIND,
                null_mut(),
                data.as_mut_ptr().cast(),
                &raw mut size,
            )
        };
        data.truncate(size as usize);
        (status == 0).then_some(data)
    }

    pub(crate) fn text(key: &str, name: &str) -> Option<String> {
        let bytes = bytes(key, name)?;
        let units = bytes.as_chunks().0.iter().map(|it| u16::from_le_bytes(*it));
        Some(String::from_utf16_lossy(
            &units.take_while(|it| *it != 0).collect::<Vec<_>>(),
        ))
    }

    pub(crate) fn list(key: &str, name: &str) -> Vec<String> {
        let bytes = bytes(key, name).unwrap_or_default();
        let units: Vec<_> = (bytes.as_chunks().0.iter())
            .map(|it| u16::from_le_bytes(*it))
            .collect();
        texts_in(&units)
    }

    /// With their names.
    pub(crate) fn texts(key: &str) -> Vec<(String, String)> {
        const TO_READ: u32 = 1;
        let (mut opened, mut name) = (0, vec![0; 1 << 14]);
        // SAFETY: a terminated string, the buffer with its length, and a key that is closed once.
        let names: Vec<String> = unsafe {
            if RegOpenKeyExW(USER, Wide::new(key).as_ptr(), 0, TO_READ, &mut opened) != 0 {
                return Vec::new();
            }
            let at = |index| {
                let (mut length, none) = (name.len() as u32, null_mut());
                let status = RegEnumValueW(
                    opened,
                    index,
                    name.as_mut_ptr(),
                    &mut length,
                    none,
                    none,
                    null_mut(),
                    none,
                );
                (status == 0).then(|| String::from_utf16_lossy(&name[..length as usize]))
            };
            let names = (0..).map_while(at).collect();
            RegCloseKey(opened);
            names
        };
        let with_value = |name: String| text(key, &name).map(|it| (name, it));
        names.into_iter().filter_map(with_value).collect()
    }

    fn set(key: &str, name: &str, kind: u32, data: &[u8]) -> bool {
        let (key, name) = (Wide::new(key), Wide::new(name));
        // SAFETY: as above.
        unsafe {
            RegSetKeyValueW(
                USER,
                key.as_ptr(),
                name.as_ptr(),
                kind,
                data.as_ptr().cast(),
                data.len() as u32,
            ) == 0
        }
    }

    pub(crate) fn set_bytes(key: &str, name: &str, data: &[u8]) -> bool {
        set(key, name, 3, data)
    }

    pub(crate) fn set_text(key: &str, name: &str, text: &str) -> bool {
        let units = Wide::new(text).0.into_iter();
        set(
            key,
            name,
            1,
            &units.flat_map(u16::to_le_bytes).collect::<Vec<_>>(),
        )
    }

    pub(crate) fn remove(key: &str, name: &str) {
        // SAFETY: terminated strings.
        unsafe { RegDeleteKeyValueW(USER, Wide::new(key).as_ptr(), Wide::new(name).as_ptr()) };
    }

    pub(crate) fn remove_all(key: &str) -> bool {
        // SAFETY: as above.
        unsafe { RegDeleteTreeW(USER, Wide::new(key).as_ptr()) == 0 }
    }
}
