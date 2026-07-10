//! Rust side of `BakeSourceProvider.h` / `DevServerSourceProvider.h`: the
//! FFI bindings and `SourceProvider` impls for bake's two C++ source
//! providers, plus the host exports that register them with the VM's
//! `SavedSourceMap` so stack remapping can resolve dev-server /
//! bake-production output. `bun_sourcemap` sees these only as erased
//! `AnySourceProvider` handles.
//!
//! `#[unsafe(no_mangle)] extern "C"` thunks are emitted by
//! `src/codegen/generate-host-exports.ts` from the `// HOST_EXPORT(Sym, c)`
//! markers; the bodies take safe `&mut VirtualMachine` / `&BunString` borrows.

use core::ffi::c_void;

use bun_core::String as BunString;
use bun_jsc::JSGlobalObject;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sourcemap::parsed_source_map::AnySourceProvider;
use bun_sourcemap::{SourceContentPtr, SourceProvider};

bun_opaque::opaque_ffi! {
    /// Opaque handle to the C++ `Bake::SourceProvider` for production-build
    /// sources (`BakeSourceProvider.cpp`).
    pub(crate) struct BakeSourceProvider;
    /// Opaque handle to the C++ `Bake::DevServerSourceProvider`
    /// (`DevServerSourceProvider.cpp`).
    pub(crate) struct DevServerSourceProvider;
}

#[repr(C)]
struct DevServerSourceMapData {
    ptr: *const u8,
    length: usize,
}

unsafe extern "C" {
    // The C++ accessors are read-only (`provider->source()` /
    // `provider->sourceMapJSON()`). Taking `*const` avoids casting away const
    // from the `&self` borrows below; any interior mutation lives behind the
    // FFI boundary in C++-owned storage that Rust has no provenance over
    // (these types are opaque ZST markers).
    fn BakeSourceProvider__getSourceSlice(this: *const BakeSourceProvider) -> BunString;
    fn DevServerSourceProvider__getSourceSlice(this: *const DevServerSourceProvider) -> BunString;
    fn DevServerSourceProvider__getSourceMapJSON(
        this: *const DevServerSourceProvider,
    ) -> DevServerSourceMapData;
    fn BakeGlobalObject__isBakeGlobalObject(global: *mut JSGlobalObject) -> bool;
    fn BakeGlobalObject__getPerThreadData(global: *mut JSGlobalObject) -> *mut c_void;
}

impl SourceProvider for BakeSourceProvider {
    const HAS_EXTERNAL_DATA: bool = true;

    fn get_source_slice(&self) -> BunString {
        // SAFETY: opaque FFI handle; address-only pass-through, callee does
        // not write Rust-visible memory.
        unsafe { BakeSourceProvider__getSourceSlice(self) }
    }

    fn to_source_content_ptr(&self) -> SourceContentPtr {
        SourceContentPtr::from_source_provider::<Self>(self)
    }

    /// Returns the pre-bundled sourcemap JSON for `source_filename` if the
    /// current global is a `Bake::GlobalObject`; `None` otherwise (caller
    /// falls back to reading `<source>.map` from disk).
    fn get_external_data(&self, source_filename: &[u8]) -> Option<&[u8]> {
        let global = VirtualMachine::get().global;
        // SAFETY: `global` is the live JSGlobalObject for this VM thread.
        if !unsafe { BakeGlobalObject__isBakeGlobalObject(global) } {
            return None;
        }
        // SAFETY: `global` is a `Bake::GlobalObject` (checked above).
        let pt = unsafe { BakeGlobalObject__getPerThreadData(global) };
        if pt.is_null() {
            // `m_perThreadData` is null between VM init and `PerThread::attach`;
            // no bundled outputs exist yet, so fall back to disk.
            return None;
        }
        // SAFETY: `pt` is the live non-null `*mut PerThread` attached above;
        // called on the JS thread.
        let pt = unsafe { &*pt.cast::<super::production::PerThread>() };
        let Some(idx) = pt.source_maps.get(source_filename) else {
            // Under a bake global the output table is authoritative: an empty
            // slice (which fails to parse as a map) rather than a disk fallback.
            return Some(b"");
        };
        // The returned slice borrows `PerThread.bundled_outputs`, which lives
        // for the bake build session and outlives this provider (the provider
        // is created from a `bundled_outputs` entry).
        Some(pt.bundled_outputs[idx.get() as usize].value.as_slice())
    }
}

impl SourceProvider for DevServerSourceProvider {
    const HAS_SOURCE_MAP_JSON: bool = true;

    fn get_source_slice(&self) -> BunString {
        // SAFETY: opaque FFI handle; address-only pass-through, callee does
        // not write Rust-visible memory.
        unsafe { DevServerSourceProvider__getSourceSlice(self) }
    }

    fn to_source_content_ptr(&self) -> SourceContentPtr {
        SourceContentPtr::from_source_provider::<Self>(self)
    }

    fn get_source_map_json(&self) -> Option<&[u8]> {
        // SAFETY: opaque FFI handle; address-only pass-through, callee does
        // not write Rust-visible memory.
        let d = unsafe { DevServerSourceProvider__getSourceMapJSON(self) };
        if d.length == 0 {
            return None;
        }
        // SAFETY: ptr/length come from C++ and are valid for the call duration
        Some(unsafe { core::slice::from_raw_parts(d.ptr, d.length) })
    }

    fn warn_invalid_source_map_json(&self, source_filename: &[u8], err: bun_sourcemap::Error) {
        bun_core::warn!(
            "Could not decode sourcemap in dev server runtime: {} - {}",
            ::bstr::BStr::new(source_filename),
            ::bstr::BStr::new(err.name()),
        );
    }
}

// HOST_EXPORT(Bun__addBakeSourceProviderSourceMap, c)
pub fn add_bake_source_provider_source_map(
    vm: &mut VirtualMachine,
    opaque_source_provider: *mut c_void,
    specifier: &BunString,
) {
    let slice = specifier.to_utf8();
    vm.source_mappings.put_source_provider(
        AnySourceProvider::new(
            opaque_source_provider
                .cast::<BakeSourceProvider>()
                .cast_const(),
        ),
        slice.slice(),
    );
}

// HOST_EXPORT(Bun__addDevServerSourceProvider, c)
pub fn add_dev_server_source_provider(
    vm: &mut VirtualMachine,
    opaque_source_provider: *mut c_void,
    specifier: &BunString,
) {
    let slice = specifier.to_utf8();
    vm.source_mappings.put_source_provider(
        AnySourceProvider::new(
            opaque_source_provider
                .cast::<DevServerSourceProvider>()
                .cast_const(),
        ),
        slice.slice(),
    );
}

// HOST_EXPORT(Bun__removeDevServerSourceProvider, c)
pub fn remove_dev_server_source_provider(
    vm: &mut VirtualMachine,
    opaque_source_provider: *mut c_void,
    specifier: &BunString,
) {
    let slice = specifier.to_utf8();
    vm.source_mappings
        .remove_source_provider(opaque_source_provider, slice.slice());
}
