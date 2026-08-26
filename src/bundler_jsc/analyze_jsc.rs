//! JSC bridge for analyze_transpiled_module.rs — converts the parsed
//! `ModuleInfoDeserialized` into a `JSC::JSModuleRecord`. Aliased back so the
//! `extern "C"` symbol names are still discoverable from C++.
//!
//! Note: the `zig__renderDiff` export lives in
//! `bun_runtime::test_runner::diff_format` instead — `DiffFormatter` is a
//! higher-tier type this crate cannot depend on, and the C++ caller only needs
//! the symbol at link time, not a particular crate.

use crate::{JSGlobalObject, VM};

use analyze::{ModuleInfoDeserialized, RecordKind, RequestedModuleValue, StringID};
use bun_bundler::analyze_transpiled_module as analyze;

#[unsafe(no_mangle)]
extern "C" fn zig__ModuleInfoDeserialized__toJSModuleRecord(
    global_object: &JSGlobalObject,
    vm: &VM,
    module_key: &IdentifierArray,
    source_code: &SourceCode,
    res: &ModuleInfoDeserialized,
) -> *mut JSModuleRecord {
    // Ownership of `res` stays with the caller; this function only reads it.
    // The caller (BunAnalyzeTranspiledModule.cpp) decides whether to free
    // immediately or keep it alive on the SourceProvider for the isolation
    // SourceProvider cache.

    // Slice-field validity / alignment caveats are documented on the
    // `ModuleInfoDeserialized` accessors. If a strict-alignment target is ever
    // added, switch element reads to `read_unaligned` per the upstream note in
    // `analyze_transpiled_module.rs`.
    let requested_modules_keys: &[StringID] = res.requested_modules_keys();
    let requested_modules_values: &[RequestedModuleValue] = res.requested_modules_values();
    let requested_modules_phases: &[u8] = res.requested_modules_phases();
    let buffer: &[StringID] = res.buffer();
    let record_kinds: &[RecordKind] = res.record_kinds();

    let identifier_count = res.strings_count();
    let is_valid_string_id =
        |id: StringID| (id.0 as usize) < identifier_count || id.0 >= StringID::STAR_NAMESPACE.0;
    let is_valid_fetch_parameters =
        |v: u32| (v as usize) < identifier_count || v >= RequestedModuleValue::Json.0;
    if !requested_modules_keys
        .iter()
        .copied()
        .all(is_valid_string_id)
        || !requested_modules_values
            .iter()
            .all(|&v| is_valid_fetch_parameters(v.0))
    {
        return core::ptr::null_mut();
    }

    let mut owned_identifiers: Option<OwnedIdentifierArray> = None;
    let identifiers: *mut IdentifierArray = if res.shared_table().is_some() {
        // Ids index the executable's shared table: fill only the slots this
        // record touches that no earlier module filled.
        let identifiers = IdentifierArray::shared(vm, identifier_count);
        for id in requested_modules_keys
            .iter()
            .map(|k| k.0)
            .chain(requested_modules_values.iter().map(|v| v.0))
            .chain(buffer.iter().map(|s| s.0))
        {
            // Sentinels and non-host-defined fetch parameters sit above the count.
            if (id as usize) >= identifier_count {
                continue;
            }
            // SAFETY: `identifiers` has at least `identifier_count` slots.
            if unsafe { IdentifierArray::is_null(identifiers, id as usize) } {
                let Some(sub) = res.string(id as usize) else {
                    return core::ptr::null_mut();
                };
                // SAFETY: as above.
                unsafe { IdentifierArray::set_from_utf8(identifiers, id as usize, vm, sub) };
            }
        }
        identifiers
    } else {
        // The record carries its own strings: a throwaway array, freed when
        // `owned_identifiers` drops at the end of this function.
        let identifiers = owned_identifiers
            .insert(OwnedIdentifierArray::new(identifier_count))
            .ptr;
        for index in 0..identifier_count {
            let Some(sub) = res.string(index) else {
                return core::ptr::null_mut();
            };
            // SAFETY: `identifiers` has `identifier_count` slots.
            unsafe { IdentifierArray::set_from_utf8(identifiers, index, vm, sub) };
        }
        identifiers
    };

    {
        let mut i: usize = 0;
        for &k in record_kinds.iter() {
            let Ok(len) = k.len() else {
                return core::ptr::null_mut();
            };
            if i + len > buffer.len() {
                return core::ptr::null_mut();
            }
            let fp_slots = k.trailing_fetch_parameters_slots();
            if !buffer[i..i + len - fp_slots]
                .iter()
                .copied()
                .all(is_valid_string_id)
                || !buffer[i + len - fp_slots..i + len]
                    .iter()
                    .all(|s| is_valid_fetch_parameters(s.0))
            {
                return core::ptr::null_mut();
            }
            i += len;
        }
    }

    let module_record = JSModuleRecord::create(
        global_object,
        vm,
        module_key,
        source_code,
        res.flags.contains_import_meta(),
        res.flags.is_typescript(),
        res.flags.has_tla(),
    );

    if requested_modules_keys.len() != requested_modules_values.len()
        || requested_modules_keys.len() != requested_modules_phases.len()
    {
        return core::ptr::null_mut();
    }
    for ((&reqk, &reqv), &reqp) in requested_modules_keys
        .iter()
        .zip(requested_modules_values.iter())
        .zip(requested_modules_phases.iter())
    {
        // 0 = ModulePhase::Evaluation, 1 = ModulePhase::Defer. Reject anything
        // else — the buffer may have come from an on-disk cache.
        let phase_defer = match reqp {
            0 => false,
            1 => true,
            _ => return core::ptr::null_mut(),
        };
        match reqv {
            RequestedModuleValue::None => module_record.add_requested_module_null_attributes_ptr(
                identifiers,
                reqk,
                phase_defer,
            ),
            RequestedModuleValue::Javascript => {
                module_record.add_requested_module_java_script(identifiers, reqk, phase_defer)
            }
            RequestedModuleValue::Webassembly => {
                module_record.add_requested_module_web_assembly(identifiers, reqk, phase_defer)
            }
            RequestedModuleValue::Json => {
                module_record.add_requested_module_json(identifiers, reqk, phase_defer)
            }
            // FetchParameters and StringID are both `#[repr(transparent)] u32`, so this
            // is a bitcast of the raw discriminant back into the interned-string index.
            uv => module_record.add_requested_module_host_defined(
                identifiers,
                reqk,
                StringID(uv.0),
                phase_defer,
            ),
        }
    }

    {
        let mut i: usize = 0;
        for &k in record_kinds.iter() {
            if i + k.len().expect("unreachable") > buffer.len() {
                unreachable!(); // handled above
            }
            match k {
                RecordKind::ImportInfoSingle => module_record.add_import_entry_single(
                    identifiers,
                    buffer[i + 1],
                    buffer[i + 2],
                    buffer[i],
                    analyze::FetchParameters(buffer[i + 3].0).to_script_fetch_parameters_type(),
                ),
                RecordKind::ImportInfoSingleTypeScript => module_record
                    .add_import_entry_single_type_script(
                        identifiers,
                        buffer[i + 1],
                        buffer[i + 2],
                        buffer[i],
                        analyze::FetchParameters(buffer[i + 3].0).to_script_fetch_parameters_type(),
                    ),
                RecordKind::ImportInfoNamespace => module_record.add_import_entry_namespace(
                    identifiers,
                    buffer[i + 1],
                    buffer[i + 2],
                    buffer[i],
                    analyze::FetchParameters(buffer[i + 3].0).to_script_fetch_parameters_type(),
                ),
                RecordKind::ImportInfoNamespaceDefer => module_record
                    .add_import_entry_namespace_defer(
                        identifiers,
                        buffer[i + 1],
                        buffer[i + 2],
                        buffer[i],
                        analyze::FetchParameters(buffer[i + 3].0).to_script_fetch_parameters_type(),
                    ),
                RecordKind::ExportInfoIndirect => {
                    let ty =
                        analyze::FetchParameters(buffer[i + 3].0).to_script_fetch_parameters_type();
                    if buffer[i + 1] == StringID::STAR_NAMESPACE {
                        module_record.add_namespace_export(
                            identifiers,
                            buffer[i],
                            buffer[i + 2],
                            ty,
                        )
                    } else {
                        module_record.add_indirect_export(
                            identifiers,
                            buffer[i],
                            buffer[i + 1],
                            buffer[i + 2],
                            ty,
                        )
                    }
                }
                RecordKind::ExportInfoLocal => {
                    module_record.add_local_export(identifiers, buffer[i], buffer[i + 1])
                }
                RecordKind::ExportInfoNamespace => module_record.add_namespace_export(
                    identifiers,
                    buffer[i],
                    buffer[i + 1],
                    analyze::FetchParameters(buffer[i + 2].0).to_script_fetch_parameters_type(),
                ),
                RecordKind::ExportInfoStar => module_record.add_star_export(
                    identifiers,
                    buffer[i],
                    analyze::FetchParameters(buffer[i + 1].0).to_script_fetch_parameters_type(),
                ),
                _ => unreachable!(), // handled above
            }
            i += k.len().expect("unreachable"); // handled above
        }
    }

    module_record
}

