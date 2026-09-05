/**
 * Source code for JavaScriptCore bindings used by bind.
 *
 * This file is processed by cppbind.ts.
 *
 * @see cppbind.ts holds helpful tips on how to add and implement new bindings.
 *      Note that cppbind.ts also automatically runs some error-checking which
 *      can be disabled if necessary. Consult cppbind.ts for details.
 */
#include "root.h"

#include "JavaScriptCore/ErrorType.h"
#include "JavaScriptCore/TopExceptionScope.h"
#include "JavaScriptCore/Exception.h"
#include "ErrorCode+List.h"
#include "ErrorCode.h"
#include "JavaScriptCore/ThrowScope.h"

#include "JavaScriptCore/JSCast.h"
#include "JavaScriptCore/JSType.h"
#include "JavaScriptCore/NumberObject.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSPromiseConstructor.h"
#include "JavaScriptCore/DeleteAllCodeEffort.h"
#include "JavaScriptCore/BooleanObject.h"
#include "JSFFIFunction.h"
#include "headers.h"

#include "BunClientData.h"
#include "GCDefferalContext.h"
#include "WebCoreJSBuiltins.h"

#include "JavaScriptCore/AggregateError.h"
#include "JavaScriptCore/ArrayBufferView.h"
#include "JavaScriptCore/ArrayStorage.h"
#include "JavaScriptCore/SparseArrayValueMap.h"
#include "JavaScriptCore/BytecodeIndex.h"
#include "JavaScriptCore/CodeBlock.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/ErrorInstance.h"
#include "JavaScriptCore/ExceptionHelpers.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/FunctionConstructor.h"
#include "JavaScriptCore/HeapSnapshotBuilder.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/IteratorOperations.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/JSArrayBuffer.h"
#include "JavaScriptCore/JSDataView.h"
#include "JavaScriptCore/JSArrayInlines.h"
#include "JavaScriptCore/JSGlobalObjectInlines.h"
#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/ErrorInstanceInlines.h"
#include "JavaScriptCore/BigIntObject.h"
#include "JavaScriptCore/SymbolObject.h"
#include "JavaScriptCore/JSOrderedHashTableHelper.h"

#include "JavaScriptCore/JSCallbackObject.h"
#include "JavaScriptCore/JSClassRef.h"
#include "JavaScriptCore/JSPromise.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSMapIterator.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSNativeStdFunction.h"
#include "JavaScriptCore/JSONObject.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSSet.h"
#include "JavaScriptCore/Strong.h"
#include "JavaScriptCore/JSSetIterator.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/ProxyObject.h"
#include "JavaScriptCore/Microtask.h"
#include "JavaScriptCore/MicrotaskQueue.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include "JavaScriptCore/BigIntConstructor.h"
#include "JavaScriptCore/MathCommon.h"
#include "JavaScriptCore/BooleanConstructor.h"
#include "JavaScriptCore/DateConstructor.h"
#include "JavaScriptCore/ErrorConstructor.h"
#include "JavaScriptCore/JSArrayBufferConstructor.h"
#include "JavaScriptCore/JSTypedArrayConstructors.h"
#include "JavaScriptCore/MapConstructor.h"
#include "JavaScriptCore/NumberConstructor.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ObjectPrototypeInlines.h"
#include "JavaScriptCore/RegExpConstructor.h"
#include "JavaScriptCore/SetConstructor.h"
#include "JavaScriptCore/StringConstructor.h"
#include "JavaScriptCore/SymbolConstructor.h"
#include "JavaScriptCore/WeakMapConstructor.h"
#include "JavaScriptCore/WeakSetConstructor.h"
#include "JSBuffer.h"
#include "JavaScriptCore/ParserError.h"
#include "JavaScriptCore/ScriptExecutable.h"
#include "JavaScriptCore/StackFrame.h"
#include "JavaScriptCore/StackVisitor.h"
#include "JavaScriptCore/VM.h"
#include "JavaScriptCore/WasmFaultSignalHandler.h"
#include "ZigGlobalObject.h"
#include "helpers.h"
#include "JavaScriptCore/JSObjectInlines.h"

#include "wtf/Assertions.h"
#include "wtf/Compiler.h"
#include "wtf/StackCheck.h"
#include "wtf/text/ExternalStringImpl.h"
#include "wtf/text/OrdinalNumber.h"
#include "wtf/text/StringCommon.h"
#include "wtf/text/StringImpl.h"
#include "wtf/text/StringView.h"
#include "wtf/text/WTFString.h"
#include "wtf/GregorianDateTime.h"
#include "JavaScriptCore/IntlObject.h"
#include "JavaScriptCore/ISO8601.h"
#include "JavaScriptCore/JSCTimeZone.h"
#include "JavaScriptCore/InstantCore.h"
#include "JavaScriptCore/TemporalCoreTypes.h"
#include "JavaScriptCore/TemporalDuration.h"
#include "JavaScriptCore/TemporalEnums.h"
#include "JavaScriptCore/TemporalInstant.h"
#include "JavaScriptCore/TemporalPlainDate.h"
#include "JavaScriptCore/TemporalPlainDateTime.h"
#include "JavaScriptCore/TemporalPlainMonthDay.h"
#include "JavaScriptCore/TemporalPlainTime.h"
#include "JavaScriptCore/TemporalPlainYearMonth.h"
#include "JavaScriptCore/TemporalZonedDateTime.h"
#include "JavaScriptCore/TemporalObject.h"
#include "JavaScriptCore/TimeZoneICUBridge.h"

#include "JavaScriptCore/FunctionPrototype.h"
#include "JSFetchHeaders.h"
#include "FetchHeaders.h"
#include "DOMURL.h"
#include "JSDOMURL.h"

#include <string_view>
#include <bun-uws/src/App.h>
#include <bun-uws/src/Http3Request.h>
#include <bun-usockets/src/internal/internal.h>
#include "IDLTypes.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructor.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertBoolean.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertNullable.h"
#include "JSDOMConvertRecord.h"
#include "JSDOMConvertSequences.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMConvertUnion.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMIterator.h"
#include "JSDOMOperation.h"
#include "JSDOMWrapperCache.h"

#include "wtf/text/AtomString.h"
#include "wtf/Scope.h"
#include "HTTPHeaderNames.h"
#include "JSDOMPromiseDeferred.h"
#include "JavaScriptCore/TestRunnerUtils.h"
#include "JavaScriptCore/DateInstance.h"
#include "JavaScriptCore/RegExpObject.h"
#include "JavaScriptCore/PropertyNameArray.h"
#include "webcore/JSAbortSignal.h"
#include "JSAbortAlgorithm.h"

#include "DOMFormData.h"
#include "JSDOMFormData.h"
#include "ZigGeneratedClasses.h"
#include "JavaScriptCore/JSMapInlines.h"

#include <JavaScriptCore/JSWeakMap.h>
#include "JSURLSearchParams.h"

#include "AsyncContextFrame.h"
#include "JavaScriptCore/InternalFieldTuple.h"
#include "JavaScriptCore/JSAsyncFunctionGenerator.h"
#include "JavaScriptCore/JSGenerator.h"
#include "JavaScriptCore/JSPromiseReaction.h"
#include "JavaScriptCore/FunctionExecutable.h"
#include "JavaScriptCore/FunctionCodeBlock.h"
#include "wtf/text/StringToIntegerConversion.h"

#include "JavaScriptCore/GetterSetter.h"
#include "JavaScriptCore/CustomGetterSetter.h"

#include "ErrorStackFrame.h"
#include "AsyncStackTrace.h"
#include "ErrorStackTrace.h"
#include "ObjectBindings.h"

#include <JavaScriptCore/VMInlines.h>
#include "wtf-bindings.h"

#if ASSERT_ENABLED
#include <JavaScriptCore/IntegrityInlines.h>
#endif

extern "C" size_t Bun__Feature__heap_snapshot;

#if OS(DARWIN)
#if ASSERT_ENABLED
#if !__has_feature(address_sanitizer)
#include <malloc/malloc.h>
#define IS_MALLOC_DEBUGGING_ENABLED 1
#endif
#endif
#endif

using namespace JSC;

using namespace WebCore;

typedef uint8_t ExpectFlags;

// Note: keep this in sync with Flags in src/runtime/test_runner/expect.rs
// clang disable unused warning
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunused-variable"

static constexpr int FLAG_PROMISE_RESOLVES = (1 << 0);
static constexpr int FLAG_PROMISE_REJECTS = (1 << 1);
static constexpr int FLAG_NOT = (1 << 2);

#pragma clang diagnostic pop

extern "C" bool ExpectCustomAsymmetricMatcher__execute(void* self, JSC::EncodedJSValue thisValue, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue leftValue);

enum class AsymmetricMatcherResult : uint8_t {
    PASS,
    FAIL,
    NOT_MATCHER,
};

enum class AsymmetricMatcherConstructorType : int8_t {
    exception = -1,
    none = 0,
    Symbol = 1,
    String = 2,
    Object = 3,
    Array = 4,
    BigInt = 5,
    Boolean = 6,
    Number = 7,
    Promise = 8,
    InstanceOf = 9,
};

// Ensure we instantiate the true and false variants of this function
template bool Bun__deepMatch<true>(
    JSValue objValue,
    std::set<EncodedJSValue>* seenObjProperties,
    JSValue subsetValue,
    std::set<EncodedJSValue>* seenSubsetProperties,
    JSGlobalObject* globalObject,
    ThrowScope& throwScope,
    MarkedArgumentBuffer* gcBuffer,
    bool replacePropsWithAsymmetricMatchers,
    bool isMatchingObjectContaining);

template bool Bun__deepMatch<false>(
    JSValue objValue,
    std::set<EncodedJSValue>* seenObjProperties,
    JSValue subsetValue,
    std::set<EncodedJSValue>* seenSubsetProperties,
    JSGlobalObject* globalObject,
    ThrowScope& throwScope,
    MarkedArgumentBuffer* gcBuffer,
    bool replacePropsWithAsymmetricMatchers,
    bool isMatchingObjectContaining);

extern "C" bool Expect_readFlagsAndProcessPromise(JSC::EncodedJSValue instanceValue, JSC::JSGlobalObject* globalObject, ExpectFlags* flags, JSC::EncodedJSValue* value, AsymmetricMatcherConstructorType* constructorType);

extern "C" int8_t AsymmetricMatcherConstructorType__fromJS(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    JSValue value = JSValue::decode(encodedValue);
    if (value.isObject()) {
        JSObject* object = value.getObject();
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (globalObject->numberObjectConstructor() == object) {
            return static_cast<uint8_t>(AsymmetricMatcherConstructorType::Number);
        }

        if (globalObject->booleanObjectConstructor() == object) {
            return static_cast<uint8_t>(AsymmetricMatcherConstructorType::Boolean);
        }

        auto stringConstructorValue = globalObject->stringPrototype()->getIfPropertyExists(globalObject, vm.propertyNames->constructor);
        RETURN_IF_EXCEPTION(scope, -1);
        if (stringConstructorValue == object) {
            return static_cast<uint8_t>(AsymmetricMatcherConstructorType::String);
        }

        auto symbolConstructorValue = globalObject->symbolPrototype()->getIfPropertyExists(globalObject, vm.propertyNames->constructor);
        RETURN_IF_EXCEPTION(scope, -1);
        if (symbolConstructorValue == object) {
            return static_cast<uint8_t>(AsymmetricMatcherConstructorType::Symbol);
        }

        auto bigIntConstructorValue = globalObject->bigIntPrototype()->getIfPropertyExists(globalObject, vm.propertyNames->constructor);
        RETURN_IF_EXCEPTION(scope, -1);
        if (bigIntConstructorValue == object) {
            return static_cast<uint8_t>(AsymmetricMatcherConstructorType::BigInt);
        }

        JSObject* promiseConstructor = globalObject->promiseConstructor();

        if (promiseConstructor == object) {
            return static_cast<uint8_t>(AsymmetricMatcherConstructorType::Promise);
        }

        JSObject* array = globalObject->arrayConstructor();

        if (array == object) {
            return static_cast<uint8_t>(AsymmetricMatcherConstructorType::Array);
        }

        JSObject* obj = globalObject->objectConstructor();

        if (obj == object) {
            return static_cast<uint8_t>(AsymmetricMatcherConstructorType::Object);
        }

        return static_cast<uint8_t>(AsymmetricMatcherConstructorType::InstanceOf);
    }

    return static_cast<uint8_t>(AsymmetricMatcherConstructorType::none);
}

bool readFlagsAndProcessPromise(JSValue& instanceValue, ExpectFlags& flags, JSGlobalObject* globalObject, JSValue& value, AsymmetricMatcherConstructorType& constructorType)
{
    JSC::EncodedJSValue valueEncoded = JSValue::encode(value);
    if (Expect_readFlagsAndProcessPromise(JSValue::encode(instanceValue), globalObject, &flags, &valueEncoded, &constructorType)) {
        value = JSValue::decode(valueEncoded);
        return true;
    }
    return false;
}

