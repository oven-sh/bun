#include "ApiFixtures.h"

using namespace JSC;

static Identifier name(Test::Realm& realm, ASCIILiteral text) { return Identifier::fromString(realm.vm, text); }

TEST(CoreEquality)
{
    Test::Realm realm;
    auto compare = [&](ASCIILiteral source) {
        auto* pair = asObject(realm.run(source));
        JSValue a = pair->getIndexQuickly(0), b = pair->getIndexQuickly(1);
        return JSValue::strictEqual(realm.global, a, b) * 100 + sameValueZero(realm.global, a, b) * 10 + sameValue(realm.global, a, b);
    };
    EXPECT(compare("[0, -0]"_s) == 110);
    EXPECT(compare("[NaN, 0 / 0]"_s) == 11);
    EXPECT(compare("[1, new Float64Array([1])[0]]"_s) == 111);
    EXPECT(compare("[2n ** 70n, 2n ** 70n]"_s) == 111);
    EXPECT(compare("[1n, -1n]"_s) == 0);
    EXPECT(compare("[1n, 1]"_s) == 0);
    EXPECT(compare("var part = 'x'.repeat(40); [part + 'y', 'x'.repeat(39) + 'xy']"_s) == 111);
    EXPECT(compare("[{}, {}]"_s) == 0);
    EXPECT(compare("[null, undefined]"_s) == 0);
    EXPECT(JSValue::strictEqual(realm.global, {}, {}) && !JSValue::strictEqual(realm.global, {}, jsEmptyString(realm.vm)));
}

TEST(CoreConversions)
{
    Test::Realm realm;
    EXPECT(realm.run("-3.9"_s).toIntegerOrInfinity(realm.global) == -3);
    EXPECT(!std::signbit(realm.run("-0.5"_s).toIntegerOrInfinity(realm.global)));
    EXPECT(!realm.run("'x'"_s).toIntegerOrInfinity(realm.global));
    EXPECT(realm.run("2 ** 32 + 5"_s).toInt32(realm.global) == 5);
    EXPECT(!realm.run("-1"_s).toLength(realm.global));
    EXPECT(realm.run("Infinity"_s).toLength(realm.global) == maxSafeIntegerAsUInt64());
    for (auto source : { "0"_s, "NaN"_s, "''"_s, "0n"_s, "null"_s, "undefined"_s })
        EXPECT(!realm.run(source).toBoolean(realm.global));
    for (auto source : { "-1"_s, "0.5"_s, "'0'"_s, "1n"_s, "Symbol()"_s, "({})"_s })
        EXPECT(realm.run(source).toBoolean(realm.global));
}

TEST(CoreResultsAfterAnException)
{
    Test::Realm realm;
    auto* object = asObject(realm.run("({ get a() { throw 1 }, get 0() { throw 2 }, f() { throw 3 } })"_s));
    EXPECT(object->get(realm.global, name(realm, "a"_s)).isUndefined());
    EXPECT(realm.takeException() == "1"_s);
    EXPECT(object->getIndex(realm.global, 0).isUndefined());
    EXPECT(realm.takeException() == "2"_s);
    JSValue function = object->getDirect(realm.vm, name(realm, "f"_s));
    EXPECT(call(realm.global, function, getCallData(function), object, {}).isUndefined());
    EXPECT(realm.takeException() == "3"_s);
}

TEST(CoreNamesAreNeverNull)
{
    Test::Realm realm;
    auto& empty = realm.vm.propertyNames->emptyIdentifier;
    EXPECT(Identifier::fromString(realm.vm, String()) == empty);
    EXPECT(Identifier::fromString(realm.vm, std::span<const Latin1Character>()) == empty);
    EXPECT(Identifier::fromString(realm.vm, std::span<const char16_t>()) == empty);
}

TEST(CoreListPastTheEnd)
{
    MarkedArgumentBuffer list;
    EXPECT(list.at(0).isUndefined() && list.hasOverflowed());
}

