use super::super::*;
use super::{all_ids, all_names, name};
use crate::ir::{ContentsSlot, WellKnownSymbol};
use Mutability::{AlwaysLocked, ChangesOnItsOwn, ConstantUnlessWritten};

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum NameRun {
    Text,
    WellKnownSymbol,
    RegisteredSymbol,
}

fn name_run(name: BuiltinName) -> NameRun {
    let mut well_known = WellKnownSymbol::ALL.into_iter().map(name_of_symbol);
    if !is_symbol_name(name) {
        NameRun::Text
    } else if well_known.any(|symbol| symbol == name) {
        NameRun::WellKnownSymbol
    } else {
        NameRun::RegisteredSymbol
    }
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
    let well_known = names
        .iter()
        .filter(|name| name.0 == NameRun::WellKnownSymbol);
    assert_eq!(well_known.count(), WellKnownSymbol::COUNT);
}

#[test]
fn text_finds_text_name() {
    for name in all_names().filter(|&name| !is_symbol_name(name)) {
        assert_eq!(find_name(text_of_name(name)), Some(name));
    }
    assert_eq!(find_name(b"no such name"), None);
    assert_eq!(find_name(b""), None);
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
    let found = member(BuiltinId::Array, name("prototype"));
    assert_eq!(found, MemberLookup::Found(BuiltinId::ArrayPrototype));
    let found = member(BuiltinId::Array, name("isArray"));
    assert_eq!(found, MemberLookup::Found(BuiltinId::ArrayIsArray));
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
    assert_eq!(
        member(BuiltinId::ObjectPrototype, push),
        MemberLookup::Absent
    );
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
    let open_holders = all_ids()
        .filter(|&id| canonical_id(id) == id && !has_flag(id, BuiltinFlags::LISTS_ALL_MEMBERS));
    for holder in open_holders.filter(|&holder| own_member(holder, push).is_none()) {
        let found = member(holder, push);
        assert_eq!(found, MemberLookup::Unknown, "{}", text_of(holder));
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
    assert_ne!(find_name(b"iterator"), Some(iterator));
    assert!(!is_symbol_name(name("iterator")));
    assert_eq!(find_name(b"@@iterator"), None);
    let found = member(BuiltinId::ArrayPrototype, iterator);
    assert_eq!(
        found,
        MemberLookup::Found(BuiltinId::ArrayPrototypeSymbolIterator)
    );
    assert_eq!(
        canonical_id(BuiltinId::ArrayPrototypeSymbolIterator),
        BuiltinId::ArrayPrototypeValues
    );
    assert_eq!(member(BuiltinId::Math, iterator), MemberLookup::Absent);
}

#[test]
fn names_stored_by_native_code() {
    for stored in [
        // Members of built-in objects.
        "byteLength",
        "PI",
        "readFileSync",
        // Defined on new instances.
        "message",
        "sourceURL",
        "errors",
        "suppressed",
        // Fields of results.
        "done",
        "written",
        "reason",
        "groups",
        "indices",
        // Defined on an operand.
        "originalLine",
        "lastIndex",
        // Fields of an object that the host makes.
        "headersUrl",
    ] {
        assert!(is_stored_by_native_code(name(stored)), "{stored}");
    }
    assert!(is_stored_by_native_code(name_of_symbol(
        WellKnownSymbol::Iterator
    )));
    let mut members = all_ids().filter(|&id| entry(id).holder.is_some());
    assert!(members.all(|id| is_stored_by_native_code(entry(id).name)));
    // A text that is only ever a value.
    assert!(!is_stored_by_native_code(name("ERR_INVALID_ARG_TYPE")));
}

#[test]
fn every_well_known_symbol_has_name() {
    for symbol in WellKnownSymbol::ALL {
        let constant = symbol_constant(symbol);
        assert_eq!(well_known_symbol(constant), Some(symbol));
        assert_eq!(entry(constant).holder, Some(BuiltinId::Symbol));
        assert_eq!(
            text_of_name(name_of_symbol(symbol)),
            text_of_name(entry(constant).name)
        );
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
    let found = canonical_id(BuiltinId::StringPrototypeTrimLeft);
    assert_eq!(found, BuiltinId::StringPrototypeTrimStart);
    let found = canonical_id(BuiltinId::NumberParseFloat);
    assert_eq!(found, BuiltinId::ParseFloat);
    assert_eq!(canonical_id(BuiltinId::MathMax), BuiltinId::MathMax);
    for id in all_ids() {
        let canonical = canonical_id(id);
        assert_eq!(canonical_id(canonical), canonical, "{}", text_of(id));
        assert!(canonical == id || members(id).is_empty(), "{}", text_of(id));
    }
}

#[test]
fn global_object_locations_hold_global_object() {
    let is_global_object = |id| has_flag(id, BuiltinFlags::IS_GLOBAL_OBJECT);
    assert!(is_global_object(BuiltinId::GlobalThis) && is_global_object(BuiltinId::Global));
    assert!(!is_global_object(BuiltinId::Math));
    for id in all_ids().filter(|&id| is_global_object(id)) {
        assert_eq!(canonical_id(id), BuiltinId::GlobalThis, "{}", text_of(id));
    }
}

#[test]
fn texts() {
    let push = BuiltinId::ArrayPrototypePush;
    assert_eq!(text_of(push), "Array.prototype.push");
    assert_eq!(text_of_name(entry(push).name), b"push");
    assert_eq!(text_of(BuiltinId::GlobalThis), "globalThis");
    let iterator = text_of(BuiltinId::ArrayPrototypeSymbolIterator);
    assert_eq!(iterator, "Array.prototype[Symbol.iterator]");
    assert_eq!(text_of(BuiltinId::ModuleRequire), "%ModuleRequire%");
}

#[test]
fn prototypes() {
    let prototype = |id| entry(id).prototype;
    assert_eq!(prototype(BuiltinId::ObjectPrototype), Prototype::Null);
    let found = prototype(BuiltinId::ArrayPrototype);
    assert_eq!(found, Prototype::Builtin(BuiltinId::ObjectPrototype));
    let found = prototype(BuiltinId::MathMax);
    assert_eq!(found, Prototype::Builtin(BuiltinId::FunctionPrototype));
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

const IS_LOCKED_OBJECT: BuiltinFlags = BuiltinFlags::IS_LOCKED_OBJECT;
const HAS_LOCKED_MEMBERS: BuiltinFlags = BuiltinFlags::HAS_LOCKED_MEMBERS;
const LOCKS_MEMBERS: BuiltinFlags = IS_LOCKED_OBJECT.union(HAS_LOCKED_MEMBERS);

#[track_caller]
fn assert_flag(id: BuiltinId, flag: BuiltinFlags, is_set: bool) {
    assert_eq!(entry(id).flags.intersects(flag), is_set, "{}", text_of(id));
}

#[track_caller]
fn assert_mutability(ids: &[BuiltinId], mutability: Mutability) {
    for &id in ids {
        assert_eq!(entry(id).mutability, mutability, "{}", text_of(id));
    }
}

#[test]
fn members_of_locked_object_are_locked() {
    assert_flag(BuiltinId::ObjectPrototype, IS_LOCKED_OBJECT, true);
    assert_mutability(members(BuiltinId::ObjectPrototype), AlwaysLocked);
    assert_flag(BuiltinId::Math, HAS_LOCKED_MEMBERS, true);
    assert_mutability(&[BuiltinId::MathFloor], AlwaysLocked);
    assert_flag(BuiltinId::Error, LOCKS_MEMBERS, false);
    assert_mutability(&[BuiltinId::ErrorCaptureStackTrace], ConstantUnlessWritten);
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
    for holder in all_ids().filter(|&id| entry(id).flags.intersects(LOCKS_MEMBERS)) {
        assert_flag(holder, BuiltinFlags::LISTS_ALL_MEMBERS, true);
        for &member in members(holder) {
            if MEMBERS_LEFT_WRITABLE.contains(&member) {
                assert_eq!(entry(member).mutability, ConstantUnlessWritten);
                continue;
            }
            let is_locked = entry(member).mutability == AlwaysLocked;
            let is_of_instances = has_flag(member, BuiltinFlags::IS_OWN_PROPERTY_OF_INSTANCES);
            let is_match_state =
                holder == BuiltinId::RegExp && entry(member).mutability == ChangesOnItsOwn;
            let is_expected = is_locked || is_of_instances || is_match_state;
            assert!(is_expected, "{}", text_of(member));
        }
    }
}

#[test]
fn own_property_of_instances_is_not_locked_by_holder() {
    let properties = [
        (BuiltinId::ArrayPrototypeLength, ChangesOnItsOwn),
        (BuiltinId::RegExpPrototypeLastIndex, ChangesOnItsOwn),
        (BuiltinId::StringPrototypeLength, AlwaysLocked),
    ];
    for (member, mutability) in properties {
        assert!(has_flag(member, BuiltinFlags::IS_OWN_PROPERTY_OF_INSTANCES));
        assert_mutability(&[member], mutability);
    }
}

#[test]
fn only_holder_locked_by_name_leaves_member_writable() {
    for member in MEMBERS_LEFT_WRITABLE {
        assert_flag(entry(member).holder.unwrap(), HAS_LOCKED_MEMBERS, true);
    }
    for holder in all_ids().filter(|&id| has_flag(id, IS_LOCKED_OBJECT)) {
        assert_flag(holder, HAS_LOCKED_MEMBERS, false);
        for &member in members(holder) {
            let is_locked = entry(member).mutability == AlwaysLocked;
            let is_of_instances = has_flag(member, BuiltinFlags::IS_OWN_PROPERTY_OF_INSTANCES);
            assert!(is_locked || is_of_instances, "{}", text_of(member));
        }
    }
}

#[test]
fn regexp_prototype_is_closed_entirely() {
    assert_flag(BuiltinId::RegExpPrototype, IS_LOCKED_OBJECT, true);
    assert_flag(BuiltinId::RegExpPrototype, HAS_LOCKED_MEMBERS, false);
    let locked = [
        BuiltinId::RegExpPrototypeExec,
        BuiltinId::RegExpPrototypeSymbolReplace,
        BuiltinId::RegExpPrototypeFlags,
    ];
    assert_mutability(&locked, AlwaysLocked);
}

#[test]
fn string_prototype_locks_members_and_stays_extensible() {
    let prototype = BuiltinId::StringPrototype;
    assert_flag(prototype, HAS_LOCKED_MEMBERS, true);
    assert_flag(prototype, IS_LOCKED_OBJECT, false);
    assert_flag(prototype, BuiltinFlags::IS_CLOSED_TO_OTHER_NAMES, false);
    let locked = [
        BuiltinId::StringPrototypeReplace,
        BuiltinId::StringPrototypeSymbolIterator,
    ];
    assert_mutability(&locked, AlwaysLocked);
}

#[test]
fn constructors_and_namespaces_lock_static_members() {
    let expected = [
        (BuiltinId::ObjectKeys, AlwaysLocked),
        (BuiltinId::ArrayIsArray, AlwaysLocked),
        (BuiltinId::NumberIsInteger, AlwaysLocked),
        (BuiltinId::StringFromCharCode, AlwaysLocked),
        (BuiltinId::ReflectGet, AlwaysLocked),
        (BuiltinId::AtomicsAdd, AlwaysLocked),
        (BuiltinId::MathImul, AlwaysLocked),
        (BuiltinId::DateUTC, AlwaysLocked),
        (BuiltinId::JSONParse, ConstantUnlessWritten),
        (BuiltinId::RegExpEscape, ConstantUnlessWritten),
        (BuiltinId::RegExpLastMatch, ChangesOnItsOwn),
    ];
    for (member, mutability) in expected {
        assert_flag(entry(member).holder.unwrap(), HAS_LOCKED_MEMBERS, true);
        assert_mutability(&[member], mutability);
    }
}

#[test]
fn error_constructors_and_intl_are_not_locked() {
    let holders = [
        BuiltinId::Error,
        BuiltinId::TypeError,
        BuiltinId::Intl,
        BuiltinId::Function,
    ];
    for holder in holders {
        assert_flag(holder, LOCKS_MEMBERS, false);
    }
    assert_mutability(&holders, ConstantUnlessWritten);
}

#[test]
fn weak_reference_and_error_prototypes_are_not_locked() {
    let methods = [
        BuiltinId::WeakRefPrototypeDeref,
        BuiltinId::ErrorPrototypeToString,
    ];
    for method in methods {
        assert_flag(entry(method).holder.unwrap(), LOCKS_MEMBERS, false);
    }
    assert_mutability(&methods, ConstantUnlessWritten);
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
    assert_mutability(&species, AlwaysLocked);
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
        assert_flag(holder, HAS_LOCKED_MEMBERS, true);
        assert_flag(holder, IS_LOCKED_OBJECT, false);
    }
}

#[test]
fn generator_prototypes_are_closed_entirely() {
    assert_flag(BuiltinId::GeneratorPrototype, IS_LOCKED_OBJECT, true);
    assert_flag(BuiltinId::AsyncGeneratorPrototype, IS_LOCKED_OBJECT, true);
    let links = [
        (
            BuiltinId::GeneratorFunctionPrototypePrototype,
            BuiltinId::GeneratorPrototype,
        ),
        (
            BuiltinId::AsyncGeneratorFunctionPrototypePrototype,
            BuiltinId::AsyncGeneratorPrototype,
        ),
        (
            BuiltinId::GeneratorPrototypeConstructor,
            BuiltinId::GeneratorFunctionPrototype,
        ),
        (
            BuiltinId::AsyncGeneratorPrototypeConstructor,
            BuiltinId::AsyncGeneratorFunctionPrototype,
        ),
    ];
    for (location, object) in links {
        assert_eq!(canonical_id(location), object, "{}", text_of(location));
        assert_mutability(&[location], AlwaysLocked);
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
    assert_mutability(&locked, AlwaysLocked);
    let open = [
        BuiltinId::Date,
        BuiltinId::Promise,
        BuiltinId::WeakMap,
        BuiltinId::Intl,
    ];
    assert_mutability(&open, ConstantUnlessWritten);
}

#[test]
fn symbol_binding_is_locked() {
    assert_flag(BuiltinId::Symbol, HAS_LOCKED_MEMBERS, true);
    assert_flag(BuiltinId::Symbol, IS_LOCKED_OBJECT, false);
    let locked = [BuiltinId::Symbol, BuiltinId::SymbolIterator];
    assert_mutability(&locked, AlwaysLocked);
}

#[test]
fn entries_without_holder_are_locked() {
    let roots: Vec<BuiltinId> = all_ids().filter(|&id| entry(id).holder.is_none()).collect();
    assert_mutability(&roots, AlwaysLocked);
}

#[test]
fn mutability_of_host_locations() {
    assert_mutability(&[BuiltinId::ConsoleLog], ConstantUnlessWritten);
    assert_mutability(&[BuiltinId::ProcessExitCode], ChangesOnItsOwn);
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
            let is_where_holder_is = entry(holder).platforms.contains(entry(id).platforms);
            assert!(is_where_holder_is, "{}", text_of(id));
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
            let ascends = list.is_sorted_by(|left, right| left < right);
            assert!(ascends, "{}", text_of(id));
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
