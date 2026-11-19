//! This program is a shim for node_modules/.bin scripts.
//!
//! This is needed because:
//! - Symlinks are not guaranteed to work on Windows
//! - Windows does not process Shebangs
//!
//! This also solves the 'Terminate batch job (Y/N)' problem you see when using NPM/Yarn,
//! which is a HUGE dx win for developers.
//!
//! The approach implemented is a `.bunx` file which sits right next to the renamed
//! launcher exe. We read that (see `BinLinkingShim.rs` for the creation of this file)
//! and then we call NtCreateProcess to spawn the correct child process.
//!
//! Every attempt possible to make this file as minimal as possible has been made.
//! Which has unfortunatly made is difficult to read. To make up for this, every
//! part of this program is documented as much as possible, including links to
//! APIs and related resources.
//!
//! Notes about NTDLL and Windows Internals:
//! - https://www.geoffchappell.com/studies/windows/win32/ntdll/index.htm
//! - http://undocumented.ntinternals.net/index.html
//! - https://github.com/ziglang/zig/issues/1840#issuecomment-558486115
//!
//! An earlier approach to this problem involved using extended attributes, but I found
//! this to be extremely hard to get a working implementation. It takes more system calls
//! anyways, and in the end would be very fragile and only work on NTFS.
//!     (if you're curious about extended attributes, here are some notes)
//!         - https://github.com/tuxera/ntfs-3g/wiki/Using-Extended-Attributes
//!         - https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-zwseteafile
//!         - https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-zwqueryeafile
//!         - https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_get_ea_information
//!         - https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_get_ea_information
//!
//! Prior Art:
//! - https://github.com/ScoopInstaller/Shim/blob/master/src/shim.cs
//!
//! This file is compiled twice: into bun.exe (for the bunx fast paths below) and as
//! the standalone `bun-shim-impl.exe` PE (see `main.rs` / the `shim_standalone`
//! feature), which is then `include_bytes!`-embedded into Bun by `BinLinkingShim.rs`.
//! When the encoding changes, `BinLinkingShim::VersionFlag::CURRENT` should be bumped.
//!
//! Theorized and written by @paperclover during one of the most entranced all-nighters of her life.

#![cfg(windows)]

use core::ffi::c_void;
use core::fmt::Write as _;
use core::io::{BorrowedBuf, BorrowedCursor};
use core::mem::{MaybeUninit, size_of};

// Standalone PE: depend ONLY on `bun_windows_sys` (leaf, no native C, no
// `#[no_mangle]` exports) so the link has no libuv/simdutf/ICU roots and the
// binary stays tiny. `crate::compat`
// re-exports `bun_windows_sys::*` and locally declares the few items
// (`CreateProcessW`, `STARTUPINFOW`, `TEB`/`teb()`, …) that otherwise live in
// `bun_sys::windows`. The local `bun_core`/`bun_str` shadows bring
// `ffi::{slice,zeroed}` / `w!` into scope under the
// same paths the in-process build resolves through the extern prelude.
#[cfg(feature = "shim_standalone")]
use crate::bun_core;
#[cfg(feature = "shim_standalone")]
use crate::compat as w;
#[cfg(not(feature = "shim_standalone"))]
use bun_sys::windows as w;
use w::{BOOL, DWORD, HANDLE, IO_STATUS_BLOCK, LARGE_INTEGER, NTSTATUS, PVOID, ULONG};

mod command_line;
use command_line::{CommandLine, InvalidShim, Metadata};

const DBG: bool = cfg!(debug_assertions);

/// True when this module IS the binary root (the standalone
/// `bun-shim-impl.exe`), false when compiled into bun.exe.
const IS_STANDALONE: bool = cfg!(feature = "shim_standalone");

#[cfg(not(feature = "shim_standalone"))]
bun_output::declare_scope!(bun_shim_impl, hidden);

/// A copy of all ntdll declarations this program uses
mod nt {
    use super::*;

    pub(super) type Status = NTSTATUS;

    /// https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile
    #[cfg(feature = "shim_standalone")]
    pub(super) use w::ntdll::NtCreateFile;

    // SAFETY: ntdll syscalls; signatures match WDK headers. Declared locally as
    // `safe fn` (vs. re-exporting the `unsafe fn` from `w::ntdll`) because
    // neither has memory-safety preconditions: all arguments are by-value,
    // `HANDLE` is an opaque kernel token validated kernel-side (bad handle →
    // `STATUS_INVALID_HANDLE`, not UB), and `RtlExitUserProcess` diverges
    // (matches `ExitProcess`, already `safe fn` in `bun_windows_sys`). This
    // freestanding `no_std` shim owns every handle it closes; no
    // `OwnedHandle`-style I/O-safety invariant exists to violate.
    #[link(name = "ntdll")]
    unsafe extern "system" {
        /// undocumented
        pub(super) safe fn RtlExitUserProcess(ExitStatus: u32) -> !;

        /// https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntclose
        pub(super) safe fn NtClose(Handle: HANDLE) -> Status;
    }

