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
//! launcher exe. We read that (see BinLinkingShim.zig for the creation of this file)
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
//! The compiled binary is 13312 bytes and is `@embedFile`d into Bun itself.
//! When this file is updated, the new binary should be compiled and BinLinkingShim.VersionFlag.current should be updated.
//!
//! Questions about this file should be directed at @paperclover.

#![cfg(windows)]

use core::ffi::c_void;
use core::fmt::Write as _;
use core::marker::ConstParamTy;
use core::mem::{size_of, MaybeUninit};

use bun_sys::windows as w;
use w::{BOOL, DWORD, HANDLE, IO_STATUS_BLOCK, LARGE_INTEGER, NTSTATUS, PVOID, ULONG, UNICODE_STRING};

use super::bin_linking_shim::Flags;

const DBG: bool = cfg!(debug_assertions);

/// In Zig: `@import("root") == @This()` — true when this module IS the binary root
/// (the standalone `bun_shim_impl.exe`), false when compiled into bun.exe.
// TODO(port): this should be a cargo feature (`shim_standalone`) set only when building
// the standalone shim binary; the `bun` crate is unavailable in standalone builds.
const IS_STANDALONE: bool = cfg!(feature = "shim_standalone");

#[cfg(not(feature = "shim_standalone"))]
bun_output::declare_scope!(bun_shim_impl, hidden);

// TODO(port): Zig `callmod_inline` selects `.always_inline` in standalone, `bun.callmod_inline`
// otherwise. Rust has no per-callsite call modifier; rely on `#[inline(always)]` on `w::teb()`.

/// A copy of all ntdll declarations this program uses
mod nt {
    use super::*;

    pub type Status = NTSTATUS;

    /// undocumented
    pub use w::ntdll::RtlExitUserProcess;

    /// https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntclose
    pub use w::ntdll::NtClose;

    /// https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile
    pub use w::ntdll::NtCreateFile;

    // TODO(port): move to <install>_sys (or bun_sys::windows::ntdll)
    unsafe extern "system" {
        /// https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntreadfile
        #[link_name = "NtReadFile"]
        pub fn NtReadFile(
            FileHandle: HANDLE,             // [in]
            Event: Option<HANDLE>,          // [in, optional]
            ApcRoutine: *mut c_void,        // [in, optional]
            ApcContext: PVOID,              // [in, optional]
            IoStatusBlock: *mut IO_STATUS_BLOCK, // [out]
            Buffer: PVOID,                  // [out]
            Length: ULONG,                  // [in]
            ByteOffset: *const LARGE_INTEGER, // [in, optional]
            Key: *const ULONG,              // [in, optional]
        ) -> Status;

        /// https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntwritefile
        #[link_name = "NtWriteFile"]
        pub fn NtWriteFile(
            FileHandle: HANDLE,             // [in]
            Event: Option<HANDLE>,          // [in, optional]
            ApcRoutine: *mut c_void,        // [in, optional]
            ApcContext: PVOID,              // [in, optional]
            IoStatusBlock: *mut IO_STATUS_BLOCK, // [out]
            Buffer: *const u8,              // [in]
            Length: ULONG,                  // [in]
            ByteOffset: *const LARGE_INTEGER, // [in, optional]
            Key: *const ULONG,              // [in, optional]
        ) -> Status;
    }
}

/// A copy of all kernel32 declarations this program uses
mod k32 {
    use super::*;

    pub use w::kernel32::CreateProcessW;
    /// https://learn.microsoft.com/en-us/windows/win32/api/errhandlingapi/nf-errhandlingapi-getlasterror
    pub use w::kernel32::GetLastError;
    /// https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject
    pub use w::kernel32::WaitForSingleObject;
    /// https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getexitcodeprocess
    pub use w::kernel32::GetExitCodeProcess;
    /// https://learn.microsoft.com/en-us/windows/console/getconsolemode
    pub use w::kernel32::GetConsoleMode;
    /// https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-sethandleinformation
    pub use w::kernel32::SetHandleInformation;

    // TODO(port): move to <install>_sys (or bun_sys::windows::kernel32)
    unsafe extern "system" {
        /// https://learn.microsoft.com/en-us/windows/console/setconsolemode
        #[link_name = "SetConsoleMode"]
        pub fn SetConsoleMode(
            hConsoleHandle: HANDLE, // [in]
            dwMode: DWORD,          // [in]
        ) -> BOOL;
    }
}

macro_rules! debug {
    ($fmt:literal $(, $arg:expr)* $(,)?) => {{
        const _: () = assert!(cfg!(debug_assertions));
        #[cfg(not(feature = "shim_standalone"))]
        { bun_output::scoped_log!(bun_shim_impl, $fmt $(, $arg)*); }
        #[cfg(feature = "shim_standalone")]
        {
            // TODO(port): standalone build has no std logger; this was `std.log.debug`.
            // Left as no-op to keep the binary tiny; revisit if standalone debug logging is needed.
            let _ = ($($arg,)*);
        }
    }};
}

fn unicode_string_to_u16(str: UNICODE_STRING) -> &'static mut [u16] {
    // SAFETY: UNICODE_STRING.Buffer is valid for Length bytes per Win32 contract.
    unsafe { core::slice::from_raw_parts_mut(str.Buffer, (str.Length / 2) as usize) }
}

const FILE_GENERIC_READ: u32 =
    w::STANDARD_RIGHTS_READ | w::FILE_READ_DATA | w::FILE_READ_ATTRIBUTES | w::FILE_READ_EA | w::SYNCHRONIZE;

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum FailReason {
    NoDirname,
    CouldNotOpenShim,
    CouldNotReadShim,
    InvalidShimDataSize,
    ShimNotFound,
    CreateProcessFailed,
    /// When encountering this outside of standalone mode, you should fallback
    /// to running the '.exe' file, not printing this error.
    InvalidShimValidation,
    InvalidShimBounds,
    CouldNotDirectLaunch,
    BinNotFound,
    InterpreterNotFound,
    InterpreterNotFoundBun,
    ElevationRequired,
}

impl FailReason {
    pub const fn get_format_template(self) -> &'static str {
        match self {
            FailReason::NoDirname => "could not find node_modules path",

            FailReason::ShimNotFound => "could not find bin metadata file",
            FailReason::CouldNotOpenShim => "could not open bin metadata file",
            FailReason::CouldNotReadShim => "could not read bin metadata",
            FailReason::InvalidShimDataSize => "bin metadata is corrupt (size)",
            FailReason::InvalidShimValidation => "bin metadata is corrupt (validate)",
            FailReason::InvalidShimBounds => "bin metadata is corrupt (bounds)",
            // The difference between these two is that one is with a shebang (#!/usr/bin/env node) and
            // the other is without. This is a helpful distinction because it can detect if something
            // like node or bun is not in %path%, vs the actual executable was not installed in node_modules.
            FailReason::InterpreterNotFound => "interpreter executable \"{s}\" not found in %PATH%",
            FailReason::InterpreterNotFoundBun => "bun is not installed in %PATH%",
            FailReason::BinNotFound => "bin executable does not exist on disk",
            FailReason::ElevationRequired => "process requires elevation",
            FailReason::CreateProcessFailed => "could not create process",

            FailReason::CouldNotDirectLaunch => {
                if !IS_STANDALONE {
                    "bin metadata is corrupt (invalid utf16)"
                } else {
                    // unreachable is ok because Direct Launch is not supported in standalone mode
                    unreachable!()
                }
            }
        }
    }

    #[inline]
    pub fn write(self, writer: &mut impl core::fmt::Write) -> core::fmt::Result {
        write!(writer, "{self}")
    }
}