AsymmetricMatcherResult matchAsymmetricMatcherAndGetFlags(JSGlobalObject* globalObject, JSValue matcherProp, JSValue otherProp, ThrowScope& throwScope, ExpectFlags& flags)
{
    JSCell* matcherPropCell = matcherProp.asCell();
    AsymmetricMatcherConstructorType constructorType = AsymmetricMatcherConstructorType::none;

    if (dynamicDowncast<JSExpectAnything>(matcherPropCell)) {
        if (!readFlagsAndProcessPromise(matcherProp, flags, globalObject, otherProp, constructorType))
            return AsymmetricMatcherResult::FAIL;

        if (otherProp.isUndefinedOrNull()) {
            return AsymmetricMatcherResult::FAIL;
        }

        return AsymmetricMatcherResult::PASS;
    } else if (auto* expectAny = dynamicDowncast<JSExpectAny>(matcherPropCell)) {
        if (!readFlagsAndProcessPromise(matcherProp, flags, globalObject, otherProp, constructorType))
            return AsymmetricMatcherResult::FAIL;

        JSValue constructorValue = expectAny->m_constructorValue.get();
        JSObject* constructorObject = constructorValue.getObject();

        switch (constructorType) {
        case AsymmetricMatcherConstructorType::Symbol: {
            if (otherProp.isSymbol()) {
                return AsymmetricMatcherResult::PASS;
            }
            break;
        }
        case AsymmetricMatcherConstructorType::String: {
            if (otherProp.isCell()) {
                JSCell* cell = otherProp.asCell();
                switch (cell->type()) {
                case JSC::StringType:
                case JSC::StringObjectType:
                case JSC::DerivedStringObjectType: {
                    return AsymmetricMatcherResult::PASS;
                }
                default: {
                    break;
                }
                }
            }
            break;
        }

        case AsymmetricMatcherConstructorType::BigInt: {
            if (otherProp.isBigInt()) {
                return AsymmetricMatcherResult::PASS;
            }
            break;
        }

        case AsymmetricMatcherConstructorType::Boolean: {
            if (otherProp.isBoolean()) {
                return AsymmetricMatcherResult::PASS;
            }

            if (dynamicDowncast<BooleanObject>(otherProp)) {
                return AsymmetricMatcherResult::PASS;
            }

            break;
        }

        case AsymmetricMatcherConstructorType::Number: {
            if (otherProp.isNumber()) {
                return AsymmetricMatcherResult::PASS;
            }

            if (dynamicDowncast<NumberObject>(otherProp)) {
                return AsymmetricMatcherResult::PASS;
            }

            break;
        }

        case AsymmetricMatcherConstructorType::Promise: {
            if (otherProp.isCell() && otherProp.asCell()->type() == JSPromiseType) {
                return AsymmetricMatcherResult::PASS;
            }
            break;
        }

        case AsymmetricMatcherConstructorType::Array: {
            bool otherIsArray = JSC::isArray(globalObject, otherProp);
            RETURN_IF_EXCEPTION(throwScope, AsymmetricMatcherResult::FAIL);
            if (otherIsArray) {
                return AsymmetricMatcherResult::PASS;
            }
            break;
        }

        case AsymmetricMatcherConstructorType::Object: {
            // Jest: `typeof other === 'object'` (null matches, functions do not; no instanceof fallback)
            if (otherProp.isNull() || (otherProp.isObject() && !otherProp.isCallable())) {
                return AsymmetricMatcherResult::PASS;
            }
            return AsymmetricMatcherResult::FAIL;
        }

        case AsymmetricMatcherConstructorType::InstanceOf: {
            break;
        }
        case AsymmetricMatcherConstructorType::exception:
        case AsymmetricMatcherConstructorType::none: {
            ASSERT_NOT_REACHED_WITH_MESSAGE("Invalid constructor type");
            break;
        }
        }

        bool hasInstance = constructorObject->hasInstance(globalObject, otherProp);
        RETURN_IF_EXCEPTION(throwScope, AsymmetricMatcherResult::FAIL);
        if (hasInstance) {
            return AsymmetricMatcherResult::PASS;
        }

        return AsymmetricMatcherResult::FAIL;
    } else if (auto* expectStringContaining = dynamicDowncast<JSExpectStringContaining>(matcherPropCell)) {
        if (!readFlagsAndProcessPromise(matcherProp, flags, globalObject, otherProp, constructorType))
            return AsymmetricMatcherResult::FAIL;

        JSValue expectedSubstring = expectStringContaining->m_stringValue.get();

        if (otherProp.isString()) {
            String otherString = otherProp.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(throwScope, AsymmetricMatcherResult::FAIL);

            String substring = expectedSubstring.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(throwScope, AsymmetricMatcherResult::FAIL);

            if (otherString.find(substring) != WTF::notFound) {
                return AsymmetricMatcherResult::PASS;
            }
        }

        return AsymmetricMatcherResult::FAIL;
    } else if (auto* expectStringMatching = dynamicDowncast<JSExpectStringMatching>(matcherPropCell)) {
        if (!readFlagsAndProcessPromise(matcherProp, flags, globalObject, otherProp, constructorType))
            return AsymmetricMatcherResult::FAIL;

        JSValue expectedTestValue = expectStringMatching->m_testValue.get();

        if (otherProp.isString()) {
            if (expectedTestValue.isString()) {
                String otherString = otherProp.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(throwScope, AsymmetricMatcherResult::FAIL);

                String substring = expectedTestValue.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(throwScope, AsymmetricMatcherResult::FAIL);

                if (otherString.find(substring) != WTF::notFound) {
                    return AsymmetricMatcherResult::PASS;
                }
            } else if (auto* regex = dynamicDowncast<RegExpObject>(expectedTestValue)) {
                JSString* otherString = otherProp.toString(globalObject);
                RETURN_IF_EXCEPTION(throwScope, AsymmetricMatcherResult::FAIL);
                bool matched = !!regex->match(globalObject, otherString);
                RETURN_IF_EXCEPTION(throwScope, AsymmetricMatcherResult::FAIL);
                if (matched) {
                    return AsymmetricMatcherResult::PASS;
                }
            }
        }

        return AsymmetricMatcherResult::FAIL;
    } else if (auto* expectArrayContaining = dynamicDowncast<JSExpectArrayContaining>(matcherPropCell)) {
        if (!readFlagsAndProcessPromise(matcherProp, flags, globalObject, otherProp, constructorType))
            return AsymmetricMatcherResult::FAIL;

        JSValue expectedArrayValue = expectArrayContaining->m_arrayValue.get();

        // Note: isArray() accepts Proxy->Array, but jsDynamicCast returns null for Proxy.
        JSArray* expectedArray = dynamicDowncast<JSArray>(expectedArrayValue);
        JSArray* otherArray = dynamicDowncast<JSArray>(otherProp);
        if (expectedArray && otherArray) {
            unsigned expectedLength = expectedArray->length();
            unsigned otherLength = otherArray->length();

            // A empty array is all array's subset
            if (expectedLength == 0) {
                return AsymmetricMatcherResult::PASS;
            }

            // O(m*n) but works for now
            for (unsigned m = 0; m < expectedLength; m++) {
                JSValue expectedValue = expectedArray->getIndex(globalObject, m);
                RETURN_IF_EXCEPTION(throwScope, AsymmetricMatcherResult::FAIL);
                bool found = false;

                for (unsigned n = 0; n < otherLength; n++) {
                    JSValue otherValue = otherArray->getIndex(globalObject, n);
                    RETURN_IF_EXCEPTION(throwScope, AsymmetricMatcherResult::FAIL);
                    Vector<std::pair<JSValue, JSValue>, 16> stack;
                    MarkedArgumentBuffer gcBuffer;
                    bool foundNow = Bun__deepEquals<false, true, false>(globalObject, expectedValue, otherValue, gcBuffer, stack, throwScope, true);
                    RETURN_IF_EXCEPTION(throwScope, AsymmetricMatcherResult::FAIL);
                    if (foundNow) {
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    return AsymmetricMatcherResult::FAIL;
                }
            }

            return AsymmetricMatcherResult::PASS;
        }

        return AsymmetricMatcherResult::FAIL;
    } else if (auto* expectObjectContaining = dynamicDowncast<JSExpectObjectContaining>(matcherPropCell)) {
        if (!readFlagsAndProcessPromise(matcherProp, flags, globalObject, otherProp, constructorType))
            return AsymmetricMatcherResult::FAIL;

        JSValue patternObject = expectObjectContaining->m_objectValue.get();
        if (patternObject.isObject()) {
            if (otherProp.isObject()) {
                // SAFETY: visited property sets are not required when
                // `enableAsymmetricMatchers` and `isMatchingObjectContaining`
                // are both true
                bool match = Bun__deepMatch<true>(otherProp, nullptr, patternObject, nullptr, globalObject, throwScope, nullptr, false, true);
                RETURN_IF_EXCEPTION(throwScope, AsymmetricMatcherResult::FAIL);
                if (match) {
                    return AsymmetricMatcherResult::PASS;
                }
            }
        }

        return AsymmetricMatcherResult::FAIL;
    } else if (auto* expectCloseTo = dynamicDowncast<JSExpectCloseTo>(matcherPropCell)) {
        if (!readFlagsAndProcessPromise(matcherProp, flags, globalObject, otherProp, constructorType))
            return AsymmetricMatcherResult::FAIL;

        if (!otherProp.isNumber()) {
            // disable the "not" flag here, because if not a number it should still return FAIL when negated
            flags = flags & ~FLAG_NOT;
            return AsymmetricMatcherResult::FAIL;
        }

        JSValue expectedValue = expectCloseTo->m_numberValue.get();
        JSValue digitsValue = expectCloseTo->m_digitsValue.get();

        // expect.closeTo() validated both as numbers when it was constructed.
        double received = otherProp.asNumber();
        double expected = expectedValue.asNumber();

        constexpr double infinity = std::numeric_limits<double>::infinity();

        // special handing because (Infinity - Infinity) or (-Infinity - -Infinity) is NaN
        if ((received == infinity && expected == infinity) || (received == -infinity && expected == -infinity)) {
            return AsymmetricMatcherResult::PASS;
        } else {
            int32_t digits = digitsValue.toInt32(globalObject);
            RETURN_IF_EXCEPTION(throwScope, AsymmetricMatcherResult::FAIL);

            double threshold = 0.5 * std::pow(10.0, -digits);
            bool isClose = std::abs(expected - received) < threshold;
            return isClose ? AsymmetricMatcherResult::PASS : AsymmetricMatcherResult::FAIL;
        }
    } else if (auto* customMatcher = dynamicDowncast<JSExpectCustomAsymmetricMatcher>(matcherPropCell)) {
        if (!readFlagsAndProcessPromise(matcherProp, flags, globalObject, otherProp, constructorType))
            return AsymmetricMatcherResult::FAIL;

        // ignore the "not" flag here, because the custom matchers handle it themselves (accessing this.isNot)
        // and it would result in a double negation
        flags = flags & ~FLAG_NOT;

        bool passed = ExpectCustomAsymmetricMatcher__execute(customMatcher->wrapped(), JSValue::encode(matcherProp), globalObject, JSValue::encode(otherProp));
        return passed ? AsymmetricMatcherResult::PASS : AsymmetricMatcherResult::FAIL;
    }

    return AsymmetricMatcherResult::NOT_MATCHER;
}

AsymmetricMatcherResult matchAsymmetricMatcher(JSGlobalObject* globalObject, JSValue matcherProp, JSValue otherProp, ThrowScope& throwScope)
{
    ExpectFlags flags = ExpectFlags();
    AsymmetricMatcherResult result = matchAsymmetricMatcherAndGetFlags(globalObject, matcherProp, otherProp, throwScope, flags);
    if (result != AsymmetricMatcherResult::NOT_MATCHER && (flags & FLAG_NOT)) {
        result = (result == AsymmetricMatcherResult::PASS) ? AsymmetricMatcherResult::FAIL : AsymmetricMatcherResult::PASS;
    }
    return result;
}

template<typename PromiseType, bool isInternal>
static void handlePromise(PromiseType* promise, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue ctx, Zig::FFIFunction resolverFunction, Zig::FFIFunction rejecterFunction)
{

    auto globalThis = static_cast<Zig::GlobalObject*>(globalObject);

    if constexpr (!isInternal) {
        JSFunction* performPromiseThenFunction = globalObject->performPromiseThenFunction();
        auto callData = JSC::getCallData(performPromiseThenFunction);
        ASSERT(callData.type != CallData::Type::None);

        MarkedArgumentBuffer arguments;
        arguments.append(promise);
        arguments.append(globalThis->thenable(resolverFunction));
        arguments.append(globalThis->thenable(rejecterFunction));
        arguments.append(jsUndefined());
        arguments.append(JSValue::decode(ctx));
        ASSERT(!arguments.hasOverflowed());
        // async context tracking is handled by performPromiseThenFunction internally.
        JSC::profiledCall(globalThis, JSC::ProfilingReason::Microtask, performPromiseThenFunction, callData, jsUndefined(), arguments);
    } else {
        promise->then(globalThis, resolverFunction, rejecterFunction);
    }
}

static bool canPerformFastPropertyEnumerationForIterationBun(Structure* s)
{
    if (s->hasNonReifiedStaticProperties()) {
        return false;
    }
    if (s->typeInfo().overridesGetOwnPropertySlot())
        return false;
    if (s->typeInfo().overridesAnyFormOfGetOwnPropertyNames())
        return false;
    // FIXME: Indexed properties can be handled.
    // https://bugs.webkit.org/show_bug.cgi?id=185358
    if (hasIndexedProperties(s->indexingType()))
        return false;
    if (s->hasAnyKindOfGetterSetterProperties())
        return false;
    if (s->isUncacheableDictionary())
        return false;
    // Cannot perform fast [[Put]] to |target| if the property names of the |source| contain "__proto__".
    if (s->hasUnderscoreProtoPropertyExcludingOriginalProto())
        return false;
    return true;
}

JSValue getIndexWithoutAccessors(JSGlobalObject* globalObject, JSObject* obj, uint64_t i)
{
    if (obj->canGetIndexQuickly(i)) {
        return obj->tryGetIndexQuickly(i);
    }

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PropertySlot slot(obj, PropertySlot::InternalMethodType::Get);
    bool hasSlot = obj->methodTable()->getOwnPropertySlotByIndex(obj, globalObject, i, slot);
    RETURN_IF_EXCEPTION(scope, {});
    if (hasSlot) {
        if (!slot.isAccessor()) {
            RELEASE_AND_RETURN(scope, slot.getValue(globalObject, i));
        }
    }

    return JSValue();
}

template<bool isStrict, bool enableAsymmetricMatchers, bool checkPrototypes, bool skipPrototypeIdentity = false>
std::optional<bool> specialObjectsDequal(JSC::JSGlobalObject* globalObject, MarkedArgumentBuffer& gcBuffer, Vector<std::pair<JSC::JSValue, JSC::JSValue>, 16>& stack, ThrowScope& scope, JSCell* _Nonnull c1, JSCell* _Nonnull c2);

template<typename T>
static bool looseFloatContentsEqual(std::span<const T> a, std::span<const T> b)
{
    for (size_t i = 0; i < a.size(); i++) {
        if (a[i] != b[i])
            return false;
    }
    return true;
}

// Typed array elements and boxed string characters are synthesized by
// getOwnPropertySlot instead of being stored in the structure, so a structure with
// no named properties means nothing is left to compare once the contents match.
// Checking this keeps those comparisons off the index-enumerating slow path.
// Indexed storage counts too: an out-of-range index (`new String("ab")[5] = "x"`)
// is an own property node compares but the contents check would miss.
static ALWAYS_INLINE bool hasExtraOwnProperties(JSC::Structure* structure)
{
    return structure->outOfLineSize() != 0 || structure->inlineSize() != 0
        || hasIndexedProperties(structure->indexingType());
}

// node compares the non-index own properties of typed arrays as well;
// only the node entry point (checkPrototypes) pays for this.
template<bool isStrict, bool enableAsymmetricMatchers, bool checkPrototypes, bool skipPrototypeIdentity = false>
static bool nonIndexOwnPropertiesEqual(JSC::JSGlobalObject* globalObject, MarkedArgumentBuffer& gcBuffer, Vector<std::pair<JSC::JSValue, JSC::JSValue>, 16>& stack, ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2)
{
    VM& vm = globalObject->vm();
    JSC::PropertyNameArrayBuilder a1(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    JSC::PropertyNameArrayBuilder a2(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    o1->getOwnNonIndexPropertyNames(globalObject, a1, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, false);
    o2->getOwnNonIndexPropertyNames(globalObject, a2, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, false);

    if (a1.size() != a2.size()) {
        return false;
    }
    // Own-property-scoped reads: a plain get() would walk the prototype chain and let an inherited
    // key satisfy an own one. GetOwnProperty enforces name-for-name ownership in one lookup;
    // DontEnum is rejected since the name lists exclude non-enumerable properties.
    for (size_t i = 0; i < a1.size(); i++) {
        JSC::PropertyName propertyName(a1[i]);
        PropertySlot slot2(o2, PropertySlot::InternalMethodType::GetOwnProperty);
        bool o2Owns = o2->methodTable()->getOwnPropertySlot(o2, globalObject, propertyName, slot2);
        RETURN_IF_EXCEPTION(scope, false);
        if (!o2Owns || (slot2.attributes() & PropertyAttribute::DontEnum)) {
            return false;
        }
        JSValue v2 = slot2.getValue(globalObject, propertyName);
        RETURN_IF_EXCEPTION(scope, false);
        PropertySlot slot1(o1, PropertySlot::InternalMethodType::GetOwnProperty);
        bool o1Owns = o1->methodTable()->getOwnPropertySlot(o1, globalObject, propertyName, slot1);
        RETURN_IF_EXCEPTION(scope, false);
        if (!o1Owns || (slot1.attributes() & PropertyAttribute::DontEnum)) {
            // A getter above removed or redefined the property mid-iteration.
            return false;
        }
        JSValue v1 = slot1.getValue(globalObject, propertyName);
        RETURN_IF_EXCEPTION(scope, false);
        bool eq = Bun__deepEquals<isStrict, enableAsymmetricMatchers, checkPrototypes, skipPrototypeIdentity>(globalObject, v1, v2, gcBuffer, stack, scope, true);
        RETURN_IF_EXCEPTION(scope, false);
        if (!eq) {
            return false;
        }
    }
    return true;
}

// node's wellKnownConstructors set (lib/internal/util/comparisons.js), matched for any realm.
static bool isWellKnownConstructor(JSValue value)
{
    if (!value.isCell())
        return false;
    JSCell* cell = value.asCell();
    if (cell->type() != InternalFunctionType && cell->type() != JSFunctionType)
        return false;
    const ClassInfo* info = cell->classInfo();
    return info == JSC::ObjectConstructor::info()
        || info == JSC::ArrayConstructor::info()
        || info == JSC::FunctionConstructor::info()
        || info == JSC::RegExpConstructor::info()
        || info == JSC::JSPromiseConstructor::info()
        || info == JSC::StringConstructor::info()
        || info == JSC::SymbolConstructor::info()
        || info == JSC::BigIntConstructor::info()
        || info == JSC::BooleanConstructor::info()
        || info == JSC::NumberConstructor::info()
        || info == JSC::DateConstructor::info()
        || info == JSC::ErrorConstructor::info()
        || info == JSC::MapConstructor::info()
        || info == JSC::SetConstructor::info()
        || info == JSC::WeakMapConstructor::info()
        || info == JSC::WeakSetConstructor::info()
        || info == JSC::JSArrayBufferConstructor::info()
        || info == JSC::JSInt8ArrayConstructor::info()
        || info == JSC::JSInt16ArrayConstructor::info()
        || info == JSC::JSInt32ArrayConstructor::info()
        || info == JSC::JSUint8ArrayConstructor::info()
        || info == JSC::JSUint8ClampedArrayConstructor::info()
        || info == JSC::JSUint16ArrayConstructor::info()
        || info == JSC::JSUint32ArrayConstructor::info()
        || info == JSC::JSFloat16ArrayConstructor::info()
        || info == JSC::JSFloat32ArrayConstructor::info()
        || info == JSC::JSFloat64ArrayConstructor::info()
        || info == JSC::JSBigInt64ArrayConstructor::info()
        || info == JSC::JSBigUint64ArrayConstructor::info()
        || info == JSC::JSDataViewConstructor::info()
        || info == WebCore::JSBufferConstructor::info();
}

template<bool isStrict, bool enableAsymmetricMatchers, bool checkPrototypes, bool skipPrototypeIdentity>
bool Bun__deepEquals(JSC::JSGlobalObject* globalObject, JSValue v1, JSValue v2, MarkedArgumentBuffer& gcBuffer, Vector<std::pair<JSC::JSValue, JSC::JSValue>, 16>& stack, ThrowScope& scope, bool addToStack)
{
    VM& vm = globalObject->vm();
    if (!vm.isSafeToRecurse()) [[unlikely]] {
        throwStackOverflowError(globalObject, scope);
        return false;
    }

    // need to check this before primitives, asymmetric matchers
    // can match against any type of value.
    if constexpr (enableAsymmetricMatchers) {
        if (v2.isCell() && !v2.isEmpty() && v2.asCell()->type() == JSC::JSType(JSDOMWrapperType)) {
            switch (matchAsymmetricMatcher(globalObject, v2, v1, scope)) {
            case AsymmetricMatcherResult::FAIL:
                return false;
            case AsymmetricMatcherResult::PASS:
                return true;
            case AsymmetricMatcherResult::NOT_MATCHER:
                // continue comparison
                RETURN_IF_EXCEPTION(scope, false);
                break;
            }
        } else if (v1.isCell() && !v1.isEmpty() && v1.asCell()->type() == JSC::JSType(JSDOMWrapperType)) {
            switch (matchAsymmetricMatcher(globalObject, v1, v2, scope)) {
            case AsymmetricMatcherResult::FAIL:
                return false;
            case AsymmetricMatcherResult::PASS:
                return true;
            case AsymmetricMatcherResult::NOT_MATCHER:
                // continue comparison
                RETURN_IF_EXCEPTION(scope, false);
                break;
            }
        }
    }

    if (!v1.isEmpty() && !v2.isEmpty()) {
        auto same = JSC::sameValue(globalObject, v1, v2);
        RETURN_IF_EXCEPTION(scope, false);
        if (same) {
            return true;
        }
    }

    if (v1.isEmpty() || v2.isEmpty())
        return v1.isEmpty() == v2.isEmpty();

    if (v1.isPrimitive() || v2.isPrimitive())
        return false;

    RELEASE_ASSERT(v1.isCell());
    RELEASE_ASSERT(v2.isCell());

    const size_t length = stack.size();
    const auto originalGCBufferSize = gcBuffer.size();
    for (size_t i = 0; i < length; i++) {
        auto values = stack.at(i);
        bool firstMatches = JSC::JSValue::strictEqual(globalObject, values.first, v1);
        RETURN_IF_EXCEPTION(scope, false);
        bool secondMatches = JSC::JSValue::strictEqual(globalObject, values.second, v2);
        RETURN_IF_EXCEPTION(scope, false);
        if (firstMatches)
            return secondMatches;
        if (secondMatches)
            return false;
    }

    if (addToStack) {
        gcBuffer.append(v1);
        gcBuffer.append(v2);
        stack.append({ v1, v2 });
    }
    auto removeFromStack = WTF::makeScopeExit([&] {
        if (addToStack) {
            stack.removeAt(length);
            while (gcBuffer.size() > originalGCBufferSize)
                gcBuffer.removeLast();
        }
    });

    JSCell* c1 = v1.asCell();
    JSCell* c2 = v2.asCell();
    ASSERT(c1);
    ASSERT(c2);

    // node's objectComparisonStart (lib/internal/util/comparisons.js): the constructor /
    // [[Prototype]] rule in strict mode, then equal Object.prototype.toString tags in every mode.
    if constexpr (checkPrototypes) {
        JSObject* protoCheck1 = v1.getObject();
        JSObject* protoCheck2 = v2.getObject();
        if (protoCheck1 && protoCheck2) {
            if constexpr (!skipPrototypeIdentity) {
                const auto& constructorName = vm.propertyNames->constructor;
                PropertySlot slot1(protoCheck1, PropertySlot::InternalMethodType::Get);
                bool hasConstructor1 = protoCheck1->getPropertySlot(globalObject, constructorName, slot1);
                RETURN_IF_EXCEPTION(scope, false);
                JSValue constructor1 = hasConstructor1 ? slot1.getValue(globalObject, constructorName) : jsUndefined();
                RETURN_IF_EXCEPTION(scope, false);
                bool compareConstructors = isWellKnownConstructor(constructor1);
                if (!compareConstructors && !constructor1.isUndefined()) {
                    if (slot1.isTaintedByOpaqueObject()) {
                        PropertySlot ownSlot(protoCheck1, PropertySlot::InternalMethodType::GetOwnProperty);
                        bool hasOwnConstructor = protoCheck1->methodTable()->getOwnPropertySlot(protoCheck1, globalObject, constructorName, ownSlot);
                        RETURN_IF_EXCEPTION(scope, false);
                        compareConstructors = !hasOwnConstructor;
                    } else {
                        compareConstructors = slot1.slotBase() != protoCheck1;
                    }
                }
                if (compareConstructors) {
                    // Same mono-proto structure means the same prototype chain, so a data slot found on it is val2.constructor too.
                    bool inheritedFromSharedChain = slot1.isCacheableValue() && slot1.slotBase() != protoCheck1
                        && protoCheck1->structureID() == protoCheck2->structureID() && !protoCheck1->structure()->hasPolyProto();
                    if (!inheritedFromSharedChain) {
                        JSValue constructor2 = protoCheck2->get(globalObject, constructorName);
                        RETURN_IF_EXCEPTION(scope, false);
                        bool sameConstructor = JSC::JSValue::strictEqual(globalObject, constructor1, constructor2);
                        RETURN_IF_EXCEPTION(scope, false);
                        if (!sameConstructor) {
                            return false;
                        }
                    }
                } else {
                    JSValue proto1 = protoCheck1->getPrototype(globalObject);
                    RETURN_IF_EXCEPTION(scope, false);
                    JSValue proto2 = protoCheck2->getPrototype(globalObject);
                    RETURN_IF_EXCEPTION(scope, false);
                    if (proto1 != proto2) {
                        return false;
                    }
                }
            }
            JSString* tag1 = objectPrototypeToString(globalObject, protoCheck1);
            RETURN_IF_EXCEPTION(scope, false);
            JSString* tag2 = objectPrototypeToString(globalObject, protoCheck2);
            RETURN_IF_EXCEPTION(scope, false);
            if (tag1 != tag2) {
                bool sameTag = tag1->equal(globalObject, tag2);
                RETURN_IF_EXCEPTION(scope, false);
                if (!sameTag) {
                    return false;
                }
            }
        }
    }

    std::optional<bool> isSpecialEqual = specialObjectsDequal<isStrict, enableAsymmetricMatchers, checkPrototypes, skipPrototypeIdentity>(globalObject, gcBuffer, stack, scope, c1, c2);
    RETURN_IF_EXCEPTION(scope, false);
    if (isSpecialEqual.has_value()) return WTF::move(*isSpecialEqual);
    isSpecialEqual = specialObjectsDequal<isStrict, enableAsymmetricMatchers, checkPrototypes, skipPrototypeIdentity>(globalObject, gcBuffer, stack, scope, c2, c1);
    RETURN_IF_EXCEPTION(scope, false);
    if (isSpecialEqual.has_value()) return WTF::move(*isSpecialEqual);
    JSObject* o1 = v1.getObject();
    JSObject* o2 = v2.getObject();

    bool v1Array = isArray(globalObject, v1);
    RETURN_IF_EXCEPTION(scope, false);
    bool v2Array = isArray(globalObject, v2);
    RETURN_IF_EXCEPTION(scope, false);

    if (v1Array != v2Array)
        return false;

    if (v1Array && v2Array && !(o1->isProxy() || o2->isProxy())) {
        JSC::JSArray* array1 = uncheckedDowncast<JSC::JSArray>(v1);
        JSC::JSArray* array2 = uncheckedDowncast<JSC::JSArray>(v2);

        size_t array1Length = array1->length();
        size_t array2Length = array2->length();
        if constexpr (isStrict) {
            if (array1Length != array2Length) {
                return false;
            }
        }

        uint64_t i = 0;
        for (; i < array1Length; i++) {
            JSValue left = getIndexWithoutAccessors(globalObject, o1, i);
            RETURN_IF_EXCEPTION(scope, false);
            JSValue right = getIndexWithoutAccessors(globalObject, o2, i);
            RETURN_IF_EXCEPTION(scope, false);

            if constexpr (isStrict) {
                if (left.isEmpty() && right.isEmpty()) {
                    continue;
                }
                if (left.isEmpty() || right.isEmpty()) {
                    return false;
                }
            }

            if constexpr (!isStrict) {
                if (((left.isEmpty() || right.isEmpty()) && (left.isUndefined() || right.isUndefined()))) {
                    continue;
                }
            }

            auto eql = Bun__deepEquals<isStrict, enableAsymmetricMatchers, checkPrototypes, skipPrototypeIdentity>(globalObject, left, right, gcBuffer, stack, scope, true);
            RETURN_IF_EXCEPTION(scope, false);
            if (!eql) return false;
        }

        for (; i < array2Length; i++) {
            JSValue right = getIndexWithoutAccessors(globalObject, o2, i);
            RETURN_IF_EXCEPTION(scope, false);

            if (((right.isEmpty() || right.isUndefined()))) {
                continue;
            }

            return false;
        }

        if constexpr (checkPrototypes) {
            // node compares own enumerable non-index string+symbol props via getOwnNonIndexProperties;
            // the Bun.deepEquals symbol-only block below walks the prototype chain, so diverge here.
            return nonIndexOwnPropertiesEqual<isStrict, enableAsymmetricMatchers, checkPrototypes, skipPrototypeIdentity>(globalObject, gcBuffer, stack, scope, o1, o2);
        }

        JSC::PropertyNameArrayBuilder a1(vm, PropertyNameMode::Symbols, PrivateSymbolMode::Exclude);
        JSC::PropertyNameArrayBuilder a2(vm, PropertyNameMode::Symbols, PrivateSymbolMode::Exclude);
        JSObject::getOwnPropertyNames(o1, globalObject, a1, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
        JSObject::getOwnPropertyNames(o2, globalObject, a2, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);

        size_t propertyLength = a1.size();
        if constexpr (isStrict) {
            if (propertyLength != a2.size()) {
                return false;
            }
        }

        // take a property name from one, try to get it from both
        for (size_t i = 0; i < propertyLength; i++) {
            Identifier i1 = a1[i];
            PropertyName propertyName1 = PropertyName(i1);

            JSValue prop1 = o1->get(globalObject, propertyName1);
            RETURN_IF_EXCEPTION(scope, false);

            if (!prop1) [[unlikely]] {
                return false;
            }

            JSValue prop2 = o2->getIfPropertyExists(globalObject, propertyName1);
            RETURN_IF_EXCEPTION(scope, false);

            if constexpr (!isStrict) {
                if (prop1.isUndefined() && prop2.isEmpty()) {
                    continue;
                }
            }

            if (!prop2) {
                return false;
            }

            auto eql = Bun__deepEquals<isStrict, enableAsymmetricMatchers, checkPrototypes, skipPrototypeIdentity>(globalObject, prop1, prop2, gcBuffer, stack, scope, true);
            RETURN_IF_EXCEPTION(scope, false);
            if (!eql) return false;
        }

        return true;
    }

    if constexpr (isStrict && !checkPrototypes && !skipPrototypeIdentity) {
        if (!equal(JSObject::calculatedClassName(o1), JSObject::calculatedClassName(o2))) {
            return false;
        }
    }

    JSC::Structure* o1Structure = o1->structure();
    if (!o1Structure->hasNonReifiedStaticProperties() && o1Structure->canPerformFastPropertyEnumeration()) {
        JSC::Structure* o2Structure = o2->structure();
        // The mixed-structure fast path resolves properties with getDirect(),
        // which also finds non-enumerable ones node ignores; the node entry
        // point only takes the fast path when the structures match.
        if (!o2Structure->hasNonReifiedStaticProperties() && o2Structure->canPerformFastPropertyEnumeration()
            && (!checkPrototypes || o2Structure->id() == o1Structure->id())) {

            bool result = true;
            bool sameStructure = o2Structure->id() == o1Structure->id();
            // Comparing values runs user getters that can rehash this PropertyTable mid-walk (use-after-free), so collect the pairs first and compare after.
            MarkedArgumentBuffer pairs;
            if (sameStructure) {
                o1Structure->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
                    if (entry.attributes() & PropertyAttribute::DontEnum || PropertyName(entry.key()).isPrivateName()) {
                        return true;
                    }

                    JSValue left = o1->getDirect(entry.offset());
                    JSValue right = o2->getDirect(entry.offset());

                    if constexpr (!isStrict) {
                        if (left.isUndefined() && right.isEmpty()) {
                            return true;
                        }
                    }

                    if (!right) {
                        result = false;
                        return false;
                    }

                    pairs.appendWithCrashOnOverflow(left);
                    pairs.appendWithCrashOnOverflow(right);
                    return true;
                });
            } else {
                size_t count = 0;
                o1Structure->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
                    if (entry.attributes() & PropertyAttribute::DontEnum || PropertyName(entry.key()).isPrivateName()) {
                        return true;
                    }
                    count++;

                    JSValue left = o1->getDirect(entry.offset());
                    JSValue right;
                    if constexpr (isStrict) {
                        // Only an enumerable property on o2 can match an enumerable one on o1.
                        // getDirect() alone would also find a non-enumerable property, which the
                        // reverse loop skips, so the two objects would compare equal. Loose
                        // comparison keeps matching either, as node does.
                        unsigned o2Attributes = 0;
                        PropertyOffset o2Offset = o2Structure->get(vm, JSC::PropertyName(entry.key()), o2Attributes);
                        if (o2Offset != invalidOffset && !(o2Attributes & PropertyAttribute::DontEnum)) {
                            right = o2->getDirect(o2Offset);
                        }
                    } else {
                        right = o2->getDirect(vm, JSC::PropertyName(entry.key()));
                    }

                    if constexpr (!isStrict) {
                        if (left.isUndefined() && right.isEmpty()) {
                            return true;
                        }
                    }

                    if (!right) {
                        result = false;
                        return false;
                    }

                    pairs.appendWithCrashOnOverflow(left);
                    pairs.appendWithCrashOnOverflow(right);
                    return true;
                });

                if (result) {
                    size_t remain = count;
                    o2Structure->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
                        if (entry.attributes() & PropertyAttribute::DontEnum || PropertyName(entry.key()).isPrivateName()) {
                            return true;
                        }

                        if constexpr (!isStrict) {
                            if (o2->getDirect(entry.offset()).isUndefined()) {
                                return true;
                            }
                        }

                        // Membership check only; every left property is in `pairs` and compared below.
                        if (o1->getDirectOffset(vm, JSC::PropertyName(entry.key())) == invalidOffset) {
                            result = false;
                            return false;
                        }

                        if (remain == 0) {
                            result = false;
                            return false;
                        }

                        remain--;
                        return true;
                    });
                }
            }

            if (!result) {
                return false;
            }

            for (size_t i = 0; i < pairs.size(); i += 2) {
                JSValue left = pairs.at(i);
                JSValue right = pairs.at(i + 1);

                if (left == right) continue;
                auto same = JSC::sameValue(globalObject, left, right);
                RETURN_IF_EXCEPTION(scope, false);
                if (same) continue;

                auto eql = Bun__deepEquals<isStrict, enableAsymmetricMatchers, checkPrototypes, skipPrototypeIdentity>(globalObject, left, right, gcBuffer, stack, scope, true);
                RETURN_IF_EXCEPTION(scope, false);
                if (!eql) {
                    return false;
                }
            }

            return true;
        }
    }

    JSC::PropertyNameArrayBuilder a1(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    JSC::PropertyNameArrayBuilder a2(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    if constexpr (checkPrototypes) {
        // node compares own enumerable properties only; getPropertyNames also
        // collects enumerable properties from the prototype chain.
        o1->methodTable()->getOwnPropertyNames(o1, globalObject, a1, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
        o2->methodTable()->getOwnPropertyNames(o2, globalObject, a2, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
    } else {
        o1->getPropertyNames(globalObject, a1, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
        o2->getPropertyNames(globalObject, a2, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
    }

    const size_t propertyArrayLength1 = a1.size();
    const size_t propertyArrayLength2 = a2.size();
    if constexpr (isStrict) {
        if (propertyArrayLength1 != propertyArrayLength2) {
            return false;
        }
    }

    // take a property name from one, try to get it from both
    size_t i;
    for (i = 0; i < propertyArrayLength1; i++) {
        Identifier i1 = a1[i];
        PropertyName propertyName1 = PropertyName(i1);

        JSValue prop1 = o1->get(globalObject, propertyName1);
        RETURN_IF_EXCEPTION(scope, false);

        if (!prop1) [[unlikely]] {
            return false;
        }

        JSValue prop2;
        if constexpr (checkPrototypes) {
            // node only matches own enumerable properties; getIfPropertyExists
            // would also find non-enumerable or inherited ones.
            PropertySlot slot2(o2, PropertySlot::InternalMethodType::GetOwnProperty);
            bool has = o2->methodTable()->getOwnPropertySlot(o2, globalObject, propertyName1, slot2);
            RETURN_IF_EXCEPTION(scope, false);
            if (!has || (slot2.attributes() & PropertyAttribute::DontEnum)) {
                return false;
            }
            prop2 = slot2.getValue(globalObject, propertyName1);
            RETURN_IF_EXCEPTION(scope, false);
        } else {
            prop2 = o2->getIfPropertyExists(globalObject, propertyName1);
            RETURN_IF_EXCEPTION(scope, false);
        }

        if constexpr (!isStrict) {
            if (prop1.isUndefined() && prop2.isEmpty()) {
                continue;
            }
        }

        if (!prop2) {
            return false;
        }

        auto eql = Bun__deepEquals<isStrict, enableAsymmetricMatchers, checkPrototypes, skipPrototypeIdentity>(globalObject, prop1, prop2, gcBuffer, stack, scope, true);
        RETURN_IF_EXCEPTION(scope, false);
        if (!eql) return false;
    }

    // for the remaining properties in the other object, make sure they are undefined
    for (; i < propertyArrayLength2; i++) {
        Identifier i2 = a2[i];
        PropertyName propertyName2 = PropertyName(i2);

        JSValue prop2 = o2->getIfPropertyExists(globalObject, propertyName2);
        RETURN_IF_EXCEPTION(scope, false);

        if (!prop2.isUndefined()) {
            return false;
        }
    }

    return true;
}

static bool isTemporalObject(JSC::JSObject* object)
{
    return object->inherits<JSC::TemporalInstant>()
        || object->inherits<JSC::TemporalPlainDate>()
        || object->inherits<JSC::TemporalPlainDateTime>()
        || object->inherits<JSC::TemporalPlainTime>()
        || object->inherits<JSC::TemporalZonedDateTime>()
        || object->inherits<JSC::TemporalPlainYearMonth>()
        || object->inherits<JSC::TemporalPlainMonthDay>()
        || object->inherits<JSC::TemporalDuration>();
}

// Temporal objects keep their state in internal slots and have no own
// properties, so the generic own-property walk would call any two instances
// of a class equal. Compare the internal fields instead, the way JSDateType
// compares Dates. Returns std::nullopt only when neither side is a Temporal
// object.
static std::optional<bool> temporalObjectsDequal(JSC::JSObject* o1, JSC::JSObject* o2)
{
    if (auto* instant1 = dynamicDowncast<JSC::TemporalInstant>(o1)) {
        auto* instant2 = dynamicDowncast<JSC::TemporalInstant>(o2);
        return instant2 && instant1->exactTime() == instant2->exactTime();
    }
    if (auto* date1 = dynamicDowncast<JSC::TemporalPlainDate>(o1)) {
        auto* date2 = dynamicDowncast<JSC::TemporalPlainDate>(o2);
        return date2 && date1->plainDate() == date2->plainDate() && date1->calendarID() == date2->calendarID();
    }
    if (auto* dateTime1 = dynamicDowncast<JSC::TemporalPlainDateTime>(o1)) {
        auto* dateTime2 = dynamicDowncast<JSC::TemporalPlainDateTime>(o2);
        return dateTime2 && dateTime1->plainDate() == dateTime2->plainDate() && dateTime1->plainTime() == dateTime2->plainTime() && dateTime1->calendarID() == dateTime2->calendarID();
    }
    if (auto* time1 = dynamicDowncast<JSC::TemporalPlainTime>(o1)) {
        auto* time2 = dynamicDowncast<JSC::TemporalPlainTime>(o2);
        return time2 && time1->plainTime() == time2->plainTime();
    }
    if (auto* zoned1 = dynamicDowncast<JSC::TemporalZonedDateTime>(o1)) {
        auto* zoned2 = dynamicDowncast<JSC::TemporalZonedDateTime>(o2);
        return zoned2 && zoned1->exactTime() == zoned2->exactTime() && zoned1->timeZone() == zoned2->timeZone() && zoned1->calendarID() == zoned2->calendarID();
    }
    if (auto* yearMonth1 = dynamicDowncast<JSC::TemporalPlainYearMonth>(o1)) {
        auto* yearMonth2 = dynamicDowncast<JSC::TemporalPlainYearMonth>(o2);
        return yearMonth2 && yearMonth1->plainYearMonth() == yearMonth2->plainYearMonth() && yearMonth1->calendarID() == yearMonth2->calendarID();
    }
    if (auto* monthDay1 = dynamicDowncast<JSC::TemporalPlainMonthDay>(o1)) {
        auto* monthDay2 = dynamicDowncast<JSC::TemporalPlainMonthDay>(o2);
        return monthDay2 && monthDay1->plainMonthDay() == monthDay2->plainMonthDay() && monthDay1->calendarID() == monthDay2->calendarID();
    }
    if (auto* duration1 = dynamicDowncast<JSC::TemporalDuration>(o1)) {
        auto* duration2 = dynamicDowncast<JSC::TemporalDuration>(o2);
        if (!duration2)
            return false;
        // Field-wise: PT1H and PT60M are different Duration values.
        for (size_t i = 0; i < JSC::numberOfTemporalUnits; i++) {
            if (duration1->duration()[i] != duration2->duration()[i])
                return false;
        }
        return true;
    }
    // `o1` is not a Temporal object; a Temporal `o2` can then never be equal
    // (and must not reach the own-property walk).
    if (isTemporalObject(o2))
        return false;
    return std::nullopt;
}

struct DeepEqualsMode {
    bool isStrict;
    bool enableAsymmetricMatchers;
    bool checkPrototypes;
    bool skipPrototypeIdentity;
    bool (*deepEquals)(JSC::JSGlobalObject*, JSValue, JSValue, MarkedArgumentBuffer&, Vector<std::pair<JSValue, JSValue>, 16>&, ThrowScope&, bool);
    bool (*nonIndexOwnPropertiesEqual)(JSC::JSGlobalObject*, MarkedArgumentBuffer&, Vector<std::pair<JSValue, JSValue>, 16>&, ThrowScope&, JSObject*, JSObject*);
};

template<bool isStrict, bool enableAsymmetricMatchers, bool checkPrototypes, bool skipPrototypeIdentity>
static constexpr DeepEqualsMode deepEqualsMode {
    isStrict,
    enableAsymmetricMatchers,
    checkPrototypes,
    skipPrototypeIdentity,
    &Bun__deepEquals<isStrict, enableAsymmetricMatchers, checkPrototypes, skipPrototypeIdentity>,
    checkPrototypes ? &nonIndexOwnPropertiesEqual<isStrict, enableAsymmetricMatchers, checkPrototypes, skipPrototypeIdentity> : nullptr,
};

// The per-type comparisons (Map, Set, Date, typed arrays, ...) are compiled once
// and take the mode at runtime; only the dispatch and the plain-object tail in
// `specialObjectsDequal` below stay specialised per mode.
static std::optional<bool> specialObjectsDequalSlow(const DeepEqualsMode& mode, JSC::JSGlobalObject* globalObject, MarkedArgumentBuffer& gcBuffer, Vector<std::pair<JSC::JSValue, JSC::JSValue>, 16>& stack, ThrowScope& scope, JSCell* _Nonnull c1, JSCell* _Nonnull c2)
{
    uint8_t c1Type = c1->type();
    uint8_t c2Type = c2->type();

    switch (c1Type) {
    case ArrayBufferType: {
        if (c2Type != ArrayBufferType) {
            return false;
        }

        JSC::ArrayBuffer* left = uncheckedDowncast<JSArrayBuffer>(c1)->impl();
        JSC::ArrayBuffer* right = uncheckedDowncast<JSArrayBuffer>(c2)->impl();
        size_t byteLength = left->byteLength();

        if (right->byteLength() != byteLength) {
            return false;
        }

        if (left->isShared() != right->isShared()) [[unlikely]] {
            return false;
        }

        if (left->isDetached() || right->isDetached()) [[unlikely]] {
            if (!mode.enableAsymmetricMatchers) {
                // Node wraps each side in `new Uint8Array(buf)` to compare bytes, which
                // throws on a detached ArrayBuffer; match that contract for node:assert/util.
                throwTypeError(globalObject, scope, "Cannot perform Construct on a detached ArrayBuffer"_s);
            }
            return false;
        }

        if (!WTF::equalSpans(left->span(), right->span()))
            return false;

        if (mode.checkPrototypes) {
            // node also compares own enumerable properties of ArrayBuffers.
            break;
        }
        return true;
    }
    case DataViewType: {
        if (!mode.checkPrototypes) {
            // Bun.deepEquals / bun:test compare DataViews as plain objects; reserve the byte
            // comparison for the node-parity instantiations.
            break;
        }
        if (c2Type != DataViewType) {
            return false;
        }

        // node compares DataViews by contents (their bytes at the view's
        // offset), then falls through to own enumerable properties.
        JSC::JSDataView* left = uncheckedDowncast<JSC::JSDataView>(c1);
        JSC::JSDataView* right = uncheckedDowncast<JSC::JSDataView>(c2);
        if (left->isDetached() || right->isDetached()) [[unlikely]] {
            // The C++ byteLength() accessor silently reports 0 for a detached
            // view; node reads the JS accessor, which throws. Keep node's
            // exact error contract.
            throwTypeError(globalObject, scope, "Cannot perform get DataView.prototype.byteLength on a detached or out-of-bounds ArrayBuffer"_s);
            return false;
        }
        size_t byteLength = left->byteLength();
        if (right->byteLength() != byteLength) {
            return false;
        }
        if (!WTF::equalSpans(std::span { static_cast<const uint8_t*>(left->vector()), byteLength },
                std::span { static_cast<const uint8_t*>(right->vector()), byteLength }))
            return false;
        // node compares DataView own properties via getOwnNonIndexProperties
        // (an extra integer-index key is ignored), so compare the non-index
        // keys directly instead of falling through to the full own-key walk.
        return mode.nonIndexOwnPropertiesEqual(globalObject, gcBuffer, stack, scope, left, right);
    }
    case JSDateType: {
        if (c2Type != JSDateType) {
            return false;
        }

        JSC::DateInstance* left = uncheckedDowncast<DateInstance>(c1);
        JSC::DateInstance* right = uncheckedDowncast<DateInstance>(c2);

        if (mode.checkPrototypes) {
            double time1 = left->internalNumber();
            double time2 = right->internalNumber();
            // node treats two invalid dates as equal, and compares own
            // enumerable properties as well.
            if (time1 != time2 && !(std::isnan(time1) && std::isnan(time2))) {
                return false;
            }
            break;
        }

        return left->internalNumber() == right->internalNumber();
    }
    case RegExpObjectType: {
        if (c2Type != RegExpObjectType) {
            return false;
        }

        if (JSC::RegExpObject* left = dynamicDowncast<JSC::RegExpObject>(c1)) {
            JSC::RegExpObject* right = dynamicDowncast<JSC::RegExpObject>(c2);

            if (!right) [[unlikely]] {
                return false;
            }

            if (left->regExp()->key() != right->regExp()->key()) {
                return false;
            }
            if (mode.checkPrototypes) {
                // node also compares `lastIndex` and own enumerable properties.
                bool sameLastIndex = JSC::sameValue(globalObject, left->getLastIndex(), right->getLastIndex());
                RETURN_IF_EXCEPTION(scope, {});
                if (!sameLastIndex) {
                    return false;
                }
                break;
            }
            return true;
        }

        return false;
    }
    case ErrorInstanceType: {
        if (c2Type != ErrorInstanceType) {
            return false;
        }

        // NOTE(@DonIsaac): could `left` ever _not_ be a JSC::ErrorInstance?
        if (JSC::ErrorInstance* left = dynamicDowncast<JSC::ErrorInstance>(c1)) {
            JSC::ErrorInstance* right = dynamicDowncast<JSC::ErrorInstance>(c2);

            if (!right) [[unlikely]] {
                return false;
            }

            if (left->errorType() != right->errorType()) {
                // quick check on ctors (does not handle subclasses)
                return false;
            }

            auto leftName = left->sanitizedNameString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto rightName = right->sanitizedNameString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (leftName != rightName) {
                // manual `.name` changes (usually in subclasses)
                return false;
            }

            auto leftMessage = left->sanitizedMessageString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            auto rightMessage = right->sanitizedMessageString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (leftMessage != rightMessage) {
                // `.message`
                return false;
            }

            if (mode.isStrict) {
                if (left->runtimeTypeForCause() != right->runtimeTypeForCause()) {
                    return false;
                }
            }

            VM& vm = JSC::getVM(globalObject);

            // `.cause` is non-enumerable, so it must be checked explicitly.
            // note that an undefined cause is different than a missing cause in
            // strict mode.
            const PropertyName cause(vm.propertyNames->cause);
            if (mode.isStrict) {
                bool leftHasCause = left->hasProperty(globalObject, cause);
                RETURN_IF_EXCEPTION(scope, {});
                bool rightHasCause = right->hasProperty(globalObject, cause);
                RETURN_IF_EXCEPTION(scope, {});
                if (leftHasCause != rightHasCause) {
                    return false;
                }
            }
            auto leftCause = left->get(globalObject, cause);
            RETURN_IF_EXCEPTION(scope, {});
            auto rightCause = right->get(globalObject, cause);
            RETURN_IF_EXCEPTION(scope, {});
            bool causesEqual = mode.deepEquals(globalObject, leftCause, rightCause, gcBuffer, stack, scope, true);
            RETURN_IF_EXCEPTION(scope, {});
            if (!causesEqual) {
                return false;
            }

            // check arbitrary enumerable properties. `.stack` is not checked.
            left->materializeErrorInfoIfNeeded(vm);
            RETURN_IF_EXCEPTION(scope, {});
            right->materializeErrorInfoIfNeeded(vm);
            RETURN_IF_EXCEPTION(scope, {});
            JSC::PropertyNameArrayBuilder a1(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
            JSC::PropertyNameArrayBuilder a2(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
            left->getPropertyNames(globalObject, a1, DontEnumPropertiesMode::Exclude);
            RETURN_IF_EXCEPTION(scope, {});
            right->getPropertyNames(globalObject, a2, DontEnumPropertiesMode::Exclude);
            RETURN_IF_EXCEPTION(scope, {});

            const size_t propertyArrayLength1 = a1.size();
            const size_t propertyArrayLength2 = a2.size();
            if (mode.isStrict) {
                if (propertyArrayLength1 != propertyArrayLength2) {
                    return false;
                }
            }

            // take a property name from one, try to get it from both
            size_t i;
            for (i = 0; i < propertyArrayLength1; i++) {
                Identifier i1 = a1[i];
                if (i1 == vm.propertyNames->stack) continue;
                PropertyName propertyName1 = PropertyName(i1);

                JSValue prop1 = left->get(globalObject, propertyName1);
                RETURN_IF_EXCEPTION(scope, {});
                ASSERT(prop1);

                JSValue prop2 = right->getIfPropertyExists(globalObject, propertyName1);
                RETURN_IF_EXCEPTION(scope, {});

                if (!mode.isStrict) {
                    if (prop1.isUndefined() && prop2.isEmpty()) {
                        continue;
                    }
                }

                if (!prop2) {
                    return false;
                }

                bool propertiesEqual = mode.deepEquals(globalObject, prop1, prop2, gcBuffer, stack, scope, true);
                RETURN_IF_EXCEPTION(scope, {});
                if (!propertiesEqual) {
                    return false;
                }
            }

            // for the remaining properties in the other object, make sure they are undefined
            for (; i < propertyArrayLength2; i++) {
                Identifier i2 = a2[i];
                if (i2 == vm.propertyNames->stack) continue;
                PropertyName propertyName2 = PropertyName(i2);

                JSValue prop2 = right->getIfPropertyExists(globalObject, propertyName2);
                RETURN_IF_EXCEPTION(scope, {});

                if (!prop2.isUndefined()) {
                    return false;
                }
            }

            return true;
        }
        break;
    }
    case Int8ArrayType:
    case Uint8ArrayType:
    case Uint8ClampedArrayType:
    case Int16ArrayType:
    case Uint16ArrayType:
    case Int32ArrayType:
    case Uint32ArrayType:
    case Float16ArrayType:
    case Float32ArrayType:
    case Float64ArrayType:
    case BigInt64ArrayType:
    case BigUint64ArrayType: {
        if (!isTypedArrayType(static_cast<JSC::JSType>(c2Type)) || c1Type != c2Type) {
            return false;
        }

        auto info = c1->classInfo();
        auto info2 = c2->classInfo();
        if (!info || !info2) {
            return false;
        }

        // Strict mode also compares own non-index properties (e.g. symbols); loose
        // ignores them. The byte checks below still run first so a mismatch stays
        // O(bytes) and node's byte-level semantics (NaN payload bits) are preserved;
        // only the "bytes equal" exits defer to the property walk when extras exist.
        bool compareOwnProperties = false;
        if (mode.isStrict) {
            compareOwnProperties = hasExtraOwnProperties(c1->structure()) || hasExtraOwnProperties(c2->structure());
        }

        JSC::JSArrayBufferView* left = uncheckedDowncast<JSArrayBufferView>(c1);
        JSC::JSArrayBufferView* right = uncheckedDowncast<JSArrayBufferView>(c2);
        size_t byteLength = left->byteLength();

        if (right->byteLength() != byteLength) {
            return false;
        }

        if (byteLength == 0) {
            if (mode.checkPrototypes) {
                return mode.nonIndexOwnPropertiesEqual(globalObject, gcBuffer, stack, scope, left, right);
            }
            if (compareOwnProperties) break;
            return true;
        }

        if (right->isDetached() || left->isDetached()) [[unlikely]] {
            return false;
        }

        const void* vector = left->vector();
        const void* rightVector = right->vector();
        if (!vector || !rightVector) [[unlikely]] {
            return false;
        }

        if (vector == rightVector) [[unlikely]] {
            if (mode.checkPrototypes) {
                return mode.nonIndexOwnPropertiesEqual(globalObject, gcBuffer, stack, scope, left, right);
            }
            if (compareOwnProperties) break;
            return true;
        }

        // Float arrays in non-strict mode use IEEE == (+0/-0 equal, NaN != NaN); everything else
        // compares raw bytes. All results funnel to one tail so node-parity never skips own props.
        bool contentsEqual;
        if (!mode.isStrict && (c1Type == Float16ArrayType || c1Type == Float32ArrayType || c1Type == Float64ArrayType)) {
            if (c1Type == Float16ArrayType) {
                contentsEqual = looseFloatContentsEqual(std::span { static_cast<const WTF::Float16*>(vector), byteLength / sizeof(WTF::Float16) },
                    std::span { static_cast<const WTF::Float16*>(rightVector), byteLength / sizeof(WTF::Float16) });
            } else if (c1Type == Float32ArrayType) {
                contentsEqual = looseFloatContentsEqual(std::span { static_cast<const float*>(vector), byteLength / sizeof(float) },
                    std::span { static_cast<const float*>(rightVector), byteLength / sizeof(float) });
            } else { // Float64Array
                contentsEqual = looseFloatContentsEqual(std::span { static_cast<const double*>(vector), byteLength / sizeof(double) },
                    std::span { static_cast<const double*>(rightVector), byteLength / sizeof(double) });
            }
        } else {
            contentsEqual = WTF::equalSpans(std::span { static_cast<const uint8_t*>(vector), byteLength },
                std::span { static_cast<const uint8_t*>(rightVector), byteLength });
        }
        if (!contentsEqual) {
            return false;
        }
        if (mode.checkPrototypes) {
            return mode.nonIndexOwnPropertiesEqual(globalObject, gcBuffer, stack, scope, left, right);
        }
        if (compareOwnProperties) break;
        return true;
    }
    case StringObjectType: {
        if (c2Type != StringObjectType) {
            // A String subclass instance is DerivedStringObjectType. Only skipPrototype
            // mode, where the constructor is ignored, treats it as an equivalent boxed
            // string; every other mode keeps the existing "different type" answer.
            if (!(mode.isStrict && mode.skipPrototypeIdentity)) {
                return false;
            } else if (c2Type != DerivedStringObjectType) {
                return false;
            }
        }

        if (!mode.checkPrototypes && !mode.skipPrototypeIdentity) {
            if (!equal(JSObject::calculatedClassName(c1->getObject()), JSObject::calculatedClassName(c2->getObject()))) {
                return false;
            }
        }

        JSString* s1 = c1->toStringInline(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        JSString* s2 = c2->toStringInline(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        bool stringsEqual = s1->equal(globalObject, s2);
        RETURN_IF_EXCEPTION(scope, {});
        if (!stringsEqual) {
            return false;
        }
        if (mode.checkPrototypes || mode.isStrict) {
            // Only these modes compare extra own props on boxed primitives. Guarded so a plain
            // boxed string skips the per-char-index walk; `break` (not nonIndexOwnPropertiesEqual)
            // when extras exist so an out-of-range index still fails the compare, like node.
            if (hasExtraOwnProperties(c1->structure()) || hasExtraOwnProperties(c2->structure())) {
                break;
            }
        }
        return true;
    }
    case JSFunctionType: {
        return false;
    }

    case JSAsJSONType:
    case JSDOMWrapperType: {
        if (c2Type == c1Type) {

            // https://github.com/oven-sh/bun/issues/4089
            // https://github.com/oven-sh/bun/issues/6492
            auto* url2 = dynamicDowncast<JSDOMURL>(c2);
            auto* url1 = dynamicDowncast<JSDOMURL>(c1);

            if (mode.isStrict) {
                // if one is a URL and the other is not a URL, toStrictEqual returns false.
                if ((url2 == nullptr) != (url1 == nullptr)) {
                    return false;
                }
            } else {
                if ((url1 == nullptr) != (url2 == nullptr)) {
                    goto compareAsNormalValue;
                }
            }

            if (url2 && url1) {
                // toEqual or toStrictEqual should return false when the URLs' href is not equal
                // But you could have added additional properties onto the
                // url object itself, so we must check those as well
                // But it's definitely not equal if the href() is not the same
                if (url1->wrapped().href() != url2->wrapped().href()) {
                    return false;
                }

                goto compareAsNormalValue;
            }

            // TODO: FormData.
            // It's complicated because it involves Blob.

            {
                auto urlSearchParams1 = dynamicDowncast<JSURLSearchParams>(c1);
                auto urlSearchParams2 = dynamicDowncast<JSURLSearchParams>(c2);
                if (urlSearchParams1 && urlSearchParams2) {
                    auto& wrapped1 = urlSearchParams1->wrapped();
                    const auto& wrapped2 = urlSearchParams2->wrapped();
                    if (wrapped1.size() != wrapped2.size()) {
                        return false;
                    }

                    auto iter1 = wrapped1.createIterator();
                    while (const auto& maybePair = iter1.next()) {
                        const auto& key = maybePair->key;
                        const auto& value = maybePair->value;
                        const auto& maybeValue = wrapped2.get(key);
                        if (!maybeValue || maybeValue != value) {
                            return false;
                        }
                    }

                    goto compareAsNormalValue;
                } else {
                    if (mode.isStrict) {
                        // if one is a URLSearchParams and the other is not a URLSearchParams, toStrictEqual should return false.
                        if ((urlSearchParams2 == nullptr) != (urlSearchParams1 == nullptr)) {
                            return false;
                        }
                    } else {
                        if ((urlSearchParams1 == nullptr) != (urlSearchParams2 == nullptr)) {
                            goto compareAsNormalValue;
                        }
                    }
                }
            }

            {
                auto headers1 = dynamicDowncast<JSFetchHeaders>(c1);
                auto headers2 = dynamicDowncast<JSFetchHeaders>(c2);
                if (headers1 && headers2) {
                    auto& wrapped1 = headers1->wrapped();
                    const auto& wrapped2 = headers2->wrapped();
                    if (wrapped1.size() != wrapped2.size()) {
                        return false;
                    }

                    auto iter1 = wrapped1.createIterator();
                    while (const auto& maybePair = iter1.next()) {
                        const auto& key = maybePair->key;
                        const auto& value = maybePair->value;
                        const auto& maybeValue = wrapped2.get(key);
                        if (maybeValue.hasException()) {
                            return false;
                        }

                        if (maybeValue.returnValue() != value) {
                            return false;
                        }
                    }

                    goto compareAsNormalValue;
                } else {
                    if (mode.isStrict) {
                        // if one is a FetchHeaders and the other is not a FetchHeaders, toStrictEqual should return false.
                        if ((headers2 == nullptr) != (headers1 == nullptr)) {
                            return false;
                        }
                    } else {
                        if ((headers1 == nullptr) != (headers2 == nullptr)) {
                            goto compareAsNormalValue;
                        }
                    }
                }
            }
        }

        goto compareAsNormalValue;

    compareAsNormalValue:
        break;
    }
    // globalThis is only equal to globalThis
    // NOTE: globalThis from JS is a JSGlobalProxy (GlobalProxyType) wrapping Zig::GlobalObject (GlobalObjectType)
    case GlobalObjectType: {
        if (c1Type != c2Type) return false;
        auto* g1 = dynamicDowncast<JSC::JSGlobalObject>(c1);
        auto* g2 = dynamicDowncast<JSC::JSGlobalObject>(c2);
        return g1->m_globalThis == g2->m_globalThis;
    }
    case GlobalProxyType: {
        if (c1Type != c2Type) return false;
        auto* gp1 = dynamicDowncast<JSC::JSGlobalProxy>(c1);
        auto* gp2 = dynamicDowncast<JSC::JSGlobalProxy>(c2);
        return gp1->target()->m_globalThis == gp2->target()->m_globalThis;
    }
    case NumberObjectType:
    case BooleanObjectType: {
        // Number and Boolean wrapper objects must be the same type and have the same internal value
        if (c1Type != c2Type) return false;
        JSValue val1 = uncheckedDowncast<JSWrapperObject>(c1)->internalValue();
        JSValue val2 = uncheckedDowncast<JSWrapperObject>(c2)->internalValue();
        bool same = JSC::sameValue(globalObject, val1, val2);
        RETURN_IF_EXCEPTION(scope, {});
        if (!same) return false;
        // Fall through to check own properties
        break;
    }
    default:
        break;
    }

    if (mode.checkPrototypes) {
        // node never considers distinct WeakMaps, WeakSets, or Promises equal
        // (their contents cannot be inspected).
        if (c1Type == JSC::JSWeakMapType || c1Type == JSC::JSWeakSetType || c1Type == JSC::JSPromiseType
            || c2Type == JSC::JSWeakMapType || c2Type == JSC::JSWeakSetType || c2Type == JSC::JSPromiseType) {
            return false;
        }
    }

    // Symbol and BigInt wrapper objects are plain ObjectType in JSC, so they are not
    // reachable from the switch above. Like Number and Boolean wrappers, they must be
    // the same kind of wrapper and hold the same internal value. Everything else --
    // object literals, arrays -- has its own JSType and skips this.
    if (c1Type == ObjectType) {
        JSObject* obj1 = c1->getObject();
        JSObject* obj2 = c2->getObject();
        if (obj1 && obj2) {
            std::optional<bool> temporalEqual = temporalObjectsDequal(obj1, obj2);
            if (temporalEqual.has_value())
                return temporalEqual;

            const bool isSymbol1 = obj1->inherits<SymbolObject>();
            const bool isBigInt1 = obj1->inherits<BigIntObject>();
            if (isSymbol1 || isBigInt1) {
                if (isSymbol1 != obj2->inherits<SymbolObject>() || isBigInt1 != obj2->inherits<BigIntObject>()) {
                    return false;
                }
                JSValue val1 = uncheckedDowncast<JSWrapperObject>(obj1)->internalValue();
                JSValue val2 = uncheckedDowncast<JSWrapperObject>(obj2)->internalValue();
                bool same = JSC::sameValue(globalObject, val1, val2);
                RETURN_IF_EXCEPTION(scope, {});
                if (!same) return false;
                // Fall through to check own properties
            }
        }
    }

    return std::nullopt;
}

template<bool isStrict, bool enableAsymmetricMatchers, bool checkPrototypes, bool skipPrototypeIdentity>
std::optional<bool> specialObjectsDequal(JSC::JSGlobalObject* globalObject, MarkedArgumentBuffer& gcBuffer, Vector<std::pair<JSC::JSValue, JSC::JSValue>, 16>& stack, ThrowScope& scope, JSCell* _Nonnull c1, JSCell* _Nonnull c2)
{
    VM& vm = globalObject->vm();
    uint8_t c1Type = c1->type();
    uint8_t c2Type = c2->type();

    switch (c1Type) {
    // Map/Set stay specialised: expect(...).toEqual on collections is hot enough
    // that the per-entry recursion should be a direct call.
    case JSSetType: {
        if (c2Type != JSSetType) {
            return false;
        }

        JSSet* set1 = uncheckedDowncast<JSSet>(c1);
        JSSet* set2 = uncheckedDowncast<JSSet>(c2);

        if (set1->size() != set2->size()) {
            return false;
        }

        auto iter1 = JSSetIterator::create(vm, globalObject->setIteratorStructure(), set1, IterationKind::Keys);
        JSValue key1;
        while (iter1->next(globalObject, key1)) {
            bool has = set2->has(globalObject, key1);
            RETURN_IF_EXCEPTION(scope, {});
            if (has) {
                continue;
            }

            // We couldn't find the key in the second set. This may be a false positive due to how
            // JSValues are represented in JSC, so we need to fall back to a linear search to be sure.
            auto iter2 = JSSetIterator::create(vm, globalObject->setIteratorStructure(), set2, IterationKind::Keys);
            JSValue key2;
            bool foundMatchingKey = false;
            while (iter2->next(globalObject, key2)) {
                bool equal = Bun__deepEquals<isStrict, enableAsymmetricMatchers, checkPrototypes, skipPrototypeIdentity>(globalObject, key1, key2, gcBuffer, stack, scope, false);
                RETURN_IF_EXCEPTION(scope, {});
                if (equal) {
                    foundMatchingKey = true;
                    break;
                }
            }

            if (!foundMatchingKey) {
                return false;
            }
        }

        if constexpr (checkPrototypes) {
            // node also compares own enumerable properties of Sets.
            break;
        }
        return true;
    }
    case JSMapType: {
        if (c2Type != JSMapType) {
            return false;
        }

        JSMap* map1 = uncheckedDowncast<JSMap>(c1);
        JSMap* map2 = uncheckedDowncast<JSMap>(c2);
        size_t leftSize = map1->size();

        if (leftSize != map2->size()) {
            return false;
        }

        auto iter1 = JSMapIterator::create(vm, globalObject->mapIteratorStructure(), map1, IterationKind::Entries);
        JSValue key1, value1;
        while (iter1->nextKeyValue(globalObject, key1, value1)) {
            JSValue value2 = map2->get(globalObject, key1);
            RETURN_IF_EXCEPTION(scope, {});
            if (value2.isUndefined()) {
                // We couldn't find the key in the second map. This may be a false positive due to
                // how JSValues are represented in JSC, so we need to fall back to a linear search
                // to be sure.
                auto iter2 = JSMapIterator::create(vm, globalObject->mapIteratorStructure(), map2, IterationKind::Entries);
                JSValue key2;
                bool foundMatchingKey = false;
                while (iter2->nextKeyValue(globalObject, key2, value2)) {
                    bool keysEqual = Bun__deepEquals<isStrict, enableAsymmetricMatchers, checkPrototypes, skipPrototypeIdentity>(globalObject, key1, key2, gcBuffer, stack, scope, false);
                    RETURN_IF_EXCEPTION(scope, {});
                    if (keysEqual) {
                        foundMatchingKey = true;
                        break;
                    }
                }

                if (!foundMatchingKey) {
                    return false;
                }

                // Compare both values below.
            }

            bool valuesEqual = Bun__deepEquals<isStrict, enableAsymmetricMatchers, checkPrototypes, skipPrototypeIdentity>(globalObject, value1, value2, gcBuffer, stack, scope, false);
            RETURN_IF_EXCEPTION(scope, {});
            if (!valuesEqual) {
                return false;
            }
        }

        if constexpr (checkPrototypes) {
            // node also compares own enumerable properties of Maps.
            break;
        }
        return true;
    }
    case ArrayBufferType:
    case DataViewType:
    case JSDateType:
    case RegExpObjectType:
    case ErrorInstanceType:
    case Int8ArrayType:
    case Uint8ArrayType:
    case Uint8ClampedArrayType:
    case Int16ArrayType:
    case Uint16ArrayType:
    case Int32ArrayType:
    case Uint32ArrayType:
    case Float16ArrayType:
    case Float32ArrayType:
    case Float64ArrayType:
    case BigInt64ArrayType:
    case BigUint64ArrayType:
    case StringObjectType:
    case JSFunctionType:
    case JSAsJSONType:
    case JSDOMWrapperType:
    case GlobalObjectType:
    case GlobalProxyType:
    case NumberObjectType:
    case BooleanObjectType:
        return specialObjectsDequalSlow(deepEqualsMode<isStrict, enableAsymmetricMatchers, checkPrototypes, skipPrototypeIdentity>, globalObject, gcBuffer, stack, scope, c1, c2);
    default:
        break;
    }

    if constexpr (checkPrototypes) {
        // node never considers distinct WeakMaps, WeakSets, or Promises equal
        // (their contents cannot be inspected).
        if (c1Type == JSC::JSWeakMapType || c1Type == JSC::JSWeakSetType || c1Type == JSC::JSPromiseType
            || c2Type == JSC::JSWeakMapType || c2Type == JSC::JSWeakSetType || c2Type == JSC::JSPromiseType) {
            return false;
        }
    }

    // Symbol and BigInt wrapper objects are plain ObjectType in JSC, so they are not
    // reachable from the switch above. Like Number and Boolean wrappers, they must be
    // the same kind of wrapper and hold the same internal value. Everything else --
    // object literals, arrays -- has its own JSType and skips this.
    if (c1Type == ObjectType) {
        JSObject* obj1 = c1->getObject();
        JSObject* obj2 = c2->getObject();
        if (obj1 && obj2) {
            std::optional<bool> temporalEqual = temporalObjectsDequal(obj1, obj2);
            if (temporalEqual.has_value())
                return temporalEqual;

            const bool isSymbol1 = obj1->inherits<SymbolObject>();
            const bool isBigInt1 = obj1->inherits<BigIntObject>();
            if (isSymbol1 || isBigInt1) {
                if (isSymbol1 != obj2->inherits<SymbolObject>() || isBigInt1 != obj2->inherits<BigIntObject>()) {
                    return false;
                }
                JSValue val1 = uncheckedDowncast<JSWrapperObject>(obj1)->internalValue();
                JSValue val2 = uncheckedDowncast<JSWrapperObject>(obj2)->internalValue();
                bool same = JSC::sameValue(globalObject, val1, val2);
                RETURN_IF_EXCEPTION(scope, {});
                if (!same) return false;
                // Fall through to check own properties
            }
        }
    }

    return std::nullopt;
}

// The other combinations are instantiated by their uses in this file. This one is
// only reached from `Bun.deepEquals(a, b, true, true)` in BunObject.cpp.
template bool Bun__deepEquals<true, false, false, true>(JSC::JSGlobalObject*, JSValue, JSValue, MarkedArgumentBuffer&, Vector<std::pair<JSC::JSValue, JSC::JSValue>, 16>&, ThrowScope&, bool);

/**
 * @brief `Bun.deepMatch(a, b)`
 *
 * @note
 * The sets recording already visited properties (`seenObjProperties`,
 * `seenSubsetProperties`, and `gcBuffer`) aren not needed when both
 * `enableAsymmetricMatchers` and `isMatchingObjectContaining` are true. In
 * this case, it is safe to pass a `nullptr`.
 *
 * `gcBuffer` ensures JSC's stack scan does not come up empty-handed and free
 * properties currently within those stacks. Likely unnecessary, but better to
 * be safe tnan sorry
 *
 * @tparam enableAsymmetricMatchers
 * @param objValue
 * @param seenObjProperties already visited properties of `objValue`.
 * @param subsetValue
 * @param seenSubsetProperties already visited properties of `subsetValue`.
 * @param globalObject
 * @param throwScope
 * @param gcBuffer
 * @param replacePropsWithAsymmetricMatchers
 * @param isMatchingObjectContaining
 *
 * @return true
 * @return false
 */
template<bool enableAsymmetricMatchers>
bool Bun__deepMatch(
    JSValue objValue,
    std::set<EncodedJSValue>* seenObjProperties,
    JSValue subsetValue,
    std::set<EncodedJSValue>* seenSubsetProperties,
    JSGlobalObject* globalObject,
    ThrowScope& throwScope,
    MarkedArgumentBuffer* gcBuffer,
    bool replacePropsWithAsymmetricMatchers,
    bool isMatchingObjectContaining)
{

    // Caller must ensure only objects are passed to this function.
    ASSERT(objValue.isCell());
    ASSERT(subsetValue.isCell());
    VM& vm = globalObject->vm();
    if (!vm.isSafeToRecurse()) [[unlikely]] {
        throwStackOverflowError(globalObject, throwScope);
        return false;
    }

    // fast path for reference equality.
    if (objValue == subsetValue) return true;
    JSObject* obj = objValue.getObject();
    JSObject* subsetObj = subsetValue.getObject();

    PropertyNameArrayBuilder subsetProps(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Include);
    subsetObj->getPropertyNames(globalObject, subsetProps, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(throwScope, false);

    // TODO: add fast paths for:
    // - two "simple" objects (using ->forEachProperty in both)
    // - two "simple" arrays
    // similar to what is done in deepEquals (canPerformFastPropertyEnumerationForIterationBun)

    // arrays should match exactly
    bool objIsArray = isArray(globalObject, objValue);
    RETURN_IF_EXCEPTION(throwScope, false);
    bool subsetIsArray = objIsArray && isArray(globalObject, subsetValue);
    RETURN_IF_EXCEPTION(throwScope, false);
    if (subsetIsArray) {
        if (obj->getArrayLength() != subsetObj->getArrayLength()) {
            return false;
        }
        PropertyNameArrayBuilder objProps(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Include);
        obj->getPropertyNames(globalObject, objProps, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(throwScope, false);
        if (objProps.size() != subsetProps.size()) {
            return false;
        }
    }

    for (const auto& property : subsetProps) {
        JSValue prop = obj->getIfPropertyExists(globalObject, property);
        RETURN_IF_EXCEPTION(throwScope, false);
        if (prop.isEmpty()) {
            return false;
        }

        JSValue subsetProp = subsetObj->get(globalObject, property);
        RETURN_IF_EXCEPTION(throwScope, false);

        JSCell* subsetPropCell = !subsetProp.isEmpty() && subsetProp.isCell() ? subsetProp.asCell() : nullptr;
        JSCell* propCell = prop.isCell() ? prop.asCell() : nullptr;

        if constexpr (enableAsymmetricMatchers) {
            if (subsetPropCell && subsetPropCell->type() == JSC::JSType(JSDOMWrapperType)) {
                switch (matchAsymmetricMatcher(globalObject, subsetProp, prop, throwScope)) {
                case AsymmetricMatcherResult::FAIL:
                    return false;
                case AsymmetricMatcherResult::PASS:
                    if (replacePropsWithAsymmetricMatchers) {
                        obj->putDirectMayBeIndex(globalObject, property, subsetProp);
                        RETURN_IF_EXCEPTION(throwScope, false);
                    }
                    // continue to next subset prop
                    continue;
                case AsymmetricMatcherResult::NOT_MATCHER:
                    break;
                }
            } else if (propCell && propCell->type() == JSC::JSType(JSDOMWrapperType)) {
                switch (matchAsymmetricMatcher(globalObject, prop, subsetProp, throwScope)) {
                case AsymmetricMatcherResult::FAIL:
                    return false;
                case AsymmetricMatcherResult::PASS:
                    if (replacePropsWithAsymmetricMatchers) {
                        subsetObj->putDirectMayBeIndex(globalObject, property, prop);
                        RETURN_IF_EXCEPTION(throwScope, false);
                    }
                    // continue to next subset prop
                    continue;
                case AsymmetricMatcherResult::NOT_MATCHER:
                    break;
                }
            }
        }

        if (subsetProp.isObject() and prop.isObject()) {
            // if this is called from inside an objectContaining asymmetric matcher, it should behave slightly differently:
            // in such case, it expects exhaustive matching of any nested object properties, not just a subset,
            // and the user would need to opt-in to subset matching by using another nested objectContaining matcher
            if (enableAsymmetricMatchers && isMatchingObjectContaining) {
                Vector<std::pair<JSValue, JSValue>, 16> stack;
                MarkedArgumentBuffer gcBuffer;
                auto eql = Bun__deepEquals<false, true, false>(globalObject, prop, subsetProp, gcBuffer, stack, throwScope, true);
                RETURN_IF_EXCEPTION(throwScope, false);
                if (!eql) return false;
            } else {
                ASSERT(seenObjProperties != nullptr);
                ASSERT(seenSubsetProperties != nullptr);
                ASSERT(gcBuffer != nullptr);
                auto didInsertProp = seenObjProperties->insert(JSC::JSValue::encode(prop));
                auto didInsertSubset = seenSubsetProperties->insert(JSC::JSValue::encode(subsetProp));
                gcBuffer->append(prop);
                gcBuffer->append(subsetProp);
                // property cycle detected
                if (!didInsertProp.second || !didInsertSubset.second) continue;
                bool matched = Bun__deepMatch<enableAsymmetricMatchers>(prop, seenObjProperties, subsetProp, seenSubsetProperties, globalObject, throwScope, gcBuffer, replacePropsWithAsymmetricMatchers, isMatchingObjectContaining);
                RETURN_IF_EXCEPTION(throwScope, false);
                if (!matched) return false;
            }
        } else {
            auto same = JSC::sameValue(globalObject, prop, subsetProp);
            RETURN_IF_EXCEPTION(throwScope, false);
            if (!same) return false;
        }
    }

    return true;
}

// anonymous namespace to avoid name collision
namespace {
template<bool isStrict, bool enableAsymmetricMatchers, bool checkPrototypes, bool skipPrototypeIdentity = false>
inline bool deepEqualsWrapperImpl(JSC::EncodedJSValue a, JSC::EncodedJSValue b, JSC::JSGlobalObject* global)
{
    auto& vm = global->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Vector<std::pair<JSC::JSValue, JSC::JSValue>, 16> stack;
    MarkedArgumentBuffer args;
    bool result = Bun__deepEquals<isStrict, enableAsymmetricMatchers, checkPrototypes, skipPrototypeIdentity>(global, JSC::JSValue::decode(a), JSC::JSValue::decode(b), args, stack, scope, true);
    RELEASE_AND_RETURN(scope, result);
}
}

extern "C" {

bool WebCore__FetchHeaders__isEmpty(WebCore::FetchHeaders* arg0)
{
    return arg0->size() == 0;
}

WebCore::FetchHeaders* WebCore__FetchHeaders__createEmpty()
{
    auto* headers = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
    return headers;
}
WebCore::FetchHeaders* WebCore__FetchHeaders__cast_(JSC::EncodedJSValue JSValue0, JSC::VM* vm)
{
    return WebCoreCast<WebCore::JSFetchHeaders, WebCore::FetchHeaders>(JSValue0);
}

WebCore::FetchHeaders* WebCore__FetchHeaders__createFromJS(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue argument0_)
{
    EnsureStillAliveScope argument0 = JSC::JSValue::decode(argument0_);

    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
    throwScope.assertNoException();

    // Note that we use IDLDOMString here rather than IDLByteString: while headers
    //  should be ASCII only, we want the headers->fill implementation to discover
    //  and error on invalid names and values
    using TargetType = IDLUnion<IDLSequence<IDLSequence<IDLDOMString>>, IDLRecord<IDLDOMString, IDLDOMString>>;
    using Converter = std::optional<Converter<TargetType>::ReturnType>;

    auto init = argument0.value().isUndefined() ? Converter() : Converter(convert<TargetType>(*lexicalGlobalObject, argument0.value()));
    RETURN_IF_EXCEPTION(throwScope, nullptr);

    // if the headers are empty, return null
    if (!init) {
        return nullptr;
    }

    // [["", ""]] should be considered empty and return null
    if (std::holds_alternative<Vector<Vector<String>>>(init.value())) {
        const auto& sequence = std::get<Vector<Vector<String>>>(init.value());

        if (sequence.size() == 0) {
            return nullptr;
        }
    } else {
        // {} should be considered empty and return null
        const auto& record = std::get<Vector<KeyValuePair<String, String>>>(init.value());
        if (record.size() == 0) {
            return nullptr;
        }
    }

    auto* headers = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });

    // `fill` doesn't set an exception on the VM if it fails, it returns an
    //  ExceptionOr<void>.  So we need to check for the exception and, if set,
    //  translate it to JSValue and throw it.
    WebCore::propagateException(*lexicalGlobalObject, throwScope, headers->fill(WTF::move(init.value())));

    // If there's an exception, it will be thrown by the above call to fill().
    // in that case, let's also free the headers to make memory leaks harder.
    if (throwScope.exception()) {
        headers->deref();
        return nullptr;
    }

    return headers;
}

JSC::EncodedJSValue WebCore__FetchHeaders__toJS(WebCore::FetchHeaders* headers, JSC::JSGlobalObject* lexicalGlobalObject)
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    ASSERT_NO_PENDING_EXCEPTION(globalObject);

    bool needsMemoryCost = headers->hasOneRef();

    JSValue value = WebCore::toJS(lexicalGlobalObject, globalObject, headers);

    if (needsMemoryCost) {
        JSFetchHeaders* jsHeaders = uncheckedDowncast<JSFetchHeaders>(value);
        jsHeaders->computeMemoryCost();
    }

    return JSC::JSValue::encode(value);
}

WebCore::FetchHeaders* WebCore__FetchHeaders__cloneThis(WebCore::FetchHeaders* headers, JSC::JSGlobalObject* lexicalGlobalObject)
{
    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
    auto* clone = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
    WebCore::propagateException(*lexicalGlobalObject, throwScope, clone->fill(*headers));
    return clone;
}

bool WebCore__FetchHeaders__fastHas_(WebCore::FetchHeaders* arg0, unsigned char HTTPHeaderName1)
{
    return arg0->fastHas(static_cast<HTTPHeaderName>(HTTPHeaderName1));
}

void WebCore__FetchHeaders__copyTo(WebCore::FetchHeaders* headers, StringPointer* names, StringPointer* values, unsigned char* buf)
{
    auto iter = headers->createIterator(false);
    unsigned int i = 0;

    for (auto pair = iter.next(); pair; pair = iter.next()) {
        const auto name = pair->key;
        const auto value = pair->value;

        ASSERT_WITH_MESSAGE(name.length(), "Header name must not be empty");
        ASSERT_WITH_MESSAGE(name.containsOnlyASCII(), "Header name must be ASCII. This should already be validated before calling this function.");

        if (name.is8Bit()) {
            const auto nameSpan = name.span8();
            memcpy(&buf[i], nameSpan.data(), nameSpan.size());
            *names = { i, name.length() };
            i += name.length();
        } else {
            WTF::CString nameCString = name.latin1();
            memcpy(&buf[i], nameCString.data(), nameCString.length());
            *names = { i, static_cast<uint32_t>(nameCString.length()) };
            i += static_cast<uint32_t>(nameCString.length());
        }

        if (value.length() > 0) {
            // https://fetch.spec.whatwg.org/#concept-header-value
            // Header values are ByteStrings: isomorphic-encode (1 code unit = 1 byte),
            // not UTF-8. isValidHTTPHeaderValue already rejects code units > 0xFF.
            if (value.is8Bit()) {
                const auto valueSpan = value.span8();
                memcpy(&buf[i], valueSpan.data(), valueSpan.size());
                *values = { i, value.length() };
                i += value.length();
            } else {
                WTF::CString valueCString = value.latin1();
                memcpy(&buf[i], valueCString.data(), valueCString.length());
                *values = { i, static_cast<uint32_t>(valueCString.length()) };
                i += static_cast<uint32_t>(valueCString.length());
            }
        } else {
            *values = { i, 0 };
        }

        names++;
        values++;
    }
}
void WebCore__FetchHeaders__count(WebCore::FetchHeaders* headers, uint32_t* count, uint32_t* buf_len)
{
    auto iter = headers->createIterator();
    size_t i = 0;
    for (auto pair = iter.next(); pair; pair = iter.next()) {
        // copyTo isomorphic-encodes: one byte per code unit.
        i += pair->key.length();
        i += pair->value.length();
    }

    *count = headers->size();
    *buf_len = i;
}

typedef struct ZigSliceString {
    const unsigned char* ptr;
    size_t len;
} ZigSliceString;

typedef struct PicoHTTPHeader {
    ZigSliceString name;
    ZigSliceString value;
} PicoHTTPHeader;

typedef struct PicoHTTPHeaders {
    const PicoHTTPHeader* ptr;
    size_t len;
} PicoHTTPHeaders;

WebCore::FetchHeaders* WebCore__FetchHeaders__createFromPicoHeaders_(const void* arg1)
{
    PicoHTTPHeaders pico_headers = *reinterpret_cast<const PicoHTTPHeaders*>(arg1);
    auto* headers = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });

    if (pico_headers.len > 0) {
        HTTPHeaderMap map = HTTPHeaderMap();

        size_t end = pico_headers.len;

        for (size_t j = 0; j < end; j++) {
            PicoHTTPHeader header = pico_headers.ptr[j];
            // picohttpparser reports obs-fold continuation lines with an empty
            // name; skip those. Empty *values* must flow through so duplicate
            // headers combine per the Fetch spec ("a, , c") and a lone empty
            // header is still visible to JS, matching the uWS/H3 paths.
            if (header.name.len == 0)
                continue;

            StringView nameView = StringView(std::span { reinterpret_cast<const char*>(header.name.ptr), header.name.len });

            std::span<Latin1Character> data;
            auto value = String::createUninitialized(header.value.len, data);
            if (header.value.len > 0)
                memcpy(data.data(), header.value.ptr, header.value.len);

            HTTPHeaderName name;

            // memory safety: the header names must be cloned if they're not statically known
            // the value must also be cloned
            // isolatedCopy() doesn't actually clone, it's only for threadlocal isolation
            if (WebCore::findHTTPHeaderName(nameView, name)) {
                map.add(name, value);
            } else {
                // the case where we do not need to clone the name
                // when the header name is already present in the list
                // we don't have that information here, so map.addUncommonHeaderCloneName exists
                map.addUncommonHeaderCloneName(nameView, value);
            }
        }

        headers->setInternalHeaders(WTF::move(map));
    }
    return headers;
}
WebCore::FetchHeaders* WebCore__FetchHeaders__createFromUWS(void* arg1)
{
    uWS::HttpRequest req = *reinterpret_cast<uWS::HttpRequest*>(arg1);

    auto* headers = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });

    HTTPHeaderMap map = HTTPHeaderMap();

    for (const auto& header : req) {
        StringView nameView = StringView(std::span { reinterpret_cast<const Latin1Character*>(header.first.data()), header.first.length() });
        std::span<Latin1Character> data;
        auto value = String::createUninitialized(header.second.length(), data);
        if (header.second.length() > 0)
            memcpy(data.data(), header.second.data(), header.second.length());

        HTTPHeaderName name;

        if (WebCore::findHTTPHeaderName(nameView, name)) {
            map.add(name, WTF::move(value));
        } else {
            map.addUncommonHeader(nameView.toString().isolatedCopy(), WTF::move(value));
        }
    }
    headers->setInternalHeaders(WTF::move(map));
    return headers;
}
WebCore::FetchHeaders* WebCore__FetchHeaders__createFromH3(void* arg1)
{
    auto* req = reinterpret_cast<uWS::Http3Request*>(arg1);

    auto* headers = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });

    HTTPHeaderMap map = HTTPHeaderMap();
    req->forEachHeader([&](std::string_view name, std::string_view val) {
        StringView nameView = StringView(std::span { reinterpret_cast<const Latin1Character*>(name.data()), name.length() });
        std::span<Latin1Character> data;
        auto value = String::createUninitialized(val.length(), data);
        if (val.length() > 0)
            memcpy(data.data(), val.data(), val.length());

        HTTPHeaderName hn;
        if (WebCore::findHTTPHeaderName(nameView, hn)) {
            map.add(hn, WTF::move(value));
        } else {
            map.addUncommonHeader(nameView.toString().isolatedCopy(), WTF::move(value));
        }
    });
    headers->setInternalHeaders(WTF::move(map));
    return headers;
}
void WebCore__FetchHeaders__deref(WebCore::FetchHeaders* arg0)
{
    arg0->deref();
}

WebCore::FetchHeaders* WebCore__FetchHeaders__createValueNotJS(JSC::JSGlobalObject* arg0, StringPointer* arg1, StringPointer* arg2, const EncodedSlice* arg3, uint32_t count)
{
    auto throwScope = DECLARE_THROW_SCOPE(arg0->vm());
    Vector<KeyValuePair<String, String>> pairs;
    pairs.reserveCapacity(count);
    EncodedSlice buf = *arg3;
    for (uint32_t i = 0; i < count; i++) {
        WTF::String name = Zig::toStringCopy(buf, arg1[i]);
        WTF::String value = Zig::toStringCopy(buf, arg2[i]);
        pairs.unsafeAppendWithoutCapacityCheck(KeyValuePair<String, String>(name, value));
    }

    auto* headers = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
    WebCore::propagateException(*arg0, throwScope, headers->fill(WebCore::FetchHeaders::Init(WTF::move(pairs))));
    if (throwScope.exception()) {
        headers->deref();
        return nullptr;
    }
    return headers;
}

JSC::EncodedJSValue WebCore__FetchHeaders__createValue(JSC::JSGlobalObject* arg0, StringPointer* arg1, StringPointer* arg2, const EncodedSlice* arg3, uint32_t count)
{
    auto throwScope = DECLARE_THROW_SCOPE(arg0->vm());
    Vector<KeyValuePair<String, String>> pairs;
    pairs.reserveCapacity(count);
    EncodedSlice buf = *arg3;
    for (uint32_t i = 0; i < count; i++) {
        WTF::String name = Zig::toStringCopy(buf, arg1[i]);
        WTF::String value = Zig::toStringCopy(buf, arg2[i]);
        pairs.unsafeAppendWithoutCapacityCheck(KeyValuePair<String, String>(name, value));
    }

    Ref<WebCore::FetchHeaders> headers = WebCore::FetchHeaders::create();
    WebCore::propagateException(*arg0, throwScope, headers->fill(WebCore::FetchHeaders::Init(WTF::move(pairs))));

    JSValue value = WebCore::toJSNewlyCreated(arg0, static_cast<Zig::GlobalObject*>(arg0), WTF::move(headers));

    JSFetchHeaders* fetchHeaders = uncheckedDowncast<JSFetchHeaders>(value);
    fetchHeaders->computeMemoryCost();
    return JSC::JSValue::encode(fetchHeaders);
}

void WebCore__FetchHeaders__get_(WebCore::FetchHeaders* headers, const EncodedSlice* arg1, EncodedSlice* arg2, JSC::JSGlobalObject* global)
{
    auto throwScope = DECLARE_THROW_SCOPE(global->vm());
    auto result = headers->get(Zig::toString(*arg1));
    if (result.hasException())
        WebCore::propagateException(*global, throwScope, result.releaseException());
    else
        *arg2 = Zig::toEncodedSlice(result.releaseReturnValue());
}
extern "C" void WebCore__FetchHeaders__put(WebCore::FetchHeaders* headers, HTTPHeaderName name, const BunString* arg2, JSC::JSGlobalObject* global)
{
    auto throwScope = DECLARE_THROW_SCOPE(global->vm());
    throwScope.assertNoException(); // can't throw an exception when there's already one.
    // `toWTFString()` refs a `WTFStringImpl`-tagged value instead of copying it.
    WebCore::propagateException(*global, throwScope, headers->set(name, arg2->toWTFString()));
}
void WebCore__FetchHeaders__fastRemove_(WebCore::FetchHeaders* headers, unsigned char headerName)
{
    headers->fastRemove(static_cast<WebCore::HTTPHeaderName>(headerName));
}

void WebCore__FetchHeaders__fastGet_(WebCore::FetchHeaders* headers, unsigned char headerName, EncodedSlice* arg2)
{
    auto str = headers->fastGet(static_cast<WebCore::HTTPHeaderName>(headerName));
    if (!str) {
        return;
    }

    *arg2 = Zig::toEncodedSlice(str);
}

WebCore::DOMURL* WebCore__DOMURL__cast_(JSC::EncodedJSValue JSValue0, JSC::VM* vm)
{
    return WebCoreCast<WebCore::JSDOMURL, WebCore::DOMURL>(JSValue0);
}

BunString WebCore__DOMURL__fileSystemPath(WebCore::DOMURL* arg0, int* errorCode)
{
    const WTF::URL& url = arg0->href();
    if (url.protocolIsFile()) {
#if !OS(WINDOWS)
        if (!url.host().isEmpty()) {
            *errorCode = 1;
            return BunString { BunStringTag::Dead, nullptr };
        }
#endif
        if (url.path().containsIgnoringASCIICase("%2f"_s)) {
            *errorCode = 2;
            return BunString { BunStringTag::Dead, nullptr };
        }
#if OS(WINDOWS)
        if (url.path().containsIgnoringASCIICase("%5c"_s)) {
            *errorCode = 2;
            return BunString { BunStringTag::Dead, nullptr };
        }
#endif
        return Bun::toStringRef(url.fileSystemPath());
    }
    *errorCode = 3;
    return BunString { BunStringTag::Dead, nullptr };
}

// Taken from unwrapBoxedPrimitive in JSONObject.cpp in WebKit
extern "C" JSC::EncodedJSValue JSC__JSValue__unwrapBoxedPrimitive(JSGlobalObject* globalObject, EncodedJSValue encodedValue)
{
    JSValue value = JSValue::decode(encodedValue);

    if (!value.isObject()) {
        return JSValue::encode(value);
    }

    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSObject* object = asObject(value);

    if (object->inherits<NumberObject>()) {
        double number = object->toNumber(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsNumber(number));
    }
    if (object->inherits<StringObject>()) {
        JSString* string = object->toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(string);
    }
    if (object->inherits<BooleanObject>() || object->inherits<BigIntObject>())
        return JSValue::encode(uncheckedDowncast<JSWrapperObject>(object)->internalValue());

    return JSValue::encode(object);
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue EncodedSlice__toJSONObject(const EncodedSlice* strPtr, JSC::JSGlobalObject* globalObject)
{
    ASSERT_NO_PENDING_EXCEPTION(globalObject);
    // Zig::toString() is null for an empty slice, and JSONParseWithException throws nothing for null.
    auto str = strPtr->len ? Zig::toString(*strPtr) : emptyString();
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    if (str.isNull()) {
        // isNull() will be true for strings which are too long, and when an allocation fails.
        // So we need to check the length is plausibly due to a long string.
        if (strPtr->len > Bun__stringSyntheticAllocationLimit || strPtr->len > WTF::String::MaxLength) {
            scope.throwException(globalObject, Bun::createError(globalObject, Bun::ErrorCode::ERR_STRING_TOO_LONG, "Cannot parse a JSON string longer than 2147483647 characters"_s));
            return {};
        }
    }

    JSValue result = JSONParseWithException(globalObject, str);
    RETURN_IF_EXCEPTION(scope, {});
    if (!result) {
        scope.throwException(globalObject, createSyntaxError(globalObject, "Failed to parse JSON"_s));
        return {};
    }
    return JSValue::encode(result);
}

// We used to just throw "Out of memory" as a regular Error with that string.
//
// But JSC has some different handling for out of memory errors. So we should
// make it look like what JSC does.
void JSGlobalObject__throwOutOfMemoryError(JSC::JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    throwOutOfMemoryError(globalObject, scope);
}

JSC::EncodedJSValue JSGlobalObject__createOutOfMemoryError(JSC::JSGlobalObject* globalObject)
{
    JSObject* exception = createOutOfMemoryError(globalObject);
    return JSValue::encode(exception);
}

static JSC::EncodedJSValue systemErrorToErrorInstance(const SystemError* arg0, JSC::JSGlobalObject* globalObject, JSC::ErrorType errorType)
{
    SystemError err = *arg0;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    WTF::String message = WTF::emptyString();
    if (err.message.tag != BunStringTag::Empty) {
        message = err.message.toWTFString();
    }

    auto& names = WebCore::builtinNames(vm);

    JSC::JSObject* result = createError(globalObject, errorType, message);

    auto clientData = WebCore::clientData(vm);

    if (err.code.tag != BunStringTag::Empty) {
        JSC::JSValue code = Bun::toJS(globalObject, err.code);
        if (scope.exception()) {
            scope.clearException();
        } else {
            result->putDirect(vm, clientData->builtinNames().codePublicName(), code, JSC::PropertyAttribute::DontDelete | 0);
        }
    }

    if (err.path.tag != BunStringTag::Empty) {
        JSC::JSValue path = Bun::toJS(globalObject, err.path);
        if (scope.exception()) {
            scope.clearException();
        } else {
            result->putDirect(vm, clientData->builtinNames().pathPublicName(), path, JSC::PropertyAttribute::DontDelete | 0);
        }
    }

    if (err.dest.tag != BunStringTag::Empty) {
        JSC::JSValue dest = Bun::toJS(globalObject, err.dest);
        if (scope.exception()) {
            scope.clearException();
        } else {
            result->putDirect(vm, clientData->builtinNames().destPublicName(), dest, JSC::PropertyAttribute::DontDelete | 0);
        }
    }

    if (err.fd >= 0) {
        JSC::JSValue fd = jsNumber(err.fd);
        result->putDirect(vm, names.fdPublicName(), fd, JSC::PropertyAttribute::DontDelete | 0);
    }

    if (err.syscall.tag != BunStringTag::Empty) {
        JSC::JSValue syscall = Bun::toJS(globalObject, err.syscall);
        if (scope.exception()) {
            scope.clearException();
        } else {
            result->putDirect(vm, names.syscallPublicName(), syscall, JSC::PropertyAttribute::DontDelete | 0);
        }
    }

    if (err.hostname.tag != BunStringTag::Empty) {
        JSC::JSValue hostname = Bun::toJS(globalObject, err.hostname);
        if (scope.exception()) {
            scope.clearException();
        } else {
            result->putDirect(vm, names.hostnamePublicName(), hostname, JSC::PropertyAttribute::DontDelete | 0);
        }
    }

    result->putDirect(vm, names.errnoPublicName(), jsNumber(err.errno_), JSC::PropertyAttribute::DontDelete | 0);

    return JSC::JSValue::encode(result);
}

JSC::EncodedJSValue SystemError__toErrorInstance(const SystemError* arg0, JSC::JSGlobalObject* globalObject)
{
    return systemErrorToErrorInstance(arg0, globalObject, ErrorType::Error);
}

JSC::EncodedJSValue SystemError__toTypeErrorInstance(const SystemError* arg0, JSC::JSGlobalObject* globalObject)
{
    return systemErrorToErrorInstance(arg0, globalObject, ErrorType::TypeError);
}

JSC::EncodedJSValue SystemError__toErrorInstanceWithInfoObject(const SystemError* arg0, JSC::JSGlobalObject* globalObject)
{
    SystemError err = *arg0;

    auto& vm = JSC::getVM(globalObject);

    auto codeString = err.code.toWTFString();
    auto syscallString = err.syscall.toWTFString();
    auto messageString = err.message.toWTFString();

    auto message = makeString("A system error occurred: "_s, syscallString, " returned "_s, codeString, " ("_s, messageString, ")"_s);

    JSC::JSObject* result = JSC::ErrorInstance::create(vm, JSC::ErrorInstance::createStructure(vm, globalObject, globalObject->errorPrototype()), message, {});
    JSC::JSObject* info = JSC::constructEmptyObject(globalObject);

    auto clientData = WebCore::clientData(vm);

    result->putDirect(vm, vm.propertyNames->name, jsString(vm, String("SystemError"_s)), JSC::PropertyAttribute::DontEnum | 0);
    result->putDirect(vm, clientData->builtinNames().codePublicName(), jsString(vm, String("ERR_SYSTEM_ERROR"_s)), JSC::PropertyAttribute::DontEnum | 0);

    info->putDirect(vm, clientData->builtinNames().codePublicName(), jsString(vm, codeString), JSC::PropertyAttribute::DontDelete | 0);

    result->putDirect(vm, JSC::Identifier::fromString(vm, "info"_s), info, JSC::PropertyAttribute::DontDelete | 0);

    auto syscallJsString = jsString(vm, syscallString);
    result->putDirect(vm, clientData->builtinNames().syscallPublicName(), syscallJsString, JSC::PropertyAttribute::DontDelete | 0);
    info->putDirect(vm, clientData->builtinNames().syscallPublicName(), syscallJsString, JSC::PropertyAttribute::DontDelete | 0);

    info->putDirect(vm, clientData->builtinNames().codePublicName(), jsString(vm, codeString), JSC::PropertyAttribute::DontDelete | 0);
    info->putDirect(vm, vm.propertyNames->message, jsString(vm, messageString), JSC::PropertyAttribute::DontDelete | 0);

    info->putDirect(vm, clientData->builtinNames().errnoPublicName(), jsNumber(err.errno_), JSC::PropertyAttribute::DontDelete | 0);
    result->putDirect(vm, clientData->builtinNames().errnoPublicName(), jsNumber(err.errno_), JSC::PropertyAttribute::DontDelete | 0);

    return JSC::JSValue::encode(result);
}

JSC::EncodedJSValue
JSC__JSObject__create(JSC::JSGlobalObject* globalObject, size_t initialCapacity, void* arg2,
    void (*ArgFn3)(void* arg0, JSC::JSObject* arg1, JSC::JSGlobalObject* arg2))
{
    JSC::JSObject* object = initialCapacity
        ? JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), static_cast<unsigned>(std::min(initialCapacity, static_cast<size_t>(JSFinalObject::maxInlineCapacity))))
        : JSC::constructEmptyObject(globalObject);

    ArgFn3(arg2, object, globalObject);

    return JSC::JSValue::encode(object);
}

bool JSC__JSValue__hasOwnPropertyValue(JSC::EncodedJSValue value, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue ownKey)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* object = uncheckedDowncast<JSC::JSObject>(JSC::JSValue::decode(value));
    auto propertyKey = JSC::JSValue::decode(ownKey).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    const bool result = JSC::objectPrototypeHasOwnProperty(globalObject, object, propertyKey);
    RETURN_IF_EXCEPTION(scope, {});

    return result;
}

JSC::EncodedJSValue JSC__JSValue__createEmptyObjectWithNullPrototype(JSC::JSGlobalObject* globalObject)
{
    return JSValue::encode(
        JSC::constructEmptyObject(globalObject->vm(), globalObject->nullPrototypeObjectStructure()));
}

JSC::EncodedJSValue JSC__JSValue__createEmptyObject(JSC::JSGlobalObject* globalObject,
    size_t initialCapacity)
{
    // 0 means "unsized", not "zero inline slots": JSC's spread fast path
    // (tryCreateObjectViaCloning) asserts hasInlineStorage() on the source.
    if (!initialCapacity)
        return JSC::JSValue::encode(JSC::constructEmptyObject(globalObject));
    return JSC::JSValue::encode(
        JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), static_cast<unsigned>(std::min(initialCapacity, static_cast<size_t>(JSFinalObject::maxInlineCapacity)))));
}

