use core::ffi::c_int;
use std::io::Write as _;

use crate::VM;
use bun_core::{OwnedString, String as BunString};
#[cfg(windows)]
use bun_paths::OSPathBuffer;
use bun_paths::PathBuffer;
use bun_sys::{self, Errno, Fd, FdDirExt as _};

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub(crate) enum ProfilerError {
    #[error("WriteFailed")]
    WriteFailed,
    #[error("FilenameTooLong")]
    FilenameTooLong,
}

pub struct CPUProfilerConfig {
    // CLI-arg-backed and
    // process-lifetime, so `&'static` is sound (no struct lifetime params).
    pub name: &'static [u8],
    pub dir: &'static [u8],
    pub md_format: bool,
    pub json_format: bool,
    pub interval: u32,
}

impl Default for CPUProfilerConfig {
    fn default() -> Self {
        Self {
            name: b"",
            dir: b"",
            md_format: false,
            json_format: false,
            interval: 1000,
        }
    }
}

// C++ function declarations
unsafe extern "C" {
    /// `VM` is an opaque `UnsafeCell`-backed ZST handle; `&mut VM` is
    /// ABI-identical to a non-null `VM*`.
    safe fn Bun__startCPUProfiler(vm: &mut VM);
    /// `Option<&mut BunString>` is ABI-identical to a nullable `*mut BunString`
    /// via the guaranteed null-pointer optimization; the C++ side writes a +1
    /// ref into each non-null out-param and ignores nulls.
    safe fn Bun__stopCPUProfiler(
        vm: &mut VM,
        out_json: Option<&mut BunString>,
        out_text: Option<&mut BunString>,
    );
    /// Plain by-value `c_int`; sets a global sampler interval, no pointer invariants.
    safe fn Bun__setSamplingInterval(interval_microseconds: c_int);
}

pub fn set_sampling_interval(interval: u32) {
    Bun__setSamplingInterval(c_int::try_from(interval).expect("int cast"));
}

pub fn start_cpu_profiler(vm: &mut VM) {
    Bun__startCPUProfiler(vm);
}

pub(crate) fn stop_and_write_profile(
    vm: &mut VM,
    config: &CPUProfilerConfig,
) -> Result<(), ProfilerError> {
    let mut json_string = BunString::empty();
    let mut text_string = BunString::empty();

    // Call the unified C++ function with optional out-params for requested formats.
    Bun__stopCPUProfiler(
        vm,
        config.json_format.then_some(&mut json_string),
        config.md_format.then_some(&mut text_string),
    );
    // C++ handed back +1 refs into json_string/text_string. `bun_core::String`
    // is `Copy` (no Drop), so wrap in `OwnedString` for scope-exit `deref()`.
    let json_string = OwnedString::new(json_string);
    let text_string = OwnedString::new(text_string);

    // Write JSON format if requested and not empty
    if config.json_format && !json_string.is_empty() {
        write_profile_to_file(&json_string, config, false)?;
    }

    // Write text format if requested and not empty
    if config.md_format && !text_string.is_empty() {
        write_profile_to_file(&text_string, config, true)?;
    }

    Ok(())
}

fn write_profile_to_file(
    profile_string: &BunString,
    config: &CPUProfilerConfig,
    is_md_format: bool,
) -> Result<(), ProfilerError> {
    let profile_slice = profile_string.to_utf8();
    // (defer profile_slice.deinit() — handled by Drop on Utf8Slice)

    // Determine the output path using AutoAbsPath
    let mut path_buf = bun_paths::AutoAbsPath::init_top_level_dir();
    // (defer path_buf.deinit() — handled by Drop)

    build_output_path(&mut path_buf, config, is_md_format)?;

    // Convert to OS-specific path (UTF-16 on Windows, UTF-8 elsewhere)
    #[cfg(windows)]
    let mut path_buf_os = OSPathBuffer::uninit();
    #[cfg(windows)]
    let output_path_os =
        bun_core::strings::convert_utf8_to_utf16_in_buffer_z(&mut path_buf_os, path_buf.slice_z());
    #[cfg(not(windows))]
    let output_path_os = path_buf.slice_z();

    // Write the profile to disk using bun.sys.File.writeFile
    let result =
        bun_sys::File::write_file_os_path(Fd::cwd(), output_path_os, profile_slice.slice());
    if let Err(err) = result {
        // If we got ENOENT, PERM, or ACCES, try creating the directory and retry
        let errno = err.get_errno();
        if errno == Errno::ENOENT || errno == Errno::EPERM || errno == Errno::EACCES {
            if !config.dir.is_empty() {
                let _ = Fd::cwd().make_path(config.dir);
                // Retry write
                let retry_result = bun_sys::File::write_file_os_path(
                    Fd::cwd(),
                    output_path_os,
                    profile_slice.slice(),
                );
                if retry_result.is_err() {
                    return Err(ProfilerError::WriteFailed);
                }
            } else {
                return Err(ProfilerError::WriteFailed);
            }
        } else {
            return Err(ProfilerError::WriteFailed);
        }
    }

    Ok(())
}

