use super::super::*;
use super::{all_ids, all_names, name};
use crate::ir::{ContentsSlot, WellKnownSymbol};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum NameRun {
    Text,
    WellKnownSymbol,
    RegisteredSymbol,
}

fn name_run(name: BuiltinName) -> NameRun {
    if !is_symbol_name(name) {
        NameRun::Text
    } else if find_symbol_name(text_of_name(name)) == Some(name) {
        NameRun::WellKnownSymbol
    } else {
        NameRun::RegisteredSymbol
    }
}

fn has_flag(id: BuiltinId, flag: BuiltinFlags) -> bool {
    entry(id).flags.contains(flag)
}

#[test]
fn member_spans_match_holders() {
    for id in all_ids() {
        let span = members(id);
        assert!(span.is_sorted_by(|&left, &right| entry(left).name < entry(right).name));
        assert!(span.iter().all(|&member| entry(member).holder == Some(id)));
        if let Some(holder) = entry(id).holder {
            assert!(members(holder).contains(&id), "{}", text_of(id));
            assert_eq!(own_member(holder, entry(id).name), Some(id));
        }
    }
}

#[test]
fn holder_chains_end() {
    for id in all_ids() {
        let mut object = id;
        let mut steps = 0;
        while let Some(holder) = entry(object).holder {
            steps += 1;
            assert!(steps < BuiltinId::COUNT, "cycle at {}", text_of(id));
            object = holder;
        }
        let root_holder = entry(root_of(id)).holder;
        assert!(matches!(root_holder, None | Some(BuiltinId::GlobalThis)));
    }
}

#[test]
fn prototype_chains_end() {
    for id in all_ids() {
        let mut object = id;
        let mut steps = 0;
        while let Prototype::Builtin(parent) = entry(object).prototype {
            steps += 1;
            assert!(steps <= 8, "{}", text_of(id));
            object = parent;
        }
    }
}

#[test]
fn names_ascend_in_each_run() {
    let names: Vec<(NameRun, &[u8])> = all_names()
        .map(|name| (name_run(name), text_of_name(name)))
        .collect();
    assert!(names.is_sorted_by(|left, right| left < right));
    let well_known = names.iter().filter(|name| name.0 == NameRun::WellKnownSymbol);
    assert_eq!(well_known.count(), WellKnownSymbol::COUNT);
}

#[test]
fn text_finds_text_name() {
    for name in all_names().filter(|&name| !is_symbol_name(name)) {
        assert_eq!(find_name(text_of_name(name)), Some(name));
    }
    assert_eq!(find_name(b"no such name"), None);
    assert_eq!(find_name(b""), None);
    assert_eq!(find_symbol_name(b"no such name"), None);
}

#[test]
fn global_lookup() {
    assert_eq!(global(name("globalThis")), Some(BuiltinId::GlobalThis));
    assert_eq!(global(name("Array")), Some(BuiltinId::Array));
    assert_eq!(global(name("push")), None);
}

#[test]
fn member_lookup() {
    let has_own_property = name("hasOwnProperty");
    assert_eq!(
        member(BuiltinId::Array, name("prototype")),
        MemberLookup::Found(BuiltinId::ArrayPrototype)
    );
    assert_eq!(
        member(BuiltinId::Array, name("isArray")),
        MemberLookup::Found(BuiltinId::ArrayIsArray)
    );
    assert_eq!(
        member(BuiltinId::Array, has_own_property),
        MemberLookup::Found(BuiltinId::ObjectPrototypeHasOwnProperty)
    );
    assert_eq!(own_member(BuiltinId::Array, has_own_property), None);
    assert_eq!(
        member(BuiltinId::ErrorPrototype, name("toString")),
        MemberLookup::Found(BuiltinId::ErrorPrototypeToString)
    );
}