// ─── opaque FFI types ─────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct IdentifierArray; }
unsafe extern "C" {
    fn Bun__VM__sharedModuleInfoIdentifiers(vm: *const VM, count: usize) -> *mut IdentifierArray;
    fn JSC__IdentifierArray__create(count: usize) -> *mut IdentifierArray;
    fn JSC__IdentifierArray__destroy(identifiers: *mut IdentifierArray, count: usize);
    fn JSC__IdentifierArray__isNull(identifier_array: *mut IdentifierArray, n: usize) -> bool;
    fn JSC__IdentifierArray__setFromUtf8(
        identifier_array: *mut IdentifierArray,
        n: usize,
        vm: *const VM,
        str_: *const u8,
        len: usize,
    );
}
impl IdentifierArray {
    /// The VM's slots for the executable's shared module-info string table,
    /// grown to at least `count`; null until filled.
    #[inline]
    pub(crate) fn shared(vm: &VM, count: usize) -> *mut IdentifierArray {
        // SAFETY: FFI call; the vector lives on the VM's client data.
        unsafe { Bun__VM__sharedModuleInfoIdentifiers(vm, count) }
    }
}
/// `count` identifier slots owned by this value (fastMalloc'd on the C++ side).
struct OwnedIdentifierArray {
    ptr: *mut IdentifierArray,
    count: usize,
}
impl OwnedIdentifierArray {
    fn new(count: usize) -> Self {
        Self {
            // SAFETY: FFI call; returns `count` null slots.
            ptr: unsafe { JSC__IdentifierArray__create(count) },
            count,
        }
    }
}
impl Drop for OwnedIdentifierArray {
    fn drop(&mut self) {
        // SAFETY: `ptr`/`count` are exactly what `create` returned / was given.
        unsafe { JSC__IdentifierArray__destroy(self.ptr, self.count) }
    }
}
impl IdentifierArray {
    /// # Safety
    /// `this` must be live; `n` must be in-bounds for the array's length.
    #[inline]
    pub(crate) unsafe fn is_null(this: *mut IdentifierArray, n: usize) -> bool {
        // SAFETY: caller contract.
        unsafe { JSC__IdentifierArray__isNull(this, n) }
    }
    /// # Safety
    /// `this` must be live; `n` must be in-bounds for the array's length.
    #[inline]
    pub(crate) unsafe fn set_from_utf8(this: *mut IdentifierArray, n: usize, vm: &VM, str_: &[u8]) {
        // SAFETY: caller contract — `this` is live, `n` is in bounds; `str_` is a valid slice for the call.
        unsafe { JSC__IdentifierArray__setFromUtf8(this, n, vm, str_.as_ptr(), str_.len()) }
    }
}

