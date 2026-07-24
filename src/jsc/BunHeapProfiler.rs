use crate::CrateError as Error;
use bun_core::Output;
use bun_core::WTFStringImplExt as _;
use bun_core::{OwnedString, String as BunString};
use bun_paths::{AutoAbsPath, PathBuffer, resolve_path};
use bun_sys::{self as sys, E, Fd, FdDirExt};

use crate::VM;

#[derive(Clone)]
pub struct HeapProfilerConfig {
    // Owned copies: the main thread's config comes from process-lifetime CLI
    // args, but a Worker's comes from its `execArgv` (worker lifetime).
    pub name: Box<[u8]>,
    pub dir: Box<[u8]>,
    pub text_format: bool,
}

/// Scan a Worker's `execArgv` for the `--heap-prof` flag family. Returns a
/// config only when `--heap-prof` itself is present; `--heap-prof-interval`
/// is accepted-and-ignored like the CLI (see Arguments.rs).
///
/// # Safety
/// Each `WTFStringImpl` in `exec_argv` must be a live WTF string.
pub unsafe fn parse_worker_exec_argv(
    exec_argv: &[bun_core::WTFStringImpl],
) -> Option<HeapProfilerConfig> {
    let mut enabled = false;
    let mut name: Box<[u8]> = Box::default();
    let mut dir: Box<[u8]> = Box::default();

    let mut i = 0;
    while i < exec_argv.len() {
        let arg = exec_argv[i];
        i += 1;
        if arg.is_null() {
            continue;
        }
        // SAFETY: per fn contract — `arg` is a live `WTFStringImpl*`.
        let owned = unsafe { &*arg }.to_owned_slice_z();
        let bytes = owned.as_bytes();
        // First non-flag token ends parsing (same short-circuit as
        // `parse_worker_exec_argv_allow_addons`).
        if bytes.first() != Some(&b'-') {
            break;
        }
        if bytes == b"--" {
            break;
        }
        if bytes == b"--heap-prof" {
            enabled = true;
            continue;
        }
        // Value flags accept both `--flag value` and `--flag=value`.
        let mut take_value = |flag: &[u8]| -> Option<Box<[u8]>> {
            if bytes == flag {
                let value = exec_argv.get(i).copied()?;
                i += 1;
                if value.is_null() {
                    return None;
                }
                // SAFETY: per fn contract — a live `WTFStringImpl*`.
                return Some(unsafe { &*value }.to_owned_slice_z().as_bytes().into());
            }
            if bytes.strip_prefix(flag).and_then(<[u8]>::first) == Some(&b'=') {
                return Some(bytes[flag.len() + 1..].into());
            }
            None
        };
        if let Some(value) = take_value(b"--heap-prof-name") {
            name = value;
        } else if let Some(value) = take_value(b"--heap-prof-dir") {
            dir = value;
        } else {
            let _ = take_value(b"--heap-prof-interval");
        }
    }

    enabled.then(|| HeapProfilerConfig {
        name,
        dir,
        text_format: false,
    })
}

// C++ function declarations
unsafe extern "C" {
    // safe: `VM` is an opaque `UnsafeCell`-backed ZST handle; `&mut VM` is ABI-identical
    // to a non-null `*mut VM` and C++ mutation is interior to the opaque cell.
    safe fn Bun__generateHeapProfile(vm: &mut VM) -> BunString;
    safe fn Bun__generateHeapSamplingProfile(vm: &mut VM) -> BunString;
    safe fn Bun__startHeapProfiler(vm: &mut VM);
}

/// Start the sampling profiler that backs the `--heap-prof` `.heapprofile`
/// output. No-op if `--cpu-prof` already started it on this thread.
pub fn start_heap_profiler(vm: &mut VM) {
    Bun__startHeapProfiler(vm);
}

