#include "BunClientData.h"
#include "GeneratedResolveMessage.h"
#include "JSDOMURL.h"
#include "JSDOMWrapper.h"
#include "node/crypto/JSKeyObject.h"
#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/BigIntObject.h>
#include <JavaScriptCore/BooleanObject.h>
#include <JavaScriptCore/JSWrapperObject.h>
#include <JavaScriptCore/NumberObject.h>
#include <JavaScriptCore/StringObject.h>
#include <JavaScriptCore/RegExpObject.h>
#include <JavaScriptCore/JSSetIterator.h>
#include <JavaScriptCore/ObjectPrototypeInlines.h>
#include <cmath>
#include "JSEventTarget.h"
#include "JavaScriptCore/TopExceptionScope.h"
#include "_NativeModule.h"

#include "napi_external.h"
#include "webcrypto/JSCryptoKey.h"
#include "webcrypto/JSJsonWebKey.h"
#include <JavaScriptCore/AggregateError.h>
#include <JavaScriptCore/ArrayStorage.h>
#include <JavaScriptCore/AsyncFunctionPrototype.h>
#include <JavaScriptCore/BigIntObject.h>
#include <JavaScriptCore/CallFrame.h>
#include <JavaScriptCore/CallFrameInlines.h>
#include <JavaScriptCore/ErrorPrototype.h>
#include <JavaScriptCore/GeneratorFunctionPrototype.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SparseArrayValueMap.h>
#include <JavaScriptCore/SymbolObject.h>
#include "JSKeyObject.h"

#include "NodeUtilTypesModule.h"

using namespace JSC;

#define GET_FIRST_VALUE                           \
    if (callframe->argumentCount() < 1)           \
        return JSValue::encode(jsBoolean(false)); \
    JSValue value = callframe->uncheckedArgument(0);