extern "C" uint64_t Bun__Blob__getSizeForBindings(void* blob);

double JSC__JSValue__getLengthIfPropertyExistsInternal(JSC::EncodedJSValue value, JSC::JSGlobalObject* globalObject)
{
    JSC::JSValue jsValue = JSC::JSValue::decode(value);
    if (!jsValue || !jsValue.isCell())
        return 0;
    JSCell* cell = jsValue.asCell();
    JSC::JSType type = cell->type();

    switch (static_cast<uint8_t>(type)) {
    case JSC::JSType::StringType:
        return static_cast<double>(jsValue.toString(globalObject)->length());
    case JSC::JSType::ArrayType:
        return static_cast<double>(uncheckedDowncast<JSC::JSArray>(cell)->length());

    case JSC::JSType::Int8ArrayType:
    case JSC::JSType::Uint8ArrayType:
    case JSC::JSType::Uint8ClampedArrayType:
    case JSC::JSType::Int16ArrayType:
    case JSC::JSType::Uint16ArrayType:
    case JSC::JSType::Int32ArrayType:
    case JSC::JSType::Uint32ArrayType:
    case JSC::JSType::Float16ArrayType:
    case JSC::JSType::Float32ArrayType:
    case JSC::JSType::Float64ArrayType:
    case JSC::JSType::BigInt64ArrayType:
    case JSC::JSType::BigUint64ArrayType:
        return static_cast<double>(uncheckedDowncast<JSC::JSArrayBufferView>(cell)->length());

    case JSC::JSType::JSMapType:
        return static_cast<double>(uncheckedDowncast<JSC::JSMap>(cell)->size());

    case JSC::JSType::JSSetType:
        return static_cast<double>(uncheckedDowncast<JSC::JSSet>(cell)->size());

    case JSC::JSType::JSWeakMapType:
        return static_cast<double>(uncheckedDowncast<JSC::JSWeakMap>(cell)->size());

    case JSC::JSType::ArrayBufferType: {
        auto* arrayBuffer = uncheckedDowncast<JSC::JSArrayBuffer>(cell);
        if (auto* impl = arrayBuffer->impl()) {
            return static_cast<double>(impl->byteLength());
        }

        return 0;
    }

    case JSDOMWrapperType: {
        if (dynamicDowncast<WebCore::JSFetchHeaders>(cell))
            return static_cast<double>(uncheckedDowncast<WebCore::JSFetchHeaders>(cell)->wrapped().size());

        if (auto* blob = dynamicDowncast<WebCore::JSBlob>(cell)) {
            uint64_t size = Bun__Blob__getSizeForBindings(blob->wrapped());
            if (size == std::numeric_limits<uint64_t>::max())
                return std::numeric_limits<double>::max();
            return static_cast<double>(size);
        }
    }

    default: {

        if (auto* object = dynamicDowncast<JSObject>(cell)) {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            scope.release(); // the extern-C caller checks for the pending exception
            JSValue lengthValue = object->getIfPropertyExists(globalObject, globalObject->vm().propertyNames->length);
            RETURN_IF_EXCEPTION(scope, 0);
            if (lengthValue) {
                return lengthValue.toNumber(globalObject);
            }
        }
    }
    }

    return std::numeric_limits<double>::infinity();
}

