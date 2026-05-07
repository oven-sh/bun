use bun_core::{err, Error, Output, Timespec, TimespecMockMode};
use bun_paths::{resolve_path, AutoAbsPath, PathBuffer};
use bun_string::String as BunString;
use bun_sys::{self as sys, Fd, FdDirExt, E};

use crate::VM;

pub struct HeapProfilerConfig {
    // PORT NOTE: Zig held borrowed `[]const u8` for the process lifetime; the
    // config originates from CLI args and lives until exit, so `&'static [u8]`
    // matches the ownership exactly.
    pub name: &'static [u8],
    pub dir: &'static [u8],
    pub text_format: bool,
}

// C++ function declarations
unsafe extern "C" {
    fn Bun__generateHeapProfile(vm: *mut VM) -> BunString;
    fn Bun__generateHeapSnapshotV8(vm: *mut VM) -> BunString;
}

pub fn generate_and_write_profile(vm: &mut VM, config: HeapProfilerConfig) -> Result<(), Error> {
    let profile_string = if config.text_format {
        // SAFETY: vm is a valid &mut VM; FFI returns an owned bun_string::String.
        unsafe { Bun__generateHeapProfile(vm as *mut VM) }
    } else {
        // SAFETY: vm is a valid &mut VM; FFI returns an owned bun_string::String.
        unsafe { Bun__generateHeapSnapshotV8(vm as *mut VM) }
    };
    // `defer profile_string.deref()` — handled by Drop on bun_string::String.

    if profile_string.is_empty() {
        // No profile data generated
        return Ok(());
    }

    let profile_slice = profile_string.to_utf8();
    // `defer profile_slice.deinit()` — handled by Drop on ZigStringSlice.

    // Determine the output path using AutoAbsPath
    let mut path_buf = AutoAbsPath::init_top_level_dir();
    // `defer path_buf.deinit()` — handled by Drop.

    build_output_path(&mut path_buf, &config)?;

    // Convert to OS-specific path (UTF-16 on Windows, UTF-8 elsewhere)
    #[cfg(windows)]
    let mut path_buf_os = bun_paths::OSPathBuffer::uninit();
    #[cfg(windows)]
    let output_path_os: &bun_core::WStr = bun_string::strings::convert_utf8_to_utf16_in_buffer_z(
        &mut path_buf_os,
        path_buf.slice_z().as_bytes(),
    );

    // Write the profile to disk using bun.sys.File.writeFile
    // PORT NOTE: reshaped for borrowck — `slice_z()` borrows `path_buf` mutably,
    // so we re-derive it at each call site instead of holding a single binding.
    #[cfg(windows)]
    let result = sys::File::write_file(Fd::cwd(), output_path_os, profile_slice.slice());
    #[cfg(not(windows))]
    let result = sys::File::write_file(Fd::cwd(), path_buf.slice_z(), profile_slice.slice());
    if let Err(err) = result {
        // If we got ENOENT, PERM, or ACCES, try creating the directory and retry
        let errno = err.get_errno();
        if errno == E::ENOENT || errno == E::EPERM || errno == E::EACCES {
            // Derive directory from the absolute output path
            let dir_path =
                resolve_path::dirname::<bun_paths::platform::Auto>(path_buf.slice());
            if !dir_path.is_empty() {
                // PORT NOTE: reshaped for borrowck — `make_path` borrows
                // `dir_path` (tied to `path_buf`); copy into a stack buffer so
                // the retry below can re-borrow `path_buf` mutably.
                let mut dir_buf = PathBuffer::uninit();
                let n = dir_path.len();
                dir_buf.as_mut_slice()[..n].copy_from_slice(dir_path);
                let _ = Fd::cwd().make_path(&dir_buf.as_slice()[..n]);
                // Retry write
                #[cfg(windows)]
                let retry_result =
                    sys::File::write_file(Fd::cwd(), output_path_os, profile_slice.slice());
                #[cfg(not(windows))]
                let retry_result =
                    sys::File::write_file(Fd::cwd(), path_buf.slice_z(), profile_slice.slice());
                if retry_result.is_err() {
                    return Err(err!(WriteFailed));
                }
            } else {
                return Err(err!(WriteFailed));
            }
        } else {
            return Err(err!(WriteFailed));
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
        path.append(config.dir)?;
    }

    // Append filename
    path.append(filename)?;
    Ok(())
}

fn generate_default_filename(buf: &mut PathBuffer, text_format: bool) -> Result<&[u8], Error> {
    // Generate filename like:
    // - Markdown format: Heap.{timestamp}.{pid}.md
    // - V8 format: Heap.{timestamp}.{pid}.heapsnapshot
    let timespec = Timespec::now(TimespecMockMode::ForceRealTime);
    #[cfg(windows)]
    let pid: core::ffi::c_uint = bun_sys::windows::GetCurrentProcessId();
    #[cfg(not(windows))]
    // SAFETY: getpid() is always safe to call.
    let pid: core::ffi::c_int = unsafe { libc::getpid() };

    let epoch_microseconds: u64 = u64::try_from(
        timespec
            .sec
            .wrapping_mul(1_000_000)
            .wrapping_add(timespec.nsec / 1000),
    )
    .unwrap();

    let extension: &str = if text_format { "md" } else { "heapsnapshot" };

    // std.fmt.bufPrint → write into the fixed buffer, return the written slice
    use std::io::Write;
    let buf_slice = buf.as_mut_slice();
    let total = buf_slice.len();
    let mut cursor: &mut [u8] = buf_slice;
    write!(
        &mut cursor,
        "Heap.{}.{}.{}",
        epoch_microseconds, pid, extension
    )
    .map_err(|_| err!(NoSpaceLeft))?;
    let remaining = cursor.len();
    let written = total - remaining;
    // PORT NOTE: reshaped for borrowck — recompute slice from buf after dropping cursor borrow.
    Ok(&buf.as_slice()[..written])
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/BunHeapProfiler.zig (110 lines)
//   confidence: high
// ──────────────────────────────────────────────────────────────────────────