#[test]
fn member_is_absent_below_listed_chain() {
    let push = name("push");
    assert_eq!(member(BuiltinId::ObjectPrototype, push), MemberLookup::Absent);
    assert_eq!(member(BuiltinId::Math, push), MemberLookup::Absent);
    assert_eq!(member(BuiltinId::Array, push), MemberLookup::Absent);
    assert_eq!(member(BuiltinId::Process, push), MemberLookup::Absent);
    assert_eq!(
        member(BuiltinId::ArrayPrototype, name("isArray")),
        MemberLookup::Absent
    );
}

#[test]
fn member_is_unknown_below_open_holder() {
    let push = name("push");
    assert_eq!(member(BuiltinId::Console, push), MemberLookup::Unknown);
    assert_eq!(member(BuiltinId::Bun, push), MemberLookup::Unknown);
    let open_holders = all_ids().filter(|&id| {
        canonical_id(id) == id && !has_flag(id, BuiltinFlags::LISTS_ALL_MEMBERS)
    });
    for holder in open_holders.filter(|&holder| own_member(holder, push).is_none()) {
        assert_eq!(member(holder, push), MemberLookup::Unknown, "{}", text_of(holder));
    }
}

#[test]
fn member_is_unknown_below_unknown_prototype() {
    let namespace = namespace_of(RuntimeModule::BunTest);
    assert!(has_flag(namespace, BuiltinFlags::LISTS_ALL_MEMBERS));
    assert_eq!(entry(namespace).prototype, Prototype::Unknown);
    assert_eq!(member(namespace, name("push")), MemberLookup::Unknown);
}

#[test]
fn member_search_starts_at_canonical_object() {
    assert_eq!(canonical_id(BuiltinId::Global), BuiltinId::GlobalThis);
    assert_eq!(
        member(BuiltinId::Global, name("Array")),
        MemberLookup::Found(BuiltinId::Array)
    );
    assert_eq!(own_member(BuiltinId::Global, name("Array")), None);
    assert_eq!(
        member(BuiltinId::NumberParseFloat, name("call")),
        member(BuiltinId::ParseFloat, name("call"))
    );
}

#[test]
fn symbol_members() {
    let iterator = name_of_symbol(WellKnownSymbol::Iterator);
    assert!(is_symbol_name(iterator));
    assert_eq!(find_symbol_name(b"iterator"), Some(iterator));
    assert_ne!(find_name(b"iterator"), Some(iterator));
    assert!(!is_symbol_name(name("iterator")));
    assert_eq!(find_name(b"@@iterator"), None);
    let found = member(BuiltinId::ArrayPrototype, iterator);
    assert_eq!(found, MemberLookup::Found(BuiltinId::ArrayPrototypeSymbolIterator));
    assert_eq!(
        canonical_id(BuiltinId::ArrayPrototypeSymbolIterator),
        BuiltinId::ArrayPrototypeValues
    );
    assert_eq!(member(BuiltinId::Math, iterator), MemberLookup::Absent);
}

#[test]
fn every_well_known_symbol_has_name() {
    for symbol in WellKnownSymbol::ALL {
        let constant = symbol_constant(symbol);
        assert_eq!(well_known_symbol(constant), Some(symbol));
        assert_eq!(entry(constant).holder, Some(BuiltinId::Symbol));
        assert_eq!(name_run(name_of_symbol(symbol)), NameRun::WellKnownSymbol);
        assert_eq!(text_of_name(name_of_symbol(symbol)), text_of_name(entry(constant).name));
    }
    assert_eq!(
        well_known_symbol(BuiltinId::SymbolIterator),
        Some(WellKnownSymbol::Iterator)
    );
    assert_eq!(well_known_symbol(BuiltinId::MathPI), None);
    assert_eq!(well_known_symbol(BuiltinId::Symbol), None);
}

#[test]
fn roots() {
    assert_eq!(root_of(BuiltinId::ArrayPrototypePush), BuiltinId::Array);
    assert_eq!(root_of(BuiltinId::Array), BuiltinId::Array);
    assert_eq!(root_of(BuiltinId::GlobalThis), BuiltinId::GlobalThis);
    assert_eq!(root_of(BuiltinId::ImportMetaPath), BuiltinId::ImportMeta);
}

