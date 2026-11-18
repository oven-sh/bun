use core::ffi::c_void;
use core::ptr::NonNull;

use bun_engine_macros::export;
use bun_engine_text::{StringImpl, StringRef};
use bun_engine_vm::{
    LineColumn, SourceProvider, SourceProviderRef, SourceType, Vm, origin_of_caller,
};

use crate::abi::returned_as_pointer;

returned_as_pointer! {
    SourceProviderRef,
}

#[export]
unsafe fn source_provider_construct(
    place: *mut SourceProvider,
    source: &StringImpl,
    url: Option<StringRef>,
    source_type: SourceType,
    start_line: i32,
    start_column: i32,
    opaque_root: *const c_void,
    is_static: bool,
) {
    let provider = SourceProvider::build(StringRef::retain(source), url, source_type)
        .start_position(start_line, start_column)
        .opaque_root(opaque_root)
        .is_static(is_static);
    // SAFETY: from the constructor.
    unsafe { provider.finish_in(place) }
}

#[export]
unsafe fn source_provider_destroy(provider: *mut SourceProvider) {
    // SAFETY: from the destructor.
    unsafe { provider.drop_in_place() }
}

#[export]
unsafe fn source_provider_release(provider: *const SourceProvider) {
    // SAFETY: a reference that C++ holds.
    drop(unsafe { SourceProviderRef::from_raw(NonNull::new_unchecked(provider.cast_mut())) });
}

#[export]
fn source_provider_origin(provider: &SourceProvider) -> &SourceProvider {
    provider.origin()
}

#[export]
fn source_provider_hash(provider: &SourceProvider) -> u32 {
    provider.hash()
}

#[export]
fn source_provider_id(provider: &SourceProvider) -> usize {
    provider.id()
}

#[export]
fn source_provider_url_directive(provider: &SourceProvider) -> Option<StringRef> {
    provider.source_url_directive()
}

#[export]
fn source_provider_mapping_url_directive(provider: &SourceProvider) -> Option<StringRef> {
    provider.source_mapping_url_directive()
}

#[export]
fn source_provider_has_line_table(provider: &SourceProvider) -> bool {
    provider.has_lines()
}

#[export]
fn source_provider_position_in_document(
    provider: &SourceProvider,
    offset: u32,
    position: &mut LineColumn,
) {
    *position = provider.position_in_document(offset);
}

#[export]
fn source_origin_of_caller(vm: &Vm) -> Option<SourceProviderRef> {
    origin_of_caller(vm)
}