impl core::fmt::Display for FailReason {
    fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        #[cfg(not(feature = "shim_standalone"))]
        if bun_core::Environment::ALLOW_ASSERT && *self == FailReason::InvalidShimValidation {
            panic!("Internal Assertion: When encountering FailReason.InvalidShimValidation, you must not print the error, but rather fallback to running the .exe file");
        }

        writer.write_str("error: ")?;
        // PORT NOTE: Zig used `switch (reason) { inline else => |r| ... }` to make `r` comptime
        // and resolve the template at compile time. We dispatch at runtime; the template lookup
        // is a const fn so the cost is a single match.
        if IS_STANDALONE && *self == FailReason::CouldNotDirectLaunch {
            // unreachable is ok because Direct Launch is not supported in standalone mode
            unreachable!();
        }

        let template = self.get_format_template();

        // The Zig `comptime std.mem.indexOf(u8, template, "{s}")` check is replaced by an
        // explicit match on the one variant whose template contains `{s}`.
        if matches!(self, FailReason::InterpreterNotFound) {
            // SAFETY: failure_reason_argument is set before InterpreterNotFound is raised.
            let arg = unsafe { FAILURE_REASON_ARGUMENT.unwrap() };
            // SAFETY: arg points into FAILURE_REASON_DATA which is a static buffer.
            let arg_slice = unsafe { core::slice::from_raw_parts(arg.0, arg.1) };
            write!(
                writer,
                "interpreter executable \"{}\" not found in %PATH%\n\n",
                bstr::BStr::new(arg_slice),
            )?;
            if DBG {
                // SAFETY: single-threaded standalone exe; debug-only reset.
                unsafe { FAILURE_REASON_ARGUMENT = None };
            }
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
                "\n",
            ),
            _ => concat!(
                "Bun failed to remap this bin to its proper location within node_modules.\n",
                "This is an indication of a corrupted node_modules directory.\n",
                "\n",
                "Please run 'bun install --force' in the project root and try\n",
                "it again. If this message persists, please open an issue:\n",
                "https://github.com/oven-sh/bun/issues\n",
                "\n",
                "\n",
            ),
        };
        writer.write_str(rest)
    }
}

