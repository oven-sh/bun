//! JSC bridge for analyze_transpiled_module.rs — converts the parsed
//! `ModuleInfoDeserialized` into a `JSC::JSModuleRecord`. Aliased back so the
//! `extern "C"` symbol names are still discoverable from C++.
//!
//! Note: the `zig__renderDiff` export from `analyze_jsc.zig` lives in
//! `bun_runtime::test_runner::diff_format` instead — `DiffFormatter` is a
//! higher-tier type this crate cannot depend on, and the C++ caller only needs
//! the symbol at link time, not a particular crate.

use core::marker::{PhantomData, PhantomPinned};

use crate::{JSGlobalObject, VM};

use analyze::{ModuleInfoDeserialized, RecordKind, RequestedModuleValue, StringID};
use bun_bundler::analyze_transpiled_module as analyze;

#[unsafe(no_mangle)]
pub extern "C" fn zig__ModuleInfoDeserialized__toJSModuleRecord(
    global_object: &JSGlobalObject,
    vm: &VM,
    module_key: &IdentifierArray,
    source_code: &SourceCode,
    declared_variables: &mut VariableEnvironment,
    lexical_variables: &mut VariableEnvironment,
    res: &ModuleInfoDeserialized,
) -> *mut JSModuleRecord {
    // Ownership of `res` stays with the caller; this function only reads it.
    // The caller (BunAnalyzeTranspiledModule.cpp) decides whether to free
    // immediately or keep it alive on the SourceProvider for the isolation
    // SourceProvider cache.

    // Slice-field validity / alignment caveats are documented on the
    // `ModuleInfoDeserialized` accessors.
    // TODO(port): switch element reads to `read_unaligned` per the upstream
    // note in `analyze_transpiled_module.rs` if a strict-alignment target is
    // ever added.
    let strings_buf: &[u8] = res.strings_buf();
    let strings_lens: &[u32] = res.strings_lens();
    let requested_modules_keys: &[StringID] = res.requested_modules_keys();
    let requested_modules_values: &[RequestedModuleValue] = res.requested_modules_values();
    let buffer: &[StringID] = res.buffer();
    let record_kinds: &[RecordKind] = res.record_kinds();

    let identifiers = IdentifierArray::create(strings_lens.len());
    // SAFETY: `identifiers` is non-null (returned by `create`); destroyed exactly once at scope exit,
    // mirroring Zig's `defer identifiers.destroy()` (runs on both success and early-return paths).
    let _identifiers_guard = scopeguard::guard(identifiers, |p| unsafe {
        IdentifierArray::destroy(p);
    });
    let identifiers: *mut IdentifierArray = *_identifiers_guard;

    let mut offset: usize = 0;
    for (index, &len) in strings_lens.iter().enumerate() {
        let len = len as usize;
        if strings_buf.len() < offset + len {
            return core::ptr::null_mut(); // error!
        }
        let sub = &strings_buf[offset..offset + len];
        // SAFETY: `identifiers` is live for the scope of this fn (guard above).
        unsafe { IdentifierArray::set_from_utf8(identifiers, index, vm, sub) };
        offset += len;
    }

    {
        let mut i: usize = 0;
        for &k in record_kinds.iter() {
            if i + k.len().unwrap_or(0) > buffer.len() {
                return core::ptr::null_mut();
            }
            match k {
                RecordKind::DeclaredVariable => declared_variables.add(vm, identifiers, buffer[i]),
                RecordKind::LexicalVariable => lexical_variables.add(vm, identifiers, buffer[i]),
                RecordKind::ImportInfoSingle
                | RecordKind::ImportInfoSingleTypeScript
                | RecordKind::ImportInfoNamespace
                | RecordKind::ExportInfoIndirect
                | RecordKind::ExportInfoLocal
                | RecordKind::ExportInfoNamespace
                | RecordKind::ExportInfoStar => {}
                _ => return core::ptr::null_mut(),
            }
            i += k.len().expect("unreachable"); // handled above
        }
    }

    let module_record = JSModuleRecord::create(
        global_object,
        vm,
        module_key,
        source_code,
        declared_variables,
        lexical_variables,
        res.flags.contains_import_meta(),
        res.flags.is_typescript(),
        res.flags.has_tla(),
    );

    debug_assert_eq!(requested_modules_keys.len(), requested_modules_values.len());
    for (&reqk, &reqv) in requested_modules_keys
        .iter()
        .zip(requested_modules_values.iter())
    {
        match reqv {
            RequestedModuleValue::None => {
                module_record.add_requested_module_null_attributes_ptr(identifiers, reqk)
            }
            RequestedModuleValue::Javascript => {
                module_record.add_requested_module_java_script(identifiers, reqk)
            }
            RequestedModuleValue::Webassembly => {
                module_record.add_requested_module_web_assembly(identifiers, reqk)
            }
            RequestedModuleValue::Json => {
                module_record.add_requested_module_json(identifiers, reqk)
            }
            // Zig open-enum tail: `else => |uv| @enumFromInt(@intFromEnum(uv))` —
            // FetchParameters and StringID are both `#[repr(transparent)] u32`, so this
            // is a bitcast of the raw discriminant back into the interned-string index.
            uv => {
                module_record.add_requested_module_host_defined(identifiers, reqk, StringID(uv.0))
            }
        }
    }

    {
        let mut i: usize = 0;
        for &k in record_kinds.iter() {
            if i + k.len().expect("unreachable") > buffer.len() {
                unreachable!(); // handled above
            }
            match k {
                RecordKind::DeclaredVariable | RecordKind::LexicalVariable => {}
                RecordKind::ImportInfoSingle => module_record.add_import_entry_single(
                    identifiers,
                    buffer[i + 1],
                    buffer[i + 2],
                    buffer[i],
                ),
                RecordKind::ImportInfoSingleTypeScript => module_record
                    .add_import_entry_single_type_script(
                        identifiers,
                        buffer[i + 1],
                        buffer[i + 2],
                        buffer[i],
                    ),
                RecordKind::ImportInfoNamespace => module_record.add_import_entry_namespace(
                    identifiers,
                    buffer[i + 1],
                    buffer[i + 2],
                    buffer[i],
                ),
                RecordKind::ExportInfoIndirect => {
                    if buffer[i + 1] == StringID::STAR_NAMESPACE {
                        module_record.add_namespace_export(
                            identifiers,
                            buffer[i + 0],
                            buffer[i + 2],
                        )
                    } else {
                        module_record.add_indirect_export(
                            identifiers,
                            buffer[i + 0],
                            buffer[i + 1],
                            buffer[i + 2],
                        )
                    }
                }
                RecordKind::ExportInfoLocal => {
                    module_record.add_local_export(identifiers, buffer[i], buffer[i + 1])
                }
                RecordKind::ExportInfoNamespace => {
                    module_record.add_namespace_export(identifiers, buffer[i], buffer[i + 1])
                }
                RecordKind::ExportInfoStar => module_record.add_star_export(identifiers, buffer[i]),
                _ => unreachable!(), // handled above
            }
            i += k.len().expect("unreachable"); // handled above
        }
    }

    module_record
}

