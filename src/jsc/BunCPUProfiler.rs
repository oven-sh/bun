use core::ffi::c_int;
use std::io::Write as _;

use bun_jsc::VM;
use bun_paths::{OSPathBuffer, PathBuffer};
use bun_str::String as BunString;
use bun_sys::{self, Errno, Fd};

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ProfilerError {
    #[error("WriteFailed")]
    WriteFailed,
    #[error("FilenameTooLong")]
    FilenameTooLong,
}
impl From<ProfilerError> for bun_core::Error {
    fn from(e: ProfilerError) -> Self {
        bun_core::Error::from_static_str(<&'static str>::from(e))
    }
}

pub struct CPUProfilerConfig {
    // TODO(port): lifetime — these are borrowed slices in Zig (never freed here);
    // using &'static for Phase A per PORTING.md (no struct lifetime params).
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
// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn Bun__startCPUProfiler(vm: *mut VM);
    fn Bun__stopCPUProfiler(vm: *mut VM, out_json: *mut BunString, out_text: *mut BunString);
    fn Bun__setSamplingInterval(interval_microseconds: c_int);
}

pub fn set_sampling_interval(interval: u32) {
    // SAFETY: FFI call with plain integer; no invariants beyond C++ side.
    unsafe { Bun__setSamplingInterval(c_int::try_from(interval).unwrap()) };
}

pub fn start_cpu_profiler(vm: &VM) {
    // SAFETY: vm is a valid borrowed VM reference for the duration of the call.
    unsafe { Bun__startCPUProfiler(vm as *const VM as *mut VM) };
}

pub fn stop_and_write_profile(vm: &VM, config: &CPUProfilerConfig) -> Result<(), ProfilerError> {
    // TODO(port): narrow error set
    let mut json_string = BunString::empty();
    let mut text_string = BunString::empty();

    // Call the unified C++ function with pointers for requested formats
    // SAFETY: vm is valid; out pointers are either valid &mut BunString or null.
    unsafe {
        Bun__stopCPUProfiler(
            vm as *const VM as *mut VM,
            if config.json_format { &mut json_string as *mut BunString } else { core::ptr::null_mut() },
            if config.md_format { &mut text_string as *mut BunString } else { core::ptr::null_mut() },
        );
    }
    // (defer json_string.deref() / text_string.deref() — handled by Drop on bun_str::String)

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
        bun_str::strings::convert_utf8_to_utf16_in_buffer_z(&mut path_buf_os, path_buf.slice_z());
    #[cfg(not(windows))]
    let output_path_os = path_buf.slice_z();
    #[cfg(not(windows))]
    let _ = OSPathBuffer::uninit; // suppress unused-import on posix; TODO(port): cleanup

    // Write the profile to disk using bun.sys.File.writeFile
    let result = bun_sys::File::write_file(Fd::cwd(), output_path_os, profile_slice.slice());
    if let Err(err) = result {
        // If we got ENOENT, PERM, or ACCES, try creating the directory and retry
        let errno = err.get_errno();
        if errno == Errno::NOENT || errno == Errno::PERM || errno == Errno::ACCES {
            if !config.dir.is_empty() {
                let _ = Fd::cwd().make_path(config.dir);
                // Retry write
                let retry_result =
                    bun_sys::File::write_file(Fd::cwd(), output_path_os, profile_slice.slice());
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
                let len = usize::try_from(cursor.position()).unwrap();
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
        path.join(&[config.dir]);
    }

    // Append filename
    path.append(filename);

    Ok(())
}

fn generate_default_filename(
    buf: &mut PathBuffer,
    md_format: bool,
) -> Result<&[u8], ProfilerError> {
    // Generate filename like: CPU.{timestamp}.{pid}.cpuprofile (or .md for markdown format)
    // Use microsecond timestamp for uniqueness
    // TODO(port): verify bun_core::Timespec::now API name/signature
    let timespec = bun_core::Timespec::now(bun_core::TimespecClock::ForceRealTime);
    #[cfg(windows)]
    let pid = bun_sys::windows::GetCurrentProcessId();
    #[cfg(not(windows))]
    // SAFETY: getpid() is always safe to call.
    let pid = unsafe { libc::getpid() };

    let epoch_microseconds: u64 = u64::try_from(
        timespec
            .sec
            .wrapping_mul(1_000_000)
            .wrapping_add(timespec.nsec / 1000),
    )
    .unwrap();

    let extension: &str = if md_format { ".md" } else { ".cpuprofile" };

    let mut cursor = std::io::Cursor::new(&mut buf[..]);
    write!(cursor, "CPU.{}.{}{}", epoch_microseconds, pid, extension)
        .map_err(|_| ProfilerError::FilenameTooLong)?;
    let len = usize::try_from(cursor.position()).unwrap();
    Ok(&buf[..len])
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/BunCPUProfiler.zig (134 lines)
//   confidence: medium
//   todos:      4
//   notes:      AutoAbsPath/Timespec crate paths guessed; CPUProfilerConfig slice fields use &'static pending lifetime decision
// ──────────────────────────────────────────────────────────────────────────
