use super::*;
use crate::builtins::table::{BuiltinClass, RuntimeFunctionRole};

const LINUX: Platforms = Platforms::LINUX;

fn uses_of(mentioned: &[BuiltinId], exposed: &[BuiltinId]) -> RuntimeUses {
    RuntimeUses::of_mentions(mentioned, &[], exposed, &[], LINUX)
}

fn includes(uses: &RuntimeUses, part: &RuntimeUses) -> bool {
    let mut modules = part.modules.iter();
    let mut functions = part.functions.iter();
    modules.all(|module| uses.modules.contains(module))
        && functions.all(|function| uses.functions.contains(function))
}

fn exists_on_linux(function: RuntimeFunction) -> bool {
    table::runtime_function(function).is_some_and(|data| data.platforms.contains(LINUX))
}

fn own_functions(id: BuiltinId) -> impl Iterator<Item = RuntimeFunction> {
    let entry = table::entry(id);
    let for_texts = entry
        .calls_for_texts()
        .iter()
        .flat_map(|listed| listed.calls);
    let listed = entry
        .calls()
        .iter()
        .chain(entry.implemented_by())
        .chain(for_texts)
        .copied();
    listed.filter(|&function| exists_on_linux(function))
}

fn lists_function(id: BuiltinId, function: RuntimeFunction) -> bool {
    own_functions(id).any(|listed| listed == function)
}

fn own_modules(id: BuiltinId) -> impl Iterator<Item = RuntimeModule> {
    table::entry(id).loads().iter().map(|load| load.module)
}

fn has_conditional_load(id: BuiltinId) -> bool {
    table::entry(id)
        .loads()
        .iter()
        .any(|load| load.is_conditional)
}

fn sorted_unique<T: Ord>(items: impl Iterator<Item = T>) -> Vec<T> {
    let mut sorted: Vec<T> = items.collect();
    sorted.sort_unstable();
    sorted.dedup();
    sorted
}

fn reachable_entries(start: BuiltinId) -> Vec<BuiltinId> {
    let mut reached = vec![table::canonical_id(start)];
    let mut visited_count = 0;
    while let Some(&id) = reached.get(visited_count) {
        visited_count += 1;
        let entry = table::entry(id);
        let parent = match entry.prototype {
            Prototype::Builtin(parent) => Some(parent),
            Prototype::Unknown | Prototype::Null => None,
        };
        let class = entry.class.map(table::class_data);
        let class_objects = class
            .into_iter()
            .flat_map(|data| data.constructor.into_iter().chain(data.prototype));
        let members = table::members(id).iter().copied();
        for neighbor in members.chain(parent).chain(class_objects) {
            let neighbor = table::canonical_id(neighbor);
            if !reached.contains(&neighbor) {
                reached.push(neighbor);
            }
        }
    }
    reached.retain(|&id| table::exists_on(id, LINUX));
    reached
}

fn language_entries() -> impl Iterator<Item = BuiltinId> {
    let entries = BuiltinId::ALL.into_iter().filter(|&id| {
        let entry = table::entry(id);
        entry.origin == Origin::Engine || entry.flags.contains(BuiltinFlags::IS_COMPILER_HELPER)
    });
    entries
        .map(table::canonical_id)
        .filter(|&id| table::exists_on(id, LINUX))
}

fn find_class_with_own_method_functions() -> Option<(BuiltinId, BuiltinId)> {
    BuiltinClass::ALL.into_iter().find_map(|class| {
        let data = table::class_data(class);
        let (constructor, prototype) = (data.constructor?, data.prototype?);
        let has_own_function = |method: &BuiltinId| {
            own_functions(*method).any(|function| !lists_function(constructor, function))
        };
        let method = table::members(prototype)
            .iter()
            .copied()
            .find(has_own_function)?;
        Some((constructor, method))
    })
}

#[test]
fn nothing_mentioned_needs_nothing() {
    assert_eq!(uses_of(&[], &[]), RuntimeUses::default());
}

#[test]
fn entry_without_lists_needs_nothing() {
    let found = uses_of(&[BuiltinId::MathFloor], &[]);
    assert_eq!(found, RuntimeUses::default());
}

#[test]
fn logging_needs_nothing() {
    let mentioned = [BuiltinId::Console, BuiltinId::ConsoleLog];
    assert_eq!(uses_of(&mentioned, &[]), RuntimeUses::default());
}

