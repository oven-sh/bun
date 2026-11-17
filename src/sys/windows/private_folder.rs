//! What `mkdir` with mode 0700 and a look at `st_uid` and `st_mode` are on POSIX.

use core::ffi::{c_int, c_void};
use core::ptr::null_mut;
use std::os::windows::io::{AsRawHandle as _, IntoRawHandle as _};

use bun_core::WStr;
use bun_windows_sys::externs as win32;
use win32::{BOOL, DWORD, HANDLE};

type PSID = *mut c_void;

const TOKEN_USER: c_int = 1;
const OWNER_AND_DACL: DWORD = 1 | 4;
const SDDL_REVISION_1: DWORD = 1;
const LOCAL_SYSTEM: c_int = 22;
const BUILTIN_ADMINISTRATORS: c_int = 26;
const ACCESS_ALLOWED_ACE: u8 = 0;
const ACCESS_DENIED_ACE: u8 = 1;
const FILE_FLAG_OPEN_REPARSE_POINT: DWORD = 0x0020_0000;

#[repr(C)]
struct Acl {
    revision: u8,
    padding: u8,
    size: u16,
    count: u16,
}

#[repr(C)]
struct Ace {
    kind: u8,
    flags: u8,
    size: u16,
    mask: u32,
    sid: u32,
}

#[link(name = "advapi32")]
unsafe extern "system" {
    fn GetKernelObjectSecurity(
        handle: HANDLE,
        requested: DWORD,
        descriptor: *mut c_void,
        length: DWORD,
        needed: *mut DWORD,
    ) -> BOOL;
    fn GetSecurityDescriptorOwner(
        descriptor: *mut c_void,
        owner: *mut PSID,
        is_defaulted: *mut BOOL,
    ) -> BOOL;
    fn GetSecurityDescriptorDacl(
        descriptor: *mut c_void,
        is_present: *mut BOOL,
        dacl: *mut *mut c_void,
        is_defaulted: *mut BOOL,
    ) -> BOOL;
    fn GetAce(acl: *mut c_void, index: DWORD, ace: *mut *mut Ace) -> BOOL;
    fn EqualSid(a: PSID, b: PSID) -> BOOL;
    fn IsWellKnownSid(sid: PSID, kind: c_int) -> BOOL;
    fn ConvertSidToStringSidW(sid: PSID, text: *mut *mut u16) -> BOOL;
    fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
        text: *const u16,
        revision: DWORD,
        descriptor: *mut *mut c_void,
        size: *mut DWORD,
    ) -> BOOL;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn LocalFree(memory: *mut c_void) -> *mut c_void;
}

/// What the system allocated with `LocalAlloc`.
struct Local<T>(*mut T);

impl<T> Drop for Local<T> {
    fn drop(&mut self) {
        // SAFETY: the system allocated it for this owner.
        unsafe { LocalFree(self.0.cast()) };
    }
}

struct User(Box<[u64; 16]>);

impl User {
    fn current() -> Option<User> {
        let token = super::process_token()?;
        let mut user = Box::new([0u64; 16]);
        let mut length: DWORD = 0;
        // SAFETY: `token` is open; the buffer is writable for the length given.
        let is_read = unsafe {
            win32::GetTokenInformation(
                token.as_raw_handle(),
                TOKEN_USER,
                user.as_mut_ptr().cast(),
                size_of_val(&*user) as DWORD,
                &mut length,
            )
        };
        (is_read != 0).then_some(User(user))
    }

    fn sid(&self) -> PSID {
        self.0[0] as usize as PSID
    }

    /// # Safety
    /// `sid` points to a valid SID.
    unsafe fn trusts(&self, sid: PSID) -> bool {
        // SAFETY: both are valid SIDs: one out of the token, the other by caller contract.
        unsafe {
            EqualSid(sid, self.sid()) != 0
                || IsWellKnownSid(sid, LOCAL_SYSTEM) != 0
                || IsWellKnownSid(sid, BUILTIN_ADMINISTRATORS) != 0
        }
    }