[[ZIG_EXPORT(check_slow)]]
void JSC__JSObject__putRecord(JSC::JSObject* object, JSC::JSGlobalObject* global, EncodedSlice* key, EncodedSlice* values, size_t valuesLen)
{
    auto scope = DECLARE_THROW_SCOPE(global->vm());
    auto ident = Identifier::fromString(global->vm(), Zig::toStringCopy(*key));
    JSC::PropertyDescriptor descriptor;

    descriptor.setEnumerable(1);
    descriptor.setConfigurable(1);
    descriptor.setWritable(1);

    if (valuesLen == 1) {
        descriptor.setValue(JSC::jsString(global->vm(), Zig::toStringCopy(values[0])));
    } else {

        // Pre-convert all strings to JSValues before entering ObjectInitializationScope,
        // since jsString() allocates GC cells which is not allowed inside the scope.
        MarkedArgumentBuffer strings;
        for (size_t i = 0; i < valuesLen; ++i) {
            strings.append(JSC::jsString(global->vm(), Zig::toStringCopy(values[i])));
        }

        JSC::JSArray* array = nullptr;
        {
            JSC::ObjectInitializationScope initializationScope(global->vm());
            if ((array = JSC::JSArray::tryCreateUninitializedRestricted(initializationScope, nullptr, global->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), valuesLen))) {

                for (size_t i = 0; i < valuesLen; ++i) {
                    array->initializeIndexWithoutBarrier(initializationScope, i, strings.at(i));
                }
            }
        }

        if (!array) {
            JSC::throwOutOfMemoryError(global, scope);
            return;
        }

        descriptor.setValue(array);
    }

    object->methodTable()->defineOwnProperty(object, global, ident, descriptor, true);
    object->putDirect(global->vm(), ident, descriptor.value());
    scope.release();
}

JSC::JSPromise* JSC__JSValue__asInternalPromise(JSC::EncodedJSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return dynamicDowncast<JSC::JSPromise>(value);
}

JSC::JSPromise* JSC__JSValue__asPromise(JSC::EncodedJSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return dynamicDowncast<JSC::JSPromise>(value);
}

JSC::EncodedJSValue JSC__JSValue__createInternalPromise(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    return JSC::JSValue::encode(JSC::JSPromise::create(vm, globalObject->promiseStructure()));
}

void JSC__JSFunction__optimizeSoon(JSC::EncodedJSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);

    JSC::optimizeNextInvocation(value);
}

bool JSC__JSFunction__getSourceCode(JSC::EncodedJSValue JSValue0, BunString* outSourceCode)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (JSC::JSFunction* func = dynamicDowncast<JSC::JSFunction>(value)) {
        auto* sourceCode = func->sourceCode();
        if (sourceCode != nullptr) { // native functions have no source code
            *outSourceCode = Bun::toStringRef(sourceCode->view().toString());
            return true;
        }
        return false;
    }

    return false;
}

void JSC__JSValue__jsonStringify(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, uint32_t arg2,
    BunString* arg3)
{
    ASSERT_NO_PENDING_EXCEPTION(arg1);
    auto& vm = JSC::getVM(arg1);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    WTF::String str = JSC::JSONStringify(arg1, value, (unsigned)arg2);
    RETURN_IF_EXCEPTION(scope, );
    *arg3 = Bun::toStringRef(str);
}

// Fast version of JSON.stringify that uses JSC's FastStringifier optimization.
// When space is undefined, JSC uses FastStringifier which is significantly faster
// than the general Stringifier used when space is a number (even 0).
void JSC__JSValue__jsonStringifyFast(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1,
    BunString* arg3)
{
    ASSERT_NO_PENDING_EXCEPTION(arg1);
    auto& vm = JSC::getVM(arg1);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    // Passing jsUndefined() for space triggers JSC's FastStringifier optimization
    WTF::String str = JSC::JSONStringify(arg1, value, JSC::jsUndefined());
    RETURN_IF_EXCEPTION(scope, );
    *arg3 = Bun::toStringRef(str);
}
CPP_DECL JSC::JSString* JSC__jsTypeStringForValue(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSValue jsValue = JSC::JSValue::decode(value);
    return jsTypeStringForValue(globalObject, jsValue);
}

JSC::EncodedJSValue JSC__JSPromise__asValue(JSC::JSPromise* arg0, JSC::JSGlobalObject* arg1)
{
    JSValue value = arg0;
    ASSERT_WITH_MESSAGE(!value.isEmpty(), "JSPromise.asValue() called on a empty JSValue");
    ASSERT_WITH_MESSAGE(value.inherits<JSC::JSPromise>(), "JSPromise::asValue() called on a non-promise object");
    return JSC::JSValue::encode(value);
}

JSC::JSPromise* JSC__JSPromise__create(JSC::JSGlobalObject* arg0)
{
    return JSC::JSPromise::create(arg0->vm(), arg0->promiseStructure());
}

// TODO: prevent this from allocating so much memory
void JSC__JSValue___then(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue arg2, Zig::FFIFunction ArgFn3, Zig::FFIFunction ArgFn4)
{

    auto* cell = JSC::JSValue::decode(JSValue0).asCell();

    if (JSC::JSPromise* promise = dynamicDowncast<JSC::JSPromise>(cell)) {
        handlePromise<JSC::JSPromise, false>(promise, arg1, arg2, ArgFn3, ArgFn4);
    }
}

void JSC__JSGlobalObject__deleteModuleRegistryEntry(JSC::JSGlobalObject* global, const EncodedSlice* arg1)
{
    const JSC::Identifier identifier = Zig::toIdentifier(*arg1, global);
    auto* moduleLoader = global->moduleLoader();
    // JSModuleLoader::visitChildrenImpl iterates these maps on the GC thread
    // under cellLock(); take the same lock so the removal can't race it.
    WTF::Locker locker { moduleLoader->cellLock() };
    moduleLoader->removeEntry(identifier);
}

void JSC__VM__collectAsync(JSC::VM* vm, bool full)
{
    JSC::JSLockHolder lock(*vm);
    if (full)
        vm->heap.collectAsync(JSC::CollectionScope::Full);
    else
        vm->heap.collectAsync();
}

// The full collection GarbageCollectionController requests because the heap has gone quiet: tagged so JSC may let idle
// optimized code age out in it (GCRequest::isIdle), which it never does in a collection the program forces or allocation paces.
void JSC__VM__collectAsyncIdle(JSC::VM* vm)
{
    JSC::JSLockHolder lock(*vm);
    JSC::GCRequest request(JSC::CollectionScope::Full);
    request.isIdle = true;
    vm->heap.collectAsync(request);
}

size_t JSC__VM__heapSize(JSC::VM* arg0)
{
    return arg0->heap.size();
}

bool JSC__JSValue__isStrictEqual(JSC::EncodedJSValue l, JSC::EncodedJSValue r, JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    RELEASE_AND_RETURN(scope, JSC::JSValue::strictEqual(globalObject, JSC::JSValue::decode(l), JSC::JSValue::decode(r)));
}

bool JSC__JSValue__isSameValue(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1,
    JSC::JSGlobalObject* globalObject)
{
    JSC::JSValue left = JSC::JSValue::decode(JSValue0);
    JSC::JSValue right = JSC::JSValue::decode(JSValue1);
    return JSC::sameValue(globalObject, left, right);
}

bool JSC__JSValue__deepEquals(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* globalObject)
{
    return deepEqualsWrapperImpl<false, false, false>(JSValue0, JSValue1, globalObject);
}

bool JSC__JSValue__jestDeepEquals(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* globalObject)
{
    return deepEqualsWrapperImpl<false, true, false>(JSValue0, JSValue1, globalObject);
}

bool JSC__JSValue__strictDeepEquals(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* globalObject)
{
    return deepEqualsWrapperImpl<true, false, false>(JSValue0, JSValue1, globalObject);
}

bool JSC__JSValue__jestStrictDeepEquals(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* globalObject)
{
    return deepEqualsWrapperImpl<true, true, false>(JSValue0, JSValue1, globalObject);
}

// node:assert deepStrictEqual / node:util.isDeepStrictEqual: strict deepEquals
// plus node's [[Prototype]] identity rule (Bun.deepEquals stays prototype-blind).
bool Bun__deepEqualsNodeStrict(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* globalObject)
{
    return deepEqualsWrapperImpl<true, false, true>(JSValue0, JSValue1, globalObject);
}

// node:assert deepStrictEqual with the Assert class skipPrototype option:
// node semantics, but the [[Prototype]] identity check is skipped.
bool Bun__deepEqualsNodeStrictSkipProto(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* globalObject)
{
    return deepEqualsWrapperImpl<true, false, true, true>(JSValue0, JSValue1, globalObject);
}

#undef IMPL_DEEP_EQUALS_WRAPPER

bool JSC__JSValue__jestDeepMatch(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* globalObject, bool replacePropsWithAsymmetricMatchers)
{
    JSValue obj = JSValue::decode(JSValue0);
    JSValue subset = JSValue::decode(JSValue1);

    ThrowScope scope = DECLARE_THROW_SCOPE(globalObject->vm());

    std::set<EncodedJSValue> objVisited;
    std::set<EncodedJSValue> subsetVisited;
    MarkedArgumentBuffer gcBuffer;
    RELEASE_AND_RETURN(scope, Bun__deepMatch<true>(obj, &objVisited, subset, &subsetVisited, globalObject, scope, &gcBuffer, replacePropsWithAsymmetricMatchers, false));
}

extern "C" bool Bun__JSValue__isAsyncContextFrame(JSC::EncodedJSValue value)
{
    return dynamicDowncast<AsyncContextFrame>(JSValue::decode(value)) != nullptr;
}

extern "C" JSC::EncodedJSValue Bun__JSValue__call(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue object,
    JSC::EncodedJSValue thisObject, size_t argumentCount,
    const JSC::EncodedJSValue* arguments)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    ASSERT_WITH_MESSAGE(!vm.isCollectorBusyOnCurrentThread(), "Cannot call function inside a finalizer or while GC is running on same thread.");

    // The native→JS boundary for the Rust side (Node: InternalMakeCallback's can_call_into_js;
    // WebCore: JSEventListener's isJSExecutionForbidden): once the VM's stop was requested or
    // teardown has forbidden script, a callback from any event source is a silent no-op rather
    // than each source checking.
    if (WebCore::clientData(vm)->isStoppingOrStopped(vm)) [[unlikely]] {
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(jsUndefined());
    }

    JSC::JSValue jsObject = JSValue::decode(object);
    ASSERT_WITH_MESSAGE(jsObject, "Cannot call function with JSValue zero.");

    JSC::JSValue jsThisObject = JSValue::decode(thisObject);

    JSValue restoreAsyncContext;
    InternalFieldTuple* asyncContextData = nullptr;
    if (auto* wrapper = dynamicDowncast<AsyncContextFrame>(jsObject)) {
        jsObject = wrapper->callback.get();
        asyncContextData = globalObject->m_asyncContextData.get();
        restoreAsyncContext = asyncContextData->getInternalField(0);
        asyncContextData->putInternalField(vm, 0, wrapper->context.get());
    }

    if (!jsThisObject)
        jsThisObject = globalObject->globalThis();

    JSC::MarkedArgumentBuffer argList;
    argList.ensureCapacity(argumentCount);
    for (size_t i = 0; i < argumentCount; i++) {

#if ASSERT_ENABLED
        ASSERT_WITH_MESSAGE(!JSValue::decode(arguments[i]).isEmpty(), "arguments[%lu] is JSValue.zero. This will cause a crash.", i);
        if (JSC::JSValue::decode(arguments[i]).isCell()) {
            JSC::Integrity::auditCellFully(vm, JSC::JSValue::decode(arguments[i]).asCell());
        }
#endif
        argList.append(JSC::JSValue::decode(arguments[i]));
    }

#if ASSERT_ENABLED
    if (jsObject.isCell())
        JSC::Integrity::auditCellFully(vm, jsObject.asCell());
#endif

    auto callData = getCallData(jsObject);

    if (callData.type == JSC::CallData::Type::None) [[unlikely]] {
        if (asyncContextData)
            asyncContextData->putInternalField(vm, 0, restoreAsyncContext);
        throwException(globalObject, scope, createNotAFunctionError(globalObject, jsObject));
        return {};
    }

    auto result = JSC::profiledCall(globalObject, ProfilingReason::API, jsObject, callData, jsThisObject, argList);

    if (asyncContextData) {
        asyncContextData->putInternalField(vm, 0, restoreAsyncContext);
    }

    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(result);
}

// CPP_DECL size_t JSC__PropertyNameArray__length(JSC__PropertyNameArray* arg0);
// CPP_DECL const JSC__PropertyName*
// JSC__PropertyNameArray__next(JSC__PropertyNameArray* arg0, size_t arg1);
// CPP_DECL void JSC__PropertyNameArray__release(JSC__PropertyNameArray* arg0);
size_t JSC__JSObject__getArrayLength(JSC::JSObject* arg0) { return arg0->getArrayLength(); }

JSC::EncodedJSValue JSC__JSObject__getIndex(JSC::EncodedJSValue jsValue, JSC::JSGlobalObject* globalObject,
    uint32_t index)
{
    ASSERT_NO_PENDING_EXCEPTION(globalObject);
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    auto* object = JSC::JSValue::decode(jsValue).toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto value = object->getIndex(globalObject, index);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(value);
}

JSC::EncodedJSValue JSC__JSValue__getDirectIndex(JSC::EncodedJSValue jsValue, JSC::JSGlobalObject* arg1,
    uint32_t arg3)
{
    JSC::JSObject* object = JSC::JSValue::decode(jsValue).getObject();
    return JSC::JSValue::encode(object->getDirectIndex(arg1, arg3));
}

#pragma mark - JSC::JSCell

JSC::JSObject* JSC__JSCell__getObject(JSC::JSCell* arg0)
{
    return arg0->getObject();
}
unsigned char JSC__JSCell__getType(JSC::JSCell* arg0) { return arg0->type(); }

JSC::JSObject* JSC__JSCell__toObject(JSC::JSCell* cell, JSC::JSGlobalObject* globalObject)
{
    return cell->toObject(globalObject);
}

#pragma mark - JSC::JSString

// Throws (and returns empty) when resolving a rope runs out of memory.
// `JSString::view`: a substring rope is viewed in place; other ropes resolve
// (and can throw on OOM). The characters belong to `str` (or its base), which
// the caller keeps alive.
BunString JSC__JSString__view(JSC::JSString* str, JSC::JSGlobalObject* global)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(global));
    auto view = str->view(global);
    RETURN_IF_EXCEPTION(scope, BunStringEmpty);
    return Bun::toStringView(view.data);
}

bool JSC__JSString__is8Bit(const JSC::JSString* arg0) { return arg0->is8Bit(); };
size_t JSC__JSString__length(const JSC::JSString* arg0) { return arg0->length(); }

JSC::JSObject* JSC__JSString__toObject(JSC::JSString* arg0, JSC::JSGlobalObject* arg1)
{
    return arg0->toObject(arg1);
}

#pragma mark - JSC::JSModuleLoader

// JSC::EncodedJSValue
// JSC__JSModuleLoader__dependencyKeysIfEvaluated(JSC__JSModuleLoader* arg0,
// JSC::JSGlobalObject* arg1, JSC__JSModuleRecord* arg2) {
//     arg2->depen
// }
extern "C" JSC::JSPromise* JSModuleLoader__import(JSC::JSGlobalObject* globalObject, const BunString* moduleNameStr)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* promise = JSC::importModule(globalObject, JSC::Identifier::fromString(vm, moduleNameStr->toWTFString()), JSC::Identifier(), nullptr, nullptr);

    EXCEPTION_ASSERT(!!scope.exception() == !promise);
    return promise;
}

JSC::EncodedJSValue JSC__JSModuleLoader__evaluate(JSC::JSGlobalObject* globalObject, const unsigned char* arg1,
    size_t arg2, const unsigned char* originUrlPtr, size_t originURLLen, const unsigned char* referrerUrlPtr, size_t referrerUrlLen,
    JSC::EncodedJSValue JSValue5, JSC::EncodedJSValue* arg6)
{
    WTF::String src = WTF::String::fromUTF8(std::span { arg1, arg2 }).isolatedCopy();
    WTF::URL origin = WTF::URL::fileURLWithFileSystemPath(WTF::String::fromUTF8(std::span { originUrlPtr, originURLLen })).isolatedCopy();
    WTF::URL referrer = WTF::URL::fileURLWithFileSystemPath(WTF::String::fromUTF8(std::span { referrerUrlPtr, referrerUrlLen })).isolatedCopy();

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::SourceCode sourceCode = JSC::makeSource(
        src, JSC::SourceOrigin { origin }, JSC::SourceTaintedOrigin::Untainted, origin.fileSystemPath(),
        WTF::TextPosition(), JSC::SourceProviderSourceType::Module);
    globalObject->moduleLoader()->provideFetch(globalObject, JSC::Identifier::fromString(vm, origin.fileSystemPath()), JSC::ScriptFetchParameters::Type::JavaScript, WTF::move(sourceCode));
    RETURN_IF_EXCEPTION(scope, {});
    auto* promise = JSC::importModule(globalObject, JSC::Identifier::fromString(vm, origin.fileSystemPath()), JSC::Identifier::fromString(vm, referrer.fileSystemPath()), nullptr, nullptr);

    if (scope.exception()) [[unlikely]] {
        promise->rejectWithCaughtException(vm, scope);
    }

    auto status = promise->status();

    if (status == JSC::JSPromise::Status::Fulfilled) {
        return JSC::JSValue::encode(promise->result());
    } else if (status == JSC::JSPromise::Status::Rejected) {
        *arg6 = JSC::JSValue::encode(promise->result());
        return JSC::JSValue::encode(JSC::jsUndefined());
    } else {
        return JSC::JSValue::encode(promise);
    }
}

JSC::EncodedJSValue JSC__JSValue__fromEntries(JSC::JSGlobalObject* globalObject, EncodedSlice* keys,
    EncodedSlice* values, size_t initialCapacity, bool clone)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (initialCapacity == 0) {
        return JSC::JSValue::encode(JSC::constructEmptyObject(globalObject));
    }

    JSC::JSObject* object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), std::min(static_cast<unsigned int>(initialCapacity), JSFinalObject::maxInlineCapacity));
    RETURN_IF_EXCEPTION(scope, {});

    if (!clone) {
        for (size_t i = 0; i < initialCapacity; ++i) {
            object->putDirect(
                vm, JSC::PropertyName(JSC::Identifier::fromString(vm, Zig::toString(keys[i]))),
                Zig::toJSStringGC(values[i], globalObject), 0);
        }
    } else {
        for (size_t i = 0; i < initialCapacity; ++i) {
            object->putDirect(vm, JSC::PropertyName(Zig::toIdentifier(keys[i], globalObject)),
                Zig::toJSStringGC(values[i], globalObject), 0);
        }
    }

    return JSC::JSValue::encode(object);
}

JSC::EncodedJSValue JSC__JSValue__keys(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue objectValue)
{
    auto& vm = JSC::getVM(globalObject);

    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSObject* object = JSC::JSValue::decode(objectValue).toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    RELEASE_AND_RETURN(scope, JSValue::encode(ownPropertyKeys(globalObject, object, PropertyNameMode::Strings, DontEnumPropertiesMode::Exclude)));
}

JSC::EncodedJSValue JSC__JSValue__values(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue objectValue)
{
    auto& vm = JSC::getVM(globalObject);
    JSValue value = JSValue::decode(objectValue);

    return JSValue::encode(JSC::objectValues(vm, globalObject, value));
}

bool JSC__JSValue__asArrayBuffer(
    JSC::EncodedJSValue encodedValue,
    JSC::JSGlobalObject* globalObject,
    Bun__ArrayBuffer* out)
{
    ASSERT_NO_PENDING_EXCEPTION(globalObject);
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (!value || !value.isCell()) [[unlikely]] {
        return false;
    }

    auto type = value.asCell()->type();
    void* data = nullptr;

    switch (type) {
    case JSC::JSType::Uint8ArrayType:
    case JSC::JSType::Int8ArrayType:
    case JSC::JSType::DataViewType:
    case JSC::JSType::Uint8ClampedArrayType:
    case JSC::JSType::Int16ArrayType:
    case JSC::JSType::Uint16ArrayType:
    case JSC::JSType::Int32ArrayType:
    case JSC::JSType::Uint32ArrayType:
    case JSC::JSType::Float16ArrayType:
    case JSC::JSType::Float32ArrayType:
    case JSC::JSType::Float64ArrayType:
    case JSC::JSType::BigInt64ArrayType:
    case JSC::JSType::BigUint64ArrayType: {
        JSC::JSArrayBufferView* view = uncheckedDowncast<JSC::JSArrayBufferView>(value);
        data = view->vector();
        out->len = view->length();
        out->byte_len = view->byteLength();
        out->cell_type = type;
        out->shared = view->isShared();
        out->resizable = view->isResizableOrGrowableShared();
        break;
    }
    case JSC::JSType::ArrayBufferType: {
        JSC::ArrayBuffer* buffer = uncheckedDowncast<JSC::JSArrayBuffer>(value)->impl();
        data = buffer->data();
        out->len = buffer->byteLength();
        out->byte_len = buffer->byteLength();
        out->cell_type = JSC::JSType::ArrayBufferType;
        out->shared = buffer->isShared();
        out->resizable = buffer->isResizableOrGrowableShared();
        break;
    }
    case JSC::JSType::ObjectType:
    case JSC::JSType::FinalObjectType: {
        if (JSC::JSArrayBufferView* view = dynamicDowncast<JSC::JSArrayBufferView>(value)) {
            data = view->vector();
            out->len = view->length();
            out->byte_len = view->byteLength();
            out->cell_type = view->type();
            out->shared = view->isShared();
            out->resizable = view->isResizableOrGrowableShared();
        } else if (JSC::JSArrayBuffer* jsBuffer = dynamicDowncast<JSC::JSArrayBuffer>(value)) {
            JSC::ArrayBuffer* buffer = jsBuffer->impl();
            if (!buffer)
                return false;
            data = buffer->data();
            out->len = buffer->byteLength();
            out->byte_len = buffer->byteLength();
            out->cell_type = JSC::JSType::ArrayBufferType;
            out->shared = buffer->isShared();
            out->resizable = buffer->isResizableOrGrowableShared();
        } else {
            return false;
        }
        break;
    }
    default: {
        return false;
    }
    }
    out->_value = JSValue::encode(value);
    out->ptr = static_cast<char*>(data);
    out->pinned = false;
    return true;
}

