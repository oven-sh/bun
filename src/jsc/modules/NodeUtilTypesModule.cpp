#include "BunClientData.h"
#include "JSDOMURL.h"
#include "JSDOMWrapper.h"
#include "node/crypto/JSKeyObject.h"
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/JSSetIterator.h>
#include <JavaScriptCore/ObjectPrototype.h>
#include <cmath>
#include "JSEventTarget.h"
#include "JavaScriptCore/TopExceptionScope.h"
#include "_NativeModule.h"

#include "napi_external.h"
#include "webcrypto/JSCryptoKey.h"
#include "webcrypto/JSJsonWebKey.h"
#include <JavaScriptCore/AggregateError.h>
#include <JavaScriptCore/AsyncFunctionPrototype.h>
#include <JavaScriptCore/BigIntObject.h>
#include <JavaScriptCore/CallFrame.h>
#include <JavaScriptCore/CallFrameInlines.h>
#include <JavaScriptCore/ErrorPrototype.h>
#include <JavaScriptCore/GeneratorFunctionPrototype.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SymbolObject.h>
#include "ZigGeneratedClasses.h"
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
// Brand check for WHATWG URL instances backed by the wrapper class —
// immune to prototype/Symbol.hasInstance tampering (assert internals).
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsURL,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    GET_FIRST_CELL
    return JSValue::encode(jsBoolean(cell->inherits<WebCore::JSDOMURL>()));
}

// assert.partialDeepStrictEqual typed-array/ArrayBuffer branch: expected's
// elements must appear in actual's elements in order, allowing gaps (node's
// kPartial mode). Element equality follows Object.is at storage width — all
// NaNs equal, +0 and -0 distinct. The JS caller has already matched the two
// values' tags, so both sides are the same kind.
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

JSC_DEFINE_HOST_FUNCTION(jsFunctionPartialTypedArrayEquiv,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    bool result = partialBufferContentsEquiv(globalObject, scope, callframe->argument(0), callframe->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(result));
}

extern "C" bool JSC__JSValue__strictDeepEquals(JSC::EncodedJSValue, JSC::EncodedJSValue, JSC::JSGlobalObject*);

// ============================================================================
// assert.partialDeepStrictEqual (node's kPartial mode), fully native.
//
// `expected` must be recursively contained in `actual`: objects match on
// expected's own enumerable properties only, arrays and buffer contents as
// ordered-with-gaps subsequences, Maps/Sets as subsets, Errors leniently on
// name/message/errors/cause. Cycles are accepted only when both sides revisit
// simultaneously. Ported from the previous JS implementation in
// src/js/node/assert.ts, which was verified case-by-case against node
// v26.3.0; the vendored upstream suite pins the behavior.
// ============================================================================

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
    for (size_t i = 0; i < names.size(); i++) {
        bool equal = ownEnumerableThenCompare(globalObject, gcBuffer, cycles, scope, actualObject, expectedObject, names[i]);
        RETURN_IF_EXCEPTION(scope, false);
        if (!equal)
            return false;
    }
    return true;
}

// A string key that is a canonical array index (0 <= i < 2**32 - 1).
static bool isIndexKey(JSC::JSGlobalObject* globalObject, const JSC::Identifier& identifier)
{
    if (identifier.isSymbol())
        return false;
    return JSC::parseIndex(const_cast<JSC::Identifier&>(identifier)).has_value();
}