    fn has_exclusive_access(&self, handle: HANDLE) -> bool {
        let mut needed: DWORD = 0;
        // SAFETY: a length of 0 asks for the length only.
        unsafe { GetKernelObjectSecurity(handle, OWNER_AND_DACL, null_mut(), 0, &mut needed) };
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        let descriptor: *mut c_void = buffer.as_mut_ptr().cast();
        let (mut owner, mut dacl, mut is_present, mut is_defaulted): (
            PSID,
            *mut c_void,
            BOOL,
            BOOL,
        ) = (null_mut(), null_mut(), 0, 0);
        // SAFETY: `buffer` holds `needed` bytes; what the two getters hand out points into it, and it lives to the end of this function.
        let is_read = unsafe {
            GetKernelObjectSecurity(handle, OWNER_AND_DACL, descriptor, needed, &mut needed) != 0
                && GetSecurityDescriptorOwner(descriptor, &mut owner, &mut is_defaulted) != 0
                && GetSecurityDescriptorDacl(
                    descriptor,
                    &mut is_present,
                    &mut dacl,
                    &mut is_defaulted,
                ) != 0
        };
        if !is_read || owner.is_null() || is_present == 0 || dacl.is_null() {
            return false;
        }
        // SAFETY: `owner` is the SID of a descriptor that the system handed over.
        if !unsafe { self.trusts(owner) } {
            return false;
        }
        // SAFETY: `dacl` is a valid ACL, which begins with this header.
        let count = unsafe { (*dacl.cast::<Acl>()).count };
        (0..count).all(|index| {
            let mut ace: *mut Ace = null_mut();
            // SAFETY: `dacl` is a valid ACL and `ace` a valid out-param.
            if unsafe { GetAce(dacl, index.into(), &mut ace) } == 0 {
                return false;
            }
            // SAFETY: an entry of either kind that is let through is a header, a mask and a SID.
            unsafe {
                let (kind, sid) = ((*ace).kind, (&raw mut (*ace).sid).cast());
                kind == ACCESS_DENIED_ACE || (kind == ACCESS_ALLOWED_ACE && self.trusts(sid))
            }
        })
    }

    fn create(&self, path: &WStr) {
        let mut sid: *mut u16 = null_mut();
        // SAFETY: a valid SID and a valid out-param.
        if unsafe { ConvertSidToStringSidW(self.sid(), &mut sid) } == 0 {
            return;
        }
        let sid = Local(sid);
        // SAFETY: the system wrote a NUL-terminated string.
        let user = String::from_utf16_lossy(unsafe { bun_core::ffi::wstr_units(sid.0) });
        let text: Vec<u16> =
            format!("O:{user}D:P(A;OICI;FA;;;{user})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)\0")
                .encode_utf16()
                .collect();
        let mut descriptor: *mut c_void = null_mut();
        // SAFETY: `text` is NUL-terminated; `descriptor` is a valid out-param.
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                text.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                null_mut(),
            )
        } == 0
        {
            return;
        }
        let descriptor = Local(descriptor);
        let mut attributes = win32::SECURITY_ATTRIBUTES {
            nLength: size_of::<win32::SECURITY_ATTRIBUTES>() as DWORD,
            lpSecurityDescriptor: descriptor.0,
            bInheritHandle: 0,
        };
        // SAFETY: `path` is NUL-terminated; `descriptor` outlives the call.
        unsafe { win32::CreateDirectoryW(path.as_ptr(), &mut attributes) };
    }
}

/// Makes the folder unless there is something at `path`.
pub fn make_or_find(path: &[u8]) -> bool {
    static VERIFIED_FOLDERS: std::sync::Mutex<Vec<Vec<u8>>> = std::sync::Mutex::new(Vec::new());
    let Ok(mut verified_folders) = VERIFIED_FOLDERS.lock() else {
        return false;
    };
    if verified_folders.iter().any(|folder| folder == path) {
        return true;
    }
    let Some(user) = User::current() else {
        return false;
    };
    let mut wide = bun_paths::w_path_buffer_pool::get();
    let wide = bun_paths::string_paths::to_kernel32_path(&mut wide.0[..], path);
    user.create(wide);
    let Ok(handle) = super::CreateFileW(
        wide,
        win32::FILE_LIST_DIRECTORY | win32::READ_CONTROL,
        win32::FILE_SHARE_READ | win32::FILE_SHARE_WRITE,
        win32::OPEN_EXISTING,
        win32::FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
    ) else {
        return false;
    };
    let is_folder = super::GetFileInformationByHandle(handle.as_raw_handle()).is_ok_and(|found| {
        found.dwFileAttributes
            & (win32::FILE_ATTRIBUTE_DIRECTORY | win32::FILE_ATTRIBUTE_REPARSE_POINT)
            == win32::FILE_ATTRIBUTE_DIRECTORY
    });
    if !is_folder || !user.has_exclusive_access(handle.as_raw_handle()) {
        return false;
    }
    // `handle` stays open on purpose: it does not share deletion, so nobody can put another folder in this one's place.
    let _ = handle.into_raw_handle();
    verified_folders.push(path.to_vec());
    true
}
