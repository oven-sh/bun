use core::ffi::c_int;
use std::io::Write as _;

use crate::VM;
use bun_core::String as BunString;
#[cfg(windows)]
use bun_paths::OSPathBuffer;
use bun_paths::{AutoAbsPathChecked, PathBuffer};
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
    /// Writes a +1 ref into `out`; leaves it empty when the VM has no sampling profiler.
    safe fn Bun__SamplingProfiler__report(vm: &mut VM, out: &mut BunString);
}

pub fn set_sampling_interval(interval: u32) {
    // Reachable from a Worker's execArgv: 0 stalls the sampler and the process
    // never exits, and a value past c_int would panic the cast.
    let clamped = interval.clamp(1, c_int::MAX as u32);
    Bun__setSamplingInterval(clamped as c_int);
}

pub fn start_cpu_profiler(vm: &mut VM) {
    Bun__startCPUProfiler(vm);
}

/// Writes `vm`'s sampling profiler report into `directory` (absolute UTF-8), creating it if missing.
pub(crate) fn write_sampling_profiler_report(
    vm: &mut VM,
    directory: &[u8],
) -> Result<(), ProfilerError> {
    let mut report = BunString::EMPTY;
    Bun__SamplingProfiler__report(vm, &mut report);
    if report.is_empty() {
        return Ok(());
    }
    let report = report.to_utf8();

    let mut filename_buf = PathBuffer::uninit();
    let filename = {
        let mut cursor = std::io::Cursor::new(&mut filename_buf[..]);
        write_diagnostic_filename(&mut cursor, "SamplingProfile", ".txt")
            .map_err(|_| ProfilerError::FilenameTooLong)?;
        let len = usize::try_from(cursor.position()).expect("int cast");
        &filename_buf[..len]
    };

    let mut path_buf = AutoAbsPathChecked::init_top_level_dir();
    path_buf
        .join(&[directory, filename])
        .map_err(|_| ProfilerError::FilenameTooLong)?;

    write_file_creating_dir(&mut path_buf, directory, report.slice())
}

pub(crate) fn stop_and_write_profile(
    vm: &mut VM,
    config: &CPUProfilerConfig,
) -> Result<(), ProfilerError> {
    let mut json_string = BunString::EMPTY;
    let mut text_string = BunString::EMPTY;

    // Call the unified C++ function with optional out-params for requested formats.
    Bun__stopCPUProfiler(
        vm,
        config.json_format.then_some(&mut json_string),
        config.md_format.then_some(&mut text_string),
    );
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

    // dir/name are unbounded CLI input, so use the length-checked variant.
    let mut path_buf = AutoAbsPathChecked::init_top_level_dir();
    // (defer path_buf.deinit() — handled by Drop)

    build_output_path(&mut path_buf, config, is_md_format)?;

    write_file_creating_dir(&mut path_buf, config.dir, profile_slice.slice())
}

/// Writes `contents` to `path`; on ENOENT/EPERM/EACCES creates `dir` and retries once.
fn write_file_creating_dir(
    path: &mut AutoAbsPathChecked,
    dir: &[u8],
    contents: &[u8],
) -> Result<(), ProfilerError> {
    // Convert to OS-specific path (UTF-16 on Windows, UTF-8 elsewhere)
    #[cfg(windows)]
    let mut path_buf_os = OSPathBuffer::uninit();
    #[cfg(windows)]
    let output_path_os =
        bun_core::strings::convert_utf8_to_utf16_in_buffer_z(&mut path_buf_os, path.slice_z());
    #[cfg(not(windows))]
    let output_path_os = path.slice_z();

    // Write the profile to disk using bun.sys.File.writeFile
    let result = bun_sys::File::write_file_os_path(Fd::cwd(), output_path_os, contents);
    if let Err(err) = result {
        // If we got ENOENT, PERM, or ACCES, try creating the directory and retry
        let errno = err.get_errno();
        if errno == Errno::ENOENT || errno == Errno::EPERM || errno == Errno::EACCES {
            if !dir.is_empty() {
                let _ = Fd::cwd().make_path(dir);
                // Retry write
                let retry_result =
                    bun_sys::File::write_file_os_path(Fd::cwd(), output_path_os, contents);
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
    path: &mut AutoAbsPathChecked,
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

    if !config.dir.is_empty() {
        path.join(&[config.dir])
            .map_err(|_| ProfilerError::FilenameTooLong)?;
    }

    // `join` resolves an absolute --cpu-prof-name where `append` asserts on it.
    path.join(&[filename])
        .map_err(|_| ProfilerError::FilenameTooLong)?;

    Ok(())
}

fn generate_default_filename(
    buf: &mut PathBuffer,
    md_format: bool,
) -> Result<&[u8], ProfilerError> {
    let extension: &str = if md_format { ".md" } else { ".cpuprofile" };
    let mut cursor = std::io::Cursor::new(&mut buf[..]);
    write_diagnostic_filename(&mut cursor, "CPU", extension)
        .map_err(|_| ProfilerError::FilenameTooLong)?;
    let len = usize::try_from(cursor.position()).expect("int cast");
    Ok(&buf[..len])
}

/// Node's DiagnosticFilename: `<prefix>.<yyyymmdd>.<hhmmss>.<pid>.<tid>.<seq><extension>`.
/// https://github.com/nodejs/node/blob/main/src/util.cc (MakeFilename)
pub(crate) fn write_diagnostic_filename(
    cursor: &mut dyn std::io::Write,
    prefix: &str,
    extension: &str,
) -> std::io::Result<()> {
    #[cfg(windows)]
    let pid = bun_sys::windows::GetCurrentProcessId();
    #[cfg(not(windows))]
    // SAFETY: getpid() is always safe to call.
    let pid = unsafe { libc::getpid() };

    let (year, month, day, hour, minute, second) = local_time_now();

    static SEQ: core::sync::atomic::AtomicU32 = core::sync::atomic::AtomicU32::new(0);
    let seq = SEQ.fetch_add(1, core::sync::atomic::Ordering::Relaxed) + 1;

    write!(
        cursor,
        "{prefix}.{year:04}{month:02}{day:02}.{hour:02}{minute:02}{second:02}.{pid}.0.{seq:03}{extension}"
    )
}

#[cfg(not(windows))]
pub(crate) fn local_time_now() -> (i32, u32, u32, u32, u32, u32) {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs()) as libc::time_t;
    let mut tm: libc::tm = bun_core::ffi::zeroed();
    // SAFETY: localtime_r only writes into `tm` and is thread-safe.
    unsafe { libc::localtime_r(&raw const secs, &raw mut tm) };
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
