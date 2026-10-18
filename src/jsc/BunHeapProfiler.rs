use crate::CrateError as Error;
use bun_core::Output;
use bun_core::String as BunString;
use bun_paths::platform::Auto;
use bun_paths::{AbsPath, AbsPathBuf, PathBuffer, PathZ};
use bun_sys::{self as sys, E, Fd, FdDirExt};

use crate::VM;

pub struct HeapProfilerConfig {
    // The config originates from CLI args and lives until process exit, so
    // `&'static [u8]` matches the ownership exactly.
    pub name: &'static [u8],
    pub dir: &'static [u8],
    pub text_format: bool,
}

// C++ function declarations
unsafe extern "C" {
    // safe: `VM` is an opaque `UnsafeCell`-backed ZST handle; `&mut VM` is ABI-identical
    // to a non-null `*mut VM` and C++ mutation is interior to the opaque cell.
    safe fn Bun__generateHeapProfile(vm: &mut VM) -> BunString;
    safe fn Bun__generateHeapSnapshotV8(vm: &mut VM) -> BunString;
}

pub(crate) fn generate_and_write_profile(
    vm: &mut VM,
    config: &HeapProfilerConfig,
) -> Result<(), Error> {
    let profile_string = if config.text_format {
        Bun__generateHeapProfile(vm)
    } else {
        Bun__generateHeapSnapshotV8(vm)
    };

    if profile_string.is_empty() {
        // No profile data generated
        return Ok(());
    }

    let profile_slice = profile_string.to_utf8();

    let mut path_buf = AbsPathBuf::init_top_level_dir();
    let output_path = build_output_path(&mut path_buf, config)?;

    // Convert to OS-specific path (UTF-16 on Windows, UTF-8 elsewhere)
    #[cfg(windows)]
    let mut path_buf_os = bun_paths::os_path_buffer_pool::get();
    #[cfg(windows)]
    let output_path_os: &bun_core::WStr =
        bun_core::strings::convert_utf8_to_utf16_in_buffer_z(&mut path_buf_os, output_path.slice());

    // Write the profile to disk using bun.sys.File.writeFile
    #[cfg(windows)]
    let result = sys::File::write_file_os_path(Fd::cwd(), output_path_os, profile_slice.slice());
    #[cfg(not(windows))]
    let result = sys::File::write_file(Fd::cwd(), output_path.slice_z(), profile_slice.slice());
    if let Err(err) = result {
        // If we got ENOENT, PERM, or ACCES, try creating the directory and retry
        let errno = err.get_errno();
        if errno == E::ENOENT || errno == E::EPERM || errno == E::EACCES {
            // Derive directory from the absolute output path
            if let Some(dir_path) = output_path.dirname() {
                let _ = Fd::cwd().make_path(dir_path.slice());
                // Retry write
                #[cfg(windows)]
                let retry_result =
                    sys::File::write_file_os_path(Fd::cwd(), output_path_os, profile_slice.slice());
                #[cfg(not(windows))]
                let retry_result =
                    sys::File::write_file(Fd::cwd(), output_path.slice_z(), profile_slice.slice());
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
        bun_core::pretty_errorln!("Heap profile written to: {}", output_path);
        Output::flush();
    }
    Ok(())
}

fn build_output_path<'a>(
    path: &'a mut AbsPathBuf,
    config: &HeapProfilerConfig,
) -> Result<&'a PathZ<AbsPath>, Error> {
    // Generate filename
    let mut filename_buf = bun_paths::path_buffer_pool::get();
    let filename: &[u8] = if !config.name.is_empty() {
        config.name
    } else {
        generate_default_filename(&mut filename_buf, config.text_format)?
    };

    // node accepts absolute --heap-prof-dir/-name
    let path = path.join::<Auto>(config.dir).join::<Auto>(filename);
    Ok(path.as_path()?)
}

fn generate_default_filename(buf: &mut PathBuffer, text_format: bool) -> Result<&[u8], Error> {
    let extension: &str = if text_format { ".md" } else { ".heapprofile" };
    let mut cursor = std::io::Cursor::new(&mut buf[..]);
    crate::bun_cpu_profiler::write_diagnostic_filename(&mut cursor, "Heap", extension)
        .map_err(|_| crate::CrateError::Sys(bun_errno::SystemErrno::ENOSPC))?;
    let written = usize::try_from(cursor.position()).expect("int cast");
    Ok(&buf.as_slice()[..written])
}
