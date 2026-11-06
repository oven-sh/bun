use super::super::*;
use super::{all_ids, name};

fn module_flags(module: RuntimeModule) -> ModuleFlags {
    module_data(module).flags
}

fn has_source(module: RuntimeModule) -> bool {
    module_flags(module).contains(ModuleFlags::HAS_SOURCE)
}

#[test]
fn namespaces_belong_to_modules() {
    for module in RuntimeModule::ALL {
        let namespace = namespace_of(module);
        assert_eq!(namespace, module_data(module).namespace);
        let owner = entry(namespace).module;
        assert_eq!(owner, Some(module), "{}", text_of(namespace));
    }
    assert_eq!(namespace_of(RuntimeModule::Bun), BuiltinId::Bun);
    assert_eq!(namespace_of(RuntimeModule::NodeProcess), BuiltinId::Process);
    assert_eq!(entry(BuiltinId::Math).module, None);
}

#[test]
fn specifier_finds_module() {
    assert_eq!(module_by_specifier(b"node:fs"), Some(RuntimeModule::NodeFs));
    assert_eq!(
        module_by_specifier(b"bun:sqlite"),
        Some(RuntimeModule::BunSqlite)
    );
    assert_eq!(module_by_specifier(b"bun"), Some(RuntimeModule::Bun));
    for module in RuntimeModule::ALL {
        let specifier = module_data(module).specifier;
        let found = module_by_specifier(specifier.as_bytes());
        assert_eq!(found, Some(module), "{specifier}");
    }
}

#[test]
fn other_text_finds_no_module() {
    assert_eq!(module_by_specifier(b"node:no-such-module"), None);
    assert_eq!(module_by_specifier(b"NodeFs"), None);
    assert_eq!(module_by_specifier(b"Bun"), None);
    assert_eq!(module_by_specifier(b""), None);
}

#[test]
fn module_export_lists() {
    let lists_all_exports = |module| module_flags(module).contains(ModuleFlags::LISTS_ALL_EXPORTS);
    assert!(lists_all_exports(RuntimeModule::BunJsc));
    assert!(lists_all_exports(RuntimeModule::NodeBuffer));
    assert!(lists_all_exports(RuntimeModule::NodeModule));
    assert!(!lists_all_exports(RuntimeModule::NodeConstants));
    assert!(!lists_all_exports(RuntimeModule::Bun));
    assert!(!lists_all_exports(RuntimeModule::NodeFs));
    assert!(!lists_all_exports(RuntimeModule::NodeProcess));
    for module in RuntimeModule::ALL
        .into_iter()
        .filter(|&module| lists_all_exports(module))
    {
        let open_or_compiled = ModuleFlags::HAS_SOURCE | ModuleFlags::HAS_OPEN_NAMESPACE;
        let is_either = module_flags(module).intersects(open_or_compiled);
        assert!(!is_either, "{}", module.name());
    }
}

#[test]
fn open_namespace() {
    assert!(module_flags(RuntimeModule::Bun).contains(ModuleFlags::HAS_OPEN_NAMESPACE));
    assert!(!module_flags(RuntimeModule::BunJsc).contains(ModuleFlags::HAS_OPEN_NAMESPACE));
    let found = object_replacing_namespace(RuntimeModule::Bun);
    assert_eq!(found, Some(BuiltinId::Bun));
    assert_eq!(object_replacing_namespace(RuntimeModule::BunJsc), None);
    assert_eq!(object_replacing_namespace(RuntimeModule::NodeFs), None);
}

#[test]
fn modules_with_source() {
    assert!(has_source(RuntimeModule::NodeFs));
    assert!(has_source(RuntimeModule::BunSqlite));
    assert!(!has_source(RuntimeModule::BunJsc));
    assert!(!has_source(RuntimeModule::Bun));
}

fn default_export_of(module: RuntimeModule) -> ExportLookup {
    find_export(namespace_of(module), name("default"))
}

fn module_object_of(module: RuntimeModule) -> ExportLookup {
    ExportLookup::Found(namespace_of(module))
}

#[test]
fn default_export_is_the_module_object() {
    for module in [
        RuntimeModule::NodeFs,
        RuntimeModule::NodeEvents,
        RuntimeModule::BunJsc,
        RuntimeModule::NodeModule,
        RuntimeModule::NodeProcess,
        RuntimeModule::Bun,
    ] {
        let found = default_export_of(module);
        assert_eq!(found, module_object_of(module), "{}", module.name());
    }
}