    // Declared locally (not in `bun_sys::windows::ntdll`) so the standalone PE
    // build, whose `w` alias is `crate::compat`, needs no extra re-export.
    // SAFETY: ntdll syscalls; signatures match WDK headers. Kept `unsafe fn`
    // (not `safe fn`) because both write through caller-supplied out-pointers
    // (`IoStatusBlock`, `Buffer`) — validity is a genuine caller precondition.
    unsafe extern "system" {
        /// https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntreadfile
        #[link_name = "NtReadFile"]
        pub(super) fn NtReadFile(
            FileHandle: HANDLE, // [in]
            // `Option<*mut c_void>` is not pointer-sized (raw pointers can
            // already be null → no niche → 16-byte tagged enum, passed
            // by-reference under Win64 ABI). Use a plain HANDLE and pass
            // null_mut() for "no event".
            Event: HANDLE,                       // [in, optional]
            ApcRoutine: *mut c_void,             // [in, optional]
            ApcContext: PVOID,                   // [in, optional]
            IoStatusBlock: *mut IO_STATUS_BLOCK, // [out]
            Buffer: PVOID,                       // [out]
            Length: ULONG,                       // [in]
            ByteOffset: *const LARGE_INTEGER,    // [in, optional]
            Key: *const ULONG,                   // [in, optional]
        ) -> Status;

        /// https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntwritefile
        #[link_name = "NtWriteFile"]
        pub(super) fn NtWriteFile(
            FileHandle: HANDLE,                  // [in]
            Event: HANDLE, // [in, optional] (see NtReadFile note re: Option<HANDLE>)
            ApcRoutine: *mut c_void, // [in, optional]
            ApcContext: PVOID, // [in, optional]
            IoStatusBlock: *mut IO_STATUS_BLOCK, // [out]
            Buffer: *const u8, // [in]
            Length: ULONG, // [in]
            ByteOffset: *const LARGE_INTEGER, // [in, optional]
            Key: *const ULONG, // [in, optional]
        ) -> Status;
    }
}

/// A copy of all kernel32 declarations this program uses
mod k32 {
    use super::*;

    pub(super) use w::kernel32::CreateProcessW;
    /// https://learn.microsoft.com/en-us/windows/win32/api/errhandlingapi/nf-errhandlingapi-getlasterror
    pub(super) use w::kernel32::GetLastError;
    /// https://learn.microsoft.com/en-us/windows/console/setconsolectrlhandler
    pub(super) use w::kernel32::SetConsoleCtrlHandler;

    // SAFETY: kernel32 externs; signatures match SDK. Declared locally as
    // `safe fn` (vs. re-exporting `unsafe fn` from `w::kernel32`) because
    // none has a memory-safety precondition the type system can't encode:
    // `HANDLE` is opaque and validated kernel-side (bad handle → `WAIT_FAILED`
    // / `FALSE` + `GetLastError`, not UB); by-value scalars are trivially
    // sound; the two `LPDWORD` out-params are taken as `&mut DWORD` (ABI-
    // identical to `*mut DWORD`, but Rust guarantees non-null/aligned/valid-
    // for-write so the kernel write cannot fault).
    #[link(name = "kernel32")]
    unsafe extern "system" {
        /// https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject
        pub(super) safe fn WaitForSingleObject(hHandle: HANDLE, dwMilliseconds: DWORD) -> DWORD;

        /// https://learn.microsoft.com/en-us/windows/console/setconsolemode
        pub(super) safe fn SetConsoleMode(hConsoleHandle: HANDLE, dwMode: DWORD) -> BOOL;

        /// https://learn.microsoft.com/en-us/windows/console/getconsolemode
        pub(super) safe fn GetConsoleMode(hConsoleHandle: HANDLE, lpMode: &mut DWORD) -> BOOL;

        /// https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getexitcodeprocess
        pub(super) safe fn GetExitCodeProcess(hProcess: HANDLE, lpExitCode: &mut DWORD) -> BOOL;
    }
}

macro_rules! debug {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {{
        // Debug-only logging: gate the body here rather than at every call
        // site — release builds see an empty block (no `cfg!` const-assert,
        // which fails E0080 in const-eval when `debug_assertions` is off).
        #[cfg(debug_assertions)]
        {
            #[cfg(not(feature = "shim_standalone"))]
            { bun_output::scoped_log!(bun_shim_impl, $fmt $(, $arg)*); }
            #[cfg(feature = "shim_standalone")]
            {
                // The standalone build has no logger; deliberately a no-op to
                // keep the binary tiny.
                let _ = ($($arg,)*);
            }
        }
        #[cfg(not(debug_assertions))]
        { let _ = ($(&$arg,)*); }
    }};
}

const FILE_GENERIC_READ: u32 = w::STANDARD_RIGHTS_READ
    | w::FILE_READ_DATA
    | w::FILE_READ_ATTRIBUTES
    | w::FILE_READ_EA
    | w::SYNCHRONIZE;

