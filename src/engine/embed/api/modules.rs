use core::ffi::c_void;
use core::fmt::Write;
use core::ptr::NonNull;
use std::rc::Rc;

use bun_engine_bytecode::ImportPhase;
use bun_engine_macros::export;
use bun_engine_text::{Identifier, PropertyName, StringBuilder, StringImpl, StringRef, names};
use bun_engine_vm::scope::realm_of_scope;
use bun_engine_vm::{
    AbstractModuleRecord, AnalysisError, Cx, CyclicModuleRecord, ExportSource, FetchParameters, Gc,
    ImportEntry, ImportKind, JsCell, JsObject, JsPromise, JsResult, JsSourceCode, LoadGoal,
    Message, ModuleEnvironment, ModuleExecutable, ModuleKeyRef, ModuleLoader, ModuleName,
    ModuleNamespace, ModuleRegistryEntry, ModuleRequest, ModuleStatus, ModuleType, Resolution,
    Shape, SourceCode, SourceTextModuleRecord, SyntheticExports, SyntheticModuleRecord, Value, Vm,
    throw_compile_error,
};

use super::code::ParserError;
use super::object::realm_of;
use crate::abi::{returned_as_pointer, returned_by_value};

/// An `Rc` that points at its value.
#[repr(transparent)]
struct FetchParametersRef(NonNull<FetchParameters>);

impl From<Rc<FetchParameters>> for FetchParametersRef {
    fn from(parameters: Rc<FetchParameters>) -> FetchParametersRef {
        // SAFETY: points into an allocation.
        FetchParametersRef(unsafe { NonNull::new_unchecked(Rc::into_raw(parameters).cast_mut()) })
    }
}

impl From<FetchParametersRef> for Rc<FetchParameters> {
    fn from(parameters: FetchParametersRef) -> Rc<FetchParameters> {
        // SAFETY: from `into_raw`, with a reference of its own.
        unsafe { Rc::from_raw(parameters.0.as_ptr()) }
    }
}

returned_as_pointer! {
    FetchParametersRef,
}

returned_by_value! {
    ModuleType = ModuleType::None,
    ModuleStatus = ModuleStatus::New,
}

fn phase(is_deferred: bool) -> ImportPhase {
    match is_deferred {
        true => ImportPhase::Defer,
        false => ImportPhase::Evaluation,
    }
}

// Parameters

#[export]
fn fetch_parameters_create(module_type: ModuleType) -> FetchParametersRef {
    FetchParameters::new(module_type).into()
}

#[export]
fn fetch_parameters_create_host_defined(name: &StringImpl) -> FetchParametersRef {
    FetchParameters::host_defined(StringRef::retain(name)).into()
}

#[export]
unsafe fn fetch_parameters_retain(parameters: *const FetchParameters) {
    // SAFETY: all of them are in an `Rc`.
    unsafe { Rc::increment_strong_count(parameters) }
}

#[export]
unsafe fn fetch_parameters_release(parameters: *const FetchParameters) {
    // SAFETY: a reference that C++ holds.
    unsafe { Rc::decrement_strong_count(parameters) }
}

#[export]
fn fetch_parameters_type(parameters: &FetchParameters) -> ModuleType {
    parameters.module_type()
}

#[export]
fn fetch_parameters_host_defined_type(parameters: &FetchParameters) -> Option<StringRef> {
    parameters.host_defined_type().cloned()
}

