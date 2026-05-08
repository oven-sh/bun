// GENERATED: re-run scripts/generate-perf-trace-events.sh with .rs output
// (source: src/perf/generated_perf_trace_events.zig — defines #[repr(i32)] enum PerfEvent)
// TODO(port): teach the generator to emit Rust; do not hand-maintain this file.

// TODO(b1): stub until generator emits real variants — variants are added
// piecemeal as call sites un-gate.
#[repr(i32)]
#[derive(Clone, Copy, Debug)]
pub enum PerfEvent {
    _Stub = 0,
    FolderResolverReadPackageJSONFromDiskWorkspace,
    FolderResolverReadPackageJSONFromDiskFolder,
    ModuleResolverResolve,
}

impl From<PerfEvent> for &'static str {
    fn from(e: PerfEvent) -> &'static str {
        match e {
            PerfEvent::_Stub => "_Stub",
            PerfEvent::FolderResolverReadPackageJSONFromDiskWorkspace => {
                "FolderResolver.readPackageJSONFromDisk.workspace"
            }
            PerfEvent::FolderResolverReadPackageJSONFromDiskFolder => {
                "FolderResolver.readPackageJSONFromDisk.folder"
            }
            PerfEvent::ModuleResolverResolve => "ModuleResolver.resolve",
        }
    }
}

impl PerfEvent {
    /// NUL-terminated tag name, mirroring Zig's `@tagName(this.event).ptr` which yields
    /// `[*:0]const u8`. Required for FFI to `Bun__linux_trace_emit` (expects C string).
    pub fn as_cstr(&self) -> &'static core::ffi::CStr {
        match self {
            PerfEvent::_Stub => c"_Stub",
            PerfEvent::FolderResolverReadPackageJSONFromDiskWorkspace => {
                c"FolderResolver.readPackageJSONFromDisk.workspace"
            }
            PerfEvent::FolderResolverReadPackageJSONFromDiskFolder => {
                c"FolderResolver.readPackageJSONFromDisk.folder"
            }
            PerfEvent::ModuleResolverResolve => c"ModuleResolver.resolve",
        }
    }
}

// ported from: src/perf/generated_perf_trace_events.zig