#[test]
fn canonical_ids() {
    assert_eq!(
        canonical_id(BuiltinId::StringPrototypeTrimLeft),
        BuiltinId::StringPrototypeTrimStart
    );
    assert_eq!(canonical_id(BuiltinId::NumberParseFloat), BuiltinId::ParseFloat);
    assert_eq!(canonical_id(BuiltinId::MathMax), BuiltinId::MathMax);
    for id in all_ids() {
        let canonical = canonical_id(id);
        assert_eq!(canonical_id(canonical), canonical, "{}", text_of(id));
        assert!(canonical == id || members(id).is_empty(), "{}", text_of(id));
    }
}

#[test]
fn global_object_locations_hold_global_object() {
    assert!(has_flag(BuiltinId::GlobalThis, BuiltinFlags::IS_GLOBAL_OBJECT));
    assert!(has_flag(BuiltinId::Global, BuiltinFlags::IS_GLOBAL_OBJECT));
    assert!(!has_flag(BuiltinId::Math, BuiltinFlags::IS_GLOBAL_OBJECT));
    for id in all_ids().filter(|&id| has_flag(id, BuiltinFlags::IS_GLOBAL_OBJECT)) {
        assert_eq!(canonical_id(id), BuiltinId::GlobalThis, "{}", text_of(id));
    }
}

#[test]
fn texts() {
    let push = BuiltinId::ArrayPrototypePush;
    assert_eq!(text_of(push), "Array.prototype.push");
    assert_eq!(text_of_name(entry(push).name), b"push");
    assert_eq!(text_of(BuiltinId::GlobalThis), "globalThis");
    assert_eq!(text_of(BuiltinId::ModuleRequire), "%ModuleRequire%");
}

#[test]
fn prototypes() {
    let prototype = |id| entry(id).prototype;
    assert_eq!(prototype(BuiltinId::ObjectPrototype), Prototype::Null);
    assert_eq!(
        prototype(BuiltinId::ArrayPrototype),
        Prototype::Builtin(BuiltinId::ObjectPrototype)
    );
    assert_eq!(
        prototype(BuiltinId::MathMax),
        Prototype::Builtin(BuiltinId::FunctionPrototype)
    );
    assert_eq!(prototype(BuiltinId::MathPI), Prototype::Unknown);
}

#[test]
fn module_values_have_module_scope() {
    let roots = [
        BuiltinId::ModuleRequire,
        BuiltinId::ModuleObject,
        BuiltinId::ImportMeta,
    ];
    for root in roots {
        assert_eq!(entry(root).scope, Scope::Module, "{}", text_of(root));
        assert_eq!(entry(root).holder, None, "{}", text_of(root));
        assert!(!members(root).is_empty(), "{}", text_of(root));
    }
    for id in all_ids() {
        let root_scope = entry(root_of(id)).scope;
        assert_eq!(entry(id).scope, root_scope, "{}", text_of(id));
    }
    assert_eq!(entry(BuiltinId::Array).scope, Scope::Realm);
    assert_eq!(entry(BuiltinId::Process).scope, Scope::Realm);
}

#[test]
fn mutability_is_ordered() {
    assert!(Mutability::ChangesOnItsOwn < Mutability::ConstantUnlessWritten);
    assert!(Mutability::ConstantUnlessWritten < Mutability::AlwaysLocked);
}

#[test]
fn members_of_locked_object_are_locked() {
    assert!(has_flag(BuiltinId::ObjectPrototype, BuiltinFlags::IS_LOCKED_OBJECT));
    for &member in members(BuiltinId::ObjectPrototype) {
        let mutability = entry(member).mutability;
        assert_eq!(mutability, Mutability::AlwaysLocked, "{}", text_of(member));
    }
    assert!(has_flag(BuiltinId::Math, BuiltinFlags::HAS_LOCKED_MEMBERS));
    assert_eq!(entry(BuiltinId::MathFloor).mutability, Mutability::AlwaysLocked);
    let locks = BuiltinFlags::IS_LOCKED_OBJECT | BuiltinFlags::HAS_LOCKED_MEMBERS;
    assert!(!entry(BuiltinId::Error).flags.intersects(locks));
    assert_eq!(
        entry(BuiltinId::ErrorCaptureStackTrace).mutability,
        Mutability::ConstantUnlessWritten
    );
}