fn build_output_path(
    path: &mut bun_paths::AutoAbsPath,
    config: &CPUProfilerConfig,
    is_md_format: bool,
) -> Result<(), ProfilerError> {
    // Generate filename
    let mut filename_buf = PathBuffer::uninit();

    // If both formats are being written and a custom name was specified,
    // we need to add the appropriate extension to disambiguate
    let has_both_formats = config.md_format && config.json_format;
    let filename: &[u8] = if !config.name.is_empty() {
        'blk: {
            if has_both_formats {
                // Custom name with both formats - append extension based on format
                let ext: &[u8] = if is_md_format { b".md" } else { b".cpuprofile" };
                let mut cursor = std::io::Cursor::new(&mut filename_buf[..]);
                cursor
                    .write_all(config.name)
                    .and_then(|_| cursor.write_all(ext))
                    .map_err(|_| ProfilerError::FilenameTooLong)?;
                let len = usize::try_from(cursor.position()).expect("int cast");
                break 'blk &filename_buf[..len];
            } else {
                break 'blk config.name;
            }
        }
    } else {
        generate_default_filename(&mut filename_buf, is_md_format)?
    };

    // Append directory if specified
    if !config.dir.is_empty() {
        // AutoAbsPath uses CheckLength::ASSUME — Err arm is unreachable.
        // See paths/Path.rs `options::Result` note.
        path.join(&[config.dir]).expect("unreachable");
    }

    // Join filename; `join` resolves an absolute --cpu-prof-name where
    // `append` asserts on it.
    path.join(&[filename]).expect("unreachable");

    Ok(())
}

fn generate_default_filename(
    buf: &mut PathBuffer,
    md_format: bool,
) -> Result<&[u8], ProfilerError> {
    // Node's DiagnosticFilename format (local time, main-thread tid 0, 3-digit
    // per-process sequence): CPU.<yyyymmdd>.<hhmmss>.<pid>.<tid>.<seq>.cpuprofile
    #[cfg(windows)]
    let pid = bun_sys::windows::GetCurrentProcessId();
    #[cfg(not(windows))]
    // SAFETY: getpid() is always safe to call.
    let pid = unsafe { libc::getpid() };

    let (year, month, day, hour, minute, second) = local_time_now();

    static SEQ: core::sync::atomic::AtomicU32 = core::sync::atomic::AtomicU32::new(0);
    let seq = SEQ.fetch_add(1, core::sync::atomic::Ordering::Relaxed) + 1;

    let extension: &str = if md_format { ".md" } else { ".cpuprofile" };

    let mut cursor = std::io::Cursor::new(&mut buf[..]);
    write!(
        cursor,
        "CPU.{year:04}{month:02}{day:02}.{hour:02}{minute:02}{second:02}.{pid}.0.{seq:03}{extension}"
    )
    .map_err(|_| ProfilerError::FilenameTooLong)?;
    let len = usize::try_from(cursor.position()).expect("int cast");
    Ok(&buf[..len])
}

#[cfg(not(windows))]
pub(crate) fn local_time_now() -> (i32, u32, u32, u32, u32, u32) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs()) as libc::time_t;
    let mut tm: libc::tm = unsafe { core::mem::zeroed() };
    // SAFETY: localtime_r only writes into `tm` and is thread-safe.
    unsafe { libc::localtime_r(&secs, &mut tm) };
    (
        tm.tm_year + 1900,
        (tm.tm_mon + 1) as u32,
        tm.tm_mday as u32,
        tm.tm_hour as u32,
        tm.tm_min as u32,
        tm.tm_sec as u32,
    )
}

#[cfg(windows)]
pub(crate) fn local_time_now() -> (i32, u32, u32, u32, u32, u32) {
    #[repr(C)]
    #[derive(Default)]
    struct SystemTime {
        year: u16,
        month: u16,
        day_of_week: u16,
        day: u16,
        hour: u16,
        minute: u16,
        second: u16,
        milliseconds: u16,
    }
    unsafe extern "system" {
        fn GetLocalTime(system_time: *mut SystemTime);
    }
    let mut st = SystemTime::default();
    // SAFETY: GetLocalTime only writes the out-param (kernel32 SYSTEMTIME layout).
    unsafe { GetLocalTime(&mut st) };
    (
        i32::from(st.year),
        u32::from(st.month),
        u32::from(st.day),
        u32::from(st.hour),
        u32::from(st.minute),
        u32::from(st.second),
    )
}
