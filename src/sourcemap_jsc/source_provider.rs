//! `BakeSourceProvider` — the only `*SourceProvider` variant whose external
//! sourcemap lookup needs the live `Bake::GlobalObject`. The opaque + its
//! `get_external_data` live here so `src/sourcemap/` has no JSC types;
//! `get_source_map_impl` calls it via a trait bound (Zig used
//! `@hasDecl(SourceProviderKind, "getExternalData")`).

use core::cell::UnsafeCell;
use core::marker::{PhantomData, PhantomPinned};

use bun_core::String as BunString;
use bun_jsc::JSGlobalObject;
use bun_sourcemap::{
    self as source_map, ParseUrl, ParseUrlResultHint, SourceContentPtr, SourceMapLoadHint,
    SourceProvider,
};

unsafe extern "C" {
    fn BakeGlobalObject__isBakeGlobalObject(global: *mut JSGlobalObject) -> bool;
    /// Returns the opaque `bake::production::PerThread*` previously attached
    /// via `BakeGlobalObject__attachPerThreadData`. C++ stores it as a raw
    /// pointer (see `Bake::ProductionPerThread`); only `bun_runtime` knows the
    /// concrete layout, so here it's `*mut c_void` and the field access is
    /// dispatched through `RuntimeHooks::bake_per_thread_source_map`.
    fn BakeGlobalObject__getPerThreadData(global: *mut JSGlobalObject) -> *mut core::ffi::c_void;
    fn BakeSourceProvider__getSourceSlice(this: *mut BakeSourceProvider) -> BunString;
}

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle; the C++ side owns the storage.
    pub struct BakeSourceProvider;
}

impl BakeSourceProvider {
    #[inline]
    pub fn get_source_slice(&self) -> BunString {
        // SAFETY: `self` is a live `*BakeSourceProvider` handed back to C++.
        unsafe { BakeSourceProvider__getSourceSlice(self.as_mut_ptr()) }
    }

    pub fn to_source_content_ptr(&self) -> source_map::parsed_source_map::SourceContentPtr {
        // PORT NOTE: `bun_sourcemap` defines its own opaque `BakeSourceProvider` so it
        // can name the pointer without a tier-6 dep. Both are `#[repr(C)]` ZST opaques
        // for the same C++ type, so the pointer cast is layout-correct.
        source_map::parsed_source_map::SourceContentPtr::from_bake_provider(
            self.as_mut_ptr().cast::<source_map::BakeSourceProvider>(),
        )
    }

    /// Returns the pre-bundled sourcemap JSON for `source_filename` if the
    /// current global is a `Bake::GlobalObject`; `None` otherwise (caller falls
    /// back to reading `<source>.map` from disk).
    pub fn get_external_data(&self, source_filename: &[u8]) -> Option<&[u8]> {
        let global = bun_jsc::virtual_machine::VirtualMachine::get().global;
        // SAFETY: `global` is the live JSGlobalObject for this VM thread.
        if !unsafe { BakeGlobalObject__isBakeGlobalObject(global) } {
            return None;
        }

        // SAFETY: `global` is a `Bake::GlobalObject` (checked above), so the
        // attached `PerThread*` is non-null and live for the bake build session.
        let pt = unsafe { BakeGlobalObject__getPerThreadData(global) };
        // PORT NOTE: `PerThread`'s fields name `bun_bundler::OutputFile`, which
        // lives above this crate (forward-dep cycle). The field access
        // (`pt.source_maps.get(filename)` →
        // `pt.bundled_outputs[idx].value.asSlice()`) is dispatched through the
        // existing `bun_jsc::RuntimeHooks` vtable per PORTING.md §Dispatch
        // (cold path — error-stack source-map resolution).
        let hooks = bun_jsc::virtual_machine::runtime_hooks().expect("RuntimeHooks not installed");
        // SAFETY: `pt` is the live `*mut PerThread` per above; called on the JS
        // thread. The returned slice borrows `PerThread.bundled_outputs`, which
        // outlives this `BakeSourceProvider` (the provider is created from a
        // `bundled_outputs` entry), so reborrowing as `&'self [u8]` is sound.
        if let Some(slice) = unsafe { (hooks.bake_per_thread_source_map)(pt, source_filename) } {
            return Some(unsafe { &*slice });
        }
        Some(b"")
    }

    /// The last two arguments to this specify loading hints
    pub fn get_source_map(
        &self,
        source_filename: &[u8],
        load_hint: SourceMapLoadHint,
        result: ParseUrlResultHint,
    ) -> Option<ParseUrl> {
        source_map::get_source_map_impl::<BakeSourceProvider>(
            self,
            source_filename,
            load_hint,
            result,
        )
    }
}

// PORT NOTE: Zig dispatched via `comptime SourceProviderKind: type` + `@hasDecl`;
// Rust uses a trait per PORTING.md §Dispatch.
impl SourceProvider for BakeSourceProvider {
    const HAS_EXTERNAL_DATA: bool = true;

    fn get_source_slice(&self) -> BunString {
        Self::get_source_slice(self)
    }

    fn to_source_content_ptr(&self) -> SourceContentPtr {
        Self::to_source_content_ptr(self)
    }

    fn get_external_data(&self, source_filename: &[u8]) -> Option<&[u8]> {
        Self::get_external_data(self, source_filename)
    }
}

// ported from: src/sourcemap_jsc/source_provider.zig
