use super::*;
use crate::builtins::table::{BuiltinClass, RuntimeFunctionRole};

const LINUX: Platforms = Platforms::LINUX;

fn uses_of(mentioned: &[BuiltinId], exposed: &[BuiltinId]) -> RuntimeUses {
    let mentions = Mentions {
        mentioned,
        exposed,
        ..Mentions::default()
    };
    RuntimeUses::of_mentions(&mentions, LINUX)
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
    let may_hand_out_any = table::ENTRIES_THAT_MAY_HAND_OUT_ANY_HOST_OBJECT.contains(&id);
    let for_any_host_object: &[RuntimeFunction] = match may_hand_out_any {
        true => table::FUNCTIONS_FOR_ANY_HOST_OBJECT,
        false => &[],
    };
    let listed = entry
        .calls()
        .iter()
        .chain(entry.calls_where_call_runs_other_code())
        .chain(entry.implemented_by())
        .chain(entry.guessed_functions())
        .chain(for_texts)
        .chain(for_any_host_object)
        .copied();
    listed.filter(|&function| exists_on_linux(function))
}

fn lists_function(id: BuiltinId, function: RuntimeFunction) -> bool {
    own_functions(id).any(|listed| listed == function)
}

fn own_modules(id: BuiltinId) -> impl Iterator<Item = RuntimeModule> {
    table::entry(id).loads().iter().map(|load| load.module)
}

fn sorted_unique<T: Ord>(items: impl Iterator<Item = T>) -> Vec<T> {
    let mut sorted: Vec<T> = items.collect();
    sorted.sort_unstable();
    sorted.dedup();
    sorted
}

fn with_what_promises_can_do(
    functions: impl Iterator<Item = RuntimeFunction>,
) -> Vec<RuntimeFunction> {
    let of_promises = uses_of(&[BuiltinId::Promise], &[]);
    sorted_unique(functions.chain(of_promises.functions.iter().copied()))
}