// Expected's own enumerable non-index string and symbol properties only —
// index keys are covered by the subsequence/contents comparison of the
// caller (arrays and typed arrays), and enforcing them positionally here
// would break the ordered-with-gaps semantics.
static bool nonIndexObjectSubset(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSValue actual, JSValue expected)
{
    auto& vm = globalObject->vm();
    JSC::JSObject* actualObject = actual.getObject();
    JSC::JSObject* expectedObject = expected.getObject();
    JSC::PropertyNameArrayBuilder names(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
    expectedObject->methodTable()->getOwnPropertyNames(expectedObject, globalObject, names, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, false);
    for (size_t i = 0; i < names.size(); i++) {
        if (isIndexKey(globalObject, names[i]))
            continue;
        if (!names[i].isSymbol() && names[i] == vm.propertyNames->length)
            continue;
        bool equal = ownEnumerableThenCompare(globalObject, gcBuffer, cycles, scope, actualObject, expectedObject, names[i]);
        RETURN_IF_EXCEPTION(scope, false);
        if (!equal)
            return false;
    }
    return true;
}

// Expected's elements as a subsequence of actual's, in order with gaps, then
// expected's own enumerable non-index properties.
static bool arraySubsequence(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, CycleState& cycles, JSC::ThrowScope& scope, JSValue actual, JSValue expected)
{
    JSC::JSObject* actualObject = actual.getObject();
    JSC::JSObject* expectedObject = expected.getObject();
    const uint64_t actualLength = static_cast<uint64_t>(JSC::toLength(globalObject, actualObject));
    RETURN_IF_EXCEPTION(scope, false);
    const uint64_t expectedLength = static_cast<uint64_t>(JSC::toLength(globalObject, expectedObject));
    RETURN_IF_EXCEPTION(scope, false);
    if (expectedLength > actualLength)
        return false;

    uint64_t actualPos = 0;
    for (uint64_t i = 0; i < expectedLength; i++) {
        const uint64_t lastCandidate = actualLength - expectedLength + i;
        JSValue expectedElement = expectedObject->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, false);
        bool matched = false;
        while (actualPos <= lastCandidate) {
            JSValue actualElement = actualObject->getIndex(globalObject, actualPos);
            RETURN_IF_EXCEPTION(scope, false);
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

    return nonIndexObjectSubset(globalObject, gcBuffer, cycles, scope, actual, expected);
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
        RETURN_IF_EXCEPTION(scope, false);
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
            if (JSC::sameValue(globalObject, usedIdentityKeys.at(i), key))
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
                    if (JSC::sameValueZero(globalObject, gcBuffer.at(entriesStart + i * 2), expectedKey)) {
                        identityIndex = i;
                        break;
                    }
                }
                RETURN_IF_EXCEPTION(scope, false);
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
        if (usedIndices.size() < entryCount)
            usedIndices.fill(false, entryCount);
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

// Expected's items as a subset of actual's; item equality is full strict
// deep equality (Bun.deepEquals strict), like the JS implementation.
static bool setSubset(JSC::JSGlobalObject* globalObject, JSC::MarkedArgumentBuffer& gcBuffer, JSC::ThrowScope& scope, JSValue actual, JSValue expected)
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
            bool equal = JSC__JSValue__strictDeepEquals(JSValue::encode(gcBuffer.at(itemsStart + i)), JSValue::encode(expectedItem), globalObject);
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

static bool isSpecialValue(JSValue value)
{
    // `typeof x !== "object"`: primitives, null, and callables are decided
    // by full strict deep equality, like the JS implementation's isSpecial.
    if (!value.isObject() || value.isCallable())
        return true;
    JSC::JSCell* cell = value.asCell();
    const JSC::JSType type = cell->type();
    return cell->inherits<JSC::ErrorInstance>() || type == JSC::ErrorInstanceType
        || type == JSC::RegExpObjectType || type == JSC::JSDateType;
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

    if (actualType == JSC::JSMapType && expectedType == JSC::JSMapType) {
        if (uncheckedDowncast<JSC::JSMap>(expected.asCell())->size() > uncheckedDowncast<JSC::JSMap>(actual.asCell())->size())
            return false;
        return withCycleGuard(globalObject, gcBuffer, cycles, scope, actual, expected, mapSubset);
    }

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

    const bool actualIsBuffer = actualType == JSC::ArrayBufferType;
    const bool expectedIsBuffer = expectedType == JSC::ArrayBufferType;
    if (actualIsBuffer || expectedIsBuffer) {
        if (actualIsBuffer != expectedIsBuffer)
            return false;
        JSC::JSString* actualTag = JSC::objectPrototypeToString(globalObject, actual);
        RETURN_IF_EXCEPTION(scope, false);
        JSC::JSString* expectedTag = JSC::objectPrototypeToString(globalObject, expected);
        RETURN_IF_EXCEPTION(scope, false);
        bool tagsEqual = actualTag->equal(globalObject, expectedTag);
        RETURN_IF_EXCEPTION(scope, false);
        if (!tagsEqual)
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
        return result.toBoolean(globalObject);
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
        return setSubset(globalObject, gcBuffer, scope, actual, expected);
    }

    bool actualIsArray = JSC::isArray(globalObject, actual);
    RETURN_IF_EXCEPTION(scope, false);
    bool expectedIsArray = JSC::isArray(globalObject, expected);
    RETURN_IF_EXCEPTION(scope, false);
    if (actualIsArray != expectedIsArray)
        return false;
    if (actualIsArray)
        return withCycleGuard(globalObject, gcBuffer, cycles, scope, actual, expected, arraySubsequence);

    // At least one side is a primitive, null, Error, RegExp, or Date: full
    // strict deep equality decides.
    if (isSpecialValue(actual) || isSpecialValue(expected)) {
        bool equal = JSC__JSValue__strictDeepEquals(JSValue::encode(actual), JSValue::encode(expected), globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        return equal;
    }

    // Objects with different type tags are never partially equal.
    JSC::JSString* actualTag = JSC::objectPrototypeToString(globalObject, actual);
    RETURN_IF_EXCEPTION(scope, false);
    JSC::JSString* expectedTag = JSC::objectPrototypeToString(globalObject, expected);
    RETURN_IF_EXCEPTION(scope, false);
    bool tagsEqual = actualTag->equal(globalObject, expectedTag);
    RETURN_IF_EXCEPTION(scope, false);
    if (!tagsEqual)
        return false;

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

// util.isDeepStrictEqual / assert.deepStrictEqual: node semantics, including
// the [[Prototype]] identity check that Bun.deepEquals(a, b, true) omits.
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsDeepStrictEqual,
    (JSC::JSGlobalObject * globalObject,
        JSC::CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    bool result = Bun__deepEqualsNodeStrict(JSValue::encode(callframe->argument(0)), JSValue::encode(callframe->argument(1)), globalObject);
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
        if (has) {
            if (slot.isValue()) {
                JSValue value = slot.getValue(globalObject, vm.propertyNames->toStringTagSymbol);
                if (value.isString()) {
                    String tag = asString(value)->value(globalObject);
                    CLEAR_IF_EXCEPTION(scope);
                    if (tag == "Error"_s)
                        return JSValue::encode(jsBoolean(true));
                }
            }
        }

        JSValue proto = object->getPrototype(globalObject);
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
        if (cell->inherits<WebCore::JSResolveMessage>() || cell->inherits<WebCore::JSBuildMessage>())
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
    return JSValue::encode(jsBoolean(cell->type() == GlobalProxyType || cell->type() == ProxyObjectType));
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
    INIT_NATIVE_MODULE(44);

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