pub fn write_to_handle(handle: HANDLE, data: &[u8]) -> usize {
    // SAFETY: all-zero is a valid IO_STATUS_BLOCK (#[repr(C)] POD).
    let mut io: IO_STATUS_BLOCK = unsafe { core::mem::zeroed() };
    // SAFETY: NtWriteFile is given a valid handle and a buffer that lives for the call.
    let rc = unsafe {
        nt::NtWriteFile(
            handle,
            None,
            core::ptr::null_mut(),
            core::ptr::null_mut(),
            &mut io,
            data.as_ptr(),
            u32::try_from(data.len()).unwrap(),
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

/// Zig: `std.Io.GenericWriter(w.HANDLE, error{}, writeToHandle)`
struct NtWriter {
    context: HANDLE,
}

impl core::fmt::Write for NtWriter {
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        let _ = write_to_handle(self.context, s.as_bytes());
        Ok(())
    }
}

static mut FAILURE_REASON_DATA: [u8; 512] = [0; 512];
// Stored as (ptr, len) into FAILURE_REASON_DATA; Option<&'static [u8]> would also work but
// keeps a reference into a `static mut` which Rust dislikes.
static mut FAILURE_REASON_ARGUMENT: Option<(*const u8, usize)> = None;

#[cold]
#[inline(never)]
fn fail_and_exit_with_reason(reason: FailReason) -> ! {
    // SAFETY: TEB/PEB pointers are valid for the lifetime of the process.
    let console_handle = unsafe {
        (*(*w::teb()).ProcessEnvironmentBlock).ProcessParameters.hStdError
    };
    let mut mode: DWORD = 0;
    // SAFETY: console_handle is a valid handle (or invalid, in which case GetConsoleMode returns 0).
    if unsafe { k32::GetConsoleMode(console_handle, &mut mode) } != 0 {
        mode |= w::ENABLE_VIRTUAL_TERMINAL_PROCESSING;
        // SAFETY: same handle as above.
        let _ = unsafe { k32::SetConsoleMode(console_handle, mode) };
    }

    let mut writer = NtWriter {
        // SAFETY: TEB/PEB pointers are valid for the lifetime of the process.
        context: unsafe {
            (*(*w::teb()).ProcessEnvironmentBlock).ProcessParameters.hStdError
        },
    };
    if let Err(e) = reason.write(&mut writer) {
        if cfg!(debug_assertions) {
            panic!("Failed to write to stderr: {e:?}");
        }
    }

    // SAFETY: RtlExitUserProcess never returns.
    unsafe { nt::RtlExitUserProcess(255) };
}

const NT_OBJECT_PREFIX: [u16; 4] = ['\\' as u16, '?' as u16, '?' as u16, '\\' as u16];

// This is used for CreateProcessW's lpCommandLine
// "The maximum length of this string is 32,767 characters, including the Unicode terminating null character."
pub const BUF2_U16_LEN: usize = 32767 + 1;

#[derive(Clone, Copy, PartialEq, Eq, ConstParamTy)]
pub enum LauncherMode {
    Launch,
    ReadWithoutLaunch,
}

impl LauncherMode {
    // TODO(port): Zig's `RetType`/`FailRetType` returned different types per variant
    // (`noreturn`/`void`/`ReadWithoutLaunchResult`). Stable Rust const-generics cannot
    // associate a return type with a const value. We unify on `LauncherRet` below; the
    // public wrappers (`try_startup_from_bun_js`, `read_without_launch`, `main`) narrow it.

    // PERF(port): comptime mode/reason demoted to runtime args — profile in Phase B
    #[cold]
    #[inline(never)]
    fn fail(self, reason: FailReason) -> LauncherRet {
        match self {
            LauncherMode::Launch => {
                fail_and_exit_with_reason(reason);
            }
            LauncherMode::ReadWithoutLaunch => LauncherRet::Read(ReadWithoutLaunchResult::Err(reason)),
        }
    }
}

/// Unified return type for `launcher`. See note on `LauncherMode`.
enum LauncherRet {
    /// `.launch` in non-standalone returned (validation fallback path).
    LaunchFellThrough,
    /// `.read_without_launch` result.
    Read(ReadWithoutLaunchResult),
}

/// Abstraction over `()` (standalone), `FromBunRunContext`, and `FromBunShellContext`
/// for the Zig `bun_ctx: anytype` parameter.
// TODO(port): this trait approximates Zig comptime duck-typing; methods that don't apply
// to a given impl call `unreachable!()` (matching the Zig — those code paths are gated by
// `is_standalone`/`mode` checks that prevent the call at runtime).
trait BunCtx {
    fn base_path(&self) -> *mut u16;
    fn base_path_len(&self) -> usize;
    fn arguments(&self) -> &[u16];
    fn handle(&self) -> HANDLE;
    fn force_use_bun(&self) -> bool;
    fn direct_launch_with_bun_js(&self, wpath: &mut [u16]);
    fn environment(&self) -> Option<*const u16>;
}

impl BunCtx for () {
    fn base_path(&self) -> *mut u16 { unreachable!() }
    fn base_path_len(&self) -> usize { unreachable!() }
    fn arguments(&self) -> &[u16] { unreachable!() }
    fn handle(&self) -> HANDLE { unreachable!() }
    fn force_use_bun(&self) -> bool { unreachable!() }
    fn direct_launch_with_bun_js(&self, _: &mut [u16]) { unreachable!() }
    fn environment(&self) -> Option<*const u16> { unreachable!() }
}

#[allow(clippy::too_many_lines)]
fn launcher<const MODE: LauncherMode, Ctx: BunCtx>(bun_ctx: Ctx) -> LauncherRet {
    // peb! w.teb is a couple instructions of inline asm
    // SAFETY: TEB/PEB are valid for the process lifetime.
    let teb: *mut w::TEB = unsafe { w::teb() };
    let peb = unsafe { (*teb).ProcessEnvironmentBlock };
    let process_parameters = unsafe { &mut *(*peb).ProcessParameters };
    let command_line = process_parameters.CommandLine;
    let image_path_name = process_parameters.ImagePathName;

    // these are all different views of the same data
    let image_path_b_len: usize = if IS_STANDALONE {
        image_path_name.Length as usize
    } else {
        bun_ctx.base_path_len() * 2
    };
    let image_path_ptr: *mut u16 = if IS_STANDALONE {
        image_path_name.Buffer
    } else {
        bun_ctx.base_path()
    };
    // SAFETY: image_path_ptr is valid for image_path_b_len bytes per UNICODE_STRING / caller contract.
    let image_path_u16: &[u16] =
        unsafe { core::slice::from_raw_parts(image_path_ptr, image_path_b_len / 2) };
    let image_path_u8: &[u8] =
        unsafe { core::slice::from_raw_parts(image_path_ptr.cast::<u8>(), image_path_b_len) };

    let cmd_line_b_len = command_line.Length as usize;
    // SAFETY: CommandLine.Buffer is valid for Length bytes.
    let cmd_line_u16: &[u16] =
        unsafe { core::slice::from_raw_parts(command_line.Buffer, cmd_line_b_len / 2) };
    let cmd_line_u8: &[u8] =
        unsafe { core::slice::from_raw_parts(command_line.Buffer.cast::<u8>(), cmd_line_b_len) };

    debug_assert!((cmd_line_u16.as_ptr() as usize) % 2 == 0); // alignment assumption

    if DBG {
        debug!("CommandLine: {}", fmt16(&cmd_line_u16[0..cmd_line_b_len / 2]));
        debug!("ImagePathName: {}", fmt16(&image_path_u16[0..image_path_b_len / 2]));
    }

    const BUF1_LEN: usize = w::PATH_MAX_WIDE + 3; // + "\"\" ".len
    let mut buf1: [u16; BUF1_LEN] = unsafe { MaybeUninit::uninit().assume_init() };
    // SAFETY: stack buffer; uninitialized contents are never read before being written.
    let mut buf2: [u16; BUF2_U16_LEN] = unsafe { MaybeUninit::uninit().assume_init() };
    // SAFETY: same as above.

    // TODO(port): the Zig source slices these as `[comptime buf1.len..]` on a `[*]T` cast,
    // whose semantics are unclear; from usage they are base-of-buffer raw pointers.
    let buf1_u8: *mut u8 = buf1.as_mut_ptr().cast::<u8>();
    let buf1_u16: *mut u16 = buf1.as_mut_ptr();

    let buf2_u8: *mut u8 = buf2.as_mut_ptr().cast::<u8>();
    let buf2_u16: *mut u16 = buf2.as_mut_ptr();

    // The NT prefix is not needed for non-standalone, as we only need this
    // for reading the metadata file which is skipped in non-standalone.
    //
    // BUF1: '\??\!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
    if IS_STANDALONE {
        // SAFETY: buf1 has at least 8 bytes; we write 4 u16s (the NT prefix) as a single u64.
        unsafe {
            buf1_u8
                .cast::<u64>()
                .write_unaligned(core::mem::transmute::<[u16; 4], u64>(NT_OBJECT_PREFIX));
        }
    }

    // BUF1: '\??\C:\Users\chloe\project\node_modules\.bin\hello.!!!!!!!!!!!!!!!!!!!!!!!!!!'
    let suffix: &'static [u16] = if IS_STANDALONE {
        bun_str::w!("exe")
    } else {
        bun_str::w!("bunx")
    };
    if DBG {
        if !image_path_u16.ends_with(suffix) {
            panic!(
                "assert failed: image path expected to end with {}, got {}",
                fmt16(suffix),
                fmt16(image_path_u16),
            );
        }
    }
    let image_path_to_copy_b_len = image_path_b_len - 2 * suffix.len();
    // SAFETY: buf1 has room for nt_prefix + image_path; image_path_u8 is valid for the copy len.
    unsafe {
        core::ptr::copy_nonoverlapping(
            image_path_u8.as_ptr(),
            buf1_u8.add(2 * NT_OBJECT_PREFIX.len()),
            image_path_to_copy_b_len,
        );
    }

    // Open the metadata file
    // SAFETY: all-zero is a valid HANDLE (raw pointer; null is a valid bit pattern).
    let mut metadata_handle: HANDLE = unsafe { core::mem::zeroed() };
    // SAFETY: all-zero is a valid IO_STATUS_BLOCK (#[repr(C)] POD).
    let mut io: IO_STATUS_BLOCK = unsafe { core::mem::zeroed() };
    if IS_STANDALONE {
        // BUF1: '\??\C:\Users\chloe\project\node_modules\.bin\hello.bunx!!!!!!!!!!!!!!!!!!!!!!'
        // SAFETY: writing 4 u16s ("bunx") into buf1 at the computed offset, which is in bounds.
        unsafe {
            buf1_u8
                .add(image_path_b_len + 2 * (NT_OBJECT_PREFIX.len() - 3 /* "exe".len */))
                .cast::<u64>()
                .write_unaligned(core::mem::transmute::<[u16; 4], u64>([
                    'b' as u16, 'u' as u16, 'n' as u16, 'x' as u16,
                ]));
        }

        let path_len_bytes: u16 = u16::try_from(
            image_path_b_len
                + 2 * (NT_OBJECT_PREFIX.len() - 3 /* "exe".len */ + 4 /* "bunx".len */),
        )
        .unwrap();
        let mut nt_name = UNICODE_STRING {
            Length: path_len_bytes,
            MaximumLength: path_len_bytes,
            Buffer: buf1_u16,
        };
        if DBG {
            debug!("NtCreateFile({})", fmt16(unicode_string_to_u16(nt_name)));
            debug!("NtCreateFile({})", fmt16(unicode_string_to_u16(nt_name)));
        }
        let mut attr = w::OBJECT_ATTRIBUTES {
            Length: size_of::<w::OBJECT_ATTRIBUTES>() as u32,
            RootDirectory: core::ptr::null_mut(),
            Attributes: 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
            ObjectName: &mut nt_name,
            SecurityDescriptor: core::ptr::null_mut(),
            SecurityQualityOfService: core::ptr::null_mut(),
        };
        // NtCreateFile will fail for absolute paths if we do not pass an OBJECT name
        // so we need the prefix here. This is an extra sanity check.
        if DBG {
            debug_assert!(unicode_string_to_u16(nt_name).starts_with(&NT_OBJECT_PREFIX));
            debug_assert!(unicode_string_to_u16(nt_name).ends_with(bun_str::w!(".bunx")));
        }
        // SAFETY: all out-pointers are valid stack locations; attr is fully initialized.
        let rc = unsafe {
            nt::NtCreateFile(
                &mut metadata_handle,
                FILE_GENERIC_READ,
                &mut attr,
                &mut io,
                core::ptr::null_mut(),
                w::FILE_ATTRIBUTE_NORMAL,
                w::FILE_SHARE_WRITE | w::FILE_SHARE_READ | w::FILE_SHARE_DELETE,
                w::FILE_OPEN,
                w::FILE_NON_DIRECTORY_FILE | w::FILE_SYNCHRONOUS_IO_NONALERT,
                core::ptr::null_mut(),
                0,
            )
        };
        if rc != NTSTATUS::SUCCESS {
            if DBG {
                debug!("error opening: {}", <&'static str>::from(rc));
            }
            if rc == NTSTATUS::OBJECT_NAME_NOT_FOUND {
                return LauncherMode::fail(MODE, FailReason::ShimNotFound);
            }
            return LauncherMode::fail(MODE, FailReason::CouldNotOpenShim);
        }
    } else {
        metadata_handle = bun_ctx.handle();
    }

    // get a slice to where the CLI arguments are
    // the slice will have a leading space ' arg arg2' or be empty ''
    let user_arguments_u8: &[u8] = if !IS_STANDALONE {
        // SAFETY: arguments slice is valid; reinterpreting [u16] as [u8] is safe (alignment 1).
        unsafe {
            let a = bun_ctx.arguments();
            core::slice::from_raw_parts(a.as_ptr().cast::<u8>(), a.len() * 2)
        }
    } else {
        'find_args: {
            // Windows command line quotes are really silly. This post explains it better than I can:
            // https://stackoverflow.com/questions/7760545/escape-double-quotes-in-parameter
            let mut in_quote = false;
            let mut i: usize = 0;
            while i < cmd_line_u16.len() {
                if cmd_line_u16[i] == '"' as u16 {
                    in_quote = !in_quote;
                    if !in_quote {
                        // 'quote directly follows closer - acts as plain unwrapped text: "'
                        if i + 1 < cmd_line_u16.len() && cmd_line_u16[i + 1] == '"' as u16 {
                            // skip this quote and keep the state in 'not in a quote'
                            i += 1;
                        }
                    }
                } else if cmd_line_u16[i] == ' ' as u16 && !in_quote {
                    // there are more arguments!
                    // if this is the end of the string then this becomes an empty slice,
                    // otherwise it is a slice of just the arguments
                    while cmd_line_u16[i] == ' ' as u16 {
                        i += 1;
                    }
                    break 'find_args &cmd_line_u8[i * 2 - 2 * 1 /* " ".len */..];
                }
                i += 1;
            }
            // no args
            break 'find_args &cmd_line_u8[0..0];
        }
    };

    if DBG {
        debug!(
            "UserArgs: '{}' ({} bytes)",
            bstr::BStr::new(user_arguments_u8),
            user_arguments_u8.len()
        );
    }

    debug_assert!(user_arguments_u8.len() % 2 == 0);
    debug_assert!(user_arguments_u8.len() != 2);
    debug_assert!(user_arguments_u8.is_empty() || user_arguments_u8[0] == b' ');

    // Read the metadata file into the memory right after the image path.
    //
    // i'm really proud of this technique, because it will create an absolute path, but
    // without needing to store the absolute path in the '.bunx' file
    //
    // we do this by reusing the memory in the first buffer
    // BUF1: '\??\C:\Users\chloe\project\node_modules\.bin\hello.bunx!!!!!!!!!!!!!!!!!!!!!!'
    //                                               ^^        ^     ^
    //                                               S|        |     image_path_b_len + nt_object_prefix.len
    //                                                |        'ptr' initial value
    //                                               the read ptr
    let mut read_ptr: *mut u16 = 'brk: {
        let mut left =
            image_path_b_len / 2 - (if IS_STANDALONE { 4 /* ".exe".len */ } else { 5 /* ".bunx".len */ }) - 1;
        // SAFETY: offset is within buf1.
        let mut ptr: *mut u16 = unsafe { buf1_u16.add(NT_OBJECT_PREFIX.len() + left) };
        if DBG {
            debug!("left = {}, at {}, after {}", left, unsafe { *ptr }, unsafe { *ptr.add(1) });
        }

        // if this is false, potential out of bounds memory access
        if DBG {
            debug_assert!(
                (ptr as usize) - left * size_of::<u16>() >= (buf1_u16 as usize)
            );
        }
        // we start our search right before the . as we know the extension is '.bunx'
        // SAFETY: ptr points into buf1 which we just wrote.
        debug_assert!(unsafe { *ptr.add(1) } == '.' as u16);

        loop {
            if DBG {
                debug!("1 - {}", fmt16(unsafe { core::slice::from_raw_parts(ptr, 1) }));
            }
            // SAFETY: ptr is within buf1 (left > 0 invariant below).
            if unsafe { *ptr } == '\\' as u16 {
                left -= 1;
                // ptr is *mut u16, sub operates on number of ITEMS, not BYTES
                ptr = unsafe { ptr.sub(1) };
                break;
            }
            left -= 1;
            if left == 0 {
                return LauncherMode::fail(MODE, FailReason::NoDirname);
            }
            ptr = unsafe { ptr.sub(1) };
            if DBG {
                debug_assert!((ptr as usize) >= (buf1_u16 as usize));
            }
        }
        // inlined loop to do this again, because the completion case is different
        // using `inline for` caused comptime issues that made the code much harder to read
        loop {
            if DBG {
                debug!("2 - {}", fmt16(unsafe { core::slice::from_raw_parts(ptr, 1) }));
            }
            if unsafe { *ptr } == '\\' as u16 {
                // ptr is at the position marked S, so move forward one *character*
                break 'brk unsafe { ptr.add(1) };
            }
            left -= 1;
            if left == 0 {
                return LauncherMode::fail(MODE, FailReason::NoDirname);
            }
            ptr = unsafe { ptr.sub(1) };
            if DBG {
                debug_assert!((ptr as usize) >= (buf1_u16 as usize));
            }
        }
        // unreachable - the loop breaks this entire block
    };
    debug_assert!(unsafe { *read_ptr } != '\\' as u16);
    debug_assert!(unsafe { *read_ptr.sub(1) } == '\\' as u16);

    let read_max_len = BUF1_LEN * 2 - ((read_ptr as usize) - (buf1_u16 as usize));

    if DBG {
        debug!("read_ptr = buf1 + {}", (read_ptr as usize) - (buf1_u16 as usize));
        debug!("max_read_len = {}", read_max_len);
    }

    // Do the read!
    //
    //                                               v overwritten data
    // BUF1: '\??\C:\Users\chloe\project\node_modules\my-cli\src\app.js"#node #####!!!!!!!!!!'
    //                                                                  ^^    ^   ^ flags u16
    //                                                         a zero u16|    shebang meta
    //                                                                   |shebang data
    //
    // We are intentionally only reading one chunk. The metadata file is almost always going to be < 200 bytes
    // If this becomes a problem we will fix it.
    // SAFETY: read_ptr points into buf1 with read_max_len bytes available.
    let read_status = unsafe {
        nt::NtReadFile(
            metadata_handle,
            None,
            core::ptr::null_mut(),
            core::ptr::null_mut(),
            &mut io,
            read_ptr.cast::<c_void>(),
            u32::try_from(read_max_len).unwrap(),
            core::ptr::null(),
            core::ptr::null(),
        )
    };
    let read_len: usize = match read_status {
        NTSTATUS::SUCCESS => io.Information,
        NTSTATUS::END_OF_FILE =>
        // Supposedly .END_OF_FILE will be hit if you read exactly the amount of data left
        // "IO_STATUS_BLOCK is filled only if !NT_ERROR(status)"
        // https://stackoverflow.com/questions/62438021/can-ntreadfile-produce-a-short-read-without-reaching-eof
        // In the context of this program, I don't think that is possible, but I will handle it
        {
            read_max_len
        }
        rc => {
            if DBG {
                debug!("error reading: {}", <&'static str>::from(rc));
            }
            return LauncherMode::fail(MODE, FailReason::CouldNotReadShim);
        }
    };

    // SAFETY: handle was opened above (or passed in) and is closed exactly once here.
    let _ = unsafe { nt::NtClose(metadata_handle) };

    if DBG {
        let total = (((read_ptr as usize) - (buf1_u8 as usize)) + read_len) / 2;
        debug!(
            "BufferAfterRead: '{}'",
            fmt16(unsafe { core::slice::from_raw_parts(buf1_u16, total) })
        );
    }

    // SAFETY: read_len >= sizeof(Flags) for any valid .bunx; if not, the unaligned read below
    // will read garbage and `is_valid()` will reject it.
    read_ptr = ((read_ptr as usize) + read_len - size_of::<Flags>()) as *mut u16;
    // SAFETY: Flags is a packed u16; read_ptr is within buf1.
    let flags: Flags = unsafe { read_ptr.cast::<Flags>().read_unaligned() };

    if DBG {
        let flags_u16: u16 = unsafe { read_ptr.cast::<u16>().read_unaligned() };
        debug!("FlagsInt: {}", flags_u16);
        debug!("Flags:");
        // TODO(port): Zig used `inline for` over `std.meta.fieldNames(Flags)`. Replace with a
        // manual dump or a `Debug` impl on `Flags`.
        debug!("    {:?}", flags);
    }

    if !flags.is_valid() {
        // We want to return control flow back into bun.exe's main code, so that it can fall
        // back to the slow path. For more explanation, see the comment on top of `tryStartupFromBunJS`.
        if !IS_STANDALONE && MODE == LauncherMode::Launch {
            return LauncherRet::LaunchFellThrough;
        }

        return LauncherMode::fail(MODE, FailReason::InvalidShimValidation);
    }

    let mut spawn_command_line: *mut u16 = if !flags.has_shebang() {
        'spawn_command_line: {
            // no shebang, which means the command line is simply going to be the joined file exe
            // followed by the existing command line.
            //
            // I don't have a good example of this in practice, but it is certainly possible.
            // (a package distributing an exe [like esbuild] usually has their own wrapper script)
            //
            // Instead of the above, the buffer would actually look like:
            // BUF1: '\??"C:\Users\chloe\project\node_modules\my-cli\src\app.js"##!!!!!!!!!!'
            //                                                                  ^^ flags
            //                                                         zero char|

            // change the \ from '\??\' to '""
            // the ending quote is assumed to already exist as per the format
            // BUF1: '\??"C:\Users\chloe\project\node_modules\my-cli\src\app.js"##!!!!!!!!!!'
            //           ^
            // SAFETY: index 3 is within buf1.
            unsafe { *buf1_u16.add(3) = '"' as u16 };

            // Copy user arguments in, overwriting old data. Remember that we ensured the arguments
            // this started with a space.
            // BUF1: '\??"C:\Users\chloe\project\node_modules\my-cli\src\app.js"##!!!!!!!!!!'
            //                                                ^                 ^^
            //                                                read_ptr (old)    |read_ptr (right now)
            //                                                                  argument_start_ptr
            //
            // BUF1: '\??"C:\Users\chloe\project\node_modules\my-cli\src\app.js" --flag!!!!!'
            let argument_start_ptr: *mut u8 =
                ((read_ptr as usize) - 2 * 1 /* "\x00".len */) as *mut u8;
            if !user_arguments_u8.is_empty() {
                // SAFETY: argument_start_ptr is within buf1 with room for user_arguments_u8.
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        user_arguments_u8.as_ptr(),
                        argument_start_ptr,
                        user_arguments_u8.len(),
                    );
                }
            }

            // BUF1: '\??"C:\Users\chloe\project\node_modules\my-cli\src\app.js" --flag#!!!!'
            //           ^ lpCommandLine                                               ^ null terminator
            // SAFETY: writing one u16 within buf1.
            unsafe {
                argument_start_ptr
                    .add(user_arguments_u8.len())
                    .cast::<u16>()
                    .write_unaligned(0);
            }

            // SAFETY: buf1_u8 + 2*(4-1) is 2-byte-aligned (buf1 is u16-aligned, offset is even).
            break 'spawn_command_line unsafe {
                buf1_u8.add(2 * (NT_OBJECT_PREFIX.len() - 1 /* "\"".len */)).cast::<u16>()
            };
        }
    } else {
        'spawn_command_line: {
            // When the shebang flag is set, we expect two u32s containing byte lengths of the bin and arg components
            // This is not needed for the other case because the other case does not have an args component.
            #[repr(C, packed)]
            struct ShebangMetadataPacked {
                bin_path_len_bytes: u32,
                args_len_bytes: u32,
            }

            // BUF1: '\??\C:\Users\chloe\project\node_modules\my-cli\src\app.js"#node #####!!!!!!!!!!'
            //                                                                        ^ new read_ptr
            read_ptr = ((read_ptr as usize) - size_of::<ShebangMetadataPacked>()) as *mut u16;
            // SAFETY: read_ptr is within buf1; ShebangMetadataPacked is 8 bytes packed.
            let shebang_metadata: ShebangMetadataPacked =
                unsafe { read_ptr.cast::<ShebangMetadataPacked>().read_unaligned() };

            let shebang_arg_len_u8 = shebang_metadata.args_len_bytes;
            let shebang_bin_path_len_bytes = shebang_metadata.bin_path_len_bytes;

            if DBG {
                debug!("bin_path_len_bytes: {}", shebang_metadata.bin_path_len_bytes);
                debug!("args_len_bytes: {}", shebang_metadata.args_len_bytes);
            }

            // magic number related to how BinLinkingShim.zig writes the metadata
            // i'm sorry, i don't have a good explanation for why this number is this number. it just is.
            const VALIDATION_LENGTH_OFFSET: u64 = 14;

            // very careful here to not overflow u32, so that we properly error if you hijack the file
            if shebang_arg_len_u8 == 0
                || (shebang_arg_len_u8 as u64).saturating_add(shebang_bin_path_len_bytes as u64)
                    + VALIDATION_LENGTH_OFFSET
                    != read_len as u64
            {
                if DBG {
                    debug!("read_len: {}", read_len);
                }

                return LauncherMode::fail(MODE, FailReason::InvalidShimBounds);
            }

            if !IS_STANDALONE && flags.is_node_or_bun() && bun_ctx.force_use_bun() {
                // If we are running `bun --bun ...` and the script is already set to run
                // in node.exe or bun.exe, we can just directly launch it by calling Run.boot
                //
                // This can only be done in non-standalone as standalone doesn't have the JS runtime.
                // And if --bun was passed to any parent bun process, then %PATH% is already setup
                // to redirect a call to node.exe -> bun.exe. So we need not check.
                //
                // This optimization can save an additional ~10-20ms depending on the machine
                // as we do not have to launch a second process.
                if DBG {
                    debug!("direct_launch_with_bun_js");
                }
                // BUF1: '\??\C:\Users\chloe\project\node_modules\my-cli\src\app.js"#node #####!!!!!!!!!!'
                //            ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^  ^ read_ptr
                let len = ((read_ptr as usize) - (buf1_u8 as usize) - shebang_arg_len_u8 as usize)
                    / 2
                    - NT_OBJECT_PREFIX.len()
                    - 2 /* "\"\x00".len */;
                // SAFETY: buf1_u16 + 4 .. + 4 + len is within buf1; the next char is '"' (asserted in Zig via sentinel slice).
                let launch_slice = unsafe {
                    core::slice::from_raw_parts_mut(buf1_u16.add(NT_OBJECT_PREFIX.len()), len)
                };
                debug_assert_eq!(
                    unsafe { *buf1_u16.add(NT_OBJECT_PREFIX.len() + len) },
                    '"' as u16
                );
                bun_ctx.direct_launch_with_bun_js(launch_slice);
                return LauncherMode::fail(MODE, FailReason::CouldNotDirectLaunch);
            }

            // Copy the shebang bin path
            // BUF1: '\??\C:\Users\chloe\project\node_modules\my-cli\src\app.js"#node #####!!!!!!!!!!'
            //                                                                   ^~~~^
            //                                                                   ^ read_ptr
            // BUF2: 'node !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
            read_ptr = ((read_ptr as usize) - shebang_arg_len_u8 as usize) as *mut u16;
            // SAFETY: copying shebang_arg_len_u8 bytes from buf1 into buf2; both in bounds.
            unsafe {
                core::ptr::copy_nonoverlapping(
                    read_ptr.cast::<u8>(),
                    buf2_u8,
                    shebang_arg_len_u8 as usize,
                );
            }

            // BUF2: 'node "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
            // SAFETY: writing one u16 within buf2.
            unsafe {
                buf2_u8
                    .add(shebang_arg_len_u8 as usize)
                    .cast::<u16>()
                    .write_unaligned('"' as u16);
            }

            // Copy the filename in. There is no leading " but there is a trailing "
            // BUF1: '\??\C:\Users\chloe\project\node_modules\my-cli\src\app.js"#node #####!!!!!!!!!!'
            //            ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^ ^ read_ptr
            // BUF2: 'node "C:\Users\chloe\project\node_modules\my-cli\src\app.js"!!!!!!!!!!!!!!!!!!!!'
            let length_of_filename_u8 = (read_ptr as usize)
                - (buf1_u8 as usize)
                - 2 * (NT_OBJECT_PREFIX.len() + 1 /* "\x00".len */);
            // SAFETY: slice within buf1.
            let filename: &[u8] = unsafe {
                core::slice::from_raw_parts(
                    buf1_u8.add(2 * NT_OBJECT_PREFIX.len()),
                    length_of_filename_u8,
                )
            };
            // SAFETY: filename has even length (UTF-16); reinterpret as [u16].
            let filename_u16: &[u16] = unsafe {
                core::slice::from_raw_parts(filename.as_ptr().cast::<u16>(), filename.len() / 2)
            };
            if DBG {
                debug!("filename and quote: '{}'", fmt16(filename_u16));
                if !filename_u16.is_empty() {
                    debug!("last char of above is '{}'", filename_u16[filename_u16.len() - 1]);
                }
            }
            // The filename must end with a quote character as per the bunx file format.
            // If it doesn't, the file is corrupt - fall back to the slow path in non-standalone mode.
            if filename_u16.is_empty() || filename_u16[filename_u16.len() - 1] != '"' as u16 {
                if !IS_STANDALONE && MODE == LauncherMode::Launch {
                    return LauncherRet::LaunchFellThrough;
                }
                return LauncherMode::fail(MODE, FailReason::InvalidShimValidation);
            }

            // SAFETY: buf2 has room for shebang_arg_len_u8 + 2 + length_of_filename_u8 bytes.
            unsafe {
                core::ptr::copy_nonoverlapping(
                    filename.as_ptr(),
                    buf2_u8.add(shebang_arg_len_u8 as usize + 2 * 1 /* "\"".len */),
                    length_of_filename_u8,
                );
            }
            // the pointer is now going to act as a write pointer for remaining data.
            // note that it points into buf2 now, not buf1. this will write arguments and the null terminator
            // BUF2: 'node "C:\Users\chloe\project\node_modules\my-cli\src\app.js"!!!!!!!!!!!!!!!!!!!!'
            //                                                                    ^ write_ptr
            if DBG {
                debug!(
                    "advance = {} + {} + {}\n",
                    shebang_arg_len_u8, 1usize /* "\"".len */, length_of_filename_u8
                );
            }
            let advance = shebang_arg_len_u8 as usize + 2 * 1 /* "\"".len */ + length_of_filename_u8;
            let mut write_ptr: *mut u16 = ((buf2_u8 as usize) + advance) as *mut u16;
            // The quote was already validated above, this is just a sanity check in debug mode
            if DBG {
                debug_assert!(unsafe { *write_ptr.sub(1) } == '"' as u16);
            }

            if !user_arguments_u8.is_empty() {
                // Copy the user arguments in:
                // BUF2: 'node "C:\Users\chloe\project\node_modules\my-cli\src\app.js" --flags!!!!!!!!!!!'
                //        ^~~~~X^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^
                //        |    |filename_len                                          write_ptr
                //        |    the quote
                //        shebang_arg_len
                // SAFETY: write_ptr is within buf2 with room for user_arguments_u8.
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        user_arguments_u8.as_ptr(),
                        write_ptr.cast::<u8>(),
                        user_arguments_u8.len(),
                    );
                }
                write_ptr = ((write_ptr as usize) + user_arguments_u8.len()) as *mut u16;
            }

            // BUF2: 'node "C:\Users\chloe\project\node_modules\my-cli\src\app.js" --flags#!!!!!!!!!!'
            //                                                                            ^ null terminator
            // SAFETY: write_ptr is within buf2.
            unsafe { *write_ptr = 0 };

            break 'spawn_command_line buf2_u16;
        }
    };

    #[cfg(not(feature = "shim_standalone"))]
    {
        // Prepare stdio for the child process, as after this we are going to *immediatly* exit
        // it is likely that the c-runtime's atexit will not be called as we end the process ourselves.
        bun_core::Output::Source::Stdio::restore();
        bun_sys::windows::windows_enable_stdio_inheritance();
    }

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
    let mut process: w::PROCESS_INFORMATION = unsafe { core::mem::zeroed() };
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
        // The standard handles outside of standalone may be tampered with.
        hStdInput: if IS_STANDALONE {
            process_parameters.hStdInput
        } else {
            #[cfg(not(feature = "shim_standalone"))]
            { bun_sys::Fd::stdin().native() }
            #[cfg(feature = "shim_standalone")]
            { unreachable!() }
        },
        hStdOutput: if IS_STANDALONE {
            process_parameters.hStdOutput
        } else {
            #[cfg(not(feature = "shim_standalone"))]
            { bun_sys::Fd::stdout().native() }
            #[cfg(feature = "shim_standalone")]
            { unreachable!() }
        },
        hStdError: if IS_STANDALONE {
            process_parameters.hStdError
        } else {
            #[cfg(not(feature = "shim_standalone"))]
            { bun_sys::Fd::stderr().native() }
            #[cfg(feature = "shim_standalone")]
            { unreachable!() }
        },
    };

    // PERF(port): Zig used `inline for (.{ 0, 1 })` to unroll this loop with comptime
    // `attempt_number`. We use a runtime loop; the body is large enough that unrolling is
    // unlikely to matter — profile in Phase B.
    for attempt_number in [0u32, 1] {
        'iteration: {
            if DBG {
                // SAFETY: spawn_command_line is NUL-terminated (we wrote the terminator above).
                debug!(
                    "lpCommandLine: {}\n",
                    fmt16(unsafe { span_u16(spawn_command_line) })
                );
            }
            // SAFETY: all pointers are valid; spawn_command_line is NUL-terminated mutable buffer.
            let did_process_spawn = unsafe {
                k32::CreateProcessW(
                    core::ptr::null(),
                    spawn_command_line,
                    core::ptr::null_mut(),
                    core::ptr::null_mut(),
                    1, // true
                    w::ProcessCreationFlags {
                        create_unicode_environment: !IS_STANDALONE,
                        ..Default::default()
                    },
                    if IS_STANDALONE {
                        core::ptr::null_mut()
                    } else {
                        bun_ctx.environment().map_or(core::ptr::null(), |p| p) as *mut c_void
                    },
                    core::ptr::null(),
                    &mut startup_info,
                    &mut process,
                )
            };
            if did_process_spawn == 0 {
                let spawn_err = unsafe { k32::GetLastError() };
                if DBG {
                    debug!("CreateProcessW failed: {}", <&'static str>::from(spawn_err));
                    debug!("attempt number: {}", attempt_number);
                }
                return match spawn_err {
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
                                    debug_assert!(flags.has_shebang());
                                    if DBG {
                                        debug_assert!(unsafe { span_u16(spawn_command_line) }
                                            .starts_with(bun_str::w!("node ")));
                                    }

                                    // To go from node -> bun, it is a matter of writing three chars, and incrementing a pointer.
                                    //
                                    // lpCommandLine: 'node "C:\Users\chloe\project\node_modules\my-cli\src\app.js" --flags#!!!!!!!!!!'
                                    //                  ^~~ replace these three bytes with 'bun'
                                    // SAFETY: spawn_command_line[1..4] is within the buffer.
                                    unsafe {
                                        let bun = bun_str::w!("bun");
                                        core::ptr::copy_nonoverlapping(
                                            bun.as_ptr(),
                                            spawn_command_line.add(1),
                                            3,
                                        );
                                    }

                                    // lpCommandLine: 'nbun "C:\Users\chloe\project\node_modules\my-cli\src\app.js" --flags#!!!!!!!!!!'
                                    //                  ^ increment pointer by one char
                                    spawn_command_line = unsafe { spawn_command_line.add(1) };

                                    break 'iteration; // loop back
                                }

                                if flags.is_node_or_bun() {
                                    // This script calls for 'bun', but it was not found.
                                    if DBG {
                                        debug_assert!(unsafe { span_u16(spawn_command_line) }
                                            .starts_with(bun_str::w!("bun ")));
                                    }
                                    return LauncherMode::fail(MODE, FailReason::InterpreterNotFoundBun);
                                }
                            }

                            // if attempt_number == 1, we already tried rewriting this to bun, and will now fail for real
                            if attempt_number == 1 {
                                if DBG {
                                    debug_assert!(unsafe { span_u16(spawn_command_line) }
                                        .starts_with(bun_str::w!("bun ")));
                                }
                                return LauncherMode::fail(MODE, FailReason::InterpreterNotFoundBun);
                            }

                            // This UTF16 -> UTF-8 conversion is intentionally very lossy, and assuming that ascii text is provided.
                            // This trade off is made to reduce the binary size of the shim.
                            // SAFETY: FAILURE_REASON_DATA is a static buffer; this code path is only
                            // reached single-threaded (standalone exe or just before process exit).
                            unsafe {
                                FAILURE_REASON_ARGUMENT = Some('brk: {
                                    let mut i: u32 = 0;
                                    while *spawn_command_line.add(i as usize) != ' ' as u16
                                        && i < 512
                                    {
                                        FAILURE_REASON_DATA[i as usize] =
                                            (*spawn_command_line.add(i as usize) & 0x7F) as u8;
                                        i += 1;
                                    }
                                    break 'brk (FAILURE_REASON_DATA.as_ptr(), i as usize);
                                });
                            }
                            return LauncherMode::fail(MODE, FailReason::InterpreterNotFound);
                        } else {
                            return LauncherMode::fail(MODE, FailReason::BinNotFound);
                        }
                    }

                    // TODO: ERROR_ELEVATION_REQUIRED must take a fallback path, this path is potentially slower:
                    // This likely will not be an issue anyone runs into for a while, because it implies
                    // the shebang depends on something that requires UAC, which .... why?
                    //
                    // https://learn.microsoft.com/en-us/windows/security/application-security/application-control/user-account-control/how-it-works#user
                    // https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutew
                    w::Win32Error::ELEVATION_REQUIRED => {
                        return LauncherMode::fail(MODE, FailReason::ElevationRequired)
                    }

                    _ => return LauncherMode::fail(MODE, FailReason::CreateProcessFailed),
                };
            }

            // SAFETY: process.hProcess is a valid handle from CreateProcessW.
            let _ = unsafe { k32::WaitForSingleObject(process.hProcess, w::INFINITE) };

            let mut exit_code: DWORD = 255;
            // SAFETY: process.hProcess is valid; exit_code is a valid out-pointer.
            let _ = unsafe { k32::GetExitCodeProcess(process.hProcess, &mut exit_code) };
            if DBG {
                debug!("exit_code: {}", exit_code);
            }

            // SAFETY: closing handles returned by CreateProcessW exactly once.
            let _ = unsafe { nt::NtClose(process.hProcess) };
            let _ = unsafe { nt::NtClose(process.hThread) };

            // SAFETY: RtlExitUserProcess never returns.
            unsafe { nt::RtlExitUserProcess(exit_code) };
            // unreachable - RtlExitUserProcess does not return
        }
    }
    unreachable!("above loop should not exit");
}

