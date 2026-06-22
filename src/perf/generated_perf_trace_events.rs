// Hand-maintained: scripts/generate-perf-trace-events.sh does not emit Rust,
// so this file mirrors the generated event list manually until the generator
// learns to emit Rust. Variants are added piecemeal as call sites need them;
// the discriminants are assigned EXPLICITLY to the canonical ids from
// src/jsc/bindings/generated_perf_trace_events.h (the Darwin signpost path
// passes `event as i32`, so the numeric id must match the generated header).
#[repr(i32)]
#[derive(Clone, Copy, Debug)]
pub enum PerfEvent {
    /// Placeholder for call sites whose real event variant has not been
    /// mirrored from the generated header yet. Not a header id.
    _Stub = -1,
    FolderResolverReadPackageJSONFromDiskFolder = 34,
    FolderResolverReadPackageJSONFromDiskWorkspace = 35,
    ModuleResolverResolve = 47,
    StandaloneModuleGraphSerialize = 54,
    SymbolsFollowAll = 55,
}

impl From<PerfEvent> for &'static str {
    fn from(e: PerfEvent) -> &'static str {
        match e {
            PerfEvent::_Stub => "_Stub",
            PerfEvent::FolderResolverReadPackageJSONFromDiskFolder => {
                "FolderResolver.readPackageJSONFromDisk.folder"
            }
            PerfEvent::FolderResolverReadPackageJSONFromDiskWorkspace => {
                "FolderResolver.readPackageJSONFromDisk.workspace"
            }
            PerfEvent::ModuleResolverResolve => "ModuleResolver.resolve",
            PerfEvent::StandaloneModuleGraphSerialize => "StandaloneModuleGraph.serialize",
            PerfEvent::SymbolsFollowAll => "Symbols.followAll",
        }
    }
}

impl PerfEvent {
    /// NUL-terminated tag name. Required for FFI to `Bun__linux_trace_emit`
    /// (expects C string).
    pub fn as_cstr(self) -> &'static core::ffi::CStr {
        match self {
            PerfEvent::_Stub => c"_Stub",
            PerfEvent::FolderResolverReadPackageJSONFromDiskFolder => {
                c"FolderResolver.readPackageJSONFromDisk.folder"
            }
            PerfEvent::FolderResolverReadPackageJSONFromDiskWorkspace => {
                c"FolderResolver.readPackageJSONFromDisk.workspace"
            }
            PerfEvent::ModuleResolverResolve => c"ModuleResolver.resolve",
            PerfEvent::StandaloneModuleGraphSerialize => c"StandaloneModuleGraph.serialize",
            PerfEvent::SymbolsFollowAll => c"Symbols.followAll",
        }
    }
}
