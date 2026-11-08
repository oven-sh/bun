#include "root.h"

#include "NodeObjEquiv.h"

#include "UtilInspect.h"
#include <JavaScriptCore/ArrayStorage.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/JSSet.h>
#include <JavaScriptCore/JSSetIterator.h>
#include <JavaScriptCore/MarkedVector.h>
#include <JavaScriptCore/OperationsInlines.h>
#include <JavaScriptCore/SparseArrayValueMap.h>
#include <algorithm>
#include <wtf/HashSet.h>
#include <wtf/Vector.h>

namespace Bun {

JSC::JSString* objectPrototypeToStringOutOfLine(JSC::JSGlobalObject*, JSC::JSValue);

namespace NodeObjEquiv {

static void appendOwnKeys(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* object, JSC::PropertyNameMode mode, JSC::PropertyNameArrayBuilder& keys)
{
    JSC::PropertyNameArrayBuilder listed(globalObject->vm(), mode, JSC::PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, globalObject, listed, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, void());
    for (const auto& key : listed)
        keys.addUnchecked(key.impl());
}

// Whether a listing of the object's own keys can run code of the program, as the ownKeys trap of a Proxy does.
static bool listingRunsCode(JSC::JSObject* object)
{
    if (!object->structure()->typeInfo().overridesGetOwnPropertyNames())
        return false;
    switch (object->type()) {
    case JSC::DirectArgumentsType:
    case JSC::ScopedArgumentsType:
    case JSC::StringObjectType:
    case JSC::DerivedStringObjectType:
#if ENABLE(AOT)
    case JSC::CompiledObjectType:
#endif
        return false;
    default:
        return true;
    }
}

// Moves the string keys of a list before its symbol keys. How many string keys it has.
static size_t moveSymbolKeysLast(JSC::PropertyNameArrayBuilder& keys)
{
    auto& list = keys.data()->propertyNameVector();
    auto firstSymbolKey = std::stable_partition(list.begin(), list.end(), [](const JSC::Identifier& key) { return !key.isSymbol(); });
    return firstSymbolKey - list.begin();
}

// Object.keys of the second object, then of the first, then the enumerable symbol keys of the first, then of the second.
bool listOwnKeysSlow(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, JSC::PropertyNameArrayBuilder& keys1, JSC::PropertyNameArrayBuilder& keys2)
{
    if (!listingRunsCode(o1) && !listingRunsCode(o2)) {
        // Nothing can tell how often such an object is listed: once is enough.
        o2->methodTable()->getOwnPropertyNames(o2, globalObject, keys2, JSC::DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
        o1->methodTable()->getOwnPropertyNames(o1, globalObject, keys1, JSC::DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
        return moveSymbolKeysLast(keys1) == moveSymbolKeysLast(keys2) && keys1.size() == keys2.size();
    }
    appendOwnKeys(globalObject, scope, o2, JSC::PropertyNameMode::Strings, keys2);
    RETURN_IF_EXCEPTION(scope, false);
    appendOwnKeys(globalObject, scope, o1, JSC::PropertyNameMode::Strings, keys1);
    RETURN_IF_EXCEPTION(scope, false);
    if (keys1.size() != keys2.size())
        return false;
    appendOwnKeys(globalObject, scope, o1, JSC::PropertyNameMode::Symbols, keys1);
    RETURN_IF_EXCEPTION(scope, false);
    appendOwnKeys(globalObject, scope, o2, JSC::PropertyNameMode::Symbols, keys2);
    RETURN_IF_EXCEPTION(scope, false);
    return keys1.size() == keys2.size();
}

JSC::JSValue getIndexSlow(JSC::JSGlobalObject* globalObject, JSC::JSObject* array, unsigned index, bool& ranCode)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::PropertySlot slot(array, JSC::PropertySlot::InternalMethodType::Get);
    bool has = array->getPropertySlot(globalObject, index, slot);
    RETURN_IF_EXCEPTION(scope, {});
    ranCode = slot.isTaintedByOpaqueObject() || (has && !slot.isValue());
    if (!has)
        return JSC::jsUndefined();
    RELEASE_AND_RETURN(scope, slot.getValue(globalObject, index));
}

bool ownsIndexSlow(JSC::JSGlobalObject* globalObject, JSC::JSObject* array, uint64_t index)
{
    JSC::PropertySlot slot(array, JSC::PropertySlot::InternalMethodType::GetOwnProperty);
    if (index <= MAX_ARRAY_INDEX) [[likely]]
        return array->methodTable()->getOwnPropertySlotByIndex(array, globalObject, static_cast<unsigned>(index), slot);
    return array->methodTable()->getOwnPropertySlot(array, globalObject, JSC::Identifier::from(globalObject->vm(), index), slot);
}

// The own enumerable index keys of an array, ascending, as numbers.
template<typename Visit>
static void forEachOwnIndex(JSC::JSObject* array, const Visit& visit)
{
    if (!JSC::hasAnyArrayStorage(array->indexingType())) {
        unsigned length = uncheckedDowncast<JSC::JSArray>(array)->length();
        for (unsigned index = 0; index < length; index++) {
            if (array->canGetIndexQuickly(index))
                visit(index);
        }
        return;
    }
    JSC::ArrayStorage* storage = array->butterfly()->arrayStorage();
    unsigned vectorEnd = std::min(storage->length(), storage->vectorLength());
    for (unsigned index = 0; index < vectorEnd; index++) {
        if (storage->m_vector[index])
            visit(index);
    }
    if (JSC::SparseArrayValueMap* map = storage->m_sparseMap.get()) {
        WTF::Vector<unsigned, 16> indices;
        for (auto& entry : *map) {
            if (!(entry.attributes() & JSC::PropertyAttribute::DontEnum))
                indices.append(entry.index());
        }
        std::ranges::sort(indices);
        for (unsigned index : indices)
            visit(index);
    }
}

static bool ownsKey(JSC::JSGlobalObject* globalObject, JSC::JSObject* object, JSC::PropertyName key)
{
    JSC::PropertySlot slot(object, JSC::PropertySlot::InternalMethodType::GetOwnProperty);
    return object->methodTable()->getOwnPropertySlot(object, globalObject, key, slot);
}

bool sparseArraysEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, size_t from, const CompareValues& compareValues)
{
    JSC::VM& vm = globalObject->vm();
    // Object.keys of the first array, then of the second. Index keys of two arrays stay numbers; behind a Proxy the ownKeys trap gives strings.
    size_t indexCount1 = 0;
    WTF::Vector<unsigned, 16> indices2;
    std::optional<JSC::PropertyNameArrayBuilder> names1;
    std::optional<JSC::PropertyNameArrayBuilder> names2;
    bool bothAreArrays = JSC::isJSArray(o1) && JSC::isJSArray(o2);
    if (bothAreArrays) {
        forEachOwnIndex(o1, [&](unsigned) { indexCount1++; });
        forEachOwnIndex(o2, [&](unsigned index) { indices2.append(index); });
    }
    if (!bothAreArrays || hasNamedProperties(o1->structure()) || hasNamedProperties(o2->structure())) {
        names1.emplace(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
        names2.emplace(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
        if (bothAreArrays)
            o1->getOwnNonIndexPropertyNames(globalObject, *names1, JSC::DontEnumPropertiesMode::Exclude);
        else
            o1->methodTable()->getOwnPropertyNames(o1, globalObject, *names1, JSC::DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
        if (bothAreArrays)
            o2->getOwnNonIndexPropertyNames(globalObject, *names2, JSC::DontEnumPropertiesMode::Exclude);
        else
            o2->methodTable()->getOwnPropertyNames(o2, globalObject, *names2, JSC::DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
    }
    const size_t nameCount2 = names2 ? names2->size() : 0;
    if (indexCount1 + (names1 ? names1->size() : 0) != indices2.size() + nameCount2)
        return false;

    // node takes `from`, the index of the first hole, for a place in the list of keys (#L991-L992), and so can step over keys behind the hole.
    size_t i = from;
    for (; i < indices2.size(); i++) {
        unsigned index = indices2[i];
        bool ranCode1 = false;
        bool ranCode2 = false;
        JSC::JSValue value1 = getIndex(globalObject, o1, index, ranCode1);
        RETURN_IF_EXCEPTION(scope, false);
        if (value1.isUndefined()) {
            bool owns = ownsIndex(globalObject, o1, index);
            RETURN_IF_EXCEPTION(scope, false);
            if (!owns)
                return false;
        }
        if (ranCode1) [[unlikely]] {
            value1 = getIndex(globalObject, o1, index, ranCode1);
            RETURN_IF_EXCEPTION(scope, false);
        }
        JSC::JSValue value2 = getIndex(globalObject, o2, index, ranCode2);
        RETURN_IF_EXCEPTION(scope, false);
        bool equal = value1 == value2 || compareValues(value1, value2);
        RETURN_IF_EXCEPTION(scope, false);
        if (!equal)
            return false;
    }
    for (size_t named = i - indices2.size(); named < nameCount2; named++) {
        const JSC::Identifier& key = (*names2)[named];
        JSC::JSValue value1 = o1->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
        if (value1.isUndefined()) {
            bool owns = ownsKey(globalObject, o1, key);
            RETURN_IF_EXCEPTION(scope, false);
            if (!owns)
                return false;
        }
        value1 = o1->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
        JSC::JSValue value2 = o2->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
        bool equal = value1 == value2 || compareValues(value1, value2);
        RETURN_IF_EXCEPTION(scope, false);
        if (!equal)
            return false;
    }
    return true;
}

static bool isBelowLength(JSC::JSGlobalObject* globalObject, JSC::JSObject* array, uint64_t index)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue length = array->get(globalObject, vm.propertyNames->length);
    RETURN_IF_EXCEPTION(scope, false);
    RELEASE_AND_RETURN(scope, JSC::jsLess<true>(globalObject, JSC::jsNumber(index), length));
}

bool hasUnequalTagSlow(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2)
{
    JSC::VM& vm = globalObject->vm();
    bool isArray1 = JSC::isArray(globalObject, o1);
    RETURN_IF_EXCEPTION(scope, false);
    if (isArray1)
        return false;
    const JSC::Identifier& tagKey = vm.propertyNames->toStringTagSymbol;
    JSC::JSValue tag1 = o1->get(globalObject, tagKey);
    RETURN_IF_EXCEPTION(scope, false);
    if (!tag1.isUndefined()) {
        JSC::JSValue tag2 = o2->get(globalObject, tagKey);
        RETURN_IF_EXCEPTION(scope, false);
        if (!tag2.isUndefined()) {
            bool sameTag = JSC::JSValue::strictEqual(globalObject, tag1, tag2);
            RETURN_IF_EXCEPTION(scope, false);
            return !sameTag;
        }
    }
    JSC::JSString* string1 = objectPrototypeToStringOutOfLine(globalObject, o1);
    RETURN_IF_EXCEPTION(scope, false);
    JSC::JSString* string2 = objectPrototypeToStringOutOfLine(globalObject, o2);
    RETURN_IF_EXCEPTION(scope, false);
    bool sameString = string1->equal(globalObject, string2);
    RETURN_IF_EXCEPTION(scope, false);
    return !sameString;
}

// What node does with two arrays before their elements: nullopt where the elements decide. Not inline, to keep it off the stack of the element loop.
static NEVER_INLINE std::optional<bool> proxiedArrayOtherKeysEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, const CompareValues& compareValues)
{
    JSC::VM& vm = globalObject->vm();
    const JSC::Identifier& lengthKey = vm.propertyNames->length;
    JSC::JSValue length1 = o1->get(globalObject, lengthKey);
    RETURN_IF_EXCEPTION(scope, false);
    JSC::JSValue length2 = o2->get(globalObject, lengthKey);
    RETURN_IF_EXCEPTION(scope, false);
    bool sameLength = JSC::JSValue::strictEqual(globalObject, length1, length2);
    RETURN_IF_EXCEPTION(scope, false);
    if (!sameLength)
        return false;

    const JSC::Identifier& tagKey = vm.propertyNames->toStringTagSymbol;
    JSC::JSValue tag1 = o1->get(globalObject, tagKey);
    RETURN_IF_EXCEPTION(scope, false);
    JSC::JSValue tag2 = o2->get(globalObject, tagKey);
    RETURN_IF_EXCEPTION(scope, false);
    bool sameTag = JSC::JSValue::strictEqual(globalObject, tag1, tag2);
    RETURN_IF_EXCEPTION(scope, false);
    if (!sameTag)
        return false;

    JSC::PropertyNameArrayBuilder keys1(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
    JSC::PropertyNameArrayBuilder keys2(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
    Bun::getOwnNonIndexPropertyNames(globalObject, o2, keys2, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, false);
    Bun::getOwnNonIndexPropertyNames(globalObject, o1, keys1, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, false);
    if (keys1.size() != keys2.size())
        return false;

    if (keys2.size()) {
        bool otherKeysEqual = ownPropertiesEqual(globalObject, scope, o1, o2, nullptr, keys2, false, compareValues);
        RETURN_IF_EXCEPTION(scope, false);
        if (!otherKeysEqual)
            return false;
    } else {
        // `val2.length === 0 || val2.size === 0`: with no other key, node calls the arrays equal on either.
        length2 = o2->get(globalObject, lengthKey);
        RETURN_IF_EXCEPTION(scope, false);
        if (length2.isNumber() && !length2.asNumber())
            return true;
        JSC::JSValue size2 = o2->get(globalObject, vm.propertyNames->size);
        RETURN_IF_EXCEPTION(scope, false);
        if (size2.isNumber() && !size2.asNumber())
            return true;
    }
    return std::nullopt;
}

bool proxiedArraysEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, const CompareValues& compareValues)
{
    std::optional<bool> areEqual = proxiedArrayOtherKeysEqual(globalObject, scope, o1, o2, compareValues);
    RETURN_IF_EXCEPTION(scope, false);
    if (areEqual)
        return *areEqual;
    return arrayElementsEqual(
        globalObject, scope, o1, o2,
        [&](uint64_t index) { return isBelowLength(globalObject, o1, index); },
        [&](JSC::JSObject* array, uint64_t index, bool& ranCode) {
            ranCode = true;
            return array->get(globalObject, index);
        },
        [&](JSC::JSObject* array, uint64_t index) { return ownsIndexSlow(globalObject, array, index); },
        compareValues);
}

// `typeof value === 'object' && value !== null`: node looks for a partner of such a member or key. Any other has one only in itself.
static ALWAYS_INLINE bool isTypeofObject(JSC::JSValue value)
{
    return value.isObject() && !value.isCallable();
}

// One copy of each lookup, for the paths that an entry takes only when it needs a partner.
static NEVER_INLINE bool holds(JSC::JSGlobalObject* globalObject, JSC::JSSet* set, JSC::JSValue member)
{
    return set->has(globalObject, member);
}

static NEVER_INLINE bool holds(JSC::JSGlobalObject* globalObject, JSC::JSMap* map, JSC::JSValue key)
{
    return map->has(globalObject, key);
}

static NEVER_INLINE JSC::JSValue valueUnder(JSC::JSGlobalObject* globalObject, JSC::JSMap* map, JSC::JSValue key)
{
    return map->get(globalObject, key);
}

// Whether an object of this structure can have an own key: a named property or an index.
static ALWAYS_INLINE bool canHaveOwnKeys(JSC::Structure* structure)
{
    return hasNamedProperties(structure) || JSC::hasIndexedProperties(structure->indexingType());
}

// keyCheck (#L493-L520) and the key loop of objEquiv for two Sets or two Maps: node compares their own enumerable keys before their entries.
static NEVER_INLINE bool ownKeysEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, const CompareValues& compareValues)
{
    JSC::VM& vm = globalObject->vm();
    JSC::Structure* structure = o1->structure();
    // Two objects of one structure have the same keys in the same order, each in a slot: the walk that Bun__deepEquals has for two such plain objects. node compares the symbol keys after the string keys.
    if (structure == o2->structure() && !structure->hasNonReifiedStaticProperties() && structure->canPerformFastPropertyEnumeration()) {
        // A comparison can run code that changes the property table, so the values are read first.
        JSC::MarkedArgumentBuffer stringKeyed;
        JSC::MarkedArgumentBuffer symbolKeyed;
        structure->forEachProperty(vm, [&](const JSC::PropertyTableEntry& entry) -> bool {
            if (entry.attributes() & JSC::PropertyAttribute::DontEnum || JSC::PropertyName(entry.key()).isPrivateName())
                return true;
            auto& pairs = entry.key()->isSymbol() ? symbolKeyed : stringKeyed;
            pairs.appendWithCrashOnOverflow(o1->getDirect(entry.offset()));
            pairs.appendWithCrashOnOverflow(o2->getDirect(entry.offset()));
            return true;
        });
        for (auto* pairs : { &stringKeyed, &symbolKeyed }) {
            for (size_t i = 0; i < pairs->size(); i += 2) {
                bool valuesEqual = pairs->at(i) == pairs->at(i + 1) || compareValues(pairs->at(i), pairs->at(i + 1));
                RETURN_IF_EXCEPTION(scope, false);
                if (!valuesEqual)
                    return false;
            }
        }
        return true;
    }
    JSC::PropertyNameArrayBuilder keys1(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
    JSC::PropertyNameArrayBuilder keys2(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
    bool sameKeyCounts = listOwnKeys(globalObject, scope, o1, o2, keys1, keys2);
    RETURN_IF_EXCEPTION(scope, false);
    if (!sameKeyCounts)
        return false;
    return ownPropertiesEqual(globalObject, scope, o1, o2, &keys1, keys2, false, compareValues);
}

// node's `array`: the members or keys of the second collection that need a partner, with the indices of its walk. The candidates from `start` to `end` are open: they have no partner yet.
struct Candidates {
    JSC::MarkedArgumentBuffer list;
    // Signed, as node's are: `end` is -1 when the last candidate has a partner.
    int64_t start { 0 };
    int64_t end { -1 };
    bool forward { true };

    JSC::JSValue at(int64_t index) { return list.at(static_cast<size_t>(index)); }
};

// One entry of the first collection in setObjectEquiv (#L716-L734) and mapObjectEquiv (#L871-L891): it asks the first open candidate, then the last, then the others from the back (arrayHasEqualElement #L684-L693).
template<typename IsPartner>
static ALWAYS_INLINE bool claimCandidate(JSC::ThrowScope& scope, Candidates& candidates, const IsPartner& isPartner)
{
    // Code of the program can put more entries into the first collection than there are candidates. node then reads outside the open candidates: undefined, which throws a TypeError, or a candidate that has a partner. Here that entry has no partner.
    if (candidates.start > candidates.end)
        return false;
    int64_t innerStart = candidates.start;
    if (candidates.forward) {
        bool isFirst = isPartner(candidates.start);
        RETURN_IF_EXCEPTION(scope, false);
        if (isFirst) {
            candidates.start += 1;
            return true;
        }
        if (candidates.start == candidates.end)
            return false;
        candidates.forward = false;
        innerStart += 1;
    }
    bool isLast = isPartner(candidates.end);
    RETURN_IF_EXCEPTION(scope, false);
    if (!isLast) {
        candidates.forward = true;
        int64_t index = candidates.end - 1;
        for (; index >= innerStart; index--) {
            bool found = isPartner(index);
            RETURN_IF_EXCEPTION(scope, false);
            if (found) {
                // The last open candidate takes the place of the one that has a partner now.
                candidates.list.at(static_cast<size_t>(index)) = candidates.list.at(static_cast<size_t>(candidates.end));
                break;
            }
        }
        if (index < innerStart)
            return false;
    }
    candidates.end -= 1;
    return true;
}

// `iterator.next().value`: undefined once the iterator is done.
static ALWAYS_INLINE JSC::JSValue nextMember(JSC::JSGlobalObject* globalObject, JSC::JSSetIterator* iterator)
{
    JSC::JSValue member = JSC::jsUndefined();
    iterator->next(globalObject, member);
    return member;
}

// compareSmallSets (#L739-L755): two Sets of one or two members, from the first member of the second Set that the first one does not hold. Not as node at two reads, marked below: after a member that both Sets hold, node reads past the end of `iteratorB` and compares a member of the first Set with undefined (since nodejs/node#57648). Here the member that both Sets hold is its own partner, as it is in larger Sets on node (#L764, #L712).
static NEVER_INLINE bool smallSetsEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSSet* set1, JSC::JSSet* set2, JSC::JSValue member2, JSC::JSSetIterator* iterator2, const CompareValues& compareValues)
{
    auto* iterator1 = JSC::JSSetIterator::create(globalObject->vm(), globalObject->setIteratorStructure(), set1, JSC::IterationKind::Keys);
    JSC::JSValue first1 = nextMember(globalObject, iterator1);
    bool firstIsPartner = compareValues(first1, member2);
    RETURN_IF_EXCEPTION(scope, false);
    if (firstIsPartner) {
        if (set2->size() == 1)
            return true;
        JSC::JSValue second1 = nextMember(globalObject, iterator1);
        bool held = holds(globalObject, set2, second1);
        RETURN_IF_EXCEPTION(scope, false);
        if (held)
            return true;
        JSC::JSValue next2 = JSC::jsUndefined();
        if (!iterator2->next(globalObject, next2)) {
            // Not as node (#L748): `first1` is its own partner, so `member2` is left for `second1`.
            bool firstIsHeld = holds(globalObject, set2, first1);
            RETURN_IF_EXCEPTION(scope, false);
            if (firstIsHeld)
                return compareValues(second1, member2);
        }
        return compareValues(second1, next2);
    }
    if (set1->size() == 1)
        return false;
    JSC::JSValue second1 = nextMember(globalObject, iterator1);
    bool secondIsPartner = compareValues(second1, member2);
    RETURN_IF_EXCEPTION(scope, false);
    if (!secondIsPartner)
        return false;
    if (set2->size() == 1)
        return true;
    bool held = holds(globalObject, set2, first1);
    RETURN_IF_EXCEPTION(scope, false);
    if (held)
        return true;
    JSC::JSValue next2 = JSC::jsUndefined();
    if (!iterator2->next(globalObject, next2)) {
        // Not as node (#L753): `second1` is its own partner and not the one of `member2` too, so `first1` has none.
        bool secondIsHeld = holds(globalObject, set2, second1);
        RETURN_IF_EXCEPTION(scope, false);
        if (secondIsHeld)
            return false;
    }
    return compareValues(first1, next2);
}

bool setsEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSSet* set1, JSC::JSSet* set2, const CompareValues& compareValues)
{
    if (canHaveOwnKeys(set1->structure()) || canHaveOwnKeys(set2->structure())) [[unlikely]] {
        bool keysEqual = ownKeysEqual(globalObject, scope, set1, set2, compareValues);
        RETURN_IF_EXCEPTION(scope, false);
        if (!keysEqual)
            return false;
    }
    if (!set2->size())
        return true;

    // setEquiv (#L757-L790)
    JSC::VM& vm = globalObject->vm();
    Candidates candidates;
    auto* iterator2 = JSC::JSSetIterator::create(vm, globalObject->setIteratorStructure(), set2, JSC::IterationKind::Keys);
    JSC::JSValue member;
    while (iterator2->next(globalObject, member)) {
        bool held = set1->has(globalObject, member);
        RETURN_IF_EXCEPTION(scope, false);
        if (held)
            continue;
        if (!isTypeofObject(member))
            return false;
        if (candidates.list.isEmpty() && set1->size() < 3)
            return smallSetsEqual(globalObject, scope, set1, set2, member, iterator2, compareValues);
        candidates.list.appendWithCrashOnOverflow(member);
    }
    if (candidates.list.isEmpty())
        return true;
    candidates.end = static_cast<int64_t>(candidates.list.size()) - 1;

    // setObjectEquiv (#L695-L737). `extraChecks`: with as many candidates as members, the second Set holds no member of the first.
    bool someAreHeld = candidates.list.size() != set1->size();
    auto* iterator1 = JSC::JSSetIterator::create(vm, globalObject->setIteratorStructure(), set1, JSC::IterationKind::Keys);
    while (iterator1->next(globalObject, member)) {
        bool isObject = isTypeofObject(member);
        if (!isObject || someAreHeld) {
            bool held = holds(globalObject, set2, member);
            RETURN_IF_EXCEPTION(scope, false);
            if (held)
                continue;
            if (!isObject)
                return false;
        }
        bool hasPartner = claimCandidate(scope, candidates, [&](int64_t index) {
            return compareValues(member, candidates.at(index));
        });
        RETURN_IF_EXCEPTION(scope, false);
        if (!hasPartner)
            return false;
    }
    return true;
}

// The keys that `typeof` calls an object and that the walk of the second Map found in both Maps with equal values. Each is its own partner by identity: a key that the second Map holds only since a comparison ran code is none of them.
struct SettledKeys {
    JSC::MarkedArgumentBuffer list;
    // The keys before `next` have met their key of the first Map.
    size_t next { 0 };
    // The keys from `next` on, once the first Map has one of them in another place and they are too many to scan.
    UncheckedKeyHashSet<JSC::JSCell*> others;

    bool hasMore() { return next < list.size(); }

    bool take(JSC::JSValue key)
    {
        if (others.isEmpty()) {
            if (list.at(next) == key) {
                next += 1;
                return true;
            }
            if (list.size() - next <= 16) {
                for (size_t i = next + 1; i < list.size(); i++) {
                    if (list.at(i) == key) {
                        list.at(i) = list.at(next);
                        next += 1;
                        return true;
                    }
                }
                return false;
            }
            for (size_t i = next; i < list.size(); i++)
                others.add(list.at(i).asCell());
        }
        if (!others.remove(key.asCell()))
            return false;
        next += 1;
        return true;
    }
};

// Whether the entry of the second Map under `candidate` is a partner of the entry (key1, value1) of the first (#L873, #L884).
static ALWAYS_INLINE bool isPartnerEntry(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSMap* map2, JSC::JSValue key1, JSC::JSValue value1, JSC::JSValue candidate, const CompareValues& compareValues)
{
    // A candidate that is this key has another value: the walk of the second Map compared the two.
    if (candidate == key1)
        return false;
    bool keysEqual = compareValues(key1, candidate);
    RETURN_IF_EXCEPTION(scope, false);
    if (!keysEqual)
        return false;
    // node reads the value of a candidate from the second Map at each comparison.
    JSC::JSValue candidateValue = valueUnder(globalObject, map2, candidate);
    RETURN_IF_EXCEPTION(scope, false);
    return value1 == candidateValue || compareValues(value1, candidateValue);
}

bool mapsEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSMap* map1, JSC::JSMap* map2, const CompareValues& compareValues)
{
    if (canHaveOwnKeys(map1->structure()) || canHaveOwnKeys(map2->structure())) [[unlikely]] {
        bool keysEqual = ownKeysEqual(globalObject, scope, map1, map2, compareValues);
        RETURN_IF_EXCEPTION(scope, false);
        if (!keysEqual)
            return false;
    }
    if (!map2->size())
        return true;

    // mapEquiv (#L896-L939)
    JSC::VM& vm = globalObject->vm();
    Candidates candidates;
    // The candidates that the first Map holds too, with another value.
    JSC::MarkedArgumentBuffer twins;
    SettledKeys settled;
    auto* iterator2 = JSC::JSMapIterator::create(vm, globalObject->mapIteratorStructure(), map2, JSC::IterationKind::Entries);
    JSC::JSValue key2;
    JSC::JSValue value2;
    while (iterator2->nextKeyValue(globalObject, key2, value2)) {
        // Not as node, which looks up only a key that `typeof` does not call an object (#L910-L917): a key that is an object is a candidate there also where both Maps hold it (#L900-L909), compared with the candidates before it and with itself as two objects (since nodejs/node#57648). Here a key that both Maps hold with equal values is its own partner and no candidate, as a member that both Sets hold is on node (#L764, #L712). So the other keys meet the candidates in another order: the answer differs where a key is equal to another in one argument order only.
        JSC::JSValue value1 = map1->get(globalObject, key2);
        RETURN_IF_EXCEPTION(scope, false);
        bool held = !value1.isUndefined();
        if (!held) {
            held = holds(globalObject, map1, key2);
            RETURN_IF_EXCEPTION(scope, false);
        }
        bool isObject = isTypeofObject(key2);
        if (held) {
            bool valuesEqual = value1 == value2 || compareValues(value1, value2);
            RETURN_IF_EXCEPTION(scope, false);
            if (valuesEqual) {
                if (isObject) {
                    if (settled.list.isEmpty())
                        settled.list.ensureCapacity(map2->size());
                    settled.list.appendWithCrashOnOverflow(key2);
                }
                continue;
            }
            // Under a key that is an object, the entry can still be the partner of one under another key, as on node.
            if (!isObject)
                return false;
            twins.appendWithCrashOnOverflow(key2);
        } else {
            if (!isObject)
                return false;
            if (candidates.list.isEmpty() && map1->size() == 1) {
                // One entry each (#L902-L906).
                auto* iterator1 = JSC::JSMapIterator::create(vm, globalObject->mapIteratorStructure(), map1, JSC::IterationKind::Entries);
                JSC::JSValue key1 = JSC::jsUndefined();
                value1 = JSC::jsUndefined();
                iterator1->nextKeyValue(globalObject, key1, value1);
                bool keysEqual = compareValues(key1, key2);
                RETURN_IF_EXCEPTION(scope, false);
                if (!keysEqual)
                    return false;
                return value1 == value2 || compareValues(value1, value2);
            }
        }
        candidates.list.appendWithCrashOnOverflow(key2);
    }
    if (candidates.list.isEmpty())
        return true;
    // A lone candidate that the first Map holds too could only be its own partner.
    if (candidates.list.size() == 1 && twins.size() == 1)
        return false;
    candidates.end = static_cast<int64_t>(candidates.list.size()) - 1;

    // mapObjectEquiv (#L850-L894)
    auto isTwin = [&](JSC::JSValue key) {
        for (size_t i = 0; i < twins.size(); i++) {
            if (twins.at(i) == key)
                return true;
        }
        return false;
    };
    auto* iterator1 = JSC::JSMapIterator::create(vm, globalObject->mapIteratorStructure(), map1, JSC::IterationKind::Entries);
    JSC::JSValue key1;
    JSC::JSValue value1;
    while (iterator1->nextKeyValue(globalObject, key1, value1)) {
        bool isObject = isTypeofObject(key1);
        if (!isObject || settled.hasMore()) {
            bool held = holds(globalObject, map2, key1);
            RETURN_IF_EXCEPTION(scope, false);
            if (!isObject) {
                if (held)
                    continue;
                return false;
            }
            // Its own partner is a key that the walk of the second Map settled and that the second Map still holds.
            if (held && !isTwin(key1) && settled.take(key1))
                continue;
        }
        bool hasPartner = claimCandidate(scope, candidates, [&](int64_t index) {
            return isPartnerEntry(globalObject, scope, map2, key1, value1, candidates.at(index), compareValues);
        });
        RETURN_IF_EXCEPTION(scope, false);
        if (!hasPartner)
            return false;
    }
    return true;
}

} // namespace NodeObjEquiv
} // namespace Bun