#[cfg(not(feature = "shim_standalone"))]
type CommandContext = bun_cli::command::Context;
#[cfg(feature = "shim_standalone")]
type CommandContext = (); // unused in standalone

pub struct FromBunRunContext {
    /// Path like 'C:\Users\chloe\project\node_modules\.bin\foo.bunx'
    pub base_path: *mut u16,
    pub base_path_len: usize,
    /// Command line arguments which does NOT include the bin name:
    /// like '--port 3000 --config ./config.json'
    pub arguments: *mut u16,
    pub arguments_len: usize,
    /// Handle to the successfully opened metadata file
    pub handle: HANDLE,
    /// Was --bun passed?
    pub force_use_bun: bool,
    /// A pointer to a function that can launch `Run.boot`
    pub direct_launch_with_bun_js: fn(&mut [u16], CommandContext),
    /// Command.Context
    pub cli_context: CommandContext,
    /// Passed directly to CreateProcessW's lpEnvironment with CREATE_UNICODE_ENVIRONMENT
    pub environment: Option<*const u16>,
}

impl BunCtx for &FromBunRunContext {
    fn base_path(&self) -> *mut u16 { self.base_path }
    fn base_path_len(&self) -> usize { self.base_path_len }
    fn arguments(&self) -> &[u16] {
        // SAFETY: caller guarantees arguments is valid for arguments_len.
        unsafe { core::slice::from_raw_parts(self.arguments, self.arguments_len) }
    }
    fn handle(&self) -> HANDLE { self.handle }
    fn force_use_bun(&self) -> bool { self.force_use_bun }
    fn direct_launch_with_bun_js(&self, wpath: &mut [u16]) {
        (self.direct_launch_with_bun_js)(wpath, self.cli_context)
    }
    fn environment(&self) -> Option<*const u16> { self.environment }
}

