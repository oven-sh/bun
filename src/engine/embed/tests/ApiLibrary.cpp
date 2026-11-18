#include "ApiFixtures.h"

using namespace JSC;
using Test::Realm;

TEST(MapAndSet)
{
    Realm realm;
    auto& vm = realm.vm;
    auto* global = realm.global;
    auto* map = JSMap::create(vm, global->mapStructure());
    EXPECT(!map->size());
    for (int i = 0; i < 100; ++i)
        map->set(global, jsNumber(i), jsNumber(i * 2));
    map->set(global, realm.run("'a' + String(1)"_s), jsBoolean(true));
    EXPECT(map->size() == 101 && map->get(global, jsDoubleNumber(3)) == jsNumber(6) && map->has(global, jsString(vm, String("a1"_s))));
    EXPECT(map->remove(global, jsNumber(0)) && !map->remove(global, jsNumber(0)) && map->get(global, jsNumber(0)).isUndefined());

    JSValue key, value;
    auto* entries = JSMapIterator::create(vm, global->mapIteratorStructure(), map, IterationKind::Entries);
    EXPECT(entries->nextKeyValue(global, key, value) && key == jsNumber(1) && value == jsNumber(2));
    EXPECT(entries->next(global, value) && realm.json(value) == "[2,4]"_s);
    map->remove(global, jsNumber(3));
    EXPECT(entries->nextWithAdvance(vm).key == jsNumber(4));
    EXPECT(JSMapIterator::create(vm, global->mapIteratorStructure(), map, IterationKind::Keys)->next(global, value) && value == jsNumber(1));
    EXPECT(JSMapIterator::create(vm, global->mapIteratorStructure(), map, IterationKind::Values)->next(global, value) && value == jsNumber(2));
    map->clear(global);
    EXPECT(!map->size() && !entries->next(global, value));
    map->set(global, jsNumber(1), jsNumber(1));
    EXPECT(!entries->nextWithAdvance(vm).key);

    auto* set = JSSet::create(vm, global->setStructure());
    auto* keys = JSSetIterator::create(vm, global->setIteratorStructure(), set, IterationKind::Keys);
    set->add(global, jsNumber(1));
    set->add(global, jsNumber(1));
    set->add(global, jsNumber(2));
    EXPECT(set->size() == 2 && set->has(global, jsNumber(2)) && set->remove(global, jsNumber(1)));
    EXPECT(keys->next(global, value) && value == jsNumber(2) && !keys->next(global, value));
    EXPECT(JSSetIterator::create(vm, global->setIteratorStructure(), set, IterationKind::Entries)->next(global, value) && realm.json(value) == "[2,2]"_s);

    EXPECT(is<JSMap>(realm.run("new (class extends Map {})"_s)) && !is<JSMap>(JSValue(set)));
}

TEST(WeakCollections)
{
    Realm realm;
    auto& vm = realm.vm;
    auto* global = realm.global;
    auto* key = constructEmptyObject(global);
    auto* map = JSWeakMap::create(vm, global->weakMapStructure());
    map->set(vm, key, jsNumber(1));
    auto* set = JSWeakSet::create(vm, global->weakSetStructure());
    set->add(vm, key);
    for (int i = 0; i < 1000; ++i) {
        map->set(vm, constructEmptyObject(global), jsNumber(i));
        set->add(vm, constructEmptyObject(global));
    }
    realm.collect();
    EXPECT(map->size() < 100 && map->get(key) == jsNumber(1) && map->has(key) && map->get(set).isUndefined());
    MarkedArgumentBuffer keys;
    set->takeSnapshot(global, keys);
    EXPECT(set->has(key) && !set->has(map) && keys.size() < 100 && keys.at(0) == key);

    EXPECT(canBeHeldWeakly(key) && canBeHeldWeakly(realm.run("Symbol()"_s)));
    EXPECT(!canBeHeldWeakly(realm.run("Symbol.for('a')"_s)) && !canBeHeldWeakly(jsNumber(1)));
    auto* registry = dynamicDowncast<JSFinalizationRegistry>(realm.run("var callback = () => {}; new FinalizationRegistry(callback)"_s));
    EXPECT(registry && registry->callback() == realm.run("callback"_s));
}

