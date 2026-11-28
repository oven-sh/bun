//! Safe wrappers for the ntdll file APIs.

use core::ffi::c_void;
use core::ptr;
use std::sync::LazyLock;

use bun_core::ffi::{Zeroable, zeroed};
use bun_core::{WStr, wstr};
use bun_paths::WPathBuffer;
use bun_paths::path_buffer_pool::PoolGuard;
use bun_windows_sys::externs::{self as w, FILE_INFORMATION_CLASS, FS_INFORMATION_CLASS};

use super::{
    HANDLE, IO_STATUS_BLOCK, LONG_PATH_PREFIX, NT_SUCCESS, NTSTATUS, Win32Error, find_export,
    ntdll, sync_io,
};
use crate::windows_format::path_syntax;

fn to_unicode_string(text: &[u16]) -> Result<w::UNICODE_STRING, NTSTATUS> {
    let len = u16::try_from(size_of_val(text)).map_err(|_| NTSTATUS::NAME_TOO_LONG)?;
    // https://github.com/rust-lang/rust/issues/143078
    let (buffer, capacity) = match text {
        [] => (WStr::EMPTY.as_ptr(), 2),
        _ => (text.as_ptr(), len),
    };
    Ok(w::UNICODE_STRING {
        Length: len,
        MaximumLength: capacity,
        Buffer: buffer.cast_mut(),
    })
}

/// `name` is relative to `root`, and is `None` for an unnamed pipe.
pub(super) fn with_object_attributes(
    root: Option<HANDLE>,
    name: Option<&[u16]>,
    call: impl FnOnce(&mut w::OBJECT_ATTRIBUTES) -> NTSTATUS,
) -> NTSTATUS {
    let mut name = match name.map_or(Ok(zeroed()), to_unicode_string) {
        Ok(name) => name,
        Err(status) => return status,
    };
    let mut attributes = w::OBJECT_ATTRIBUTES {
        Length: size_of::<w::OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: root.unwrap_or(ptr::null_mut()),
        ObjectName: &raw mut name,
        Attributes: w::OBJ_CASE_INSENSITIVE,
        SecurityDescriptor: ptr::null_mut(),
        SecurityQualityOfService: ptr::null_mut(),
    };
    call(&mut attributes)
}

pub(super) fn with_file_object_attributes(
    root: Option<HANDLE>,
    name: &[u16],
    call: impl FnOnce(&mut w::OBJECT_ATTRIBUTES) -> NTSTATUS,
) -> NTSTATUS {
    let mut qos = w::SECURITY_QUALITY_OF_SERVICE {
        Length: size_of::<w::SECURITY_QUALITY_OF_SERVICE>() as u32,
        ImpersonationLevel: w::SecurityAnonymous,
        ContextTrackingMode: 0,
        EffectiveOnly: 0,
    };
    with_object_attributes(root, Some(name), |attributes| {
        if !path_syntax::is_device_name(name) {
            attributes.SecurityQualityOfService = (&raw mut qos).cast();
        }
        call(attributes)
    })
}

/// A Win32 path converted to an NT path the way the kernel32 file APIs convert it.
pub(super) enum NtPath {
    Verbatim(PoolGuard<WPathBuffer>, usize),
    Resolved(w::UNICODE_STRING, w::RTL_RELATIVE_NAME_U),
}

/// SAFETY: `string.Buffer` is readable for `string.Length` bytes as long as `string` is borrowed.
unsafe fn as_wide_slice(string: &w::UNICODE_STRING) -> &[u16] {
    // SAFETY: fn contract.
    unsafe { core::slice::from_raw_parts(string.Buffer, usize::from(string.Length) / 2) }
}

impl NtPath {
    /// Converts the Win32 path in `buf[..len]`.
    pub(super) fn new(mut buf: PoolGuard<WPathBuffer>, len: usize) -> Result<Self, Win32Error> {
        if len > LONG_PATH_PREFIX.len() && buf.starts_with(&LONG_PATH_PREFIX) {
            buf[1] = b'?'.into();
            return Ok(Self::Verbatim(buf, len));
        }
        buf[len] = 0;
        let path = WStr::from_buf(&buf[..], len);
        let mut full_name = zeroed();
        let mut relative = zeroed();
        // SAFETY: `path` is NUL-terminated, and the other arguments are null or valid out-params.
        let status = unsafe {
            ntdll::RtlDosPathNameToRelativeNtPathName_U_WithStatus(
                path.as_ptr(),
                &raw mut full_name,
                ptr::null_mut(),
                &raw mut relative,
            )
        };
        match status {
            NTSTATUS::SUCCESS => Ok(Self::Resolved(full_name, relative)),
            NTSTATUS::NO_MEMORY => Err(Win32Error::NOT_ENOUGH_MEMORY),
            _ => Err(Win32Error::PATH_NOT_FOUND),
        }
    }

    pub(super) fn full_name(&self) -> &[u16] {
        match self {
            Self::Verbatim(buf, len) => &buf[..*len],
            // SAFETY: `self` owns the buffer.
            Self::Resolved(full_name, _) => unsafe { as_wide_slice(full_name) },
        }
    }