const MEMBERS_LEFT_WRITABLE: [BuiltinId; 55] = [
    BuiltinId::BufferPoolSize,
    BuiltinId::DateNow,
    BuiltinId::DateParse,
    BuiltinId::DatePrototypeToString,
    BuiltinId::DatePrototypeToLocaleString,
    BuiltinId::DatePrototypeToLocaleDateString,
    BuiltinId::DatePrototypeToLocaleTimeString,
    BuiltinId::IteratorPrototypeChunks,
    BuiltinId::IteratorPrototypeWindows,
    BuiltinId::JSONParse,
    BuiltinId::JSONStringify,
    BuiltinId::MapGroupBy,
    BuiltinId::MapPrototypeGetOrInsert,
    BuiltinId::MapPrototypeGetOrInsertComputed,
    BuiltinId::MathRandom,
    BuiltinId::MathSign,
    BuiltinId::MathSinh,
    BuiltinId::MathSumPrecise,
    BuiltinId::NumberParseFloat,
    BuiltinId::NumberParseInt,
    BuiltinId::PromiseTry,
    BuiltinId::RegExpEscape,
    BuiltinId::Uint8ArrayFromBase64,
    BuiltinId::Uint8ArrayFromHex,
    BuiltinId::Uint8ArrayPrototypeToBase64,
    BuiltinId::Uint8ArrayPrototypeToHex,
    BuiltinId::WeakMapPrototypeGetOrInsert,
    BuiltinId::WeakMapPrototypeGetOrInsertComputed,
    BuiltinId::FunctionPrototypeToString,
    BuiltinId::StringPrototypeAt,
    BuiltinId::StringPrototypeTrim,
    BuiltinId::StringPrototypeTrimEnd,
    BuiltinId::StringPrototypeTrimLeft,
    BuiltinId::StringPrototypeTrimRight,
    BuiltinId::StringPrototypeTrimStart,
    BuiltinId::StringPrototypeAnchor,
    BuiltinId::StringPrototypeBig,
    BuiltinId::StringPrototypeBlink,
    BuiltinId::StringPrototypeBold,
    BuiltinId::StringPrototypeFixed,
    BuiltinId::StringPrototypeFontcolor,
    BuiltinId::StringPrototypeFontsize,
    BuiltinId::StringPrototypeItalics,
    BuiltinId::StringPrototypeLink,
    BuiltinId::StringPrototypeSmall,
    BuiltinId::StringPrototypeStrike,
    BuiltinId::StringPrototypeSub,
    BuiltinId::StringPrototypeSup,
    BuiltinId::SetPrototypeUnion,
    BuiltinId::SetPrototypeIntersection,
    BuiltinId::SetPrototypeDifference,
    BuiltinId::SetPrototypeSymmetricDifference,
    BuiltinId::SetPrototypeIsSubsetOf,
    BuiltinId::SetPrototypeIsSupersetOf,
    BuiltinId::SetPrototypeIsDisjointFrom,
];

