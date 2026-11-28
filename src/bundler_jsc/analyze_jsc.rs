//! JSC bridge for analyze_transpiled_module.rs — converts the parsed
//! `ModuleInfoDeserialized` into a `JSC::JSModuleRecord`. Aliased back so the
//! `extern "C"` symbol names are still discoverable from C++.
//!
//! Note: the `zig__renderDiff` export lives in
//! `bun_runtime::test_runner::diff_format` instead — `DiffFormatter` is a
//! higher-tier type this crate cannot depend on, and the C++ caller only needs
//! the symbol at link time, not a particular crate.

use crate::{JSGlobalObject, VM};

use analyze::{
    ModuleInfoDeserialized, ModuleInfoString, RecordKind, RequestedModuleValue, StringID,
};
use bun_bundler::analyze_transpiled_module as analyze;
use handles::{Identifier, IdentifierSlot, JSModuleRecord};

#[unsafe(no_mangle)]
extern "C" fn zig__ModuleInfoDeserialized__toJSModuleRecord<'a>(
    global_object: &'a JSGlobalObject,
    vm: &VM,
    module_loader: &JSModuleLoader,
    module_key: &Identifier,
    source_code: &SourceCode,
    res: &ModuleInfoDeserialized,
) -> Option<&'a JSModuleRecord> {
    // Ownership of `res` stays with the caller; this function only reads it.
    // The caller (BunAnalyzeTranspiledModule.cpp) decides whether to free
    // immediately or keep it alive on the SourceProvider for the isolation
    // SourceProvider cache.
    to_js_module_record(
        global_object,
        vm,
        module_loader,
        module_key,
        source_code,
        res,
    )
    .ok()
}

