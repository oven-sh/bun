use super::*;
use crate::builtins::table::RuntimeModule;

type PathParts<'a> = (Option<&'a str>, &'a [&'a str]);

fn paths_of_class(class: BuiltinClass) -> Vec<BuiltinTypePath<'static>> {
    let index = BuiltinClassIndex(class.to_wire());
    let paths = builtin_type_paths().into_iter();
    paths.filter(|path| path.class == index).collect()
}

fn find_value_path<'a>(paths: &[BuiltinValuePath<'a>], id: BuiltinId) -> Option<PathParts<'a>> {
    let index = BuiltinValueIndex(id.to_wire());
    let path = paths.iter().find(|path| path.value == index)?;
    Some((path.module, path.names))
}

fn has_value_path(platform: Platforms, id: BuiltinId) -> bool {
    let values = BuiltinValuePaths::collect(platform);
    find_value_path(&values.paths(), id).is_some()
}

#[test]
fn type_names_have_paths() {
    let paths = builtin_type_paths();
    let classes = BuiltinClass::ALL.into_iter();
    let type_name_count: usize = classes
        .map(|class| table::class_data(class).type_names.len())
        .sum();
    assert_eq!(paths.len(), type_name_count);
    for path in paths {
        let type_name = type_name_of(BuiltinTypeClass {
            class: path.class,
            type_name: path.type_name,
            denotation: path.denotation,
        });
        let type_name = type_name.unwrap();
        let (module, names) = split_module(type_name.path);
        assert_eq!((path.module, path.names), (module, names));
        assert!(!path.names.is_empty(), "{:?}", type_name.path);
    }
}

#[test]
fn paths_follow_class_and_declaration_order() {
    let paths = builtin_type_paths();
    let keys = paths.iter().map(|path| (path.class, path.type_name));
    assert!(keys.is_sorted_by(|left, right| left < right));
}

#[test]
fn map_and_view() {
    let paths = paths_of_class(BuiltinClass::Map);
    let described: Vec<_> = paths
        .iter()
        .map(|path| (path.module, path.names, path.denotation))
        .collect();
    let expected: [(Option<&str>, &[&str], Denotation); 2] = [
        (None, &["Map"], Denotation::Exact),
        (None, &["ReadonlyMap"], Denotation::View),
    ];
    assert_eq!(described, expected);
}

#[test]
fn nested_global_path_is_not_split() {
    let paths = paths_of_class(BuiltinClass::Glob);
    let described: Vec<_> = paths.iter().map(|path| (path.module, path.names)).collect();
    // The class of a schema also has the name that Bun's own modules ask for it by.
    let expected: [(Option<&str>, &[&str]); 2] =
        [(None, &["Bun", "Glob"]), (None, &["$Bindgen", "Glob"])];
    assert_eq!(described, expected);
}

#[test]
fn class_without_test_is_view() {
    assert!(!table::class_data(BuiltinClass::Function).has_instance_test);
    assert!(!paths_of_class(BuiltinClass::Function).is_empty());
    for path in builtin_type_paths() {
        let class = builtin_class_of(path.class).unwrap();
        let data = table::class_data(class);
        let is_view = data.type_names[path.type_name as usize].is_view;
        let expected = match data.has_instance_test && !is_view {
            true => Denotation::Exact,
            false => Denotation::View,
        };
        assert_eq!(path.denotation, expected, "{:?}", path.names);
    }
}

#[test]
fn module_path_is_split() {
    assert_eq!(
        split_module(&["bun:sqlite", "Database"]),
        (Some("bun:sqlite"), &["Database"][..])
    );
    assert_eq!(split_module(&["Bun", "Glob"]), (None, &["Bun", "Glob"][..]));
    assert_eq!(split_module(&["Map"]), (None, &["Map"][..]));
    let no_names: StaticNames = &[];
    assert_eq!(split_module(no_names), (None, no_names));
    for path in builtin_type_paths() {
        if let Some(module) = path.module {
            let found = table::module_by_specifier(module.as_bytes());
            assert!(found.is_some(), "{module}");
        }
    }
}

#[test]
fn indexes_round_trip() {
    for class in BuiltinClass::ALL {
        assert_eq!(
            builtin_class_of(BuiltinClassIndex(class.to_wire())),
            Some(class)
        );
    }
    for id in BuiltinId::ALL {
        assert_eq!(builtin_value_of(BuiltinValueIndex(id.to_wire())), Some(id));
    }
    assert_eq!(
        builtin_class_of(BuiltinClassIndex(BuiltinClass::COUNT)),
        None
    );
    assert_eq!(builtin_class_of(BuiltinClassIndex(u32::MAX)), None);
    assert_eq!(builtin_value_of(BuiltinValueIndex(BuiltinId::COUNT)), None);
    assert_eq!(builtin_value_of(BuiltinValueIndex(u32::MAX)), None);
}