pub fn generate_and_write_profile(vm: &mut VM, config: &HeapProfilerConfig) -> Result<(), Error> {
    // `defer profile_string.deref()` — `bun_core::String` is `Copy` (no Drop);
    // wrap the +1 ref from C++ in `OwnedString` so it's released on every exit path.
    let profile_string = OwnedString::new(if config.text_format {
        Bun__generateHeapProfile(vm)
    } else {
        // Node's `--heap-prof` writes a V8 sampling heap profile
        // ({head, samples}), not a heap snapshot.
        Bun__generateHeapSamplingProfile(vm)
    });

    if profile_string.is_empty() {
        // No profile data generated
        return Ok(());
    }

    // Freed by Drop on ZigStringSlice.
    let profile_slice = profile_string.to_utf8();

    // Determine the output path using AutoAbsPath
    let mut path_buf = AutoAbsPath::init_top_level_dir();
    // `defer path_buf.deinit()` — handled by Drop.

    build_output_path(&mut path_buf, config)?;

    // Convert to OS-specific path (UTF-16 on Windows, UTF-8 elsewhere)
    #[cfg(windows)]
    let mut path_buf_os = bun_paths::OSPathBuffer::uninit();
    #[cfg(windows)]
    let output_path_os: &bun_core::WStr = bun_core::strings::convert_utf8_to_utf16_in_buffer_z(
        &mut path_buf_os,
        path_buf.slice_z().as_bytes(),
    );

    // Write the profile to disk using bun.sys.File.writeFile
    // `slice_z()` borrows `path_buf` mutably, so we re-derive it at each call
    // site instead of holding a single binding.
    #[cfg(windows)]
    let result = sys::File::write_file_os_path(Fd::cwd(), output_path_os, profile_slice.slice());
    #[cfg(not(windows))]
    let result = sys::File::write_file(Fd::cwd(), path_buf.slice_z(), profile_slice.slice());
    if let Err(err) = result {
        // If we got ENOENT, PERM, or ACCES, try creating the directory and retry
        let errno = err.get_errno();
        if errno == E::ENOENT || errno == E::EPERM || errno == E::EACCES {
            // Derive directory from the absolute output path
            let dir_path = resolve_path::dirname::<bun_paths::platform::Auto>(path_buf.slice());
            if !dir_path.is_empty() {
                let _ = Fd::cwd().make_path(dir_path);
                // Retry write
                #[cfg(windows)]
                let retry_result =
                    sys::File::write_file_os_path(Fd::cwd(), output_path_os, profile_slice.slice());
                #[cfg(not(windows))]
                let retry_result =
                    sys::File::write_file(Fd::cwd(), path_buf.slice_z(), profile_slice.slice());
                if retry_result.is_err() {
                    return Err(crate::CrateError::WriteFailed);
                }
            } else {
                return Err(crate::CrateError::WriteFailed);
            }
        } else {
            return Err(crate::CrateError::WriteFailed);
        }
    }

    // Print where the markdown profile was written; node parity for the
    // .heapprofile format is silence on success.
    if config.text_format {
        bun_core::pretty_errorln!(
            "Heap profile written to: {}",
            bstr::BStr::new(path_buf.slice())
        );
        Output::flush();
    }
    Ok(())
}

fn build_output_path(path: &mut AutoAbsPath, config: &HeapProfilerConfig) -> Result<(), Error> {
    // Generate filename
    let mut filename_buf = PathBuffer::uninit();
    let filename: &[u8] = if !config.name.is_empty() {
        &config.name
    } else {
        generate_default_filename(&mut filename_buf, config.text_format)?
    };

    // Join directory and filename; `join` resolves absolute segments where
    // `append` asserts on them (node accepts absolute --heap-prof-dir/-name).
    if !config.dir.is_empty() {
        path.join(&[&config.dir])?;
    }
    path.join(&[filename])?;
    Ok(())
}

fn generate_default_filename(buf: &mut PathBuffer, text_format: bool) -> Result<&[u8], Error> {
    let extension: &str = if text_format { ".md" } else { ".heapprofile" };
    let mut cursor = std::io::Cursor::new(&mut buf[..]);
    crate::bun_cpu_profiler::write_diagnostic_filename(&mut cursor, "Heap", extension)
        .map_err(|_| crate::CrateError::Sys(bun_errno::SystemErrno::ENOSPC))?;
    let written = usize::try_from(cursor.position()).expect("int cast");
    Ok(&buf.as_slice()[..written])
}