// What it yields, up to and including `last`, at which the callback throws.
static String iterated(Realm& realm, ASCIILiteral source, int last = -1)
{
    StringBuilder result;
    forEachInIterable(realm.global, realm.run(source), [&](VM& vm, JSGlobalObject* global, JSValue value) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        result.append(realm.text(value), ' ');
        if (value == jsNumber(last))
            throwException(global, scope, jsNumber(-1));
    });
    result.append(realm.takeException());
    return result.toString();
}

TEST(Iteration)
{
    Realm realm;
    auto* global = realm.global;
    EXPECT(iterated(realm, "[1, 2, 3]"_s) == "1 2 3 nothing"_s);
    EXPECT(iterated(realm, "[1.5, , 'a']"_s) == "1.5 undefined a nothing"_s);
    EXPECT(iterated(realm, "[]"_s) == "nothing"_s);
    EXPECT(iterated(realm, "Object.freeze([1, 2])"_s) == "1 2 nothing"_s);
    EXPECT(iterated(realm, "new Map([[1, 2]])"_s) == "1,2 nothing"_s);
    EXPECT(iterated(realm, "new Set('ab')"_s) == "a b nothing"_s);
    EXPECT(iterated(realm, "'ab'"_s) == "a b nothing"_s);
    EXPECT(iterated(realm, "new Uint8Array([1, 2])"_s) == "1 2 nothing"_s);
    EXPECT(iterated(realm, "[1, 2, 3]"_s, 2) == "1 2 -1"_s);
    EXPECT(iterated(realm, "(function* () { try { yield 1; yield 2 } finally { globalThis.closed = true; throw 0 } })()"_s, 1) == "1 -1"_s);
    EXPECT(realm.run("closed"_s).isTrue());
    EXPECT(iterated(realm, "(function* () { yield 1; throw 5 })()"_s) == "1 5"_s);
    EXPECT(iterated(realm, "({})"_s) == "TypeError: Type error"_s);
    EXPECT(iterated(realm, "var grows = [{ toString() { grows.push(2); return '1' } }]; grows"_s) == "1 2 nothing"_s);
    EXPECT(iterated(realm, "[].values().__proto__.return = function () { globalThis.next = this.next().value; return {} }; [1, 2, 3]"_s, 2) == "1 2 -1"_s);
    EXPECT(realm.run("next"_s) == jsNumber(3));

    unsigned count = 0;
    auto* object = asObject(realm.run("({ *[Symbol.iterator]() { yield 1; yield 2 } })"_s));
    forEachInIterable(*global, object, iteratorMethod(global, object), [&](VM&, JSGlobalObject&, JSValue) { ++count; });
    EXPECT(count == 2);
    forEachInIterable(*global, object, jsUndefined(), [&](VM&, JSGlobalObject&, JSValue) { ++count; });
    EXPECT(realm.takeException() == "TypeError: {} is not iterable"_s);

    EXPECT(hasIteratorMethod(global, object) && !hasIteratorMethod(global, realm.run("'a'"_s)) && !hasIteratorMethod(global, realm.run("({})"_s)));
    EXPECT(!hasIteratorMethod(global, realm.run("({ [Symbol.iterator]: 1 })"_s)));
    EXPECT(realm.takeException() == "TypeError: Symbol.iterator property should be callable"_s);

    auto record = iteratorDirect(global, realm.run("({ next(...all) { return { value: all.length } } })"_s));
    EXPECT(realm.json(iteratorNextExported(global, record)) == "{\"value\":0}"_s);
    EXPECT(realm.json(iteratorNextExported(global, record, jsNull())) == "{\"value\":1}"_s);

    auto* result = createIteratorResultObject(global, jsNumber(1), true);
    EXPECT(result->structure() == global->iteratorResultObjectStructure());
    EXPECT(result->getDirect(iteratorResultObjectValuePropertyOffset) == jsNumber(1) && result->getDirect(iteratorResultObjectDonePropertyOffset).isTrue());

    record = iteratorDirect(global, realm.run("[Promise.resolve(8)].values()"_s));
    record = iteratorDirect(global, JSAsyncFromSyncIterator::create(global, asObject(record.iterator), record.nextMethod));
    auto* step = uncheckedDowncast<JSPromise>(iteratorNextExported(global, record));
    realm.vm.drainMicrotasks();
    EXPECT(realm.json(step->result()) == "{\"value\":8,\"done\":false}"_s);
}