#[test]
fn locking_holders_lock_members_of_their_own() {
    let locks_members = BuiltinFlags::IS_LOCKED_OBJECT | BuiltinFlags::HAS_LOCKED_MEMBERS;
    let exempt = MEMBERS_LEFT_WRITABLE;
    for holder in all_ids().filter(|&id| entry(id).flags.intersects(locks_members)) {
        assert!(has_flag(holder, BuiltinFlags::LISTS_ALL_MEMBERS), "{}", text_of(holder));
        for &member in members(holder) {
            if exempt.contains(&member) {
                assert_eq!(entry(member).mutability, Mutability::ConstantUnlessWritten);
                continue;
            }
            let is_locked = entry(member).mutability == Mutability::AlwaysLocked;
            let is_of_instances = has_flag(member, BuiltinFlags::IS_OWN_PROPERTY_OF_INSTANCES);
            let is_match_state = holder == BuiltinId::RegExp
                && entry(member).mutability == Mutability::ChangesOnItsOwn;
            assert!(is_locked || is_of_instances || is_match_state, "{}", text_of(member));
        }
    }
}

#[test]
fn own_property_of_instances_is_not_locked_by_holder() {
    let properties = [
        (BuiltinId::ArrayPrototypeLength, Mutability::ChangesOnItsOwn),
        (BuiltinId::RegExpPrototypeLastIndex, Mutability::ChangesOnItsOwn),
        (BuiltinId::StringPrototypeLength, Mutability::AlwaysLocked),
    ];
    for (member, mutability) in properties {
        assert!(has_flag(member, BuiltinFlags::IS_OWN_PROPERTY_OF_INSTANCES));
        assert_eq!(entry(member).mutability, mutability, "{}", text_of(member));
    }
}

#[test]
fn only_holder_locked_by_name_leaves_member_writable() {
    for member in MEMBERS_LEFT_WRITABLE {
        let holder = entry(member).holder.unwrap();
        assert!(has_flag(holder, BuiltinFlags::HAS_LOCKED_MEMBERS), "{}", text_of(member));
    }
    for holder in all_ids().filter(|&id| has_flag(id, BuiltinFlags::IS_LOCKED_OBJECT)) {
        assert!(!has_flag(holder, BuiltinFlags::HAS_LOCKED_MEMBERS), "{}", text_of(holder));
        for &member in members(holder) {
            let is_locked = entry(member).mutability == Mutability::AlwaysLocked;
            let is_of_instances = has_flag(member, BuiltinFlags::IS_OWN_PROPERTY_OF_INSTANCES);
            assert!(is_locked || is_of_instances, "{}", text_of(member));
        }
    }
}

#[test]
fn regexp_prototype_is_closed_entirely() {
    let prototype = BuiltinId::RegExpPrototype;
    assert!(has_flag(prototype, BuiltinFlags::IS_LOCKED_OBJECT));
    assert!(!has_flag(prototype, BuiltinFlags::HAS_LOCKED_MEMBERS));
    let locked = [
        BuiltinId::RegExpPrototypeExec,
        BuiltinId::RegExpPrototypeSymbolReplace,
        BuiltinId::RegExpPrototypeFlags,
    ];
    for member in locked {
        let mutability = entry(member).mutability;
        assert_eq!(mutability, Mutability::AlwaysLocked, "{}", text_of(member));
    }
}

#[test]
fn string_prototype_locks_members_and_stays_extensible() {
    let prototype = BuiltinId::StringPrototype;
    assert!(has_flag(prototype, BuiltinFlags::HAS_LOCKED_MEMBERS));
    assert!(!has_flag(prototype, BuiltinFlags::IS_LOCKED_OBJECT));
    assert!(!has_flag(prototype, BuiltinFlags::IS_CLOSED_TO_OTHER_NAMES));
    let locked = [
        BuiltinId::StringPrototypeReplace,
        BuiltinId::StringPrototypeSymbolIterator,
    ];
    for member in locked {
        let mutability = entry(member).mutability;
        assert_eq!(mutability, Mutability::AlwaysLocked, "{}", text_of(member));
    }
}

