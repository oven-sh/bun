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
    to_js_module_record(global_object, vm, module_key, source_code, res)
        .unwrap_or(core::ptr::null_mut())
}

/// Walks the serialized body in place (layout documented on the printer's
/// `ModuleInfoDeserialized::serialize_body`) and feeds JSC's module record.
/// Any out-of-range id or truncated region yields `Err` → null → a clean
/// "parseFromSourceCode failed" rejection in the caller.
fn to_js_module_record(
    global_object: &JSGlobalObject,
    vm: &VM,
    module_key: &IdentifierArray,
    source_code: &SourceCode,
    res: &ModuleInfoDeserialized,
) -> Result<*mut JSModuleRecord, analyze::ModuleInfoError> {
    let body = *res.body();
    let identifier_count = res.strings_count();

    // Identifier slots the ids index, filled on first use: the VM-wide slots
    // for an executable's shared table, else a throwaway array for this record.
    let mut owned_identifiers: Option<OwnedIdentifierArray> = None;
    let identifiers: *mut IdentifierArray = if res.shared() {
        IdentifierArray::shared(vm, identifier_count)
    } else {
        owned_identifiers
            .insert(OwnedIdentifierArray::new(identifier_count))
            .ptr
    };
    // Every id handed to JSC goes through here: in range (or a sentinel, which
    // `IdCursor` already vetted) and materialized.
    let ready = |id: StringID| -> Result<StringID, analyze::ModuleInfoError> {
        if (id.0 as usize) < identifier_count {
            // SAFETY: `identifiers` has at least `identifier_count` slots.
            if unsafe { IdentifierArray::is_null(identifiers, id.0 as usize) } {
                let string = res
                    .string(id.0)
                    .ok_or(analyze::ModuleInfoError::BadModuleInfo)?;
                // SAFETY: as above.
                let ok = unsafe { IdentifierArray::set(identifiers, id.0 as usize, vm, string) };
                if !ok {
                    return Err(analyze::ModuleInfoError::BadModuleInfo);
                }
            }
        }
        Ok(id)
    };

    let import_count = body
        .record_tags
        .iter()
        .filter(|&&tag| {
            matches!(
                RecordKind(tag & 0b111),
                RecordKind::ImportInfoSingle
                    | RecordKind::ImportInfoSingleTypeScript
                    | RecordKind::ImportInfoNamespace
                    | RecordKind::ImportInfoNamespaceDefer
            )
        })
        .count();
    let module_record = JSModuleRecord::create(
        global_object,
        vm,
        module_key,
        source_code,
        res.flags.contains_import_meta(),
        res.flags.is_typescript(),
        res.flags.has_tla(),
        u32::try_from(body.requested_tags.len()).expect("int cast"),
        u32::try_from(import_count).expect("int cast"),
        u32::try_from(body.record_tags.len() - import_count).expect("int cast"),
    );

    let mut ids = res.ids();
    for &tag in body.requested_tags {
        // bit 0: ModulePhase::Defer; bits 1..: fetch-parameter kind.
        let phase_defer = tag & 1 != 0;
        let key = ready(ids.next_id()?)?;
        match ids.next_fetch(tag >> 1)? {
            RequestedModuleValue::None => module_record.add_requested_module_null_attributes_ptr(
                identifiers,
                key,
                phase_defer,
            ),
            RequestedModuleValue::Javascript => {
                module_record.add_requested_module_java_script(identifiers, key, phase_defer)
            }
            RequestedModuleValue::Webassembly => {
                module_record.add_requested_module_web_assembly(identifiers, key, phase_defer)
            }
            RequestedModuleValue::Json => {
                module_record.add_requested_module_json(identifiers, key, phase_defer)
            }
            host => module_record.add_requested_module_host_defined(
                identifiers,
                key,
                ready(StringID(host.0))?,
                phase_defer,
            ),
        }
    }

    for &tag in body.record_tags {
        let kind = RecordKind(tag & 0b111);
        let fetch_kind = (tag >> 3) & 0b111;
        let same_name = tag & (1 << 6) != 0;
        // Slot order on the wire matches the printer's in-memory record; the
        // fetch parameter (when present) comes last.
        match kind {
            RecordKind::ImportInfoSingle | RecordKind::ImportInfoSingleTypeScript => {
                let module_name = ready(ids.next_id()?)?;
                let import_name = ready(ids.next_id()?)?;
                let local_name = if same_name {
                    import_name
                } else {
                    ready(ids.next_id()?)?
                };
                let ty = ids
                    .next_fetch(fetch_kind)?
                    .to_script_fetch_parameters_type();
                if kind == RecordKind::ImportInfoSingle {
                    module_record.add_import_entry_single(
                        identifiers,
                        import_name,
                        local_name,
                        module_name,
                        ty,
                    )
                } else {
                    module_record.add_import_entry_single_type_script(
                        identifiers,
                        import_name,
                        local_name,
                        module_name,
                        ty,
                    )
                }
            }
            RecordKind::ImportInfoNamespace | RecordKind::ImportInfoNamespaceDefer => {
                let module_name = ready(ids.next_id()?)?;
                let local_name = ready(ids.next_id()?)?;
                let ty = ids
                    .next_fetch(fetch_kind)?
                    .to_script_fetch_parameters_type();
                if kind == RecordKind::ImportInfoNamespace {
                    module_record.add_import_entry_namespace(
                        identifiers,
                        StringID::STAR_NAMESPACE,
                        local_name,
                        module_name,
                        ty,
                    )
                } else {
                    module_record.add_import_entry_namespace_defer(
                        identifiers,
                        StringID::STAR_NAMESPACE,
                        local_name,
                        module_name,
                        ty,
                    )
                }
            }
            RecordKind::ExportInfoIndirect => {
                let export_name = ready(ids.next_id()?)?;
                let import_name = ready(ids.next_id()?)?;
                let module_name = ready(ids.next_id()?)?;
                let ty = ids
                    .next_fetch(fetch_kind)?
                    .to_script_fetch_parameters_type();
                if import_name == StringID::STAR_NAMESPACE {
                    module_record.add_namespace_export(identifiers, export_name, module_name, ty)
                } else {
                    module_record.add_indirect_export(
                        identifiers,
                        export_name,
                        import_name,
                        module_name,
                        ty,
                    )
                }
            }
            RecordKind::ExportInfoLocal => {
                let export_name = ready(ids.next_id()?)?;
                let local_name = ready(ids.next_id()?)?;
                ids.next_fetch(fetch_kind)?;
                module_record.add_local_export(identifiers, export_name, local_name)
            }
            RecordKind::ExportInfoNamespace => {
                let export_name = ready(ids.next_id()?)?;
                let module_name = ready(ids.next_id()?)?;
                let ty = ids
                    .next_fetch(fetch_kind)?
                    .to_script_fetch_parameters_type();
                module_record.add_namespace_export(identifiers, export_name, module_name, ty)
            }
            RecordKind::ExportInfoStar => {
                let module_name = ready(ids.next_id()?)?;
                let ty = ids
                    .next_fetch(fetch_kind)?
                    .to_script_fetch_parameters_type();
                module_record.add_star_export(identifiers, module_name, ty)
            }
            _ => return Err(analyze::ModuleInfoError::BadModuleInfo),
        }
    }
    if !ids.is_empty() {
        return Err(analyze::ModuleInfoError::BadModuleInfo);
    }

    Ok(module_record)
}