#[derive(Clone, Copy)]
enum FailReason<'a> {
    NoDirname,
    #[cfg(feature = "shim_standalone")]
    CouldNotOpenShim,
    CouldNotReadShim,
    #[cfg(feature = "shim_standalone")]
    ShimNotFound,
    CreateProcessFailed,
    /// Outside of standalone mode, the fallback is to run the '.exe' file.
    #[cfg(feature = "shim_standalone")]
    InvalidShimValidation,
    InvalidShimBounds,
    #[cfg(not(feature = "shim_standalone"))]
    CouldNotDirectLaunch,
    BinNotFound,
    InterpreterNotFound(&'a [u16]),
    InterpreterNotFoundBun,
    ElevationRequired,
    BatchFileArgument,
}

impl FailReason<'_> {
    const fn get_format_template(self) -> &'static str {
        match self {
            FailReason::NoDirname => "could not find node_modules path",

            #[cfg(feature = "shim_standalone")]
            FailReason::ShimNotFound => "could not find bin metadata file",
            #[cfg(feature = "shim_standalone")]
            FailReason::CouldNotOpenShim => "could not open bin metadata file",
            FailReason::CouldNotReadShim => "could not read bin metadata",
            #[cfg(feature = "shim_standalone")]
            FailReason::InvalidShimValidation => "bin metadata is corrupt (validate)",
            FailReason::InvalidShimBounds => "bin metadata is corrupt (bounds)",
            // The difference between these two is that one is with a shebang (#!/usr/bin/env node) and
            // the other is without. This is a helpful distinction because it can detect if something
            // like node or bun is not in %path%, vs the actual executable was not installed in node_modules.
            FailReason::InterpreterNotFound(_) => {
                "interpreter executable \"{s}\" not found in %PATH%"
            }
            FailReason::InterpreterNotFoundBun => "bun is not installed in %PATH%",
            FailReason::BinNotFound => "bin executable does not exist on disk",
            FailReason::ElevationRequired => "process requires elevation",
            FailReason::CreateProcessFailed => "could not create process",
            FailReason::BatchFileArgument => {
                "cannot pass an argument containing % & | < > ^ to a .cmd or .bat file"
            }

            #[cfg(not(feature = "shim_standalone"))]
            FailReason::CouldNotDirectLaunch => "bin metadata is corrupt (invalid utf16)",
        }
    }

    #[inline]
    fn write(self, writer: &mut impl core::fmt::Write) -> core::fmt::Result {
        write!(writer, "{self}")
    }
}

const MAX_INTERPRETER_LEN: usize = 512;

impl core::fmt::Display for FailReason<'_> {
    fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        writer.write_str("error: ")?;
        // The template lookup is a const fn so the cost is a single match.
        let template = self.get_format_template();

        // Explicit match on the one variant whose template contains `{s}`.
        if let FailReason::InterpreterNotFound(interpreter) = self {
            writer.write_str("interpreter executable \"")?;
            // Intentionally lossy for anything but ASCII, to reduce the binary size of the shim.
            for &unit in interpreter.iter().take(MAX_INTERPRETER_LEN) {
                writer.write_char(char::from((unit & 0x7F) as u8))?;
            }
            writer.write_str("\" not found in %PATH%\n\n")?;
        } else {
            writer.write_str(template)?;
            writer.write_str("\n\n")?;
        }

        let rest = match self {
            FailReason::InterpreterNotFoundBun => concat!(
                "Please run the following command, or double check %PATH% is right.\n",
                "\n",
                "    powershell -c \"irm bun.sh/install.ps1|iex\"\n",
                "\n",
            ),
            FailReason::BatchFileArgument => {
                "cmd.exe runs the file and would read the character as a command or a variable.\n\n"
            }
            _ => concat!(
                "Bun failed to remap this bin to its proper location within node_modules.\n",
                "This is an indication of a corrupted node_modules directory.\n",
                "\n",
                "Please run 'bun install --force' in the project root and try\n",
                "it again. If this message persists, please open an issue:\n",
                "https://github.com/oven-sh/bun/issues\n",
                "\n",
            ),
        };
        writer.write_str(rest)
    }
}

pub(crate) fn write_to_handle(handle: HANDLE, data: &[u8]) -> usize {
    let mut io: IO_STATUS_BLOCK = bun_core::ffi::zeroed();
    // SAFETY: NtWriteFile is given a valid handle and a buffer that lives for the call.
    let rc = unsafe {
        nt::NtWriteFile(
            handle,
            core::ptr::null_mut(),
            core::ptr::null_mut(),
            core::ptr::null_mut(),
            &mut io,
            data.as_ptr(),
            u32::try_from(data.len()).expect("int cast"),
            core::ptr::null(),
            core::ptr::null(),
        )
    };
    if rc != NTSTATUS::SUCCESS {
        if rc == NTSTATUS::END_OF_FILE {
            return data.len();
        }

        // For this binary it we dont really care about errors here
        // as this is just used for printing code, which will pretty much always pass.
        // return error.WriteError;
        return data.len();
    }

    io.Information
}