// Pin/unpin the storage behind a JSArrayBuffer or JSArrayBufferView so it
// cannot move or be freed while a native borrower holds a slice into it.
// SharedArrayBuffer is never detachable and never moves, so it is left
// unpinned rather than rejected. Returns false if `value` has no storage.
//
// A pin does not make detaching fail, it makes it copy. `pin()` clears
// `ArrayBuffer::isDetachable()`, and `ArrayBuffer::transferTo()` answers an
// undetachable buffer by copying the bytes into the destination and reporting
// success (`if (!isDetachable()) m_contents.copyTo(result)`). So while a borrow
// is live, `ab.transfer()`, `structuredClone(v, { transfer: [ab] })` and
// `port.postMessage(v, [ab])` each return normally, give the destination an
// independent copy, and leave `ab` attached; the bytes being read never move.
//
// A view with no ArrayBuffer yet (`Buffer.allocUnsafeSlow`, `new Uint8Array(n)`
// past fastSizeLimit: OversizeTypedArray) is held, not adopted: materializing
// an ArrayBuffer just to pin it registers the bytes with the heap a second
// time and, because ArrayBuffers are only reclaimed by full collections,
// turns every threadpool fs/zlib/crypto op over a fresh Buffer into full-GC
// pressure. Such a view cannot be detached without JS first touching
// `.buffer`; if it does so mid-op the new ArrayBuffer is unpinned and a
// `transfer()` moves (does not free) the storage — the same window Node has.
// The caller keeps the returned kind and only calls unpin for `Pinned`; a
// held view is kept alive by the caller's own root, and nothing here needs
// undoing for it.
enum class PinKind : uint8_t { None = 0,
    Pinned = 1,
    Held = 2 };
static PinKind pinStorage(JSC::JSValue value)
{
    JSC::ArrayBuffer* buf = nullptr;
    if (auto* jb = dynamicDowncast<JSC::JSArrayBuffer>(value))
        buf = jb->impl();
    else if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(value)) {
        if (view->isDetached())
            return PinKind::None;
        if (!view->hasArrayBuffer() && view->mode() == JSC::OversizeTypedArray)
            return PinKind::Held;
        buf = view->possiblySharedBuffer();
    }
    if (!buf)
        return PinKind::None;
    if (!buf->isShared())
        buf->pin();
    return PinKind::Pinned;
}
CPP_DECL uint8_t JSC__JSValue__pinArrayBuffer(JSC::EncodedJSValue v)
{
    return static_cast<uint8_t>(pinStorage(JSC::JSValue::decode(v)));
}
// Only for a value `pinStorage` answered `Pinned` for: that buffer still exists (pinned buffers are not detached).
CPP_DECL void JSC__JSValue__unpinArrayBuffer(JSC::EncodedJSValue v)
{
    auto value = JSC::JSValue::decode(v);
    JSC::ArrayBuffer* buf = nullptr;
    if (auto* jb = dynamicDowncast<JSC::JSArrayBuffer>(value))
        buf = jb->impl();
    else if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(value); view && view->hasArrayBuffer())
        buf = view->possiblySharedBuffer();
    if (buf && !buf->isShared())
        buf->unpin();
}

// Borrow `v`'s byte storage for off-thread reading. Splits out only the
// `FastTypedArray` case from `pinArrayBuffer`, because that's the one mode
// where `possiblySharedBuffer()` actually COPIES data
// (`ArrayBuffer::tryCreate(span())`) — and it's ≤ fastSizeLimit elements, so
// the caller dupes instead. Every other mode goes through `pinStorage` (pin an
// existing ArrayBuffer, hold an OversizeTypedArray without adopting it).
//
//   0  Detached/null — nothing to read.
//   1  Caller should dupe `out_ptr[0..out_len]`; no unpin. Either a
//      `FastTypedArray` (≤ fastSizeLimit elements, GC-movable) or storage a
//      pin cannot hold in place (see `pinCannotHold`).
//   2  Pinned an existing ArrayBuffer; caller MUST `unpinArrayBuffer(v)`
//      when done.
//   3  Held: a bufferless OversizeTypedArray; nothing to unpin, caller roots
//      the value for the duration as it already does for 2.
//
// `out_ptr`/`out_len` describe the VIEW's byte range (offset+length).
//
// A pin only stops a detach and a GC move. It does NOT hold in place the
// storage of a non-shared `WebAssembly.Memory` (its pages belong to the
// memory, which `memory.grow()` reallocates and the memory's own lifetime
// frees) nor a resizable non-shared ArrayBuffer (`resize()` maps trimmed
// pages out). Those must be copied by the caller rather than pinned, so they
// are reported as mode 1.
static bool pinCannotHold(JSC::ArrayBuffer* buf)
{
    return !buf->isShared() && (buf->isWasmMemory() || buf->isResizableNonShared());
}
CPP_DECL int32_t JSC__JSValue__borrowBytesForOffThread(JSC::EncodedJSValue v, const uint8_t** out_ptr, size_t* out_len)
{
    auto value = JSC::JSValue::decode(v);
    if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(value)) {
        if (view->isDetached()) return 0;
        if (view->mode() == JSC::FastTypedArray) {
            *out_ptr = static_cast<const uint8_t*>(view->vector());
            *out_len = view->byteLength();
            return 1;
        }
        // Wasm-memory / resizable storage always lives in a real ArrayBuffer,
        // so a bufferless Oversize view (Held below) can never be one.
        if (view->hasArrayBuffer()) {
            auto* buf = view->possiblySharedBuffer();
            if (!buf) return 0;
            if (pinCannotHold(buf)) {
                *out_ptr = static_cast<const uint8_t*>(view->vector());
                *out_len = view->byteLength();
                return 1;
            }
        }
        auto kind = pinStorage(view);
        if (kind == PinKind::None) return 0;
        *out_ptr = static_cast<const uint8_t*>(view->vector());
        *out_len = view->byteLength();
        return kind == PinKind::Held ? 3 : 2;
    }
    if (auto* jb = dynamicDowncast<JSC::JSArrayBuffer>(value)) {
        auto* buf = jb->impl();
        if (!buf || buf->isDetached()) return 0;
        *out_ptr = static_cast<const uint8_t*>(buf->data());
        *out_len = buf->byteLength();
        if (pinCannotHold(buf))
            return 1;
        if (!buf->isShared())
            buf->pin();
        return 2;
    }
    return 0;
}

CPP_DECL JSC::EncodedJSValue JSC__JSValue__createEmptyArray(JSC::JSGlobalObject* arg0, size_t length)
{
    return JSC::JSValue::encode(JSC::constructEmptyArray(arg0, nullptr, length));
}
CPP_DECL void JSC__JSValue__putIndex(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, uint32_t arg2, JSC::EncodedJSValue JSValue3)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    JSC::JSValue value2 = JSC::JSValue::decode(JSValue3);
    asObject(value)->putDirectIndex(arg1, arg2, value2);
}

CPP_DECL void JSC__JSValue__push(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue3)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    JSC::JSValue value2 = JSC::JSValue::decode(JSValue3);
    JSC::JSArray* array = uncheckedDowncast<JSC::JSArray>(value);
    array->push(arg1, value2);
}

JSC::EncodedJSValue JSC__JSGlobalObject__createAggregateError(JSC::JSGlobalObject* globalObject,
    const JSValue* errors, size_t errors_count,
    const BunString* arg3)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    WTF::String message = arg3->toWTFString();
    JSC::JSValue cause = JSC::jsUndefined();
    JSC::JSArray* array = nullptr;
    {
        JSC::ObjectInitializationScope initializationScope(vm);
        if ((array = JSC::JSArray::tryCreateUninitializedRestricted(
                 initializationScope, nullptr,
                 globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
                 errors_count))) {

            for (size_t i = 0; i < errors_count; ++i) {
                array->initializeIndexWithoutBarrier(initializationScope, i, errors[i]);
            }
        }
    }
    if (!array) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    JSC::Structure* errorStructure = globalObject->errorStructure(JSC::ErrorType::AggregateError);

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::createAggregateError(vm, errorStructure, array, message, cause, nullptr, JSC::TypeNothing, false)));
}
JSC::EncodedJSValue JSC__JSGlobalObject__createAggregateErrorWithArray(JSC::JSGlobalObject* global, JSC::JSArray* array, const BunString* message, JSValue cause)
{
    auto& vm = JSC::getVM(global);
    JSC::Structure* errorStructure = global->errorStructure(JSC::ErrorType::AggregateError);
    WTF::String messageString = message->toWTFString();
    return JSC::JSValue::encode(JSC::createAggregateError(vm, errorStructure, array, messageString, cause, nullptr, JSC::TypeNothing, false));
}

// This must be a globally allocated string
[[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue EncodedSlice__toExternalValue(const EncodedSlice* arg0, JSC::JSGlobalObject* arg1)
{
    EncodedSlice str = *arg0;
    ASSERT(!Zig::isTaggedUTF8Ptr(str.ptr));
    if (str.len == 0) {
        return JSC::JSValue::encode(JSC::jsEmptyString(arg1->vm()));
    }
    if (Zig::isTaggedUTF16Ptr(str.ptr)) {
        auto ref = String(ExternalStringImpl::create({ reinterpret_cast<const char16_t*>(Zig::untag(str.ptr)), str.len }, Zig::untagVoid(str.ptr), free_global_string));
        return JSC::JSValue::encode(JSC::jsString(arg1->vm(), WTF::move(ref)));
    } else {
        auto ref = String(ExternalStringImpl::create({ Zig::untag(str.ptr), str.len }, Zig::untagVoid(str.ptr), free_global_string));
        return JSC::JSValue::encode(JSC::jsString(arg1->vm(), WTF::move(ref)));
    }
}

__attribute__((__always_inline__)) VirtualMachine* JSC__JSGlobalObject__bunVM(JSC::JSGlobalObject* arg0)
{
    return reinterpret_cast<VirtualMachine*>(WebCore::clientData(arg0->vm())->bunVM);
}

JSC::EncodedJSValue EncodedSlice__toValueGC(const EncodedSlice* arg0, JSC::JSGlobalObject* arg1)
{
    return JSC::JSValue::encode(JSC::jsString(arg1->vm(), Zig::toStringCopy(*arg0)));
}

JSC::EncodedJSValue EncodedSlice__external(const EncodedSlice* arg0, JSC::JSGlobalObject* arg1, void* arg2, void (*ArgFn3)(void* arg0, void* arg1, size_t arg2))
{
    EncodedSlice str
        = *arg0;
    if (Zig::isTaggedUTF16Ptr(str.ptr)) {
        return JSC::JSValue::encode(JSC::jsString(arg1->vm(), WTF::String(ExternalStringImpl::create({ reinterpret_cast<const char16_t*>(Zig::untag(str.ptr)), str.len }, arg2, ArgFn3))));
    } else {
        return JSC::JSValue::encode(JSC::jsString(arg1->vm(), WTF::String(ExternalStringImpl::create({ reinterpret_cast<const Latin1Character*>(Zig::untag(str.ptr)), str.len }, arg2, ArgFn3))));
    }
}

JSC::EncodedJSValue EncodedSlice__toDOMExceptionInstance(const EncodedSlice* str, JSC::JSGlobalObject* globalObject, WebCore::ExceptionCode code)
{
    return JSValue::encode(createDOMException(globalObject, code, toStringCopy(*str)));
}

JSC::JSPromise*
JSC__JSModuleLoader__loadAndEvaluateModule(JSC::JSGlobalObject* globalObject,
    const BunString* arg1)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto name = makeAtomString(arg1->toWTFString());

    auto* promise = JSC::loadAndEvaluateModule(globalObject, name, nullptr, nullptr);
    EXCEPTION_ASSERT(!!promise == !scope.exception());
    return promise;
}
#pragma mark - JSC::JSPromise

void JSC__AnyPromise__wrap(JSC::JSGlobalObject* globalObject, EncodedJSValue encodedPromise, void* ctx, JSC::EncodedJSValue (*func)(void*, JSC::JSGlobalObject*))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSValue promiseValue = JSC::JSValue::decode(encodedPromise);
    ASSERT(!promiseValue.isEmpty());

    JSValue result = JSC::JSValue::decode(func(ctx, globalObject));
    if (scope.exception()) [[unlikely]] {
        auto* exception = scope.exception();
        // A termination is not a value to settle the promise with; it stays pending and unwinds.
        if (!scope.tryClearException())
            return;

        if (auto* promise = dynamicDowncast<JSC::JSPromise>(promiseValue)) {
            promise->reject(vm, exception->value());
            RETURN_IF_EXCEPTION(scope, );
            return;
        }

        ASSERT_NOT_REACHED_WITH_MESSAGE("Non-promise value passed to AnyPromise.wrap");
    }

    if (auto* errorInstance = dynamicDowncast<JSC::ErrorInstance>(result)) {
        if (auto* promise = dynamicDowncast<JSC::JSPromise>(promiseValue)) {
            promise->reject(vm, errorInstance);
            RETURN_IF_EXCEPTION(scope, );
            return;
        }

        ASSERT_NOT_REACHED_WITH_MESSAGE("Non-promise value passed to AnyPromise.wrap");
    }

    if (auto* promise = dynamicDowncast<JSC::JSPromise>(promiseValue)) {
        promise->resolve(globalObject, vm, result);
        RETURN_IF_EXCEPTION(scope, );
        return;
    }

    ASSERT_NOT_REACHED_WITH_MESSAGE("Non-promise value passed to AnyPromise.wrap");
}

JSC::EncodedJSValue JSC__JSPromise__wrap(JSC::JSGlobalObject* globalObject, void* ctx, JSC::EncodedJSValue (*func)(void*, JSC::JSGlobalObject*))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue result = JSC::JSValue::decode(func(ctx, globalObject));
    if (scope.exception()) [[unlikely]] {
        auto* exception = scope.exception();
        // A termination is not a value to reject with; it stays pending and the caller unwinds on it.
        if (!scope.tryClearException())
            RELEASE_AND_RETURN(scope, {});
        RELEASE_AND_RETURN(scope, JSValue::encode(JSC::JSPromise::rejectedPromise(globalObject, exception->value())));
    }

    if (auto* promise = dynamicDowncast<JSC::JSPromise>(result)) {
        RELEASE_AND_RETURN(scope, JSValue::encode(promise));
    }

    if (JSC::ErrorInstance* err = dynamicDowncast<JSC::ErrorInstance>(result)) {
        RELEASE_AND_RETURN(scope, JSValue::encode(JSC::JSPromise::rejectedPromise(globalObject, err)));
    }

    JSValue resolved = JSC::JSPromise::resolvedPromise(globalObject, result);
    if (scope.exception()) [[unlikely]] {
        auto* exception = scope.exception();
        // A termination is not a value to reject with; it stays pending and the caller unwinds on it.
        if (!scope.tryClearException())
            RELEASE_AND_RETURN(scope, {});
        RELEASE_AND_RETURN(scope, JSValue::encode(JSC::JSPromise::rejectedPromise(globalObject, exception->value())));
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(resolved));
}

[[ZIG_EXPORT(check_slow)]] void JSC__JSPromise__reject(JSC::JSPromise* arg0, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue JSValue2)
{
    JSValue value = JSC::JSValue::decode(JSValue2);
    ASSERT_WITH_MESSAGE(!value.isEmpty(), "Promise.reject cannot be called with a empty JSValue");
    auto& vm = JSC::getVM(globalObject);
    ASSERT_WITH_MESSAGE(arg0->inherits<JSC::JSPromise>(), "Argument is not a promise");
    ASSERT_WITH_MESSAGE(arg0->status() == JSC::JSPromise::Status::Pending, "Promise is already resolved or rejected");

    JSC::Exception* exception = nullptr;
    if (!value.inherits<JSC::Exception>()) {
        exception = JSC::Exception::create(vm, value, JSC::Exception::StackCaptureAction::CaptureStack);
    } else {
        exception = uncheckedDowncast<JSC::Exception>(value);
    }

    arg0->reject(vm, exception);
}

[[ZIG_EXPORT(check_slow)]] void JSC__JSPromise__rejectAsHandled(JSC::JSPromise* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2)
{
    ASSERT_WITH_MESSAGE(arg0->inherits<JSC::JSPromise>(), "Argument is not a promise");
    ASSERT_WITH_MESSAGE(arg0->status() == JSC::JSPromise::Status::Pending, "Promise is already resolved or rejected");

    auto& vm = JSC::getVM(arg1);
    arg0->rejectAsHandled(vm, JSC::JSValue::decode(JSValue2));
}

JSC::JSPromise* JSC__JSPromise__rejectedPromise(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue JSValue1)
{
    auto value = JSC::JSValue::decode(JSValue1);
    if (!value) [[unlikely]] {
        // Building the rejection value threw — a stopped worker's pending TerminationException cuts
        // error creation short. That exception is what the caller's frame reports; hand back an
        // inert promise rather than reject with nothing.
        auto& vm = JSC::getVM(globalObject);
        ASSERT(vm.exceptionForInspection());
        return JSC::JSPromise::create(vm, globalObject->promiseStructure());
    }
    return JSC::JSPromise::rejectedPromise(globalObject, value);
}

[[ZIG_EXPORT(check_slow)]] void JSC__JSPromise__resolve(JSC::JSPromise* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2)
{
    JSValue target = JSValue::decode(JSValue2);

    ASSERT_WITH_MESSAGE(arg0->inherits<JSC::JSPromise>(), "Argument is not a promise");
    ASSERT_WITH_MESSAGE(arg0->status() == JSC::JSPromise::Status::Pending, "Promise is already resolved or rejected");
    ASSERT(!target.isEmpty());
    ASSERT_WITH_MESSAGE(arg0 != target, "Promise cannot be resolved to itself");

    // Note: the Promise can be another promise. Since we go through the generic promise resolve codepath.
    arg0->resolve(arg1, arg1->vm(), JSC::JSValue::decode(JSValue2));
}

// This implementation closely mimics the one in JSC::JSPromise::resolve
void JSC__JSPromise__resolveOnNextTick(JSC::JSPromise* promise, JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue encoedValue)
{
    return JSC__JSPromise__resolve(promise, lexicalGlobalObject, encoedValue);
}

bool JSC__JSValue__isAnyError(JSC::EncodedJSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);

    JSC::JSCell* cell = value.asCell();
    JSC::JSType type = cell->type();

    if (type == JSC::CellType) {
        return cell->inherits<JSC::Exception>();
    }

    return type == JSC::ErrorInstanceType;
}

// This implementation closely mimics the one in JSC::JSPromise::reject
void JSC__JSPromise__rejectOnNextTickWithHandled(JSC::JSPromise* promise, JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::EncodedJSValue encoedValue, bool handled)
{
    JSC::JSValue value = JSC::JSValue::decode(encoedValue);

    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    uint16_t flags = promise->flags();
    if (!(flags & JSC::JSPromise::isFirstResolvingFunctionCalledFlag)) {
        if (handled) {
            flags |= JSC::JSPromise::isHandledFlag;
        }

        promise->setFlags(static_cast<uint16_t>(flags | JSC::JSPromise::isFirstResolvingFunctionCalledFlag));
        auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(promise->globalObject());
        auto rejectPromiseFunction = globalObject->rejectPromiseFunction();

        auto asyncContext = globalObject->m_asyncContextData.get()->getInternalField(0);

#if ASSERT_ENABLED
        ASSERT_WITH_MESSAGE(rejectPromiseFunction, "Invalid microtask callback");
        ASSERT_WITH_MESSAGE(!value.isEmpty(), "Invalid microtask value");
#endif

        if (asyncContext.isEmpty()) {
            asyncContext = jsUndefined();
        }

        if (value.isEmpty()) {
            value = jsUndefined();
        }

        // BunPerformMicrotaskJob: rejectPromiseFunction, asyncContext, promise, value
        JSC::QueuedTask task { nullptr, JSC::InternalMicrotask::BunPerformMicrotaskJob, 0, globalObject, rejectPromiseFunction, globalObject->m_asyncContextData.get()->getInternalField(0), promise, value };
        globalObject->vm().queueMicrotask(WTF::move(task));
        RETURN_IF_EXCEPTION(scope, );
    }
}

JSC::JSPromise* JSC__JSPromise__resolvedPromise(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue JSValue1)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSPromise* promise = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    promise->setFlags(static_cast<uint16_t>(JSC::JSPromise::Status::Fulfilled));
    promise->setSlot(vm, JSC::JSValue::decode(JSValue1));
    return promise;
}