#[test]
fn lists_ascend_and_are_unique() {
    let stdout = BuiltinId::ProcessStdout;
    let uses = uses_of(
        &[stdout, stdout, stdout],
        &[BuiltinId::Process, BuiltinId::Process],
    );
    assert!(!uses.modules.is_empty() && !uses.functions.is_empty());
    assert!(uses.modules.is_sorted_by(|left, right| left < right));
    assert!(uses.functions.is_sorted_by(|left, right| left < right));
    let found = uses_of(&[stdout, stdout, stdout], &[]);
    assert_eq!(found, uses_of(&[stdout], &[]));
}

#[test]
fn mention_needs_own_lists() {
    let stdout = BuiltinId::ProcessStdout;
    assert!(own_modules(stdout).next().is_some());
    let uses = uses_of(&[stdout], &[]);
    assert_eq!(*uses.modules, *sorted_unique(own_modules(stdout)));
    assert_eq!(*uses.functions, *sorted_unique(own_functions(stdout)));
    let other = uses_of(&[BuiltinId::ProcessPid], &[]);
    assert!(own_modules(stdout).all(|module| !other.modules.contains(&module)));
}

#[test]
fn conditional_load_is_needed() {
    let mut ids = BuiltinId::ALL.into_iter();
    let id = ids
        .find(|&id| has_conditional_load(id) && table::exists_on(id, LINUX))
        .unwrap();
    let uses = uses_of(&[id], &[]);
    assert!(own_modules(id).all(|module| uses.modules.contains(&module)));
}

#[test]
fn call_with_another_text_does_without_what_some_texts_need() {
    let on = BuiltinId::EventEmitterPrototypeOn;
    let for_texts: Vec<RuntimeFunction> = table::entry(on)
        .calls_for_texts()
        .iter()
        .flat_map(|listed| listed.calls.iter().copied())
        .collect();
    assert!(!for_texts.is_empty());
    assert!(
        for_texts
            .iter()
            .all(|&function| !table::entry(on).calls().contains(&function))
    );
    let has_all = |uses: &RuntimeUses| {
        for_texts
            .iter()
            .all(|function| uses.functions.contains(function))
    };
    let has_none = |uses: &RuntimeUses| {
        for_texts
            .iter()
            .all(|function| !uses.functions.contains(function))
    };
    assert!(has_all(&uses_of(&[on], &[])));
    assert!(has_all(&uses_of(&[], &[BuiltinId::Process])));
    assert!(has_none(&uses_of(
        &[BuiltinId::EventEmitterPrototypeEmit],
        &[]
    )));
    let mentioned = [BuiltinId::Process, on];
    let uses = RuntimeUses::of_mentions(&mentioned, &[on], &[], &[], LINUX);
    assert!(has_none(&uses));
}

#[test]
fn mention_of_second_location_needs_lists_of_object() {
    let location = BuiltinId::DisposableStackPrototypeSymbolDispose;
    let object = table::canonical_id(location);
    assert_ne!(location, object);
    assert!(own_functions(object).next().is_some());
    assert_eq!(uses_of(&[location], &[]), uses_of(&[object], &[]));
}

#[test]
fn exposed_object_needs_members() {
    let uses = uses_of(&[], &[BuiltinId::Process]);
    assert!(includes(&uses, &uses_of(&[BuiltinId::ProcessStdout], &[])));
    let mentioned = uses_of(&[BuiltinId::Process], &[]);
    let mut stdout_modules = own_modules(BuiltinId::ProcessStdout);
    assert!(stdout_modules.all(|module| !mentioned.modules.contains(&module)));
}

#[test]
fn exposed_member_skips_holder() {
    let constructor = BuiltinId::BunRedisClient;
    assert_eq!(table::entry(constructor).holder, Some(BuiltinId::Bun));
    let reached = reachable_entries(constructor);
    assert!(!reached.contains(&BuiltinId::Bun));
    let uses = uses_of(&[], &[constructor]);
    let reached_modules = reached.iter().flat_map(|&id| own_modules(id));
    assert_eq!(*uses.modules, *sorted_unique(reached_modules));
    let reached_functions = reached.iter().flat_map(|&id| own_functions(id));
    assert_eq!(*uses.functions, *sorted_unique(reached_functions));

    assert!(own_modules(BuiltinId::BunSpawn).any(|module| !uses.modules.contains(&module)));
    let holder_uses = uses_of(&[], &[BuiltinId::Bun]);
    assert!(own_modules(BuiltinId::BunSpawn).all(|module| holder_uses.modules.contains(&module)));
}

#[test]
fn mentioned_class_needs_prototype() {
    let (constructor, method) = find_class_with_own_method_functions().unwrap();
    let uses = uses_of(&[constructor], &[]);
    assert!(own_functions(method).all(|function| uses.functions.contains(&function)));
    let prototype = table::entry(method).holder.unwrap();
    assert_eq!(uses_of(&[prototype], &[]), uses);
}