/// `core::fmt::Write` adapter over a raw NT handle.
struct NtWriter {
    context: HANDLE,
}

impl core::fmt::Write for NtWriter {
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        let _ = write_to_handle(self.context, s.as_bytes());
        Ok(())
    }
}

#[cold]
#[inline(never)]
fn fail_and_exit_with_reason(reason: FailReason<'_>) -> ! {
    // SAFETY: TEB/PEB pointers are valid for the lifetime of the process.
    let console_handle =
        unsafe { (*(*(*w::teb()).ProcessEnvironmentBlock).ProcessParameters).hStdError };
    let mut mode: DWORD = 0;
    if k32::GetConsoleMode(console_handle, &mut mode) != 0 {
        mode |= w::ENABLE_VIRTUAL_TERMINAL_PROCESSING;
        let _ = k32::SetConsoleMode(console_handle, mode);
    }

    let mut writer = NtWriter {
        context: console_handle,
    };
    if let Err(e) = reason.write(&mut writer) {
        if cfg!(debug_assertions) {
            panic!("Failed to write to stderr: {e:?}");
        }
    }

    nt::RtlExitUserProcess(255)
}

/// The child shares our console and gets Ctrl+C itself; outlive it to report its
/// exit code. Every path after this exits the process, so it is never removed.
fn ignore_ctrl_c() {
    extern "system" fn handler(ctrl_type: DWORD) -> BOOL {
        if ctrl_type == w::CTRL_C_EVENT {
            return w::TRUE;
        }
        w::FALSE
    }
    let _ = k32::SetConsoleCtrlHandler(Some(handler), w::TRUE);
}

const NT_OBJECT_PREFIX: [u16; 4] = ['\\' as u16, '?' as u16, '?' as u16, '\\' as u16];

// This is used for CreateProcessW's lpCommandLine
// "The maximum length of this string is 32,767 characters, including the Unicode terminating null character."
const COMMAND_LINE_BUF_LEN: usize = 32767 + 1;

// The longest path, the quote, the zero and the flags.
const METADATA_BUF_LEN: usize = w::PATH_MAX_WIDE + 3;

#[cfg(feature = "shim_standalone")]
struct ProcessParameters {
    image_path_name: &'static [u16],
    command_line: &'static [u16],
    std_handles: [HANDLE; 3],
}

#[cfg(feature = "shim_standalone")]
impl ProcessParameters {
    fn get() -> Self {
        // SAFETY: TEB/PEB are valid for the process lifetime. So are both strings, which nothing writes to.
        unsafe {
            let parameters = (*(*w::teb()).ProcessEnvironmentBlock).ProcessParameters;
            let units = |string: w::UNICODE_STRING| {
                bun_core::ffi::slice(string.Buffer, usize::from(string.Length / 2))
            };
            Self {
                image_path_name: units((*parameters).ImagePathName),
                command_line: units((*parameters).CommandLine),
                std_handles: [
                    (*parameters).hStdInput,
                    (*parameters).hStdOutput,
                    (*parameters).hStdError,
                ],
            }
        }
    }
}

/// A `.bunx` file that is open for synchronous I/O.
pub struct MetadataFile(HANDLE);

impl Drop for MetadataFile {
    fn drop(&mut self) {
        let _ = nt::NtClose(self.0);
    }
}

impl MetadataFile {
    #[cfg(not(feature = "shim_standalone"))]
    pub fn open(absolute_path: &[u16]) -> bun_sys::Maybe<Self> {
        let options = bun_sys::NtCreateFileOptions {
            access_mask: FILE_GENERIC_READ,
            disposition: w::FILE_OPEN,
            options: w::FILE_NON_DIRECTORY_FILE | w::FILE_SYNCHRONOUS_IO_NONALERT,
            ..Default::default()
        };
        let fd = bun_sys::open_file_at_windows(bun_sys::Fd::INVALID, absolute_path, options)?;
        Ok(Self(fd.native()))
    }

    #[cfg(feature = "shim_standalone")]
    fn open_next_to(
        image_path_name: &[u16],
        buf: &mut [MaybeUninit<u16>],
    ) -> Result<Self, FailReason<'static>> {
        debug_assert!(image_path_name.ends_with(bun_core::w!(".exe")));
        let (without_exe, _) = image_path_name
            .split_last_chunk::<{ "exe".len() }>()
            .ok_or(FailReason::CouldNotOpenShim)?;