// ─── opaque FFI types ─────────────────────────────────────────────────────────
// TODO(port): move to bundler_jsc_sys

bun_opaque::opaque_ffi! { pub struct VariableEnvironment; }
unsafe extern "C" {
    fn JSC__VariableEnvironment__add(
        environment: *mut VariableEnvironment,
        vm: *const VM,
        identifier_array: *mut IdentifierArray,
        identifier_index: StringID,
    );
}
impl VariableEnvironment {
    #[inline]
    pub fn add(
        &mut self,
        vm: &VM,
        identifier_array: *mut IdentifierArray,
        identifier_index: StringID,
    ) {
        // SAFETY: self is a valid &mut VariableEnvironment from C++; identifier_array is live (scopeguard).
        unsafe { JSC__VariableEnvironment__add(self, vm, identifier_array, identifier_index) }
    }
}

bun_opaque::opaque_ffi! { pub struct IdentifierArray; }
unsafe extern "C" {
    fn JSC__IdentifierArray__create(len: usize) -> *mut IdentifierArray;
    fn JSC__IdentifierArray__destroy(identifier_array: *mut IdentifierArray);
    fn JSC__IdentifierArray__setFromUtf8(
        identifier_array: *mut IdentifierArray,
        n: usize,
        vm: *const VM,
        str_: *const u8,
        len: usize,
    );
}
impl IdentifierArray {
    #[inline]
    pub fn create(len: usize) -> *mut IdentifierArray {
        // SAFETY: FFI call; C++ side allocates.
        unsafe { JSC__IdentifierArray__create(len) }
    }
    /// # Safety
    /// `identifier_array` must be a pointer previously returned by `create` and not yet destroyed.
    #[inline]
    pub unsafe fn destroy(identifier_array: *mut IdentifierArray) {
        unsafe { JSC__IdentifierArray__destroy(identifier_array) }
    }
    /// # Safety
    /// `this` must be live; `n` must be in-bounds for the array's length.
    #[inline]
    pub unsafe fn set_from_utf8(this: *mut IdentifierArray, n: usize, vm: &VM, str_: &[u8]) {
        unsafe { JSC__IdentifierArray__setFromUtf8(this, n, vm, str_.as_ptr(), str_.len()) }
    }
}