[[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue JSC__JSPromise__result(JSC::JSPromise* promise, JSC::VM* arg1)
{
    UNUSED_PARAM(arg1);

    // if the promise is rejected we automatically mark it as handled so it
    // doesn't end up in the promise rejection tracker
    switch (promise->status()) {
    case JSC::JSPromise::Status::Rejected: {
        if (!(promise->flags() & JSC::JSPromise::isFirstResolvingFunctionCalledFlag))
            promise->markAsHandled();
    }
    // fallthrough intended
    case JSC::JSPromise::Status::Fulfilled: {
        return JSValue::encode(promise->result());
    }
    default:
        return JSValue::encode(JSValue {});
    }
}

[[ZIG_EXPORT(nothrow)]] uint32_t JSC__JSPromise__status(const JSC::JSPromise* arg0)
{
    switch (arg0->status()) {
    case JSC::JSPromise::Status::Pending:
        return 0;
    case JSC::JSPromise::Status::Fulfilled:
        return 1;
    case JSC::JSPromise::Status::Rejected:
        return 2;
    default:
        return 255;
    }
}
[[ZIG_EXPORT(nothrow)]] void JSC__JSPromise__setHandled(JSC::JSPromise* promise)
{
    promise->markAsHandled();
}

#pragma mark - JSC::JSInternalPromise (now aliased to JSPromise)

JSC::JSPromise* JSC__JSInternalPromise__create(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    return JSC::JSPromise::create(vm, globalObject->promiseStructure());
}

void JSC__JSInternalPromise__rejectAsHandled(JSC::JSPromise* arg0,
    JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2)
{
    auto& vm = JSC::getVM(arg1);
    arg0->rejectAsHandled(vm, JSC::JSValue::decode(JSValue2));
}
void JSC__JSInternalPromise__rejectAsHandledException(JSC::JSPromise* arg0,
    JSC::JSGlobalObject* arg1,
    JSC::Exception* arg2)
{
    auto& vm = JSC::getVM(arg1);
    arg0->rejectAsHandled(vm, arg2);
}

JSC::JSPromise* JSC__JSInternalPromise__rejectedPromise(JSC::JSGlobalObject* arg0,
    JSC::EncodedJSValue JSValue1)
{
    return JSC::JSPromise::rejectedPromise(arg0, JSC::JSValue::decode(JSValue1));
}

JSC::JSPromise* JSC__JSInternalPromise__resolvedPromise(JSC::JSGlobalObject* arg0,
    JSC::EncodedJSValue JSValue1)
{
    return JSC::JSPromise::resolvedPromise(arg0, JSC::JSValue::decode(JSValue1));
}

JSC::EncodedJSValue JSC__JSInternalPromise__result(const JSC::JSPromise* arg0)
{
    return JSC::JSValue::encode(arg0->result());
}
uint32_t JSC__JSInternalPromise__status(const JSC::JSPromise* arg0)
{
    switch (arg0->status()) {
    case JSC::JSPromise::Status::Pending:
        return 0;
    case JSC::JSPromise::Status::Fulfilled:
        return 1;
    case JSC::JSPromise::Status::Rejected:
        return 2;
    default:
        return 255;
    }
}
bool JSC__JSInternalPromise__isHandled(const JSC::JSPromise* arg0)
{
    return arg0->isHandled();
}
void JSC__JSInternalPromise__setHandled(JSC::JSPromise* promise, JSC::VM* arg1)
{
    UNUSED_PARAM(arg1);
    promise->markAsHandled();
}

#pragma mark - JSC::JSGlobalObject

JSC::EncodedJSValue JSC__JSGlobalObject__generateHeapSnapshot(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);

    JSC::JSLockHolder lock(vm);
    // JSC::DeferTermination deferScope(vm);
    auto scope = DECLARE_THROW_SCOPE(vm);

    Bun__Feature__heap_snapshot += 1;

    JSC::HeapSnapshotBuilder snapshotBuilder(vm.ensureHeapProfiler());
    snapshotBuilder.buildSnapshot();

    WTF::String jsonString = snapshotBuilder.json();
    RETURN_IF_EXCEPTION(scope, {});
    JSC::EncodedJSValue result = JSC::JSValue::encode(JSONParse(globalObject, jsonString));
    scope.releaseAssertNoException();
    return result;
}

// One load. always_inline so ThinLTO importers and the inliner never leave
// this as an out-of-line cross-language call (it is the single most-called
// Rust -> C++ boundary function).
__attribute__((__always_inline__)) JSC::VM* JSC__JSGlobalObject__vm(JSC::JSGlobalObject* arg0) { return &arg0->vm(); };

void JSC__JSGlobalObject__handleRejectedPromises(JSC::JSGlobalObject* arg0)
{
    return uncheckedDowncast<Zig::GlobalObject>(arg0)->handleRejectedPromises();
}

#pragma mark - JSC::JSValue

JSC::JSString* JSC__JSValue__asString(JSC::EncodedJSValue JSValue0)
{
    auto value = JSC::JSValue::decode(JSValue0);
    return JSC::asString(value);
};

bool JSC__JSValue__eqlCell(JSC::EncodedJSValue JSValue0, JSC::JSCell* arg1)
{
    return JSC::JSValue::decode(JSValue0) == arg1;
};
bool JSC__JSValue__eqlValue(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1)
{
    return JSC::JSValue::decode(JSValue0) == JSC::JSValue::decode(JSValue1);
};
JSC::EncodedJSValue JSC__JSValue__getPrototype(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1)
{
    auto value = JSC::JSValue::decode(JSValue0);
    return JSC::JSValue::encode(value.getPrototype(arg1));
}
bool JSC__JSValue__isException(JSC::EncodedJSValue JSValue0, JSC::VM* arg1)
{
    return dynamicDowncast<JSC::Exception>(JSC::JSValue::decode(JSValue0)) != nullptr;
}
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isAnyInt(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isAnyInt();
}
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isBigInt(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isBigInt();
}
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isBigInt32(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isBigInt32();
}

[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isLiveCell(JSC::EncodedJSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (!value.isCell())
        return false;
    return !value.asCell()->isPendingDestruction();
}

void JSC__JSValue__put(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, const EncodedSlice* arg2, JSC::EncodedJSValue JSValue3)
{
    JSC::JSObject* object = JSC::JSValue::decode(JSValue0).asCell()->getObject();
    object->putDirect(arg1->vm(), Zig::toIdentifier(*arg2, arg1), JSC::JSValue::decode(JSValue3));
}

void JSC__JSValue__putNonEnumerable(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, const EncodedSlice* arg2, JSC::EncodedJSValue JSValue3)
{
    JSC::JSObject* object = JSC::JSValue::decode(JSValue0).asCell()->getObject();
    object->putDirect(arg1->vm(), Zig::toIdentifier(*arg2, arg1), JSC::JSValue::decode(JSValue3), JSC::PropertyAttribute::DontEnum | 0);
}

void JSC__JSValue__putToPropertyKey(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue arg2, JSC::EncodedJSValue arg3)
{
    auto& vm = JSC::getVM(arg1);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto obj = JSValue::decode(JSValue0);
    auto key = JSValue::decode(arg2);
    auto value = JSValue::decode(arg3);
    auto object = obj.asCell()->getObject();
    auto pkey = key.toPropertyKey(arg1);
    RETURN_IF_EXCEPTION(scope, );
    object->putDirectMayBeIndex(arg1, pkey, value);
    RETURN_IF_EXCEPTION(scope, );
}

extern "C" [[ZIG_EXPORT(check_slow)]] void JSC__JSValue__putMayBeIndex(JSC::EncodedJSValue target, JSC::JSGlobalObject* globalObject, const BunString* key, JSC::EncodedJSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);

    WTF::String keyStr = key->tag == BunStringTag::Empty ? WTF::emptyString() : key->toWTFString();
    JSC::Identifier identifier = JSC::Identifier::fromString(vm, keyStr);

    JSC::JSObject* object = JSC::JSValue::decode(target).asCell()->getObject();
    object->putDirectMayBeIndex(globalObject, JSC::PropertyName(identifier), JSC::JSValue::decode(value));
    RETURN_IF_EXCEPTION(scope, );
}

extern "C" bool JSC__JSValue__deleteProperty(JSC::EncodedJSValue target, JSC::JSGlobalObject* globalObject, const EncodedSlice* key)
{
    JSC::JSValue targetValue = JSC::JSValue::decode(target);
    if (!targetValue.isObject())
        return false;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSObject* object = targetValue.getObject();
    bool result = object->deleteProperty(globalObject, Zig::toIdentifier(*key, globalObject));
    RETURN_IF_EXCEPTION(scope, false);
    return result;
}

bool JSC__JSValue__isClass(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1)
{
    JSValue value = JSValue::decode(JSValue0);
    auto callData = getCallData(value);

    switch (callData.type) {
    case CallData::Type::JS:
        return callData.js.functionExecutable->isClassConstructorFunction();
    case CallData::Type::Native:
        if (callData.native.isBoundFunction)
            return false;
        return value.isConstructor();
    default:
        return false;
    }
    return false;
}
bool JSC__JSValue__isError(JSC::EncodedJSValue JSValue0)
{
    JSC::JSObject* obj = JSC::JSValue::decode(JSValue0).getObject();
    return obj != nullptr && obj->isErrorInstance();
}

bool JSC__JSValue__isAggregateError(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* global)
{
    JSValue value = JSC::JSValue::decode(JSValue0);
    if (value.isUndefinedOrNull() || !value || !value.isObject()) {
        return false;
    }

    if (JSC::ErrorInstance* err = dynamicDowncast<JSC::ErrorInstance>(value)) {
        return err->errorType() == JSC::ErrorType::AggregateError;
    }

    return false;
}

bool JSC__JSValue__isIterable(JSC::EncodedJSValue JSValue, JSC::JSGlobalObject* global)
{
    return JSC::hasIteratorMethod(global, JSC::JSValue::decode(JSValue));
}

void JSC__JSValue__forEach(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, void* ctx, void (*ArgFn3)(JSC::VM* arg0, JSC::JSGlobalObject* arg1, void* arg2, JSC::EncodedJSValue JSValue3))
{
    JSC::forEachInIterable(
        arg1, JSC::JSValue::decode(JSValue0),
        [ArgFn3, ctx](JSC::VM& vm, JSC::JSGlobalObject* global, JSC::JSValue value) -> void {
            ArgFn3(&vm, global, ctx, JSC::JSValue::encode(value));
        });
}

[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isCallable(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isCallable();
}
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isHeapBigInt(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isHeapBigInt();
}
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isPrimitive(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isPrimitive();
}
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isSymbol(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isSymbol();
}
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isUInt32AsAnyInt(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isUInt32AsAnyInt();
}

[[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue JSC__JSValue__jsEmptyString(JSC::JSGlobalObject* arg0)
{
    return JSC::JSValue::encode(JSC::jsEmptyString(arg0->vm()));
}
__attribute__((__always_inline__)) JSC::EncodedJSValue JSC__JSValue__jsNumberFromDouble(double arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
}
JSC::EncodedJSValue JSC__JSValue__jsNumberFromInt32(int32_t arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
}
JSC::EncodedJSValue JSC__JSValue__jsNumberFromInt64(int64_t arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
}
JSC::EncodedJSValue JSC__JSValue__jsNumberFromUint64(uint64_t arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
}

[[ZIG_EXPORT(nothrow)]] int64_t JSC__JSValue__toInt64(JSC::EncodedJSValue val)
{
    JSC::JSValue value = JSC::JSValue::decode(val);
    ASSERT(value.isHeapBigInt() || value.isNumber());
    if (value.isHeapBigInt()) {
        if (auto* heapBigInt = value.asHeapBigInt()) {
            return heapBigInt->toBigInt64(heapBigInt);
        }
    }
    if (value.isInt32())
        return value.asInt32();
    return static_cast<int64_t>(value.asDouble());
}

uint8_t JSC__JSValue__asBigIntCompare(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue JSValue1)
{
    JSValue v1 = JSValue::decode(JSValue0);
    JSValue v2 = JSValue::decode(JSValue1);
    ASSERT(v1.isHeapBigInt() || v1.isBigInt32());

#if USE(BIGINT32)
    if (v1.isBigInt32()) {
        int32_t v1Int = v1.bigInt32AsInt32();
        if (v2.isHeapBigInt()) {
            return static_cast<uint8_t>(JSBigInt::compare(v1Int, v2.asHeapBigInt()));
        } else if (v2.isBigInt32()) {
            return static_cast<uint8_t>(JSBigInt::compare(v1Int, v2.bigInt32AsInt32()));
        }

        double v2Double = v2.asNumber();
        if (v1Int == v2Double) {
            return static_cast<uint8_t>(JSBigInt::ComparisonResult::Equal);
        }
        if (v1Int < v2Double) {
            return static_cast<uint8_t>(JSBigInt::ComparisonResult::LessThan);
        }

        return static_cast<uint8_t>(JSBigInt::ComparisonResult::GreaterThan);
    }
#endif

    if (v1.isHeapBigInt()) {
        JSBigInt* v1BigInt = v1.asHeapBigInt();
        if (v2.isHeapBigInt()) {
            return static_cast<uint8_t>(JSBigInt::compare(v1BigInt, v2.asHeapBigInt()));
        }

#if USE(BIGINT32)
        if (v2.isBigInt32()) {
            return static_cast<uint8_t>(JSBigInt::compare(v1BigInt, v2.toInt32(globalObject)));
        }
#endif

        return static_cast<uint8_t>(JSBigInt::compareToDouble(v1BigInt, v2.asNumber()));
    }

    ASSERT_NOT_REACHED();
    return static_cast<uint8_t>(JSBigInt::ComparisonResult::Undefined);
}

JSC::EncodedJSValue JSC__JSValue__fromInt64NoTruncate(JSC::JSGlobalObject* globalObject, int64_t val)
{
    return JSC::JSValue::encode(JSC::JSBigInt::createFrom(globalObject, val));
}

JSC::EncodedJSValue JSC__JSValue__fromTimevalNoTruncate(JSC::JSGlobalObject* globalObject, int64_t nsec, int64_t sec)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto big_nsec = JSC::JSBigInt::createFrom(globalObject, nsec);
    RETURN_IF_EXCEPTION(scope, {});
    auto big_sec = JSC::JSBigInt::createFrom(globalObject, sec);
    RETURN_IF_EXCEPTION(scope, {});
    auto big_1e6 = JSC::JSBigInt::createFrom(globalObject, 1e6);
    RETURN_IF_EXCEPTION(scope, {});
    auto sec_as_nsec = JSC::JSBigInt::multiply(globalObject, big_1e6, big_sec);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(sec_as_nsec.isHeapBigInt());
    auto* big_sec_as_nsec = sec_as_nsec.asHeapBigInt();
    ASSERT(big_sec_as_nsec);
    auto result = JSC::JSBigInt::add(globalObject, big_sec_as_nsec, big_nsec);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(result);
}

JSC::EncodedJSValue JSC__JSValue__bigIntSum(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue a, JSC::EncodedJSValue b)
{
    JSC::JSValue a_value = JSC::JSValue::decode(a);
    JSC::JSValue b_value = JSC::JSValue::decode(b);

    ASSERT(a_value.isHeapBigInt());
    auto* big_a = a_value.asHeapBigInt();
    ASSERT(big_a);

    ASSERT(b_value.isHeapBigInt());
    auto* big_b = b_value.asHeapBigInt();
    ASSERT(big_b);
    return JSC::JSValue::encode(JSC::JSBigInt::add(globalObject, big_a, big_b));
}

JSC::EncodedJSValue JSC__JSValue__fromUInt64NoTruncate(JSC::JSGlobalObject* globalObject, uint64_t val)
{
    return JSC::JSValue::encode(JSC::JSBigInt::createFrom(globalObject, val));
}

// Decimal integer literal (Latin-1) -> BigInt. Returns the empty value when
// the text is not a valid StringToBigInt input.
JSC::EncodedJSValue JSC__JSValue__bigIntFromLatin1(JSC::JSGlobalObject* globalObject, const uint8_t* ptr, size_t len)
{
    return JSC::JSValue::encode(JSC::JSBigInt::stringToBigInt(globalObject, WTF::StringView(std::span { reinterpret_cast<const char*>(ptr), len })));
}

uint64_t JSC__JSValue__toUInt64NoTruncate(JSC::EncodedJSValue val)
{
    JSC::JSValue value = JSC::JSValue::decode(val);
    ASSERT(value.isHeapBigInt() || value.isNumber());

    if (value.isHeapBigInt()) {
        if (auto* heapBigInt = value.asHeapBigInt()) {
            return heapBigInt->toBigUInt64(heapBigInt);
        }
    }

    if (value.isInt32()) {
        return static_cast<uint64_t>(static_cast<int64_t>(value.asInt32()));
    }
    ASSERT(value.isDouble());

    // >= 2^64 (and +Infinity) saturates; below that JSC::toUInt64 is exact, NaN -> 0, negatives wrap like the int32 path.
    double number = value.asDouble();
    if (number >= 18446744073709551616.0)
        return std::numeric_limits<uint64_t>::max();
    return JSC::toUInt64(number);
}

JSC::EncodedJSValue JSC__JSValue__createObject2(JSC::JSGlobalObject* globalObject, const EncodedSlice* arg1,
    const EncodedSlice* arg2, JSC::EncodedJSValue JSValue3,
    JSC::EncodedJSValue JSValue4)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSObject* object = JSC::constructEmptyObject(globalObject);
    auto key1 = Zig::toIdentifier(*arg1, globalObject);
    JSC::PropertyDescriptor descriptor1;
    JSC::PropertyDescriptor descriptor2;

    descriptor1.setEnumerable(1);
    descriptor1.setConfigurable(1);
    descriptor1.setWritable(1);
    descriptor1.setValue(JSC::JSValue::decode(JSValue3));

    auto key2 = Zig::toIdentifier(*arg2, globalObject);

    descriptor2.setEnumerable(1);
    descriptor2.setConfigurable(1);
    descriptor2.setWritable(1);
    descriptor2.setValue(JSC::JSValue::decode(JSValue4));

    object->methodTable()
        ->defineOwnProperty(object, globalObject, key2, descriptor2, true);
    RETURN_IF_EXCEPTION(scope, {});
    object->methodTable()
        ->defineOwnProperty(object, globalObject, key1, descriptor1, true);
    RETURN_IF_EXCEPTION(scope, {});

    return JSC::JSValue::encode(object);
}

// Returns empty for exception, returns deleted if not found.
// Be careful when handling the return value.
// Cannot handle numeric index property names! If it is possible that this will be a integer index, use JSC__JSValue__getPropertyValue instead
[[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue JSC__JSValue__getIfPropertyExistsImpl(JSC::EncodedJSValue JSValue0,
    JSC::JSGlobalObject* globalObject,
    const unsigned char* arg1, size_t arg2)
{
    ASSERT_NO_PENDING_EXCEPTION(globalObject);
    JSValue value = JSC::JSValue::decode(JSValue0);
    ASSERT_WITH_MESSAGE(!value.isEmpty(), "get() must not be called on empty value");

    auto& vm = JSC::getVM(globalObject);
    JSC::JSObject* object = value.getObject();
    if (!object) [[unlikely]] {
        return JSValue::encode(JSValue::decode(JSC::JSValue::ValueDeleted));
    }

    // Since Identifier might not ref the string, we need to ensure it doesn't get deref'd until this function returns
    const auto propertyString = String(StringImpl::createWithoutCopying({ arg1, arg2 }));
    const auto identifier = JSC::Identifier::fromString(vm, propertyString);
    const auto property = JSC::PropertyName(identifier);

    return JSC::JSValue::encode(Bun::getIfPropertyExistsPrototypePollutionMitigationUnsafe(vm, globalObject, object, property));
}

// Returns empty for exception, returns deleted if not found.
// Be careful when handling the return value.
// Can handle numeric index property names safely. If you know that the property name is not an integer index, use JSC__JSValue__getIfPropertyExistsImpl instead.
JSC::EncodedJSValue JSC__JSValue__getPropertyValue(JSC::EncodedJSValue encodedValue,
    JSC::JSGlobalObject* globalObject,
    const unsigned char* propertyName, uint32_t propertyNameLength)
{

    ASSERT_NO_PENDING_EXCEPTION(globalObject);
    JSValue value = JSC::JSValue::decode(encodedValue);
    ASSERT_WITH_MESSAGE(!value.isEmpty(), "getPropertyValue() must not be called on empty value");

    auto& vm = JSC::getVM(globalObject);
    JSC::JSObject* object = value.getObject();
    if (!object) [[unlikely]] {
        return JSValue::encode(JSValue::decode(JSC::JSValue::ValueDeleted));
    }

    // Since Identifier might not ref the string, we need to ensure it doesn't get deref'd until this function returns
    const auto propertyString = String(StringImpl::createWithoutCopying({ propertyName, propertyNameLength }));
    const auto identifier = JSC::Identifier::fromString(vm, propertyString);
    const auto property = JSC::PropertyName(identifier);

    auto scope = DECLARE_THROW_SCOPE(vm);
    PropertySlot slot(object, PropertySlot::InternalMethodType::Get);
    if (!object->getPropertySlot(globalObject, property, slot)) {
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(JSValue::decode(JSC::JSValue::ValueDeleted));
    }
    RETURN_IF_EXCEPTION(scope, {});

    JSValue result = slot.getValue(globalObject, property);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(result);
}

extern "C" JSC::EncodedJSValue JSC__JSValue__getOwn(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, BunString* propertyName)
{
    ASSERT_NO_PENDING_EXCEPTION(globalObject);

    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSC::JSValue::decode(JSValue0);
    WTF::String propertyNameString = propertyName->tag == BunStringTag::Empty ? WTF::emptyString() : propertyName->toWTFString(BunString::ZeroCopy);
    auto identifier = JSC::Identifier::fromString(vm, propertyNameString);
    auto property = JSC::PropertyName(identifier);
    PropertySlot slot(value, PropertySlot::InternalMethodType::GetOwnProperty);
    bool hasSlot = value.getOwnPropertySlot(globalObject, property, slot);
    RETURN_IF_EXCEPTION(scope, {});
    if (!hasSlot) return {};
    auto slotValue = slot.getValue(globalObject, property);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(slotValue);
}

JSC::EncodedJSValue JSC__JSValue__getIfPropertyExistsFromPath(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue arg1)
{
    ASSERT_NO_PENDING_EXCEPTION(globalObject);
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSValue::decode(JSValue0);
    JSValue path = JSValue::decode(arg1);

    if (path.isString()) {
        String pathString = path.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        uint32_t length = pathString.length();

        if (length == 0) {
            auto* valueObject = value.toObject(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            JSValue prop = valueObject->getIfPropertyExists(globalObject, vm.propertyNames->emptyIdentifier);
            RETURN_IF_EXCEPTION(scope, {});
            return JSValue::encode(prop);
        }

        // Jest doesn't check for valid dot/bracket notation. It will skip all "[" and "]", and search for
        // an empty string for "." when it's the first or last character of the path, or if there are
        // two in a row.

        JSValue currProp = value;
        uint32_t i = 0;
        uint32_t j = 0;

        // if "." is the only character, it will search for an empty string twice.
        if (pathString.codeUnitAt(0) == '.') {
            auto* currPropObject = currProp.toObject(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            currProp = currPropObject->getIfPropertyExists(globalObject, vm.propertyNames->emptyIdentifier);
            RETURN_IF_EXCEPTION(scope, {});
            if (currProp.isEmpty()) {
                return JSValue::encode(currProp);
            }
        }

        while (i < length) {
            char16_t ic = pathString.codeUnitAt(i);
            while (ic == '[' || ic == ']' || ic == '.') {
                i += 1;
                if (i == length) {

                    if (ic == '.') {
                        auto* currPropObject = currProp.toObject(globalObject);
                        RETURN_IF_EXCEPTION(scope, {});
                        currProp = currPropObject->getIfPropertyExists(globalObject, vm.propertyNames->emptyIdentifier);
                        RETURN_IF_EXCEPTION(scope, {});
                        return JSValue::encode(currProp);
                    }

                    // nothing found.
                    if (j == 0) {
                        return {};
                    }

                    return JSValue::encode(currProp);
                }

                char16_t previous = ic;
                ic = pathString.codeUnitAt(i);
                if (previous == '.' && ic == '.') {
                    auto* currPropObject = currProp.toObject(globalObject);
                    RETURN_IF_EXCEPTION(scope, {});
                    currProp = currPropObject->getIfPropertyExists(globalObject, vm.propertyNames->emptyIdentifier);
                    RETURN_IF_EXCEPTION(scope, {});
                    if (currProp.isEmpty()) {
                        return JSValue::encode(currProp);
                    }
                    continue;
                }
            }

            j = i;
            char16_t jc = pathString.codeUnitAt(j);
            while (!(jc == '[' || jc == ']' || jc == '.')) {
                j += 1;
                if (j == length) {
                    // break and search for property
                    break;
                }
                jc = pathString.codeUnitAt(j);
            }

            String propNameStr = pathString.substring(i, j - i);
            PropertyName propName = PropertyName(Identifier::fromString(vm, propNameStr));

            auto* currPropObject = currProp.toObject(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            currProp = currPropObject->getIfPropertyExists(globalObject, propName);
            RETURN_IF_EXCEPTION(scope, {});
            if (currProp.isEmpty()) {
                return JSValue::encode(currProp);
            }

            i = j;
        }

        return JSValue::encode(currProp);
    }

    bool pathIsArray = isArray(globalObject, path);
    RETURN_IF_EXCEPTION(scope, {});
    if (pathIsArray) {
        // each item in array is property name, ignore dot/bracket notation
        JSValue currProp = value;
        auto* pathObject = path.toObject(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        forEachInArrayLike(globalObject, pathObject, [&](JSValue item) -> bool {
            if (!(item.isString() || item.isNumber())) {
                currProp = {};
                return false;
            }

            JSString* propNameString = item.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            PropertyName propName = PropertyName(propNameString->toIdentifier(globalObject));
            RETURN_IF_EXCEPTION(scope, {});

            auto* currPropObject = currProp.toObject(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            currProp = currPropObject->getIfPropertyExists(globalObject, propName);
            RETURN_IF_EXCEPTION(scope, {});
            if (currProp.isEmpty()) {
                return false;
            }

            return true;
        });
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(currProp);
    }

    return {};
}

BunString JSC__JSValue__getSymbolDescription(JSC::EncodedJSValue symbolValue_, JSC::JSGlobalObject* arg1)
{
    JSC::JSValue symbolValue = JSC::JSValue::decode(symbolValue_);

    if (!symbolValue.isSymbol())
        return BunStringEmpty;

    JSC::Symbol* symbol = JSC::asSymbol(symbolValue);

    auto& uid = symbol->uid();
    if (!uid.isNullSymbol() && !uid.isEmpty()) {
        return Bun::toString(&static_cast<WTF::StringImpl&>(uid));
    }
    return BunStringEmpty;
}

JSC::EncodedJSValue JSC__JSValue__symbolFor(JSC::JSGlobalObject* globalObject, const BunString* key)
{
    auto& vm = JSC::getVM(globalObject);
    WTF::String string = key->toWTFString(BunString::ZeroCopy);
    return JSC::JSValue::encode(JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey(string)));
}

int32_t JSC__JSValue__toInt32(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).asInt32();
}

CPP_DECL double Bun__JSValue__toNumber(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1)
{
    ASSERT_NO_PENDING_EXCEPTION(arg1);
    auto scope = DECLARE_THROW_SCOPE(arg1->vm());
    double result = JSC::JSValue::decode(JSValue0).toNumber(arg1);
    RETURN_IF_EXCEPTION(scope, PNaN);
    return result;
}

// truncates values larger than int32
[[ZIG_EXPORT(check_slow)]] int32_t JSC__JSValue__coerceToInt32(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (value.isCell() && value.isHeapBigInt()) {
        return static_cast<int32_t>(value.toBigInt64(arg1));
    }
    return value.toInt32(arg1);
}

[[ZIG_EXPORT(check_slow)]] int64_t JSC__JSValue__coerceToInt64(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1)
{
    JSValue value = JSValue::decode(JSValue0);
    if (value.isCell() && value.isHeapBigInt()) {
        return value.toBigInt64(arg1);
    }

    if (value.isDouble()) {
        int64_t result = tryConvertToInt52(value.asDouble());
        if (result != JSValue::notInt52) {
            return result;
        }

        return static_cast<int64_t>(value.asDouble());
    }

    return value.toInt32(arg1);
}

JSC::JSObject* JSC__JSValue__toObject(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return value.toObject(arg1);
}

[[ZIG_EXPORT(null_is_throw)]] JSC::JSString* JSC__JSValue__toStringOrNull(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return value.toStringOrNull(arg1);
}

/// `toStringOrNull` + `JSString::view` in one call.
JSC::JSString* JSC__JSValue__toJSStringView(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* global, BunString* view)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(global));
    auto* str = JSC::JSValue::decode(JSValue0).toStringOrNull(global);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto data = str->view(global);
    RETURN_IF_EXCEPTION(scope, nullptr);
    *view = Bun::toStringView(data.data);
    return str;
}

[[ZIG_EXPORT(check_slow)]] bool JSC__JSValue__toMatch(JSC::EncodedJSValue regexValue, JSC::JSGlobalObject* global, JSC::EncodedJSValue value)
{
    ASSERT_NO_PENDING_EXCEPTION(global);
    JSC::JSValue regex = JSC::JSValue::decode(regexValue);
    JSC::JSValue str = JSC::JSValue::decode(value);
    if (regex.asCell()->type() != RegExpObjectType || !str.isString()) {
        return false;
    }
    JSC::RegExpObject* regexObject = dynamicDowncast<JSC::RegExpObject>(regex);

    return !!regexObject->match(global, JSC::asString(str));
}

bool JSC__JSValue__stringIncludes(JSC::EncodedJSValue value, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue other)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    WTF::String stringToSearchIn = JSC::JSValue::decode(value).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::String searchString = JSC::JSValue::decode(other).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return stringToSearchIn.find(searchString, 0) != WTF::notFound;
}

extern "C" JSC::EncodedJSValue JSC__Exception__asJSValue(JSC::Exception* exception)
{
    return JSC::JSValue::encode(exception);
}

void JSC__VM__releaseWeakRefs(JSC::VM* arg0)
{
    arg0->finalizeSynchronousJSExecution();
}

static BunString toStringAdopt(WTF::String&& s)
{
    if (s.isEmpty())
        return BunStringEmpty;
    return { BunStringTag::WTFStringImpl, { .wtf = s.releaseImpl().leakRef() } };
}

BunString JSC__JSValue__getClassName(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1)
{
    JSValue value = JSValue::decode(JSValue0);
    JSC::JSCell* cell = value.asCell();
    if (cell == nullptr || !cell->isObject()) {
        return BunStringEmpty;
    }

    const char* ptr = cell->className();
    auto view = WTF::StringView(std::span { ptr, strlen(ptr) });

    // Fallback to .name if className is empty
    if (view.length() == 0 || StringView("Function"_s) == view) {
        return JSC__JSValue__getNameProperty(JSValue0, arg1);
    }

    JSObject* obj = value.toObject(arg1);

    auto calculated = JSObject::calculatedClassName(obj);
    if (calculated.length() > 0) {
        return toStringAdopt(WTF::move(calculated));
    }

    // `className()` is a static C string.
    return { BunStringTag::StaticEncodedSlice, { .encoded = { reinterpret_cast<const unsigned char*>(ptr), view.length() } } };
}

bool JSC__JSValue__getClassInfoName(JSValue value, const uint8_t** outPtr, size_t* outLen)
{
    if (auto info = value.classInfoOrNull()) {
        *outPtr = info->className.span8().data();
        *outLen = info->className.span8().size();
        return true;
    }
    return false;
}

BunString JSC__JSValue__getNameProperty(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1)
{
    JSC::JSObject* obj = JSC::JSValue::decode(JSValue0).getObject();
    JSC::VM& vm = arg1->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (obj == nullptr) {
        return BunStringEmpty;
    }

    JSC::JSValue name = obj->getIfPropertyExists(arg1, vm.propertyNames->toStringTagSymbol);
    RETURN_IF_EXCEPTION(scope, BunStringEmpty);

    if (name && name.isString()) {
        auto str = name.toWTFString(arg1);
        RETURN_IF_EXCEPTION(scope, BunStringEmpty);
        if (!str.isEmpty()) {
            return toStringAdopt(WTF::move(str));
        }
    }

    if (JSC::JSFunction* function = dynamicDowncast<JSC::JSFunction>(obj)) {

        WTF::String actualName = function->name(vm);
        if (!actualName.isEmpty() || function->isHostOrBuiltinFunction()) {
            return toStringAdopt(WTF::move(actualName));
        }

        return Bun::toStringRef(function->jsExecutable()->name().string());
    }

    if (JSC::InternalFunction* function = dynamicDowncast<JSC::InternalFunction>(obj)) {
        return Bun::toStringRef(function->name());
    }

    return BunStringEmpty;
}

[[ZIG_EXPORT(check_slow)]] void JSC__JSValue__getName(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, BunString* arg2)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (!value.isObject()) {
        *arg2 = BunStringEmpty;
        return;
    }
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSObject* object = value.getObject();
    auto displayName = JSC::getCalculatedDisplayName(vm, object);

    // JSC doesn't include @@toStringTag in calculated display name
    if (displayName.isEmpty()) {
        auto toStringTagValue = object->getIfPropertyExists(globalObject, vm.propertyNames->toStringTagSymbol);
        RETURN_IF_EXCEPTION(scope, );
        if (toStringTagValue) {
            if (toStringTagValue.isString()) {
                displayName = toStringTagValue.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, );
            }
        }
    }

    *arg2 = Bun::toStringRef(displayName);
}

JSC::EncodedJSValue JSC__JSValue__toError_(JSC::EncodedJSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (value.isEmpty() || !value.isCell())
        return {};

    JSC::JSCell* cell = value.asCell();

    switch (cell->type()) {
    case JSC::ErrorInstanceType:
        return JSC::JSValue::encode(value);

    case JSC::CellType:
        if (cell->inherits<JSC::Exception>()) {
            JSC::Exception* exception = uncheckedDowncast<JSC::Exception>(cell);
            // The VM's TerminationException wraps a bare string; it is not an error anyone should see as a value.
            if (exception->vm().isTerminationException(exception))
                return {};
            return JSC::JSValue::encode(exception->value());
        }
    default: {
    }
    }

    return {};
}

#pragma mark - JSC::VM

size_t JSC__VM__runGC(JSC::VM* vm, bool sync)
{
    JSC::JSLockHolder lock(vm);

#if IS_MALLOC_DEBUGGING_ENABLED && OS(DARWIN)
    if (!malloc_zone_check(nullptr)) {
        BUN_PANIC("Heap corruption detected!!");
    }
#endif

    vm->finalizeSynchronousJSExecution();

    if (sync) {
        vm->clearSourceProviderCaches();
        vm->heap.deleteAllUnlinkedCodeBlocks(JSC::PreventCollectionAndDeleteAllCode);
        vm->heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);
#if IS_MALLOC_DEBUGGING_ENABLED && OS(DARWIN)
        malloc_zone_pressure_relief(nullptr, 0);
#endif
    } else {
        vm->heap.deleteAllUnlinkedCodeBlocks(JSC::DeleteAllCodeIfNotCollecting);
        vm->heap.collectSync(JSC::CollectionScope::Full);
    }

    vm->finalizeSynchronousJSExecution();

#if IS_MALLOC_DEBUGGING_ENABLED && OS(DARWIN)
    if (!malloc_zone_check(nullptr)) {
        BUN_PANIC("Heap corruption detected after GC!!");
    }
#endif

    return vm->heap.sizeAfterLastFullCollection();
}

bool JSC__JSValue__isTerminationException(JSC::EncodedJSValue JSValue0)
{
    JSC::Exception* exception = dynamicDowncast<JSC::Exception>(JSC::JSValue::decode(JSValue0));
    if (exception == nullptr)
        return false;

    return exception->vm().isTerminationException(exception);
}

void JSC__VM__shrinkFootprint(JSC::VM* arg0)
{
    arg0->shrinkFootprintWhenIdle();
}

void JSC__VM__holdAPILock(JSC::VM* arg0, void* ctx, void (*callback)(void* arg0))
{
    JSC::JSLockHolder locker(arg0);
    callback(ctx);
}

// The following two functions are copied 1:1 from JSLockHolder to provide a
// new, more ergonomic binding for interacting with the lock from native code
// https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/JSLock.cpp

extern "C" void JSC__VM__getAPILock(JSC::VM* vm)
{
    // https://github.com/WebKit/WebKit/blob/6cb5017d237ef7cb898582a22f05acca22322845/Source/JavaScriptCore/runtime/JSLock.cpp#L67
    vm->apiLock().lock();
}

extern "C" void JSC__VM__releaseAPILock(JSC::VM* vm)
{
    // https://github.com/WebKit/WebKit/blob/6cb5017d237ef7cb898582a22f05acca22322845/Source/JavaScriptCore/runtime/JSLock.cpp#L72
    RefPtr<JSLock> apiLock(&vm->apiLock());
    apiLock->unlock();
}

void JSC__JSString__iterator(JSC::JSString* arg0, JSC::JSGlobalObject* arg1, void* arg2)
{
    jsstring_iterator* iter = (jsstring_iterator*)arg2;
    arg0->value(iter);
}

void JSC__VM__deleteAllCode(JSC::VM* arg1, JSC::JSGlobalObject* globalObject)
{
    JSC::JSLockHolder locker(globalObject->vm());

    arg1->drainMicrotasks();
    {
        auto* moduleLoader = globalObject->moduleLoader();
        WTF::Locker cellLocker { moduleLoader->cellLock() };
        moduleLoader->clearAll();
    }
    arg1->deleteAllCode(JSC::DeleteAllCodeEffort::PreventCollectionAndDeleteAllCode);
    arg1->heap.reportAbandonedObjectGraph();
}

void JSC__VM__reportExtraMemory(JSC::VM* arg0, size_t arg1)
{
    arg0->heap.deprecatedReportExtraMemory(arg1);
}

void JSC__VM__drainMicrotasks(JSC::VM* arg0)
{
    arg0->drainMicrotasks();
}

bool JSC__VM__executionForbidden(JSC::VM* arg0)
{
    return (*arg0).executionForbidden();
}

bool JSC__VM__isEntered(JSC::VM* arg0)
{
    return (*arg0).isEntered();
}

// The TerminationException cell itself (what a pending one reads as), not the error object it wraps.
extern "C" JSC::EncodedJSValue JSC__VM__terminationException(JSC::VM* vm)
{
    return JSC::JSValue::encode(JSC::JSValue(vm->ensureTerminationException()));
}

[[ZIG_EXPORT(nothrow)]]
bool JSC__VM__hasTerminationRequest(JSC::VM* vm)
{
    return vm->hasTerminationRequest();
}

// The one crossing from the loop-level stop into the exception currency: a nested wait/drain inside a
// host function learned of a stop and must hand a JsError to its caller, so it throws the VM's
// TerminationException for real -- what VMTraps::handleTraps(NeedTermination) does. Always leaves it
// pending. The exception object is materialized here (a main-thread VM stopped by SIGINT/forbidExecution
// never had one), and the request bit set (a gate closed by teardown rather than terminate()).
// A nested wait cannot run under a DeferTermination scope: JSC re-throws a deferred termination only at
// that scope's end, so nothing could be pending here for the caller to unwind with.
[[ZIG_EXPORT(check_slow)]]
void JSC__JSGlobalObject__throwTerminationException(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (vm.hasPendingTerminationException())
        return;
    ASSERT_WITH_MESSAGE(!vm.traps().isDeferringTermination(), "a nested wait learned of a stop inside a DeferTermination scope; nothing can be thrown here");
    vm.ensureTerminationException();
    if (!vm.hasTerminationRequest())
        vm.setHasTerminationRequest();
    scope.release();
    vm.throwTerminationException();
}

[[ZIG_EXPORT(nothrow)]]
bool JSC__JSGlobalObject__hasPendingTerminationException(JSC::JSGlobalObject* globalObject)
{
    return JSC::getVM(globalObject).hasPendingTerminationException();
}

// These may be called concurrently from another thread — or from the VM's own thread inside a host call,
// API lock held: VMTraps::fireTrap is CONCURRENT_SAFE and needs no lock either way (releasing the API lock
// here would run JSLock's microtask checkpoint mid-host-call).
void JSC__VM__notifyNeedTermination(JSC::VM* arg0)
{
    arg0->notifyNeedTermination();
}
void JSC__VM__notifyNeedDebuggerBreak(JSC::VM* arg0)
{
    (*arg0).notifyNeedDebuggerBreak();
}
void JSC__VM__notifyNeedShellTimeoutCheck(JSC::VM* arg0)
{
    (*arg0).notifyNeedShellTimeoutCheck();
}

void JSC__VM__throwError(JSC::VM* vm_, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue encodedValue)
{
    JSC::VM& vm = *reinterpret_cast<JSC::VM*>(vm_);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSValue::decode(encodedValue);
    scope.assertNoException(); // can't throw an exception when there's already one.
    ASSERT(!value.isEmpty()); // can't throw an empty value.

    // This case can happen if we did not call .toError() on a JSValue.
    if (value.isCell()) {
        JSC::JSCell* cell = value.asCell();
        if (cell->type() == JSC::CellType && cell->inherits<JSC::Exception>()) {
            scope.throwException(arg1, uncheckedDowncast<JSC::Exception>(value));
            return;
        }
    }

    // Do not call .getObject() on it.
    // https://github.com/oven-sh/bun/issues/13311
    JSC::Exception* exception = JSC::Exception::create(vm, value);
    scope.throwException(arg1, exception);
}

/// **DEPRECATED** This function does not notify the VM about the rejection,
/// meaning it will not trigger unhandled rejection handling. Use JSC__JSPromise__rejectedPromise instead.
JSC::EncodedJSValue JSC__JSPromise__rejectedPromiseValue(JSC::JSGlobalObject* globalObject,
    JSC::EncodedJSValue JSValue1)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSPromise* promise = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    promise->setFlags(static_cast<uint16_t>(JSC::JSPromise::Status::Rejected));
    promise->setSlot(vm, JSC::JSValue::decode(JSValue1));
    JSC::ensureStillAliveHere(promise);
    JSC::ensureStillAliveHere(JSC::JSValue::decode(JSValue1));
    return JSC::JSValue::encode(promise);
}

JSC::EncodedJSValue JSC__JSPromise__resolvedPromiseValue(JSC::JSGlobalObject* globalObject,
    JSC::EncodedJSValue JSValue1)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSPromise* promise = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    promise->setFlags(static_cast<uint16_t>(JSC::JSPromise::Status::Fulfilled));
    promise->setSlot(vm, JSC::JSValue::decode(JSValue1));
    JSC::ensureStillAliveHere(promise);
    JSC::ensureStillAliveHere(JSC::JSValue::decode(JSValue1));
    return JSC::JSValue::encode(promise);
}
}

JSC::EncodedJSValue JSC__JSValue__createUninitializedUint8Array(JSC::JSGlobalObject* arg0, size_t arg1)
{
    JSC::JSValue value = JSC::JSUint8Array::createUninitialized(arg0, arg0->m_typedArrayUint8.get(arg0), arg1);
    return JSC::JSValue::encode(value);
}

// This enum must match BuiltinName in src/jsc/lib.rs
enum class BuiltinNamesMap : uint8_t {
    method,
    headers,
    status,
    statusText,
    url,
    body,
    data,
    toString,
    redirect,
    inspectCustom,
    highWaterMark,
    path,
    stream,
    asyncIterator,
    name,
    message,
    error,
    defaultKeyword,
    encoding,
    fatal,
    ignoreBOM,
    type,
    signal,
    cmd,
    errors,
    // Private names below: set by builtins via $putByIdDirectPrivate, unreachable from user code.
    internal,
    sharedFd,
};

static inline const JSC::Identifier& builtinNameMap(JSC::VM& vm, unsigned char name)
{

    auto clientData = WebCore::clientData(vm);
    switch (static_cast<BuiltinNamesMap>(name)) {
    case BuiltinNamesMap::method: {
        return clientData->builtinNames().methodPublicName();
    }
    case BuiltinNamesMap::headers: {
        return clientData->builtinNames().headersPublicName();
    }
    case BuiltinNamesMap::statusText: {
        return clientData->builtinNames().statusTextPublicName();
    }
    case BuiltinNamesMap::status: {
        return clientData->builtinNames().statusPublicName();
    }
    case BuiltinNamesMap::url: {
        return clientData->builtinNames().urlPublicName();
    }
    case BuiltinNamesMap::body: {
        return clientData->builtinNames().bodyPublicName();
    }
    case BuiltinNamesMap::data: {
        return clientData->builtinNames().dataPublicName();
    }
    case BuiltinNamesMap::toString: {
        return vm.propertyNames->toString;
    }
    case BuiltinNamesMap::redirect: {
        return clientData->builtinNames().redirectPublicName();
    }
    case BuiltinNamesMap::inspectCustom: {
        return clientData->builtinNames().inspectCustomPublicName();
    }
    case BuiltinNamesMap::highWaterMark: {
        return clientData->builtinNames().highWaterMarkPublicName();
    }
    case BuiltinNamesMap::path: {
        return clientData->builtinNames().pathPublicName();
    }
    case BuiltinNamesMap::stream: {
        return clientData->builtinNames().streamPublicName();
    }
    case BuiltinNamesMap::asyncIterator: {
        return vm.propertyNames->asyncIteratorSymbol;
    }
    case BuiltinNamesMap::name: {
        return vm.propertyNames->name;
    }
    case BuiltinNamesMap::message: {
        return vm.propertyNames->message;
    }
    case BuiltinNamesMap::error: {
        return vm.propertyNames->error;
    }
    case BuiltinNamesMap::defaultKeyword: {
        return vm.propertyNames->defaultKeyword;
    }
    case BuiltinNamesMap::encoding: {
        return clientData->builtinNames().encodingPublicName();
    }
    case BuiltinNamesMap::fatal: {
        return clientData->builtinNames().fatalPublicName();
    }
    case BuiltinNamesMap::ignoreBOM: {
        return clientData->builtinNames().ignoreBOMPublicName();
    }
    case BuiltinNamesMap::type: {
        return vm.propertyNames->type;
    }
    case BuiltinNamesMap::signal: {
        return clientData->builtinNames().signalPublicName();
    }
    case BuiltinNamesMap::cmd: {
        return clientData->builtinNames().cmdPublicName();
    }
    case BuiltinNamesMap::errors: {
        return vm.propertyNames->errors;
    }
    case BuiltinNamesMap::internal: {
        return clientData->builtinNames().internalPrivateName();
    }
    case BuiltinNamesMap::sharedFd: {
        return clientData->builtinNames().sharedFdPrivateName();
    }
    default: {
        ASSERT_NOT_REACHED();
        __builtin_unreachable();
    }
    }
}

JSC::EncodedJSValue JSC__JSValue__fastGetDirect_(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, unsigned char arg2)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    ASSERT(value.isCell());
    return JSValue::encode(value.getObject()->getDirect(globalObject->vm(), PropertyName(builtinNameMap(globalObject->vm(), arg2))));
}

// Returns empty for exception, returns deleted if not found.
// Be careful when handling the return value.
JSC::EncodedJSValue JSC__JSValue__fastGet(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, unsigned char arg2)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    ASSERT(value.isCell());

    JSC::JSObject* object = value.getObject();
    ASSERT_WITH_MESSAGE(object, "fastGet() called on non-object. Check that the JSValue is an object before calling fastGet().");
    auto& vm = JSC::getVM(globalObject);

    const auto property = JSC::PropertyName(builtinNameMap(vm, arg2));
    return JSC::JSValue::encode(Bun::getIfPropertyExistsPrototypePollutionMitigationUnsafe(vm, globalObject, object, property));
}

extern "C" JSC::EncodedJSValue JSC__JSValue__fastGetOwn(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, unsigned char arg2)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    ASSERT(value.isCell());
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    PropertySlot slot = PropertySlot(value, PropertySlot::InternalMethodType::GetOwnProperty);
    const Identifier name = builtinNameMap(globalObject->vm(), arg2);
    auto* object = value.getObject();

    bool hasOwnProperty = object->getOwnPropertySlot(object, globalObject, name, slot);
    RETURN_IF_EXCEPTION(scope, {});
    if (hasOwnProperty) {
        RELEASE_AND_RETURN(scope, JSValue::encode(slot.getValue(globalObject, name)));
    }

    return {};
}

__attribute__((__always_inline__)) bool JSC__JSValue__toBoolean(JSC::EncodedJSValue JSValue0)
{
    // We count masquerades as undefined as true.
    return JSValue::decode(JSValue0).pureToBoolean() != TriState::False;
}

extern "C" void JSGlobalObject__throwStackOverflow(JSC::JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    throwStackOverflowError(globalObject, scope);
}