TEST(Proxy)
{
    Realm realm;
    auto& vm = realm.vm;
    auto* global = realm.global;
    auto* target = asObject(realm.run("Object.freeze({ a: 1 })"_s));
    auto* handler = asObject(realm.run("({ get() { return 2 } })"_s));
    auto* proxy = ProxyObject::create(global, target, handler);
    EXPECT(proxy->target() == target && proxy->handler() == handler && !proxy->isRevoked());
    EXPECT(proxy->get(global, Identifier::fromString(vm, "b"_s)) == jsNumber(2));
    EXPECT(!ProxyObject::create(global, jsNumber(1), handler));
    EXPECT(realm.takeException() == "TypeError: A Proxy's 'target' should be an Object"_s);
    EXPECT(uncheckedDowncast<ProxyObject>(realm.run("var it = Proxy.revocable({}, {}); it.revoke(); it.proxy"_s))->isRevoked());
}

TEST(RegularExpressions)
{
    Realm realm;
    auto& vm = realm.vm;
    auto* global = realm.global;
    EXPECT(Yarr::flagsString(*Yarr::parseFlags("yvsmigd"_s)) == "dgimsvy"_s);
    EXPECT(!Yarr::parseFlags("uv"_s) && !Yarr::parseFlags("gg"_s) && Yarr::parseFlags(""_s)->isEmpty());

    auto* regExp = RegExp::tryCreate(vm, "(b)(x)?(c)"_s, Yarr::Flags::IgnoreCase);
    EXPECT(regExp->pattern() == "(b)(x)?(c)"_s && regExp->flags() == OptionSet { Yarr::Flags::IgnoreCase });
    auto found = regExp->match(global, "aBC"_s, 0);
    EXPECT(found && found.start == 1 && found.end == 3 && !regExp->match(global, "aBC"_s, 2));
    EXPECT(std::ranges::equal(regExp->matchWithGroups(global, "abc"_s, 0), std::array { 1, 3, 1, 2, -1, -1, 2, 3 }));
    EXPECT(regExp->matchWithGroups(global, "a"_s, 0).isEmpty());

    EXPECT(!RegExp::tryCreate(vm, "("_s, {}) && !RegExp::create(global, "("_s, {}));
    EXPECT(realm.takeException() == "SyntaxError: Invalid regular expression: missing )"_s);

    auto* object = RegExpObject::create(vm, global->regExpStructure(), RegExp::create(global, "a"_s, Yarr::Flags::Global));
    auto* subject = jsString(vm, String("ba"_s));
    EXPECT(object->match(global, subject) && object->getLastIndex() == jsNumber(2));
    EXPECT(!object->match(global, subject) && object->getLastIndex() == jsNumber(0));
    EXPECT(realm.text(object) == "/a/g"_s);
    EXPECT(uncheckedDowncast<RegExpObject>(realm.run("new (class extends RegExp {})('a', 'g')"_s))->regExp() == object->regExp());
}

TEST(Dates)
{
    Realm realm;
    auto& vm = realm.vm;
    auto* global = realm.global;
    EXPECT(WTF::setTimeZoneOverride("UTC"_s));
    auto* date = DateInstance::create(vm, global->dateStructure(), 1.9);
    EXPECT(date->internalNumber() == 1 && std::isnan(DateInstance::create(vm, global->dateStructure(), 9e15)->internalNumber()));
    realm.define("date"_s, date);
    EXPECT(realm.run("date.getHours()"_s) == jsNumber(0));
    EXPECT(WTF::setTimeZoneOverride("Asia/Tokyo"_s));
    vm.dateCache.clearForTimeZoneChange();
    EXPECT(vm.dateCache.msToGregorianDateTime(0, TimeType::LocalTime).hour() == 9);
    EXPECT(realm.run("date.getHours()"_s) == jsNumber(9));
    EXPECT(vm.dateCache.gregorianDateTimeToMS(1970, 0, 1, 9, 0, 0, 5, TimeType::LocalTime) == 5);
    EXPECT(vm.dateCache.gregorianDateTimeToMS(1969, 12, 1, 0, 0, 1, 0, TimeType::UTCTime) == 1000);
    EXPECT(vm.dateCache.parseDate(global, vm, "1970-01-01T09:00:00"_s) == 0 && std::isnan(vm.dateCache.parseDate(global, vm, "no"_s)));

    auto last = vm.dateCache.msToGregorianDateTime(8.64e15 + 12 * 3600 * 1000, TimeType::UTCTime);
    EXPECT(last.year() == 275760 && last.month() == 8 && last.monthDay() == 13 && last.hour() == 12 && last.weekDay() == 6);
    EXPECT(!vm.dateCache.msToGregorianDateTime(8.65e15, TimeType::UTCTime));
    EXPECT(formatDateTimeAsUTCString(-1) == "Wed, 31 Dec 1969 23:59:59 GMT"_s);

    global->overridenDateNow = 42;
    EXPECT(dateNowImpl(global) == jsNumber(42) && realm.run("Date.now()"_s).asNumber() == 42);
    WTF::setTimeZoneOverride(""_s);
}