bun_opaque::opaque_ffi! {
    pub(crate) struct SourceCode;
    pub(crate) struct JSModuleRecord;
}
unsafe extern "C" {
    fn JSC_JSModuleRecord__create(
        global_object: *const JSGlobalObject,
        vm: *const VM,
        module_key: *const IdentifierArray,
        source_code: *const SourceCode,
        has_import_meta: bool,
        is_typescript: bool,
        has_tla: bool,
    ) -> *mut JSModuleRecord;

    fn JSC_JSModuleRecord__addIndirectExport(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        export_name: StringID,
        import_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    );
    fn JSC_JSModuleRecord__addLocalExport(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        export_name: StringID,
        local_name: StringID,
    );
    fn JSC_JSModuleRecord__addNamespaceExport(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        export_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    );
    fn JSC_JSModuleRecord__addStarExport(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        module_name: StringID,
        module_request_type: u8,
    );

    fn JSC_JSModuleRecord__addRequestedModuleNullAttributesPtr(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        module_name: StringID,
        phase_defer: bool,
    );
    fn JSC_JSModuleRecord__addRequestedModuleJavaScript(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        module_name: StringID,
        phase_defer: bool,
    );
    fn JSC_JSModuleRecord__addRequestedModuleWebAssembly(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        module_name: StringID,
        phase_defer: bool,
    );
    fn JSC_JSModuleRecord__addRequestedModuleJSON(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        module_name: StringID,
        phase_defer: bool,
    );
    fn JSC_JSModuleRecord__addRequestedModuleHostDefined(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        module_name: StringID,
        host_defined_import_type: StringID,
        phase_defer: bool,
    );

    fn JSC_JSModuleRecord__addImportEntrySingle(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    );
    fn JSC_JSModuleRecord__addImportEntrySingleTypeScript(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    );
    fn JSC_JSModuleRecord__addImportEntryNamespace(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    );
    fn JSC_JSModuleRecord__addImportEntryNamespaceDefer(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    );
}
impl JSModuleRecord {
    #[inline]
    fn create(
        global_object: &JSGlobalObject,
        vm: &VM,
        module_key: &IdentifierArray,
        source_code: &SourceCode,
        has_import_meta: bool,
        is_typescript: bool,
        has_tla: bool,
    ) -> *mut JSModuleRecord {
        // SAFETY: all pointer args derive from valid references.
        unsafe {
            JSC_JSModuleRecord__create(
                global_object,
                vm,
                module_key,
                source_code,
                has_import_meta,
                is_typescript,
                has_tla,
            )
        }
    }
}