        // NtCreateFile will fail for absolute paths if we do not pass an OBJECT name
        let path = command_line::try_concat_into(
            buf,
            &[&NT_OBJECT_PREFIX, without_exe, bun_core::w!("bunx")],
        )
        .ok_or(FailReason::CouldNotOpenShim)?;
        let path_len_bytes =
            u16::try_from(size_of_val(path)).map_err(|_| FailReason::CouldNotOpenShim)?;
        let mut nt_name = w::UNICODE_STRING {
            Length: path_len_bytes,
            MaximumLength: path_len_bytes,
            Buffer: path.as_mut_ptr(),
        };
        let mut attr = w::OBJECT_ATTRIBUTES {
            Length: size_of::<w::OBJECT_ATTRIBUTES>() as u32,
            RootDirectory: core::ptr::null_mut(),
            Attributes: 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
            ObjectName: &raw mut nt_name,
            SecurityDescriptor: core::ptr::null_mut(),
            SecurityQualityOfService: core::ptr::null_mut(),
        };
        let mut metadata_handle: HANDLE = core::ptr::null_mut();
        let mut io: IO_STATUS_BLOCK = bun_core::ffi::zeroed();
        // SAFETY: all out-pointers are valid stack locations; attr is fully initialized.
        let rc = unsafe {
            nt::NtCreateFile(
                &raw mut metadata_handle,
                FILE_GENERIC_READ,
                &raw mut attr,
                &raw mut io,
                core::ptr::null_mut(),
                w::FILE_ATTRIBUTE_NORMAL,
                w::FILE_SHARE_WRITE | w::FILE_SHARE_READ | w::FILE_SHARE_DELETE,
                w::FILE_OPEN,
                w::FILE_NON_DIRECTORY_FILE | w::FILE_SYNCHRONOUS_IO_NONALERT,
                core::ptr::null_mut(),
                0,
            )
        };
        match rc {
            NTSTATUS::SUCCESS => Ok(Self(metadata_handle)),
            NTSTATUS::OBJECT_NAME_NOT_FOUND => Err(FailReason::ShimNotFound),
            _ => Err(FailReason::CouldNotOpenShim),
        }
    }

    /// Leaves `cursor` as it is if the file does not hold a whole number of `u16`s.
    fn read(&self, mut cursor: BorrowedCursor<'_, u16>) -> Result<(), NTSTATUS> {
        let mut io: IO_STATUS_BLOCK = bun_core::ffi::zeroed();
        let read_max_len = u32::try_from(cursor.capacity() * 2).unwrap_or(u32::MAX);
        // We are intentionally only reading one chunk. The metadata file is almost always going to be < 200 bytes
        // If this becomes a problem we will fix it.
        // SAFETY: `cursor` has room for `read_max_len` bytes, and the handle is for synchronous I/O.
        let read_status = unsafe {
            nt::NtReadFile(
                self.0,
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                &raw mut io,
                cursor.as_mut().as_mut_ptr().cast::<c_void>(),
                read_max_len,
                core::ptr::null(),
                core::ptr::null(),
            )
        };
        match read_status {
            NTSTATUS::SUCCESS if io.Information.is_multiple_of(2) => {
                // SAFETY: NtReadFile wrote `io.Information` bytes.
                unsafe { cursor.advance(io.Information / 2) };
                Ok(())
            }
            // "IO_STATUS_BLOCK is filled only if !NT_ERROR(status)"
            // https://stackoverflow.com/questions/62438021/can-ntreadfile-produce-a-short-read-without-reaching-eof
            NTSTATUS::SUCCESS | NTSTATUS::END_OF_FILE => Ok(()),
            rc => Err(rc),
        }
    }
}

/// Returns in bun.exe, which falls back to the slow path. See `try_startup_from_bun_js`.
fn fail_validation_if_standalone() {
    #[cfg(feature = "shim_standalone")]
    fail_and_exit_with_reason(FailReason::InvalidShimValidation);
}