// ─── opaque FFI types ─────────────────────────────────────────────────────────

bun_opaque::opaque_ffi! { pub struct IdentifierArray; }
unsafe extern "C" {
    fn Bun__VM__sharedModuleInfoIdentifiers(vm: *const VM, count: usize) -> *mut IdentifierArray;
    fn JSC__IdentifierArray__create(count: usize) -> *mut IdentifierArray;
    fn JSC__IdentifierArray__destroy(identifiers: *mut IdentifierArray, count: usize);
    fn JSC__IdentifierArray__isNull(identifier_array: *mut IdentifierArray, n: usize) -> bool;
    fn JSC__IdentifierArray__setFromChars(
        identifier_array: *mut IdentifierArray,
        n: usize,
        vm: *const VM,
        chars: *const u8,
        len: usize,
        is_8bit: bool,
    );
    fn JSC__IdentifierArray__setFromSlot(
        identifier_array: *mut IdentifierArray,
        n: usize,
        vm: *const VM,
        slot: u32,
    ) -> bool;
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
    pub(crate) unsafe fn set(
        this: *mut IdentifierArray,
        n: usize,
        vm: &VM,
        string: analyze::ModuleInfoString<'_>,
    ) -> bool {
        // SAFETY: caller contract — `this` is live, `n` is in bounds; `chars` is a valid slice for the call.
        unsafe {
            match string {
                analyze::ModuleInfoString::Chars { chars, is_8bit } => {
                    JSC__IdentifierArray__setFromChars(
                        this,
                        n,
                        vm,
                        chars.as_ptr(),
                        chars.len(),
                        is_8bit,
                    );
                    true
                }
                analyze::ModuleInfoString::Slot(slot) => {
                    JSC__IdentifierArray__setFromSlot(this, n, vm, slot)
                }
            }
        }
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
        requested_module_count: u32,
        import_count: u32,
        export_count: u32,
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
        requested_module_count: u32,
        import_count: u32,
        export_count: u32,
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
                requested_module_count,
                import_count,
                export_count,
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
    // `ia` is either the VM's shared identifier slots or the caller's `OwnedIdentifierArray`; both outlive every call below.
    #[inline]
    fn add_indirect_export(
        self,
        ia: *mut IdentifierArray,
        export_name: StringID,
        import_name: StringID,
        module_name: StringID,
        module_request_type: u8,
    ) {
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` (the VM's shared slots or the caller's `OwnedIdentifierArray`) outlives the call.
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
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` (the VM's shared slots or the caller's `OwnedIdentifierArray`) outlives the call.
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
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` (the VM's shared slots or the caller's `OwnedIdentifierArray`) outlives the call.
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
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` (the VM's shared slots or the caller's `OwnedIdentifierArray`) outlives the call.
        unsafe { JSC_JSModuleRecord__addStarExport(self, ia, module_name, module_request_type) }
    }
    #[inline]
    fn add_requested_module_null_attributes_ptr(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
        phase_defer: bool,
    ) {
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` (the VM's shared slots or the caller's `OwnedIdentifierArray`) outlives the call.
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
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` (the VM's shared slots or the caller's `OwnedIdentifierArray`) outlives the call.
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
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` (the VM's shared slots or the caller's `OwnedIdentifierArray`) outlives the call.
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
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` (the VM's shared slots or the caller's `OwnedIdentifierArray`) outlives the call.
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
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` (the VM's shared slots or the caller's `OwnedIdentifierArray`) outlives the call.
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
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` (the VM's shared slots or the caller's `OwnedIdentifierArray`) outlives the call.
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
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` (the VM's shared slots or the caller's `OwnedIdentifierArray`) outlives the call.
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
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` (the VM's shared slots or the caller's `OwnedIdentifierArray`) outlives the call.
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
        // SAFETY: `self` is the non-null record from `JSModuleRecord::create`; `ia` (the VM's shared slots or the caller's `OwnedIdentifierArray`) outlives the call.
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