TEST(Json)
{
    Realm realm;
    auto& vm = realm.vm;
    auto* global = realm.global;
    EXPECT(realm.json(JSONParse(global, "{\"a\": [1, null]}"_s)) == "{\"a\":[1,null]}"_s);
    EXPECT(!JSONParse(global, "{"_s) && !JSONParse(global, StringView()) && realm.takeException() == "nothing"_s);
    EXPECT(realm.text(JSONParse(global, std::span(u8"\"é\"", 4))) == String(std::span<const Latin1Character>(std::array<Latin1Character, 1> { 0xe9 })));
    EXPECT(!JSONParseWithException(global, StringView()) && realm.takeException() == "nothing"_s);
    EXPECT(!JSONParseWithException(global, "{"_s) && realm.takeException() == "SyntaxError: JSON Parse error: Expected '}'"_s);
    EXPECT(JSONStringify(global, realm.run("[1]"_s), 2) == "[\n  1\n]"_s);
    EXPECT(JSONStringify(global, realm.run("[1]"_s), jsString(vm, String("-"_s))) == "[\n-1\n]"_s);
    EXPECT(JSONStringify(global, jsUndefined(), 0).isNull());
    EXPECT(tryMakeJSONString(vm, "short"_s) == tryMakeJSONString(vm, "short"_s));
    EXPECT(realm.text(tryMakeJSONString(vm, "more than sixteen characters"_s)) == "more than sixteen characters"_s);

    using enum StreamingJSONParseResult::Status;
    MarkedArgumentBuffer values;
    auto result = streamingJSONParse(global, "1\n[2]\n{\"a"_s, values);
    EXPECT(result.status == NeedMoreData && result.charactersConsumed == 5 && values.size() == 2);
    result = streamingJSONParse(global, std::span(u8"\"é\"\n]\n", 7), values);
    EXPECT(result.status == Error && result.charactersConsumed == 4 && values.size() == 3);
    EXPECT(streamingJSONParse(global, " \n"_s, values).status == Complete);
}

TEST(TemporalObjects)
{
    Realm realm;
    auto& vm = realm.vm;
    auto object = [&](ASCIILiteral source) { return asObject(realm.run(source)); };
    EXPECT(temporalType(jsNumber(1)) == TemporalType::None && temporalType(object("({})"_s)) == TemporalType::None);
    EXPECT(temporalType(object("new (class extends Temporal.Duration {})"_s)) == TemporalType::Duration);
    EXPECT(temporalObjectsHoldTheSame(object("Temporal.Duration.from('PT1H')"_s), object("new Temporal.Duration(0, 0, 0, 0, 1)"_s)));
    EXPECT(!temporalObjectsHoldTheSame(object("Temporal.Duration.from('PT1H')"_s), object("Temporal.Duration.from('PT60M')"_s)));
    EXPECT(!temporalObjectsHoldTheSame(object("Temporal.PlainDate.from('2024-01-01')"_s), object("Temporal.PlainDateTime.from('2024-01-01')"_s)));

    auto* instant = temporalObjectFrom(realm.global, TemporalType::Instant, jsString(vm, String("1969-12-31T23:59:59.5Z"_s)));
    EXPECT(temporalEpochNanoseconds(instant) == -500000000);
    EXPECT(temporalExactTimeToString(instant, std::nullopt) == "1969-12-31T23:59:59.5Z"_s);
    EXPECT(temporalExactTimeToString(instant, -90) == "1969-12-31T22:29:59.5-01:30"_s);
    EXPECT(temporalEpochNanoseconds(object("new Temporal.Instant(8640000000000000000000n)"_s)) == static_cast<Int128>(8640000000000000) * 1000000);
    EXPECT(temporalOffsetNanoseconds(object("Temporal.ZonedDateTime.from('2024-01-01T00:00[Asia/Tokyo]')"_s)) == 9ll * 3600 * 1000000000);
    EXPECT(temporalPlainValueToString(object("Temporal.PlainDate.from('2024-01-01[u-ca=hebrew]')"_s)) == "2024-01-01"_s);
    EXPECT(temporalPlainValueToString(temporalObjectFrom(realm.global, TemporalType::PlainTime, jsString(vm, String("01:02"_s)))) == "01:02:00"_s);
    EXPECT(!temporalObjectFrom(realm.global, TemporalType::PlainDate, jsString(vm, String("no"_s))) && realm.takeException().startsWith("RangeError"_s));
}