#[test]
fn constructors_and_namespaces_lock_static_members() {
    let expected = [
        (BuiltinId::ObjectKeys, Mutability::AlwaysLocked),
        (BuiltinId::ArrayIsArray, Mutability::AlwaysLocked),
        (BuiltinId::NumberIsInteger, Mutability::AlwaysLocked),
        (BuiltinId::StringFromCharCode, Mutability::AlwaysLocked),
        (BuiltinId::ReflectGet, Mutability::AlwaysLocked),
        (BuiltinId::AtomicsAdd, Mutability::AlwaysLocked),
        (BuiltinId::MathImul, Mutability::AlwaysLocked),
        (BuiltinId::DateUTC, Mutability::AlwaysLocked),
        (BuiltinId::JSONParse, Mutability::ConstantUnlessWritten),
        (BuiltinId::RegExpEscape, Mutability::ConstantUnlessWritten),
        (BuiltinId::RegExpLastMatch, Mutability::ChangesOnItsOwn),
    ];
    for (member, mutability) in expected {
        let holder = entry(member).holder.unwrap();
        assert!(has_flag(holder, BuiltinFlags::HAS_LOCKED_MEMBERS), "{}", text_of(holder));
        assert_eq!(entry(member).mutability, mutability, "{}", text_of(member));
    }
}

#[test]
fn error_constructors_and_intl_are_not_locked() {
    let locks_members = BuiltinFlags::IS_LOCKED_OBJECT | BuiltinFlags::HAS_LOCKED_MEMBERS;
    for holder in [BuiltinId::Error, BuiltinId::TypeError, BuiltinId::Intl, BuiltinId::Function] {
        assert!(!entry(holder).flags.intersects(locks_members), "{}", text_of(holder));
        let mutability = entry(holder).mutability;
        assert_eq!(mutability, Mutability::ConstantUnlessWritten, "{}", text_of(holder));
    }
}

#[test]
fn weak_reference_and_error_prototypes_are_not_locked() {
    let locks_members = BuiltinFlags::IS_LOCKED_OBJECT | BuiltinFlags::HAS_LOCKED_MEMBERS;
    for member in [BuiltinId::WeakRefPrototypeDeref, BuiltinId::ErrorPrototypeToString] {
        let holder = entry(member).holder.unwrap();
        assert!(!entry(holder).flags.intersects(locks_members), "{}", text_of(holder));
        let mutability = entry(member).mutability;
        assert_eq!(mutability, Mutability::ConstantUnlessWritten, "{}", text_of(member));
    }
}

#[test]
fn species_is_locked() {
    let species = [
        BuiltinId::ArraySymbolSpecies,
        BuiltinId::MapSymbolSpecies,
        BuiltinId::SetSymbolSpecies,
        BuiltinId::RegExpSymbolSpecies,
        BuiltinId::ArrayBufferSymbolSpecies,
        BuiltinId::SharedArrayBufferSymbolSpecies,
    ];
    for member in species {
        let mutability = entry(member).mutability;
        assert_eq!(mutability, Mutability::AlwaysLocked, "{}", text_of(member));
    }
}

#[test]
fn object_closed_to_other_names_locks_members() {
    let is_closed = |id: &BuiltinId| has_flag(*id, BuiltinFlags::IS_CLOSED_TO_OTHER_NAMES);
    let mut holders: Vec<BuiltinId> = all_ids().filter(is_closed).collect();
    let mut expected = [
        BuiltinId::FunctionPrototype,
        BuiltinId::AsyncFunctionPrototype,
        BuiltinId::GeneratorFunctionPrototype,
        BuiltinId::AsyncGeneratorFunctionPrototype,
    ];
    holders.sort();
    expected.sort();
    assert_eq!(holders, expected);
    for holder in holders {
        assert!(has_flag(holder, BuiltinFlags::HAS_LOCKED_MEMBERS), "{}", text_of(holder));
        assert!(!has_flag(holder, BuiltinFlags::IS_LOCKED_OBJECT), "{}", text_of(holder));
    }
}

