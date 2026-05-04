use core::ffi::c_uint;

use bun_core::{err, Error, Output};
use bun_jsc::VM;
use bun_paths::{self as path, AutoAbsPath, OSPathBuffer, PathBuffer};
use bun_str::{strings, String as BunString, ZStr};
use bun_sys::{self as sys, Fd};

pub struct HeapProfilerConfig {
    // TODO(port): lifetime — borrowed config strings (never freed in Zig); using &'static per Phase-A rule
    pub name: &'static [u8],
    pub dir: &'static [u8],
    pub text_format: bool,
}

// C++ function declarations
// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn Bun__generateHeapProfile(vm: *mut VM) -> BunString;
    fn Bun__generateHeapSnapshotV8(vm: *mut VM) -> BunString;
}

pub fn generate_and_write_profile(vm: &mut VM, config: HeapProfilerConfig) -> Result<(), Error> {
    // TODO(port): narrow error set
    let profile_string = if config.text_format {
        // SAFETY: vm is a valid &mut VM; FFI returns an owned bun_str::String
        unsafe { Bun__generateHeapProfile(vm as *mut VM) }
    } else {
        // SAFETY: vm is a valid &mut VM; FFI returns an owned bun_str::String
        unsafe { Bun__generateHeapSnapshotV8(vm as *mut VM) }
    };
    // `defer profile_string.deref()` — handled by Drop on bun_str::String

    if profile_string.is_empty() {
        // No profile data generated
        return Ok(());
    }

    let profile_slice = profile_string.to_utf8();
    // `defer profile_slice.deinit()` — handled by Drop on Utf8Slice

    // Determine the output path using AutoAbsPath
    let mut path_buf = AutoAbsPath::init_top_level_dir();
    // `defer path_buf.deinit()` — handled by Drop

    build_output_path(&mut path_buf, &config)?;

    // Convert to OS-specific path (UTF-16 on Windows, UTF-8 elsewhere)
    #[cfg(windows)]
    let mut path_buf_os = OSPathBuffer::uninit();
    #[cfg(windows)]
    let output_path_os: &bun_str::WStr =
        strings::convert_utf8_to_utf16_in_buffer_z(&mut path_buf_os, path_buf.slice_z());
    #[cfg(not(windows))]
    let output_path_os: &ZStr = path_buf.slice_z();

    // Write the profile to disk using bun.sys.File.writeFile
    let result = sys::File::write_file(Fd::cwd(), output_path_os, profile_slice.slice());
    if let Err(err) = result {
        // If we got ENOENT, PERM, or ACCES, try creating the directory and retry
        let errno = err.get_errno();
        if errno == sys::Errno::NOENT || errno == sys::Errno::PERM || errno == sys::Errno::ACCES {
            // Derive directory from the absolute output path
            let abs_path = path_buf.slice();
            let dir_path = path::dirname(abs_path, path::Platform::Auto);
            if !dir_path.is_empty() {
                let _ = Fd::cwd().make_path::<u8>(dir_path);
                // Retry write
                let retry_result =
                    sys::File::write_file(Fd::cwd(), output_path_os, profile_slice.slice());
                if retry_result.is_err() {
                    return Err(err!("WriteFailed"));
                }
            } else {
                return Err(err!("WriteFailed"));
            }
        } else {
            return Err(err!("WriteFailed"));
        }
    }

    // Print message to stderr to let user know where the profile was written
    Output::pretty_errorln(format_args!(
        "Heap profile written to: {}",
        bstr::BStr::new(path_buf.slice())
    ));
    Output::flush();
    Ok(())
}

fn build_output_path(path: &mut AutoAbsPath, config: &HeapProfilerConfig) -> Result<(), Error> {
    // Generate filename
    let mut filename_buf = PathBuffer::uninit();
    let filename: &[u8] = if !config.name.is_empty() {
        config.name
    } else {
        generate_default_filename(&mut filename_buf, config.text_format)?
    };

    // Append directory if specified
    if !config.dir.is_empty() {
        path.append(config.dir);
    }

    // Append filename
    path.append(filename);
    Ok(())
}

fn generate_default_filename(buf: &mut PathBuffer, text_format: bool) -> Result<&[u8], Error> {
    // Generate filename like:
    // - Markdown format: Heap.{timestamp}.{pid}.md
    // - V8 format: Heap.{timestamp}.{pid}.heapsnapshot
    let timespec = bun_core::timespec::now(bun_core::timespec::Mode::ForceRealTime);
    // TODO(port): move to bun_sys::getpid() helper
    #[cfg(windows)]
    let pid: c_uint = bun_sys::windows::GetCurrentProcessId();
    #[cfg(not(windows))]
    let pid: core::ffi::c_int = {
        // SAFETY: getpid() is always safe to call
        unsafe { libc::getpid() }
    };

    let epoch_microseconds: u64 = u64::try_from(
        timespec
            .sec
            .wrapping_mul(1_000_000)
            .wrapping_add(timespec.nsec / 1000),
    )
    .unwrap();

    let extension: &str = if text_format { "md" } else { "heapsnapshot" };

    // std.fmt.bufPrint → write into the fixed buffer, return the written slice
    {
        use std::io::Write;
        let buf_slice = buf.as_mut_slice();
        let mut cursor: &mut [u8] = buf_slice;
        let total = cursor.len();
        write!(
            &mut cursor,
            "Heap.{}.{}.{}",
            epoch_microseconds, pid, extension
        )
        .map_err(|_| err!("NoSpaceLeft"))?;
        let remaining = cursor.len();
        let written = total - remaining;
        // PORT NOTE: reshaped for borrowck — recompute slice from buf after dropping cursor borrow
        Ok(&buf.as_slice()[..written])
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/BunHeapProfiler.zig (110 lines)
//   confidence: medium
//   todos:      3
//   notes:      AutoAbsPath/OSPathBuffer/timespec crate paths guessed; HeapProfilerConfig fields use &'static [u8] pending lifetime decision
// ──────────────────────────────────────────────────────────────────────────