#[allow(clippy::too_many_lines)]
fn launcher(#[cfg(not(feature = "shim_standalone"))] bun_ctx: FromBunRunContext<'_>) {
    let mut metadata_buf = [const { MaybeUninit::<u16>::uninit() }; METADATA_BUF_LEN];
    let mut command_line_buf = [const { MaybeUninit::<u16>::uninit() }; COMMAND_LINE_BUF_LEN];

    #[cfg(feature = "shim_standalone")]
    let process_parameters = ProcessParameters::get();
    #[cfg(feature = "shim_standalone")]
    let (shim_path, metadata_file, user_arguments) = (
        process_parameters.image_path_name,
        MetadataFile::open_next_to(process_parameters.image_path_name, &mut metadata_buf)
            .unwrap_or_else(|reason| fail_and_exit_with_reason(reason)),
        command_line::user_arguments(process_parameters.command_line),
    );
    #[cfg(not(feature = "shim_standalone"))]
    let (shim_path, metadata_file, user_arguments) =
        (bun_ctx.base_path, bun_ctx.metadata_file, bun_ctx.arguments);

    if DBG {
        debug!("ShimPath: {}", fmt16(shim_path));
        debug!("UserArgs: '{}'", fmt16(user_arguments));
    }

    debug_assert!(user_arguments.len() != 1);
    debug_assert!(user_arguments.is_empty() || user_arguments[0] == ' ' as u16);

    // The base of an absolute path that the '.bunx' file does not need to store.
    let Some(node_modules_path) = command_line::node_modules_path(shim_path) else {
        fail_and_exit_with_reason(FailReason::NoDirname);
    };

    let mut contents = BorrowedBuf::from(&mut metadata_buf[..]);
    if let Err(rc) = metadata_file.read(contents.unfilled()) {
        if DBG {
            debug!("error reading: {}", rc.0);
        }
        fail_and_exit_with_reason(FailReason::CouldNotReadShim);
    }
    drop(metadata_file);

    if DBG {
        debug!("BufferAfterRead: '{}'", fmt16(contents.filled()));
    }

    let metadata = match Metadata::parse(contents.filled()) {
        Ok(metadata) => metadata,
        Err(InvalidShim::Validation) => return fail_validation_if_standalone(),
        Err(InvalidShim::Bounds) => fail_and_exit_with_reason(FailReason::InvalidShimBounds),
    };
    let flags = metadata.flags;

    if DBG {
        debug!("FlagsInt: {}", flags.bits());
        debug!("Flags:");
        debug!("    is_node_or_bun: {}", flags.is_node_or_bun());
        debug!("    is_node: {}", flags.is_node());
        debug!("    has_shebang: {}", flags.has_shebang());
        debug!("    is_absolute_target: {}", flags.is_absolute_target());
        debug!("    version_tag: {}", flags.version_tag().bits());
    }

    let bin_path_base = if flags.is_absolute_target() {
        &[]
    } else {
        node_modules_path
    };

    #[cfg(not(feature = "shim_standalone"))]
    if flags.has_shebang()
        && flags.is_node_or_bun()
        && bun_ctx.force_use_bun
        && let [bin_path @ .., _quote] = metadata.bin_path_and_quote
    {
        // With `--bun`, a script for node.exe or bun.exe needs no second process (~10-20ms).
        if DBG {
            debug!("direct_launch_with_bun_js");
        }
        let Some(path) =
            command_line::try_concat_into(&mut command_line_buf, &[bin_path_base, bin_path])
        else {
            fail_and_exit_with_reason(FailReason::InvalidShimBounds);
        };
        (bun_ctx.direct_launch_with_bun_js)(path, bun_ctx.cli_context);
        fail_and_exit_with_reason(FailReason::CouldNotDirectLaunch);
    }

    let Some(mut spawn_command_line) = CommandLine::new(
        &mut command_line_buf,
        &metadata,
        bin_path_base,
        user_arguments,
    ) else {
        fail_and_exit_with_reason(FailReason::InvalidShimBounds);
    };

    if flags.has_shebang() {
        // The filename must end with a quote character as per the bunx file format.
        if metadata.bin_path_and_quote.last() != Some(&command_line::QUOTE) {
            return fail_validation_if_standalone();
        }

        // `cmd /c` parses the command line again, so quoting doesn't protect any argument.
        if is_batch_file(metadata.bin_path_and_quote)
            && user_arguments
                .iter()
                .any(|&unit| is_cmd_special_character(unit))
        {
            fail_and_exit_with_reason(FailReason::BatchFileArgument);
        }
    }

    #[cfg(not(feature = "shim_standalone"))]
    {
        // Prepare stdio for the child process, as after this we are going to *immediatly* exit
        // it is likely that the c-runtime's atexit will not be called as we end the process ourselves.
        bun_core::output::source::stdio::restore();
        // Declared locally as `safe fn` (the `bun_sys::windows` re-export
        // forwards `bun_windows_sys::externs::windows_enable_stdio_inheritance`,
        // which is not yet `safe`-qualified): zero args, zero memory-safety
        // preconditions — the C++ shim only flips `HANDLE_FLAG_INHERIT` on the
        // three process-lifetime standard handles. Matches the local `safe fn`
        // redecl already used in `bun_sys::windows::become_watcher_manager`.
        unsafe extern "C" {
            safe fn windows_enable_stdio_inheritance();
        }
        windows_enable_stdio_inheritance();
    }

    #[cfg(feature = "shim_standalone")]
    let ([stdin, stdout, stderr], environment) =
        (process_parameters.std_handles, core::ptr::null_mut());
    // The standard handles outside of standalone may be tampered with.
    #[cfg(not(feature = "shim_standalone"))]
    let ([stdin, stdout, stderr], environment) = {
        use bun_sys::Fd;
        assert!(bun_ctx.environment.ends_with(&[0, 0]));
        (
            [Fd::stdin(), Fd::stdout(), Fd::stderr()].map(Fd::native),
            bun_ctx.environment.as_ptr().cast_mut().cast::<c_void>(),
        )
    };

    // I attempted to use lower level methods for this, but it really seems
    // too difficult and not worth the stability risks.
    //
    // The initial (crazy) idea was something like cloning 'ProcessParameters' and then just changing
    // the CommandLine and ImagePathName to point to the new data. would that even work??? probably not
    // I never tested it.
    //
    // Resources related to the potential lower level stuff:
    // - https://stackoverflow.com/questions/69599435/running-programs-using-rtlcreateuserprocess-only-works-occasionally
    // - https://systemroot.gitee.io/pages/apiexplorer/d0/d2/rtlexec_8c.html
    //
    // Documentation for the function I am using:
    // https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw
    let mut process: w::PROCESS_INFORMATION = bun_core::ffi::zeroed();
    let mut startup_info = w::STARTUPINFOW {
        cb: size_of::<w::STARTUPINFOW>() as u32,
        lpReserved: core::ptr::null_mut(),
        lpDesktop: core::ptr::null_mut(),
        lpTitle: core::ptr::null_mut(),
        dwX: 0,
        dwY: 0,
        dwXSize: 0,
        dwYSize: 0,
        dwXCountChars: 0,
        dwYCountChars: 0,
        dwFillAttribute: 0,
        dwFlags: w::STARTF_USESTDHANDLES,
        wShowWindow: 0,
        cbReserved2: 0,
        lpReserved2: core::ptr::null_mut(),
        hStdInput: stdin,
        hStdOutput: stdout,
        hStdError: stderr,
    };

    ignore_ctrl_c();

    // PERF: the body is large enough that unrolling this two-iteration loop is
    // unlikely to matter — profile if it shows up on a hot path.
    for attempt_number in [0u32, 1] {
        'iteration: {
            if DBG {
                debug!("lpCommandLine: {}\n", fmt16(spawn_command_line.as_slice()));
            }
            // SAFETY: a `CommandLine` ends with a NUL, and `environment` is null or ends with two.
            let did_process_spawn = unsafe {
                k32::CreateProcessW(
                    core::ptr::null(),
                    spawn_command_line.as_mut_ptr(),
                    core::ptr::null_mut(),
                    core::ptr::null_mut(),
                    1, // true
                    // `CREATE_UNICODE_ENVIRONMENT` only when running inside
                    // bun.exe (lpEnvironment is then a UTF-16 block); the
                    // standalone PE passes a null environment so flags are 0.
                    if IS_STANDALONE {
                        0
                    } else {
                        0x0000_0400 /* CREATE_UNICODE_ENVIRONMENT */
                    },
                    environment,
                    core::ptr::null(),
                    &mut startup_info,
                    &mut process,
                )
            };
            if did_process_spawn == 0 {
                let spawn_err = k32::GetLastError();
                if DBG {
                    debug!("CreateProcessW failed: {}", spawn_err);
                    debug!("attempt number: {}", attempt_number);
                }
                match w::Win32Error(spawn_err as u16) {
                    w::Win32Error::FILE_NOT_FOUND => {
                        if flags.has_shebang() {
                            if attempt_number == 0 {
                                if flags.is_node() {
                                    if DBG {
                                        debug!("node is not found, changing to bun");
                                    }

                                    if !IS_STANDALONE {
                                        // TODO: this is another place that direct_launch_with_bun_js should be used
                                    }

                                    // There are many packages that specifically call for node.exe, and Bun will respect that
                                    // but if node installed, this means the binary is unlaunchable. So before we fail,
                                    // we will try to launch it with bun.exe
                                    //
                                    // This is not an issue when using 'bunx' or 'bun run', because node.exe is already
                                    // added to the path synthetically through 'createFakeTemporaryNodeExecutable'. The path
                                    // here applies for when the binary is launched directly (user shell, double click, etc...)
                                    debug_assert!(
                                        spawn_command_line
                                            .as_slice()
                                            .starts_with(bun_core::w!("node "))
                                    );

                                    if spawn_command_line.replace_node_with_bun() {
                                        break 'iteration; // loop back
                                    }
                                }

                                if flags.is_node_or_bun() {
                                    // This script calls for 'bun', but it was not found.
                                    debug_assert!(
                                        spawn_command_line
                                            .as_slice()
                                            .starts_with(bun_core::w!("bun "))
                                    );
                                    fail_and_exit_with_reason(FailReason::InterpreterNotFoundBun);
                                }
                            }

                            // if attempt_number == 1, we already tried rewriting this to bun, and will now fail for real
                            if attempt_number == 1 {
                                debug_assert!(
                                    spawn_command_line
                                        .as_slice()
                                        .starts_with(bun_core::w!("bun "))
                                );
                                fail_and_exit_with_reason(FailReason::InterpreterNotFoundBun);
                            }

                            fail_and_exit_with_reason(FailReason::InterpreterNotFound(
                                spawn_command_line.program(),
                            ));
                        } else {
                            fail_and_exit_with_reason(FailReason::BinNotFound);
                        }
                    }

                    // TODO: ERROR_ELEVATION_REQUIRED must take a fallback path, this path is potentially slower:
                    // This likely will not be an issue anyone runs into for a while, because it implies
                    // the shebang depends on something that requires UAC, which .... why?
                    //
                    // https://learn.microsoft.com/en-us/windows/security/application-security/application-control/user-account-control/how-it-works#user
                    // https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutew
                    w::Win32Error::ELEVATION_REQUIRED => {
                        fail_and_exit_with_reason(FailReason::ElevationRequired);
                    }

                    _ => fail_and_exit_with_reason(FailReason::CreateProcessFailed),
                };
            }

            let _ = k32::WaitForSingleObject(process.hProcess, w::INFINITE);

            let mut exit_code: DWORD = 255;
            let _ = k32::GetExitCodeProcess(process.hProcess, &mut exit_code);
            if DBG {
                debug!("exit_code: {}", exit_code);
            }

            // Closing handles returned by CreateProcessW exactly once.
            let _ = nt::NtClose(process.hProcess);
            let _ = nt::NtClose(process.hThread);

            nt::RtlExitUserProcess(exit_code);
            // unreachable - RtlExitUserProcess does not return
        }
    }
    unreachable!("above loop should not exit");
}