template<bool nonIndexedOnly>
static void JSC__JSValue__forEachPropertyImpl(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, void* arg2, void (*iter)(JSC::JSGlobalObject* arg0, void* ctx, EncodedSlice* arg2, JSC::EncodedJSValue JSValue3, bool isSymbol, bool isPrivateSymbol))
{
    ASSERT_NO_PENDING_EXCEPTION(globalObject);
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    JSC::JSObject* object = value.getObject();
    if (!object)
        return;

    auto& vm = JSC::getVM(globalObject);
    auto throwScopeForStackOverflowException = DECLARE_THROW_SCOPE(vm);

    if (!vm.isSafeToRecurse()) [[unlikely]] {
        throwStackOverflowError(globalObject, throwScopeForStackOverflowException);
        return;
    }

    size_t prototypeCount = 0;
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSC::Structure* structure = object->structure();
    bool fast = !nonIndexedOnly && canPerformFastPropertyEnumerationForIterationBun(structure);
    JSValue prototypeObject = value;

    if (fast) {
        if (structure->outOfLineSize() == 0 && structure->inlineSize() == 0) {
            fast = false;

            JSValue proto = object->getPrototype(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            if (proto) {
                if ((structure = proto.structureOrNull())) {
                    prototypeObject = proto;
                    fast = canPerformFastPropertyEnumerationForIterationBun(structure);
                    prototypeCount = 1;
                }
            }
        }
    }
    auto* propertyNames = vm.propertyNames;
    auto& builtinNames = WebCore::builtinNames(vm);
    JSC::IdentifierSet visitedProperties;

restart:
    if (fast) {
        bool anyHits = false;
        JSC::JSObject* objectToUse = prototypeObject.getObject();

        // The iter callback can run user code (a nested value's inspect.custom, Proxy
        // traps) that adds properties to this object, rehashing the PropertyTable
        // mid-walk (use-after-free). Same for getters resolved through
        // getIfPropertyExists. Collect the entries with no side effects first, then
        // do the getter calls and callbacks on the snapshot.
        struct SnapshottedProperty {
            Identifier key;
            unsigned attributes;
        };
        WTF::Vector<SnapshottedProperty, 16> snapshot;
        // Parallel to `snapshot`; keeps the collected values visible to GC. Empty
        // slots mark prototype properties that are fetched after the walk.
        MarkedArgumentBuffer snapshotValues;

        structure->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
            if ((entry.attributes() & (PropertyAttribute::Function)) == 0 && (entry.attributes() & (PropertyAttribute::Builtin)) != 0) {
                return true;
            }
            auto* prop = entry.key();

            if (prop == propertyNames->constructor
                || prop == propertyNames->underscoreProto
                || prop == propertyNames->toStringTagSymbol || (objectToUse != object && prop == propertyNames->__esModule))
                return true;

            if (builtinNames.bunNativePtrPrivateName() == prop)
                return true;

            if (!visitedProperties.add(prop).isNewEntry)
                return true;

            JSC::JSValue propertyValue = JSValue();
            if (objectToUse == object) {
                propertyValue = objectToUse->getDirect(entry.offset());
                if (!propertyValue)
                    return true;
            }

            snapshot.append({ Identifier::fromUid(vm, prop), entry.attributes() });
            snapshotValues.appendWithCrashOnOverflow(propertyValue);
            return true;
        });

        for (size_t i = 0; i < snapshot.size(); i++) {
            const auto& snapshotted = snapshot[i];
            auto* prop = snapshotted.key.impl();
            EncodedSlice key = toEncodedSlice(prop);

            JSC::JSValue propertyValue = snapshotValues.at(i);
            if (!propertyValue || propertyValue.isGetterSetter() && !((snapshotted.attributes & PropertyAttribute::Accessor) != 0)) {
                propertyValue = objectToUse->getIfPropertyExists(globalObject, prop);
            }

            // Ignore exceptions due to getters.
            CLEAR_IF_EXCEPTION(scope);

            if (!propertyValue)
                continue;

            anyHits = true;
            JSC::EnsureStillAliveScope ensureStillAliveScope(propertyValue);

            bool isPrivate = prop->isSymbol() && snapshotted.key.isPrivateName();

            if (isPrivate && !JSC::Options::showPrivateScriptsInStackTraces())
                continue;

            iter(globalObject, arg2, &key, JSC::JSValue::encode(propertyValue), prop->isSymbol(), isPrivate);
            // Propagate exceptions from callbacks.
            RETURN_IF_EXCEPTION(scope, );
        }

        if (anyHits) {
            if (prototypeCount++ < 5) {

                JSValue proto = prototypeObject.getPrototype(globalObject);
                RETURN_IF_EXCEPTION(scope, );
                if (proto) {
                    if (!(proto == globalObject->objectPrototype() || proto == globalObject->functionPrototype() || (proto.inherits<JSGlobalProxy>() && uncheckedDowncast<JSGlobalProxy>(proto)->target() != globalObject))) {
                        if ((structure = proto.structureOrNull())) {
                            prototypeObject = proto;
                            fast = canPerformFastPropertyEnumerationForIterationBun(structure);
                            goto restart;
                        }
                    }
                }
            }
            return;
        }
    }

    JSC::PropertyNameArrayBuilder properties(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);

    {

        JSObject* iterating = prototypeObject.getObject();

        while (iterating && !(iterating == globalObject->objectPrototype() || iterating == globalObject->functionPrototype() || (iterating->inherits<JSGlobalProxy>() && uncheckedDowncast<JSGlobalProxy>(iterating)->target() != globalObject)) && prototypeCount++ < 5) {
            if constexpr (nonIndexedOnly) {
                iterating->getOwnNonIndexPropertyNames(globalObject, properties, DontEnumPropertiesMode::Include);
            } else {
                iterating->methodTable()->getOwnPropertyNames(iterating, globalObject, properties, DontEnumPropertiesMode::Include);
            }

            RETURN_IF_EXCEPTION(scope, void());
            for (auto& property : properties) {
                if (property.isNull()) [[unlikely]]
                    continue;

                // ignore constructor
                if (property == propertyNames->constructor || builtinNames.bunNativePtrPrivateName() == property)
                    continue;

                if constexpr (nonIndexedOnly) {
                    if (property == propertyNames->length) {
                        continue;
                    }
                }

                JSC::PropertySlot slot(object, PropertySlot::InternalMethodType::Get);
                bool hasProperty = object->getPropertySlot(globalObject, property, slot);
                // Ignore exceptions from "Get" proxy traps and lazy initializers; they also report the property as not found.
                CLEAR_IF_EXCEPTION(scope);
                if (!hasProperty)
                    continue;

                if ((slot.attributes() & PropertyAttribute::DontEnum) != 0) {
                    if (property == propertyNames->underscoreProto
                        || property == propertyNames->toStringTagSymbol || property == propertyNames->__esModule)
                        continue;
                }

                if (!visitedProperties.add(property.impl()).isNewEntry)
                    continue;

                EncodedSlice key = toEncodedSlice(property.isSymbol() && !property.isPrivateName() ? property.impl() : property.string());

                JSC::JSValue propertyValue = jsUndefined();

                if ((slot.attributes() & PropertyAttribute::DontEnum) != 0) {
                    if ((slot.attributes() & PropertyAttribute::Accessor) != 0) {
                        // If we can't use getPureResult, let's at least say it was a [Getter]
                        if (!slot.isCacheableGetter()) {
                            propertyValue = slot.getterSetter();
                        } else {
                            propertyValue = slot.getPureResult();
                        }
                    } else if (slot.attributes() & PropertyAttribute::BuiltinOrFunction) {
                        propertyValue = slot.getValue(globalObject, property);
                    } else if (slot.isCustom()) {
                        propertyValue = slot.getValue(globalObject, property);
                    } else if (slot.isValue()) {
                        propertyValue = slot.getValue(globalObject, property);
                    } else if (object->getOwnPropertySlot(object, globalObject, property, slot)) {
                        RETURN_IF_EXCEPTION(scope, );
                        propertyValue = slot.getValue(globalObject, property);
                    }
                } else if (slot.isAccessor()) {
                    // If we can't use getPureResult, let's at least say it was a [Getter]
                    if (!slot.isCacheableGetter()) {
                        propertyValue = slot.getterSetter();
                    } else {
                        propertyValue = slot.getPureResult();
                    }
                } else {
                    propertyValue = slot.getValue(globalObject, property);
                }

                // Ignore exceptions from getters.
                if (scope.exception()) [[unlikely]] {
                    (void)scope.tryClearException();
                    propertyValue = jsUndefined();
                }

                JSC::EnsureStillAliveScope ensureStillAliveScope(propertyValue);

                bool isPrivate = property.isPrivateName();

                if (isPrivate && !JSC::Options::showPrivateScriptsInStackTraces())
                    continue;

                iter(globalObject, arg2, &key, JSC::JSValue::encode(propertyValue), property.isSymbol(), isPrivate);

                // Propagate exceptions from callbacks.
                RETURN_IF_EXCEPTION(scope, void());
            }
            if constexpr (nonIndexedOnly) {
                break;
            }

            // reuse memory
            properties.data()->propertyNameVector().shrink(0);
            if (iterating->isCallable())
                break;
            if (iterating == globalObject)
                break;
            JSValue prototype = iterating->getPrototype(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            if (!prototype)
                break;
            iterating = prototype.getObject();
        }
    }

    properties.releaseData();
}

[[ZIG_EXPORT(check_slow)]] void JSC__JSValue__forEachProperty(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, void* arg2, void (*iter)([[ZIG_NONNULL]] JSC::JSGlobalObject* arg0, void* ctx, [[ZIG_NONNULL]] EncodedSlice* arg2, JSC::EncodedJSValue JSValue3, bool isSymbol, bool isPrivateSymbol))
{
    JSC__JSValue__forEachPropertyImpl<false>(JSValue0, globalObject, arg2, iter);
}

extern "C" void JSC__JSValue__forEachPropertyNonIndexed(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, void* arg2, void (*iter)(JSC::JSGlobalObject* arg0, void* ctx, EncodedSlice* arg2, JSC::EncodedJSValue JSValue3, bool isSymbol, bool isPrivateSymbol))
{
    JSC__JSValue__forEachPropertyImpl<true>(JSValue0, globalObject, arg2, iter);
}

extern "C" [[ZIG_EXPORT(nothrow)]] bool JSC__isBigIntInUInt64Range(JSC::EncodedJSValue value, uint64_t max, uint64_t min)
{
    JSValue jsValue = JSValue::decode(value);
    if (!jsValue.isHeapBigInt())
        return false;

    JSC::JSBigInt* bigInt = jsValue.asHeapBigInt();
    auto low = bigInt->compare(bigInt, min);
    if (low != JSBigInt::ComparisonResult::GreaterThan && low != JSBigInt::ComparisonResult::Equal)
        return false;
    auto high = bigInt->compare(bigInt, max);
    return high == JSBigInt::ComparisonResult::LessThan || high == JSBigInt::ComparisonResult::Equal;
}

extern "C" [[ZIG_EXPORT(nothrow)]] bool JSC__isBigIntInInt64Range(JSC::EncodedJSValue value, int64_t max, int64_t min)
{
    JSValue jsValue = JSValue::decode(value);
    if (!jsValue.isHeapBigInt())
        return false;

    JSC::JSBigInt* bigInt = jsValue.asHeapBigInt();
    auto low = bigInt->compare(bigInt, min);
    if (low != JSBigInt::ComparisonResult::GreaterThan && low != JSBigInt::ComparisonResult::Equal)
        return false;
    auto high = bigInt->compare(bigInt, max);
    return high == JSBigInt::ComparisonResult::LessThan || high == JSBigInt::ComparisonResult::Equal;
}

[[ZIG_EXPORT(check_slow)]] void JSC__JSValue__forEachPropertyOrdered(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, void* arg2, void (*iter)([[ZIG_NONNULL]] JSC::JSGlobalObject* arg0, void* ctx, [[ZIG_NONNULL]] EncodedSlice* arg2, JSC::EncodedJSValue JSValue3, bool isSymbol, bool isPrivateSymbol))

{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    JSC::JSObject* object = value.getObject();
    if (!object)
        return;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSC::PropertyNameArrayBuilder properties(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    {

        JSC::JSObject::getOwnPropertyNames(object, globalObject, properties, DontEnumPropertiesMode::Include);
        RETURN_IF_EXCEPTION(scope, );
    }

    auto vector = properties.data()->propertyNameVector();
    std::sort(vector.begin(), vector.end(), [&](Identifier a, Identifier b) -> bool {
        const WTF::StringImpl* aImpl = a.isSymbol() && !a.isPrivateName() ? a.impl() : a.string().impl();
        const WTF::StringImpl* bImpl = b.isSymbol() && !b.isPrivateName() ? b.impl() : b.string().impl();
        return codePointCompare(aImpl, bImpl) < 0;
    });
    auto clientData = WebCore::clientData(vm);

    for (auto property : vector) {
        if (property.isNull()) [[unlikely]]
            continue;

        // ignore constructor
        if (property == vm.propertyNames->constructor || clientData->builtinNames().bunNativePtrPrivateName() == property)
            continue;

        JSC::PropertySlot slot(object, PropertySlot::InternalMethodType::Get);
        bool hasProperty = object->getPropertySlot(globalObject, property, slot);
        (void)scope.tryClearException();
        if (!hasProperty) {
            continue;
        }

        if ((slot.attributes() & PropertyAttribute::DontEnum) != 0) {
            if (property == vm.propertyNames->underscoreProto
                || property == vm.propertyNames->toStringTagSymbol)
                continue;
        }

        JSC::JSValue propertyValue = jsUndefined();
        if ((slot.attributes() & PropertyAttribute::DontEnum) != 0) {
            if ((slot.attributes() & PropertyAttribute::Accessor) != 0) {
                propertyValue = slot.getPureResult();
            } else if (slot.attributes() & PropertyAttribute::BuiltinOrFunction) {
                propertyValue = slot.getValue(globalObject, property);
            } else if (slot.isCustom()) {
                propertyValue = slot.getValue(globalObject, property);
            } else if (slot.isValue()) {
                propertyValue = slot.getValue(globalObject, property);
            } else if (object->getOwnPropertySlot(object, globalObject, property, slot)) {
                RETURN_IF_EXCEPTION(scope, );
                propertyValue = slot.getValue(globalObject, property);
            }
        } else if ((slot.attributes() & PropertyAttribute::Accessor) != 0) {
            propertyValue = slot.getPureResult();
        } else {
            propertyValue = slot.getValue(globalObject, property);
        }

        if (scope.exception()) [[unlikely]] {
            (void)scope.tryClearException();
            propertyValue = jsUndefined();
        }

        const WTF::StringImpl* name = property.isSymbol() && !property.isPrivateName() ? property.impl() : property.string().impl();
        EncodedSlice key = toEncodedSlice(name);

        JSC::EnsureStillAliveScope ensureStillAliveScope(propertyValue);
        iter(globalObject, arg2, &key, JSC::JSValue::encode(propertyValue), property.isSymbol(), property.isPrivateName());
        RETURN_IF_EXCEPTION(scope, );
    }
    properties.releaseData();
}

[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isConstructor(JSC::EncodedJSValue JSValue0)
{
    JSValue value = JSValue::decode(JSValue0);
    return value.isConstructor();
}

bool JSC__JSValue__isInstanceOf(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue JSValue1)
{
    VM& vm = globalObject->vm();

    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue jsValue = JSValue::decode(JSValue0);
    JSValue jsValue1 = JSValue::decode(JSValue1);
    if (!jsValue1.isObject()) [[unlikely]] {
        return false;
    }
    JSObject* jsConstructor = JSC::asObject(jsValue1);
    if (!jsConstructor->structure()->typeInfo().implementsHasInstance()) [[unlikely]]
        return false;
    bool result = jsConstructor->hasInstance(globalObject, jsValue);
    RETURN_IF_EXCEPTION(scope, {});

    return result;
}

extern "C" JSC::EncodedJSValue JSC__JSValue__createRopeString(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSString* str0 = JSC::JSValue::decode(JSValue0).toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSString* str1 = JSC::JSValue::decode(JSValue1).toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::jsString(globalObject, str0, str1)));
}

extern "C" size_t JSC__VM__blockBytesAllocated(JSC::VM* vm)
{
#if ENABLE(RESOURCE_USAGE)
    return vm->heap.blockBytesAllocated() + vm->heap.extraMemorySize();
#else
    return 0;
#endif
}
extern "C" size_t JSC__VM__externalMemorySize(JSC::VM* vm)
{
#if ENABLE(RESOURCE_USAGE)
    return vm->heap.externalMemorySize();
#else
    return 0;
#endif
}

extern "C" void JSC__JSGlobalObject__queueMicrotaskJob(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1, JSC::EncodedJSValue JSValue3, JSC::EncodedJSValue JSValue4)
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(arg0);
    JSValue microtaskArgs[] = {
        JSValue::decode(JSValue1),
        globalObject->m_asyncContextData.get()->getInternalField(0),
        JSValue::decode(JSValue3),
        JSValue::decode(JSValue4)
    };

    if (microtaskArgs[1].isEmpty()) {
        microtaskArgs[1] = jsUndefined();
    }

    if (microtaskArgs[2].isEmpty()) {
        microtaskArgs[2] = jsUndefined();
    }

    if (microtaskArgs[3].isEmpty()) {
        microtaskArgs[3] = jsUndefined();
    }
#if ASSERT_ENABLED
    auto& vm = globalObject->vm();
    if (microtaskArgs[0].isCell()) {
        JSC::Integrity::auditCellFully(vm, microtaskArgs[0].asCell());
        if (!microtaskArgs[0].inherits<AsyncContextFrame>()) {
            ASSERT_WITH_MESSAGE(microtaskArgs[0].isCallable(), "queueMicrotask must be called with an async context frame or a callable.");
        }
    }
    if (microtaskArgs[1].isCell()) {
        JSC::Integrity::auditCellFully(vm, microtaskArgs[1].asCell());
    }
    if (microtaskArgs[2].isCell()) {
        JSC::Integrity::auditCellFully(vm, microtaskArgs[2].asCell());
    }
    if (microtaskArgs[3].isCell()) {
        JSC::Integrity::auditCellFully(vm, microtaskArgs[3].asCell());
    }

#endif

    // BunPerformMicrotaskJob: job, asyncContext, arg0, arg1
    JSC::QueuedTask task { nullptr, JSC::InternalMicrotask::BunPerformMicrotaskJob, 0, globalObject, WTF::move(microtaskArgs[0]), WTF::move(microtaskArgs[1]), WTF::move(microtaskArgs[2]), WTF::move(microtaskArgs[3]) };
    globalObject->vm().queueMicrotask(WTF::move(task));
}

extern "C" WebCore::AbortSignal* WebCore__AbortSignal__new(JSC::JSGlobalObject* globalObject)
{
    Zig::GlobalObject* thisObject = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    auto* context = thisObject->scriptExecutionContext();
    RefPtr<WebCore::AbortSignal> abortSignal = WebCore::AbortSignal::create(context);
    return abortSignal.leakRef();
}

extern "C" JSC::EncodedJSValue WebCore__AbortSignal__create(JSC::JSGlobalObject* globalObject)
{
    Zig::GlobalObject* thisObject = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    auto* context = thisObject->scriptExecutionContext();
    auto abortSignal = WebCore::AbortSignal::create(context);

    return JSValue::encode(toJSNewlyCreated<IDLInterface<WebCore::AbortSignal>>(*globalObject, *uncheckedDowncast<JSDOMGlobalObject>(globalObject), WTF::move(abortSignal)));
}
extern "C" JSC::EncodedJSValue WebCore__AbortSignal__toJS(WebCore::AbortSignal* arg0, JSC::JSGlobalObject* globalObject)
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);

    return JSValue::encode(toJS<IDLInterface<WebCore::AbortSignal>>(*globalObject, *uncheckedDowncast<JSDOMGlobalObject>(globalObject), *abortSignal));
}

extern "C" void WebCore__AbortSignal__incrementPendingActivity(WebCore::AbortSignal* arg0)
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);
    abortSignal->incrementPendingActivityCount();
}

extern "C" void WebCore__AbortSignal__decrementPendingActivity(WebCore::AbortSignal* arg0)
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);
    abortSignal->decrementPendingActivityCount();
}

extern "C" void WebCore__AbortSignal__signal(WebCore::AbortSignal* arg0, JSC::JSGlobalObject* globalObject, uint8_t reason)
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);
    abortSignal->signalAbort(
        globalObject,
        static_cast<WebCore::CommonAbortReason>(reason));
}

extern "C" JSC::EncodedJSValue WebCore__AbortSignal__reasonIfAborted(WebCore::AbortSignal* signal, JSC::JSGlobalObject* globalObject, CommonAbortReason* reason)
{
    if (signal->aborted()) {
        *reason = signal->commonReason();
        if (signal->commonReason() != WebCore::CommonAbortReason::None) {
            return JSValue::encode(jsUndefined());
        }

        return JSValue::encode(signal->jsReason(*globalObject));
    }

    return {};
}

extern "C" bool WebCore__AbortSignal__aborted(WebCore::AbortSignal* arg0)
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);
    return abortSignal->aborted();
}

// Same value the JS `signal.reason` getter returns: lazily materializes the
// `DOMException` for a common abort reason and caches it, so repeated reads
// (native or JS) observe the identical object.
extern "C" JSC::EncodedJSValue WebCore__AbortSignal__jsReason(WebCore::AbortSignal* signal, JSC::JSGlobalObject* globalObject)
{
    return JSC::JSValue::encode(signal->jsReason(*globalObject));
}

extern "C" WebCore::AbortSignalTimeout WebCore__AbortSignal__getTimeout(WebCore::AbortSignal* arg0)
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);
    if (!abortSignal->hasActiveTimeoutTimer()) {
        return nullptr;
    }
    return abortSignal->getTimeout();
}

extern "C" void WebCore__AbortSignal__cancelTimer(WebCore::AbortSignal* abortSignal)
{
    abortSignal->cancelTimer();
}

extern "C" WebCore::AbortSignal* WebCore__AbortSignal__ref(WebCore::AbortSignal* abortSignal)
{
    abortSignal->ref();
    return abortSignal;
}

extern "C" void WebCore__AbortSignal__unref(WebCore::AbortSignal* abortSignal)
{
    abortSignal->deref();
}

extern "C" void WebCore__AbortSignal__cleanNativeBindings(WebCore::AbortSignal* abortSignal, void* arg1)
{
    abortSignal->cleanNativeBindings(arg1);
}

extern "C" WebCore::AbortSignal* WebCore__AbortSignal__addListener(WebCore::AbortSignal* abortSignal, void* ctx, void (*callback)(void* ctx, JSC::EncodedJSValue reason))
{
    if (abortSignal->aborted()) {
        auto* context = static_cast<WebCore::EventTarget*>(abortSignal)->scriptExecutionContext();
        auto reason = context ? abortSignal->jsReason(*context->jsGlobalObject()) : abortSignal->reason().getValue(jsNull());
        callback(ctx, JSC::JSValue::encode(reason));
        return abortSignal;
    }
    abortSignal->addNativeCallback(std::make_tuple(ctx, callback));
    return abortSignal;
}
extern "C" WebCore::AbortSignal* WebCore__AbortSignal__fromJS(JSC::EncodedJSValue value)
{
    JSC::JSValue decodedValue = JSC::JSValue::decode(value);
    if (decodedValue.isEmpty())
        return nullptr;
    WebCore::JSAbortSignal* object = dynamicDowncast<WebCore::JSAbortSignal>(decodedValue);
    if (!object)
        return nullptr;

    return reinterpret_cast<WebCore::AbortSignal*>(&object->wrapped());
}

CPP_DECL double JSC__JSValue__getUnixTimestamp(JSC::EncodedJSValue timeValue)
{
    JSC::JSValue decodedValue = JSC::JSValue::decode(timeValue);
    JSC::DateInstance* date = dynamicDowncast<JSC::DateInstance>(decodedValue);
    if (!date)
        return PNaN;

    double number = date->internalNumber();

    return number;
}

extern "C" JSC::EncodedJSValue JSC__JSValue__getOwnByValue(JSC::EncodedJSValue value, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue propertyValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSObject* object = JSValue::decode(value).getObject();
    JSC::JSValue property = JSValue::decode(propertyValue);
    uint32_t index;

    PropertySlot slot(object, PropertySlot::InternalMethodType::GetOwnProperty);
    if (property.getUInt32(index)) {
        bool hasSlot = object->getOwnPropertySlotByIndex(object, globalObject, index, slot);
        RETURN_IF_EXCEPTION(scope, {});
        if (!hasSlot)
            return {};

        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(slot.getValue(globalObject, index)));
    } else {
        auto propertyName = property.toPropertyKey(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (!object->getOwnNonIndexPropertySlot(vm, object->structure(), propertyName, slot))
            return {};

        RETURN_IF_EXCEPTION(scope, {});

        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(slot.getValue(globalObject, propertyName)));
    }
}

extern "C" [[ZIG_EXPORT(check_slow)]] double Bun__parseDate(JSC::JSGlobalObject* globalObject, const BunString* str)
{
    auto& vm = JSC::getVM(globalObject);
    return vm.dateCache.parseDate(globalObject, vm, str->toWTFString());
}

extern "C" [[ZIG_EXPORT(check_slow)]] double Bun__gregorianDateTimeToMS(JSC::JSGlobalObject* globalObject, int year, int month, int day, int hour, int minute, int second, int millisecond, bool localTime)
{
    auto& vm = JSC::getVM(globalObject);
    return vm.dateCache.gregorianDateTimeToMS(year, month - 1, day, hour, minute, second, millisecond, localTime ? WTF::TimeType::LocalTime : WTF::TimeType::UTCTime);
}

extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__msToGregorianDateTime(JSC::JSGlobalObject* globalObject, double ms, bool localTime,
    int* year, int* month, int* day, int* hour, int* minute, int* second, int* weekday)
{
    auto& vm = JSC::getVM(globalObject);
    auto dt = vm.dateCache.msToGregorianDateTime(ms, localTime ? WTF::TimeType::LocalTime : WTF::TimeType::UTCTime);
    *year = dt.year();
    *month = dt.month() + 1;
    *day = dt.monthDay();
    *hour = dt.hour();
    *minute = dt.minute();
    *second = dt.second();
    *weekday = dt.weekDay();
}

extern "C" [[ZIG_EXPORT(nothrow)]] uint32_t Bun__resolveTimeZoneID(const uint8_t* name, size_t len)
{
    auto id = JSC::intlResolveTimeZoneID(StringView { std::span(reinterpret_cast<const Latin1Character*>(name), len) });
    return id ? *id : std::numeric_limits<uint32_t>::max();
}

extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__msToGregorianDateTimeInZone(JSC::JSGlobalObject* globalObject, double ms, uint32_t tzID,
    int* year, int* month, int* day, int* hour, int* minute, int* second, int* weekday)
{
    UNUSED_PARAM(globalObject);
    auto tz = JSC::TimeZone::fromID(tzID);
    auto exact = JSC::ISO8601::ExactTime::fromEpochMilliseconds(static_cast<int64_t>(ms));
    auto off = JSC::TemporalCore::getOffsetNanosecondsFor(tz, exact);
    int64_t offNs = off ? *off : 0;
    auto dt = JSC::TemporalCore::exactTimeToLocalDateAndTime(exact, offNs);
    *year = dt.date.year();
    *month = dt.date.month();
    *day = dt.date.day();
    *hour = static_cast<int>(dt.time.hour());
    *minute = static_cast<int>(dt.time.minute());
    *second = static_cast<int>(dt.time.second());
    // ISO8601::dayOfWeek: 1=Mon..7=Sun; GregorianDateTime consumers expect 0=Sun..6=Sat.
    *weekday = JSC::ISO8601::dayOfWeek(dt.date) % 7;
}

extern "C" [[ZIG_EXPORT(nothrow)]] double Bun__gregorianDateTimeToMSInZone(JSC::JSGlobalObject* globalObject,
    int year, int month, int day, int hour, int minute, int second, int millisecond, uint32_t tzID)
{
    UNUSED_PARAM(globalObject);
    auto tz = JSC::TimeZone::fromID(tzID);
    JSC::ISO8601::PlainDate date { year, static_cast<unsigned>(month), static_cast<unsigned>(day) };
    JSC::ISO8601::PlainTime time { static_cast<unsigned>(hour), static_cast<unsigned>(minute),
        static_cast<unsigned>(second), static_cast<unsigned>(millisecond), 0, 0 };
    auto r = JSC::TemporalCore::getEpochNanosecondsFor(tz, date, time, JSC::TemporalDisambiguation::Compatible);
    if (!r)
        return std::numeric_limits<double>::quiet_NaN();
    return static_cast<double>(r->epochMilliseconds());
}

// Materializes a date/time literal as a Temporal object through the same
// paths `Temporal.*.from(string)` takes. `kind` mirrors the Rust
// `bun_ast::E::TomlDateTimeKind` discriminants.
extern "C" [[ZIG_EXPORT(zero_is_throw)]] EncodedJSValue Bun__Temporal__fromDateTimeLiteral(JSC::JSGlobalObject* globalObject, const uint8_t* text, size_t len, uint8_t kind)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // The Temporal structures on the global object only exist when the
    // option is on; reaching for them would crash.
    if (!JSC::Options::useTemporal()) [[unlikely]] {
        JSC::throwTypeError(globalObject, scope, "Date/time values require Temporal, which is disabled in this process"_s);
        return {};
    }

    WTF::String string { std::span(reinterpret_cast<const Latin1Character*>(text), len) };
    JSC::JSValue item = JSC::jsString(vm, string);

    JSC::JSObject* result = nullptr;
    switch (kind) {
    case 1:
        result = JSC::TemporalInstant::toInstant(globalObject, item);
        break;
    case 2:
        result = JSC::TemporalPlainDateTime::from(globalObject, item, JSC::jsUndefined());
        break;
    case 3:
        result = JSC::TemporalPlainDate::from(globalObject, item, JSC::jsUndefined());
        break;
    case 4:
        result = JSC::TemporalPlainTime::from(globalObject, item, JSC::jsUndefined());
        break;
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(result);
    return JSValue::encode(result);
}

extern "C" [[ZIG_EXPORT(nothrow)]] JSC::TemporalType Bun__JSValue__temporalType(JSC::EncodedJSValue encodedValue)
{
    return JSC::temporalType(JSC::JSValue::decode(encodedValue));
}

static Int128 ceilToMultiple(Int128 ns, Int128 unit)
{
    Int128 rem = ns % unit;
    return rem == 0 ? ns : ns - rem + (ns > 0 ? unit : 0);
}

static Int128 floorToMultiple(Int128 ns, Int128 unit)
{
    Int128 rem = ns % unit;
    return rem == 0 ? ns : ns - rem - (ns < 0 ? unit : 0);
}

// The `±HH:MM` offset to spell `exactTime` with so its local year has TOML's
// four digits: `preferredNs` if that fits, else the closest whole-hour (then
// whole-minute) offset that does; nullopt if none within ±23:59 does.
static std::optional<int64_t> tomlOffsetForInstant(JSC::ISO8601::ExactTime exactTime, int64_t preferredNs)
{
    using JSC::ISO8601::ExactTime;
    constexpr Int128 minLocal = Int128 { -62167219200 } * ExactTime::nsPerSecond; // 0000-01-01T00:00:00
    constexpr Int128 maxLocal = Int128 { 253402300800 } * ExactTime::nsPerSecond; // +010000-01-01T00:00:00
    constexpr Int128 maxOffset = ExactTime::nsPerHour * 23 + ExactTime::nsPerMinute * 59;

    Int128 epoch = exactTime.epochNanoseconds();
    // Whole-minute offsets o with minLocal <= epoch + o < maxLocal.
    Int128 lo = std::max(ceilToMultiple(minLocal - epoch, ExactTime::nsPerMinute), -maxOffset);
    Int128 hi = std::min(floorToMultiple(maxLocal - Int128 { 1 } - epoch, ExactTime::nsPerMinute), maxOffset);
    if (lo > hi)
        return std::nullopt;
    Int128 preferred { preferredNs };
    if (preferred < lo) {
        Int128 hour = ceilToMultiple(lo, ExactTime::nsPerHour);
        return static_cast<int64_t>(hour <= hi ? hour : lo);
    }
    if (preferred > hi) {
        Int128 hour = floorToMultiple(hi, ExactTime::nsPerHour);
        return static_cast<int64_t>(hour >= lo ? hour : hi);
    }
    return preferredNs;
}

// Formats a Temporal object as a TOML date/time literal into `buf` and
// returns the length written, or -1 if its year is outside TOML's
// 0000..9999. The `[u-ca=...]` and `[Time/Zone]` annotations, which TOML
// cannot carry, are dropped.
extern "C" [[ZIG_EXPORT(check_slow)]] int32_t Bun__Temporal__toTOMLDateTime(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, JSC::TemporalType temporalType, uint8_t* buf, size_t bufLen)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSCell* cell = JSC::JSValue::decode(encodedValue).asCell();
    constexpr JSC::PrecisionData autoPrecision { { JSC::Precision::Auto, 0 }, JSC::TemporalUnit::Nanosecond, 1 };

    WTF::String string;
    switch (temporalType) {
    case JSC::TemporalType::Instant: {
        auto exactTime = uncheckedDowncast<JSC::TemporalInstant>(cell)->exactTime();
        std::optional<int64_t> offsetNs = tomlOffsetForInstant(exactTime, 0);
        if (!offsetNs)
            return -1;
        if (!*offsetNs)
            offsetNs = std::nullopt; // `Z`
        string = JSC::TemporalCore::instantToString(exactTime, offsetNs, autoPrecision);
        break;
    }
    case JSC::TemporalType::PlainDateTime: {
        auto* dateTime = uncheckedDowncast<JSC::TemporalPlainDateTime>(cell);
        string = JSC::ISO8601::temporalDateTimeToString(dateTime->plainDate(), dateTime->plainTime(), { JSC::Precision::Auto, 0 });
        break;
    }
    case JSC::TemporalType::PlainDate:
        string = JSC::ISO8601::temporalDateToString(uncheckedDowncast<JSC::TemporalPlainDate>(cell)->plainDate());
        break;
    case JSC::TemporalType::PlainTime:
        string = JSC::ISO8601::temporalTimeToString(uncheckedDowncast<JSC::TemporalPlainTime>(cell)->plainTime(), { JSC::Precision::Auto, 0 });
        break;
    case JSC::TemporalType::ZonedDateTime: {
        auto* zoned = uncheckedDowncast<JSC::TemporalZonedDateTime>(cell);
        std::optional<int64_t> zoneOffsetNs = zoned->getOffsetNanoseconds(globalObject);
        RETURN_IF_EXCEPTION(scope, 0);
        ASSERT(zoneOffsetNs);
        // TOML offsets are `HH:MM`; a historic sub-minute (LMT) offset is
        // spelled as `Z` instead.
        bool wholeMinutes = *zoneOffsetNs % 60000000000ll == 0;
        std::optional<int64_t> offsetNs = tomlOffsetForInstant(zoned->exactTime(), wholeMinutes ? *zoneOffsetNs : 0);
        if (!offsetNs)
            return -1;
        if (!wholeMinutes && !*offsetNs)
            offsetNs = std::nullopt;
        string = JSC::TemporalCore::instantToString(zoned->exactTime(), offsetNs, autoPrecision);
        break;
    }
    default:
        RELEASE_ASSERT_NOT_REACHED();
    }

    // The expanded-year form of a PlainDate/PlainDateTime (`+010000-…`, `-000001-…`).
    if (!isASCIIDigit(string[0]))
        return -1;

    unsigned length = string.length();
    RELEASE_ASSERT(length <= bufLen);
    for (unsigned i = 0; i < length; i++) {
        ASSERT(isASCII(string[i]));
        buf[i] = static_cast<uint8_t>(string[i]);
    }
    return static_cast<int32_t>(length);
}

extern "C" EncodedJSValue JSC__JSValue__dateInstanceFromNumber(JSC::JSGlobalObject* globalObject, double unixTimestamp)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::DateInstance* date = JSC::DateInstance::create(vm, globalObject->dateStructure(), unixTimestamp);
    return JSValue::encode(date);
}

extern "C" EncodedJSValue JSC__JSValue__dateInstanceFromNullTerminatedString(JSC::JSGlobalObject* globalObject, const Latin1Character* nullTerminatedChars)
{
    double dateSeconds = WTF::parseDate(std::span<const Latin1Character>(nullTerminatedChars, strlen(reinterpret_cast<const char*>(nullTerminatedChars))));
    JSC::DateInstance* date = JSC::DateInstance::create(globalObject->vm(), globalObject->dateStructure(), dateSeconds);

    return JSValue::encode(date);
}

// Formats a Date's internal time value with JSC's date cache, as
// `Date.prototype.toISOString` does (`Bun::toISOString` is copied from it).
// Returns -1 when `dateValue` is not a Date or its time value is NaN.
extern "C" int JSC__JSValue__toISOString(EncodedJSValue dateValue, JSC::JSGlobalObject* globalObject, char buf[64])
{
    JSC::DateInstance* thisDateObj = dynamicDowncast<JSC::DateInstance>(JSC::JSValue::decode(dateValue));
    if (!thisDateObj)
        return -1;

    if (!std::isfinite(thisDateObj->internalNumber()))
        return -1;

    auto& vm = JSC::getVM(globalObject);

    return static_cast<int>(Bun::toISOString(vm, thisDateObj->internalNumber(), buf));
}