#[export]
unsafe fn fetch_parameters_for_each_attribute(
    parameters: &FetchParameters,
    context: *mut c_void,
    visit: unsafe extern "C" fn(*mut c_void, PropertyName<'_>, &StringImpl),
) {
    for (key, value) in parameters.attributes() {
        // SAFETY: the two go together.
        unsafe { visit(context, key.name(), value) };
    }
}

#[export]
fn source_code_create(vm: &Vm, source: &SourceCode) -> Gc<JsSourceCode> {
    JsSourceCode::create(vm, source.clone())
}

#[export]
fn synthetic_exports_set(
    exports: &mut SyntheticExports,
    names: &[Identifier],
    values: &[Option<Value>],
    source: Option<Gc<JsObject>>,
) {
    exports.names.extend_from_slice(names);
    exports.values.extend_from_slice(values);
    exports.source = source;
}

// Records

#[export]
fn module_environment(module: &AbstractModuleRecord) -> Option<Gc<ModuleEnvironment>> {
    module.environment()
}

#[export]
unsafe fn module_for_each_request(
    module: &AbstractModuleRecord,
    context: *mut c_void,
    visit: unsafe extern "C" fn(*mut c_void, PropertyName<'_>, Option<&FetchParameters>, bool),
) {
    for request in module.entries().requests() {
        let (name, parameters) = (request.specifier.name(), request.parameters.as_deref());
        let is_deferred = request.phase == ImportPhase::Defer;
        // SAFETY: the two go together.
        unsafe { visit(context, name, parameters, is_deferred) };
    }
}

#[export]
fn module_request_count(module: &AbstractModuleRecord) -> usize {
    module.entries().requests().len()
}

/// The specifier, which the module keeps alive.
#[export]
fn module_request_key(
    module: &AbstractModuleRecord,
    index: usize,
    module_type: &mut ModuleType,
) -> *mut StringImpl {
    let entries = module.entries();
    let key = entries.requests()[index].key();
    *module_type = key.module_type;
    key.name.as_ptr().as_ptr()
}

#[export]
unsafe fn module_for_each_loaded_module(
    module: &AbstractModuleRecord,
    context: *mut c_void,
    visit: unsafe extern "C" fn(
        *mut c_void,
        PropertyName<'_>,
        ModuleType,
        Gc<AbstractModuleRecord>,
    ),
) {
    for (request, loaded) in module.loaded_modules().entries() {
        // SAFETY: as above.
        unsafe { visit(context, request.name.name(), request.module_type, loaded) };
    }
}

#[export]
fn module_loaded_module(
    module: &AbstractModuleRecord,
    specifier: PropertyName<'_>,
    module_type: ModuleType,
) -> Option<Gc<AbstractModuleRecord>> {
    (module.loaded_modules()).get(&ModuleKeyRef::new(specifier, module_type))
}

#[export]
fn module_set_imported_module(
    module: &AbstractModuleRecord,
    specifier: PropertyName<'_>,
    module_type: ModuleType,
    imported: Gc<AbstractModuleRecord>,
) {
    module.set_imported_module(ModuleKeyRef::new(specifier, module_type), imported);
}

#[export]
unsafe fn module_for_each_resolved_request(
    module: &AbstractModuleRecord,
    context: *mut c_void,
    visit: unsafe extern "C" fn(*mut c_void, PropertyName<'_>),
) {
    for key in module.resolved_requests().borrow().values() {
        // SAFETY: as above.
        unsafe { visit(context, key.name()) };
    }
}

#[export]
fn module_resolved_request(
    module: &AbstractModuleRecord,
    specifier: PropertyName<'_>,
    module_type: ModuleType,
) -> Option<Identifier> {
    let requests = module.resolved_requests().borrow();
    (requests.get(&ModuleKeyRef::new(specifier, module_type))).cloned()
}

/// The module that has the binding.
#[export]
fn module_resolve_export(
    module: &AbstractModuleRecord,
    cx: &mut Cx,
    name: &Identifier,
    local_name: &mut Option<Identifier>,
) -> Option<Gc<AbstractModuleRecord>> {
    let Resolution::Resolved(binding) = module.resolve_export(cx, name) else {
        return None;
    };
    *local_name = Some(binding.name);
    Some(binding.module)
}

#[export]
fn module_namespace(
    module: &AbstractModuleRecord,
    cx: &mut Cx,
    is_extensible: bool,
) -> JsResult<Gc<ModuleNamespace>> {
    match is_extensible {
        true => module.extensible_namespace(cx),
        false => module.namespace(cx, ImportPhase::Evaluation),
    }
}

#[export]
fn module_link(module: &AbstractModuleRecord, cx: &mut Cx) -> JsResult<()> {
    module.link(cx)
}

#[export]
fn module_evaluate(module: &AbstractModuleRecord, cx: &mut Cx) -> JsResult<Gc<JsPromise>> {
    module.evaluate(cx)
}

#[export]
fn module_live_exports_source(module: &AbstractModuleRecord) -> Option<Gc<JsObject>> {
    module.live_exports_source()
}

#[export]
fn module_set_live_exports_source(module: &AbstractModuleRecord, source: Gc<JsObject>) {
    module.set_live_exports_source(source);
}

#[export]
fn module_reserve_entries(
    module: &AbstractModuleRecord,
    requests: u32,
    imports: u32,
    exports: u32,
) {
    module.edit_entries(|it| it.reserve(requests as usize, imports as usize, exports as usize));
}

#[export]
fn module_add_request(
    module: &AbstractModuleRecord,
    specifier: &Identifier,
    parameters: Option<FetchParametersRef>,
    is_deferred: bool,
) {
    module.edit_entries(|it| {
        it.add_request(ModuleRequest {
            specifier: specifier.clone(),
            parameters: parameters.map(Rc::from),
            phase: phase(is_deferred),
        });
    });
}

#[export]
fn module_add_import(
    module: &AbstractModuleRecord,
    kind: ImportKind,
    is_deferred: bool,
    specifier: PropertyName<'_>,
    module_type: ModuleType,
    imported: &Identifier,
    local: &Identifier,
) {
    module.edit_entries(|it| {
        it.add_import(ImportEntry {
            kind,
            phase: phase(is_deferred),
            module: ModuleKeyRef::new(specifier, module_type).to_key(),
            imported: imported.clone(),
            local: local.clone(),
        });
    });
}

#[export]
fn module_add_local_export(
    module: &AbstractModuleRecord,
    exported: &Identifier,
    local: &Identifier,
) {
    module.edit_entries(|it| it.add_export(exported.clone(), ExportSource::Local(local.clone())));
}

#[export]
fn module_add_indirect_export(
    module: &AbstractModuleRecord,
    exported: &Identifier,
    imported: &Identifier,
    specifier: PropertyName<'_>,
    module_type: ModuleType,
) {
    let source = ExportSource::Indirect {
        module: ModuleKeyRef::new(specifier, module_type).to_key(),
        imported: imported.clone(),
    };
    module.edit_entries(|it| it.add_export(exported.clone(), source));
}

#[export]
fn module_add_namespace_export(
    module: &AbstractModuleRecord,
    exported: &Identifier,
    specifier: PropertyName<'_>,
    module_type: ModuleType,
) {
    let source = ExportSource::Namespace(ModuleKeyRef::new(specifier, module_type).to_key());
    module.edit_entries(|it| it.add_export(exported.clone(), source));
}

#[export]
fn module_add_star_export(
    module: &AbstractModuleRecord,
    specifier: PropertyName<'_>,
    module_type: ModuleType,
) {
    module
        .edit_entries(|it| it.add_star_export(ModuleKeyRef::new(specifier, module_type).to_key()));
}

#[export]
fn module_describe_entries(module: &AbstractModuleRecord) -> StringRef {
    let entries = module.entries();
    let requests = entries.requests().iter().map(|it| {
        let parameters = it.parameters.as_ref();
        let attributes = parameters.map(|it| (it.module_type(), it.host_defined_type()));
        format!("request {} {attributes:?} {:?}", it.specifier, it.phase)
    });
    let imports = entries.imports().iter().map(|it| {
        let (imported, local, module) = (&it.imported, &it.local, &it.module);
        let (from, module_type, phase) = (&module.name, module.module_type, it.phase);
        format!("import {imported} as {local} from {from} {module_type:?} {phase:?}")
    });
    let exports = entries.exports().iter().map(|it| match &it.source {
        ExportSource::Local(local) => format!("export {local} as {}", it.exported),
        ExportSource::Indirect { module, imported } => format!(
            "export {imported} as {} from {} {:?}",
            it.exported, module.name, module.module_type
        ),
        ExportSource::Namespace(module) => format!(
            "export * as {} from {} {:?}",
            it.exported, module.name, module.module_type
        ),
    });
    let stars = (entries.star_exports().iter())
        .map(|it| format!("export * from {} {:?}", it.name, it.module_type));
    let mut lines: Vec<String> = requests
        .chain(imports)
        .chain(exports)
        .chain(stars)
        .collect();
    lines.sort_unstable();
    let mut text = StringBuilder::new();
    for line in lines {
        let _ = writeln!(text, "{line}");
    }
    text.into_string()
}

#[export]
fn cyclic_module_status(module: &CyclicModuleRecord) -> ModuleStatus {
    module.status()
}

#[export]
fn cyclic_module_set_status(module: &CyclicModuleRecord, status: ModuleStatus) {
    module.set_status(status);
}

#[export]
fn cyclic_module_evaluation_error(module: &CyclicModuleRecord) -> Option<Value> {
    module.evaluation_error()
}

#[export]
fn cyclic_module_is_cycle_evaluated(module: &CyclicModuleRecord) -> bool {
    module.is_cycle_evaluated()
}

#[export]
fn cyclic_module_has_top_level_await(module: &CyclicModuleRecord) -> bool {
    module.has_top_level_await().get()
}

#[export]
fn cyclic_module_set_has_top_level_await(module: &CyclicModuleRecord, value: bool) {
    module.has_top_level_await().set(value);
}

#[export]
fn cyclic_module_pending_async_dependencies(module: &CyclicModuleRecord) -> u32 {
    module.pending_async_dependencies()
}

#[export]
fn source_text_module_create(
    cx: &Cx,
    loader: Gc<ModuleLoader>,
    key: &Identifier,
    source: &SourceCode,
) -> Gc<SourceTextModuleRecord> {
    SourceTextModuleRecord::create(cx, loader, key.clone(), source.clone())
}

#[export]
fn source_text_module_analyze(
    loader: Gc<ModuleLoader>,
    key: &Identifier,
    source: &SourceCode,
    parser_error: &mut ParserError,
    attribute_error: &mut Option<StringRef>,
) -> Option<Gc<SourceTextModuleRecord>> {
    let cx = realm_of(&realm_of_scope(loader.module_scope()));
    match SourceTextModuleRecord::analyze(cx, loader, key.clone(), source.clone()) {
        Ok(module) => return Some(module),
        Err(AnalysisError::Compile(error)) => parser_error.set(&error, &source.provider),
        Err(AnalysisError::Attributes(message)) => *attribute_error = Some(message),
    }
    None
}

#[export]
unsafe fn source_text_module_for_each_declared_attribute(
    module: &SourceTextModuleRecord,
    specifier: PropertyName<'_>,
    module_type: ModuleType,
    context: *mut c_void,
    visit: unsafe extern "C" fn(*mut c_void, PropertyName<'_>, &StringImpl),
) {
    let Some(unit) = module.analyzed_unit() else {
        return;
    };
    let declaration = unit.requests.iter().find(|request| {
        let attribute = (request.attributes.iter()).find(|(key, _)| *key == names::r#type);
        let declared_type = attribute.and_then(|(_, value)| ModuleType::parse(value.text()));
        request.specifier == specifier
            && declared_type.unwrap_or(ModuleType::JavaScript) == module_type
    });
    for (key, value) in declaration.iter().flat_map(|it| &it.attributes) {
        // SAFETY: the two go together.
        unsafe { visit(context, key.name(), value) };
    }
}

#[export]
fn source_text_module_import_meta(
    module: &SourceTextModuleRecord,
    cx: &mut Cx,
) -> JsResult<Option<Gc<JsObject>>> {
    module.import_meta(cx)
}

#[export]
fn source_text_module_run_code(module: &SourceTextModuleRecord, cx: &mut Cx) -> JsResult<Value> {
    module.run_code(cx)
}

#[export]
fn synthetic_module_with_undefined_exports(
    cx: &Cx,
    loader: Gc<ModuleLoader>,
    key: &Identifier,
    names: &[Identifier],
) -> Gc<SyntheticModuleRecord> {
    let mut exports = SyntheticExports::default();
    exports.names.extend_from_slice(names);
    exports.values.resize(names.len(), Some(Value::UNDEFINED));
    SyntheticModuleRecord::create(cx, loader, key.clone(), ModuleType::JavaScript, &exports)
}

#[export]
fn check_module_syntax(cx: &mut Cx, source: &SourceCode) -> JsResult<()> {
    (cx.check_module_syntax(&source.provider))
        .map_err(|error| throw_compile_error(cx, &error, &source.provider))
}

// Namespaces

#[export]
fn module_namespace_create_shape(cx: &Cx, prototype: Value) -> Gc<Shape> {
    ModuleNamespace::create_shape(cx, prototype)
}

#[export]
fn module_namespace_override_export(
    namespace: &ModuleNamespace,
    cx: &mut Cx,
    name: PropertyName<'_>,
    value: Value,
) -> JsResult<bool> {
    namespace.override_export(cx, &name.to_identifier(), value)
}

// The registry

#[export]
fn registry_entry_ensure_fetch_promise(entry: &ModuleRegistryEntry, cx: &Cx) -> Gc<JsPromise> {
    entry.ensure_fetch_promise(cx)
}

#[export]
fn registry_entry_ensure_module_promise(entry: &ModuleRegistryEntry, cx: &Cx) -> Gc<JsPromise> {
    entry.ensure_module_promise(cx)
}

#[export]
fn registry_entry_set_fetch_error(entry: &ModuleRegistryEntry, vm: &Vm, error: Value) {
    entry.set_fetch_error(vm, error);
}

#[export]
fn registry_entry_provide_module(
    entry: &ModuleRegistryEntry,
    vm: &Vm,
    module: Gc<AbstractModuleRecord>,
) {
    entry.provide_module(vm, module);
}

#[export]
fn registry_entry_is_loaded(entry: &ModuleRegistryEntry) -> bool {
    entry.is_loaded()
}

#[export]
fn registry_entry_mark_loaded(entry: &ModuleRegistryEntry) {
    entry.mark_loaded();
}

// Loaders

#[export]
fn module_loader_create(vm: &Vm, module_scope: Gc<JsCell>) -> Gc<ModuleLoader> {
    ModuleLoader::create(vm, module_scope)
}

#[export]
unsafe fn module_loader_for_each_entry(
    loader: &ModuleLoader,
    context: *mut c_void,
    visit: unsafe extern "C" fn(*mut c_void, Gc<ModuleRegistryEntry>),
) {
    for entry in loader.registry().values() {
        // SAFETY: the two go together.
        unsafe { visit(context, entry) };
    }
}

#[export]
fn module_loader_entry_count(loader: &ModuleLoader) -> usize {
    loader.registry().len()
}

#[export]
fn module_loader_find_entry_of_any_type(
    loader: &ModuleLoader,
    key: Option<PropertyName<'_>>,
) -> Option<Gc<ModuleRegistryEntry>> {
    loader.find_entry_of_any_type(key?)
}

#[export]
fn module_loader_find_entry(
    loader: &ModuleLoader,
    key: Option<PropertyName<'_>>,
    module_type: ModuleType,
) -> Option<Gc<ModuleRegistryEntry>> {
    loader.find_entry(ModuleKeyRef::new(key?, module_type))
}

#[export]
fn module_loader_ensure_entry(
    loader: &ModuleLoader,
    vm: &Vm,
    key: &Identifier,
    module_type: ModuleType,
) -> Gc<ModuleRegistryEntry> {
    loader.ensure_entry(vm, ModuleKeyRef::new(key.name(), module_type))
}

#[export]
fn module_loader_remove_entries(loader: &ModuleLoader, key: Option<PropertyName<'_>>) -> bool {
    key.is_some_and(|key| loader.remove_entries(key))
}

#[export]
fn module_loader_clear(loader: &ModuleLoader) {
    loader.clear();
}

#[export]
fn module_loader_async_evaluation_order(
    loader: &ModuleLoader,
    key: Option<PropertyName<'_>>,
) -> i64 {
    let order = key.and_then(|key| loader.async_evaluation_order(key));
    order.map_or(-1, u64::cast_signed)
}

#[export]
fn module_loader_shareable_executable(
    loader: &ModuleLoader,
    cx: &Cx,
    key: &Identifier,
) -> Option<Gc<ModuleExecutable>> {
    loader.shareable_executable(cx, key)
}

#[export]
fn module_loader_provide_fetch(
    loader: &ModuleLoader,
    cx: &Cx,
    key: &Identifier,
    module_type: ModuleType,
    data: Value,
) {
    loader.provide_fetch(cx, ModuleKeyRef::new(key.name(), module_type), data);
}

#[export]
fn module_loader_resolve(
    loader: &ModuleLoader,
    cx: &mut Cx,
    name: &Identifier,
    referrer: Option<&Identifier>,
    is_specifier: bool,
) -> JsResult<Identifier> {
    let kind = match is_specifier {
        true => ModuleName::Specifier,
        false => ModuleName::Entry,
    };
    loader.resolve(cx, name, referrer, kind)
}

#[export]
fn module_loader_make_module(
    loader: &ModuleLoader,
    cx: &mut Cx,
    key: &Identifier,
    data: Value,
) -> JsResult<Gc<JsPromise>> {
    loader.make_module(cx, key, data)
}

#[export]
fn module_loader_load(
    loader: &ModuleLoader,
    cx: &mut Cx,
    key: &Identifier,
    parameters: Option<FetchParametersRef>,
    evaluates: bool,
    is_dynamic: bool,
) -> JsResult<Gc<JsPromise>> {
    let goal = match (evaluates, is_dynamic) {
        (_, true) => LoadGoal::Import {
            phase: ImportPhase::Evaluation,
            referrer_order: None,
        },
        (true, false) => LoadGoal::Evaluate,
        (false, false) => LoadGoal::Load,
    };
    loader.load(cx, key, parameters.map(Rc::from), goal, None)
}

#[export]
fn module_loader_load_synchronously(
    loader: &ModuleLoader,
    cx: &mut Cx,
    key: &Identifier,
    parameters: Option<FetchParametersRef>,
) -> JsResult<Gc<JsPromise>> {
    loader.load_synchronously(cx, key, parameters.map(Rc::from))
}

#[export]
fn module_loader_request_import(
    loader: &ModuleLoader,
    cx: &mut Cx,
    specifier: &Identifier,
    referrer: Option<&Identifier>,
    parameters: Option<FetchParametersRef>,
) -> JsResult<Gc<JsPromise>> {
    let (parameters, phase) = (parameters.map(Rc::from), ImportPhase::Evaluation);
    loader.request_import(cx, specifier, referrer, parameters, phase, None)
}

#[export]
fn module_loader_request_import_of_key(
    loader: &ModuleLoader,
    cx: &mut Cx,
    key: &Identifier,
    referrer: Option<&Identifier>,
    parameters: Option<FetchParametersRef>,
    is_deferred: bool,
    referrer_order: i64,
) -> JsResult<Gc<JsPromise>> {
    let (parameters, order) = (parameters.map(Rc::from), referrer_order.try_into().ok());
    loader.request_import_of_key(cx, key, referrer, parameters, phase(is_deferred), order)
}

#[export]
fn load_and_evaluate_module(
    cx: &mut Cx,
    name: &Identifier,
    parameters: Option<FetchParametersRef>,
) -> JsResult<Gc<JsPromise>> {
    bun_engine_vm::load_and_evaluate_module(cx, name, parameters.map(Rc::from))
}