#[test]
fn default_export_is_the_own_default_of_the_module_object() {
    let own_default = ExportLookup::Found(BuiltinId::BunSqliteDefault);
    assert_eq!(default_export_of(RuntimeModule::BunSqlite), own_default);
    assert_eq!(
        entry(BuiltinId::BunSqliteDefault).holder,
        Some(BuiltinId::BunSqlite)
    );
    assert_eq!(
        canonical_id(BuiltinId::BunSqliteDefault),
        BuiltinId::BunSqliteDefault
    );
}

#[test]
fn own_default_that_holds_the_module_object_is_the_module_object() {
    for module in [RuntimeModule::Undici, RuntimeModule::AbortController] {
        let found = default_export_of(module);
        assert_eq!(found, module_object_of(module), "{}", module.name());
    }
}

#[test]
fn export_that_only_the_namespace_holds() {
    let held = ExportLookup::HeldByNamespace;
    assert_eq!(default_export_of(RuntimeModule::Utf8Validate), held);
    assert_eq!(own_member(BuiltinId::Utf8Validate, name("default")), None);

    let abort_controller = namespace_of(RuntimeModule::AbortController);
    assert_eq!(find_export(abort_controller, name("__esModule")), held);
    assert_eq!(own_member(abort_controller, name("__esModule")), None);
    let signal = own_member(abort_controller, name("AbortSignal")).unwrap();
    assert_eq!(
        find_export(abort_controller, name("AbortSignal")),
        ExportLookup::Found(signal)
    );
}

#[test]
fn module_object_that_is_a_class_is_a_constructor_with_other_members() {
    let module_object = entry(namespace_of(RuntimeModule::AbortController));
    assert_eq!(module_object.kind, BuiltinKind::Constructor);
    let flags = module_object.flags;
    assert!(!flags.contains(BuiltinFlags::LISTS_ALL_MEMBERS));
}

#[test]
fn export_holds_one_result_of_a_getter_that_answers_another_object_each_time() {
    assert!(own_member(BuiltinId::NodeModule, name("wrapper")).is_some());
    let wrapper = find_export(BuiltinId::NodeModule, name("wrapper"));
    assert_eq!(wrapper, ExportLookup::HeldByNamespace);
}

#[test]
fn default_export_of_a_module_without_a_list_is_unlisted() {
    assert!(has_source(RuntimeModule::NodeFetch));
    assert!(members(namespace_of(RuntimeModule::NodeFetch)).is_empty());
    assert_eq!(
        default_export_of(RuntimeModule::NodeFetch),
        ExportLookup::Unlisted
    );
}

#[test]
fn named_export_is_the_member() {
    let database = own_member(BuiltinId::BunSqlite, name("Database")).unwrap();
    let found = find_export(BuiltinId::BunSqlite, name("Database"));
    assert_eq!(found, ExportLookup::Found(database));
    assert_eq!(
        find_export(BuiltinId::BunSqlite, name("push")),
        ExportLookup::Unlisted
    );
}

#[test]
fn default_export_flag_marks_bindings_to_module_objects() {
    let default = name("default");
    let is_marked = |id: BuiltinId| entry(id).flags.contains(BuiltinFlags::IS_DEFAULT_EXPORT);
    for id in all_ids().filter(|&id| is_marked(id)) {
        let holder = entry(id).holder.expect("an export has a holder");
        assert_eq!(entry(id).name, default, "{}", text_of(id));
        assert!(entry(holder).module.is_some(), "{}", text_of(id));
        assert_eq!(canonical_id(id), canonical_id(holder), "{}", text_of(id));
    }
    assert!(is_marked(BuiltinId::NodeFsDefault));
    assert!(is_marked(BuiltinId::BunJscDefault));
    assert!(!is_marked(BuiltinId::BunSqliteDefault));
}

#[test]
fn bundle_exports_have_hidden_root() {
    assert_eq!(entry(BuiltinId::BunBundle).holder, None);
    assert_eq!(entry(BuiltinId::BunBundle).module, None);
    assert_eq!(module_by_specifier(b"bun:bundle"), None);
    let found = own_member(BuiltinId::BunBundle, name("feature"));
    assert_eq!(found, Some(BuiltinId::BunBundleFeature));
    assert_eq!(find_name(b"bun:bundle").and_then(global), None);
}

#[test]
fn loads_name_modules_once() {
    for id in all_ids() {
        let loads = entry(id).loads();
        let is_ascending = loads.is_sorted_by(|left, right| left.module < right.module);
        assert!(is_ascending, "{}", text_of(id));
    }
    assert!(!entry(BuiltinId::ProcessStdout).loads().is_empty());
    assert!(entry(BuiltinId::MathFloor).loads().is_empty());
}