#[cfg(not(feature = "shim_standalone"))]
type CommandContext<'a> = bun_options_types::context::Context<'a>;

#[cfg(not(feature = "shim_standalone"))]
pub struct FromBunRunContext<'a> {
    /// Path like 'C:\Users\chloe\project\node_modules\.bin\foo.bunx'
    pub base_path: &'a [u16],
    /// Command line arguments which does NOT include the bin name:
    /// like '--port 3000 --config ./config.json'
    pub arguments: &'a [u16],
    pub metadata_file: MetadataFile,
    /// Was --bun passed?
    pub force_use_bun: bool,
    /// A pointer to a function that can launch `Run.boot`
    pub direct_launch_with_bun_js: fn(&mut [u16], CommandContext<'_>),
    /// Command.Context
    pub cli_context: CommandContext<'a>,
    /// Passed directly to CreateProcessW's lpEnvironment with CREATE_UNICODE_ENVIRONMENT
    pub environment: &'a [u16],
}

/// This is called from run_command.rs in bun.exe which allows us to skip the CreateProcessW
/// call to create bun-shim-impl.exe. Instead we invoke the logic it has from an open file handle.
///
/// This saves ~5-12ms depending on the machine.
///
/// If the launch is successful, this function does not return. If a validation error occurs,
/// this returns void, to which the caller should still try invoking the exe directly. This
/// is to handle version mismatches where bun.exe's decoder is too new than the .bunx file.
#[cfg(not(feature = "shim_standalone"))]
pub fn try_startup_from_bun_js(context: FromBunRunContext<'_>) {
    debug_assert!(!context.base_path.starts_with(&NT_OBJECT_PREFIX));
    debug_assert!(context.base_path.ends_with(bun_core::w!(".bunx")));
    const _: () = assert!(!IS_STANDALONE);
    const _: () = assert!(bun_core::feature_flags::WINDOWS_BUNX_FAST_PATH);
    launcher(context);
}

