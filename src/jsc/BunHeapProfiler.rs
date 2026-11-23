use crate::CrateError as Error;
use bun_core::Output;
use bun_core::String as BunString;

use crate::VM;
use crate::bun_cpu_profiler::{build_output_path, write_file_creating_dir};

pub struct HeapProfilerConfig {
    // The config originates from CLI args and lives until process exit, so
    // `&'static [u8]` matches the ownership exactly.
    pub name: &'static [u8],
    pub dir: &'static [u8],
    pub text_format: bool,
}

// C++ function declarations
unsafe extern "C" {
    // safe: `VM` is an opaque `UnsafeCell`-backed ZST handle; `&VM` is ABI-identical
    // to a non-null `*mut VM` and C++ mutation is interior to the opaque cell.
    safe fn Bun__generateHeapProfile(vm: &VM) -> BunString;
    safe fn Bun__generateHeapSnapshotV8(vm: &VM) -> BunString;
}

pub(crate) fn generate_and_write_profile(
    vm: &VM,
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

    let extension = if config.text_format {
        ".md"
    } else {
        ".heapprofile"
    };
    let path = build_output_path(config.dir, config.name, "Heap", extension)
        .map_err(|_| Error::MaxPathExceeded)?;

    let dir = bun_paths::dirname_or_root(&path);
    write_file_creating_dir(&path, dir, profile_slice.slice()).map_err(|_| Error::WriteFailed)?;

    // Print where the markdown profile was written; node parity for the
    // .heapprofile format is silence on success.
    if config.text_format {
        bun_core::pretty_errorln!(
            "Heap profile written to: {}",
            bun_core::fmt::fmt_path(&path, Default::default())
        );
        Output::flush();
    }
    Ok(())
}