TEST(CoreElements)
{
    Test::Realm realm;
    auto* sparse = asObject(realm.run("var sparse = []; sparse[1e6] = 1; sparse[0] = 2; Object.defineProperty(sparse, 1, { get() {} })"_s));
    EXPECT(sparse->tryGetIndexQuickly(0u) == jsNumber(2) && !sparse->canGetIndexQuickly(1u) && !sparse->canGetIndexQuickly(2u));

    auto* arguments = asObject(realm.run("(function (a) { Object.defineProperty(arguments, 0, { configurable: false }); a = 2; return arguments })(1)"_s));
    EXPECT(arguments->tryGetIndexQuickly(0u) != jsNumber(1));

    realm.run("Object.defineProperty(Array.prototype, 0, { set() { throw 1 } })"_s);
    ObjectInitializationScope scope(realm.vm);
    auto* array = JSArray::tryCreateUninitializedRestricted(scope, realm.global->arrayStructureForIndexingTypeDuringAllocation(ArrayWithDouble), 1);
    array->initializeIndexWithoutBarrier(scope, 0, jsNumber(1.5), array->indexingType());
    EXPECT(realm.json(array) == "[1.5]"_s);
}

TEST(CorePrivateFieldsAreListedWithoutMethods)
{
    Test::Realm realm;
    auto count = [&](ASCIILiteral source) {
        auto* object = asObject(realm.run(source));
        PropertyNameArrayBuilder names(realm.vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Include);
        object->methodTable()->getOwnPropertyNames(object, realm.global, names, DontEnumPropertiesMode::Exclude);
        EXPECT(!object->structure()->hasNonEnumerableProperties());
        return names.size();
    };
    EXPECT(count("new class { a = 1; #b = 2 }"_s) == 2);
    EXPECT(count("new class { a = 1; #b() {} get #c() {} }"_s) == 1);

    auto* marked = constructEmptyObject(realm.global);
    marked->putDirect(realm.vm, PrivateName(PrivateName::PrivateSymbol, "mark"_s), jsBoolean(true), PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum);
    EXPECT(marked->structure()->hasNonEnumerableProperties());
}

TEST(CoreVMIsDestroyedOnce)
{
    static unsigned destroyed;
    struct Data final : VM::ClientData {
        explicit Data(VM& vm)
            : vm(vm)
        {
        }
        ~Data() final
        {
            Ref protector { vm };
            destroyed++;
        }
        VM& vm;
    };
    {
        Test::Realm realm;
        delete std::exchange(realm.vm.clientData, new Data(realm.vm));
    }
    EXPECT(destroyed == 1);
}

TEST(CoreGlobalObjectIsNoReceiver)
{
    Test::Realm realm;
    JSValue proxy = realm.run("new Proxy(function () {}, { apply: (target, receiver) => receiver })"_s);
    EXPECT(call(realm.global, proxy, getCallData(proxy), realm.global, {}).isUndefined());
}

TEST(CoreStaticPropertiesWhileAnExceptionIsPending)
{
    static constexpr auto make = [](VM&, JSObject*) { return jsNumber(1); };
    static const HashTableValue values[] = {
        { "a"_s, static_cast<unsigned>(PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, make } },
        { "b"_s, static_cast<unsigned>(PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, make } },
    };
    Test::Realm realm;
    auto* object = constructEmptyObject(realm.global);
    {
        auto scope = DECLARE_THROW_SCOPE(realm.vm);
        throwException(realm.global, scope, jsNumber(0));
    }
    reifyStaticProperties(realm.vm, nullptr, values, *object);
    EXPECT(realm.takeException() == "0"_s);
    EXPECT(realm.json(object) == "{\"a\":1,\"b\":1}"_s);
}