/// Main function for `bun-shim-impl.exe`
#[cfg(feature = "shim_standalone")]
#[inline]
pub(crate) fn main() -> ! {
    const _: () = assert!(IS_STANDALONE);
    // The standalone crate enforces the single-threaded, CRT-free build shape
    // structurally via `#![no_std]` / `#![no_main]` and its link configuration
    // (see `main.rs` and `scripts/build/rust.ts`).
    launcher();
    unreachable!();
}

// ───── helpers ─────

/// `.cmd"` or `.bat"` at the end, in any spelling, as Windows takes them.
fn is_batch_file(filename_and_quote: &[u16]) -> bool {
    filename_and_quote.last_chunk::<5>().is_some_and(|end| {
        [b".cmd\"", b".bat\""].iter().any(|batch| {
            (end.iter().zip(batch.iter()))
                .all(|(&unit, byte)| u8::try_from(unit).is_ok_and(|c| c.eq_ignore_ascii_case(byte)))
        })
    })
}

/// Same as `batch_arg_has_cmd_metachars` (src/which/lib.rs) but without `"`, because a raw command
/// line uses it for quoting.
fn is_cmd_special_character(unit: u16) -> bool {
    // % & | < > ^ \r \n
    matches!(unit, 0x25 | 0x26 | 0x7C | 0x3C | 0x3E | 0x5E | 0x0D | 0x0A)
}

/// Lossy (replacement-char) UTF-16-LE formatter — only
/// used for debug logging under `if DBG`, so lossiness is fine.
fn fmt16(s: &[u16]) -> impl core::fmt::Display + '_ {
    struct F<'a>(&'a [u16]);
    impl core::fmt::Display for F<'_> {
        fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
            for c in core::char::decode_utf16(self.0.iter().copied()) {
                match c {
                    Ok(c) => f.write_char(c)?,
                    Err(_) => f.write_char('\u{FFFD}')?,
                }
            }
            Ok(())
        }
    }
    F(s)
}