#[test]
fn type_name_outside_class_is_none() {
    let map = BuiltinClassIndex(BuiltinClass::Map.to_wire());
    let type_name_count = table::class_data(BuiltinClass::Map).type_names.len() as u32;
    let type_class = |class, type_name| BuiltinTypeClass {
        class,
        type_name,
        denotation: Denotation::View,
    };
    assert!(type_name_of(type_class(map, 0)).is_some());
    assert!(type_name_of(type_class(map, type_name_count)).is_none());
    assert!(type_name_of(type_class(BuiltinClassIndex(u32::MAX), 0)).is_none());
}

#[test]
fn value_paths() {
    let values = BuiltinValuePaths::collect(Platforms::LINUX);
    let paths = values.paths();
    let heap_stats = table::own_member(
        table::namespace_of(RuntimeModule::BunJsc),
        table::find_name(b"heapStats").unwrap(),
    );
    let expected = [
        (BuiltinId::Fetch, (None, &["fetch"][..])),
        (BuiltinId::BunServe, (None, &["Bun", "serve"][..])),
        (BuiltinId::MathFloor, (None, &["Math", "floor"][..])),
        (BuiltinId::Map, (None, &["Map"][..])),
        (heap_stats.unwrap(), (Some("bun:jsc"), &["heapStats"][..])),
    ];
    for (id, path) in expected {
        let found = find_value_path(&paths, id);
        assert_eq!(found, Some(path), "{}", table::text_of(id));
    }
    assert!(paths.is_sorted_by(|left, right| left.value <= right.value));
}

#[test]
fn member_of_object_with_second_name_has_both_paths() {
    let values = BuiltinValuePaths::collect(Platforms::LINUX);
    let paths = values.paths();
    let fetch = BuiltinValueIndex(BuiltinId::Fetch.to_wire());
    let of_fetch = paths.iter().filter(|path| path.value == fetch);
    let of_fetch: Vec<PathParts<'_>> = of_fetch.map(|path| (path.module, path.names)).collect();
    let own: PathParts<'_> = (None, &["fetch"]);
    assert_eq!(of_fetch.first(), Some(&own));
    let under_second_names: [PathParts<'_>; 2] =
        [(None, &["global", "fetch"]), (None, &["self", "fetch"])];
    for path in under_second_names {
        assert!(of_fetch.contains(&path), "{path:?} in {of_fetch:?}");
    }
}

#[test]
fn excluded_values() {
    let values = BuiltinValuePaths::collect(Platforms::LINUX);
    let paths = values.paths();
    let excluded = [
        BuiltinId::ArrayPrototypePush,
        BuiltinId::ArrayPrototype,
        BuiltinId::Math,
        BuiltinId::MathPI,
        BuiltinId::ModuleRequire,
        BuiltinId::ModuleRequireResolve,
        BuiltinId::ImportMetaResolve,
        BuiltinId::BunBundleFeature,
        BuiltinId::GlobalThis,
    ];
    for id in excluded {
        assert_eq!(find_value_path(&paths, id), None, "{}", table::text_of(id));
    }
    for path in &paths {
        let id = builtin_value_of(path.value).unwrap();
        let entry = table::entry(id);
        let is_callable = can_have_call_signatures(entry.kind);
        assert!(is_callable, "{}", table::text_of(id));
        assert!(!table::is_symbol_name(entry.name), "{}", table::text_of(id));
        assert!(!path.names.is_empty(), "{}", table::text_of(id));
    }
}

#[test]
fn symbol_named_value_has_no_path() {
    let accessor = BuiltinId::ArraySymbolSpecies;
    assert!(table::is_symbol_name(table::entry(accessor).name));
    assert!(can_have_call_signatures(table::entry(accessor).kind));
    assert!(!has_value_path(Platforms::LINUX, accessor));
}

#[test]
fn value_of_other_platform_has_no_path() {
    assert!(has_value_path(Platforms::LINUX, BuiltinId::ProcessGetuid));
    assert!(!has_value_path(
        Platforms::WINDOWS,
        BuiltinId::ProcessGetuid
    ));
    assert!(has_value_path(Platforms::WINDOWS, BuiltinId::ProcessCwd));
}