class Console final : public ConsoleClient {
    static void log(ASCIILiteral name, const String& text) { Realm::log(makeString(name, ' ', text.isNull() ? "null"_s : text)); }

    void messageWithTypeAndLevel(MessageType type, MessageLevel level, JSGlobalObject* global, const ArgList& arguments) final
    {
        auto scope = DECLARE_THROW_SCOPE(global->vm());
        if (type == MessageType::Table)
            throwTypeError(global, scope, "from the client"_s);
        log("message"_s, makeString(static_cast<int>(type), static_cast<int>(level), arguments.size()));
    }
    void count(JSGlobalObject*, const String& label) final { log("count"_s, label); }
    void countReset(JSGlobalObject*, const String& label) final { log("countReset"_s, label); }
    void profile(JSGlobalObject*, const String& title) final { log("profile"_s, title); }
    void profileEnd(JSGlobalObject*, const String& title) final { log("profileEnd"_s, title); }
    void takeHeapSnapshot(JSGlobalObject*, const String& title) final { log("takeHeapSnapshot"_s, title); }
    void time(JSGlobalObject*, const String& label) final { log("time"_s, label); }
    void timeLog(JSGlobalObject*, const String& label, const ArgList& arguments) final { log("timeLog"_s, makeString(label, arguments.size())); }
    void timeEnd(JSGlobalObject*, const String& label) final { log("timeEnd"_s, label); }
};

TEST(ConsoleClient)
{
    Console console;
    Realm realm;
    realm.run("console.log(1)"_s);
    realm.global->setConsoleClient(&console);
    JSValue message = realm.run("console.warn(1, 2); console.count(); console.countReset('a'); console.profile(); console.profileEnd(1); console.takeHeapSnapshot();"
                                "console.time(); console.timeLog('b', 1, 2); console.timeEnd('b'); console.timeStamp(); try { console.table(1) } catch (e) { e.message }"_s);
    EXPECT(realm.text(message) == "from the client"_s);
    console.logWithLevel(realm.global, {}, MessageLevel::Info);
    EXPECT(Realm::takeLog() == "message 012, count default, countReset a, profile null, profileEnd 1, takeHeapSnapshot null, time default, timeLog b2, timeEnd b, message 301, message 040"_s);
}

TEST(Reflection)
{
    Realm realm;
    auto& vm = realm.vm;
    auto* global = realm.global;
    auto* object = asObject(realm.run("Object.defineProperty({ a: 1, [Symbol.toStringTag]: 'Tag' }, 'b', { value: 2 })"_s));
    EXPECT(realm.json(objectValues(vm, global, object)) == "[1]"_s);
    EXPECT(realm.json(ownPropertyKeys(global, object, PropertyNameMode::Strings, DontEnumPropertiesMode::Include)) == "[\"a\",\"b\"]"_s);
    EXPECT(ownPropertyKeys(global, object, PropertyNameMode::StringsAndSymbols, DontEnumPropertiesMode::Exclude)->length() == 2);
    EXPECT(realm.text(objectPrototypeToString(global, object)) == "[object Tag]"_s);
    EXPECT(realm.text(objectPrototypeToString(global, jsNull())) == "[object Null]"_s);
    EXPECT(realm.text(objectPrototypeToStringWithBuiltinTag(global, object)) == "[object Object]"_s);
    EXPECT(constructNumber(global, jsNumber(1))->internalValue() == jsNumber(1));
    EXPECT(BooleanObject::create(vm, global->booleanObjectStructure())->internalValue().isFalse());
}