#[test]
fn mentioned_method_needs_no_sibling() {
    let (_, method) = find_class_with_own_method_functions().unwrap();
    assert_eq!(table::entry(method).class, None);
    let uses = uses_of(&[method], &[]);
    assert_eq!(*uses.functions, *sorted_unique(own_functions(method)));
}

#[test]
fn walk_ends_on_cycles() {
    let constructor = table::find_name(b"constructor").unwrap();
    let back_link = table::own_member(BuiltinId::ArrayPrototype, constructor).unwrap();
    assert_eq!(table::canonical_id(back_link), BuiltinId::Array);
    let everything = uses_of(&[], &[BuiltinId::GlobalThis]);
    for id in [BuiltinId::Process, BuiltinId::Bun, BuiltinId::Console] {
        let part = uses_of(&[], &[id]);
        assert!(includes(&everything, &part), "{}", table::text_of(id));
    }
}

#[test]
fn language_has_every_engine_function() {
    let language = RuntimeUses::of_language(LINUX);
    let mut engine_function_count = 0;
    for id in BuiltinId::ALL {
        let entry = table::entry(id);
        if entry.origin != Origin::Engine || !table::exists_on(id, LINUX) {
            continue;
        }
        for &function in entry.implemented_by() {
            let data = table::runtime_function(function).unwrap();
            if data.role == RuntimeFunctionRole::EngineBuiltin && data.platforms.contains(LINUX) {
                assert!(
                    language.functions.contains(&function),
                    "{}",
                    table::text_of(id)
                );
                engine_function_count += 1;
            }
        }
    }
    assert!(engine_function_count > 0);
}

#[test]
fn language_has_every_compiler_helper() {
    let language = RuntimeUses::of_language(LINUX);
    let helpers = table::members(BuiltinId::CompilerHelpers);
    assert!(
        helpers
            .iter()
            .any(|&helper| own_functions(helper).next().is_some())
    );
    for &helper in helpers {
        assert!(
            table::entry(helper)
                .flags
                .contains(BuiltinFlags::IS_COMPILER_HELPER)
        );
        let mut functions = own_functions(helper);
        assert!(
            functions.all(|function| language.functions.contains(&function)),
            "{}",
            table::text_of(helper)
        );
    }
}

#[test]
fn language_loads_no_module() {
    assert!(RuntimeUses::of_language(LINUX).modules.is_empty());
}

#[test]
fn language_lists_nothing_else() {
    let language = RuntimeUses::of_language(LINUX);
    let functions = language_entries().flat_map(own_functions);
    let functions = functions.chain(table::ACCESSOR_FUNCTIONS.iter().copied());
    assert_eq!(*language.functions, *sorted_unique(functions));
    let modules = language_entries().flat_map(own_modules);
    assert_eq!(*language.modules, *sorted_unique(modules));
}

#[test]
fn entry_of_other_platform_needs_nothing() {
    let mut entries = BuiltinId::ALL.iter().copied();
    let id = entries
        .find(|&id| !table::exists_on(id, Platforms::WINDOWS) && own_functions(id).next().is_some())
        .unwrap();
    assert!(!uses_of(&[id], &[]).functions.is_empty());
    let on_windows = RuntimeUses::of_mentions(&[id], &[], &[], &[], Platforms::WINDOWS);
    assert_eq!(on_windows, RuntimeUses::default());
}

#[test]
fn function_of_other_platform_is_excluded() {
    let mut functions = table::runtime_functions().iter();
    let windows_only = functions
        .find(|data| data.platforms == Platforms::WINDOWS)
        .unwrap()
        .function;
    let on = |platform| RuntimeUses::of_mentions(&[], &[], &[], &[windows_only], platform);
    assert_eq!(on(LINUX), RuntimeUses::default());
    let on_windows = on(Platforms::WINDOWS);
    assert_eq!(*on_windows.functions, [windows_only]);

    let everything = uses_of(&[], &[BuiltinId::GlobalThis]);
    let language = RuntimeUses::of_language(LINUX);
    for &function in everything.functions.iter().chain(language.functions.iter()) {
        assert!(exists_on_linux(function), "{function:?}");
    }
}

#[test]
fn linked_functions_are_needed() {
    let [first, second, ..] = table::runtime_functions() else {
        panic!("the table has fewer than two functions");
    };
    assert!(exists_on_linux(first.function) && exists_on_linux(second.function));
    let linked = [second.function, first.function, second.function];
    let uses = RuntimeUses::of_mentions(&[], &[], &[], &linked, LINUX);
    assert_eq!(*uses.functions, [first.function, second.function]);
    assert!(uses.modules.is_empty());
}