TEST(CoreLastUnlockRunsMicrotasks)
{
    Test::Realm realm;
    {
        JSLockHolder outer(realm.vm);
        {
            JSLockHolder inner(realm.vm);
            realm.run("var ran = false; Promise.resolve().then(() => { ran = true })"_s);
        }
        EXPECT(realm.run("ran"_s).isFalse());
    }
    EXPECT(realm.run("ran"_s).isTrue());
}

#if ASSERT_ENABLED

TEST(CoreExceptionChecksAreValidated)
{
    Test::Realm realm;
    auto* ordinary = asObject(realm.run("({ a: 1 })"_s));
    auto* proxy = asObject(realm.run("new Proxy({}, {})"_s));
    auto a = name(realm, "a"_s);
    auto isReported = [&](auto&& code) {
        return Test::crashes([&] {
            auto scope = DECLARE_TOP_EXCEPTION_SCOPE(realm.vm);
            scope.assertNoException();
            Options::validateExceptionChecks() = true;
            code();
        });
    };
    EXPECT(isReported([&] { ordinary->get(realm.global, a); }));
    EXPECT(isReported([&] { proxy->hasProperty(realm.global, a); }));
    EXPECT(isReported([&] { ordinary->putDirectIndex(realm.global, 100, jsNull()); }));
    EXPECT(isReported([&] { ordinary->methodTable()->preventExtensions(ordinary, realm.global); }));
    EXPECT(!isReported([&] { ordinary->hasProperty(realm.global, a); }));
    EXPECT(!isReported([&] { ordinary->putDirectMayBeIndex(realm.global, a, jsNull()); }));
    EXPECT(!isReported([&] { jsNumber(1.5).toInt32(realm.global); }));

    static constexpr auto getter = [](JSGlobalObject* global, EncodedJSValue, PropertyName) SYSV_ABI -> EncodedJSValue {
        auto scope = DECLARE_THROW_SCOPE(global->vm());
        return encodedJSUndefined();
    };
    for (auto text : { "b"_s, "c"_s })
        ordinary->putDirectCustomAccessor(realm.vm, name(realm, text), CustomGetterSetter::create(realm.vm, +getter, nullptr), 0);
    EXPECT(!isReported([&] {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(realm.vm);
        objectValues(realm.vm, realm.global, ordinary);
        scope.assertNoException();
    }));
}

TEST(CoreNothingIsAllocatedWhileACellIsConstructed)
{
    Test::Realm realm;
    EXPECT_CRASH(allocateCell<JSFunction>(realm.vm); constructEmptyObject(realm.global));
}

TEST(CoreCellWithoutHeaderIsNotVisited)
{
    Test::Realm realm;
    EXPECT_CRASH(void* cell = allocateCell<JSFunction>(realm.vm); realm.vm.heap.setIsConstructingCell(false); realm.collect(); ensureStillAliveHere(cell));
}

TEST(CoreTypeInfoSuitsClass)
{
    Test::Realm realm;
    EXPECT_CRASH(Structure::create(realm.vm, realm.global, jsNull(), TypeInfo(JSFunctionType, 0), JSObject::info()));
    EXPECT_CRASH(Structure::create(realm.vm, realm.global, jsNull(), TypeInfo(ObjectType, HasStaticPropertyTable), JSObject::info()));
}

#endif

#if ASAN_ENABLED

extern "C" int __asan_address_is_poisoned(const volatile void*);

TEST(CoreFreeCellsArePoisoned)
{
    Test::Realm realm;
    MarkedArgumentBuffer kept;
    Vector<void*> dropped;
    {
        DeferGC deferGC(realm.vm);
        for (int i = 0; i < 20; i++) {
            kept.append(constructEmptyObject(realm.global));
            dropped.append(constructEmptyObject(realm.global));
        }
    }
    realm.collect();
    EXPECT(std::ranges::any_of(dropped, __asan_address_is_poisoned));
    EXPECT(std::ranges::none_of(kept, [](JSValue value) { return __asan_address_is_poisoned(value.asCell()); }));
}

#endif