bun_opaque::opaque_ffi! {
    pub struct SourceCode;
    pub struct JSModuleRecord;
}
unsafe extern "C" {
    fn JSC_JSModuleRecord__create(
        global_object: *const JSGlobalObject,
        vm: *const VM,
        module_key: *const IdentifierArray,
        source_code: *const SourceCode,
        declared_variables: *mut VariableEnvironment,
        lexical_variables: *mut VariableEnvironment,
        has_import_meta: bool,
        is_typescript: bool,
        has_tla: bool,
    ) -> *mut JSModuleRecord;

    fn JSC_JSModuleRecord__declaredVariables(
        module_record: *mut JSModuleRecord,
    ) -> *mut VariableEnvironment;
    fn JSC_JSModuleRecord__lexicalVariables(
        module_record: *mut JSModuleRecord,
    ) -> *mut VariableEnvironment;

    fn JSC_JSModuleRecord__addIndirectExport(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        export_name: StringID,
        import_name: StringID,
        module_name: StringID,
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
    );
    fn JSC_JSModuleRecord__addStarExport(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        module_name: StringID,
    );

    fn JSC_JSModuleRecord__addRequestedModuleNullAttributesPtr(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        module_name: StringID,
    );
    fn JSC_JSModuleRecord__addRequestedModuleJavaScript(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        module_name: StringID,
    );
    fn JSC_JSModuleRecord__addRequestedModuleWebAssembly(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        module_name: StringID,
    );
    fn JSC_JSModuleRecord__addRequestedModuleJSON(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        module_name: StringID,
    );
    fn JSC_JSModuleRecord__addRequestedModuleHostDefined(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        module_name: StringID,
        host_defined_import_type: StringID,
    );

    fn JSC_JSModuleRecord__addImportEntrySingle(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
    );
    fn JSC_JSModuleRecord__addImportEntrySingleTypeScript(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
    );
    fn JSC_JSModuleRecord__addImportEntryNamespace(
        module_record: *mut JSModuleRecord,
        identifier_array: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
    );
}
impl JSModuleRecord {
    #[inline]
    pub fn create(
        global_object: &JSGlobalObject,
        vm: &VM,
        module_key: &IdentifierArray,
        source_code: &SourceCode,
        declared_variables: &mut VariableEnvironment,
        lexical_variables: &mut VariableEnvironment,
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
                declared_variables,
                lexical_variables,
                has_import_meta,
                is_typescript,
                has_tla,
            )
        }
    }
    #[allow(dead_code)]
    #[inline]
    pub fn declared_variables(this: *mut JSModuleRecord) -> *mut VariableEnvironment {
        // SAFETY: `this` is a valid JSModuleRecord*.
        unsafe { JSC_JSModuleRecord__declaredVariables(this) }
    }
    #[allow(dead_code)]
    #[inline]
    pub fn lexical_variables(this: *mut JSModuleRecord) -> *mut VariableEnvironment {
        // SAFETY: `this` is a valid JSModuleRecord*.
        unsafe { JSC_JSModuleRecord__lexicalVariables(this) }
    }
}