/// This is called from run_command.zig in bun.exe which allows us to skip the CreateProcessW
/// call to create bun_shim_impl.exe. Instead we invoke the logic it has from an open file handle.
///
/// This saves ~5-12ms depending on the machine.
///
/// If the launch is successful, this function does not return. If a validation error occurs,
/// this returns void, to which the caller should still try invoking the exe directly. This
/// is to handle version mismatches where bun.exe's decoder is too new than the .bunx file.
#[cfg(not(feature = "shim_standalone"))]
pub fn try_startup_from_bun_js(context: FromBunRunContext) {
    debug_assert!(!unsafe {
        core::slice::from_raw_parts(context.base_path, context.base_path_len)
    }
    .starts_with(&NT_OBJECT_PREFIX));
    const _: () = assert!(!IS_STANDALONE);
    // TODO(port): `comptime assert(bun.FeatureFlags.windows_bunx_fast_path)` — wire up FeatureFlags const.
    match launcher::<{ LauncherMode::Launch }, _>(&context) {
        LauncherRet::LaunchFellThrough => {}
        LauncherRet::Read(_) => unreachable!(),
    }
}

pub struct FromBunShellContext<'a> {
    /// Path like 'C:\Users\chloe\project\node_modules\.bin\foo.bunx'
    pub base_path: *mut u16,
    pub base_path_len: usize,
    /// Command line arguments which does NOT include the bin name:
    /// like '--port 3000 --config ./config.json'
    pub arguments: *mut u16,
    pub arguments_len: usize,
    /// Handle to the successfully opened metadata file
    pub handle: HANDLE,
    /// Was --bun passed?
    pub force_use_bun: bool,
    /// A pointer to memory needed to store the command line
    pub buf: &'a mut [u16; BUF2_U16_LEN],
}