    /// `RootDirectory` and `ObjectName`. The root of a relative path is the current directory handle.
    pub(super) fn root_and_name(&self) -> (Option<HANDLE>, &[u16]) {
        match self {
            Self::Resolved(_, relative) if relative.RelativeName.Length > 0 => {
                // SAFETY: `RelativeName` is a suffix of the buffer that `self` owns.
                let name = unsafe { as_wide_slice(&relative.RelativeName) };
                (Some(relative.ContainingDirectory), name)
            }
            _ => (None, self.full_name()),
        }
    }
}

impl Drop for NtPath {
    fn drop(&mut self) {
        if let Self::Resolved(full_name, relative) = self {
            // SAFETY: ntdll initialized both, and neither was modified.
            unsafe {
                ntdll::RtlReleaseRelativeName(relative);
                ntdll::RtlFreeUnicodeString(full_name);
            }
        }
    }
}

/// SAFETY: `Self` has the layout of the structure for `CLASS`, and every bit pattern is valid.
pub(super) unsafe trait NtInformation<Class>: Zeroable {
    const CLASS: Class;
}

macro_rules! impl_nt_information {
    ($Class:ident: $($Struct:ident = $class:ident,)*) => {$(
        // SAFETY: all fields are integers, laid out as in the SDK headers.
        unsafe impl NtInformation<$Class> for w::$Struct {
            const CLASS: $Class = $Class::$class;
        }
    )*};
}
impl_nt_information!(FILE_INFORMATION_CLASS:
    FILE_ACCESS_INFORMATION = FileAccessInformation,
    FILE_ALL_INFORMATION = FileAllInformation,
    FILE_BASIC_INFORMATION = FileBasicInformation,
    FILE_DISPOSITION_INFORMATION = FileDispositionInformation,
    FILE_DISPOSITION_INFORMATION_EX = FileDispositionInformationEx,
    FILE_END_OF_FILE_INFORMATION = FileEndOfFileInformation,
    FILE_ID_FULL_DIR_INFORMATION = FileIdFullDirectoryInformation,
    FILE_MODE_INFORMATION = FileModeInformation,
    FILE_PIPE_INFORMATION = FilePipeInformation,
    FILE_PIPE_LOCAL_INFORMATION = FilePipeLocalInformation,
    FILE_POSITION_INFORMATION = FilePositionInformation,
    FILE_STANDARD_INFORMATION = FileStandardInformation,
    FILE_STAT_BASIC_INFORMATION = FileStatBasicInformation,
);
impl_nt_information!(FS_INFORMATION_CLASS:
    FILE_FS_DEVICE_INFORMATION = FileFsDeviceInformation,
    FILE_FS_SIZE_INFORMATION = FileFsSizeInformation,
    FILE_FS_VOLUME_INFORMATION = FileFsVolumeInformation,
);

fn check_status(status: NTSTATUS) -> Result<(), NTSTATUS> {
    if NT_SUCCESS(status) {
        Ok(())
    } else {
        Err(status)
    }
}

fn fill_info<T: Zeroable>(call: impl FnOnce(*mut c_void, u32) -> NTSTATUS) -> Result<T, NTSTATUS> {
    let mut info: T = zeroed();
    match call((&raw mut info).cast(), size_of::<T>() as u32) {
        // Only the trailing variable-length name was truncated.
        NTSTATUS::BUFFER_OVERFLOW => Ok(info),
        status => check_status(status).map(|()| info),
    }
}

pub(super) fn query_file_info<T: NtInformation<FILE_INFORMATION_CLASS>>(
    file: HANDLE,
) -> Result<T, NTSTATUS> {
    let mut io: IO_STATUS_BLOCK = zeroed();
    // SAFETY: `info` is writable for `len` bytes, and the call returns after the request completes.
    fill_info(|info, len| unsafe {
        ntdll::NtQueryInformationFile(file, &raw mut io, info, len, T::CLASS)
    })
}

/// Blocks behind a request that is in progress if it is.
pub(super) fn is_synchronous(file: HANDLE) -> Result<bool, NTSTATUS> {
    const FILE_SYNCHRONOUS_IO_ALERT: u32 = 0x10;
    let info = query_file_info::<w::FILE_MODE_INFORMATION>(file)?;
    Ok(info.Mode & (FILE_SYNCHRONOUS_IO_ALERT | w::FILE_SYNCHRONOUS_IO_NONALERT) != 0)
}

pub(super) fn query_volume_info<T: NtInformation<FS_INFORMATION_CLASS>>(
    file: HANDLE,
) -> Result<T, NTSTATUS> {
    let mut io: IO_STATUS_BLOCK = zeroed();
    // SAFETY: as in `query_file_info`.
    fill_info(|info, len| unsafe {
        ntdll::NtQueryVolumeInformationFile(file, &raw mut io, info, len, T::CLASS)
    })
}

