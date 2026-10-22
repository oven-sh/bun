use core::ffi::c_int;
use core::sync::atomic::{AtomicU32, Ordering};
use std::io::Write as _;

use crate::{CallFrame, GregorianDateTime, JSGlobalObject, JSValue, JsResult, VM};
use bun_core::String as BunString;
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
    /// Numbers of the default-named files, 0 when `--cpu-prof-name` names the file.
    json_sequence: u32,
    md_sequence: u32,
}

impl CPUProfilerConfig {
    /// Draws the numbers of the default-named files now, as node does when its profiler starts.
    pub fn new(
        name: &'static [u8],
        dir: &'static [u8],
        md_format: bool,
        json_format: bool,
        interval: u32,
    ) -> Self {
        let default_named = name.is_empty();
        Self {
            name,
            dir,
            md_format,
            json_format,
            interval,
            json_sequence: if default_named && json_format {
                next_sequence()
            } else {
                0
            },
            md_sequence: if default_named && md_format {
                next_sequence()
            } else {
                0
            },
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
    /// Writes a +1 ref into `out`. Doesn't write to `out` if the VM has no sampling profiler.
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

    let mut filename_buf = bun_paths::path_buffer_pool::get();
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

/// Writes `contents` to `path`. On ENOENT, EPERM or EACCES it creates `dir` and retries once.
fn write_file_creating_dir(
    path: &mut AutoAbsPathChecked,
    dir: &[u8],
    contents: &[u8],
) -> Result<(), ProfilerError> {
    // Convert to OS-specific path (UTF-16 on Windows, UTF-8 elsewhere)
    #[cfg(windows)]
    let mut path_buf_os = bun_paths::os_path_buffer_pool::get();
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
    let mut filename_buf = bun_paths::path_buffer_pool::get();

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
        generate_default_filename(&mut filename_buf, config, is_md_format)?
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

fn generate_default_filename<'a>(
    buf: &'a mut PathBuffer,
    config: &CPUProfilerConfig,
    md_format: bool,
) -> Result<&'a [u8], ProfilerError> {
    let (extension, sequence) = if md_format {
        (".md", config.md_sequence)
    } else {
        (".cpuprofile", config.json_sequence)
    };
    let mut cursor = std::io::Cursor::new(&mut buf[..]);
    write_diagnostic_filename(&mut cursor, "CPU", extension, 0, local_time_now(), sequence)
        .map_err(|_| ProfilerError::FilenameTooLong)?;
    let len = usize::try_from(cursor.position()).expect("int cast");
    Ok(&buf[..len])
}

/// Node's `seq`: https://github.com/nodejs/node/blob/v26.3.0/src/util.cc#L59
static SEQUENCE: AtomicU32 = AtomicU32::new(0);

pub(crate) fn next_sequence() -> u32 {
    // Relaxed: the numbers only have to be distinct.
    SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1
}

/// Node's DiagnosticFilename: `<prefix>.<yyyymmdd>.<hhmmss>.<pid>.<tid>.<seq><extension>`.
/// https://github.com/nodejs/node/blob/v26.3.0/src/util.cc#L239-L281 (MakeFilename)
pub(crate) fn write_diagnostic_filename(
    cursor: &mut dyn std::io::Write,
    prefix: &str,
    extension: &str,
    thread_id: u32,
    time: GregorianDateTime,
    sequence: u32,
) -> std::io::Result<()> {
    #[cfg(windows)]
    let pid = bun_sys::windows::GetCurrentProcessId();
    #[cfg(not(windows))]
    // SAFETY: getpid() is always safe to call.
    let pid = unsafe { libc::getpid() };

    let GregorianDateTime {
        year,
        month,
        day,
        hour,
        minute,
        second,
        ..
    } = time;

    write!(
        cursor,
        "{prefix}.{year:04}{month:02}{day:02}.{hour:02}{minute:02}{second:02}.{pid}.{thread_id}.{sequence:03}{extension}"
    )
}

/// The local time the OS reports, which is what node's `MakeFilename` reads.
#[cfg(not(windows))]
pub(crate) fn local_time_now() -> GregorianDateTime {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs()) as libc::time_t;
    let mut tm: libc::tm = bun_core::ffi::zeroed();
    // SAFETY: localtime_r only writes into `tm` and is thread-safe.
    unsafe { libc::localtime_r(&raw const secs, &raw mut tm) };
    GregorianDateTime {
        year: tm.tm_year + 1900,
        month: tm.tm_mon + 1,
        day: tm.tm_mday,
        hour: tm.tm_hour,
        minute: tm.tm_min,
        second: tm.tm_sec,
        weekday: tm.tm_wday,
    }
}

#[cfg(windows)]
pub(crate) fn local_time_now() -> GregorianDateTime {
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
    GregorianDateTime {
        year: i32::from(st.year),
        month: i32::from(st.month),
        day: i32::from(st.day),
        hour: i32::from(st.hour),
        minute: i32::from(st.minute),
        second: i32::from(st.second),
        weekday: i32::from(st.day_of_week),
    }
}

/// The default name of `v8.writeHeapSnapshot()`: https://github.com/nodejs/node/blob/v26.3.0/src/heap_utils.cc#L461-L462
pub fn js_heap_snapshot_filename(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let thread_id = global
        .bun_vm()
        .worker_ref()
        .map_or(0, |worker| worker.thread_id());
    // The DateCache is the zone `Date` uses. Unlike libc, it follows `process.env.TZ`.
    let time = global.ms_to_gregorian_date_time(bun_core::time::milli_timestamp() as f64);

    // Every field is a 32-bit integer, so the name is at most 119 bytes.
    let mut name = [0u8; 128];
    let mut cursor = std::io::Cursor::new(&mut name[..]);
    write_diagnostic_filename(
        &mut cursor,
        "Heap",
        ".heapsnapshot",
        thread_id,
        time,
        next_sequence(),
    )
    .expect("a heap snapshot name fits in 128 bytes");
    let len = usize::try_from(cursor.position()).expect("int cast");
    crate::bun_string_jsc::create_utf8_for_js(global, &name[..len])
}