pub type FromBunShellContextBuf = [u16; BUF2_U16_LEN];

impl<'a> BunCtx for &FromBunShellContext<'a> {
    fn base_path(&self) -> *mut u16 { self.base_path }
    fn base_path_len(&self) -> usize { self.base_path_len }
    fn arguments(&self) -> &[u16] {
        // SAFETY: caller guarantees arguments is valid for arguments_len.
        unsafe { core::slice::from_raw_parts(self.arguments, self.arguments_len) }
    }
    fn handle(&self) -> HANDLE { self.handle }
    fn force_use_bun(&self) -> bool { self.force_use_bun }
    fn direct_launch_with_bun_js(&self, _: &mut [u16]) { unreachable!() }
    fn environment(&self) -> Option<*const u16> { unreachable!() }
}

// PORT NOTE: Zig `union` (untagged). Rust enums are tagged; the discriminant overhead is
// negligible here and gives us safe matching.
pub enum ReadWithoutLaunchResult {
    /// enum which has a predefined custom formatter
    Err(FailReason),
    CommandLine(*const u16, usize),
}

/// Given the path and handle to a .bunx file, do everything needed to execute it,
/// *except* for spawning it. This is used by the Bun shell to skip spawning the
/// bun_shim_impl.exe executable. The returned command line is fed into the shell's
/// method for launching a process.
///
/// The cost of spawning is about 5-12ms, and the unicode conversions are way
/// faster than that, so this is a huge win.
#[cfg(not(feature = "shim_standalone"))]
pub fn read_without_launch(context: FromBunShellContext<'_>) -> ReadWithoutLaunchResult {
    debug_assert!(!unsafe {
        core::slice::from_raw_parts(context.base_path, context.base_path_len)
    }
    .starts_with(&NT_OBJECT_PREFIX));
    const _: () = assert!(!IS_STANDALONE);
    // TODO(port): `comptime assert(bun.FeatureFlags.windows_bunx_fast_path)` — wire up FeatureFlags const.
    // TODO(port): the Zig `launcher` body never produces a `.command_line` result for
    // `.read_without_launch` mode; it falls through to the spawn path. Phase B should verify
    // whether the upstream Zig is missing a `mode == .read_without_launch` early-return after
    // building `spawn_command_line` (and should write into `context.buf`, which is currently
    // unused).
    match launcher::<{ LauncherMode::ReadWithoutLaunch }, _>(&context) {
        LauncherRet::Read(r) => r,
        LauncherRet::LaunchFellThrough => unreachable!(),
    }
}