#[test]
fn generator_prototypes_are_closed_entirely() {
    for prototype in [BuiltinId::GeneratorPrototype, BuiltinId::AsyncGeneratorPrototype] {
        assert!(has_flag(prototype, BuiltinFlags::IS_LOCKED_OBJECT), "{}", text_of(prototype));
    }
    let links = [
        (BuiltinId::GeneratorFunctionPrototypePrototype, BuiltinId::GeneratorPrototype),
        (BuiltinId::AsyncGeneratorFunctionPrototypePrototype, BuiltinId::AsyncGeneratorPrototype),
        (BuiltinId::GeneratorPrototypeConstructor, BuiltinId::GeneratorFunctionPrototype),
        (BuiltinId::AsyncGeneratorPrototypeConstructor, BuiltinId::AsyncGeneratorFunctionPrototype),
    ];
    for (location, object) in links {
        assert_eq!(canonical_id(location), object, "{}", text_of(location));
        let mutability = entry(location).mutability;
        assert_eq!(mutability, Mutability::AlwaysLocked, "{}", text_of(location));
    }
}

#[test]
fn bindings_that_no_package_replaces_are_locked() {
    let locked = [
        BuiltinId::Object,
        BuiltinId::Array,
        BuiltinId::Number,
        BuiltinId::String,
        BuiltinId::Math,
        BuiltinId::JSON,
        BuiltinId::Reflect,
        BuiltinId::Map,
        BuiltinId::Set,
        BuiltinId::Uint8Array,
    ];
    for id in locked {
        assert_eq!(entry(id).mutability, Mutability::AlwaysLocked, "{}", text_of(id));
    }
    let open = [BuiltinId::Date, BuiltinId::Promise, BuiltinId::WeakMap, BuiltinId::Intl];
    for id in open {
        let mutability = entry(id).mutability;
        assert_eq!(mutability, Mutability::ConstantUnlessWritten, "{}", text_of(id));
    }
}

#[test]
fn symbol_binding_is_locked() {
    assert!(has_flag(BuiltinId::Symbol, BuiltinFlags::HAS_LOCKED_MEMBERS));
    assert!(!has_flag(BuiltinId::Symbol, BuiltinFlags::IS_LOCKED_OBJECT));
    assert_eq!(entry(BuiltinId::Symbol).mutability, Mutability::AlwaysLocked);
    assert_eq!(
        entry(BuiltinId::SymbolIterator).mutability,
        Mutability::AlwaysLocked
    );
}

#[test]
fn entries_without_holder_are_locked() {
    for id in all_ids().filter(|&id| entry(id).holder.is_none()) {
        let mutability = entry(id).mutability;
        assert_eq!(mutability, Mutability::AlwaysLocked, "{}", text_of(id));
    }
}

#[test]
fn mutability_of_host_locations() {
    assert_eq!(
        entry(BuiltinId::ConsoleLog).mutability,
        Mutability::ConstantUnlessWritten
    );
    assert_eq!(
        entry(BuiltinId::ProcessExitCode).mutability,
        Mutability::ChangesOnItsOwn
    );
}

#[test]
fn contents_indexes() {
    let index = contents_index;
    assert_eq!(index(BuiltinClass::Map, ContentsSlot::Key), Some(0));
    assert_eq!(index(BuiltinClass::Map, ContentsSlot::Value), Some(1));
    assert_eq!(index(BuiltinClass::Map, ContentsSlot::Element), None);
    assert_eq!(index(BuiltinClass::Promise, ContentsSlot::Value), Some(0));
    assert_eq!(index(BuiltinClass::Array, ContentsSlot::Element), Some(0));
    assert_eq!(index(BuiltinClass::Function, ContentsSlot::Element), None);
}

#[test]
fn class_objects_name_their_class() {
    for class in BuiltinClass::ALL {
        let data = class_data(class);
        for object in data.constructor.into_iter().chain(data.prototype) {
            assert_eq!(entry(object).class, Some(class), "{}", text_of(object));
        }
    }
    let array = class_data(BuiltinClass::Array);
    assert_eq!(array.constructor, Some(BuiltinId::Array));
    assert_eq!(array.prototype, Some(BuiltinId::ArrayPrototype));
}