// Thin method shims over the raw `*mut JSModuleRecord` returned by `create`.
// These take `*mut Self` raw-ptr receivers to avoid materializing `&mut` aliases.
trait JSModuleRecordExt {
    fn add_indirect_export(
        self,
        ia: *mut IdentifierArray,
        export_name: StringID,
        import_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    );
    fn add_local_export(
        self,
        ia: *mut IdentifierArray,
        export_name: StringID,
        local_name: StringID,
    );
    fn add_namespace_export(
        self,
        ia: *mut IdentifierArray,
        export_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    );
    fn add_star_export(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
        module_request_type: u8,
    );
    fn add_requested_module_null_attributes_ptr(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
        phase_defer: bool,
    );
    fn add_requested_module_java_script(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
        phase_defer: bool,
    );
    fn add_requested_module_web_assembly(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
        phase_defer: bool,
    );
    fn add_requested_module_json(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
        phase_defer: bool,
    );
    fn add_requested_module_host_defined(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
        host_defined_import_type: StringID,
        phase_defer: bool,
    );
    fn add_import_entry_single(
        self,
        ia: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    );
    fn add_import_entry_single_type_script(
        self,
        ia: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    );
    fn add_import_entry_namespace(
        self,
        ia: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    );
    fn add_import_entry_namespace_defer(
        self,
        ia: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    );
}
impl JSModuleRecordExt for *mut JSModuleRecord {
    // SAFETY (all below): `self` is the non-null pointer returned by JSC_JSModuleRecord__create;
    // `ia` is one of the VM-owned identifier arrays, which outlive the caller.
    #[inline]
    fn add_indirect_export(
        self,
        ia: *mut IdentifierArray,
        export_name: StringID,
        import_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    ) {
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` is VM-owned and outlives the call.
        unsafe {
            JSC_JSModuleRecord__addIndirectExport(
                self,
                ia,
                export_name,
                import_name,
                module_name,
                module_request_type,
            )
        }
    }
    #[inline]
    fn add_local_export(
        self,
        ia: *mut IdentifierArray,
        export_name: StringID,
        local_name: StringID,
    ) {
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` is VM-owned and outlives the call.
        unsafe { JSC_JSModuleRecord__addLocalExport(self, ia, export_name, local_name) }
    }
    #[inline]
    fn add_namespace_export(
        self,
        ia: *mut IdentifierArray,
        export_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    ) {
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` is VM-owned and outlives the call.
        unsafe {
            JSC_JSModuleRecord__addNamespaceExport(
                self,
                ia,
                export_name,
                module_name,
                module_request_type,
            )
        }
    }
    #[inline]
    fn add_star_export(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
        module_request_type: u8,
    ) {
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` is VM-owned and outlives the call.
        unsafe { JSC_JSModuleRecord__addStarExport(self, ia, module_name, module_request_type) }
    }
    #[inline]
    fn add_requested_module_null_attributes_ptr(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
        phase_defer: bool,
    ) {
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` is VM-owned and outlives the call.
        unsafe {
            JSC_JSModuleRecord__addRequestedModuleNullAttributesPtr(
                self,
                ia,
                module_name,
                phase_defer,
            )
        }
    }
    #[inline]
    fn add_requested_module_java_script(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
        phase_defer: bool,
    ) {
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` is VM-owned and outlives the call.
        unsafe {
            JSC_JSModuleRecord__addRequestedModuleJavaScript(self, ia, module_name, phase_defer)
        }
    }
    #[inline]
    fn add_requested_module_web_assembly(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
        phase_defer: bool,
    ) {
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` is VM-owned and outlives the call.
        unsafe {
            JSC_JSModuleRecord__addRequestedModuleWebAssembly(self, ia, module_name, phase_defer)
        }
    }
    #[inline]
    fn add_requested_module_json(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
        phase_defer: bool,
    ) {
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` is VM-owned and outlives the call.
        unsafe { JSC_JSModuleRecord__addRequestedModuleJSON(self, ia, module_name, phase_defer) }
    }
    #[inline]
    fn add_requested_module_host_defined(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
        host_defined_import_type: StringID,
        phase_defer: bool,
    ) {
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` is VM-owned and outlives the call.
        unsafe {
            JSC_JSModuleRecord__addRequestedModuleHostDefined(
                self,
                ia,
                module_name,
                host_defined_import_type,
                phase_defer,
            )
        }
    }
    #[inline]
    fn add_import_entry_single(
        self,
        ia: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    ) {
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` is VM-owned and outlives the call.
        unsafe {
            JSC_JSModuleRecord__addImportEntrySingle(
                self,
                ia,
                import_name,
                local_name,
                module_name,
                module_request_type,
            )
        }
    }
    #[inline]
    fn add_import_entry_single_type_script(
        self,
        ia: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    ) {
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` is VM-owned and outlives the call.
        unsafe {
            JSC_JSModuleRecord__addImportEntrySingleTypeScript(
                self,
                ia,
                import_name,
                local_name,
                module_name,
                module_request_type,
            )
        }
    }
    #[inline]
    fn add_import_entry_namespace(
        self,
        ia: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    ) {
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` is VM-owned and outlives the call.
        unsafe {
            JSC_JSModuleRecord__addImportEntryNamespace(
                self,
                ia,
                import_name,
                local_name,
                module_name,
                module_request_type,
            )
        }
    }
    #[inline]
    fn add_import_entry_namespace_defer(
        self,
        ia: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    ) {
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` is VM-owned and outlives the call.
        unsafe {
            JSC_JSModuleRecord__addImportEntryNamespaceDefer(
                self,
                ia,
                import_name,
                local_name,
                module_name,
                module_request_type,
            )
        }
    }
}
