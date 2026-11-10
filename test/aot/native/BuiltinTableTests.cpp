#include "root.h"

#include "HostEntries.h"
#include "NativeTests.h"
#include <JavaScriptCore/AOTBuiltinTable.h>
#include <JavaScriptCore/AOTBuiltinTableRealm.h>
#include <JavaScriptCore/AOTRuntimeDescription.h>
#include <JavaScriptCore/AOTVector.h>
#include <algorithm>
#include <initializer_list>
#include <wtf/HashSet.h>
#include <wtf/text/MakeString.h>

#if ENABLE(AOT)

namespace JSC { namespace AOT {

using Outcome = BuiltinMemberLookup::Outcome;

static const BuiltinTable& table() { return BuiltinTable::singleton(); }

template<typename ID>
static void forEachID(unsigned count, const Invocable<void(ID)> auto& functor)
{
    for (unsigned index = 0; index < count; ++index)
        functor(ID(index));
}

static void forEachBuiltin(const Invocable<void(BuiltinID, const Builtin&)> auto& functor)
{
    forEachID<BuiltinID>(table().builtinCount(), [&](BuiltinID id) {
        functor(id, table().at(id));
    });
}

static void testTokensRoundTrip()
{
    HashSet<String> tokens;
    uint32_t hash = 0x811c9dc5;
    forEachBuiltin([&](BuiltinID id, const Builtin&) {
        AOT_TEST_CHECK(!table().tokenOf(id).isEmpty() && tokens.add(table().tokenOf(id)).isNewEntry);
        for (char16_t character : StringView(table().tokenOf(id)).codeUnits())
            hash = (hash ^ character) * 0x01000193;
        hash *= 0x01000193;
        AOT_TEST_CHECK(table().builtinFromToken(table().tokenOf(id)) == id);
        unsigned indexInEntry = 0;
        for (BuiltinOverloadID overload : table().overloadIDsOf(id)) {
            AOT_TEST_CHECK(table().tokenOf(overload) == makeString(table().tokenOf(id), '/', indexInEntry++));
            AOT_TEST_CHECK(table().overloadFromToken(table().tokenOf(overload)) == overload);
        }
    });
    AOT_TEST_CHECK(hash == describedBuiltinTable.hashOfBuiltinTokens);
    forEachID<BuiltinClassID>(table().classCount(), [&](BuiltinClassID id) {
        AOT_TEST_CHECK(table().classFromToken(table().tokenOf(id)) == id);
    });
    forEachID<BuiltinSlotID>(table().slotCount(), [&](BuiltinSlotID id) {
        AOT_TEST_CHECK(table().slotFromToken(table().tokenOf(id)) == id);
        AOT_TEST_CHECK(table().tokenOf(id).startsWith(table().tokenOf(table().at(id).owner)));
    });
    forEachID<BuiltinLayoutID>(table().layoutCount(), [&](BuiltinLayoutID id) {
        AOT_TEST_CHECK(table().layoutFromToken(table().tokenOf(id)) == id);
    });
    forEachID<RuntimeModuleID>(table().moduleCount(), [&](RuntimeModuleID id) {
        AOT_TEST_CHECK(table().moduleFromToken(table().tokenOf(id)) == id);
    });

    AOT_TEST_CHECK(table().tokenOf(Builtins::ArrayPrototypePush) == "ArrayPrototypePush"_s && table().tokenOf(Builtins::MapPrototypeSymbolIterator) == "MapPrototypeSymbolIterator"_s);
    AOT_TEST_CHECK(table().tokenOf(hostBuiltin("NodeFsReadFile"_s)) == "NodeFsReadFile"_s && table().tokenOf(Builtins::GlobalThis) == "GlobalThis"_s);
    AOT_TEST_CHECK(table().tokenOf(BuiltinClasses::Map) == "Map"_s && table().tokenOf(BuiltinSlots::MapKey) == "MapKey"_s && table().tokenOf(BuiltinLayouts::IteratorResult) == "IteratorResult"_s);
}

static void testClassRelations()
{
    AOT_TEST_CHECK(table().isSameOrSubclassOf(BuiltinClasses::Int8Array, BuiltinClasses::TypedArray) && !table().isSameOrSubclassOf(BuiltinClasses::TypedArray, BuiltinClasses::Int8Array));
    AOT_TEST_CHECK(table().isSameOrSubclassOf(BuiltinClasses::Buffer, BuiltinClasses::Uint8Array) && table().isSameOrSubclassOf(BuiltinClasses::Buffer, BuiltinClasses::TypedArray));
    AOT_TEST_CHECK(!table().isSameOrSubclassOf(BuiltinClasses::Uint8Array, BuiltinClasses::Buffer) && !table().isSameOrSubclassOf(BuiltinClasses::Map, BuiltinClasses::Set));
    AOT_TEST_CHECK(!table().isSameOrSubclassOf(BuiltinClasses::Map, BuiltinClassID()));

    AOT_TEST_CHECK(table().typedArrayClassOf(BuiltinClasses::Int8Array) == BuiltinClasses::Int8Array && table().typedArrayTypeOf(BuiltinClasses::Int8Array) == TypeInt8);
    AOT_TEST_CHECK(table().typedArrayClassOf(BuiltinClasses::Buffer) == BuiltinClasses::Uint8Array && table().typedArrayTypeOf(BuiltinClasses::Buffer) == TypeUint8);
    AOT_TEST_CHECK(table().typedArrayTypeOf(BuiltinClasses::DataView) == NotTypedArray && table().typedArrayTypeOf(BuiltinClasses::TypedArray) == NotTypedArray && !table().typedArrayClassOf(BuiltinClasses::Array));
    AOT_TEST_CHECK(!table().typedArrayClassOf(BuiltinClasses::TypedArray) && !table().typedArrayClassOf(BuiltinClasses::Map) && !table().typedArrayClassOf(BuiltinClasses::Array));

    AOT_TEST_CHECK(table().at(BuiltinClasses::Array).constructor == Builtins::Array && table().at(BuiltinClasses::Array).prototype == Builtins::ArrayPrototype);
    AOT_TEST_CHECK(table().receiverClassOf(Builtins::ArrayPrototypePush) == BuiltinClasses::Array && table().receiverClassOf(Builtins::MapPrototypeEntries) == BuiltinClasses::Map);
    AOT_TEST_CHECK(!table().receiverClassOf(Builtins::ArrayOf) && !table().receiverClassOf(Builtins::MathMax) && !table().receiverClassOf(Builtins::GlobalThis));

    AOT_TEST_CHECK(table().at(BuiltinClasses::Array).origin == BuiltinOrigin::Engine && table().at(hostClass("Request"_s)).origin == BuiltinOrigin::Host);
    AOT_TEST_CHECK(table().at(hostClass("Request"_s)).instanceTest == BuiltinInstanceTest::ClassInfoInherits);
    AOT_TEST_CHECK(table().at(BuiltinClasses::Map).instanceTest == BuiltinInstanceTest::JSTypeEquals);
    AOT_TEST_CHECK(table().at(BuiltinClasses::ArrayBuffer).instanceTest == BuiltinInstanceTest::SharingModeEquals && table().at(BuiltinClasses::ArrayBuffer).sharingMode == ArrayBufferSharingMode::Default);
    AOT_TEST_CHECK(table().at(BuiltinClasses::SharedArrayBuffer).instanceTest == BuiltinInstanceTest::SharingModeEquals && table().at(BuiltinClasses::SharedArrayBuffer).sharingMode == ArrayBufferSharingMode::Shared);
}

static void testMembersAskedByByteAlone()
{
    AOT_TEST_CHECK(table().at(hostBuiltin("ObjectPrototype__proto__"_s)).mutability == BuiltinMutability::AlwaysLocked && !isMemberAskedByByteAlone(table(), hostBuiltin("ObjectPrototype__proto__"_s)));
    AOT_TEST_CHECK(isMemberAskedByByteAlone(table(), hostBuiltin("AbortSignalPrototypeAborted"_s)));
    AOT_TEST_CHECK(isMemberAskedByByteAlone(table(), hostBuiltin("AbortControllerPrototypeSignal"_s)));
    AOT_TEST_CHECK(!isMemberAskedByByteAlone(table(), Builtins::ArrayPrototypePush));
    AOT_TEST_CHECK(!isMemberAskedByByteAlone(table(), Builtins::ObjectPrototype));
    forEachBuiltin([&](BuiltinID id, const Builtin& builtin) {
        AOT_TEST_CHECK(builtin.kind != BuiltinKind::Accessor || !builtin.flags.contains(BuiltinFlag::IsCompilerHelper));
        if (!isMemberAskedByByteAlone(table(), id))
            return;
        AOT_TEST_CHECK(builtin.kind == BuiltinKind::Accessor && builtin.holder && builtin.name);
        AOT_TEST_CHECK(cellThatNamesMemberAskedByItsByte(table(), id) == BuiltinCellKey::getter(id) && !BuiltinCellKey::getter(id).hasCell(table()));
    });
}

static void testMemberMissingOnTargetIsNotFound()
{
    BuiltinID member = hostBuiltin("ProcessCwd"_s);
    BuiltinID holder = table().at(member).holder;
    BuiltinName name = table().at(member).name;
    AOT_TEST_CHECK(table().findOwnMember(holder, name) == member);
    AOT_TEST_CHECK(table().at(holder).flags.contains(BuiltinFlag::ListsAllMembers));

    Vector<Builtin> rows(builtinTableData.builtins);
    rows[member.index()].platforms.remove(targetOfThisBuild().platform);
    BuiltinTableData data = builtinTableData;
    data.builtins = rows.span();
    BuiltinTable tableWithoutMember(data);
    AOT_TEST_CHECK(!tableWithoutMember.existsOn(member, targetOfThisBuild().platform));
    AOT_TEST_CHECK(!tableWithoutMember.findOwnMember(holder, name));
    AOT_TEST_CHECK(tableWithoutMember.findMember(holder, name).outcome != Outcome::Found);
}

static void testLockedObjects()
{
    AOT_TEST_CHECK(table().at(Builtins::ObjectPrototype).flags.contains(BuiltinFlag::IsLockedObject));
    for (BuiltinID id : table().lockedObjects())
        AOT_TEST_CHECK(table().canonicalID(id) == table().canonicalID(Builtins::ObjectPrototype));
    for (BuiltinID id : std::initializer_list<BuiltinID> { Builtins::RegExpPrototype, Builtins::PromisePrototype, Builtins::GeneratorPrototype, Builtins::AsyncGeneratorPrototype, hostBuiltin("RequestPrototype"_s), hostBuiltin("ResponsePrototype"_s), hostBuiltin("BlobPrototype"_s), hostBuiltin("URLPrototype"_s), hostBuiltin("URLSearchParamsPrototype"_s), hostBuiltin("HeadersPrototype"_s) }) {
        AOT_TEST_CHECK(table().at(id).flags.contains(BuiltinFlag::HasLockedMembers) && !table().at(id).flags.containsAny({ BuiltinFlag::IsLockedObject, BuiltinFlag::IsClosedToOtherNames }));
        AOT_TEST_CHECK(table().hasLockedPrototypeLink(id) && table().closesIndexKeys(id));
        for (BuiltinID member : table().membersOf(id))
            AOT_TEST_CHECK(table().at(member).mutability == BuiltinMutability::AlwaysLocked || table().at(member).flags.contains(BuiltinFlag::IsOwnPropertyOfInstances));
        for (BuiltinName name : std::initializer_list<BuiltinName> { BuiltinNames::then, table().nameOf(WellKnownSymbol::ToPrimitive) })
            AOT_TEST_CHECK(table().findOwnMember(id, name) || table().isClosedKey(id, name));
    }
    AOT_TEST_CHECK(table().at(Builtins::ObjectPrototype).flags.contains(BuiltinFlag::ListsAllMembers) && table().at(Builtins::ArrayPrototype).flags.contains(BuiltinFlag::ListsAllMembers));
    for (BuiltinID id : std::initializer_list<BuiltinID> { Builtins::GlobalThis, Builtins::Math, Builtins::Array, Builtins::ArrayPrototype, Builtins::Object, Builtins::Map, Builtins::MapPrototype, Builtins::Promise, Builtins::Symbol, Builtins::IteratorPrototype, Builtins::ArrayIteratorPrototype, Builtins::Bun, hostBuiltin("Request"_s) })
        AOT_TEST_CHECK(!table().at(id).flags.contains(BuiltinFlag::IsLockedObject));

    AOT_TEST_CHECK(table().at(Builtins::ArrayPrototypePush).mutability == BuiltinMutability::AlwaysLocked);
    AOT_TEST_CHECK(table().at(Builtins::PromiseResolve).mutability == BuiltinMutability::AlwaysLocked);
    AOT_TEST_CHECK(table().at(Builtins::MathPI).mutability == BuiltinMutability::AlwaysLocked);
    AOT_TEST_CHECK(table().at(Builtins::Symbol).mutability == BuiltinMutability::AlwaysLocked && table().at(Builtins::SymbolIterator).mutability == BuiltinMutability::AlwaysLocked);
    for (BuiltinID id : { Builtins::Math, Builtins::MathMax, Builtins::MathImul })
        AOT_TEST_CHECK(table().at(id).mutability == BuiltinMutability::AlwaysLocked);
    for (BuiltinID id : { Builtins::Object, Builtins::ObjectKeys, Builtins::ObjectGetOwnPropertyNames, Builtins::Array, Builtins::ArrayOf, Builtins::Number, Builtins::NumberIsInteger, Builtins::String, Builtins::StringFromCharCode, Builtins::Map, Builtins::JSON, Builtins::Reflect, Builtins::ReflectGet, Builtins::Atomics, Builtins::AtomicsAdd, Builtins::Uint8Array, Builtins::RegExp, Builtins::Proxy, Builtins::DateUTC })
        AOT_TEST_CHECK(table().at(id).mutability == BuiltinMutability::AlwaysLocked);
    for (BuiltinID id : { Builtins::MathRandom, Builtins::MathSign, Builtins::MathSinh, Builtins::MathSumPrecise, Builtins::JSONParse, Builtins::JSONStringify, Builtins::NumberParseFloat, Builtins::NumberParseInt, Builtins::MapGroupBy, Builtins::PromiseTry, Builtins::RegExpEscape, Builtins::Date, Builtins::DateNow, Builtins::DateParse, Builtins::Promise, Builtins::WeakMap, Builtins::Intl, Builtins::Error, Builtins::ErrorCaptureStackTrace, Builtins::ErrorIsError, Builtins::Function })
        AOT_TEST_CHECK(table().at(id).mutability == BuiltinMutability::ConstantUnlessWritten);
}

static void testLockedMembers()
{
    for (BuiltinID id : { Builtins::StringPrototype, Builtins::Symbol, Builtins::SymbolPrototype, Builtins::MapPrototype, Builtins::SetPrototype, Builtins::ArrayPrototype, Builtins::Promise, Builtins::IteratorPrototype, Builtins::ArrayIteratorPrototype, Builtins::Math }) {
        AOT_TEST_CHECK(table().at(id).flags.contains(BuiltinFlag::HasLockedMembers) && !table().at(id).flags.contains(BuiltinFlag::IsClosedToOtherNames));
        AOT_TEST_CHECK(table().hasLockedPrototypeLink(id) && table().closesIndexKeys(id) == (table().at(id).kind == BuiltinKind::Prototype));
    }
    AOT_TEST_CHECK(table().at(Builtins::MapPrototypeEntries).mutability == BuiltinMutability::AlwaysLocked);
    AOT_TEST_CHECK(std::ranges::contains(table().lockedMembers(), Builtins::MapPrototypeEntries));
    AOT_TEST_CHECK(std::ranges::is_sorted(table().lockedMembers()));

    AOT_TEST_CHECK(table().at(Builtins::FunctionPrototype).flags.containsAll({ BuiltinFlag::HasLockedMembers, BuiltinFlag::IsClosedToOtherNames }));
    AOT_TEST_CHECK(table().openNamesOf(Builtins::FunctionPrototype).size() == 2 && std::ranges::is_sorted(table().openNamesOf(Builtins::FunctionPrototype)));
    for (BuiltinName name : table().openNamesOf(Builtins::FunctionPrototype))
        AOT_TEST_CHECK(!table().isClosedKey(Builtins::FunctionPrototype, name));
    for (BuiltinName name : std::initializer_list<BuiltinName> { BuiltinNames::then, BuiltinNames::push, hostName("Bun"_s), table().nameOf(WellKnownSymbol::ToPrimitive) })
        AOT_TEST_CHECK(table().isClosedKey(Builtins::FunctionPrototype, name));
    AOT_TEST_CHECK(!table().isClosedKey(Builtins::FunctionPrototype, BuiltinNames::toString) && !table().isClosedKey(Builtins::FunctionPrototype, BuiltinNames::call));
    AOT_TEST_CHECK(table().at(Builtins::FunctionPrototypeCall).mutability == BuiltinMutability::AlwaysLocked);
    AOT_TEST_CHECK(table().at(Builtins::FunctionPrototypeToString).mutability == BuiltinMutability::ConstantUnlessWritten);
    for (BuiltinID id : { Builtins::ObjectPrototypeHasOwnProperty, Builtins::ObjectPrototypeToString, Builtins::ArrayPrototypeSlice, Builtins::MathMax, Builtins::FunctionPrototypeBind }) {
        AOT_TEST_CHECK(table().isHostFunctionOfEngine(id) && table().hasLockedPrototypeLink(id));
        for (BuiltinName name : std::initializer_list<BuiltinName> { BuiltinNames::call, BuiltinNames::apply, BuiltinNames::bind, table().nameOf(WellKnownSymbol::HasInstance) })
            AOT_TEST_CHECK(table().isClosedKey(id, name));
        AOT_TEST_CHECK(!table().isClosedKey(id, BuiltinNames::toString) && !table().isClosedKey(id, BuiltinNames::then) && !table().isClosedKey(id, table().nameOf(WellKnownSymbol::ToPrimitive)));
    }
    for (BuiltinID id : { Builtins::ArrayPrototypeMap, Builtins::Error, Builtins::Math, Builtins::ArrayPrototype })
        AOT_TEST_CHECK(!table().isHostFunctionOfEngine(id));
    for (BuiltinID id : { hostBuiltin("Fetch"_s), hostBuiltin("SetTimeout"_s), hostBuiltin("ConsoleLog"_s) })
        AOT_TEST_CHECK(table().ignoresReceiver(id) && table().isNativeFunctionOfHost(id));
    AOT_TEST_CHECK(!table().ignoresReceiver(hostBuiltin("ProcessNextTick"_s)) && !table().isNativeFunctionOfHost(hostBuiltin("ProcessNextTick"_s)));
    for (BuiltinID id : { Builtins::Math, Builtins::ArrayPrototype, Builtins::ArrayPrototypeMap, Builtins::ArrayPrototypeSlice, Builtins::ObjectPrototypeValueOf, Builtins::ObjectPrototypeHasOwnProperty, Builtins::FunctionPrototypeBind })
        AOT_TEST_CHECK(!table().ignoresReceiver(id));
    for (BuiltinID id : { Builtins::ArrayPrototypeMap, Builtins::FunctionPrototypeCall, Builtins::FunctionPrototypeApply, Builtins::ReflectGet }) {
        AOT_TEST_CHECK(table().isFunctionOfEngine(id) && !table().isHostFunctionOfEngine(id) && table().hasLockedPrototypeLink(id));
        for (BuiltinName name : std::initializer_list<BuiltinName> { BuiltinNames::call, BuiltinNames::apply, BuiltinNames::bind, table().nameOf(WellKnownSymbol::HasInstance) })
            AOT_TEST_CHECK(table().isClosedKey(id, name));
        AOT_TEST_CHECK(!table().isClosedKey(id, BuiltinNames::toString) && !table().isClosedKey(id, BuiltinNames::then));
    }
    for (BuiltinID id : { Builtins::Error, Builtins::Math, Builtins::ArrayPrototype })
        AOT_TEST_CHECK(!table().isFunctionOfEngine(id));
    AOT_TEST_CHECK(!std::ranges::contains(table().lockedMembers(), Builtins::FunctionPrototypeToString));
    for (BuiltinID id : { Builtins::FunctionPrototypeName, Builtins::FunctionPrototypeLength }) {
        AOT_TEST_CHECK(table().at(id).mutability == BuiltinMutability::AlwaysLocked && table().overloadsOf(id).size() == 1);
        const BuiltinOverload& read = table().overloadsOf(id)[0];
        AOT_TEST_CHECK(read.mode == BuiltinCallMode::Get && read.receiver->uses == OperandUses { OperandUse::Inspects } && read.effects.capability == BuiltinCapability::Heap);
    }
    AOT_TEST_CHECK(!table().at(BuiltinClasses::BoundFunction).hasClosureInstances && !table().at(BuiltinClasses::Function).hasClosureInstances);
    AOT_TEST_CHECK(table().definesCharactersOnNewInstances(BuiltinClasses::String));
    for (BuiltinClassID otherClass : { BuiltinClasses::Number, BuiltinClasses::Object, BuiltinClasses::Array, BuiltinClasses::StringIterator })
        AOT_TEST_CHECK(!table().definesCharactersOnNewInstances(otherClass));

    for (BuiltinClassID errorClass : { BuiltinClasses::Error, BuiltinClasses::TypeError, BuiltinClasses::AggregateError, BuiltinClasses::SuppressedError }) {
        AOT_TEST_CHECK(!table().listsOwnPropertiesOfNewInstances(errorClass));
        for (BuiltinName name : { BuiltinNames::message, BuiltinNames::cause, BuiltinNames::stack })
            AOT_TEST_CHECK(table().mayDefineOnNewInstances(errorClass, name));
        for (BuiltinName name : std::initializer_list<BuiltinName> { BuiltinNames::name, BuiltinNames::then, BuiltinNames::length, table().nameOf(WellKnownSymbol::ToPrimitive), BuiltinName() })
            AOT_TEST_CHECK(!table().mayDefineOnNewInstances(errorClass, name));
    }
    AOT_TEST_CHECK(table().mayDefineOnNewInstances(BuiltinClasses::AggregateError, BuiltinNames::errors) && !table().mayDefineOnNewInstances(BuiltinClasses::TypeError, BuiltinNames::errors));
    AOT_TEST_CHECK(table().listsOwnPropertiesOfNewInstances(BuiltinClasses::Set) && !table().mayDefineOnNewInstances(BuiltinClasses::Set, BuiltinNames::message));
    AOT_TEST_CHECK(table().overloadsOf(Builtins::FunctionPrototypeBind)[0].result.prototypeSource == BuiltinOperand::receiver());

    for (BuiltinID id : { Builtins::ArraySymbolSpecies, Builtins::MapSymbolSpecies })
        AOT_TEST_CHECK(table().at(id).mutability == BuiltinMutability::AlwaysLocked);

    for (BuiltinName name : std::initializer_list<BuiltinName> { BuiltinNames::then, BuiltinNames::hasOwnProperty, BuiltinNames::valueOf, table().nameOf(WellKnownSymbol::ToPrimitive), table().nameOf(WellKnownSymbol::IsConcatSpreadable) })
        AOT_TEST_CHECK(table().isClosedKey(Builtins::MapPrototype, name));
    AOT_TEST_CHECK(!table().isClosedKey(Builtins::MapPrototype, BuiltinNames::push) && !table().isClosedKey(Builtins::MapPrototype, hostName("Bun"_s)));
    AOT_TEST_CHECK(!table().isClosedKey(Builtins::MapPrototype, BuiltinNames::toJSON) && !table().isClosedKey(Builtins::SetPrototype, BuiltinNames::toJSON));
    AOT_TEST_CHECK(table().isClosedKey(Builtins::ArrayPrototype, BuiltinNames::toJSON) && table().isClosedKey(Builtins::ArrayPrototype, BuiltinNames::then));
    for (BuiltinName textOfPrimitive : { BuiltinNames::undefined, BuiltinNames::null, BuiltinNames::trueKeyword, BuiltinNames::falseKeyword }) {
        for (BuiltinID prototype : { Builtins::ArrayPrototype, Builtins::StringPrototype, Builtins::MapPrototype, Builtins::Uint8ArrayPrototype, Builtins::FunctionPrototype })
            AOT_TEST_CHECK(table().isClosedKey(prototype, textOfPrimitive));
        for (BuiltinID other : { Builtins::Promise, Builtins::Symbol, Builtins::Math, Builtins::Array })
            AOT_TEST_CHECK(!table().isClosedKey(other, textOfPrimitive));
    }
    for (BuiltinID id : { Builtins::StringPrototypeBold, Builtins::StringPrototypeAt, Builtins::SetPrototypeUnion })
        AOT_TEST_CHECK(table().at(id).mutability == BuiltinMutability::ConstantUnlessWritten);
    AOT_TEST_CHECK(std::ranges::contains(table().lockedMembers(), Builtins::MathImul) && std::ranges::contains(table().lockedMembers(), Builtins::Math));
    AOT_TEST_CHECK(!std::ranges::contains(table().lockedMembers(), Builtins::MathRandom));
    AOT_TEST_CHECK(table().isClosedKey(Builtins::Math, BuiltinNames::valueOf) && table().isClosedKey(Builtins::Math, table().nameOf(WellKnownSymbol::ToPrimitive)));
    AOT_TEST_CHECK(!table().isClosedKey(Builtins::Math, BuiltinNames::then) && !table().isClosedKey(Builtins::Math, BuiltinNames::push) && !table().isClosedKey(Builtins::Math, BuiltinNames::random));
    AOT_TEST_CHECK(!table().isClosedKey(Builtins::Intl, BuiltinNames::valueOf) && table().closedKeysOf(Builtins::Intl).empty());
    for (BuiltinID id : { Builtins::Object, Builtins::Array, Builtins::Number, Builtins::JSON, Builtins::Reflect, Builtins::Date })
        AOT_TEST_CHECK(table().at(id).flags.contains(BuiltinFlag::HasLockedMembers) && !table().isClosedKey(id, BuiltinNames::push));
    AOT_TEST_CHECK(!table().hasLockedPrototypeLink(Builtins::Intl));
    for (BuiltinID id : std::initializer_list<BuiltinID> { Builtins::Error, Builtins::TypeError, Builtins::Function, Builtins::WeakRef, hostBuiltin("Blob"_s), hostBuiltin("FormData"_s), Builtins::URL }) {
        AOT_TEST_CHECK(table().closesOnlyNamesOfCalls(id) && table().hasLockedPrototypeLink(id) && !table().closesIndexKeys(id));
        for (BuiltinName name : std::initializer_list<BuiltinName> { BuiltinNames::call, BuiltinNames::apply, BuiltinNames::bind, table().nameOf(WellKnownSymbol::HasInstance) })
            AOT_TEST_CHECK(table().isClosedKey(id, name));
        AOT_TEST_CHECK(!table().isClosedKey(id, BuiltinNames::toString) && !table().isClosedKey(id, BuiltinNames::then) && !table().isClosedKey(id, table().nameOf(WellKnownSymbol::Species)));
    }
    for (BuiltinID id : std::initializer_list<BuiltinID> { Builtins::Object, Builtins::Array, Builtins::Math, Builtins::ArrayPrototype, Builtins::ArrayPrototypeMap, hostBuiltin("BunGlob"_s) })
        AOT_TEST_CHECK(!table().closesOnlyNamesOfCalls(id));
    AOT_TEST_CHECK(std::ranges::is_sorted(table().closedKeysOf(Builtins::MapPrototype)));
}

static void testStringConstantsFollowTheTarget()
{
    for (BuiltinID id : std::initializer_list<BuiltinID> { hostBuiltin("ProcessPlatform"_s), hostBuiltin("ProcessArch"_s) })
        AOT_TEST_CHECK(table().at(id).kind == BuiltinKind::Constant && table().at(id).mutability == BuiltinMutability::ConstantUnlessWritten);
    AOT_TEST_CHECK(table().nameOfString(hostBuiltin("ProcessPlatform"_s), { BuiltinPlatform::Windows, BuiltinArchitecture::X86_64 }) == hostName("win32"_s));
    AOT_TEST_CHECK(table().nameOfString(hostBuiltin("ProcessPlatform"_s), { BuiltinPlatform::Darwin, BuiltinArchitecture::ARM64 }) == hostName("darwin"_s));
    AOT_TEST_CHECK(table().nameOfString(hostBuiltin("ProcessArch"_s), { BuiltinPlatform::Linux, BuiltinArchitecture::ARM64 }) == hostName("arm64"_s));
    AOT_TEST_CHECK(table().nameOfString(hostBuiltin("ProcessArch"_s), { BuiltinPlatform::Linux, BuiltinArchitecture::X86_64 }) == hostName("x64"_s));
    AOT_TEST_CHECK(table().nameOfString(hostBuiltin("ProcessPlatform"_s)) == table().nameOfString(hostBuiltin("ProcessPlatform"_s), targetOfThisBuild()));
    AOT_TEST_CHECK(table().stringOf(hostBuiltin("ProcessPlatform"_s)) && !table().stringOf(hostBuiltin("ProcessExecPath"_s)) && !table().stringOf(Builtins::MathPI));

    std::span<const BuiltinStringConstant> constants = builtinTableData.attachments.stringConstants;
    AOT_TEST_CHECK(!constants.empty());
    for (const BuiltinStringConstant& constant : constants) {
        AOT_TEST_CHECK(constant.text && !constant.platforms.isEmpty() && !constant.architectures.isEmpty());
        for (BuiltinPlatform platform : constant.platforms) {
            for (BuiltinArchitecture architecture : constant.architectures)
                AOT_TEST_CHECK(table().nameOfString(constant.builtin, { platform, architecture }) == constant.text);
        }
    }
}

template<typename Record>
static void checkRecordsByBuiltin(std::span<const Record> all, std::span<const Record> (BuiltinTable::*recordsOf)(BuiltinID) const)
{
    size_t numberOfRecords = 0;
    forEachBuiltin([&](BuiltinID id, const Builtin&) {
        std::span<const Record> records = (table().*recordsOf)(id);
        numberOfRecords += records.size();
        for (const Record& record : records)
            AOT_TEST_CHECK(record.builtin == id);
    });
    AOT_TEST_CHECK(numberOfRecords == all.size());
}

static void testAttachmentsAreFoundByEntry()
{
    const BuiltinTableAttachments& attachments = builtinTableData.attachments;
    checkRecordsByBuiltin(attachments.featureUses, &BuiltinTable::featureUsesOf);
    checkRecordsByBuiltin(attachments.moduleLoads, &BuiltinTable::moduleLoadsOf);
    checkRecordsByBuiltin(attachments.calledFunctions, &BuiltinTable::calledFunctionsOf);
    AOT_TEST_CHECK(!attachments.featureUses.empty() && !attachments.moduleLoads.empty() && !attachments.numberConstants.empty());

    for (const BuiltinUnseenCode& record : attachments.unseenCode)
        AOT_TEST_CHECK(table().unseenCodeOf(record.builtin) == &record && record.condition);
    for (const BuiltinForms& record : attachments.forms)
        AOT_TEST_CHECK(table().formsOf(record.builtin) == &record);
    for (const BuiltinBoxedCall& record : table().boxedCalls())
        AOT_TEST_CHECK(table().boxedCallStubOf(record.builtin) == record.stub);
    for (const BuiltinBoxedCall& record : table().boxedCalls())
        AOT_TEST_CHECK(table().methodCalledBy(record.stub) == table().canonicalID(record.builtin));
    for (unsigned stub = 0; stub < numberOfBuiltinBoxedStubs; ++stub)
        AOT_TEST_CHECK(table().boxedCallStubOf(table().methodCalledBy(static_cast<BuiltinBoxedStub>(stub))) == static_cast<BuiltinBoxedStub>(stub));
    for (const BuiltinNumberConstant& record : attachments.numberConstants)
        AOT_TEST_CHECK(table().numberOf(record.builtin).has_value());

    AOT_TEST_CHECK(table().featureUsesOf(Builtins::MathAbs).empty() && table().moduleLoadsOf(Builtins::MathAbs).empty() && table().calledFunctionsOf(Builtins::MathAbs).empty());
    AOT_TEST_CHECK(!table().unseenCodeOf(Builtins::MathAbs) && !table().at(Builtins::MathAbs).flags.contains(BuiltinFlag::RunsUnseenCode) && !table().boxedCallStubOf(Builtins::Math));
}

static void testHostUsesOfStartupLoads()
{
    std::span<const BuiltinCalledFunction> functions = table().startupCalledFunctions();
    AOT_TEST_CHECK(std::ranges::equal(functions, table().functionsCalledWithStartupLoads(), { }, &BuiltinCalledFunction::function));
    for (const BuiltinCalledFunction& called : functions)
        AOT_TEST_CHECK(!called.builtin && !called.condition);

    AOT_TEST_CHECK(table().startupLoads().size() == 1 && table().startupLoads()[0].exports.size() == 1);
    const BuiltinHostUses& usesOfInspect = table().startupLoads()[0].usesOfExports[0];
    AOT_TEST_CHECK(usesOfInspect.areListed && usesOfInspect.list.size() == 1 && usesOfInspect.list[0].use == BuiltinHostReadUse::Kept);
    BuiltinName inspectCell = usesOfInspect.list[0].nativeCell;

    auto options = std::ranges::find_if(table().hostObjects(), [](const BuiltinHostObject& object) {
        return std::ranges::contains(object.fields, hostName("stylize"_s), &BuiltinHostObjectField::name);
    });
    AOT_TEST_CHECK(options != table().hostObjects().end() && options->prototype == Builtins::ObjectPrototype && options->fields.size() == 4);
    HashSet<uint32_t> cellsOfStylize;
    for (const BuiltinHostObjectField& field : options->fields) {
        if (field.name == hostName("stylize"_s))
            cellsOfStylize.add(field.value.nativeCell.index() + 1);
    }
    AOT_TEST_CHECK(cellsOfStylize.size() == 2 && std::ranges::count(functions, true, [](const BuiltinCalledFunction& called) { return called.uses.areListed; }) == 2);
    for (const BuiltinCalledFunction& called : functions) {
        if (!called.uses.areListed)
            continue;
        AOT_TEST_CHECK(called.uses.list.size() == 1);
        const BuiltinHostUse& use = called.uses.list[0];
        const BuiltinHostUse& kept = use.call ? use.call->result.list[0] : use;
        AOT_TEST_CHECK(kept.use == BuiltinHostReadUse::Kept && cellsOfStylize.contains(kept.nativeCell.index() + 1));
        AOT_TEST_CHECK(!use.call || (use.call->arguments.size() == 1 && use.call->arguments[0].nativeCell == inspectCell));
    }
}

static void testModulesListWhatRowsSayNativeCodeReads()
{
    size_t namesInRows = 0;
    auto checkRow = [&](const BuiltinModuleLoad& load) {
        const RuntimeModuleData& module = table().at(load.module);
        AOT_TEST_CHECK(!load.readsEveryExport || module.flags.contains(RuntimeModuleFlag::NativeCodeReadsEveryExport));
        for (size_t place = 0; place < load.exports.size(); ++place) {
            BuiltinName name = load.exports[place];
            AOT_TEST_CHECK(std::ranges::contains(module.exportsReadByNativeCode, name));
            const BuiltinHostUses& uses = load.usesOfExports[place];
            bool isMemberOnly = uses.areListed && !uses.list.empty() && std::ranges::all_of(uses.list, [](const BuiltinHostUse& use) {
                return use.use == BuiltinHostReadUse::Kept && !use.memberPath.empty();
            });
            AOT_TEST_CHECK(isMemberOnly || !std::ranges::contains(module.memberOnlyExports, name));
        }
        namesInRows += load.exports.size();
    };
    for (uint32_t index = 0; index < table().builtinCount(); ++index)
        std::ranges::for_each(table().moduleLoadsOf(BuiltinID(index)), checkRow);
    std::ranges::for_each(table().startupLoads(), checkRow);
    AOT_TEST_CHECK(namesInRows);
}

std::span<const NativeTest> bunBuiltinTableTests()
{
    static constexpr NativeTest tests[] = {
        { "builtin-table/tokens-round-trip"_s, testTokensRoundTrip },
        { "builtin-table/class-relations"_s, testClassRelations },
        { "builtin-table/members-asked-by-their-byte-alone"_s, testMembersAskedByByteAlone },
        { "builtin-table/member-missing-on-target-is-not-found"_s, testMemberMissingOnTargetIsNotFound },
        { "builtin-table/locked-objects"_s, testLockedObjects },
        { "builtin-table/locked-members"_s, testLockedMembers },
        { "builtin-table/string-constants-follow-the-target"_s, testStringConstantsFollowTheTarget },
        { "builtin-table/attachments-are-found-by-entry"_s, testAttachmentsAreFoundByEntry },
        { "builtin-table/host-uses-of-startup-loads"_s, testHostUsesOfStartupLoads },
        { "builtin-table/modules-list-what-rows-say-native-code-reads"_s, testModulesListWhatRowsSayNativeCodeReads },
    };
    return tests;
}

} } // namespace JSC::AOT

#endif // ENABLE(AOT)