#define GET_FIRST_CELL                               \
    if (callframe->argumentCount() < 1)              \
        return JSValue::encode(jsBoolean(false));    \
    JSValue value = callframe->uncheckedArgument(0); \
    if (!value.isCell())                             \
        return JSValue::encode(jsBoolean(false));    \
    JSCell* cell = value.asCell();

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsExternal,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    return JSValue::encode(jsBoolean(value.inherits<Bun::NapiExternal>()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsDate, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSDateType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsArgumentsObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    if (!value.isCell())
        return JSValue::encode(jsBoolean(false));

    auto type = value.asCell()->type();
    switch (type) {
    case DirectArgumentsType:
    case ScopedArgumentsType:
    case ClonedArgumentsType:
        return JSValue::encode(jsBoolean(true));
    default:
        return JSValue::encode(jsBoolean(false));
    }

    __builtin_unreachable();
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBigIntObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->inherits<JSC::BigIntObject>()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBooleanObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    return JSValue::encode(
        jsBoolean(value.isCell() && value.asCell()->type() == BooleanObjectType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsNumberObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    return JSValue::encode(
        jsBoolean(value.isCell() && value.asCell()->type() == NumberObjectType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsStringObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    return JSValue::encode(jsBoolean(
        value.isCell() && (value.asCell()->type() == StringObjectType || value.asCell()->type() == DerivedStringObjectType)));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsSymbolObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->inherits<JSC::SymbolObject>()));
}

// assert.partialDeepStrictEqual typed-array/ArrayBuffer branch (node's kPartial): expected's
// elements as an ordered-with-gaps subsequence of actual's, Object.is equality at storage width.
// https://github.com/nodejs/node/blob/main/lib/internal/util/comparisons.js
template<typename T, typename EqualFn>
static bool partialSequenceContains(std::span<const T> actual, std::span<const T> expected, EqualFn equal)
{
    if (expected.size() > actual.size())
        return false;
    size_t pos = 0;
    for (size_t i = 0; i < expected.size(); i++) {
        const size_t lastCandidate = actual.size() - expected.size() + i;
        while (pos <= lastCandidate && !equal(actual[pos], expected[i]))
            pos++;
        if (pos > lastCandidate)
            return false;
        pos++;
    }
    return true;
}

template<typename T>
static bool partialIntSequenceContains(std::span<const uint8_t> actual, std::span<const uint8_t> expected)
{
    return partialSequenceContains<T>(
        { reinterpret_cast<const T*>(actual.data()), actual.size() / sizeof(T) },
        { reinterpret_cast<const T*>(expected.data()), expected.size() / sizeof(T) },
        [](T a, T b) { return a == b; });
}

template<typename FloatT, typename BitsT>
static bool partialFloatSequenceContains(std::span<const uint8_t> actual, std::span<const uint8_t> expected)
{
    return partialSequenceContains<FloatT>(
        { reinterpret_cast<const FloatT*>(actual.data()), actual.size() / sizeof(FloatT) },
        { reinterpret_cast<const FloatT*>(expected.data()), expected.size() / sizeof(FloatT) },
        [](FloatT a, FloatT b) {
            if (std::isnan(a) || std::isnan(b))
                return std::isnan(a) && std::isnan(b);
            return std::bit_cast<BitsT>(a) == std::bit_cast<BitsT>(b);
        });
}

// Float16 handled at the bit level: NaN = exponent all-ones with a non-zero
// mantissa; everything else compares by exact bits (Object.is semantics).
static bool partialFloat16SequenceContains(std::span<const uint8_t> actual, std::span<const uint8_t> expected)
{
    auto isNaN16 = [](uint16_t bits) { return (bits & 0x7C00) == 0x7C00 && (bits & 0x03FF); };
    return partialSequenceContains<uint16_t>(
        { reinterpret_cast<const uint16_t*>(actual.data()), actual.size() / 2 },
        { reinterpret_cast<const uint16_t*>(expected.data()), expected.size() / 2 },
        [isNaN16](uint16_t a, uint16_t b) {
            if (isNaN16(a) || isNaN16(b))
                return isNaN16(a) && isNaN16(b);
            return a == b;
        });
}

enum class ByteSpanResult { Ok,
    NotABufferLike,
    Detached };

static ByteSpanResult byteSpanOf(JSC::JSValue value, std::span<const uint8_t>& out, JSC::TypedArrayType& type)
{
    JSCell* cell = value.isCell() ? value.asCell() : nullptr;
    if (!cell)
        return ByteSpanResult::NotABufferLike;
    if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(cell)) {
        if (view->isDetached())
            return ByteSpanResult::Detached;
        out = { static_cast<const uint8_t*>(view->vector()), view->byteLength() };
        type = JSC::typedArrayType(cell->type());
        return ByteSpanResult::Ok;
    }
    if (auto* buffer = dynamicDowncast<JSC::JSArrayBuffer>(cell)) {
        auto* impl = buffer->impl();
        if (!impl || impl->isDetached())
            return ByteSpanResult::Detached;
        out = { static_cast<const uint8_t*>(impl->data()), impl->byteLength() };
        type = JSC::TypedArrayType::NotTypedArray;
        return ByteSpanResult::Ok;
    }
    return ByteSpanResult::NotABufferLike;
}

// Ordered-with-gaps contents containment for same-kind typed arrays,
// DataViews, and ArrayBuffers. Throws node's detached-buffer TypeError.
static bool partialBufferContentsEquiv(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue actualValue, JSC::JSValue expectedValue)
{
    std::span<const uint8_t> actual, expected;
    JSC::TypedArrayType actualType = JSC::TypedArrayType::NotTypedArray;
    JSC::TypedArrayType expectedType = JSC::TypedArrayType::NotTypedArray;
    auto actualResult = byteSpanOf(actualValue, actual, actualType);
    auto expectedResult = byteSpanOf(expectedValue, expected, expectedType);
    if (actualResult == ByteSpanResult::Detached || expectedResult == ByteSpanResult::Detached) {
        // node reaches this branch via `new Uint8Array(detached)`, which
        // throws; keep the exact error contract.
        throwTypeError(globalObject, scope, "Cannot perform Construct on a detached ArrayBuffer"_s);
        return false;
    }
    if (actualResult != ByteSpanResult::Ok || expectedResult != ByteSpanResult::Ok || actualType != expectedType)
        return false;

    bool result;
    switch (actualType) {
    case JSC::TypeInt8:
        result = partialIntSequenceContains<int8_t>(actual, expected);
        break;
    case JSC::TypeInt16:
        result = partialIntSequenceContains<int16_t>(actual, expected);
        break;
    case JSC::TypeInt32:
        result = partialIntSequenceContains<int32_t>(actual, expected);
        break;
    case JSC::TypeUint16:
        result = partialIntSequenceContains<uint16_t>(actual, expected);
        break;
    case JSC::TypeUint32:
        result = partialIntSequenceContains<uint32_t>(actual, expected);
        break;
    case JSC::TypeBigInt64:
        result = partialIntSequenceContains<int64_t>(actual, expected);
        break;
    case JSC::TypeBigUint64:
        result = partialIntSequenceContains<uint64_t>(actual, expected);
        break;
    case JSC::TypeFloat16:
        result = partialFloat16SequenceContains(actual, expected);
        break;
    case JSC::TypeFloat32:
        result = partialFloatSequenceContains<float, uint32_t>(actual, expected);
        break;
    case JSC::TypeFloat64:
        result = partialFloatSequenceContains<double, uint64_t>(actual, expected);
        break;
    default:
        // Uint8, Uint8Clamped, DataView, and raw ArrayBuffers: byte-wise.
        result = partialIntSequenceContains<uint8_t>(actual, expected);
        break;
    }
    return result;
}

extern "C" bool JSC__JSValue__strictDeepEquals(JSC::EncodedJSValue, JSC::EncodedJSValue, JSC::JSGlobalObject*);

// assert.partialDeepStrictEqual (node's kPartial mode), fully native. `expected` must be
// recursively contained in `actual`; cycles are accepted only when both sides revisit together.
// https://github.com/nodejs/node/blob/main/lib/internal/util/comparisons.js
namespace PartialDeepEqual {

struct CycleState {
    WTF::Vector<JSC::JSCell*, 8> actualSeen;
    WTF::Vector<JSC::JSCell*, 8> expectedSeen;
};

static bool compareBranch(JSC::JSGlobalObject*, JSC::MarkedArgumentBuffer&, CycleState&, JSC::ThrowScope&, JSValue actual, JSValue expected);

// Both-sides cycle guard: a cycle is accepted only when actual and expected
// each cycle back on their own side together.
template<typename Body>
static bool withCycleGuard(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSValue actual, JSValue expected, Body body)
{
    JSC::JSCell* actualCell = actual.asCell();
    JSC::JSCell* expectedCell = expected.asCell();
    const bool hadActual = cycles.actualSeen.contains(actualCell);
    const bool hadExpected = cycles.expectedSeen.contains(expectedCell);
    if (hadActual && hadExpected)
        return true;
    if (hadActual || hadExpected)
        return false;
    cycles.actualSeen.append(actualCell);
    cycles.expectedSeen.append(expectedCell);
    const bool result = body(globalObject, gcBuffer, cycles, scope, actual, expected);
    cycles.actualSeen.removeLast();
    cycles.expectedSeen.removeLast();
    return result;
}

// JS `actual[key]` guarded by `ObjectPrototypePropertyIsEnumerable`: the
// property must be an own enumerable of `actual`, but the value read is an
// ordinary get, exactly like the JS implementation.
static bool ownEnumerableThenCompare(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSC::JSObject* actualObject, JSC::JSObject* expectedObject, JSC::PropertyName propertyName)
{
    JSC::PropertySlot ownSlot(actualObject, JSC::PropertySlot::InternalMethodType::GetOwnProperty);
    bool owns = actualObject->methodTable()->getOwnPropertySlot(actualObject, globalObject, propertyName, ownSlot);
    RETURN_IF_EXCEPTION(scope, false);
    if (!owns || (ownSlot.attributes() & JSC::PropertyAttribute::DontEnum))
        return false;
    JSValue actualValue = actualObject->get(globalObject, propertyName);
    RETURN_IF_EXCEPTION(scope, false);
    JSValue expectedValue = expectedObject->get(globalObject, propertyName);
    RETURN_IF_EXCEPTION(scope, false);
    return compareBranch(globalObject, gcBuffer, cycles, scope, actualValue, expectedValue);
}

// Compares the class strings of Object.prototype.toString. node compares the raw tags, so it also rejects a tag that is not a string or that spells the built-in class name.
static NEVER_INLINE bool sameTypeTag(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSValue actual, JSValue expected)
{
    JSC::JSString* actualTag = JSC::objectPrototypeToString(globalObject, actual);
    RETURN_IF_EXCEPTION(scope, false);
    JSC::JSString* expectedTag = JSC::objectPrototypeToString(globalObject, expected);
    RETURN_IF_EXCEPTION(scope, false);
    return actualTag->equal(globalObject, expectedTag);
}

// Both structures hold the same class string in JSC's cache, which never holds an own tag or a getter's.
static ALWAYS_INLINE bool sameCachedTypeTag(JSC::JSObject* actual, JSC::JSObject* expected)
{
    JSC::Structure* actualStructure = actual->structure();
    JSC::Structure* expectedStructure = expected->structure();
    JSValue tag = actualStructure->cachedSpecialProperty(JSC::CachedSpecialPropertyKey::ToStringTag);
    return tag && (actualStructure == expectedStructure || tag == expectedStructure->cachedSpecialProperty(JSC::CachedSpecialPropertyKey::ToStringTag));
}

static bool subsetOfKeys(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSC::JSObject* actualObject, JSC::JSObject* expectedObject, const JSC::PropertyNameArrayBuilder& names)
{
    for (size_t i = 0; i < names.size(); i++) {
        bool equal = ownEnumerableThenCompare(globalObject, gcBuffer, cycles, scope, actualObject, expectedObject, names[i]);
        RETURN_IF_EXCEPTION(scope, false);
        if (!equal)
            return false;
    }
    return true;
}

// Own enumerable string and symbol properties of `expected` only.
static bool objectSubset(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSValue actual, JSValue expected)
{
    auto& vm = globalObject->vm();
    JSC::JSObject* actualObject = actual.getObject();
    JSC::JSObject* expectedObject = expected.getObject();
    if (!actualObject || !expectedObject)
        return false;
    JSC::PropertyNameArrayBuilder names(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
    expectedObject->methodTable()->getOwnPropertyNames(expectedObject, globalObject, names, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, false);
    return subsetOfKeys(globalObject, gcBuffer, cycles, scope, actualObject, expectedObject, names);
}

// Expected's own enumerable non-index string+symbol properties only — index keys are covered
// by the caller's subsequence/contents comparison (enforcing them here would break with-gaps).
static bool nonIndexObjectSubset(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSValue actual, JSValue expected)
{
    auto& vm = globalObject->vm();
    JSC::JSObject* actualObject = actual.getObject();
    JSC::JSObject* expectedObject = expected.getObject();
    // getOwnNonIndexPropertyNames skips integer indexes at the source (no per-element Identifier
    // for typed arrays). Array/typed-array `length` is non-enumerable/prototype so neither appears.
    JSC::PropertyNameArrayBuilder names(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
    expectedObject->getOwnNonIndexPropertyNames(globalObject, names, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, false);
    return subsetOfKeys(globalObject, gcBuffer, cycles, scope, actualObject, expectedObject, names);
}

// node's getOwnNonIndexProperties(array, ONLY_ENUMERABLE). A Proxy lists its keys with ownKeys and is asked for the descriptor of each non-index key.
static void ownEnumerableNonIndexKeys(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* array, JSC::PropertyNameArrayBuilder& names)
{
    if (array->type() != JSC::ProxyObjectType) [[likely]] {
        array->getOwnNonIndexPropertyNames(globalObject, names, JSC::DontEnumPropertiesMode::Exclude);
        return;
    }
    JSC::PropertyNameArrayBuilder keys(globalObject->vm(), JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
    array->methodTable()->getOwnPropertyNames(array, globalObject, keys, JSC::DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, void());
    for (const auto& key : keys) {
        if (JSC::parseIndex(key))
            continue;
        JSC::PropertySlot slot(array, JSC::PropertySlot::InternalMethodType::GetOwnProperty);
        bool owns = array->methodTable()->getOwnPropertySlot(array, globalObject, key, slot);
        RETURN_IF_EXCEPTION(scope, void());
        if (owns && !(slot.attributes() & JSC::PropertyAttribute::DontEnum))
            names.add(key);
    }
}

// A real array keeps its own named keys in its Structure, and has none when no property slot is in use.
static ALWAYS_INLINE bool hasNoNamedKeys(JSC::JSObject* array)
{
    if (!JSC::isJSArray(array))
        return false;
    JSC::Structure* structure = array->structure();
    return structure->maxOffset() == JSC::invalidOffset && !structure->hasNonReifiedStaticProperties();
}

static NEVER_INLINE bool ownsIndex(JSC::JSGlobalObject* globalObject, JSC::JSObject* array, uint64_t index)
{
    if (index <= MAX_ARRAY_INDEX) [[likely]]
        return array->hasOwnProperty(globalObject, static_cast<unsigned>(index));
    return array->hasOwnProperty(globalObject, JSC::Identifier::from(globalObject->vm(), index));
}

// node's hole test (`array[index] === undefined && !hasOwn(array, index)`). Returns empty for a hole, and for an exception.
static ALWAYS_INLINE JSValue elementOrHole(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* array, uint64_t index)
{
    if (index <= MAX_ARRAY_INDEX) [[likely]] {
        if (JSValue element = array->tryGetIndexQuickly(static_cast<unsigned>(index))) [[likely]]
            return element;
    }
    JSValue element = array->get(globalObject, index);
    RETURN_IF_EXCEPTION(scope, {});
    if (element.isUndefined()) {
        bool owns = ownsIndex(globalObject, array, index);
        RETURN_IF_EXCEPTION(scope, {});
        if (!owns)
            return {};
    }
    return element;
}

// Appends the slots of [start, usedLength) that `isPresent` accepts, counted first so the list grows once, and returns how many it accepts before `start`.
template<typename IsPresent>
static ALWAYS_INLINE uint32_t appendPresentSlots(unsigned usedLength, uint32_t start, WTF::Vector<uint32_t, 16>& indexes, const IsPresent& isPresent)
{
    const unsigned prefix = std::min(start, usedLength);
    uint32_t before = 0;
    for (unsigned i = 0; i < prefix; ++i)
        before += isPresent(i);
    size_t count = 0;
    for (unsigned i = prefix; i < usedLength; ++i)
        count += isPresent(i);
    indexes.reserveCapacity(indexes.size() + count);
    for (unsigned i = prefix; count; ++i) {
        if (isPresent(i)) {
            indexes.append(i);
            count--;
        }
    }
    return before;
}

// The walk of JSObject::getOwnIndexedPropertyNames without an Identifier per index: appends the own enumerable indexes from `start` on, ascending, and returns how many come before `start`.
static uint32_t appendOwnEnumerableIndexes(JSC::JSArray* array, uint32_t start, WTF::Vector<uint32_t, 16>& indexes)
{
    switch (array->indexingType()) {
    case ALL_BLANK_INDEXING_TYPES:
    case ALL_UNDECIDED_INDEXING_TYPES:
        return 0;

    case ALL_INT32_INDEXING_TYPES:
    case ALL_CONTIGUOUS_INDEXING_TYPES: {
        JSC::Butterfly* butterfly = array->butterfly();
        return appendPresentSlots(butterfly->publicLength(), start, indexes, [&](unsigned i) -> bool {
            return !!butterfly->contiguous().at(array, i);
        });
    }

    case ALL_DOUBLE_INDEXING_TYPES: {
        JSC::Butterfly* butterfly = array->butterfly();
        return appendPresentSlots(butterfly->publicLength(), start, indexes, [&](unsigned i) -> bool {
            double value = butterfly->contiguousDouble().at(array, i);
            return value == value;
        });
    }

    case ALL_ARRAY_STORAGE_INDEXING_TYPES: {
        JSC::ArrayStorage* storage = array->butterfly()->arrayStorage();
        uint32_t before = appendPresentSlots(std::min(storage->length(), storage->vectorLength()), start, indexes, [&](unsigned i) -> bool {
            return !!storage->m_vector[i];
        });

        if (JSC::SparseArrayValueMap* map = storage->m_sparseMap.get()) {
            const size_t firstSparse = indexes.size();
            indexes.reserveCapacity(firstSparse + map->size());
            for (const auto& entry : *map) {
                if (entry.attributes() & JSC::PropertyAttribute::DontEnum)
                    continue;
                if (entry.index() < start)
                    before++;
                else
                    indexes.append(entry.index());
            }
            std::ranges::sort(indexes.mutableSpan().subspan(firstSparse));
        }
        return before;
    }

    default:
        ASSERT_NOT_REACHED();
        return 0;
    }
}

// Object.keys(array), listed once at the first hole as node lists it. A real array gives its index keys from its storage, a Proxy through its traps.
class ArrayKeys {
    WTF_FORBID_HEAP_ALLOCATION;
    WTF_MAKE_NONCOPYABLE(ArrayKeys);

public:
    ArrayKeys() = default;

    // No walk reads a key before `start`, the first hole, so a real array only counts those. `listedNames` are its named keys when the caller has them (strings, then symbols).
    void list(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* array, uint64_t start, const JSC::PropertyNameArrayBuilder* listedNames)
    {
        m_array = array;
        if (!JSC::isJSArray(array)) {
            m_ownNames.emplace(globalObject->vm(), JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
            array->methodTable()->getOwnPropertyNames(array, globalObject, *m_ownNames, JSC::DontEnumPropertiesMode::Exclude);
            RETURN_IF_EXCEPTION(scope, void());
            m_names = &*m_ownNames;
            m_nameCount = m_ownNames->size();
            return;
        }
        m_before = appendOwnEnumerableIndexes(uncheckedDowncast<JSC::JSArray>(array), static_cast<uint32_t>(std::min<uint64_t>(start, std::numeric_limits<uint32_t>::max())), m_indexes);
        if (listedNames) {
            m_names = listedNames;
            while (m_nameCount < listedNames->size() && !(*listedNames)[m_nameCount].isSymbol())
                m_nameCount++;
            return;
        }
        if (hasNoNamedKeys(array))
            return;
        m_ownNames.emplace(globalObject->vm(), JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
        array->getOwnNonIndexPropertyNames(globalObject, *m_ownNames, JSC::DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, void());
        m_names = &*m_ownNames;
        m_nameCount = m_ownNames->size();
    }

    // Object.keys(array).length
    int64_t count() const { return static_cast<int64_t>(m_before + m_indexes.size() + m_nameCount); }

    // array[Object.keys(array)[position]], for a position from `start` on.
    ALWAYS_INLINE JSValue valueAt(JSC::JSGlobalObject* globalObject, int64_t position) const
    {
        ASSERT(position >= static_cast<int64_t>(m_before) && position < count());
        const size_t offset = static_cast<size_t>(position) - m_before;
        if (offset < m_indexes.size()) {
            const uint32_t index = m_indexes[offset];
            if (JSValue element = m_array->tryGetIndexQuickly(index)) [[likely]]
                return element;
            return m_array->get(globalObject, index);
        }
        return m_array->get(globalObject, (*m_names)[static_cast<unsigned>(offset - m_indexes.size())]);
    }

private:
    JSC::JSObject* m_array { nullptr };
    size_t m_before { 0 };
    WTF::Vector<uint32_t, 16> m_indexes;
    const JSC::PropertyNameArrayBuilder* m_names { nullptr };
    size_t m_nameCount { 0 };
    std::optional<JSC::PropertyNameArrayBuilder> m_ownNames;
};

// node's partialSparseArrayEquiv (lib/internal/util/comparisons.js#L923-L943 at v26.3.0). The starts are array positions, so they can be past the key counts.
static NEVER_INLINE bool sparseArraySubsequence(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSC::JSObject* actual, uint64_t actualStart, JSC::JSObject* expected, uint64_t expectedStart, const JSC::PropertyNameArrayBuilder* expectedNames)
{
    ArrayKeys actualKeys;
    actualKeys.list(globalObject, scope, actual, actualStart, nullptr);
    RETURN_IF_EXCEPTION(scope, false);
    ArrayKeys expectedKeys;
    expectedKeys.list(globalObject, scope, expected, expectedStart, expectedNames);
    RETURN_IF_EXCEPTION(scope, false);

    const int64_t actualCount = actualKeys.count();
    const int64_t remainingExpected = expectedKeys.count() - static_cast<int64_t>(expectedStart);
    int64_t actualPos = static_cast<int64_t>(actualStart);
    if (actualCount - actualPos < remainingExpected)
        return false;

    for (int64_t i = 0; i < remainingExpected; i++) {
        while (true) {
            JSValue actualValue = actualKeys.valueAt(globalObject, actualPos);
            RETURN_IF_EXCEPTION(scope, false);
            JSValue expectedValue = expectedKeys.valueAt(globalObject, static_cast<int64_t>(expectedStart) + i);
            RETURN_IF_EXCEPTION(scope, false);
            bool equal = compareBranch(globalObject, gcBuffer, cycles, scope, actualValue, expectedValue);
            RETURN_IF_EXCEPTION(scope, false);
            if (equal)
                break;
            actualPos++;
            if (actualPos > actualCount - remainingExpected + i)
                return false;
        }
        actualPos++;
    }
    return true;
}

// What node's array arm settles before it looks for a cycle.
struct ArrayPair {
    uint64_t actualLength { 0 };
    uint64_t expectedLength { 0 };
    // Expected's own enumerable non-index keys, or null when it has none.
    const JSC::PropertyNameArrayBuilder* expectedNames { nullptr };
};

// node's array arm behind the cycle check: expected's named keys, then expected's elements as a subsequence of actual's.
static bool arraySubsequence(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSValue actual, JSValue expected, const ArrayPair& pair)
{
    JSC::JSObject* actualObject = actual.getObject();
    JSC::JSObject* expectedObject = expected.getObject();
    if (pair.expectedNames) {
        bool namesEqual = subsetOfKeys(globalObject, gcBuffer, cycles, scope, actualObject, expectedObject, *pair.expectedNames);
        RETURN_IF_EXCEPTION(scope, false);
        if (!namesEqual)
            return false;
    }

    // node's partialArrayEquiv (comparisons.js#L945-L965 at v26.3.0) until the first hole, except that node reads both lengths again at every step.
    uint64_t actualPos = 0;
    for (uint64_t i = 0; i < pair.expectedLength; i++) {
        JSValue expectedElement = elementOrHole(globalObject, scope, expectedObject, i);
        if (!expectedElement) [[unlikely]] {
            RETURN_IF_EXCEPTION(scope, false);
            return sparseArraySubsequence(globalObject, gcBuffer, cycles, scope, actualObject, actualPos, expectedObject, i, pair.expectedNames);
        }
        const uint64_t lastCandidate = pair.actualLength - pair.expectedLength + i;
        bool matched = false;
        while (actualPos <= lastCandidate) {
            JSValue actualElement = elementOrHole(globalObject, scope, actualObject, actualPos);
            if (!actualElement) [[unlikely]] {
                RETURN_IF_EXCEPTION(scope, false);
                return sparseArraySubsequence(globalObject, gcBuffer, cycles, scope, actualObject, actualPos, expectedObject, i, pair.expectedNames);
            }
            bool equal = compareBranch(globalObject, gcBuffer, cycles, scope, actualElement, expectedElement);
            RETURN_IF_EXCEPTION(scope, false);
            actualPos++;
            if (equal) {
                matched = true;
                break;
            }
        }
        if (!matched)
            return false;
    }
    return true;
}

// node's array arm ahead of the cycle check (comparisons.js#L294-L308 and #L510-L515 at v26.3.0): the length gate, expected's named keys, and the exit for an empty expected. Its exit for `expected.size === 0` is not ported.
static bool arrayArm(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSValue actual, JSValue expected)
{
    JSC::JSObject* expectedObject = expected.getObject();
    ArrayPair pair;
    pair.actualLength = static_cast<uint64_t>(JSC::toLength(globalObject, actual.getObject()));
    RETURN_IF_EXCEPTION(scope, false);
    pair.expectedLength = static_cast<uint64_t>(JSC::toLength(globalObject, expectedObject));
    RETURN_IF_EXCEPTION(scope, false);
    if (pair.expectedLength > pair.actualLength)
        return false;

    std::optional<JSC::PropertyNameArrayBuilder> expectedNames;
    if (!hasNoNamedKeys(expectedObject)) [[unlikely]] {
        expectedNames.emplace(globalObject->vm(), JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
        ownEnumerableNonIndexKeys(globalObject, scope, expectedObject, *expectedNames);
        RETURN_IF_EXCEPTION(scope, false);
        if (expectedNames->size())
            pair.expectedNames = &*expectedNames;
    }
    if (!pair.expectedLength && !pair.expectedNames)
        return true;

    return withCycleGuard(globalObject, gcBuffer, cycles, scope, actual, expected, [&pair](auto&&... arguments) {
        return arraySubsequence(arguments..., pair);
    });
}

// Expected's entries as a subset of actual's: identity keys fast-path with
// index reservation so no actual entry is consumed twice; object keys match
// by partial deep equality.
static bool mapSubset(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSValue actual, JSValue expected)
{
    auto& vm = globalObject->vm();
    JSC::JSMap* actualMap = uncheckedDowncast<JSC::JSMap>(actual.asCell());
    JSC::JSMap* expectedMap = uncheckedDowncast<JSC::JSMap>(expected.asCell());

    // Materialized lazily, rooted in gcBuffer (keys then values, pairwise).
    bool materialized = false;
    size_t entriesStart = 0;
    size_t entryCount = 0;
    WTF::Vector<bool, 8> usedIndices;
    JSC::MarkedArgumentBuffer usedIdentityKeys;

    auto materialize = [&]() -> bool {
        if (materialized)
            return true;
        materialized = true;
        entriesStart = gcBuffer.size();
        auto iter = JSC::JSMapIterator::create(vm, globalObject->mapIteratorStructure(), actualMap, JSC::IterationKind::Entries);
        if (scope.exception()) [[unlikely]]
            return false;
        JSValue key, value;
        while (iter->nextKeyValue(globalObject, key, value)) {
            gcBuffer.append(key);
            gcBuffer.append(value);
            entryCount++;
        }
        usedIndices.fill(false, entryCount);
        return true;
    };

    auto identityKeyUsed = [&](JSValue key) -> bool {
        for (size_t i = 0; i < usedIdentityKeys.size(); i++) {
            bool same = JSC::sameValue(globalObject, usedIdentityKeys.at(i), key);
            // sameValue can resolve ropes and throw; plain check because the macro can't live
            // inside a lambda — callers RETURN_IF_EXCEPTION right after this returns.
            if (scope.exception()) [[unlikely]]
                return false;
            if (same)
                return true;
        }
        return false;
    };

    auto expectedIter = JSC::JSMapIterator::create(vm, globalObject->mapIteratorStructure(), expectedMap, JSC::IterationKind::Entries);
    RETURN_IF_EXCEPTION(scope, false);
    JSValue expectedKey, expectedValue;
    while (expectedIter->nextKeyValue(globalObject, expectedKey, expectedValue)) {
        bool consumed = false;
        bool identityPresent = actualMap->has(globalObject, expectedKey);
        RETURN_IF_EXCEPTION(scope, false);
        bool expectedKeyAlreadyUsed = identityKeyUsed(expectedKey);
        // sameValue can resolve rope strings and throw; the lambda cannot
        // hold the check macro, so check at every call site.
        RETURN_IF_EXCEPTION(scope, false);
        if (identityPresent && !expectedKeyAlreadyUsed) {
            // Reserve the identity entry's index so the deep-matching loop
            // below cannot consume it twice.
            size_t identityIndex = SIZE_MAX;
            if (materialized) {
                for (size_t i = 0; i < entryCount; i++) {
                    bool same = JSC::sameValueZero(globalObject, gcBuffer.at(entriesStart + i * 2), expectedKey);
                    // Same rope-resolution hazard as identityKeyUsed: bail
                    // before the next VM-entering call, not after the loop.
                    RETURN_IF_EXCEPTION(scope, false);
                    if (same) {
                        identityIndex = i;
                        break;
                    }
                }
            }
            if (identityIndex == SIZE_MAX || !usedIndices[identityIndex]) {
                JSValue actualValue = actualMap->get(globalObject, expectedKey);
                RETURN_IF_EXCEPTION(scope, false);
                bool equal = compareBranch(globalObject, gcBuffer, cycles, scope, actualValue, expectedValue);
                RETURN_IF_EXCEPTION(scope, false);
                if (equal) {
                    usedIdentityKeys.append(expectedKey);
                    if (identityIndex != SIZE_MAX)
                        usedIndices[identityIndex] = true;
                    consumed = true;
                }
            }
        }
        if (consumed)
            continue;
        if (!expectedKey.isObject())
            return false;
        if (!materialize())
            return false;
        RETURN_IF_EXCEPTION(scope, false);
        bool matched = false;
        for (size_t i = 0; i < entryCount; i++) {
            if (usedIndices[i])
                continue;
            JSValue candidateKey = gcBuffer.at(entriesStart + i * 2);
            bool candidateIsUsedIdentity = identityKeyUsed(candidateKey);
            RETURN_IF_EXCEPTION(scope, false);
            if (candidateIsUsedIdentity)
                continue;
            bool keyEqual = compareBranch(globalObject, gcBuffer, cycles, scope, candidateKey, expectedKey);
            RETURN_IF_EXCEPTION(scope, false);
            if (!keyEqual)
                continue;
            bool valueEqual = compareBranch(globalObject, gcBuffer, cycles, scope, gcBuffer.at(entriesStart + i * 2 + 1), expectedValue);
            RETURN_IF_EXCEPTION(scope, false);
            if (valueEqual) {
                usedIndices[i] = true;
                matched = true;
                break;
            }
        }
        if (!matched)
            return false;
    }
    return true;
}

// Expected's items as a subset of actual's; item equality is the partial
// comparison itself — node matches object items with subset semantics
// (Set([{a:1,b:2}]) partially contains Set([{a:1}])).
static bool setSubset(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSValue actual, JSValue expected)
{
    auto& vm = globalObject->vm();
    JSC::JSSet* actualSet = uncheckedDowncast<JSC::JSSet>(actual.asCell());
    JSC::JSSet* expectedSet = uncheckedDowncast<JSC::JSSet>(expected.asCell());

    const size_t itemsStart = gcBuffer.size();
    size_t itemCount = 0;
    {
        auto iter = JSC::JSSetIterator::create(vm, globalObject->setIteratorStructure(), actualSet, JSC::IterationKind::Keys);
        RETURN_IF_EXCEPTION(scope, false);
        JSValue item;
        while (iter->next(globalObject, item)) {
            gcBuffer.append(item);
            itemCount++;
        }
    }
    WTF::Vector<bool, 8> usedIndices;
    usedIndices.fill(false, itemCount);

    auto expectedIter = JSC::JSSetIterator::create(vm, globalObject->setIteratorStructure(), expectedSet, JSC::IterationKind::Keys);
    RETURN_IF_EXCEPTION(scope, false);
    JSValue expectedItem;
    while (expectedIter->next(globalObject, expectedItem)) {
        bool matched = false;
        for (size_t i = 0; i < itemCount; i++) {
            if (usedIndices[i])
                continue;
            bool equal = compareBranch(globalObject, gcBuffer, cycles, scope, gcBuffer.at(itemsStart + i), expectedItem);
            RETURN_IF_EXCEPTION(scope, false);
            if (equal) {
                usedIndices[i] = true;
                matched = true;
                break;
            }
        }
        if (!matched)
            return false;
    }
    return true;
}

// Errors compare name/message/errors leniently: `undefined` (or an empty
// expected message) on the expected side is ignored. An own `cause` on the
// expected error (even undefined) must exist on the actual error as well.
static bool errorSubset(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSValue actual, JSValue expected)
{
    auto& vm = globalObject->vm();
    JSC::JSObject* actualObject = actual.getObject();
    JSC::JSObject* expectedObject = expected.getObject();

    const JSC::Identifier keys[3] = {
        vm.propertyNames->message,
        vm.propertyNames->name,
        JSC::Identifier::fromString(vm, "errors"_s),
    };
    for (const auto& key : keys) {
        JSValue expectedValue = expectedObject->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
        if (expectedValue.isUndefined())
            continue;
        if (key == vm.propertyNames->message && expectedValue.isString()) {
            auto* str = JSC::asString(expectedValue);
            if (!str->length())
                continue;
        }
        JSValue actualValue = actualObject->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
        bool equal = compareBranch(globalObject, gcBuffer, cycles, scope, actualValue, expectedValue);
        RETURN_IF_EXCEPTION(scope, false);
        if (!equal)
            return false;
    }

    const JSC::Identifier causeIdentifier = JSC::Identifier::fromString(vm, "cause"_s);
    JSC::PropertySlot expectedCauseSlot(expectedObject, JSC::PropertySlot::InternalMethodType::GetOwnProperty);
    bool expectedHasCause = expectedObject->methodTable()->getOwnPropertySlot(expectedObject, globalObject, causeIdentifier, expectedCauseSlot);
    RETURN_IF_EXCEPTION(scope, false);
    if (expectedHasCause) {
        JSC::PropertySlot actualCauseSlot(actualObject, JSC::PropertySlot::InternalMethodType::GetOwnProperty);
        bool actualHasCause = actualObject->methodTable()->getOwnPropertySlot(actualObject, globalObject, causeIdentifier, actualCauseSlot);
        RETURN_IF_EXCEPTION(scope, false);
        if (!actualHasCause)
            return false;
        JSValue actualCause = actualObject->get(globalObject, causeIdentifier);
        RETURN_IF_EXCEPTION(scope, false);
        JSValue expectedCause = expectedObject->get(globalObject, causeIdentifier);
        RETURN_IF_EXCEPTION(scope, false);
        bool equal = compareBranch(globalObject, gcBuffer, cycles, scope, actualCause, expectedCause);
        RETURN_IF_EXCEPTION(scope, false);
        if (!equal)
            return false;
    }
    return objectSubset(globalObject, gcBuffer, cycles, scope, actual, expected);
}

static JSC::JSWrapperObject* asBoxedPrimitive(JSValue value)
{
    if (!value.isCell())
        return nullptr;
    JSC::JSCell* cell = value.asCell();
    if (cell->inherits<JSC::NumberObject>() || cell->inherits<JSC::BooleanObject>()
        || cell->inherits<JSC::BigIntObject>() || cell->inherits<JSC::SymbolObject>()
        || cell->inherits<JSC::StringObject>())
        return uncheckedDowncast<JSC::JSWrapperObject>(cell);
    return nullptr;
}

// Container contents first, then own enumerable properties on the Map/Set
// object itself — node's partial mode checks both (subset semantics), like
// every other container arm.
static bool mapSubsetAndProps(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSValue actual, JSValue expected)
{
    bool contents = mapSubset(globalObject, gcBuffer, cycles, scope, actual, expected);
    RETURN_IF_EXCEPTION(scope, false);
    if (!contents)
        return false;
    return objectSubset(globalObject, gcBuffer, cycles, scope, actual, expected);
}

static bool setSubsetAndProps(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSValue actual, JSValue expected)
{
    bool contents = setSubset(globalObject, gcBuffer, cycles, scope, actual, expected);
    RETURN_IF_EXCEPTION(scope, false);
    if (!contents)
        return false;
    return objectSubset(globalObject, gcBuffer, cycles, scope, actual, expected);
}

static bool isSpecialValue(JSValue value)
{
    // `typeof x !== "object"`: primitives, null, and callables are decided
    // by full strict deep equality. Every specific type (Error, Date, RegExp,
    // boxed primitives, ...) has already been handled by its own arm above.
    return !value.isObject() || value.isCallable();
}

static bool compareBranch(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSValue actual, JSValue expected)
{
    auto& vm = globalObject->vm();
    if (!vm.isSafeToRecurse()) [[unlikely]] {
        JSC::throwStackOverflowError(globalObject, scope);
        return false;
    }

    bool referenceEqual = JSC::sameValueZero(globalObject, actual, expected);
    RETURN_IF_EXCEPTION(scope, false);
    if (referenceEqual) {
        // `actual === expected` except +0 vs -0, which Object.is rejects.
        if (actual.isNumber() && actual.asNumber() == 0)
            return std::signbit(actual.asNumber()) == std::signbit(expected.asNumber());
        // sameValueZero also accepts NaN === NaN, which the JS fast path
        // (===) rejected — but every NaN pair falls through to isSpecial →
        // strict deepEquals, which accepts it, so accepting here matches.
        return true;
    }

    const JSC::JSType actualType = actual.isCell() ? actual.asCell()->type() : JSC::JSType(0);
    const JSC::JSType expectedType = expected.isCell() ? expected.asCell()->type() : JSC::JSType(0);

    // Distinct weak collections and promises are never partially equal.
    if (actualType == JSC::JSWeakSetType || actualType == JSC::JSWeakMapType || actualType == JSC::JSPromiseType
        || expectedType == JSC::JSWeakSetType || expectedType == JSC::JSWeakMapType || expectedType == JSC::JSPromiseType)
        return false;

    const bool actualIsView = actual.isCell() && JSC::isTypedArrayTypeIncludingDataView(actualType);
    const bool expectedIsView = expected.isCell() && JSC::isTypedArrayTypeIncludingDataView(expectedType);
    if (actualIsView || expectedIsView) {
        if (actualIsView != expectedIsView || actualType != expectedType)
            return false;
        bool contents = partialBufferContentsEquiv(globalObject, scope, actual, expected);
        RETURN_IF_EXCEPTION(scope, false);
        if (!contents)
            return false;
        if (actualType == JSC::DataViewType)
            return withCycleGuard(globalObject, gcBuffer, cycles, scope, actual, expected, objectSubset);
        // node also matches expected's own enumerable non-index properties
        // on typed arrays; index keys stay with the contents containment.
        return withCycleGuard(globalObject, gcBuffer, cycles, scope, actual, expected, nonIndexObjectSubset);
    }

    // node compares Symbol.toStringTag in every arm but the view arm, which compares the intrinsic tag.
    if (actual.isObject() && expected.isObject() && !sameCachedTypeTag(JSC::asObject(actual), JSC::asObject(expected))) {
        if (!actual.isCallable() && !expected.isCallable()) {
            bool tagsEqual = sameTypeTag(globalObject, scope, actual, expected);
            RETURN_IF_EXCEPTION(scope, false);
            if (!tagsEqual)
                return false;
        }
    }

    if (actualType == JSC::JSMapType && expectedType == JSC::JSMapType) {
        if (uncheckedDowncast<JSC::JSMap>(expected.asCell())->size() > uncheckedDowncast<JSC::JSMap>(actual.asCell())->size())
            return false;
        return withCycleGuard(globalObject, gcBuffer, cycles, scope, actual, expected, mapSubsetAndProps);
    }

    const bool actualIsBuffer = actualType == JSC::ArrayBufferType;
    const bool expectedIsBuffer = expectedType == JSC::ArrayBufferType;
    if (actualIsBuffer || expectedIsBuffer) {
        if (actualIsBuffer != expectedIsBuffer)
            return false;
        bool contents = partialBufferContentsEquiv(globalObject, scope, actual, expected);
        RETURN_IF_EXCEPTION(scope, false);
        if (!contents)
            return false;
        return withCycleGuard(globalObject, gcBuffer, cycles, scope, actual, expected, objectSubset);
    }

    const bool actualIsKeyObject = actual.isCell() && actual.asCell()->inherits<Bun::JSKeyObject>();
    const bool expectedIsKeyObject = expected.isCell() && expected.asCell()->inherits<Bun::JSKeyObject>();
    if (actualIsKeyObject || expectedIsKeyObject) {
        if (!actualIsKeyObject || !expectedIsKeyObject)
            return false;
        // KeyObject.prototype.equals, called like the JS implementation did.
        JSC::JSObject* actualObject = actual.getObject();
        JSValue equalsFunction = actualObject->get(globalObject, JSC::Identifier::fromString(vm, "equals"_s));
        RETURN_IF_EXCEPTION(scope, false);
        auto callData = JSC::getCallData(equalsFunction);
        if (callData.type == JSC::CallData::Type::None)
            return false;
        JSC::MarkedArgumentBuffer args;
        args.append(expected);
        JSValue result = JSC::call(globalObject, equalsFunction, callData, actual, args);
        RETURN_IF_EXCEPTION(scope, false);
        if (!result.toBoolean(globalObject))
            return false;
        return withCycleGuard(globalObject, gcBuffer, cycles, scope, actual, expected, objectSubset);
    }

    const bool actualIsURL = actual.isCell() && actual.asCell()->inherits<WebCore::JSDOMURL>();
    const bool expectedIsURL = expected.isCell() && expected.asCell()->inherits<WebCore::JSDOMURL>();
    if (actualIsURL || expectedIsURL) {
        if (!actualIsURL || !expectedIsURL)
            return false;
        auto& actualURL = uncheckedDowncast<WebCore::JSDOMURL>(actual.asCell())->wrapped();
        auto& expectedURL = uncheckedDowncast<WebCore::JSDOMURL>(expected.asCell())->wrapped();
        if (actualURL.href() != expectedURL.href())
            return false;
        return withCycleGuard(globalObject, gcBuffer, cycles, scope, actual, expected, objectSubset);
    }

    const bool actualIsError = actual.isCell() && actual.asCell()->inherits<JSC::ErrorInstance>();
    const bool expectedIsError = expected.isCell() && expected.asCell()->inherits<JSC::ErrorInstance>();
    if (actualIsError || expectedIsError) {
        if (!actualIsError || !expectedIsError)
            return false;
        return withCycleGuard(globalObject, gcBuffer, cycles, scope, actual, expected, errorSubset);
    }

    if (actualType == JSC::JSSetType && expectedType == JSC::JSSetType) {
        if (uncheckedDowncast<JSC::JSSet>(expected.asCell())->size() > uncheckedDowncast<JSC::JSSet>(actual.asCell())->size())
            return false;
        return withCycleGuard(globalObject, gcBuffer, cycles, scope, actual, expected, setSubsetAndProps);
    }

    // Dates and RegExps: internal value compared strictly, own enumerable properties with subset
    // semantics (node's partial mode; straight strict compare would be prototype-sensitive).
    const bool actualIsDate = actualType == JSC::JSDateType;
    const bool expectedIsDate = expectedType == JSC::JSDateType;
    if (actualIsDate || expectedIsDate) {
        if (!actualIsDate || !expectedIsDate)
            return false;
        const double actualTime = uncheckedDowncast<JSC::DateInstance>(actual.asCell())->internalNumber();
        const double expectedTime = uncheckedDowncast<JSC::DateInstance>(expected.asCell())->internalNumber();
        if (actualTime != expectedTime && !(std::isnan(actualTime) && std::isnan(expectedTime)))
            return false;
        return withCycleGuard(globalObject, gcBuffer, cycles, scope, actual, expected, objectSubset);
    }

    const bool actualIsRegExp = actualType == JSC::RegExpObjectType;
    const bool expectedIsRegExp = expectedType == JSC::RegExpObjectType;
    if (actualIsRegExp || expectedIsRegExp) {
        if (!actualIsRegExp || !expectedIsRegExp)
            return false;
        auto* actualRegExp = uncheckedDowncast<JSC::RegExpObject>(actual.asCell());
        auto* expectedRegExp = uncheckedDowncast<JSC::RegExpObject>(expected.asCell());
        if (actualRegExp->regExp()->pattern() != expectedRegExp->regExp()->pattern()
            || actualRegExp->regExp()->flags() != expectedRegExp->regExp()->flags())
            return false;
        // node also compares lastIndex strictly (comparisons.js isRegExp arm).
        bool lastIndexEqual = JSC::sameValue(globalObject, actualRegExp->getLastIndex(), expectedRegExp->getLastIndex());
        RETURN_IF_EXCEPTION(scope, false);
        if (!lastIndexEqual)
            return false;
        return withCycleGuard(globalObject, gcBuffer, cycles, scope, actual, expected, objectSubset);
    }

    // Boxed primitives: [[*Data]] compared via Object.is, then own props as a subset — node
    // unwraps the slot before the property walk. Concrete classes only (JSWrapperObject has no
    // discriminating ClassInfo, so a base-class downcast would match every object).
    auto* actualWrapper = asBoxedPrimitive(actual);
    auto* expectedWrapper = asBoxedPrimitive(expected);
    if (actualWrapper || expectedWrapper) {
        if (!actualWrapper || !expectedWrapper)
            return false;
        bool internalEqual = JSC::sameValue(globalObject, actualWrapper->internalValue(), expectedWrapper->internalValue());
        RETURN_IF_EXCEPTION(scope, false);
        if (!internalEqual)
            return false;
        return withCycleGuard(globalObject, gcBuffer, cycles, scope, actual, expected, objectSubset);
    }

    bool actualIsArray = JSC::isArray(globalObject, actual);
    RETURN_IF_EXCEPTION(scope, false);
    bool expectedIsArray = JSC::isArray(globalObject, expected);
    RETURN_IF_EXCEPTION(scope, false);
    if (actualIsArray != expectedIsArray)
        return false;
    if (actualIsArray)
        return arrayArm(globalObject, gcBuffer, cycles, scope, actual, expected);

    // At least one side is a primitive, null, or callable: full strict deep
    // equality decides.
    if (isSpecialValue(actual) || isSpecialValue(expected)) {
        bool equal = JSC__JSValue__strictDeepEquals(JSValue::encode(actual), JSValue::encode(expected), globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        return equal;
    }

    return withCycleGuard(globalObject, gcBuffer, cycles, scope, actual, expected, objectSubset);
}

} // namespace PartialDeepEqual

JSC_DEFINE_HOST_FUNCTION(jsFunctionPartialDeepStrictEqual,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSC::MarkedArgumentBuffer gcBuffer;
    PartialDeepEqual::CycleState cycles;
    bool result = PartialDeepEqual::compareBranch(globalObject, gcBuffer, cycles, scope, callframe->argument(0), callframe->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(result));
}

extern "C" bool Bun__deepEqualsNodeStrict(JSC::EncodedJSValue a, JSC::EncodedJSValue b, JSC::JSGlobalObject* globalObject);
extern "C" bool Bun__deepEqualsNodeStrictSkipProto(JSC::EncodedJSValue a, JSC::EncodedJSValue b, JSC::JSGlobalObject* globalObject);

// util.isDeepStrictEqual / assert.deepStrictEqual: node semantics including the [[Prototype]]
// identity check Bun.deepEquals omits. argument(2) truthy = node's kStrictWithoutPrototypes.
// https://github.com/nodejs/node/blob/main/lib/internal/util/comparisons.js
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsDeepStrictEqual,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    bool skipPrototype = callframe->argument(2).toBoolean(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    bool result = skipPrototype
        ? Bun__deepEqualsNodeStrictSkipProto(JSValue::encode(callframe->argument(0)), JSValue::encode(callframe->argument(1)), globalObject)
        : Bun__deepEqualsNodeStrict(JSValue::encode(callframe->argument(0)), JSValue::encode(callframe->argument(1)), globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(result));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionIsError,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    if (value.isCell()) {
        if (value.inherits<JSC::ErrorInstance>() || value.asCell()->type() == ErrorInstanceType)
            return JSValue::encode(jsBoolean(true));

        VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSObject* object = value.toObject(globalObject);

        // node util.isError relies on toString
        // https://github.com/nodejs/node/blob/cf8c6994e0f764af02da4fa70bc5962142181bf3/doc/api/util.md#L2923
        // util.isError is deprecated and removed in node 23
        PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, &vm);
        bool has = object->getPropertySlot(globalObject, vm.propertyNames->toStringTagSymbol, slot);
        scope.assertNoException();
        slot.disallowVMEntry.reset();
        if (has) {
            if (slot.isValue()) {
                JSValue value = slot.getValue(globalObject, vm.propertyNames->toStringTagSymbol);
                if (value.isString()) {
                    String tag = asString(value)->value(globalObject);
                    RETURN_IF_EXCEPTION(scope, {});
                    if (tag == "Error"_s)
                        return JSValue::encode(jsBoolean(true));
                }
            }
        }

        // May call a Proxy's getPrototypeOf trap.
        JSValue proto = object->getPrototype(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (proto.isCell() && (proto.inherits<JSC::ErrorInstance>() || proto.asCell()->type() == ErrorInstanceType || proto.inherits<JSC::ErrorPrototype>()))
            return JSValue::encode(jsBoolean(true));
    }

    return JSValue::encode(jsBoolean(false));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsNativeError,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    if (value.isCell()) {
        JSCell* cell = value.asCell();
        if (cell->type() == ErrorInstanceType)
            return JSValue::encode(jsBoolean(true));

        // Workaround for https://github.com/oven-sh/bun/issues/11780
        // They have code that does
        //      assert(util.types.isNativeError(resolveMessage))
        // FIXME: delete this once ResolveMessage and BuildMessage extend Error
        if (cell->inherits<Bun::Bindgen::Generated::JSResolveMessage>() || cell->inherits<Bun::Bindgen::Generated::JSBuildMessage>())
            return JSValue::encode(jsBoolean(true));
    }

    return JSValue::encode(jsBoolean(false));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsRegExp,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    return JSValue::encode(
        jsBoolean(value.isCell() && value.asCell()->type() == RegExpObjectType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsAsyncFunction,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE

    auto* function = dynamicDowncast<JSFunction>(value);
    if (!function || function->isHostFunction())
        return JSValue::encode(jsBoolean(false));

    auto* executable = function->jsExecutable();
    if (!executable)
        return JSValue::encode(jsBoolean(false));

    if (executable->isAsyncGenerator()) {
        return JSValue::encode(jsBoolean(true));
    }

    auto proto = function->getPrototype(globalObject);
    if (!proto.isCell()) {
        return JSValue::encode(jsBoolean(false));
    }

    auto* protoCell = proto.asCell();
    return JSValue::encode(
        jsBoolean(protoCell->inherits<AsyncFunctionPrototype>()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsGeneratorFunction,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_VALUE
    auto* function = dynamicDowncast<JSFunction>(value);
    if (!function || function->isHostFunction())
        return JSValue::encode(jsBoolean(false));

    auto* executable = function->jsExecutable();
    if (!executable)
        return JSValue::encode(jsBoolean(false));

    return JSValue::encode(
        jsBoolean(executable->isGenerator() || executable->isAsyncGenerator()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsGeneratorObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL

    return JSValue::encode(jsBoolean(cell->type() == JSGeneratorType || cell->type() == JSAsyncGeneratorType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsPromise,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSPromiseType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsMap, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSMapType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsSet, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSSetType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsMapIterator,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSMapIteratorType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsSetIterator,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSSetIteratorType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsWeakMap,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSWeakMapType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsWeakSet,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == JSWeakSetType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsArrayBuffer,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    auto* arrayBuffer = dynamicDowncast<JSArrayBuffer>(cell);
    if (!arrayBuffer)
        return JSValue::encode(jsBoolean(false));
    return JSValue::encode(jsBoolean(!arrayBuffer->isShared()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsDataView,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == DataViewType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsSharedArrayBuffer,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    auto* arrayBuffer = dynamicDowncast<JSArrayBuffer>(cell);
    if (!arrayBuffer)
        return JSValue::encode(jsBoolean(false));
    return JSValue::encode(jsBoolean(arrayBuffer->isShared()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsProxy, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == ProxyObjectType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsModuleNamespaceObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == ModuleNamespaceObjectType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsAnyArrayBuffer,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    auto* arrayBuffer = dynamicDowncast<JSArrayBuffer>(cell);
    return JSValue::encode(jsBoolean(arrayBuffer != nullptr));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBoxedPrimitive,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    switch (cell->type()) {
    case JSC::BooleanObjectType:
    case JSC::NumberObjectType:
    case JSC::StringObjectType:
    case JSC::DerivedStringObjectType:
        return JSValue::encode(jsBoolean(true));

    default:
        return JSValue::encode(jsBoolean(cell->inherits<JSC::SymbolObject>() || cell->inherits<JSC::BigIntObject>()));
    }
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsArrayBufferView,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(
        jsBoolean(cell->type() >= Int8ArrayType && cell->type() <= DataViewType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsTypedArray,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() >= Int8ArrayType && cell->type() <= BigUint64ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUint8Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Uint8ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUint8ClampedArray,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Uint8ClampedArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUint16Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Uint16ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsUint32Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Uint32ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsInt8Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Int8ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsInt16Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Int16ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsInt32Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Int32ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsFloat16Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Float16ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsFloat32Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Float32ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsFloat64Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == Float64ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBigInt64Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == BigInt64ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsBigUint64Array,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->type() == BigUint64ArrayType));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsKeyObject,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->inherits<Bun::JSKeyObject>()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsCryptoKey,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->inherits<WebCore::JSCryptoKey>()));
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsEventTarget,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->inherits<WebCore::JSEventTarget>()));
}

namespace Zig {

// Hardcoded module "node:util/types"
DEFINE_NATIVE_MODULE_NOINLINE(NodeUtilTypes)
{
    INIT_NATIVE_MODULE(NodeUtilTypes, 44);

    putNativeFn(Identifier::fromString(vm, "isExternal"_s), jsFunctionIsExternal);
    putNativeFn(Identifier::fromString(vm, "isDate"_s), jsFunctionIsDate);
    putNativeFn(Identifier::fromString(vm, "isArgumentsObject"_s), jsFunctionIsArgumentsObject);
    putNativeFn(Identifier::fromString(vm, "isBigIntObject"_s), jsFunctionIsBigIntObject);
    putNativeFn(Identifier::fromString(vm, "isBooleanObject"_s), jsFunctionIsBooleanObject);
    putNativeFn(Identifier::fromString(vm, "isNumberObject"_s), jsFunctionIsNumberObject);
    putNativeFn(Identifier::fromString(vm, "isStringObject"_s), jsFunctionIsStringObject);
    putNativeFn(Identifier::fromString(vm, "isSymbolObject"_s), jsFunctionIsSymbolObject);
    putNativeFn(Identifier::fromString(vm, "isNativeError"_s), jsFunctionIsNativeError);
    putNativeFn(Identifier::fromString(vm, "isRegExp"_s), jsFunctionIsRegExp);
    putNativeFn(Identifier::fromString(vm, "isAsyncFunction"_s), jsFunctionIsAsyncFunction);
    putNativeFn(Identifier::fromString(vm, "isGeneratorFunction"_s), jsFunctionIsGeneratorFunction);
    putNativeFn(Identifier::fromString(vm, "isGeneratorObject"_s), jsFunctionIsGeneratorObject);
    putNativeFn(Identifier::fromString(vm, "isPromise"_s), jsFunctionIsPromise);
    putNativeFn(Identifier::fromString(vm, "isMap"_s), jsFunctionIsMap);
    putNativeFn(Identifier::fromString(vm, "isSet"_s), jsFunctionIsSet);
    putNativeFn(Identifier::fromString(vm, "isMapIterator"_s), jsFunctionIsMapIterator);
    putNativeFn(Identifier::fromString(vm, "isSetIterator"_s), jsFunctionIsSetIterator);
    putNativeFn(Identifier::fromString(vm, "isWeakMap"_s), jsFunctionIsWeakMap);
    putNativeFn(Identifier::fromString(vm, "isWeakSet"_s), jsFunctionIsWeakSet);
    putNativeFn(Identifier::fromString(vm, "isArrayBuffer"_s), jsFunctionIsArrayBuffer);
    putNativeFn(Identifier::fromString(vm, "isDataView"_s), jsFunctionIsDataView);
    putNativeFn(Identifier::fromString(vm, "isSharedArrayBuffer"_s), jsFunctionIsSharedArrayBuffer);
    putNativeFn(Identifier::fromString(vm, "isProxy"_s), jsFunctionIsProxy);
    putNativeFn(Identifier::fromString(vm, "isModuleNamespaceObject"_s), jsFunctionIsModuleNamespaceObject);
    putNativeFn(Identifier::fromString(vm, "isAnyArrayBuffer"_s), jsFunctionIsAnyArrayBuffer);
    putNativeFn(Identifier::fromString(vm, "isBoxedPrimitive"_s), jsFunctionIsBoxedPrimitive);
    putNativeFn(Identifier::fromString(vm, "isArrayBufferView"_s), jsFunctionIsArrayBufferView);
    putNativeFn(Identifier::fromString(vm, "isTypedArray"_s), jsFunctionIsTypedArray);
    putNativeFn(Identifier::fromString(vm, "isUint8Array"_s), jsFunctionIsUint8Array);
    putNativeFn(Identifier::fromString(vm, "isUint8ClampedArray"_s), jsFunctionIsUint8ClampedArray);
    putNativeFn(Identifier::fromString(vm, "isUint16Array"_s), jsFunctionIsUint16Array);
    putNativeFn(Identifier::fromString(vm, "isUint32Array"_s), jsFunctionIsUint32Array);
    putNativeFn(Identifier::fromString(vm, "isInt8Array"_s), jsFunctionIsInt8Array);
    putNativeFn(Identifier::fromString(vm, "isInt16Array"_s), jsFunctionIsInt16Array);
    putNativeFn(Identifier::fromString(vm, "isInt32Array"_s), jsFunctionIsInt32Array);
    putNativeFn(Identifier::fromString(vm, "isFloat16Array"_s), jsFunctionIsFloat16Array);
    putNativeFn(Identifier::fromString(vm, "isFloat32Array"_s), jsFunctionIsFloat32Array);
    putNativeFn(Identifier::fromString(vm, "isFloat64Array"_s), jsFunctionIsFloat64Array);
    putNativeFn(Identifier::fromString(vm, "isBigInt64Array"_s), jsFunctionIsBigInt64Array);
    putNativeFn(Identifier::fromString(vm, "isBigUint64Array"_s), jsFunctionIsBigUint64Array);
    putNativeFn(Identifier::fromString(vm, "isKeyObject"_s), jsFunctionIsKeyObject);
    putNativeFn(Identifier::fromString(vm, "isCryptoKey"_s), jsFunctionIsCryptoKey);
    putNativeFn(Identifier::fromString(vm, "isEventTarget"_s), jsFunctionIsEventTarget);

    RETURN_NATIVE_MODULE();
}

} // namespace Zig