/// Returns the first entry of `directory` that matches `pattern`.
pub(super) fn query_directory_entry<T: NtInformation<FILE_INFORMATION_CLASS>>(
    directory: HANDLE,
    pattern: &[u16],
) -> Result<T, NTSTATUS> {
    let mut pattern = to_unicode_string(pattern)?;
    let null = ptr::null_mut();
    fill_info(|info, len| {
        let (status, _) = sync_io::complete(directory, |io| {
            // SAFETY: the pointers are null or valid until `complete` returns.
            unsafe {
                ntdll::NtQueryDirectoryFile(
                    directory,
                    null,
                    null,
                    null,
                    io,
                    info,
                    len,
                    T::CLASS,
                    1,
                    &raw mut pattern,
                    1,
                )
            }
        });
        match status {
            NTSTATUS::NO_MORE_FILES => NTSTATUS::NO_SUCH_FILE,
            NTSTATUS::BUFFER_OVERFLOW => NTSTATUS::NAME_TOO_LONG,
            status => status,
        }
    })
}

type NtQueryInformationByName = unsafe extern "system" fn(
    *mut w::OBJECT_ATTRIBUTES,
    *mut IO_STATUS_BLOCK,
    *mut c_void,
    u32,
    FILE_INFORMATION_CLASS,
) -> NTSTATUS;

static QUERY_BY_NAME: LazyLock<Option<NtQueryInformationByName>> = LazyLock::new(|| {
    // SAFETY: neither module is unloaded. The first export is never called; the second has this type.
    unsafe {
        // Feature probe: this export shipped together with `FileStatBasicInformation`.
        find_export::<*mut c_void>(wstr!("kernelbase.dll"), c"GetFileInformationByName")?;
        find_export(wstr!("ntdll.dll"), c"NtQueryInformationByName")
    }
});

pub(super) fn has_stat_basic() -> bool {
    QUERY_BY_NAME.is_some()
}

/// Does not follow a reparse point in the last component.
pub(super) fn query_stat_basic_by_name(
    nt_path: &NtPath,
) -> Result<w::FILE_STAT_BASIC_INFORMATION, NTSTATUS> {
    let query = QUERY_BY_NAME.ok_or(NTSTATUS::NOT_IMPLEMENTED)?;
    let (root, name) = nt_path.root_and_name();
    let mut io: IO_STATUS_BLOCK = zeroed();
    fill_info(|info, len| {
        with_file_object_attributes(root, name, |attributes| {
            let class = FILE_INFORMATION_CLASS::FileStatBasicInformation;
            // SAFETY: the pointers are valid for the call.
            unsafe { query(attributes, &raw mut io, info, len, class) }
        })
    })
}

pub(super) fn set_file_info<T: NtInformation<FILE_INFORMATION_CLASS>>(
    file: HANDLE,
    mut info: T,
) -> Result<(), NTSTATUS> {
    let mut io: IO_STATUS_BLOCK = zeroed();
    let info = (&raw mut info).cast();
    let len = size_of::<T>() as u32;
    // SAFETY: `info` is readable for `len` bytes, and the call returns after the request completes.
    check_status(unsafe { ntdll::NtSetInformationFile(file, &raw mut io, info, len, T::CLASS) })
}

/// Returns the status and the number of bytes written to `output`.
fn fs_control(file: HANDLE, code: u32, input: &[u8], output: &mut [u8]) -> (NTSTATUS, usize) {
    let null = ptr::null_mut();
    let ptr_or_null = |buf: *mut u8, len: usize| if len == 0 { null } else { buf.cast() };
    sync_io::complete(file, |io| {
        // SAFETY: the buffers are valid for their lengths until `complete` returns.
        // The control codes that this module passes have no pointers in their buffers.
        unsafe {
            ntdll::NtFsControlFile(
                file,
                null,
                null,
                null,
                io,
                code,
                ptr_or_null(input.as_ptr().cast_mut(), input.len()),
                input.len() as u32,
                ptr_or_null(output.as_mut_ptr(), output.len()),
                output.len() as u32,
            )
        }
    })
}

pub(super) fn get_reparse_point(file: HANDLE, buf: &mut [u8]) -> Result<&[u8], NTSTATUS> {
    let (status, len) = fs_control(file, w::FSCTL_GET_REPARSE_POINT, &[], buf);
    check_status(status)?;
    buf.get(..len).ok_or(NTSTATUS::BUFFER_OVERFLOW)
}

pub(super) fn set_reparse_point(file: HANDLE, data: &[u8]) -> Result<(), NTSTATUS> {
    check_status(fs_control(file, w::FSCTL_SET_REPARSE_POINT, data, &mut []).0)
}

/// Returns the fixed-size header of `FILE_PIPE_PEEK_BUFFER`.
pub(super) fn peek_pipe(pipe: HANDLE) -> Result<[u32; 4], NTSTATUS> {
    const FSCTL_PIPE_PEEK: u32 = 0x0011_400C;
    let mut header = [[0; 4]; 4];
    match fs_control(pipe, FSCTL_PIPE_PEEK, &[], header.as_flattened_mut()).0 {
        // The pipe holds data, and the buffer only has room for the header.
        NTSTATUS::BUFFER_OVERFLOW => {}
        status => check_status(status)?,
    }
    Ok(header.map(u32::from_ne_bytes))
}
