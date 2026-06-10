//! Rust side of `BakeSourceProvider.h` / `DevServerSourceProvider.h`:
//! registers bake's C++ source providers with the VM's `SavedSourceMap` so
//! stack remapping can resolve dev-server / bake-production output.
//!
//! `#[unsafe(no_mangle)] extern "C"` thunks are emitted by
//! `src/codegen/generate-host-exports.ts` from the `// HOST_EXPORT(Sym, c)`
//! markers; the bodies take safe `&mut VirtualMachine` / `&BunString` borrows.

use core::ffi::c_void;

use bun_core::String as BunString;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sourcemap::{BakeSourceProvider, DevServerSourceProvider};

// HOST_EXPORT(Bun__addBakeSourceProviderSourceMap, c)
pub fn add_bake_source_provider_source_map(
    vm: &mut VirtualMachine,
    opaque_source_provider: *mut c_void,
    specifier: &BunString,
) {
    let slice = specifier.to_utf8();
    vm.source_mappings.put_bake_source_provider(
        opaque_source_provider.cast::<BakeSourceProvider>(),
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
    vm.source_mappings.put_dev_server_source_provider(
        opaque_source_provider.cast::<DevServerSourceProvider>(),
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
        .remove_dev_server_source_provider(opaque_source_provider, slice.slice());
}