extern "C" int JSC__JSValue__DateNowISOString(JSC::JSGlobalObject* globalObject, char* buf)
{
    char buffer[29];
    JSC::DateInstance* thisDateObj = JSC::DateInstance::create(globalObject->vm(), globalObject->dateStructure(), globalObject->jsDateNow());

    if (!std::isfinite(thisDateObj->internalNumber()))
        return -1;

    auto& vm = JSC::getVM(globalObject);

    auto gregorianDateTime = thisDateObj->gregorianDateTimeUTC(vm.dateCache);
    if (!gregorianDateTime)
        return -1;

    // If the year is outside the bounds of 0 and 9999 inclusive we want to use the extended year format (ES 15.9.1.15.1).
    int ms = static_cast<int>(fmod(thisDateObj->internalNumber(), msPerSecond));
    if (ms < 0)
        ms += msPerSecond;

    int charactersWritten;
    if (gregorianDateTime.year() > 9999 || gregorianDateTime.year() < 0)
        charactersWritten = snprintf(buffer, sizeof(buffer), "%+07d-%02d-%02dT%02d:%02d:%02d.%03dZ", gregorianDateTime.year(), gregorianDateTime.month() + 1, gregorianDateTime.monthDay(), gregorianDateTime.hour(), gregorianDateTime.minute(), gregorianDateTime.second(), ms);
    else
        charactersWritten = snprintf(buffer, sizeof(buffer), "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", gregorianDateTime.year(), gregorianDateTime.month() + 1, gregorianDateTime.monthDay(), gregorianDateTime.hour(), gregorianDateTime.minute(), gregorianDateTime.second(), ms);

    memcpy(buf, buffer, charactersWritten);

    ASSERT(charactersWritten > 0 && static_cast<unsigned>(charactersWritten) < sizeof(buffer));
    if (static_cast<unsigned>(charactersWritten) >= sizeof(buffer))
        return -1;

    return charactersWritten;
}

#pragma mark - WebCore::DOMFormData

CPP_DECL void WebCore__DOMFormData__append(WebCore::DOMFormData* arg0, const EncodedSlice* arg1, const EncodedSlice* arg2)
{
    arg0->append(toStringCopy(*arg1), toStringCopy(*arg2));
}

CPP_DECL void WebCore__DOMFormData__appendBlob(WebCore::DOMFormData* arg0, JSC::JSGlobalObject* arg1, const EncodedSlice* arg2, void* blobValueInner, const EncodedSlice* fileName)
{
    RefPtr<Blob> blob = WebCore::Blob::create(blobValueInner);
    arg0->append(toStringCopy(*arg2), blob, toStringCopy(*fileName));
}
CPP_DECL size_t WebCore__DOMFormData__count(WebCore::DOMFormData* arg0)
{
    return arg0->count();
}

extern "C" void DOMFormData__toQueryString(
    DOMFormData* formData,
    void* ctx,
    void (*callback)(void* ctx, EncodedSlice* encoded))
{
    auto str = formData->toURLEncodedString();
    EncodedSlice encoded = toEncodedSlice(str);
    callback(ctx, &encoded);
}

CPP_DECL JSC::EncodedJSValue WebCore__DOMFormData__createFromURLQuery(JSC::JSGlobalObject* arg0, const EncodedSlice* arg1)
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(arg0);
    // don't need to copy the string because it internally does.
    auto str = toString(*arg1);
    // toString() in helpers.h returns an empty string when the input exceeds
    // String::MaxLength or Bun's synthetic allocation limit. This is the only
    // condition under which toString() returns empty for non-empty input.
    if (str.isEmpty() && arg1->len > 0) {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        return Bun::ERR::STRING_TOO_LONG(scope, globalObject);
    }
    auto formData = DOMFormData::create(globalObject->scriptExecutionContext(), WTF::move(str));
    return JSValue::encode(toJSNewlyCreated(arg0, globalObject, WTF::move(formData)));
}

CPP_DECL JSC::EncodedJSValue WebCore__DOMFormData__create(JSC::JSGlobalObject* arg0)
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(arg0);
    auto formData = DOMFormData::create(globalObject->scriptExecutionContext());
    return JSValue::encode(toJSNewlyCreated(arg0, globalObject, WTF::move(formData)));
}

CPP_DECL WebCore::DOMFormData* WebCore__DOMFormData__fromJS(JSC::EncodedJSValue JSValue1)
{
    return WebCoreCast<WebCore::JSDOMFormData, WebCore::DOMFormData>(JSValue1);
}

#pragma mark - JSC::JSMap

CPP_DECL [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue JSC__JSMap__create(JSC::JSGlobalObject* arg0)
{
    return JSC::JSValue::encode(JSC::JSMap::create(arg0->vm(), arg0->mapStructure()));
}

// JSMap::get never returns JSValue::zero, even in the case of an exception. The
// best we can, therefore, do is manually test for exceptions.
// NOLINTNEXTLINE(bun-bindgen-force-zero_is_throw-for-jsvalue)
CPP_DECL [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue JSC__JSMap__get(JSC::JSMap* map, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2)
{
    auto& vm = JSC::getVM(arg1);
    const JSC::JSValue key = JSC::JSValue::decode(JSValue2);

    // JSMap::get never returns JSValue::zero, even in the case of an exception.
    // It will return JSValue::undefined and set an exception on the VM.
    auto scope = DECLARE_THROW_SCOPE(vm);
    const JSValue value = map->get(arg1, key);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(value);
}

CPP_DECL [[ZIG_EXPORT(check_slow)]] bool JSC__JSMap__remove(JSC::JSMap* map, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2)
{
    const JSC::JSValue value = JSC::JSValue::decode(JSValue2);
    return map->remove(arg1, value);
}

CPP_DECL [[ZIG_EXPORT(check_slow)]] void JSC__JSMap__clear(JSC::JSMap* map, JSC::JSGlobalObject* arg1)
{
    map->clear(arg1);
}

CPP_DECL [[ZIG_EXPORT(check_slow)]] void JSC__JSMap__set(JSC::JSMap* map, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2, JSC::EncodedJSValue JSValue3)
{
    map->set(arg1, JSC::JSValue::decode(JSValue2), JSC::JSValue::decode(JSValue3));
}

CPP_DECL [[ZIG_EXPORT(nothrow)]] uint32_t JSC__JSMap__size(JSC::JSMap* map)
{
    return map->size();
}

// Enable only: compiled instrumented code holds raw pointers into the profiler,
// so it lives as long as the VM (see JSInspectorProfiler.cpp).
CPP_DECL void JSC__VM__enableControlFlowProfiler(JSC::VM* vm)
{
    if (!vm->controlFlowProfiler())
        vm->enableControlFlowProfiler();
}

extern "C" EncodedJSValue ExpectMatcherUtils__getSingleton(JSC::JSGlobalObject* globalObject_)
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(globalObject_);
    return JSValue::encode(globalObject->m_testMatcherUtilsObject.getInitializedOnMainThread(globalObject));
}

extern "C" EncodedJSValue Expect__getPrototype(JSC::JSGlobalObject* globalObject)
{
    return JSValue::encode(static_cast<Zig::GlobalObject*>(globalObject)->JSExpectPrototype());
}

extern "C" EncodedJSValue ExpectStatic__getPrototype(JSC::JSGlobalObject* globalObject)
{
    return JSValue::encode(static_cast<Zig::GlobalObject*>(globalObject)->JSExpectStaticPrototype());
}

extern "C" EncodedJSValue JSFunction__createFromZig(
    JSC::JSGlobalObject* global,
    const BunString* fn_name,
    NativeFunction implementation,
    unsigned arg_count,
    ImplementationVisibility implementation_visibility,
    Intrinsic intrinsic,
    NativeFunction constructorOrNull)
{
    VM& vm = global->vm();
    auto name = fn_name->toWTFString();
    return JSValue::encode(JSFunction::create(
        vm,
        global,
        arg_count,
        name,
        implementation,
        implementation_visibility,
        intrinsic,
        constructorOrNull ? constructorOrNull : JSC::callHostFunctionAsConstructor,
        nullptr));
}

extern "C" EncodedJSValue JSArray__constructArray(
    JSC::JSGlobalObject* global,
    const JSValue* values,
    size_t values_len)
{
    return JSValue::encode(
        JSC::constructArray(global, (ArrayAllocationProfile*)nullptr, values, values_len));
}

extern "C" EncodedJSValue JSArray__constructEmptyArray(
    JSC::JSGlobalObject* global,
    size_t len)
{
    return JSValue::encode(JSC::constructEmptyArray(global, (ArrayAllocationProfile*)nullptr, len));
}

extern "C" bool JSGlobalObject__hasException(JSC::JSGlobalObject* globalObject)
{
    return DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm()).exception() != 0;
}

extern "C" void JSGlobalObject__clearException(JSC::JSGlobalObject* globalObject)
{
    (void)DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm()).tryClearException();
}

extern "C" bool JSGlobalObject__clearExceptionExceptTermination(JSC::JSGlobalObject* globalObject)
{
    return DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm()).clearExceptionExceptTermination();
}

extern "C" JSC::EncodedJSValue JSGlobalObject__tryTakeException(JSC::JSGlobalObject* globalObject)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());

    if (auto exception = scope.exception()) {
        (void)scope.tryClearException();
        return JSC::JSValue::encode(exception);
    }

    return {};
}

CPP_DECL bool JSC__GetterSetter__isGetterNull(JSC::GetterSetter* gettersetter)
{
    return gettersetter->isGetterNull();
}

CPP_DECL bool JSC__GetterSetter__isSetterNull(JSC::GetterSetter* gettersetter)
{
    return gettersetter->isSetterNull();
}

CPP_DECL [[ZIG_EXPORT(nothrow)]] bool JSC__CustomGetterSetter__isGetterNull(JSC::CustomGetterSetter* gettersetter)
{
    return gettersetter->getter() == nullptr;
}

CPP_DECL [[ZIG_EXPORT(nothrow)]] bool JSC__CustomGetterSetter__isSetterNull(JSC::CustomGetterSetter* gettersetter)
{
    return gettersetter->setter() == nullptr;
}

CPP_DECL JSC::EncodedJSValue Bun__ProxyObject__getInternalField(JSC::EncodedJSValue value, uint32_t id)
{
    return JSValue::encode(uncheckedDowncast<ProxyObject>(JSValue::decode(value))->internalField((ProxyObject::Field)id).get());
}

CPP_DECL JSC::EncodedJSValue Bun__JSValue__getProxyTarget(JSC::EncodedJSValue encoded)
{
    JSC::JSValue value = JSValue::decode(encoded);
    if (!value || !value.isCell())
        return JSValue::encode(JSValue());
    if (auto* proxy = dynamicDowncast<JSGlobalProxy>(value.asCell()))
        return JSValue::encode(proxy->target());
    if (auto* proxy = dynamicDowncast<ProxyObject>(value.asCell()))
        return JSValue::encode(proxy->target());
    return JSValue::encode(JSValue());
}

CPP_DECL JSC::EncodedJSValue Bun__JSValue__getArrayBufferViewBuffer(JSC::EncodedJSValue encoded, JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSValue value = JSValue::decode(encoded);
    if (!value || !value.isCell())
        return JSValue::encode(JSValue());
    if (auto* view = dynamicDowncast<JSArrayBufferView>(value.asCell())) {
        if (ArrayBuffer* buffer = view->possiblySharedBuffer())
            return JSValue::encode(vm.m_typedArrayController->toJS(globalObject, view->realm(), *buffer));
    }
    return JSValue::encode(JSValue());
}

CPP_DECL bool Bun__JSValue__materializeArrayBufferViewBuffer(JSC::EncodedJSValue encoded)
{
    JSC::JSValue value = JSValue::decode(encoded);
    if (!value || !value.isCell())
        return true;
    if (auto* view = dynamicDowncast<JSArrayBufferView>(value.asCell()))
        return view->possiblySharedBuffer() != nullptr;
    // Not a view: nothing to materialize; the caller's type checks decide.
    return true;
}

CPP_DECL size_t Bun__JSValue__getArrayBufferViewByteOffset(JSC::EncodedJSValue encoded)
{
    JSC::JSValue value = JSValue::decode(encoded);
    if (!value || !value.isCell())
        return 0;
    if (auto* view = dynamicDowncast<JSArrayBufferView>(value.asCell()))
        return view->byteOffset();
    return 0;
}

CPP_DECL [[ZIG_EXPORT(nothrow)]] void JSC__SourceProvider__deref(JSC::SourceProvider* provider)
{
    provider->deref();
}

CPP_DECL bool Bun__CallFrame__isFromBunMain(JSC::CallFrame* callFrame, JSC::VM* vm)
{
    auto source = callFrame->callerSourceOrigin(*vm);

    if (source.isNull())
        return false;
    return source.string() == "builtin://bun/main"_s;
}

CPP_DECL void Bun__CallFrame__getCallerSrcLoc(JSC::CallFrame* callFrame, JSC::JSGlobalObject* globalObject, BunString* outSourceURL, unsigned int* outLine, unsigned int* outColumn)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::LineColumn lineColumn;
    String sourceURL;

    JSC::StackVisitor::visit(callFrame, vm, [&](JSC::StackVisitor& visitor) -> WTF::IterationStatus {
        if (Zig::isImplementationVisibilityPrivate(visitor))
            return WTF::IterationStatus::Continue;

        if (visitor->hasLineAndColumnInfo()) {

            lineColumn = visitor->computeLineAndColumn();

            sourceURL = Zig::sourceURL(visitor);

            return WTF::IterationStatus::Done;
        }

        return WTF::IterationStatus::Continue;
    });

    if (!sourceURL.isEmpty() and lineColumn.line > 0) {
        OrdinalNumber originalLine = OrdinalNumber::fromOneBasedInt(lineColumn.line);
        OrdinalNumber originalColumn = OrdinalNumber::fromOneBasedInt(lineColumn.column);

        Bun::OwnedZigStackFrames remappedFrames(1);
        ZigStackFrame& remappedFrame = remappedFrames[0];
        remappedFrame.position.line_zero_based = originalLine.zeroBasedInt();
        remappedFrame.position.column_zero_based = originalColumn.zeroBasedInt();
        remappedFrame.source_url = Bun::toStringRef(sourceURL);

        remappedFrames.remap(Bun::vm(globalObject));

        sourceURL = remappedFrame.source_url.toWTFString();
        lineColumn.line = OrdinalNumber::fromZeroBasedInt(remappedFrame.position.line_zero_based).oneBasedInt();
        lineColumn.column = OrdinalNumber::fromZeroBasedInt(remappedFrame.position.column_zero_based).oneBasedInt();
    }

    *outSourceURL = Bun::toStringRef(sourceURL);
    *outLine = lineColumn.line;
    *outColumn = lineColumn.column;
}

extern "C" EncodedJSValue Bun__JSObject__getCodePropertyVMInquiry(JSC::JSGlobalObject* global, JSC::JSObject* object)
{
    if (!object) [[unlikely]] {
        return {};
    }

    auto& vm = global->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    if (object->type() == JSC::ProxyObjectType) [[unlikely]] {
        return {};
    }

    auto& builtinNames = WebCore::builtinNames(vm);

    PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, &vm);
    scope.assertNoExceptionExceptTermination();
    auto has = object->getNonIndexPropertySlot(global, builtinNames.codePublicName(), slot);
    scope.assertNoExceptionExceptTermination();
    if (!has) {
        return {};
    }

    if (slot.isAccessor() || slot.isCustom()) {
        return {};
    }

    return JSValue::encode(slot.getPureResult());
}

extern "C" void Bun__JSValue__unprotect(JSC::EncodedJSValue encodedValue)
{
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (value && value.isCell()) [[likely]] {
        JSCell* cell = value.asCell();

        // Necessary if we're inside a finalizer due to an assertion.
        JSLockHolder lock(cell->vm());

        gcUnprotect(cell);
    }
}

extern "C" void Bun__JSValue__protect(JSC::EncodedJSValue encodedValue)
{
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (value && value.isCell()) [[likely]] {
        JSCell* cell = value.asCell();
        gcProtect(cell);
    }
}
#if ASSERT_ENABLED
CPP_DECL const char* Bun__CallFrame__describeFrame(JSC::CallFrame* callFrame)
{
    return callFrame->describeFrame();
}
#endif

extern "C" double Bun__JSC__operationMathPow(double x, double y)
{
    return operationMathPow(x, y);
}

// See BunClientData.h.
bool Bun::takeTerminationOutsideScript(JSC::VM& vm, JSC::TopExceptionScope& scope)
{
    if (vm.isEntered())
        return false;
    auto* exception = scope.exception();
    if (!exception || !vm.isTerminationException(exception))
        return false;
    // Every termination that unwinds past the outermost script frame is the VM's stop (node:vm withdraws its own
    // beneath script), and the stop closed the gate before firing the trap.
    ASSERT(!WebCore::clientData(vm)->scriptAllowed());
    scope.clearException();
    // Thrown by a trap check out here, no VM entry exit will reset this for JSC (VM::executeEntryScopeServicesOnExit).
    if (vm.hasTerminationRequest() && !vm.traps().needHandling(JSC::VMTraps::NeedTermination))
        vm.clearHasTerminationRequest();
    vm.setExecutionForbidden();
    return true;
}

extern "C" bool Bun__VM__takeTerminationOutsideScript(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    return Bun::takeTerminationOutsideScript(vm, scope);
}

#if !ENABLE(EXCEPTION_SCOPE_VERIFICATION)
extern "C" [[ZIG_EXPORT(nothrow)]] __attribute__((__always_inline__)) bool Bun__RETURN_IF_EXCEPTION(JSC::JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    RETURN_IF_EXCEPTION(scope, true);
    return false;
}
#endif

CPP_DECL [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Bun__JSValue__bind(JSC::EncodedJSValue functionToBindEncoded, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue bindThisArgEncoded, const BunString* name, double length, JSC::EncodedJSValue* args, size_t args_len)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    JSC::JSValue value = JSC::JSValue::decode(functionToBindEncoded);
    if (!value.isCallable() || !value.isObject()) {
        throwTypeError(globalObject, scope, "bind() called on non-callable"_s);
        RELEASE_AND_RETURN(scope, {});
    }

    SourceCode bindSourceCode = makeSource("bind"_s, SourceOrigin(), SourceTaintedOrigin::Untainted);
    JSC::JSObject* valueObject = value.getObject();
    JSC::JSValue bound = JSC::JSValue::decode(bindThisArgEncoded);
    auto boundFunction = JSBoundFunction::create(globalObject->vm(), globalObject, valueObject, bound, ArgList(args, args_len), length, jsString(globalObject->vm(), name->toWTFString()), bindSourceCode);
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(boundFunction));
}

CPP_DECL [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__JSBoundFunction__boundThis(JSC::EncodedJSValue value)
{
    auto* boundFunction = dynamicDowncast<JSC::JSBoundFunction>(JSC::JSValue::decode(value));
    if (!boundFunction) return JSC::JSValue::encode(JSC::jsUndefined());
    return JSC::JSValue::encode(boundFunction->boundThis());
}

CPP_DECL [[ZIG_EXPORT(check_slow)]] void Bun__JSValue__setPrototypeDirect(JSC::EncodedJSValue valueEncoded, JSC::EncodedJSValue prototypeEncoded, JSC::JSGlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    JSC::JSValue value = JSC::JSValue::decode(valueEncoded);
    JSC::JSValue prototype = JSC::JSValue::decode(prototypeEncoded);
    JSC::JSObject* valueObject = value.getObject();
    valueObject->setPrototypeDirect(globalObject->vm(), prototype);
    RELEASE_AND_RETURN(scope, );
    return;
}

CPP_DECL [[ZIG_EXPORT(nothrow)]] unsigned int Bun__CallFrame__getLineNumber(JSC::CallFrame* callFrame, JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::LineColumn lineColumn;
    String sourceURL;

    JSC::StackVisitor::visit(callFrame, vm, [&](JSC::StackVisitor& visitor) -> WTF::IterationStatus {
        if (Zig::isImplementationVisibilityPrivate(visitor))
            return WTF::IterationStatus::Continue;

        if (visitor->hasLineAndColumnInfo()) {
            String currentSourceURL = Zig::sourceURL(visitor);

            if (!currentSourceURL.startsWith("builtin://"_s) && !currentSourceURL.startsWith("node:"_s)) {
                lineColumn = visitor->computeLineAndColumn();
                sourceURL = currentSourceURL;
                return WTF::IterationStatus::Done;
            }
        }
        return WTF::IterationStatus::Continue;
    });

    if (!sourceURL.isEmpty() && lineColumn.line > 0) {
        Bun::OwnedZigStackFrames remappedFrames(1);
        ZigStackFrame& remappedFrame = remappedFrames[0];
        remappedFrame.position.line_zero_based = lineColumn.line - 1;
        remappedFrame.position.column_zero_based = lineColumn.column;
        remappedFrame.source_url = Bun::toStringRef(sourceURL);

        remappedFrames.remap(Bun::vm(globalObject));

        return remappedFrame.position.line_zero_based + 1;
    }

    return lineColumn.line;
}

// REPL evaluation function - evaluates JavaScript code in the global scope
// Returns the result value, or undefined if an exception was thrown
// If an exception is thrown, the exception value is stored in *exception
extern "C" JSC::EncodedJSValue Bun__REPL__evaluate(
    JSC::JSGlobalObject* globalObject,
    const unsigned char* sourcePtr,
    size_t sourceLen,
    const unsigned char* filenamePtr,
    size_t filenameLen,
    JSC::EncodedJSValue* exception)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    WTF::String source = WTF::String::fromUTF8(std::span { sourcePtr, sourceLen });
    WTF::String filename = filenameLen > 0
        ? WTF::String::fromUTF8(std::span { filenamePtr, filenameLen })
        : "[repl]"_s;

    JSC::SourceCode sourceCode = JSC::makeSource(
        source,
        JSC::SourceOrigin {},
        JSC::SourceTaintedOrigin::Untainted,
        filename,
        WTF::TextPosition(),
        JSC::SourceProviderSourceType::Program);

    WTF::NakedPtr<JSC::Exception> evalException;
    JSC::JSValue result = JSC::evaluate(globalObject, sourceCode, globalObject->globalThis(), evalException);

    if (evalException) {
        *exception = JSC::JSValue::encode(evalException->value());
        // Set _error on the globalObject directly (not globalThis proxy)
        Bun::putDirectNamed(vm, globalObject, "_error"_s, evalException->value());
        scope.clearException();
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    if (scope.exception()) {
        *exception = JSC::JSValue::encode(scope.exception()->value());
        // Set _error on the globalObject directly (not globalThis proxy)
        Bun::putDirectNamed(vm, globalObject, "_error"_s, scope.exception()->value());
        scope.clearException();
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    // Note: _ is now set in src/runtime/cli/repl.rs after extracting the value
    // from the REPL transform wrapper. We don't set it here anymore.

    return JSC::JSValue::encode(result);
}

// REPL completion function - gets completions for a partial property access
// Returns an array of completion strings, or undefined if no completions
extern "C" JSC::EncodedJSValue Bun__REPL__getCompletions(
    JSC::JSGlobalObject* globalObject,
    JSC::EncodedJSValue targetValue,
    const unsigned char* prefixPtr,
    size_t prefixLen)
{
    auto& vm = JSC::getVM(globalObject);
    // The Rust caller (repl.rs) has no exception scope, so nothing may escape.
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto clearAndEncode = [&](JSC::JSValue v) {
        scope.clearException();
        return JSC::JSValue::encode(v);
    };

    JSC::JSValue target = JSC::JSValue::decode(targetValue);
    if (!target || target.isUndefined() || target.isNull()) {
        target = globalObject->globalThis();
    }

    if (!target.isObject()) {
        JSObject* boxed = target.toObject(globalObject);
        if (scope.exception()) [[unlikely]]
            return clearAndEncode(JSC::jsUndefined());
        target = boxed;
    }

    WTF::String prefix = prefixLen > 0
        ? WTF::String::fromUTF8(std::span { prefixPtr, prefixLen })
        : WTF::String();

    // Walk the prototype chain as JSObject::getPropertyNames does (the builder dedups,
    // the depth cap stops misbehaving proxy chains), but skip own index names where that
    // is safe: an index name is never an identifier completion (repl.rs filters them),
    // and collecting one Identifier per element of a large typed array blocks the REPL
    // for minutes (#40281: `buffer.` on a 1 GiB Buffer builds 2^30 names). Classes that
    // override getOwnPropertyNames with their own keys logic (Proxy traps, module
    // namespaces, ...) keep the full hook; their key counts are not element counts.
    JSC::JSObject* object = target.getObject();
    JSC::PropertyNameArrayBuilder propertyNames(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
    unsigned prototypeCount = 0;
    for (JSC::JSObject* current = object;;) {
        if (JSC::isTypedArrayType(current->type()) || !current->structure()->typeInfo().overridesGetOwnPropertyNames())
            current->getOwnNonIndexPropertyNames(globalObject, propertyNames, DontEnumPropertiesMode::Include);
        else
            current->methodTable()->getOwnPropertyNames(current, globalObject, propertyNames, DontEnumPropertiesMode::Include);
        if (scope.exception()) [[unlikely]]
            return clearAndEncode(JSC::jsUndefined());

        JSC::JSValue prototype = current->getPrototype(globalObject);
        if (scope.exception()) [[unlikely]]
            return clearAndEncode(JSC::jsUndefined());
        if (!prototype.isObject() || ++prototypeCount > JSC::JSObject::maximumPrototypeChainDepth)
            break;
        current = JSC::asObject(prototype);
    }

    JSC::JSArray* completions = JSC::constructEmptyArray(globalObject, nullptr, 0);
    if (scope.exception()) [[unlikely]]
        return clearAndEncode(JSC::jsUndefined());

    unsigned completionIndex = 0;
    for (const auto& propertyName : propertyNames) {
        WTF::String name = propertyName.string();
        if (prefix.isEmpty() || name.startsWith(prefix)) {
            completions->putDirectIndex(globalObject, completionIndex++, JSC::jsString(vm, name));
            if (scope.exception()) [[unlikely]]
                return clearAndEncode(JSC::jsUndefined());
        }
    }

    return JSC::JSValue::encode(completions);
}

// One `base.name` step of a completion chain: ordinary property semantics (primitives boxed, prototype chain, getters run), UTF-8 name; a miss or a throwing getter yields undefined.
extern "C" JSC::EncodedJSValue Bun__REPL__getProperty(
    JSC::JSGlobalObject* globalObject,
    JSC::EncodedJSValue baseValue,
    const unsigned char* namePtr,
    size_t nameLen)
{
    auto& vm = JSC::getVM(globalObject);
    // As in Bun__REPL__getCompletions: the Rust caller has no exception scope.
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSC::JSValue base = JSC::JSValue::decode(baseValue);
    WTF::String name = WTF::String::fromUTF8(std::span { namePtr, nameLen });
    if (!base || base.isUndefinedOrNull() || name.isNull())
        return JSC::JSValue::encode(JSC::jsUndefined());

    JSC::JSObject* object = base.toObject(globalObject);
    if (scope.exception()) [[unlikely]] {
        scope.clearException();
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::JSValue result = object->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, name));
    if (scope.exception()) [[unlikely]] {
        scope.clearException();
        return JSC::JSValue::encode(JSC::jsUndefined());
    }
    return JSC::JSValue::encode(result ? result : JSC::jsUndefined());
}

// Format a value for REPL output using util.inspect style
extern "C" JSC::EncodedJSValue Bun__REPL__formatValue(
    JSC::JSGlobalObject* globalObject,
    JSC::EncodedJSValue valueEncoded,
    int32_t depth,
    bool colors)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Get the util.inspect function from the global object
    auto* bunGlobal = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    JSC::JSValue inspectFn = bunGlobal->utilInspectFunction();

    if (!inspectFn || !inspectFn.isCallable()) {
        // Fallback to toString if util.inspect is not available
        JSC::JSValue value = JSC::JSValue::decode(valueEncoded);
        JSString* str = value.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::jsUndefined()));
        return JSC::JSValue::encode(str);
    }

    // Create options object
    JSC::JSObject* options = JSC::constructEmptyObject(globalObject);
    Bun::putDirectNamed(vm, options, "depth"_s, JSC::jsNumber(depth));
    Bun::putDirectNamed(vm, options, "colors"_s, JSC::jsBoolean(colors));
    Bun::putDirectNamed(vm, options, "maxArrayLength"_s, JSC::jsNumber(100));
    Bun::putDirectNamed(vm, options, "maxStringLength"_s, JSC::jsNumber(10000));
    Bun::putDirectNamed(vm, options, "breakLength"_s, JSC::jsNumber(80));

    JSC::MarkedArgumentBuffer args;
    args.append(JSC::JSValue::decode(valueEncoded));
    args.append(options);

    JSC::JSValue result = JSC::call(globalObject, inspectFn, JSC::ArgList(args), "util.inspect"_s);
    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::jsUndefined()));

    return JSC::JSValue::encode(result);
}

// Collects every ArrayBufferView in a JSArray and the (data, byteLength) span
// of each. Two passes, mirroring Buffer.concat: the first reads every element
// into a MarkedArgumentBuffer, so any user code an indexed read can run
// (getters, proxy traps) finishes before the second pass takes raw pointers.
// A backing store detached during the first pass reads back as a zero-length
// span.
//
// When `pinBuffers` is true, each view's backing ArrayBuffer is materialized
// and pinned before its data pointer is read, so the span stays valid after
// control returns to JS (an in-flight async I/O). The caller must balance
// every pinned element with `JSC__JSValue__unpinArrayBuffer`. SharedArrayBuffer
// is never detachable and never moves, so it is left unpinned.
//
// Returns 0 on success, 1 if the value is not a JSArray or an element is not
// an ArrayBufferView, 2 on allocation failure, -1 if an exception is pending.
extern "C" int32_t Bun__JSArray__collectBufferSpans(
    JSC::JSGlobalObject* globalObject,
    JSC::EncodedJSValue encodedValue,
    bool pinBuffers,
    void* ctx,
    void (*append)(void* ctx, JSC::EncodedJSValue element, void* data, size_t byteLength))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (!value.isCell() || !JSC::isJSArray(value.asCell()))
        return 1;
    JSC::JSArray* array = uncheckedDowncast<JSC::JSArray>(value.asCell());

    JSC::MarkedArgumentBuffer values;
    values.ensureCapacity(array->length());
    if (values.hasOverflowed()) [[unlikely]]
        return 2;

    JSC::forEachInArrayLike(globalObject, array, [&](JSC::JSValue element) -> bool {
        values.append(element);
        return true;
    });
    RETURN_IF_EXCEPTION(scope, -1);
    if (values.hasOverflowed()) [[unlikely]]
        return 2;

    for (unsigned i = 0; i < unsigned(values.size()); i++) {
        auto* view = dynamicDowncast<JSC::JSArrayBufferView>(values.at(i));
        if (!view)
            return 1;
        if (pinBuffers) {
            // possiblySharedBuffer() converts a FastTypedArray (GC-movable
            // storage, no ArrayBuffer yet) into a malloc-backed one and can
            // repoint m_vector, so it must run before vector() is read.
            auto* buf = view->possiblySharedBuffer();
            if (!buf) [[unlikely]]
                return 2;
            if (!buf->isShared())
                buf->pin();
        }
        append(ctx, JSC::JSValue::encode(view), view->vector(), view->byteLength());
    }
    return 0;
}

extern "C" const JSC::EncodedJSValue* Bun__JSArray__getContiguousVector(
    JSC::EncodedJSValue encodedValue,
    uint32_t* outLength)
{
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (!value.isCell())
        return nullptr;

    JSC::JSCell* cell = value.asCell();
    if (!JSC::isJSArray(cell))
        return nullptr;

    JSC::JSArray* array = uncheckedDowncast<JSC::JSArray>(cell);
    JSC::IndexingType indexing = array->indexingType();

    // Int32 and Contiguous shapes both store boxed EncodedJSValue in the
    // butterfly. Double / ArrayStorage / Undecided are excluded.
    if (!hasInt32(indexing) && !hasContiguous(indexing))
        return nullptr;

    if (!array->canDoFastIndexedAccess())
        return nullptr;

    JSC::Butterfly* butterfly = array->butterfly();
    uint32_t length = butterfly->publicLength();
    ASSERT(length <= butterfly->vectorLength());

    *outLength = length;
    return reinterpret_cast<const JSC::EncodedJSValue*>(butterfly->contiguous().data());
}

// Revalidates that the array's butterfly storage has not changed since
// getContiguousVector was called. Mirrors the check in JSC's fastArrayJoin
// (ArrayPrototypeInlines.h) which bails to the generic path when a
// side-effecting toString reallocated or transitioned the butterfly.
extern "C" bool Bun__JSArray__contiguousVectorIsStillValid(
    JSC::EncodedJSValue encodedValue,
    const JSC::EncodedJSValue* expected,
    uint32_t expectedLength)
{
    JSC::JSArray* array = uncheckedDowncast<JSC::JSArray>(JSC::JSValue::decode(encodedValue).asCell());
    JSC::IndexingType indexing = array->indexingType();
    if (!hasInt32(indexing) && !hasContiguous(indexing)) [[unlikely]]
        return false;
    if (!array->canDoFastIndexedAccess()) [[unlikely]]
        return false;
    JSC::Butterfly* butterfly = array->butterfly();
    if (butterfly->publicLength() != expectedLength) [[unlikely]]
        return false;
    return reinterpret_cast<const JSC::EncodedJSValue*>(butterfly->contiguous().data()) == expected;
}

// Smallest own present index of a JSArray that is >= `start`, or UINT64_MAX
// when every index from `start` to the end of the array is a hole. Mirrors the
// butterfly walk in JSObject::getOwnIndexedPropertyNames so the caller can skip
// a run of holes without probing each index of a huge sparse array.
extern "C" uint64_t Bun__JSArray__nextPresentIndex(
    JSC::EncodedJSValue encodedValue,
    uint32_t start)
{
    static constexpr uint64_t notFound = std::numeric_limits<uint64_t>::max();

    JSC::JSArray* array = uncheckedDowncast<JSC::JSArray>(JSC::JSValue::decode(encodedValue).asCell());

    switch (array->indexingType()) {
    case ALL_BLANK_INDEXING_TYPES:
    case ALL_UNDECIDED_INDEXING_TYPES:
        return notFound;

    case ALL_INT32_INDEXING_TYPES:
    case ALL_CONTIGUOUS_INDEXING_TYPES: {
        JSC::Butterfly* butterfly = array->butterfly();
        unsigned usedLength = butterfly->publicLength();
        for (unsigned i = start; i < usedLength; ++i) {
            if (butterfly->contiguous().at(array, i))
                return i;
        }
        return notFound;
    }

    case ALL_DOUBLE_INDEXING_TYPES: {
        JSC::Butterfly* butterfly = array->butterfly();
        unsigned usedLength = butterfly->publicLength();
        for (unsigned i = start; i < usedLength; ++i) {
            double value = butterfly->contiguousDouble().at(array, i);
            // In DoubleShape storage the hole is NaN. A real NaN element can
            // never be stored there: JSObject::putByIndex / putDirectIndex
            // convert the array to ContiguousShape first.
            if (value == value)
                return i;
        }
        return notFound;
    }

    case ALL_ARRAY_STORAGE_INDEXING_TYPES: {
        JSC::ArrayStorage* storage = array->butterfly()->arrayStorage();
        unsigned usedVectorLength = std::min(storage->length(), storage->vectorLength());
        for (unsigned i = start; i < usedVectorLength; ++i) {
            if (storage->m_vector[i])
                return i;
        }

        uint64_t result = notFound;
        if (JSC::SparseArrayValueMap* map = storage->m_sparseMap.get()) {
            for (const auto& entry : *map) {
                if (entry.index() >= start && entry.index() < result)
                    result = entry.index();
            }
        }
        return result;
    }

    default:
        ASSERT_NOT_REACHED();
        return start;
    }
}

extern "C" void JSC__ArrayBuffer__ref(JSC::ArrayBuffer* self) { self->ref(); }
extern "C" void JSC__ArrayBuffer__deref(JSC::ArrayBuffer* self) { self->deref(); }
extern "C" void JSC__ArrayBuffer__asBunArrayBuffer(JSC::ArrayBuffer* self, Bun__ArrayBuffer* out)
{
    const std::size_t byteLength = self->byteLength();
    out->ptr = static_cast<char*>(self->data());
    out->len = byteLength;
    out->byte_len = byteLength;
    out->_value = 0;
    out->cell_type = JSC::JSType::ArrayBufferType;
    out->shared = self->isShared();
    out->resizable = self->isResizableOrGrowableShared();
    out->pinned = false;
}