/// Walks the serialized body in place (layout documented on the printer's
/// `ModuleInfoDeserialized::serialize_body`) and feeds JSC's module record.
/// Any out-of-range id or truncated region yields `Err` → null → a clean
/// "parseFromSourceCode failed" rejection in the caller.
fn to_js_module_record<'a>(
    global_object: &'a JSGlobalObject,
    vm: &VM,
    module_loader: &JSModuleLoader,
    module_key: &Identifier,
    source_code: &SourceCode,
    res: &ModuleInfoDeserialized,
) -> Result<&'a JSModuleRecord, analyze::ModuleInfoError> {
    let body = *res.body();
    let identifier_count = res.strings_count();

    // Identifier slots the ids index, filled on first use: the VM-wide slots
    // for an executable's shared table, else a throwaway array for this record.
    let mut owned_identifiers: Option<OwnedIdentifierArray> = None;
    let identifiers = if res.shared() {
        Bun__VM__sharedModuleInfoIdentifiers(vm, identifier_count)
    } else {
        owned_identifiers
            .insert(OwnedIdentifierArray::new(identifier_count))
            .ptr
    };
    // SAFETY: either array has `identifier_count` slots and stays where it is until this returns:
    // only the call above grows the VM's, and nothing below loads another module.
    let identifiers = unsafe { bun_opaque::ffi::slice(identifiers, identifier_count) };
    // Every id goes through here: in range (or a sentinel, which
    // `IdCursor` already vetted) and materialized.
    let ready = |id: StringID| -> Result<&Identifier, analyze::ModuleInfoError> {
        let Some(target) = identifiers.get(id.0 as usize) else {
            return Ok(JSC__VM__starPrivateName(vm, id == StringID::STAR_DEFAULT));
        };
        if let Some(identifier) = JSC__Identifier__nonNull(target) {
            return Ok(identifier);
        }
        match res.string(id.0) {
            // SAFETY: 16-bit `chars` start at an even offset of a heap block, so they are aligned.
            Some(ModuleInfoString::Chars { chars, is_8bit }) => Some(unsafe {
                JSC__Identifier__setFromChars(target, vm, chars.as_ptr(), chars.len(), is_8bit)
            }),
            Some(ModuleInfoString::Slot(slot)) => JSC__Identifier__setFromSlot(target, vm, slot),
            None => None,
        }
        .ok_or(analyze::ModuleInfoError::BadModuleInfo)
    };
    // `ScriptFetchParameters::Type`, pinned by the static_asserts in BunAnalyzeTranspiledModule.cpp.
    let request_type = |fetch| -> Result<u32, analyze::ModuleInfoError> {
        Ok(match fetch {
            RequestedModuleValue::None | RequestedModuleValue::Javascript => 1,
            RequestedModuleValue::Webassembly => 2,
            RequestedModuleValue::Json => 3,
            host => JSC__ScriptFetchParameters__hostDefinedType(ready(StringID(host.0))?),
        })
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
    // SAFETY: the record is held on the stack only, which the collector scans. The printer wrote `res`
    // together with `source_code`.
    let module_record = unsafe {
        JSC_JSModuleRecord__create(
            global_object,
            vm,
            module_loader,
            module_key,
            source_code,
            res.flags.contains_import_meta(),
            res.flags.is_typescript(),
            res.flags.has_tla(),
            u32::try_from(body.requested_tags.len()).expect("int cast"),
            u32::try_from(import_count).expect("int cast"),
            u32::try_from(body.record_tags.len() - import_count).expect("int cast"),
        )
    };

    let mut ids = res.ids();
    for &tag in body.requested_tags {
        // bit 0: ModulePhase::Defer; bits 1..: fetch-parameter kind.
        let phase_defer = tag & 1 != 0;
        let key = ready(ids.next_id()?)?;
        match ids.next_fetch(tag >> 1)? {
            RequestedModuleValue::None => JSC_JSModuleRecord__addRequestedModuleNullAttributesPtr(
                module_record,
                key,
                phase_defer,
            ),
            RequestedModuleValue::Javascript => {
                JSC_JSModuleRecord__addRequestedModuleJavaScript(module_record, key, phase_defer)
            }
            RequestedModuleValue::Webassembly => {
                JSC_JSModuleRecord__addRequestedModuleWebAssembly(module_record, key, phase_defer)
            }
            RequestedModuleValue::Json => {
                JSC_JSModuleRecord__addRequestedModuleJSON(module_record, key, phase_defer)
            }
            host => JSC_JSModuleRecord__addRequestedModuleHostDefined(
                module_record,
                key,
                request_type(host)?,
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
                let ty = request_type(ids.next_fetch(fetch_kind)?)?;
                if kind == RecordKind::ImportInfoSingle {
                    JSC_JSModuleRecord__addImportEntrySingle(
                        module_record,
                        import_name,
                        local_name,
                        module_name,
                        ty,
                    )
                } else {
                    JSC_JSModuleRecord__addImportEntrySingleTypeScript(
                        module_record,
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
                let ty = request_type(ids.next_fetch(fetch_kind)?)?;
                if kind == RecordKind::ImportInfoNamespace {
                    JSC_JSModuleRecord__addImportEntryNamespace(
                        module_record,
                        local_name,
                        module_name,
                        ty,
                    )
                } else {
                    JSC_JSModuleRecord__addImportEntryNamespaceDefer(
                        module_record,
                        local_name,
                        module_name,
                        ty,
                    )
                }
            }
            RecordKind::ExportInfoIndirect => {
                let export_name = ready(ids.next_id()?)?;
                let import_id = ids.next_id()?;
                let import_name = ready(import_id)?;
                let module_name = ready(ids.next_id()?)?;
                let ty = request_type(ids.next_fetch(fetch_kind)?)?;
                if import_id == StringID::STAR_NAMESPACE {
                    JSC_JSModuleRecord__addNamespaceExport(
                        module_record,
                        export_name,
                        module_name,
                        ty,
                    )
                } else {
                    JSC_JSModuleRecord__addIndirectExport(
                        module_record,
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
                JSC_JSModuleRecord__addLocalExport(module_record, export_name, local_name)
            }
            RecordKind::ExportInfoNamespace => {
                let export_name = ready(ids.next_id()?)?;
                let module_name = ready(ids.next_id()?)?;
                let ty = request_type(ids.next_fetch(fetch_kind)?)?;
                JSC_JSModuleRecord__addNamespaceExport(module_record, export_name, module_name, ty)
            }
            RecordKind::ExportInfoStar => {
                let module_name = ready(ids.next_id()?)?;
                let ty = request_type(ids.next_fetch(fetch_kind)?)?;
                JSC_JSModuleRecord__addStarExport(module_record, module_name, ty)
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

/// Not `opaque_ffi!`, whose `opaque_ref` takes any pointer: only C++ can make these.
mod handles {
    use core::cell::UnsafeCell;
    use core::ffi::c_void;

    /// A `JSC::Identifier` that is null until C++ sets it, and not null after that.
    #[repr(transparent)]
    pub(super) struct IdentifierSlot(UnsafeCell<*const c_void>);
    /// A `JSC::Identifier` that is not null.
    #[repr(transparent)]
    pub(super) struct Identifier(IdentifierSlot);
    /// Pointer-aligned, so `bun_opaque::opaque_deref` rejects it.
    #[repr(C)]
    pub(super) struct JSModuleRecord(UnsafeCell<[*const c_void; 0]>);
}
unsafe extern "C" {
    /// Grows the VM's slots to at least `count`, which can move them.
    safe fn Bun__VM__sharedModuleInfoIdentifiers(vm: &VM, count: usize) -> *mut IdentifierSlot;
    safe fn JSC__VM__starPrivateName(vm: &VM, is_default: bool) -> &Identifier;
    safe fn JSC__IdentifierArray__create(count: usize) -> *mut IdentifierSlot;
    fn JSC__IdentifierArray__destroy(identifiers: *mut IdentifierSlot, count: usize);
    safe fn JSC__Identifier__nonNull(identifier: &IdentifierSlot) -> Option<&Identifier>;
    fn JSC__Identifier__setFromChars<'a>(
        identifier: &'a IdentifierSlot,
        vm: &VM,
        chars: *const u8,
        len: usize,
        is_8bit: bool,
    ) -> &'a Identifier;
    safe fn JSC__Identifier__setFromSlot<'a>(
        identifier: &'a IdentifierSlot,
        vm: &VM,
        slot: u32,
    ) -> Option<&'a Identifier>;
}
/// `count` identifier slots owned by this value (fastMalloc'd on the C++ side).
struct OwnedIdentifierArray {
    ptr: *mut IdentifierSlot,
    count: usize,
}
impl OwnedIdentifierArray {
    fn new(count: usize) -> Self {
        Self {
            ptr: JSC__IdentifierArray__create(count),
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

bun_opaque::opaque_ffi! {
    pub(crate) struct SourceCode;
    pub(crate) struct JSModuleLoader;
}
unsafe extern "C" {
    /// SAFETY: the record is kept alive for `'a`. By the time it is linked, each entry that was added names a
    /// module that it requests, or a variable of `source_code`: JSC does not check.
    fn JSC_JSModuleRecord__create<'a>(
        global_object: &'a JSGlobalObject,
        vm: &VM,
        module_loader: &JSModuleLoader,
        module_key: &Identifier,
        source_code: &SourceCode,
        has_import_meta: bool,
        is_typescript: bool,
        has_tla: bool,
        requested_module_count: u32,
        import_count: u32,
        export_count: u32,
    ) -> &'a JSModuleRecord;

    safe fn JSC_JSModuleRecord__addIndirectExport(
        module_record: &JSModuleRecord,
        export_name: &Identifier,
        import_name: &Identifier,
        module_name: &Identifier,
        module_request_type: u32,
    );
    safe fn JSC_JSModuleRecord__addLocalExport(
        module_record: &JSModuleRecord,
        export_name: &Identifier,
        local_name: &Identifier,
    );
    safe fn JSC_JSModuleRecord__addNamespaceExport(
        module_record: &JSModuleRecord,
        export_name: &Identifier,
        module_name: &Identifier,
        module_request_type: u32,
    );
    safe fn JSC_JSModuleRecord__addStarExport(
        module_record: &JSModuleRecord,
        module_name: &Identifier,
        module_request_type: u32,
    );

    safe fn JSC_JSModuleRecord__addRequestedModuleNullAttributesPtr(
        module_record: &JSModuleRecord,
        module_name: &Identifier,
        phase_defer: bool,
    );
    safe fn JSC_JSModuleRecord__addRequestedModuleJavaScript(
        module_record: &JSModuleRecord,
        module_name: &Identifier,
        phase_defer: bool,
    );
    safe fn JSC_JSModuleRecord__addRequestedModuleWebAssembly(
        module_record: &JSModuleRecord,
        module_name: &Identifier,
        phase_defer: bool,
    );
    safe fn JSC_JSModuleRecord__addRequestedModuleJSON(
        module_record: &JSModuleRecord,
        module_name: &Identifier,
        phase_defer: bool,
    );
    safe fn JSC__ScriptFetchParameters__hostDefinedType(name: &Identifier) -> u32;
    safe fn JSC_JSModuleRecord__addRequestedModuleHostDefined(
        module_record: &JSModuleRecord,
        module_name: &Identifier,
        host_defined_import_type: u32,
        phase_defer: bool,
    );

    safe fn JSC_JSModuleRecord__addImportEntrySingle(
        module_record: &JSModuleRecord,
        import_name: &Identifier,
        local_name: &Identifier,
        module_name: &Identifier,
        module_request_type: u32,
    );
    safe fn JSC_JSModuleRecord__addImportEntrySingleTypeScript(
        module_record: &JSModuleRecord,
        import_name: &Identifier,
        local_name: &Identifier,
        module_name: &Identifier,
        module_request_type: u32,
    );
    safe fn JSC_JSModuleRecord__addImportEntryNamespace(
        module_record: &JSModuleRecord,
        local_name: &Identifier,
        module_name: &Identifier,
        module_request_type: u32,
    );
    safe fn JSC_JSModuleRecord__addImportEntryNamespaceDefer(
        module_record: &JSModuleRecord,
        local_name: &Identifier,
        module_name: &Identifier,
        module_request_type: u32,
    );
}
