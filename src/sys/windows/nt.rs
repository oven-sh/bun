//! Safe forms of the file calls of ntdll.

use core::ffi::c_void;
use core::ptr;
use std::sync::LazyLock;

use bun_core::ffi::{Zeroable, zeroed};
use bun_core::{WStr, wstr};
use bun_paths::w_path_buffer_pool;
use bun_windows_sys::externs::{
    self as w, FILE_INFORMATION_CLASS as FileClass, FS_INFORMATION_CLASS as VolumeClass,
};

use super::{
    HANDLE, IO_STATUS_BLOCK, NT_SUCCESS, NTSTATUS, Win32Error, find_export, ntdll, sync_io,
};
use crate::windows_format::names;

fn counted(units: &[u16]) -> Result<w::UNICODE_STRING, NTSTATUS> {
    let len = u16::try_from(size_of_val(units)).map_err(|_| NTSTATUS::NAME_TOO_LONG)?;
    // https://github.com/rust-lang/rust/issues/143078
    let (buffer, capacity) = match units {
        [] => (WStr::EMPTY.as_ptr(), 2),
        _ => (units.as_ptr(), len),
    };
    Ok(w::UNICODE_STRING {
        Length: len,
        MaximumLength: capacity,
        Buffer: buffer.cast_mut(),
    })
}