// Thin method shims over the raw `*mut JSModuleRecord` returned by `create`.
// These take `*mut Self` because the Zig side calls them as `module_record.addX(...)`
// on a raw pointer; we keep raw-ptr receivers to avoid materializing `&mut` aliases.
trait JSModuleRecordExt {
    fn add_indirect_export(
        self,
        ia: *mut IdentifierArray,
        export_name: StringID,
        import_name: StringID,
        module_name: StringID,
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
    );
    fn add_star_export(self, ia: *mut IdentifierArray, module_name: StringID);
    fn add_requested_module_null_attributes_ptr(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
    );
    fn add_requested_module_java_script(self, ia: *mut IdentifierArray, module_name: StringID);
    fn add_requested_module_web_assembly(self, ia: *mut IdentifierArray, module_name: StringID);
    fn add_requested_module_json(self, ia: *mut IdentifierArray, module_name: StringID);
    fn add_requested_module_host_defined(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
        host_defined_import_type: StringID,
    );
    fn add_import_entry_single(
        self,
        ia: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
    );
    fn add_import_entry_single_type_script(
        self,
        ia: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
    );
    fn add_import_entry_namespace(
        self,
        ia: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
    );
}
impl JSModuleRecordExt for *mut JSModuleRecord {
    // SAFETY (all below): `self` is the non-null pointer returned by JSC_JSModuleRecord__create;
    // `ia` is the live IdentifierArray guarded by scopeguard for the duration of the caller.
    #[inline]
    fn add_indirect_export(
        self,
        ia: *mut IdentifierArray,
        export_name: StringID,
        import_name: StringID,
        module_name: StringID,
    ) {
        unsafe {
            JSC_JSModuleRecord__addIndirectExport(self, ia, export_name, import_name, module_name)
        }
    }
    #[inline]
    fn add_local_export(
        self,
        ia: *mut IdentifierArray,
        export_name: StringID,
        local_name: StringID,
    ) {
        unsafe { JSC_JSModuleRecord__addLocalExport(self, ia, export_name, local_name) }
    }
    #[inline]
    fn add_namespace_export(
        self,
        ia: *mut IdentifierArray,
        export_name: StringID,
        module_name: StringID,
    ) {
        unsafe { JSC_JSModuleRecord__addNamespaceExport(self, ia, export_name, module_name) }
    }
    #[inline]
    fn add_star_export(self, ia: *mut IdentifierArray, module_name: StringID) {
        unsafe { JSC_JSModuleRecord__addStarExport(self, ia, module_name) }
    }
    #[inline]
    fn add_requested_module_null_attributes_ptr(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
    ) {
        unsafe { JSC_JSModuleRecord__addRequestedModuleNullAttributesPtr(self, ia, module_name) }
    }
    #[inline]
    fn add_requested_module_java_script(self, ia: *mut IdentifierArray, module_name: StringID) {
        unsafe { JSC_JSModuleRecord__addRequestedModuleJavaScript(self, ia, module_name) }
    }
    #[inline]
    fn add_requested_module_web_assembly(self, ia: *mut IdentifierArray, module_name: StringID) {
        unsafe { JSC_JSModuleRecord__addRequestedModuleWebAssembly(self, ia, module_name) }
    }
    #[inline]
    fn add_requested_module_json(self, ia: *mut IdentifierArray, module_name: StringID) {
        unsafe { JSC_JSModuleRecord__addRequestedModuleJSON(self, ia, module_name) }
    }
    #[inline]
    fn add_requested_module_host_defined(
        self,
        ia: *mut IdentifierArray,
        module_name: StringID,
        host_defined_import_type: StringID,
    ) {
        unsafe {
            JSC_JSModuleRecord__addRequestedModuleHostDefined(
                self,
                ia,
                module_name,
                host_defined_import_type,
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
    ) {
        unsafe {
            JSC_JSModuleRecord__addImportEntrySingle(self, ia, import_name, local_name, module_name)
        }
    }
    #[inline]
    fn add_import_entry_single_type_script(
        self,
        ia: *mut IdentifierArray,
        import_name: StringID,
        local_name: StringID,
        module_name: StringID,
    ) {
        unsafe {
            JSC_JSModuleRecord__addImportEntrySingleTypeScript(
                self,
                ia,
                import_name,
                local_name,
                module_name,
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
    ) {
        unsafe {
            JSC_JSModuleRecord__addImportEntryNamespace(
                self,
                ia,
                import_name,
                local_name,
                module_name,
            )
        }
    }
}

// ported from: src/bundler_jsc/analyze_jsc.zig