#[test]
fn type_arguments_are_contents_of_class() {
    for class in BuiltinClass::ALL {
        let type_names = class_data(class).type_names.iter();
        let slots = type_names.flat_map(|type_name| type_name.type_arguments.iter().flatten());
        for &slot in slots {
            assert!(contents_index(class, slot).is_some(), "{}", class.name());
        }
    }
    let registry = class_data(BuiltinClass::FinalizationRegistry).type_names;
    assert_eq!(registry[0].type_arguments, [None]);
}

#[test]
fn instance_tests() {
    let has_instance_test = |class| class_data(class).has_instance_test;
    assert!(has_instance_test(BuiltinClass::Array));
    assert!(has_instance_test(BuiltinClass::Error));
    assert!(!has_instance_test(BuiltinClass::TypeError));
    assert!(!has_instance_test(BuiltinClass::Function));
    assert!(!has_instance_test(BuiltinClass::Number));
}

#[test]
fn platforms() {
    assert!(exists_on(BuiltinId::ProcessGetuid, Platforms::LINUX));
    assert!(exists_on(BuiltinId::ProcessGetuid, Platforms::DARWIN));
    assert!(!exists_on(BuiltinId::ProcessGetuid, Platforms::WINDOWS));
    assert_eq!(entry(BuiltinId::Array).platforms, Platforms::all());
    for id in all_ids() {
        assert!(!entry(id).platforms.is_empty(), "{}", text_of(id));
        if let Some(holder) = entry(id).holder {
            let holder_platforms = entry(holder).platforms;
            assert!(holder_platforms.contains(entry(id).platforms), "{}", text_of(id));
        }
    }
}

#[test]
fn text_evaluators_and_module_loaders() {
    assert!(has_flag(BuiltinId::Function, BuiltinFlags::EVALUATES_TEXT));
    assert!(has_flag(BuiltinId::Eval, BuiltinFlags::EVALUATES_TEXT));
    assert!(!has_flag(BuiltinId::MathMax, BuiltinFlags::EVALUATES_TEXT));
    let loads_module = BuiltinFlags::LOADS_MODULE_BY_NAME;
    assert!(has_flag(BuiltinId::ModuleRequire, loads_module));
    assert!(has_flag(BuiltinId::ProcessGetBuiltinModule, loads_module));
    assert!(!has_flag(BuiltinId::MathMax, loads_module));
}

#[test]
fn compiler_helpers_are_members_of_hidden_root() {
    assert!(!members(BuiltinId::CompilerHelpers).is_empty());
    for id in all_ids() {
        let is_member = entry(id).holder == Some(BuiltinId::CompilerHelpers);
        let is_helper = has_flag(id, BuiltinFlags::IS_COMPILER_HELPER);
        assert_eq!(is_helper, is_member, "{}", text_of(id));
    }
}

#[test]
fn listed_functions_are_in_table() {
    for id in all_ids() {
        let data = entry(id);
        for list in [data.calls(), data.implemented_by()] {
            assert!(list.is_sorted_by(|left, right| left < right), "{}", text_of(id));
            let mut functions = list.iter();
            assert!(functions.all(|&function| runtime_function(function).is_some()));
        }
    }
    for &function in STARTUP_FUNCTIONS.iter().chain(MODULE_LOADER_FUNCTIONS) {
        assert!(runtime_function(function).is_some(), "{function:?}");
    }
}

#[test]
fn entry_point_default_export_is_served() {
    let default = name("default");
    let mut reads = host_reads(HostReadContext::EntryPoint);
    let read = reads.find(|read| read.export_name == default).unwrap();
    let served = HostReadUse::PassedTo {
        builtin: BuiltinId::BunServe,
        argument: 0,
    };
    assert_eq!(read.read_use, served);
    let mut plugin_reads = host_reads(HostReadContext::Plugin);
    assert!(plugin_reads.all(|read| read.context == HostReadContext::Plugin));
    assert!(host_reads(HostReadContext::Plugin).all(|read| read.read_use != served));
}
