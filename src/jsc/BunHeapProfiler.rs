use crate::CrateError as Error;
use bun_core::Output;
use bun_core::String as BunString;
use bun_paths::{AutoAbsPathChecked, PathBuffer};
use bun_sys as sys;

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
    /// Writes a +1 ref of the V8 snapshot JSON into `out` and returns true.
    /// Returns false, and leaves `out` alone, when the snapshot is too large
    /// to serialize.
    safe fn Bun__generateHeapSnapshotV8(vm: &mut VM, out: &mut BunString) -> bool;
}

pub(crate) fn generate_and_write_profile(
    vm: &mut VM,
    config: &HeapProfilerConfig,
) -> Result<(), Error> {
    // dir/name are unbounded CLI input, so use the length-checked variant.
    let mut path_buf = AutoAbsPathChecked::init_top_level_dir();
    build_output_path(&mut path_buf, config)?;

    let profile_string = if config.text_format {
        Bun__generateHeapProfile(vm)
    } else {
        let mut snapshot = BunString::EMPTY;
        if !Bun__generateHeapSnapshotV8(vm, &mut snapshot) {
            return Err(Error::HeapSnapshotTooLarge);
        }
        snapshot
    };
    let profile_slice = profile_string.to_utf8();

    // The output file is created only once there is a profile to put in it.
    sys::File::make_open(
        path_buf.slice(),
        sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
        0o664,
    )
    .and_then(|file| file.write_all(profile_slice.slice()))
    .map_err(|_| Error::WriteFailed)?;

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

fn build_output_path(
    path: &mut AutoAbsPathChecked,
    config: &HeapProfilerConfig,
) -> Result<(), Error> {
    // Generate filename
    let mut filename_buf = bun_paths::path_buffer_pool::get();
    let filename: &[u8] = if !config.name.is_empty() {
        config.name
    } else {
        generate_default_filename(&mut filename_buf, config.text_format)?
    };

    // Join directory and filename; `join` resolves absolute segments where
    // `append` asserts on them (node accepts absolute --heap-prof-dir/-name).
    if !config.dir.is_empty() {
        path.join(&[config.dir])?;
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