/// Calls `call` with the attributes that name `name` below `root`. `None` is for a pipe without a name.
pub(super) fn with_attributes(
    root: Option<HANDLE>,
    name: Option<&[u16]>,
    call: impl FnOnce(&mut w::OBJECT_ATTRIBUTES) -> NTSTATUS,
) -> NTSTATUS {
    let mut name = match name.map_or(Ok(zeroed()), counted) {
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

pub(super) fn with_attributes_to_open(
    root: Option<HANDLE>,
    name: &[u16],
    call: impl FnOnce(&mut w::OBJECT_ATTRIBUTES) -> NTSTATUS,
) -> NTSTATUS {
    let mut quality = w::SECURITY_QUALITY_OF_SERVICE {
        Length: size_of::<w::SECURITY_QUALITY_OF_SERVICE>() as u32,
        ImpersonationLevel: w::SecurityAnonymous,
        ContextTrackingMode: 0,
        EffectiveOnly: 0,
    };
    with_attributes(root, Some(name), |attributes| {
        if !names::names_device(name) {
            attributes.SecurityQualityOfService = (&raw mut quality).cast();
        }
        call(attributes)
    })
}

/// The NT name that the file calls of kernel32 make of a path.
pub(super) enum Name {
    Verbatim(w_path_buffer_pool::Guard, usize),
    Resolved(w::UNICODE_STRING, w::RTL_RELATIVE_NAME_U),
}

/// SAFETY: `string` describes units that live as long as it does.
unsafe fn units(string: &w::UNICODE_STRING) -> &[u16] {
    // SAFETY: fn contract.
    unsafe { core::slice::from_raw_parts(string.Buffer, usize::from(string.Length) / 2) }
}

impl Name {
    /// The path is `buf[..len]`.
    pub(super) fn new(mut buf: w_path_buffer_pool::Guard, len: usize) -> Result<Self, Win32Error> {
        if len > 4 && buf.starts_with(&super::LONG_PATH_PREFIX) {
            buf[1] = b'?'.into();
            return Ok(Self::Verbatim(buf, len));
        }
        let path = WStr::nul_terminate(&mut buf[..], len);
        let (mut full, mut relative) = (zeroed(), zeroed());
        // SAFETY: `path` is NUL-terminated, and the others are null or valid out-params.
        let status = unsafe {
            ntdll::RtlDosPathNameToRelativeNtPathName_U_WithStatus(
                path.as_ptr(),
                &raw mut full,
                ptr::null_mut(),
                &raw mut relative,
            )
        };
        match status {
            NTSTATUS::SUCCESS => Ok(Self::Resolved(full, relative)),
            NTSTATUS::NO_MEMORY => Err(Win32Error::NOT_ENOUGH_MEMORY),
            _ => Err(Win32Error::PATH_NOT_FOUND),
        }
    }

    pub(super) fn full(&self) -> &[u16] {
        match self {
            Self::Verbatim(buf, len) => &buf[..*len],
            // SAFETY: `self` owns the buffer.
            Self::Resolved(full, _) => unsafe { units(full) },
        }
    }

    /// Below the current directory, if that is where the path starts.
    pub(super) fn parts(&self) -> (Option<HANDLE>, &[u16]) {
        match self {
            Self::Resolved(_, relative) if relative.RelativeName.Length > 0 => {
                // SAFETY: it is the end of the buffer that `self` owns.
                let name = unsafe { units(&relative.RelativeName) };
                (Some(relative.ContainingDirectory), name)
            }
            _ => (None, self.full()),
        }
    }
}

impl Drop for Name {
    fn drop(&mut self) {
        if let Self::Resolved(full, relative) = self {
            // SAFETY: both are as ntdll filled them.
            unsafe {
                ntdll::RtlReleaseRelativeName(relative);
                ntdll::RtlFreeUnicodeString(full);
            }
        }
    }
}

/// SAFETY: it has the layout that `CLASS` names, and takes any bytes.
pub(super) unsafe trait Info<Class>: Zeroable {
    const CLASS: Class;
}

macro_rules! info {
    ($Class:ident: $($Info:ident = $class:ident,)*) => {$(
        // SAFETY: integers, as the headers declare them.
        unsafe impl Info<$Class> for w::$Info {
            const CLASS: $Class = $Class::$class;
        }
    )*};
}
info!(FileClass:
    FILE_ACCESS_INFORMATION = FileAccessInformation,
    FILE_ALL_INFORMATION = FileAllInformation,
    FILE_BASIC_INFORMATION = FileBasicInformation,
    FILE_DISPOSITION_INFORMATION = FileDispositionInformation,
    FILE_DISPOSITION_INFORMATION_EX = FileDispositionInformationEx,
    FILE_END_OF_FILE_INFORMATION = FileEndOfFileInformation,
    FILE_ID_FULL_DIR_INFORMATION = FileIdFullDirectoryInformation,
    FILE_MODE_INFORMATION = FileModeInformation,
    FILE_PIPE_INFORMATION = FilePipeInformation,
    FILE_POSITION_INFORMATION = FilePositionInformation,
    FILE_STANDARD_INFORMATION = FileStandardInformation,
    FILE_STAT_BASIC_INFORMATION = FileStatBasicInformation,
);
info!(VolumeClass:
    FILE_FS_DEVICE_INFORMATION = FileFsDeviceInformation,
    FILE_FS_SIZE_INFORMATION = FileFsSizeInformation,
    FILE_FS_VOLUME_INFORMATION = FileFsVolumeInformation,
);

fn check(status: NTSTATUS) -> Result<(), NTSTATUS> {
    NT_SUCCESS(status).then_some(()).ok_or(status)
}

fn fill<T: Zeroable>(call: impl FnOnce(*mut c_void, u32) -> NTSTATUS) -> Result<T, NTSTATUS> {
    let mut info: T = zeroed();
    match call((&raw mut info).cast(), size_of::<T>() as u32) {
        // The name behind the fields was cut.
        NTSTATUS::BUFFER_OVERFLOW => Ok(info),
        status => check(status).map(|()| info),
    }
}

pub(super) fn query<T: Info<FileClass>>(file: HANDLE) -> Result<T, NTSTATUS> {
    let mut io: IO_STATUS_BLOCK = zeroed();
    // SAFETY: `info` is writable for `len` bytes, and the call waits for the request.
    fill(|info, len| unsafe {
        ntdll::NtQueryInformationFile(file, &raw mut io, info, len, T::CLASS)
    })
}

pub(super) fn query_volume<T: Info<VolumeClass>>(file: HANDLE) -> Result<T, NTSTATUS> {
    let mut io: IO_STATUS_BLOCK = zeroed();
    // SAFETY: as in `query`.
    fill(|info, len| unsafe {
        ntdll::NtQueryVolumeInformationFile(file, &raw mut io, info, len, T::CLASS)
    })
}

/// The first entry of `directory` that matches `pattern`.
pub(super) fn query_entry<T: Info<FileClass>>(
    directory: HANDLE,
    pattern: &[u16],
) -> Result<T, NTSTATUS> {
    let mut pattern = counted(pattern)?;
    let null = ptr::null_mut();
    fill(|info, len| {
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
            status => status,
        }
    })
}

type NtQueryInformationByName = unsafe extern "system" fn(
    *mut w::OBJECT_ATTRIBUTES,
    *mut IO_STATUS_BLOCK,
    *mut c_void,
    u32,
    FileClass,
) -> NTSTATUS;

static QUERY_BY_NAME: LazyLock<Option<NtQueryInformationByName>> = LazyLock::new(|| {
    // SAFETY: both modules stay loaded. The first is not called, and the second has this type.
    unsafe {
        // It came with `FileStatBasicInformation`.
        find_export::<*mut c_void>(wstr!("kernelbase.dll"), c"GetFileInformationByName")?;
        find_export(wstr!("ntdll.dll"), c"NtQueryInformationByName")
    }
});

pub(super) fn has_stat_basic() -> bool {
    QUERY_BY_NAME.is_some()
}

/// Does not follow the last component.
pub(super) fn stat_basic_by_name(name: &Name) -> Result<w::FILE_STAT_BASIC_INFORMATION, NTSTATUS> {
    let query = QUERY_BY_NAME.ok_or(NTSTATUS::NOT_IMPLEMENTED)?;
    let (root, name) = name.parts();
    let mut io: IO_STATUS_BLOCK = zeroed();
    fill(|info, len| {
        with_attributes_to_open(root, name, |attributes| {
            let class = FileClass::FileStatBasicInformation;
            // SAFETY: the pointers are valid for the call.
            unsafe { query(attributes, &raw mut io, info, len, class) }
        })
    })
}

pub(super) fn set<T: Info<FileClass>>(file: HANDLE, mut info: T) -> Result<(), NTSTATUS> {
    let mut io: IO_STATUS_BLOCK = zeroed();
    let (info, len) = ((&raw mut info).cast(), size_of::<T>() as u32);
    // SAFETY: `info` is readable for `len` bytes, and the call waits for the request.
    check(unsafe { ntdll::NtSetInformationFile(file, &raw mut io, info, len, T::CLASS) })
}

/// With how much of `output` it has filled.
fn fs_control(file: HANDLE, code: u32, input: &[u8], output: &mut [u8]) -> (NTSTATUS, usize) {
    let null = ptr::null_mut();
    let or_null = |buf: *mut u8, len: usize| if len == 0 { null } else { buf.cast() };
    sync_io::complete(file, |io| {
        // SAFETY: the buffers are valid for their lengths until `complete` returns, and hold no pointers for the codes below.
        unsafe {
            ntdll::NtFsControlFile(
                file,
                null,
                null,
                null,
                io,
                code,
                or_null(input.as_ptr().cast_mut(), input.len()),
                input.len() as u32,
                or_null(output.as_mut_ptr(), output.len()),
                output.len() as u32,
            )
        }
    })
}

pub(super) fn get_reparse_point(file: HANDLE, buf: &mut [u8]) -> Result<&[u8], NTSTATUS> {
    let (status, len) = fs_control(file, w::FSCTL_GET_REPARSE_POINT, &[], buf);
    check(status)?;
    buf.get(..len).ok_or(NTSTATUS::BUFFER_OVERFLOW)
}

pub(super) fn set_reparse_point(file: HANDLE, data: &[u8]) -> Result<(), NTSTATUS> {
    check(fs_control(file, w::FSCTL_SET_REPARSE_POINT, data, &mut []).0)
}

/// The head of `FILE_PIPE_PEEK_BUFFER`.
pub(super) fn peek_pipe(pipe: HANDLE) -> Result<[u32; 4], NTSTATUS> {
    const FSCTL_PIPE_PEEK: u32 = 0x0011_400C;
    let mut head = [[0; 4]; 4];
    match fs_control(pipe, FSCTL_PIPE_PEEK, &[], head.as_flattened_mut()).0 {
        // There is data behind it.
        NTSTATUS::BUFFER_OVERFLOW => {}
        status => check(status)?,
    }
    Ok(head.map(u32::from_ne_bytes))
}