fn reachable_entries(start: BuiltinId) -> Vec<BuiltinId> {
    let mut reached = vec![table::canonical_id(start)];
    let mut visited_count = 0;
    while let Some(&id) = reached.get(visited_count) {
        visited_count += 1;
        let entry = table::entry(id);
        let parent = match entry.prototype {
            Prototype::Builtin(parent) if !is_of_language(parent) => Some(parent),
            Prototype::Builtin(_) | Prototype::Unknown | Prototype::Null => None,
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
fn every_helper_of_the_compiler_comes_with_the_syntax_or_the_built_in_that_picks_it() {
    let every_syntax = AsksOfText {
        syntax: SyntaxWithHelpers::all(),
        ..AsksOfText::default()
    };
    let by_syntax = RuntimeUses::of_asks(&every_syntax, LINUX);
    let is_helper =
        |id: BuiltinId| (table::entry(id).flags).contains(BuiltinFlags::IS_COMPILER_HELPER);
    let built_ins: Vec<BuiltinId> = BuiltinId::ALL
        .into_iter()
        .filter(|&id| is_of_language(id) && !is_helper(id))
        .collect();
    let by_built_in = uses_of(&built_ins, &[]);
    let mut count = 0;
    for helper in BuiltinId::ALL {
        let entry = table::entry(helper);
        if !entry.flags.contains(BuiltinFlags::IS_COMPILER_HELPER) {
            continue;
        }
        for function in entry.implemented_by() {
            count += 1;
            assert!(
                by_syntax.functions.contains(function) || by_built_in.functions.contains(function),
                "{}",
                table::text_of(helper)
            );
        }
    }
    assert!(count > 20, "{count}");
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
    let mentions = Mentions {
        mentioned: &mentioned,
        called_with_other_texts: &[on],
        ..Mentions::default()
    };
    assert!(has_none(&RuntimeUses::of_mentions(&mentions, LINUX)));
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
fn whoever_is_handed_what_stands_below_a_prototype_linked_anew_loads_node_events() {
    let is_linked_anew = |id: BuiltinId| {
        let entry = table::entry(table::canonical_id(id));
        entry.kind == BuiltinKind::Prototype && matches!(entry.prototype, Prototype::Unknown)
    };
    let below = BuiltinId::ALL.into_iter().filter(|&id| {
        matches!(table::entry(id).prototype, Prototype::Builtin(above) if is_linked_anew(above))
    });
    let holders: Vec<BuiltinId> = below.collect();
    assert!(holders.contains(&BuiltinId::Process));
    for prototype in BuiltinId::ALL.into_iter().filter(|&id| is_linked_anew(id)) {
        assert_eq!(table::entry(prototype).holder, None, "{prototype:?}");
    }
    for holder in holders.into_iter().chain([BuiltinId::GlobalThis]) {
        let uses = uses_of(&[], &[holder]);
        assert!(
            uses.modules.contains(&RuntimeModule::NodeEvents),
            "{holder:?}"
        );
    }
    let mentioned = uses_of(&[BuiltinId::Process], &[]);
    assert!(!mentioned.modules.contains(&RuntimeModule::NodeEvents));
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
    assert_eq!(
        *uses.functions,
        *with_what_promises_can_do(reached_functions)
    );

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
    assert_eq!(
        *uses.functions,
        *with_what_promises_can_do(own_functions(method))
    );
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
    let language = RuntimeUses::of_unseen_code(LINUX);
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
    let language = RuntimeUses::of_unseen_code(LINUX);
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
fn unseen_code_finds_the_startup_modules_and_no_other() {
    assert_eq!(
        *RuntimeUses::of_unseen_code(LINUX).modules,
        *table::STARTUP_MODULES
    );
}

#[test]
fn unseen_code_finds_nothing_else() {
    let language = RuntimeUses::of_unseen_code(LINUX);
    let without_names = table::runtime_functions().iter();
    let without_names = without_names.filter(|data| is_called_without_a_name(data.role));
    let functions = language_entries()
        .flat_map(own_functions)
        .chain(own_functions(BuiltinId::UndeclaredNativeCode))
        .chain(table::FUNCTIONS_OF_OPEN_REALM.iter().copied())
        .chain(table::ACCESSOR_FUNCTIONS.iter().copied())
        .chain(table::MODULE_LOADER_FUNCTIONS.iter().copied())
        .chain(table::STARTUP_FUNCTIONS.iter().copied())
        .chain(table::FUNCTIONS_FOR_ANY_HOST_OBJECT.iter().copied())
        .chain(without_names.map(|data| data.function))
        .filter(|&function| exists_on_linux(function));
    assert_eq!(*language.functions, *sorted_unique(functions));
    let modules = language_entries().flat_map(own_modules);
    let modules = modules.chain(table::STARTUP_MODULES.iter().copied());
    assert_eq!(*language.modules, *sorted_unique(modules));
}

#[test]
fn function_of_other_platform_is_excluded() {
    let mut functions = table::runtime_functions().iter();
    let windows_only = functions
        .find(|data| data.platforms == Platforms::WINDOWS)
        .unwrap()
        .function;
    let mentions = Mentions {
        linked_functions: &[windows_only],
        ..Mentions::default()
    };
    let on = |platform| RuntimeUses::of_mentions(&mentions, platform);
    assert_eq!(on(LINUX), RuntimeUses::default());
    let on_windows = on(Platforms::WINDOWS);
    assert_eq!(*on_windows.functions, [windows_only]);

    let everything = uses_of(&[], &[BuiltinId::GlobalThis]);
    let language = RuntimeUses::of_unseen_code(LINUX);
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
    let mentions = Mentions {
        linked_functions: &linked,
        ..Mentions::default()
    };
    let uses = RuntimeUses::of_mentions(&mentions, LINUX);
    assert_eq!(*uses.functions, [first.function, second.function]);
    assert!(uses.modules.is_empty());
}

#[test]
fn unseen_code_finds_the_code_behind_the_language() {
    let held = RuntimeUses::of_unseen_code(LINUX);
    let mut functions = language_entries().flat_map(own_functions);
    assert!(functions.all(|function| held.functions.contains(&function)));
    for id in [
        BuiltinId::ArrayPrototypeSort,
        BuiltinId::FunctionPrototypeApply,
        BuiltinId::ArrayIteratorPrototypeNext,
        BuiltinId::CompilerHelpersStepIterator,
        BuiltinId::CompilerHelpersDecorateClass,
    ] {
        assert!(own_functions(id).next().is_some(), "{}", table::text_of(id));
    }
}

#[test]
fn class_of_the_language_whose_methods_are_native_needs_nothing() {
    for id in [
        BuiltinId::RangeError,
        BuiltinId::Date,
        BuiltinId::WeakMap,
        BuiltinId::Symbol,
        BuiltinId::FunctionPrototypeBind,
    ] {
        let found = uses_of(&[id], &[]);
        assert_eq!(found, RuntimeUses::default(), "{}", table::text_of(id));
    }
    let next = table::entry(BuiltinId::ArrayIteratorPrototypeNext).implemented_by();
    let walked = uses_of(&[BuiltinId::ArrayPrototypeValues], &[]);
    assert!(!next.is_empty());
    assert!(next.iter().all(|it| walked.functions.contains(it)));
}

#[test]
fn what_steps_the_list_of_call_sites_comes_with_the_member_that_takes_the_function() {
    let next = table::entry(BuiltinId::ArrayIteratorPrototypeNext).implemented_by();
    assert!(!next.is_empty());
    assert_eq!(uses_of(&[BuiltinId::Error], &[]), RuntimeUses::default());
    let named = uses_of(&[BuiltinId::ErrorPrepareStackTrace], &[]);
    assert!(next.iter().all(|it| named.functions.contains(it)));
    let held = RuntimeUses::of_unseen_code(LINUX);
    assert!(next.iter().all(|it| held.functions.contains(it)));
}

#[test]
fn a_promise_makes_the_host_call_nothing_and_the_option_that_warns_has_an_entry_of_its_own() {
    assert!(table::entry(BuiltinId::Promise).calls().is_empty());
    let warned_with = table::entry(BuiltinId::WarningsOfRejections).calls();
    assert!(!warned_with.is_empty());
    let of_a_promise = uses_of(&[BuiltinId::Promise], &[]);
    let mut called = warned_with.iter();
    assert!(called.all(|function| !of_a_promise.functions.contains(function)));
    let of_the_option = uses_of(
        &[BuiltinId::WarningsOfRejections],
        &[BuiltinId::WarningsOfRejections],
    );
    let mut called = warned_with.iter();
    assert!(called.all(|function| of_the_option.functions.contains(function)));
}

#[test]
fn compiler_helper_that_makes_no_promise_brings_nothing_of_promises() {
    let of_promise = table::entry(BuiltinId::Promise).implemented_by();
    assert!(!of_promise.is_empty());
    let needs_it = |helper: BuiltinId| {
        let found = uses_of(&[helper], &[]);
        let mut code = of_promise.iter();
        code.any(|function| found.functions.contains(function))
    };
    for helper in [
        BuiltinId::CompilerHelpersOpenIterator,
        BuiltinId::CompilerHelpersStepIterator,
        BuiltinId::CompilerHelpersCloseIterator,
        BuiltinId::CompilerHelpersDecorateClass,
    ] {
        assert!(!needs_it(helper), "{}", table::text_of(helper));
    }
    assert!(needs_it(BuiltinId::CompilerHelpersImportRejectedByLoader));
}

#[test]
fn file_that_comes_by_a_symbol_of_the_host_asks_for_no_module() {
    for id in [
        BuiltinId::SymbolFor,
        BuiltinId::ReflectOwnKeys,
        BuiltinId::ObjectGetOwnPropertyDescriptors,
    ] {
        assert!(
            uses_of(&[id], &[]).modules.is_empty(),
            "{}",
            table::text_of(id)
        );
    }
}

fn name_of(id: BuiltinId) -> BuiltinName {
    table::entry(id).name
}

fn holds_code_of(uses: &RuntimeUses, id: BuiltinId) -> bool {
    let mut own = table::entry(id).implemented_by().iter();
    assert!(own.len() > 0, "{}", table::text_of(id));
    own.all(|function| uses.functions.contains(function))
}

fn leads_to_host(uses: &RuntimeUses) -> bool {
    let mut functions = uses.functions.iter();
    functions.any(|&function| {
        let data = table::runtime_function(function).unwrap();
        data.role == RuntimeFunctionRole::HostBuiltin
    })
}

#[test]
fn name_that_is_read_brings_the_members_of_that_name_alone() {
    let names = [name_of(BuiltinId::ArrayPrototypeMap)];
    let mentions = Mentions {
        members_read: &names,
        ..Mentions::default()
    };
    let uses = RuntimeUses::of_mentions(&mentions, LINUX);
    assert!(holds_code_of(&uses, BuiltinId::ArrayPrototypeMap));
    assert!(holds_code_of(&uses, BuiltinId::IteratorPrototypeMap));
    assert!(!holds_code_of(&uses, BuiltinId::ArrayPrototypeFilter));
    assert!(!leads_to_host(&uses));
}

#[test]
fn name_finds_no_member_of_a_namespace() {
    assert_eq!(
        name_of(BuiltinId::ReflectGet),
        name_of(BuiltinId::MapPrototypeGet)
    );
    let names = [name_of(BuiltinId::ReflectGet)];
    let mentions = Mentions {
        members_read: &names,
        ..Mentions::default()
    };
    let uses = RuntimeUses::of_mentions(&mentions, LINUX);
    assert!(!holds_code_of(&uses, BuiltinId::ReflectGet));
    assert!(!holds_code_of(&uses, BuiltinId::ArrayPrototypeMap));
}

#[test]
fn key_that_nobody_knows_brings_all_that_the_language_has() {
    let by_key = Mentions {
        reads_by_unknown_key: true,
        ..Mentions::default()
    };
    let by_key = RuntimeUses::of_mentions(&by_key, LINUX);
    for reader in [
        BuiltinId::ReflectGet,
        BuiltinId::ObjectGetOwnPropertyDescriptor,
    ] {
        assert!(includes(&uses_of(&[reader], &[]), &by_key));
    }
    let mut functions = language_entries().flat_map(|id| table::entry(id).implemented_by());
    assert!(
        functions
            .all(|function| !exists_on_linux(*function) || by_key.functions.contains(function))
    );
    assert!(!includes(&by_key, &RuntimeUses::of_unseen_code(LINUX)));
}

#[test]
fn syntax_brings_the_helpers_that_are_written_for_it() {
    let of_syntax = |syntax: SyntaxWithHelpers| {
        let mentions = Mentions {
            syntax,
            ..Mentions::default()
        };
        RuntimeUses::of_mentions(&mentions, LINUX)
    };
    let walk = of_syntax(SyntaxWithHelpers::ITERATION);
    assert!(holds_code_of(&walk, BuiltinId::CompilerHelpersStepIterator));
    assert!(holds_code_of(&walk, BuiltinId::ArrayIteratorPrototypeNext));
    assert!(holds_code_of(&walk, BuiltinId::GeneratorPrototypeReturn));
    assert!(!holds_code_of(
        &walk,
        BuiltinId::CompilerHelpersDecorateClass
    ));
    assert!(!leads_to_host(&walk));
    let decorated = of_syntax(SyntaxWithHelpers::DECORATOR);
    assert!(holds_code_of(
        &decorated,
        BuiltinId::CompilerHelpersDecorateClass
    ));
    assert!(!holds_code_of(
        &decorated,
        BuiltinId::CompilerHelpersStepIterator
    ));
    let disposed = of_syntax(SyntaxWithHelpers::DISPOSAL);
    assert!(holds_code_of(
        &disposed,
        BuiltinId::CompilerHelpersGetDisposeMethod
    ));
    assert!(holds_code_of(
        &disposed,
        BuiltinId::DisposableStackPrototypeDispose
    ));
}

#[test]
fn what_promises_can_do_comes_with_the_first_thing_that_makes_one() {
    let awaited = Mentions {
        syntax: SyntaxWithHelpers::PROMISE,
        ..Mentions::default()
    };
    let awaited = RuntimeUses::of_mentions(&awaited, LINUX);
    let made_by_name = [name_of(BuiltinId::ArrayFromAsync)];
    let made_by_name = Mentions {
        members_read: &made_by_name,
        ..Mentions::default()
    };
    let made_by_name = RuntimeUses::of_mentions(&made_by_name, LINUX);
    for uses in [
        &awaited,
        &made_by_name,
        &uses_of(&[BuiltinId::PromiseResolve], &[]),
    ] {
        assert!(holds_code_of(uses, BuiltinId::PromiseAll));
        assert!(holds_code_of(uses, BuiltinId::PromiseTry));
        assert!(!leads_to_host(uses));
    }
    let names = [BuiltinId::PromisePrototypeThen, BuiltinId::PromiseAll].map(name_of);
    let only_named = Mentions {
        members_read: &names,
        ..Mentions::default()
    };
    let only_named = RuntimeUses::of_mentions(&only_named, LINUX);
    assert!(holds_code_of(&only_named, BuiltinId::PromiseTry));
}

#[test]
fn class_of_the_language_that_is_only_made_leads_to_no_code_of_the_host() {
    for id in [
        BuiltinId::Error,
        BuiltinId::Map,
        BuiltinId::Set,
        BuiltinId::Date,
        BuiltinId::JSON,
        BuiltinId::RegExp,
        BuiltinId::WeakMap,
    ] {
        assert!(
            !leads_to_host(&uses_of(&[id], &[])),
            "{}",
            table::text_of(id)
        );
    }
}

#[test]
fn program_that_lets_in_what_nobody_names_says_so() {
    let holds_all = |mentioned: &[BuiltinId], called: &[BuiltinId], is_of_program: bool| {
        let mentions = Mentions {
            mentioned,
            called,
            is_of_program,
            ..Mentions::default()
        };
        RuntimeUses::of_mentions(&mentions, LINUX).lets_in_what_nobody_names
    };
    for id in [BuiltinId::Eval, BuiltinId::SymbolFor] {
        assert!(holds_all(&[id], &[id], true), "{}", table::text_of(id));
        assert!(!holds_all(&[id], &[id], false), "{}", table::text_of(id));
        assert!(!holds_all(&[id], &[], true), "{}", table::text_of(id));
    }
    for id in [BuiltinId::BunInspectCustom, BuiltinId::Buffer] {
        assert!(holds_all(&[id], &[], true), "{}", table::text_of(id));
        assert!(!holds_all(&[id], &[], false), "{}", table::text_of(id));
    }
    assert!(!holds_all(
        &[BuiltinId::ConsoleLog],
        &[BuiltinId::ConsoleLog],
        true
    ));
}
