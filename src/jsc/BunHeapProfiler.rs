use bun_core::Output;
use bun_core::String as BunString;
use bun_paths::{AutoAbsPathChecked, PathBuffer};

use crate::VM;
use crate::bun_cpu_profiler::{ProfilerError, write_profile_file};

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
) -> Result<(), ProfilerError> {
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

    // dir/name are unbounded CLI input, so use the length-checked variant.
    let mut path_buf = AutoAbsPathChecked::init_top_level_dir();
    // `defer path_buf.deinit()` — handled by Drop.

    build_output_path(&mut path_buf, config)?;

    write_profile_file(path_buf.slice_z(), profile_slice.slice())?;

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
) -> Result<(), ProfilerError> {
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
        path.join(&[config.dir])
            .map_err(|_| ProfilerError::FilenameTooLong)?;
    }
    path.join(&[filename])
        .map_err(|_| ProfilerError::FilenameTooLong)?;
    Ok(())
}

fn generate_default_filename(
    buf: &mut PathBuffer,
    text_format: bool,
) -> Result<&[u8], ProfilerError> {
    let extension: &str = if text_format { ".md" } else { ".heapprofile" };
    let mut cursor = std::io::Cursor::new(&mut buf[..]);
    crate::bun_cpu_profiler::write_diagnostic_filename(&mut cursor, "Heap", extension)
        .map_err(|_| ProfilerError::FilenameTooLong)?;
    let written = usize::try_from(cursor.position()).expect("int cast");
    Ok(&buf.as_slice()[..written])
}