/// Main function for `bun_shim_impl.exe`
#[cfg(feature = "shim_standalone")]
#[inline]
pub fn main() -> ! {
    const _: () = assert!(IS_STANDALONE);
    // TODO(port): `comptime assert(builtin.single_threaded)` / `!link_libc` / `!link_libcpp` —
    // these are build-config assertions; enforce in the standalone crate's Cargo.toml/build.rs.
    launcher::<{ LauncherMode::Launch }, _>(());
    unreachable!();
}

// ───── helpers ─────

/// Zig `std.mem.span` on `[*:0]u16`.
#[inline]
unsafe fn span_u16(p: *const u16) -> &'static [u16] {
    let mut len = 0usize;
    // SAFETY: caller guarantees p is NUL-terminated.
    while unsafe { *p.add(len) } != 0 {
        len += 1;
    }
    unsafe { core::slice::from_raw_parts(p, len) }
}

/// Zig `std.unicode.fmtUtf16Le`.
// TODO(port): provide a proper UTF-16-LE Display adapter in `bun_str`; for now this lossy
// debug-only formatter is sufficient (only used under `if DBG`).
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/windows-shim/bun_shim_impl.zig (972 lines)
//   confidence: medium
//   todos:      14
//   notes:      heavy raw-pointer arithmetic; `is_standalone` mapped to cargo feature `shim_standalone`; `mode.RetType()` collapsed to `LauncherRet` enum; `bun_ctx: anytype` mapped to `BunCtx` trait; `read_without_launch` path appears incomplete upstream (never returns `.command_line`, never uses `context.buf`)
// ──────────────────────────────────────────────────────────────────────────
