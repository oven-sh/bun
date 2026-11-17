use core::ffi::c_int;

use crate::VM;
use bun_core::String as BunString;
use bun_paths::{NameTooLong, OsPath, Path};
use bun_sys::{self, Errno, Fd};

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub(crate) enum ProfilerError {
    #[error("WriteFailed")]
    WriteFailed,
    #[error("FilenameTooLong")]
    FilenameTooLong,
}

impl From<NameTooLong> for ProfilerError {
    fn from(_: NameTooLong) -> Self {
        Self::FilenameTooLong
    }
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
    /// `VM` is an opaque `UnsafeCell`-backed ZST handle; `&VM` is
    /// ABI-identical to a non-null `VM*`.
    safe fn Bun__startCPUProfiler(vm: &VM);
    /// `Option<&mut BunString>` is ABI-identical to a nullable `*mut BunString`
    /// via the guaranteed null-pointer optimization; the C++ side writes a +1
    /// ref into each non-null out-param and ignores nulls.
    safe fn Bun__stopCPUProfiler(
        vm: &VM,
        out_json: Option<&mut BunString>,
        out_text: Option<&mut BunString>,
    );
    /// Plain by-value `c_int`; sets a global sampler interval, no pointer invariants.
    safe fn Bun__setSamplingInterval(interval_microseconds: c_int);
    /// Writes a +1 ref into `out`. Doesn't write to `out` if the VM has no sampling profiler.
    safe fn Bun__SamplingProfiler__report(vm: &VM, out: &mut BunString);
}

pub fn set_sampling_interval(interval: u32) {
    // Reachable from a Worker's execArgv: 0 stalls the sampler and the process
    // never exits, and a value past c_int would panic the cast.
    let clamped = interval.clamp(1, c_int::MAX as u32);
    Bun__setSamplingInterval(clamped as c_int);
}

pub fn start_cpu_profiler(vm: &VM) {
    Bun__startCPUProfiler(vm);
}

/// Writes `vm`'s sampling profiler report into `directory` (absolute UTF-8), creating it if missing.
pub(crate) fn write_sampling_profiler_report(
    vm: &VM,
    directory: &[u8],
) -> Result<(), ProfilerError> {
    let mut report = BunString::EMPTY;
    Bun__SamplingProfiler__report(vm, &mut report);
    if report.is_empty() {
        return Ok(());
    }
    let report = report.to_utf8();

    let path = output_path(directory, b"", "SamplingProfile", ".txt")?;

    write_file_creating_dir(&path, report.slice()).map_err(|_| ProfilerError::WriteFailed)
}

pub(crate) fn stop_and_write_profile(
    vm: &VM,
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

    let extension = if is_md_format { ".md" } else { ".cpuprofile" };
    let is_name_shared = !config.name.is_empty() && config.md_format && config.json_format;
    let name: &[u8] = match is_name_shared {
        true => &[config.name, extension.as_bytes()].concat(),
        false => config.name,
    };
    let path = output_path(config.dir, name, "CPU", extension)?;

    write_file_creating_dir(&path, profile_slice.slice()).map_err(|_| ProfilerError::WriteFailed)
}

/// Writes `contents` to `path`. On ENOENT, EPERM or EACCES it creates the directory and retries once.
pub(crate) fn write_file_creating_dir(path: &OsPath, contents: &[u8]) -> bun_sys::Maybe<()> {
    let write = || bun_sys::File::write_file_os_path(Fd::cwd(), path, contents);
    write().or_else(|err| match (err.get_errno(), path.dirname()) {
        (Errno::ENOENT | Errno::EPERM | Errno::EACCES, Some(dir)) => {
            let _ = bun_sys::Dir::cwd().make_path(&Path::from(dir));
            write()
        }
        _ => Err(err),
    })
}

/// `dir` and `name` can be empty. As in Node, they can be absolute and a `\` is only a separator on Windows.
pub(crate) fn output_path(
    dir: &[u8],
    name: &[u8],
    default_prefix: &str,
    default_extension: &str,
) -> Result<OsPath, NameTooLong> {
    let mut path = OsPath::top_level_dir()?;
    path.resolve(&[dir, name])?;
    path.trim_trailing_sep();
    if name.is_empty() {
        push_diagnostic_filename(&mut path, default_prefix, default_extension)?;
    }
    Ok(path)
}

/// Node's DiagnosticFilename: `<prefix>.<yyyymmdd>.<hhmmss>.<pid>.<tid>.<seq><extension>`.
/// https://github.com/nodejs/node/blob/main/src/util.cc (MakeFilename)
fn push_diagnostic_filename(
    path: &mut OsPath,
    prefix: &str,
    extension: &str,
) -> Result<(), NameTooLong> {
    let pid = std::process::id();

    let (year, month, day, hour, minute, second) = local_time_now();

    static SEQ: core::sync::atomic::AtomicU32 = core::sync::atomic::AtomicU32::new(0);
    let seq = SEQ.fetch_add(1, core::sync::atomic::Ordering::Relaxed) + 1;

    path.push_fmt(format_args!(
        "{prefix}.{year:04}{month:02}{day:02}.{hour:02}{minute:02}{second:02}.{pid}.0.{seq:03}{extension}"
    ))
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
    let mut st = bun_sys::windows::SYSTEMTIME::default();
    bun_sys::windows::kernel32::GetLocalTime(&mut st);
    (
        i32::from(st.wYear),
        u32::from(st.wMonth),
        u32::from(st.wDay),
        u32::from(st.wHour),
        u32::from(st.wMinute),
        u32::from(st.wSecond),
    )
}
