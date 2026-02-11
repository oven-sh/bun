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
#include "JavaScriptCore/JSArrayInlines.h"
#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/ErrorInstanceInlines.h"
#include "JavaScriptCore/BigIntObject.h"
#include "JavaScriptCore/OrderedHashTableHelper.h"

#include "JavaScriptCore/JSCallbackObject.h"
#include "JavaScriptCore/JSClassRef.h"
#include "JavaScriptCore/JSInternalPromise.h"
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
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ParserError.h"
#include "JavaScriptCore/ScriptExecutable.h"
#include "JavaScriptCore/StackFrame.h"
#include "JavaScriptCore/StackVisitor.h"
#include "JavaScriptCore/VM.h"
#include "JavaScriptCore/WasmFaultSignalHandler.h"
#include "JavaScriptCore/Watchdog.h"
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

#include "JavaScriptCore/FunctionPrototype.h"
#include "JSFetchHeaders.h"
#include "FetchHeaders.h"
#include "DOMURL.h"
#include "JSDOMURL.h"

#include <string_view>
#include <bun-uws/src/App.h>
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
#include "wtf/text/StringToIntegerConversion.h"

#include "JavaScriptCore/GetterSetter.h"
#include "JavaScriptCore/CustomGetterSetter.h"

#include "ErrorStackFrame.h"
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

// Note: keep this in sync with Expect.Flags implementation in zig (at expect.zig)
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

    if (jsDynamicCast<JSExpectAnything*>(matcherPropCell)) {
        if (!readFlagsAndProcessPromise(matcherProp, flags, globalObject, otherProp, constructorType))
            return AsymmetricMatcherResult::FAIL;

        if (otherProp.isUndefinedOrNull()) {
            return AsymmetricMatcherResult::FAIL;
        }

        return AsymmetricMatcherResult::PASS;
    } else if (auto* expectAny = jsDynamicCast<JSExpectAny*>(matcherPropCell)) {
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

            if (jsDynamicCast<BooleanObject*>(otherProp)) {
                return AsymmetricMatcherResult::PASS;
            }

            break;
        }

        case AsymmetricMatcherConstructorType::Number: {
            if (otherProp.isNumber()) {
                return AsymmetricMatcherResult::PASS;
            }

            if (jsDynamicCast<NumberObject*>(otherProp)) {
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
            if (JSC::isArray(globalObject, otherProp)) {
                return AsymmetricMatcherResult::PASS;
            }
            break;
        }

        case AsymmetricMatcherConstructorType::Object: {
            if (otherProp.isObject()) {
                return AsymmetricMatcherResult::PASS;
            }
            break;
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
    } else if (auto* expectStringContaining = jsDynamicCast<JSExpectStringContaining*>(matcherPropCell)) {
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
    } else if (auto* expectStringMatching = jsDynamicCast<JSExpectStringMatching*>(matcherPropCell)) {
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
            } else if (expectedTestValue.isCell() and expectedTestValue.asCell()->type() == RegExpObjectType) {
                if (auto* regex = jsDynamicCast<RegExpObject*>(expectedTestValue)) {
                    JSString* otherString = otherProp.toString(globalObject);
                    if (regex->match(globalObject, otherString)) {
                        return AsymmetricMatcherResult::PASS;
                    }
                }
            }
        }

        return AsymmetricMatcherResult::FAIL;
    } else if (auto* expectArrayContaining = jsDynamicCast<JSExpectArrayContaining*>(matcherPropCell)) {
        if (!readFlagsAndProcessPromise(matcherProp, flags, globalObject, otherProp, constructorType))
            return AsymmetricMatcherResult::FAIL;

        JSValue expectedArrayValue = expectArrayContaining->m_arrayValue.get();

        if (JSC::isArray(globalObject, otherProp)) {
            if (JSC::isArray(globalObject, expectedArrayValue)) {
                JSArray* expectedArray = jsDynamicCast<JSArray*>(expectedArrayValue);
                JSArray* otherArray = jsDynamicCast<JSArray*>(otherProp);

                unsigned expectedLength = expectedArray->length();
                unsigned otherLength = otherArray->length();

                // A empty array is all array's subset
                if (expectedLength == 0) {
                    return AsymmetricMatcherResult::PASS;
                }

                // O(m*n) but works for now
                for (unsigned m = 0; m < expectedLength; m++) {
                    JSValue expectedValue = expectedArray->getIndex(globalObject, m);
                    bool found = false;

                    for (unsigned n = 0; n < otherLength; n++) {
                        JSValue otherValue = otherArray->getIndex(globalObject, n);
                        Vector<std::pair<JSValue, JSValue>, 16> stack;
                        MarkedArgumentBuffer gcBuffer;
                        bool foundNow = Bun__deepEquals<false, true>(globalObject, expectedValue, otherValue, gcBuffer, stack, throwScope, true);
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
        }

        return AsymmetricMatcherResult::FAIL;
    } else if (auto* expectObjectContaining = jsDynamicCast<JSExpectObjectContaining*>(matcherPropCell)) {
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
    } else if (auto* expectCloseTo = jsDynamicCast<JSExpectCloseTo*>(matcherPropCell)) {
        if (!readFlagsAndProcessPromise(matcherProp, flags, globalObject, otherProp, constructorType))
            return AsymmetricMatcherResult::FAIL;

        if (!otherProp.isNumber()) {
            // disable the "not" flag here, because if not a number it should still return FAIL when negated
            flags = flags & ~FLAG_NOT;
            return AsymmetricMatcherResult::FAIL;
        }

        JSValue expectedValue = expectCloseTo->m_numberValue.get();
        JSValue digitsValue = expectCloseTo->m_digitsValue.get();

        double received = otherProp.toNumber(globalObject);
        double expected = expectedValue.toNumber(globalObject);

        constexpr double infinity = std::numeric_limits<double>::infinity();

        // special handing because (Infinity - Infinity) or (-Infinity - -Infinity) is NaN
        if ((received == infinity && expected == infinity) || (received == -infinity && expected == -infinity)) {
            return AsymmetricMatcherResult::PASS;
        } else {
            int32_t digits = digitsValue.toInt32(globalObject);

            double threshold = 0.5 * std::pow(10.0, -digits);
            bool isClose = std::abs(expected - received) < threshold;
            return isClose ? AsymmetricMatcherResult::PASS : AsymmetricMatcherResult::FAIL;
        }
    } else if (auto* customMatcher = jsDynamicCast<JSExpectCustomAsymmetricMatcher*>(matcherPropCell)) {
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

    PropertySlot slot(obj, PropertySlot::InternalMethodType::Get);
    if (obj->methodTable()->getOwnPropertySlotByIndex(obj, globalObject, i, slot)) {
        if (!slot.isAccessor()) {
            return slot.getValue(globalObject, i);
        }
    }

    return JSValue();
}

template<bool isStrict, bool enableAsymmetricMatchers>
std::optional<bool> specialObjectsDequal(JSC::JSGlobalObject* globalObject, MarkedArgumentBuffer& gcBuffer, Vector<std::pair<JSC::JSValue, JSC::JSValue>, 16>& stack, ThrowScope& scope, JSCell* _Nonnull c1, JSCell* _Nonnull c2);

template<bool isStrict, bool enableAsymmetricMatchers>
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
        if (JSC::JSValue::strictEqual(globalObject, values.first, v1)) {
            return JSC::JSValue::strictEqual(globalObject, values.second, v2);
        } else if (JSC::JSValue::strictEqual(globalObject, values.second, v2))
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
    std::optional<bool> isSpecialEqual = specialObjectsDequal<isStrict, enableAsymmetricMatchers>(globalObject, gcBuffer, stack, scope, c1, c2);
    RETURN_IF_EXCEPTION(scope, false);
    if (isSpecialEqual.has_value()) return WTF::move(*isSpecialEqual);
    isSpecialEqual = specialObjectsDequal<isStrict, enableAsymmetricMatchers>(globalObject, gcBuffer, stack, scope, c2, c1);
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
        JSC::JSArray* array1 = JSC::jsCast<JSC::JSArray*>(v1);
        JSC::JSArray* array2 = JSC::jsCast<JSC::JSArray*>(v2);

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

            auto eql = Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, left, right, gcBuffer, stack, scope, true);
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

            auto eql = Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, prop1, prop2, gcBuffer, stack, scope, true);
            RETURN_IF_EXCEPTION(scope, false);
            if (!eql) return false;
        }

        RETURN_IF_EXCEPTION(scope, false);

        return true;
    }

    if constexpr (isStrict) {
        if (!equal(JSObject::calculatedClassName(o1), JSObject::calculatedClassName(o2))) {
            return false;
        }
    }

    JSC::Structure* o1Structure = o1->structure();
    if (!o1Structure->hasNonReifiedStaticProperties() && o1Structure->canPerformFastPropertyEnumeration()) {
        JSC::Structure* o2Structure = o2->structure();
        if (!o2Structure->hasNonReifiedStaticProperties() && o2Structure->canPerformFastPropertyEnumeration()) {

            bool result = true;
            bool sameStructure = o2Structure->id() == o1Structure->id();
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

                    if (left == right) return true;
                    auto same = JSC::sameValue(globalObject, left, right);
                    RETURN_IF_EXCEPTION(scope, false);
                    if (same) return true;

                    auto eql = Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, left, right, gcBuffer, stack, scope, true);
                    RETURN_IF_EXCEPTION(scope, false);
                    if (!eql) {
                        result = false;
                        return false;
                    }

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
                    JSValue right = o2->getDirect(vm, JSC::PropertyName(entry.key()));

                    if constexpr (!isStrict) {
                        if (left.isUndefined() && right.isEmpty()) {
                            return true;
                        }
                    }

                    if (!right) {
                        result = false;
                        return false;
                    }

                    if (left == right) return true;
                    auto same = JSC::sameValue(globalObject, left, right);
                    RETURN_IF_EXCEPTION(scope, false);
                    if (same) return true;

                    auto eql = Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, left, right, gcBuffer, stack, scope, true);
                    RETURN_IF_EXCEPTION(scope, false);
                    if (!eql) {
                        result = false;
                        return false;
                    }

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

                        // Try to get the right value from the left. We don't need to check if they're equal
                        // because the above loop has already iterated each property in the left. If we've
                        // seen this property before, it was already `deepEquals`ed. If it doesn't exist,
                        // the objects are not equal.
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

            return result;
        }
    }

    JSC::PropertyNameArrayBuilder a1(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    JSC::PropertyNameArrayBuilder a2(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    o1->getPropertyNames(globalObject, a1, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, false);
    o2->getPropertyNames(globalObject, a2, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, false);

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

        auto eql = Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, prop1, prop2, gcBuffer, stack, scope, true);
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

template<bool isStrict, bool enableAsymmetricMatchers>
std::optional<bool> specialObjectsDequal(JSC::JSGlobalObject* globalObject, MarkedArgumentBuffer& gcBuffer, Vector<std::pair<JSC::JSValue, JSC::JSValue>, 16>& stack, ThrowScope& scope, JSCell* _Nonnull c1, JSCell* _Nonnull c2)
{
    VM& vm = globalObject->vm();
    uint8_t c1Type = c1->type();
    uint8_t c2Type = c2->type();

    switch (c1Type) {
    case JSSetType: {
        if (c2Type != JSSetType) {
            return false;
        }

        JSSet* set1 = jsCast<JSSet*>(c1);
        JSSet* set2 = jsCast<JSSet*>(c2);

        if (set1->size() != set2->size()) {
            return false;
        }

        auto iter1 = JSSetIterator::create(vm, globalObject->setIteratorStructure(), set1, IterationKind::Keys);
        RETURN_IF_EXCEPTION(scope, {});
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
            RETURN_IF_EXCEPTION(scope, {});
            JSValue key2;
            bool foundMatchingKey = false;
            while (iter2->next(globalObject, key2)) {
                bool equal = Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, key1, key2, gcBuffer, stack, scope, false);
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

        return true;
    }
    case JSMapType: {
        if (c2Type != JSMapType) {
            return false;
        }

        JSMap* map1 = jsCast<JSMap*>(c1);
        JSMap* map2 = jsCast<JSMap*>(c2);
        size_t leftSize = map1->size();

        if (leftSize != map2->size()) {
            return false;
        }

        auto iter1 = JSMapIterator::create(vm, globalObject->mapIteratorStructure(), map1, IterationKind::Entries);
        RETURN_IF_EXCEPTION(scope, {});
        JSValue key1, value1;
        while (iter1->nextKeyValue(globalObject, key1, value1)) {
            JSValue value2 = map2->get(globalObject, key1);
            RETURN_IF_EXCEPTION(scope, {});
            if (value2.isUndefined()) {
                // We couldn't find the key in the second map. This may be a false positive due to
                // how JSValues are represented in JSC, so we need to fall back to a linear search
                // to be sure.
                auto iter2 = JSMapIterator::create(vm, globalObject->mapIteratorStructure(), map2, IterationKind::Entries);
                RETURN_IF_EXCEPTION(scope, {});
                JSValue key2;
                bool foundMatchingKey = false;
                while (iter2->nextKeyValue(globalObject, key2, value2)) {
                    bool keysEqual = Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, key1, key2, gcBuffer, stack, scope, false);
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

            bool valuesEqual = Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, value1, value2, gcBuffer, stack, scope, false);
            RETURN_IF_EXCEPTION(scope, {});
            if (!valuesEqual) {
                return false;
            }
        }

        return true;
    }
    case ArrayBufferType: {
        if (c2Type != ArrayBufferType) {
            return false;
        }

        JSC::ArrayBuffer* left = jsCast<JSArrayBuffer*, JSCell>(c1)->impl();
        JSC::ArrayBuffer* right = jsCast<JSArrayBuffer*, JSCell>(c2)->impl();
        size_t byteLength = left->byteLength();

        if (right->byteLength() != byteLength) {
            return false;
        }

        if (left->isShared() != right->isShared()) [[unlikely]] {
            return false;
        }

        if (byteLength == 0)
            return true;

        if (right->isDetached() || left->isDetached()) [[unlikely]] {
            return false;
        }

        const void* vector = left->data();
        const void* rightVector = right->data();
        if (!vector || !rightVector) [[unlikely]] {
            return false;
        }

        if (vector == rightVector) [[unlikely]]
            return true;

        return (memcmp(vector, rightVector, byteLength) == 0);
    }
    case JSDateType: {
        if (c2Type != JSDateType) {
            return false;
        }

        JSC::DateInstance* left = jsCast<DateInstance*, JSCell>(c1);
        JSC::DateInstance* right = jsCast<DateInstance*, JSCell>(c2);

        return left->internalNumber() == right->internalNumber();
    }
    case RegExpObjectType: {
        if (c2Type != RegExpObjectType) {
            return false;
        }

        if (JSC::RegExpObject* left = jsDynamicCast<JSC::RegExpObject*, JSCell>(c1)) {
            JSC::RegExpObject* right = jsDynamicCast<JSC::RegExpObject*, JSCell>(c2);

            if (!right) [[unlikely]] {
                return false;
            }

            return left->regExp()->key() == right->regExp()->key();
        }

        return false;
    }
    case ErrorInstanceType: {
        if (c2Type != ErrorInstanceType) {
            return false;
        }

        // NOTE(@DonIsaac): could `left` ever _not_ be a JSC::ErrorInstance?
        if (JSC::ErrorInstance* left = jsDynamicCast<JSC::ErrorInstance*, JSCell>(c1)) {
            JSC::ErrorInstance* right = jsDynamicCast<JSC::ErrorInstance*, JSCell>(c2);

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

            if constexpr (isStrict) {
                if (left->runtimeTypeForCause() != right->runtimeTypeForCause()) {
                    return false;
                }
            }

            VM& vm = JSC::getVM(globalObject);

            // `.cause` is non-enumerable, so it must be checked explicitly.
            // note that an undefined cause is different than a missing cause in
            // strict mode.
            const PropertyName cause(vm.propertyNames->cause);
            if constexpr (isStrict) {
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
            bool causesEqual = Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, leftCause, rightCause, gcBuffer, stack, scope, true);
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
            if constexpr (isStrict) {
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

                if constexpr (!isStrict) {
                    if (prop1.isUndefined() && prop2.isEmpty()) {
                        continue;
                    }
                }

                if (!prop2) {
                    return false;
                }

                bool propertiesEqual = Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, prop1, prop2, gcBuffer, stack, scope, true);
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

        JSC::JSArrayBufferView* left = jsCast<JSArrayBufferView*, JSCell>(c1);
        JSC::JSArrayBufferView* right = jsCast<JSArrayBufferView*, JSCell>(c2);
        size_t byteLength = left->byteLength();

        if (right->byteLength() != byteLength) {
            return false;
        }

        if (byteLength == 0)
            return true;

        if (right->isDetached() || left->isDetached()) [[unlikely]] {
            return false;
        }

        const void* vector = left->vector();
        const void* rightVector = right->vector();
        if (!vector || !rightVector) [[unlikely]] {
            return false;
        }

        if (vector == rightVector) [[unlikely]]
            return true;

        // For Float32Array and Float64Array, when not in strict mode, we need to
        // handle +0 and -0 as equal, and NaN as not equal to itself.
        if (!isStrict && (c1Type == Float16ArrayType || c1Type == Float32ArrayType || c1Type == Float64ArrayType)) {
            if (c1Type == Float16ArrayType) {
                auto* leftFloat = static_cast<const WTF::Float16*>(vector);
                auto* rightFloat = static_cast<const WTF::Float16*>(rightVector);
                size_t numElements = byteLength / sizeof(WTF::Float16);

                for (size_t i = 0; i < numElements; i++) {
                    if (leftFloat[i] != rightFloat[i]) {
                        return false;
                    }
                }
                return true;
            } else if (c1Type == Float32ArrayType) {
                auto* leftFloat = static_cast<const float*>(vector);
                auto* rightFloat = static_cast<const float*>(rightVector);
                size_t numElements = byteLength / sizeof(float);

                for (size_t i = 0; i < numElements; i++) {
                    if (leftFloat[i] != rightFloat[i]) {
                        return false;
                    }
                }
                return true;
            } else { // Float64Array
                auto* leftDouble = static_cast<const double*>(vector);
                auto* rightDouble = static_cast<const double*>(rightVector);
                size_t numElements = byteLength / sizeof(double);

                for (size_t i = 0; i < numElements; i++) {
                    if (leftDouble[i] != rightDouble[i]) {
                        return false;
                    }
                }
                return true;
            }
        }

        return (memcmp(vector, rightVector, byteLength) == 0);
    }
    case StringObjectType: {
        if (c2Type != StringObjectType) {
            return false;
        }

        if (!equal(JSObject::calculatedClassName(c1->getObject()), JSObject::calculatedClassName(c2->getObject()))) {
            return false;
        }

        JSString* s1 = c1->toStringInline(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        JSString* s2 = c2->toStringInline(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        bool stringsEqual = s1->equal(globalObject, s2);
        RETURN_IF_EXCEPTION(scope, {});
        return stringsEqual;
    }
    case JSFunctionType: {
        return false;
    }

    case JSAsJSONType:
    case JSDOMWrapperType: {
        if (c2Type == c1Type) {

            // https://github.com/oven-sh/bun/issues/4089
            // https://github.com/oven-sh/bun/issues/6492
            auto* url2 = jsDynamicCast<JSDOMURL*, JSCell>(c2);
            auto* url1 = jsDynamicCast<JSDOMURL*, JSCell>(c1);

            if constexpr (isStrict) {
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
                auto urlSearchParams1 = jsDynamicCast<JSURLSearchParams*, JSCell>(c1);
                auto urlSearchParams2 = jsDynamicCast<JSURLSearchParams*, JSCell>(c2);
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
                    if constexpr (isStrict) {
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
                auto headers1 = jsDynamicCast<JSFetchHeaders*, JSCell>(c1);
                auto headers2 = jsDynamicCast<JSFetchHeaders*, JSCell>(c2);
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
                    if constexpr (isStrict) {
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
    // NOTE: Zig::GlobalObject is tagged as GlobalProxyType
    case GlobalObjectType: {
        if (c1Type != c2Type) return false;
        auto* g1 = jsDynamicCast<JSC::JSGlobalObject*, JSCell>(c1);
        auto* g2 = jsDynamicCast<JSC::JSGlobalObject*, JSCell>(c2);
        return g1->m_globalThis == g2->m_globalThis;
    }
    case GlobalProxyType: {
        if (c1Type != c2Type) return false;
        auto* gp1 = jsDynamicCast<JSC::JSGlobalProxy*, JSCell>(c1);
        auto* gp2 = jsDynamicCast<JSC::JSGlobalProxy*, JSCell>(c2);
        return gp1->target()->m_globalThis == gp2->target()->m_globalThis;
    }
    case NumberObjectType:
    case BooleanObjectType: {
        // Number and Boolean wrapper objects must be the same type and have the same internal value
        if (c1Type != c2Type) return false;
        JSValue val1 = jsCast<JSWrapperObject*>(c1)->internalValue();
        JSValue val2 = jsCast<JSWrapperObject*>(c2)->internalValue();
        bool same = JSC::sameValue(globalObject, val1, val2);
        RETURN_IF_EXCEPTION(scope, {});
        if (!same) return false;
        // Fall through to check own properties
        break;
    }
    default:
        break;
    }
    return std::nullopt;
}

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
    // fast path for reference equality.
    if (objValue == subsetValue) return true;
    VM& vm = globalObject->vm();
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
    if (isArray(globalObject, objValue) && isArray(globalObject, subsetValue)) {
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
                auto eql = Bun__deepEquals<false, true>(globalObject, prop, subsetProp, gcBuffer, stack, throwScope, true);
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
                if (!Bun__deepMatch<enableAsymmetricMatchers>(prop, seenObjProperties, subsetProp, seenSubsetProperties, globalObject, throwScope, gcBuffer, replacePropsWithAsymmetricMatchers, isMatchingObjectContaining)) {
                    return false;
                }
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
template<bool isStrict, bool enableAsymmetricMatchers>
inline bool deepEqualsWrapperImpl(JSC::EncodedJSValue a, JSC::EncodedJSValue b, JSC::JSGlobalObject* global)
{
    auto& vm = global->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Vector<std::pair<JSC::JSValue, JSC::JSValue>, 16> stack;
    MarkedArgumentBuffer args;
    bool result = Bun__deepEquals<isStrict, enableAsymmetricMatchers>(global, JSC::JSValue::decode(a), JSC::JSValue::decode(b), args, stack, scope, true);
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
    headers->relaxAdoptionRequirement();
    return headers;
}
void WebCore__FetchHeaders__append(WebCore::FetchHeaders* headers, const ZigString* arg1, const ZigString* arg2,
    JSC::JSGlobalObject* lexicalGlobalObject)
{
    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
    WebCore::propagateException(*lexicalGlobalObject, throwScope, headers->append(Zig::toString(*arg1), Zig::toString(*arg2)));
    RELEASE_AND_RETURN(throwScope, );
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
    headers->relaxAdoptionRequirement();

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
        JSFetchHeaders* jsHeaders = jsCast<JSFetchHeaders*>(value);
        jsHeaders->computeMemoryCost();
    }

    return JSC::JSValue::encode(value);
}

JSC::EncodedJSValue WebCore__FetchHeaders__clone(WebCore::FetchHeaders* headers, JSC::JSGlobalObject* arg1)
{
    auto throwScope = DECLARE_THROW_SCOPE(arg1->vm());
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(arg1);
    auto* clone = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
    WebCore::propagateException(*arg1, throwScope, clone->fill(*headers));
    return JSC::JSValue::encode(WebCore::toJSNewlyCreated(arg1, globalObject, WTF::move(clone)));
}

WebCore::FetchHeaders* WebCore__FetchHeaders__cloneThis(WebCore::FetchHeaders* headers, JSC::JSGlobalObject* lexicalGlobalObject)
{
    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
    auto* clone = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
    clone->relaxAdoptionRequirement();
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

        if (name.is8Bit() && name.containsOnlyASCII()) {
            const auto nameSpan = name.span8();
            memcpy(&buf[i], nameSpan.data(), nameSpan.size());
            *names = { i, name.length() };
            i += name.length();
        } else {
            ASSERT_WITH_MESSAGE(name.containsOnlyASCII(), "Header name must be ASCII. This should already be validated before calling this function.");
            WTF::CString nameCString = name.utf8();
            memcpy(&buf[i], nameCString.data(), nameCString.length());
            *names = { i, static_cast<uint32_t>(nameCString.length()) };
            i += static_cast<uint32_t>(nameCString.length());
        }

        if (value.length() > 0) {
            if (value.is8Bit() && value.containsOnlyASCII()) {
                const auto valueSpan = value.span8();
                memcpy(&buf[i], valueSpan.data(), valueSpan.size());
                *values = { i, value.length() };
                i += value.length();
            } else {
                // HTTP headers can contain non-ASCII characters according to RFC 7230
                // Non-ASCII content should be properly encoded
                WTF::CString valueCString = value.utf8();
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
        // UTF8 byteLength is not strictly necessary here
        // They should always be ASCII.
        // However, we can still do this out of an abundance of caution
        i += BunString::utf8ByteLength(pair->key);
        i += BunString::utf8ByteLength(pair->value);
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
    headers->relaxAdoptionRequirement(); // This prevents an assertion later, but may not be the proper approach.

    if (pico_headers.len > 0) {
        HTTPHeaderMap map = HTTPHeaderMap();

        size_t end = pico_headers.len;

        for (size_t j = 0; j < end; j++) {
            PicoHTTPHeader header = pico_headers.ptr[j];
            if (header.value.len == 0 || header.name.len == 0)
                continue;

            StringView nameView = StringView(std::span { reinterpret_cast<const char*>(header.name.ptr), header.name.len });

            std::span<Latin1Character> data;
            auto value = String::createUninitialized(header.value.len, data);
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
                // we don't have that information here, so map.setUncommonHeaderCloneName exists
                map.setUncommonHeaderCloneName(nameView, value);
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
    headers->relaxAdoptionRequirement(); // This prevents an assertion later, but may not be the proper approach.

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
            map.setUncommonHeader(nameView.toString().isolatedCopy(), WTF::move(value));
        }
    }
    headers->setInternalHeaders(WTF::move(map));
    return headers;
}
void WebCore__FetchHeaders__deref(WebCore::FetchHeaders* arg0)
{
    arg0->deref();
}

WebCore::FetchHeaders* WebCore__FetchHeaders__createValueNotJS(JSC::JSGlobalObject* arg0, StringPointer* arg1, StringPointer* arg2, const ZigString* arg3, uint32_t count)
{
    auto throwScope = DECLARE_THROW_SCOPE(arg0->vm());
    Vector<KeyValuePair<String, String>> pairs;
    pairs.reserveCapacity(count);
    ZigString buf = *arg3;
    for (uint32_t i = 0; i < count; i++) {
        WTF::String name = Zig::toStringCopy(buf, arg1[i]);
        WTF::String value = Zig::toStringCopy(buf, arg2[i]);
        pairs.unsafeAppendWithoutCapacityCheck(KeyValuePair<String, String>(name, value));
    }

    auto* headers = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
    headers->relaxAdoptionRequirement();
    WebCore::propagateException(*arg0, throwScope, headers->fill(WebCore::FetchHeaders::Init(WTF::move(pairs))));
    if (throwScope.exception()) {
        headers->deref();
        return nullptr;
    }
    return headers;
}

JSC::EncodedJSValue WebCore__FetchHeaders__createValue(JSC::JSGlobalObject* arg0, StringPointer* arg1, StringPointer* arg2, const ZigString* arg3, uint32_t count)
{
    auto throwScope = DECLARE_THROW_SCOPE(arg0->vm());
    Vector<KeyValuePair<String, String>> pairs;
    pairs.reserveCapacity(count);
    ZigString buf = *arg3;
    for (uint32_t i = 0; i < count; i++) {
        WTF::String name = Zig::toStringCopy(buf, arg1[i]);
        WTF::String value = Zig::toStringCopy(buf, arg2[i]);
        pairs.unsafeAppendWithoutCapacityCheck(KeyValuePair<String, String>(name, value));
    }

    Ref<WebCore::FetchHeaders> headers = WebCore::FetchHeaders::create();
    WebCore::propagateException(*arg0, throwScope, headers->fill(WebCore::FetchHeaders::Init(WTF::move(pairs))));

    JSValue value = WebCore::toJSNewlyCreated(arg0, static_cast<Zig::GlobalObject*>(arg0), WTF::move(headers));

    JSFetchHeaders* fetchHeaders = jsCast<JSFetchHeaders*>(value);
    fetchHeaders->computeMemoryCost();
    return JSC::JSValue::encode(fetchHeaders);
}

void WebCore__FetchHeaders__get_(WebCore::FetchHeaders* headers, const ZigString* arg1, ZigString* arg2, JSC::JSGlobalObject* global)
{
    auto throwScope = DECLARE_THROW_SCOPE(global->vm());
    auto result = headers->get(Zig::toString(*arg1));
    if (result.hasException())
        WebCore::propagateException(*global, throwScope, result.releaseException());
    else
        *arg2 = Zig::toZigString(result.releaseReturnValue());
}
bool WebCore__FetchHeaders__has(WebCore::FetchHeaders* headers, const ZigString* arg1, JSC::JSGlobalObject* global)
{
    auto throwScope = DECLARE_THROW_SCOPE(global->vm());
    auto result = headers->has(Zig::toString(*arg1));
    if (result.hasException()) {
        WebCore::propagateException(*global, throwScope, result.releaseException());
        return false;
    } else
        return result.releaseReturnValue();
}
extern "C" void WebCore__FetchHeaders__put(WebCore::FetchHeaders* headers, HTTPHeaderName name, const ZigString* arg2, JSC::JSGlobalObject* global)
{
    auto throwScope = DECLARE_THROW_SCOPE(global->vm());
    throwScope.assertNoException(); // can't throw an exception when there's already one.
    WebCore::propagateException(*global, throwScope, headers->set(name, Zig::toStringCopy(*arg2)));
}
void WebCore__FetchHeaders__remove(WebCore::FetchHeaders* headers, const ZigString* arg1, JSC::JSGlobalObject* global)
{
    auto throwScope = DECLARE_THROW_SCOPE(global->vm());
    WebCore::propagateException(*global, throwScope,
        headers->remove(Zig::toString(*arg1)));
}

void WebCore__FetchHeaders__fastRemove_(WebCore::FetchHeaders* headers, unsigned char headerName)
{
    headers->fastRemove(static_cast<WebCore::HTTPHeaderName>(headerName));
}

void WebCore__FetchHeaders__fastGet_(WebCore::FetchHeaders* headers, unsigned char headerName, ZigString* arg2)
{
    auto str = headers->fastGet(static_cast<WebCore::HTTPHeaderName>(headerName));
    if (!str) {
        return;
    }

    *arg2 = Zig::toZigString(str);
}

WebCore::DOMURL* WebCore__DOMURL__cast_(JSC::EncodedJSValue JSValue0, JSC::VM* vm)
{
    return WebCoreCast<WebCore::JSDOMURL, WebCore::DOMURL>(JSValue0);
}

[[ZIG_EXPORT(nothrow)]] void WebCore__DOMURL__href_(WebCore::DOMURL* domURL, ZigString* arg1)
{
    const WTF::URL& href = domURL->href();
    *arg1 = Zig::toZigString(href.string());
}
[[ZIG_EXPORT(nothrow)]] void WebCore__DOMURL__pathname_(WebCore::DOMURL* domURL, ZigString* arg1)
{
    const WTF::URL& href = domURL->href();
    const WTF::StringView& pathname = href.path();
    *arg1 = Zig::toZigString(pathname);
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

    JSObject* object = asObject(value);

    if (object->inherits<NumberObject>()) {
        return JSValue::encode(jsNumber(object->toNumber(globalObject)));
    }
    if (object->inherits<StringObject>())
        return JSValue::encode(object->toString(globalObject));
    if (object->inherits<BooleanObject>() || object->inherits<BigIntObject>())
        return JSValue::encode(jsCast<JSWrapperObject*>(object)->internalValue());

    return JSValue::encode(object);
}

extern "C" JSC::EncodedJSValue ZigString__toJSONObject(const ZigString* strPtr, JSC::JSGlobalObject* globalObject)
{
    ASSERT_NO_PENDING_EXCEPTION(globalObject);
    auto str = Zig::toString(*strPtr);
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    if (str.isNull()) {
        // isNull() will be true for empty strings and for strings which are too long.
        // So we need to check the length is plausibly due to a long string.
        if (strPtr->len > Bun__stringSyntheticAllocationLimit) {
            scope.throwException(globalObject, Bun::createError(globalObject, Bun::ErrorCode::ERR_STRING_TOO_LONG, "Cannot parse a JSON string longer than 2^32-1 characters"_s));
            return {};
        }
    }

    auto topExceptionScope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
    // JSONParseWithException does not propagate exceptions as expected. See #5859
    JSValue result = JSONParse(globalObject, str);

    if (!result && !topExceptionScope.exception())
        scope.throwException(globalObject, createSyntaxError(globalObject, "Failed to parse JSON"_s));

    if (topExceptionScope.exception()) {
        auto* exception = topExceptionScope.exception();
        topExceptionScope.clearExceptionExceptTermination();
        return JSC::JSValue::encode(exception->value());
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

JSC::EncodedJSValue SystemError__toErrorInstance(const SystemError* arg0, JSC::JSGlobalObject* globalObject)
{
    SystemError err = *arg0;

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    WTF::String message = WTF::emptyString();
    if (err.message.tag != BunStringTag::Empty) {
        message = err.message.toWTFString();
    }

    auto& names = WebCore::builtinNames(vm);

    JSC::JSObject* result = createError(globalObject, ErrorType::Error, message);

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

JSC::EncodedJSValue SystemError__toErrorInstanceWithInfoObject(const SystemError* arg0, JSC::JSGlobalObject* globalObject)
{
    SystemError err = *arg0;

    auto& vm = JSC::getVM(globalObject);

    auto codeString = err.code.toWTFString();
    auto syscallString = err.syscall.toWTFString();
    auto messageString = err.message.toWTFString();

    auto message = makeString("A system error occurred: "_s, syscallString, " returned "_s, codeString, " ("_s, messageString, ")"_s);

    JSC::JSObject* result = JSC::ErrorInstance::create(vm, JSC::ErrorInstance::createStructure(vm, globalObject, globalObject->errorPrototype()), message, {});
    JSC::JSObject* info = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 0);

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
    JSC::JSObject* object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), std::min(static_cast<unsigned>(initialCapacity), JSFinalObject::maxInlineCapacity));

    ArgFn3(arg2, object, globalObject);

    return JSC::JSValue::encode(object);
}

bool JSC__JSValue__hasOwnPropertyValue(JSC::EncodedJSValue value, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue ownKey)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* object = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
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
    return JSC::JSValue::encode(
        JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), std::min(static_cast<unsigned int>(initialCapacity), JSFinalObject::maxInlineCapacity)));
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
        return static_cast<double>(jsCast<JSC::JSArray*>(cell)->length());

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
        return static_cast<double>(jsCast<JSC::JSArrayBufferView*>(cell)->length());

    case JSC::JSType::JSMapType:
        return static_cast<double>(jsCast<JSC::JSMap*>(cell)->size());

    case JSC::JSType::JSSetType:
        return static_cast<double>(jsCast<JSC::JSSet*>(cell)->size());

    case JSC::JSType::JSWeakMapType:
        return static_cast<double>(jsCast<JSC::JSWeakMap*>(cell)->size());

    case JSC::JSType::ArrayBufferType: {
        auto* arrayBuffer = jsCast<JSC::JSArrayBuffer*>(cell);
        if (auto* impl = arrayBuffer->impl()) {
            return static_cast<double>(impl->byteLength());
        }

        return 0;
    }

    case JSDOMWrapperType: {
        if (jsDynamicCast<WebCore::JSFetchHeaders*>(cell))
            return static_cast<double>(jsCast<WebCore::JSFetchHeaders*>(cell)->wrapped().size());

        if (auto* blob = jsDynamicCast<WebCore::JSBlob*>(cell)) {
            uint64_t size = Bun__Blob__getSizeForBindings(blob->wrapped());
            if (size == std::numeric_limits<uint64_t>::max())
                return std::numeric_limits<double>::max();
            return static_cast<double>(size);
        }
    }

    default: {

        if (auto* object = jsDynamicCast<JSObject*>(cell)) {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            scope.release(); // zig binding handles exceptions
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
void JSC__JSObject__putRecord(JSC::JSObject* object, JSC::JSGlobalObject* global, ZigString* key, ZigString* values, size_t valuesLen)
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

        JSC::JSArray* array = nullptr;
        {
            JSC::ObjectInitializationScope initializationScope(global->vm());
            if ((array = JSC::JSArray::tryCreateUninitializedRestricted(initializationScope, nullptr, global->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), valuesLen))) {

                for (size_t i = 0; i < valuesLen; ++i) {
                    array->initializeIndexWithoutBarrier(initializationScope, i, JSC::jsString(global->vm(), Zig::toStringCopy(values[i])));
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
void JSC__JSValue__putRecord(JSC::EncodedJSValue objectValue, JSC::JSGlobalObject* global, ZigString* key,
    ZigString* values, size_t valuesLen)
{
    JSC::JSValue objValue = JSC::JSValue::decode(objectValue);
    JSC::JSObject* object = objValue.asCell()->getObject();
    auto scope = DECLARE_THROW_SCOPE(global->vm());
    auto ident = Zig::toIdentifier(*key, global);
    JSC::PropertyDescriptor descriptor;

    descriptor.setEnumerable(1);
    descriptor.setConfigurable(1);
    descriptor.setWritable(1);

    if (valuesLen == 1) {
        descriptor.setValue(JSC::jsString(global->vm(), Zig::toString(values[0])));
    } else {

        JSC::JSArray* array = nullptr;
        {
            JSC::ObjectInitializationScope initializationScope(global->vm());
            if ((array = JSC::JSArray::tryCreateUninitializedRestricted(
                     initializationScope, nullptr,
                     global->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
                     valuesLen))) {

                for (size_t i = 0; i < valuesLen; ++i) {
                    array->initializeIndexWithoutBarrier(
                        initializationScope, i, JSC::jsString(global->vm(), Zig::toString(values[i])));
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

JSC::JSInternalPromise* JSC__JSValue__asInternalPromise(JSC::EncodedJSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return JSC::jsDynamicCast<JSC::JSInternalPromise*>(value);
}

JSC::JSPromise* JSC__JSValue__asPromise(JSC::EncodedJSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return JSC::jsDynamicCast<JSC::JSPromise*>(value);
}

JSC::EncodedJSValue JSC__JSValue__createInternalPromise(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    return JSC::JSValue::encode(JSC::JSInternalPromise::create(vm, globalObject->internalPromiseStructure()));
}

void JSC__JSFunction__optimizeSoon(JSC::EncodedJSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);

    JSC::optimizeNextInvocation(value);
}

bool JSC__JSFunction__getSourceCode(JSC::EncodedJSValue JSValue0, ZigString* outSourceCode)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (JSC::JSFunction* func = jsDynamicCast<JSC::JSFunction*>(value)) {
        auto* sourceCode = func->sourceCode();
        if (sourceCode != nullptr) { // native functions have no source code
            *outSourceCode = Zig::toZigString(sourceCode->view());
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
unsigned char JSC__JSValue__jsType(JSC::EncodedJSValue JSValue0)
{
    JSC::JSValue jsValue = JSC::JSValue::decode(JSValue0);
    // if the value is NOT a cell
    // asCell will return an invalid pointer rather than a nullptr
    if (jsValue.isCell())
        return jsValue.asCell()->type();

    return 0;
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

    if (JSC::JSPromise* promise = JSC::jsDynamicCast<JSC::JSPromise*>(cell)) {
        handlePromise<JSC::JSPromise, false>(promise, arg1, arg2, ArgFn3, ArgFn4);
    } else if (JSC::jsDynamicCast<JSC::JSInternalPromise*>(cell)) {
        RELEASE_ASSERT(false);
    }
}

JSC::EncodedJSValue JSC__JSGlobalObject__getCachedObject(JSC::JSGlobalObject* globalObject, const ZigString* arg1)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    WTF::String string = Zig::toString(*arg1);
    auto symbol = vm.privateSymbolRegistry().symbolForKey(string);
    JSC::Identifier ident = JSC::Identifier::fromUid(symbol);
    JSC::JSValue result = globalObject->getIfPropertyExists(globalObject, ident);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(result);
}

JSC::EncodedJSValue JSC__JSGlobalObject__putCachedObject(JSC::JSGlobalObject* globalObject, const ZigString* arg1, JSC::EncodedJSValue JSValue2)
{
    auto& vm = JSC::getVM(globalObject);
    WTF::String string = Zig::toString(*arg1);
    auto symbol = vm.privateSymbolRegistry().symbolForKey(string);
    JSC::Identifier ident = JSC::Identifier::fromUid(symbol);
    globalObject->putDirect(vm, ident, JSC::JSValue::decode(JSValue2), JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::DontEnum);
    return JSValue2;
}

void JSC__JSGlobalObject__deleteModuleRegistryEntry(JSC::JSGlobalObject* global, ZigString* arg1)
{
    auto& vm = global->vm();
    JSC::JSMap* map = JSC::jsDynamicCast<JSC::JSMap*>(global->moduleLoader()->getDirect(vm, JSC::Identifier::fromString(vm, "registry"_s)));
    if (!map) return;
    const JSC::Identifier identifier = Zig::toIdentifier(*arg1, global);
    JSC::JSValue val = JSC::identifierToJSValue(vm, identifier);
    map->remove(global, val);
}

void JSC__VM__collectAsync(JSC::VM* vm)
{
    JSC::JSLockHolder lock(*vm);
    vm->heap.collectAsync();
}

extern "C" bool JSC__VM__hasExecutionTimeLimit(JSC::VM* vm)
{
    JSC::JSLockHolder locker(vm);
    if (vm->watchdog()) {
        return vm->watchdog()->hasTimeLimit();
    }

    return false;
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
    return deepEqualsWrapperImpl<false, false>(JSValue0, JSValue1, globalObject);
}

bool JSC__JSValue__jestDeepEquals(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* globalObject)
{
    return deepEqualsWrapperImpl<false, true>(JSValue0, JSValue1, globalObject);
}

bool JSC__JSValue__strictDeepEquals(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* globalObject)
{
    return deepEqualsWrapperImpl<true, false>(JSValue0, JSValue1, globalObject);
}

bool JSC__JSValue__jestStrictDeepEquals(JSC::EncodedJSValue JSValue0, JSC::EncodedJSValue JSValue1, JSC::JSGlobalObject* globalObject)
{
    return deepEqualsWrapperImpl<true, true>(JSValue0, JSValue1, globalObject);
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
    return jsDynamicCast<AsyncContextFrame*>(JSValue::decode(value)) != nullptr;
}

extern "C" JSC::EncodedJSValue Bun__JSValue__call(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue object,
    JSC::EncodedJSValue thisObject, size_t argumentCount,
    const JSC::EncodedJSValue* arguments)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    ASSERT_WITH_MESSAGE(!vm.isCollectorBusyOnCurrentThread(), "Cannot call function inside a finalizer or while GC is running on same thread.");

    JSC::JSValue jsObject = JSValue::decode(object);
    ASSERT_WITH_MESSAGE(jsObject, "Cannot call function with JSValue zero.");

    JSC::JSValue jsThisObject = JSValue::decode(thisObject);

    JSValue restoreAsyncContext;
    InternalFieldTuple* asyncContextData = nullptr;
    if (auto* wrapper = jsDynamicCast<AsyncContextFrame*>(jsObject)) {
        jsObject = jsCast<JSC::JSFunction*>(wrapper->callback.get());
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
    JSC::Integrity::auditCellFully(vm, jsObject.asCell());
#endif

    auto callData = getCallData(jsObject);

    ASSERT_WITH_MESSAGE(jsObject.isCallable(), "Function passed to .call must be callable.");
    ASSERT(callData.type != JSC::CallData::Type::None);
    if (callData.type == JSC::CallData::Type::None)
        return {};

    auto result = JSC::profiledCall(globalObject, ProfilingReason::API, jsObject, callData, jsThisObject, argList);

    if (asyncContextData) {
        asyncContextData->putInternalField(vm, 0, restoreAsyncContext);
    }

    RETURN_IF_EXCEPTION(scope, {});
    return JSC::JSValue::encode(result);
}

JSC::EncodedJSValue JSObjectCallAsFunctionReturnValueHoldingAPILock(JSContextRef ctx, JSObjectRef object,
    JSObjectRef thisObject,
    size_t argumentCount,
    const JSValueRef* arguments)
{
    JSC::JSGlobalObject* globalObject = toJS(ctx);
    auto& vm = JSC::getVM(globalObject);

    JSC::JSLockHolder lock(vm);

#if ASSERT_ENABLED
    // This is a redundant check, but we add it to make the error message clearer.
    ASSERT_WITH_MESSAGE(!vm.isCollectorBusyOnCurrentThread(), "Cannot call function inside a finalizer or while GC is running on same thread.");
#endif

    if (!object)
        return {};

    JSC::JSObject* jsObject = toJS(object);
    JSC::JSObject* jsThisObject = toJS(thisObject);

    if (!jsThisObject)
        jsThisObject = globalObject->globalThis();

    JSC::MarkedArgumentBuffer argList;
    for (size_t i = 0; i < argumentCount; i++)
        argList.append(toJS(globalObject, arguments[i]));

    auto callData = getCallData(jsObject);
    if (callData.type == JSC::CallData::Type::None)
        return {};

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = call(globalObject, jsObject, callData, jsThisObject, argList, returnedException);

    if (returnedException.get()) {
        return JSC::JSValue::encode(returnedException.get());
    }

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

JSC::EncodedJSValue JSC__JSObject__getDirect(JSC::JSObject* arg0, JSC::JSGlobalObject* arg1,
    const ZigString* arg2)
{
    return JSC::JSValue::encode(arg0->getDirect(arg1->vm(), Zig::toIdentifier(*arg2, arg1)));
}
void JSC__JSObject__putDirect(JSC::JSObject* arg0, JSC::JSGlobalObject* arg1, const ZigString* key,
    JSC::EncodedJSValue value)
{
    auto prop = Zig::toIdentifier(*key, arg1);

    arg0->putDirect(arg1->vm(), prop, JSC::JSValue::decode(value));
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

void JSC__JSString__toZigString(JSC::JSString* arg0, JSC::JSGlobalObject* arg1, ZigString* arg2)
{
    auto value = arg0->value(arg1);
    *arg2 = Zig::toZigString(value.data.impl());

    // We don't need to assert here because ->value returns a reference to the same string as the one owned by the JSString.
}

bool JSC__JSString__eql(const JSC::JSString* arg0, JSC::JSGlobalObject* obj, JSC::JSString* arg2)
{
    return arg0->equal(obj, arg2);
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
extern "C" JSC::JSInternalPromise* JSModuleLoader__import(JSC::JSGlobalObject* globalObject, const BunString* moduleNameStr)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* promise = JSC::importModule(globalObject, JSC::Identifier::fromString(vm, moduleNameStr->toWTFString()), jsUndefined(), jsUndefined(), jsUndefined());

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

    JSC::SourceCode sourceCode = JSC::makeSource(
        src, JSC::SourceOrigin { origin }, JSC::SourceTaintedOrigin::Untainted, origin.fileSystemPath(),
        WTF::TextPosition(), JSC::SourceProviderSourceType::Module);
    globalObject->moduleLoader()->provideFetch(globalObject, jsString(vm, origin.fileSystemPath()), WTF::move(sourceCode));
    auto* promise = JSC::importModule(globalObject, JSC::Identifier::fromString(vm, origin.fileSystemPath()), JSValue(jsString(vm, referrer.fileSystemPath())), JSValue(), JSValue());

    auto scope = DECLARE_THROW_SCOPE(vm);

    if (scope.exception()) [[unlikely]] {
        promise->rejectWithCaughtException(globalObject, scope);
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

[[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue ReadableStream__empty(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto clientData = WebCore::clientData(vm);
    auto* function = globalObject->getDirect(vm, clientData->builtinNames().createEmptyReadableStreamPrivateName()).getObject();
    JSValue emptyStream = JSC::call(globalObject, function, JSC::ArgList(), "ReadableStream.create"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(emptyStream);
}

[[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue ReadableStream__used(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto clientData = WebCore::clientData(vm);
    auto* function = globalObject->getDirect(vm, clientData->builtinNames().createUsedReadableStreamPrivateName()).getObject();
    JSValue usedStream = JSC::call(globalObject, function, JSC::ArgList(), "ReadableStream.create"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(usedStream);
}

JSC::EncodedJSValue JSC__JSValue__createRangeError(const ZigString* message, const ZigString* arg1,
    JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    ZigString code = *arg1;
    JSC::JSObject* rangeError = Zig::getRangeErrorInstance(message, globalObject).asCell()->getObject();

    if (code.len > 0) {
        auto clientData = WebCore::clientData(vm);
        JSC::JSValue codeValue = Zig::toJSString(code, globalObject);
        rangeError->putDirect(vm, clientData->builtinNames().codePublicName(), codeValue,
            JSC::PropertyAttribute::ReadOnly | 0);
    }

    return JSC::JSValue::encode(rangeError);
}

JSC::EncodedJSValue JSC__JSValue__createTypeError(const ZigString* message, const ZigString* arg1,
    JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    ZigString code = *arg1;
    JSC::JSObject* typeError = Zig::getTypeErrorInstance(message, globalObject).asCell()->getObject();

    if (code.len > 0) {
        auto clientData = WebCore::clientData(vm);
        JSC::JSValue codeValue = Zig::toJSString(code, globalObject);
        typeError->putDirect(vm, clientData->builtinNames().codePublicName(), codeValue, 0);
    }

    return JSC::JSValue::encode(typeError);
}

JSC::EncodedJSValue JSC__JSValue__fromEntries(JSC::JSGlobalObject* globalObject, ZigString* keys,
    ZigString* values, size_t initialCapacity, bool clone)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (initialCapacity == 0) {
        return JSC::JSValue::encode(JSC::constructEmptyObject(globalObject));
    }

    JSC::JSObject* object = nullptr;
    {
        JSC::ObjectInitializationScope initializationScope(vm);
        object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), std::min(static_cast<unsigned int>(initialCapacity), JSFinalObject::maxInlineCapacity));

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
        JSC::JSArrayBufferView* view = JSC::jsCast<JSC::JSArrayBufferView*>(value);
        data = view->vector();
        out->len = view->length();
        out->byte_len = view->byteLength();
        out->cell_type = type;
        out->shared = view->isShared();
        break;
    }
    case JSC::JSType::ArrayBufferType: {
        JSC::ArrayBuffer* buffer = JSC::jsCast<JSC::JSArrayBuffer*>(value)->impl();
        data = buffer->data();
        out->len = buffer->byteLength();
        out->byte_len = buffer->byteLength();
        out->cell_type = JSC::JSType::ArrayBufferType;
        out->shared = buffer->isShared();
        break;
    }
    case JSC::JSType::ObjectType:
    case JSC::JSType::FinalObjectType: {
        if (JSC::JSArrayBufferView* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(value)) {
            data = view->vector();
            out->len = view->length();
            out->byte_len = view->byteLength();
            out->cell_type = view->type();
            out->shared = view->isShared();
        } else if (JSC::JSArrayBuffer* jsBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(value)) {
            JSC::ArrayBuffer* buffer = jsBuffer->impl();
            if (!buffer)
                return false;
            data = buffer->data();
            out->len = buffer->byteLength();
            out->byte_len = buffer->byteLength();
            out->cell_type = JSC::JSType::ArrayBufferType;
            out->shared = buffer->isShared();
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
    return true;
}

CPP_DECL JSC::EncodedJSValue JSC__JSValue__createEmptyArray(JSC::JSGlobalObject* arg0, size_t length)
{
    return JSC::JSValue::encode(JSC::constructEmptyArray(arg0, nullptr, length));
}
CPP_DECL void JSC__JSValue__putIndex(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, uint32_t arg2, JSC::EncodedJSValue JSValue3)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    JSC::JSValue value2 = JSC::JSValue::decode(JSValue3);
    JSC::JSArray* array = JSC::jsCast<JSC::JSArray*>(value);
    array->putDirectIndex(arg1, arg2, value2);
}

CPP_DECL void JSC__JSValue__push(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue3)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    JSC::JSValue value2 = JSC::JSValue::decode(JSValue3);
    JSC::JSArray* array = JSC::jsCast<JSC::JSArray*>(value);
    array->push(arg1, value2);
}

JSC::EncodedJSValue JSC__JSGlobalObject__createAggregateError(JSC::JSGlobalObject* globalObject,
    const JSValue* errors, size_t errors_count,
    const ZigString* arg3)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    WTF::String message = Zig::toString(*arg3);
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
JSC::EncodedJSValue JSC__JSGlobalObject__createAggregateErrorWithArray(JSC::JSGlobalObject* global, JSC::JSArray* array, BunString message, JSValue cause)
{
    auto& vm = JSC::getVM(global);
    JSC::Structure* errorStructure = global->errorStructure(JSC::ErrorType::AggregateError);
    WTF::String messageString = message.toWTFString();
    return JSC::JSValue::encode(JSC::createAggregateError(vm, errorStructure, array, messageString, cause, nullptr, JSC::TypeNothing, false));
}

JSC::EncodedJSValue ZigString__toAtomicValue(const ZigString* arg0, JSC::JSGlobalObject* arg1)
{
    if (arg0->len == 0) {
        return JSC::JSValue::encode(JSC::jsEmptyString(arg1->vm()));
    }

    if (isTaggedUTF16Ptr(arg0->ptr)) {
        if (auto impl = WTF::AtomStringImpl::lookUp(std::span { reinterpret_cast<const char16_t*>(untag(arg0->ptr)), arg0->len })) {
            return JSC::JSValue::encode(JSC::jsString(arg1->vm(), WTF::String(WTF::move(impl))));
        }
    } else {
        if (auto impl = WTF::AtomStringImpl::lookUp(std::span { untag(arg0->ptr), arg0->len })) {
            return JSC::JSValue::encode(JSC::jsString(arg1->vm(), WTF::String(WTF::move(impl))));
        }
    }

    return JSC::JSValue::encode(JSC::jsString(arg1->vm(), makeAtomString(Zig::toStringCopy(*arg0))));
}

JSC::EncodedJSValue ZigString__to16BitValue(const ZigString* arg0, JSC::JSGlobalObject* arg1)
{
    auto str = WTF::String::fromUTF8(std::span { arg0->ptr, arg0->len });
    return JSC::JSValue::encode(JSC::jsString(arg1->vm(), str));
}

JSC::EncodedJSValue ZigString__toExternalU16(const uint16_t* arg0, size_t len, JSC::JSGlobalObject* global)
{
    if (len == 0) {
        return JSC::JSValue::encode(JSC::jsEmptyString(global->vm()));
    }

    auto ref = String(ExternalStringImpl::create({ reinterpret_cast<const char16_t*>(arg0), len }, reinterpret_cast<void*>(const_cast<uint16_t*>(arg0)), free_global_string));

    return JSC::JSValue::encode(JSC::jsString(global->vm(), WTF::move(ref)));
}

// This must be a globally allocated string
[[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue ZigString__toExternalValue(const ZigString* arg0, JSC::JSGlobalObject* arg1)
{
    ZigString str = *arg0;
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

VirtualMachine* JSC__JSGlobalObject__bunVM(JSC::JSGlobalObject* arg0)
{
    return reinterpret_cast<VirtualMachine*>(WebCore::clientData(arg0->vm())->bunVM);
}

JSC::EncodedJSValue ZigString__toValueGC(const ZigString* arg0, JSC::JSGlobalObject* arg1)
{
    return JSC::JSValue::encode(JSC::jsString(arg1->vm(), Zig::toStringCopy(*arg0)));
}

void JSC__JSValue__toZigString(JSC::EncodedJSValue JSValue0, ZigString* arg1, JSC::JSGlobalObject* arg2)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);

    // if (!value.isString()) {
    //   arg1->len = 0;
    //   arg1->ptr = nullptr;
    //   return;
    // }

    auto* strValue = value.toStringOrNull(arg2);

    if (!strValue) [[unlikely]] {
        arg1->len = 0;
        arg1->ptr = nullptr;
        return;
    }

    auto str = strValue->value(arg2);

    if (str->is8Bit()) {
        arg1->ptr = str->span8().data();
    } else {
        arg1->ptr = Zig::taggedUTF16Ptr(str->span16().data());
    }

    arg1->len = str->length();
}

JSC::EncodedJSValue ZigString__external(const ZigString* arg0, JSC::JSGlobalObject* arg1, void* arg2, void (*ArgFn3)(void* arg0, void* arg1, size_t arg2))
{
    ZigString str
        = *arg0;
    if (Zig::isTaggedUTF16Ptr(str.ptr)) {
        return JSC::JSValue::encode(JSC::jsString(arg1->vm(), WTF::String(ExternalStringImpl::create({ reinterpret_cast<const char16_t*>(Zig::untag(str.ptr)), str.len }, arg2, ArgFn3))));
    } else {
        return JSC::JSValue::encode(JSC::jsString(arg1->vm(), WTF::String(ExternalStringImpl::create({ reinterpret_cast<const Latin1Character*>(Zig::untag(str.ptr)), str.len }, arg2, ArgFn3))));
    }
}

JSC::EncodedJSValue ZigString__toExternalValueWithCallback(const ZigString* arg0, JSC::JSGlobalObject* arg1, void (*ArgFn2)(void* arg2, void* arg0, size_t arg1))
{

    ZigString str
        = *arg0;
    if (Zig::isTaggedUTF16Ptr(str.ptr)) {
        return JSC::JSValue::encode(JSC::jsOwnedString(arg1->vm(), WTF::String(ExternalStringImpl::create({ reinterpret_cast<const char16_t*>(Zig::untag(str.ptr)), str.len }, nullptr, ArgFn2))));
    } else {
        return JSC::JSValue::encode(JSC::jsOwnedString(arg1->vm(), WTF::String(ExternalStringImpl::create({ reinterpret_cast<const Latin1Character*>(Zig::untag(str.ptr)), str.len }, nullptr, ArgFn2))));
    }
}

JSC::EncodedJSValue ZigString__toErrorInstance(const ZigString* str, JSC::JSGlobalObject* globalObject)
{
    return JSC::JSValue::encode(Zig::getErrorInstance(str, globalObject));
}

JSC::EncodedJSValue ZigString__toTypeErrorInstance(const ZigString* str, JSC::JSGlobalObject* globalObject)
{
    return JSC::JSValue::encode(Zig::getTypeErrorInstance(str, globalObject));
}

JSC::EncodedJSValue ZigString__toDOMExceptionInstance(const ZigString* str, JSC::JSGlobalObject* globalObject, WebCore::ExceptionCode code)
{
    return JSValue::encode(createDOMException(globalObject, code, toStringCopy(*str)));
}

JSC::EncodedJSValue ZigString__toSyntaxErrorInstance(const ZigString* str, JSC::JSGlobalObject* globalObject)
{
    return JSC::JSValue::encode(Zig::getSyntaxErrorInstance(str, globalObject));
}

JSC::EncodedJSValue ZigString__toRangeErrorInstance(const ZigString* str, JSC::JSGlobalObject* globalObject)
{
    return JSC::JSValue::encode(Zig::getRangeErrorInstance(str, globalObject));
}

static JSC::EncodedJSValue resolverFunctionCallback(JSC::JSGlobalObject* globalObject,
    JSC::CallFrame* callFrame)
{
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC::JSInternalPromise*
JSC__JSModuleLoader__loadAndEvaluateModule(JSC::JSGlobalObject* globalObject,
    const BunString* arg1)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto name = makeAtomString(arg1->toWTFString());

    auto* promise = JSC::loadAndEvaluateModule(globalObject, name, JSC::jsUndefined(), JSC::jsUndefined());
    EXCEPTION_ASSERT(!!promise == !scope.exception());
    if (!promise) return nullptr;

    JSC::JSNativeStdFunction* resolverFunction = JSC::JSNativeStdFunction::create(
        vm, globalObject, 1, String(), resolverFunctionCallback);

    auto* newPromise = promise->then(globalObject, resolverFunction, globalObject->promiseEmptyOnRejectedFunction());
    EXCEPTION_ASSERT(!!scope.exception() == !newPromise);
    return newPromise;
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
        (void)scope.tryClearException();

        if (auto* promise = jsDynamicCast<JSC::JSPromise*>(promiseValue)) {
            promise->reject(vm, globalObject, exception->value());
            RETURN_IF_EXCEPTION(scope, );
            return;
        }

        if (auto* promise = jsDynamicCast<JSC::JSInternalPromise*>(promiseValue)) {
            promise->reject(vm, globalObject, exception->value());
            RETURN_IF_EXCEPTION(scope, );
            return;
        }

        ASSERT_NOT_REACHED_WITH_MESSAGE("Non-promise value passed to AnyPromise.wrap");
    }

    if (auto* errorInstance = jsDynamicCast<JSC::ErrorInstance*>(result)) {
        if (auto* promise = jsDynamicCast<JSC::JSPromise*>(promiseValue)) {
            promise->reject(vm, globalObject, errorInstance);
            RETURN_IF_EXCEPTION(scope, );
            return;
        }

        if (auto* promise = jsDynamicCast<JSC::JSInternalPromise*>(promiseValue)) {
            promise->reject(vm, globalObject, errorInstance);
            RETURN_IF_EXCEPTION(scope, );
            return;
        }

        ASSERT_NOT_REACHED_WITH_MESSAGE("Non-promise value passed to AnyPromise.wrap");
    }

    if (auto* promise = jsDynamicCast<JSC::JSPromise*>(promiseValue)) {
        promise->resolve(globalObject, result);
        RETURN_IF_EXCEPTION(scope, );
        return;
    }
    if (auto* promise = jsDynamicCast<JSC::JSInternalPromise*>(promiseValue)) {
        promise->resolve(globalObject, result);
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
        (void)scope.tryClearException();
        RELEASE_AND_RETURN(scope, JSValue::encode(JSC::JSPromise::rejectedPromise(globalObject, exception->value())));
    }

    if (auto* promise = jsDynamicCast<JSC::JSPromise*>(result)) {
        RELEASE_AND_RETURN(scope, JSValue::encode(promise));
    }

    if (JSC::ErrorInstance* err = jsDynamicCast<JSC::ErrorInstance*>(result)) {
        RELEASE_AND_RETURN(scope, JSValue::encode(JSC::JSPromise::rejectedPromise(globalObject, err)));
    }

    JSValue resolved = JSC::JSPromise::resolvedPromise(globalObject, result);
    if (scope.exception()) [[unlikely]] {
        auto* exception = scope.exception();
        (void)scope.tryClearException();
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
        exception = jsCast<JSC::Exception*>(value);
    }

    arg0->reject(vm, globalObject, exception);
}

[[ZIG_EXPORT(check_slow)]] void JSC__JSPromise__rejectAsHandled(JSC::JSPromise* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2)
{
    ASSERT_WITH_MESSAGE(arg0->inherits<JSC::JSPromise>(), "Argument is not a promise");
    ASSERT_WITH_MESSAGE(arg0->status() == JSC::JSPromise::Status::Pending, "Promise is already resolved or rejected");

    auto& vm = JSC::getVM(arg1);
    arg0->rejectAsHandled(vm, arg1, JSC::JSValue::decode(JSValue2));
}

JSC::JSPromise* JSC__JSPromise__rejectedPromise(JSC::JSGlobalObject* arg0, JSC::EncodedJSValue JSValue1)
{
    return JSC::JSPromise::rejectedPromise(arg0, JSC::JSValue::decode(JSValue1));
}

[[ZIG_EXPORT(check_slow)]] void JSC__JSPromise__resolve(JSC::JSPromise* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2)
{
    JSValue target = JSValue::decode(JSValue2);

    ASSERT_WITH_MESSAGE(arg0->inherits<JSC::JSPromise>(), "Argument is not a promise");
    ASSERT_WITH_MESSAGE(arg0->status() == JSC::JSPromise::Status::Pending, "Promise is already resolved or rejected");
    ASSERT(!target.isEmpty());
    ASSERT_WITH_MESSAGE(arg0 != target, "Promise cannot be resolved to itself");

    // Note: the Promise can be another promise. Since we go through the generic promise resolve codepath.
    arg0->resolve(arg1, JSC::JSValue::decode(JSValue2));
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
    uint32_t flags = promise->internalField(JSC::JSPromise::Field::Flags).get().asUInt32();
    if (!(flags & JSC::JSPromise::isFirstResolvingFunctionCalledFlag)) {
        if (handled) {
            flags |= JSC::JSPromise::isHandledFlag;
        }

        promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(flags | JSC::JSPromise::isFirstResolvingFunctionCalledFlag));
        auto* globalObject = jsCast<Zig::GlobalObject*>(promise->globalObject());
        auto microtaskFunction = globalObject->performMicrotaskFunction();
        auto rejectPromiseFunction = globalObject->rejectPromiseFunction();

        auto asyncContext = globalObject->m_asyncContextData.get()->getInternalField(0);

#if ASSERT_ENABLED
        ASSERT_WITH_MESSAGE(microtaskFunction, "Invalid microtask function");
        ASSERT_WITH_MESSAGE(rejectPromiseFunction, "Invalid microtask callback");
        ASSERT_WITH_MESSAGE(!value.isEmpty(), "Invalid microtask value");
#endif

        if (asyncContext.isEmpty()) {
            asyncContext = jsUndefined();
        }

        if (value.isEmpty()) {
            value = jsUndefined();
        }

        JSC::QueuedTask task { nullptr, JSC::InternalMicrotask::BunPerformMicrotaskJob, 0, globalObject, microtaskFunction, rejectPromiseFunction, globalObject->m_asyncContextData.get()->getInternalField(0), promise, value };
        globalObject->vm().queueMicrotask(WTF::move(task));
        RETURN_IF_EXCEPTION(scope, );
    }
}

JSC::JSPromise* JSC__JSPromise__resolvedPromise(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue JSValue1)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSPromise* promise = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(static_cast<unsigned>(JSC::JSPromise::Status::Fulfilled)));
    promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(vm, promise, JSC::JSValue::decode(JSValue1));
    return promise;
}

[[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue JSC__JSPromise__result(JSC::JSPromise* promise, JSC::VM* arg1)
{
    auto& vm = *arg1;

    // if the promise is rejected we automatically mark it as handled so it
    // doesn't end up in the promise rejection tracker
    switch (promise->status()) {
    case JSC::JSPromise::Status::Rejected: {
        uint32_t flags = promise->internalField(JSC::JSPromise::Field::Flags).get().asUInt32();
        if (!(flags & JSC::JSPromise::isFirstResolvingFunctionCalledFlag)) {
            promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(flags | JSC::JSPromise::isHandledFlag));
        }
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
[[ZIG_EXPORT(nothrow)]] bool JSC__JSPromise__isHandled(const JSC::JSPromise* arg0)
{
    return arg0->isHandled();
}
[[ZIG_EXPORT(nothrow)]] void JSC__JSPromise__setHandled(JSC::JSPromise* promise)
{
    promise->markAsHandled();
}

#pragma mark - JSC::JSInternalPromise

JSC::JSInternalPromise* JSC__JSInternalPromise__create(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    return JSC::JSInternalPromise::create(vm, globalObject->internalPromiseStructure());
}

[[ZIG_EXPORT(check_slow)]]
void JSC__JSInternalPromise__reject(JSC::JSInternalPromise* arg0, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue JSValue2)
{
    JSValue value = JSC::JSValue::decode(JSValue2);
    auto& vm = JSC::getVM(globalObject);
    JSC::Exception* exception = nullptr;
    if (!value.inherits<JSC::Exception>()) {
        exception = JSC::Exception::create(vm, value, JSC::Exception::StackCaptureAction::CaptureStack);
    } else {
        exception = jsCast<JSC::Exception*>(value);
    }

    arg0->reject(vm, globalObject, exception);
}
void JSC__JSInternalPromise__rejectAsHandled(JSC::JSInternalPromise* arg0,
    JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2)
{
    auto& vm = JSC::getVM(arg1);
    arg0->rejectAsHandled(vm, arg1, JSC::JSValue::decode(JSValue2));
}
void JSC__JSInternalPromise__rejectAsHandledException(JSC::JSInternalPromise* arg0,
    JSC::JSGlobalObject* arg1,
    JSC::Exception* arg2)
{
    auto& vm = JSC::getVM(arg1);
    arg0->rejectAsHandled(vm, arg1, arg2);
}

JSC::JSInternalPromise* JSC__JSInternalPromise__rejectedPromise(JSC::JSGlobalObject* arg0,
    JSC::EncodedJSValue JSValue1)
{
    return jsCast<JSC::JSInternalPromise*>(
        JSC::JSInternalPromise::rejectedPromise(arg0, JSC::JSValue::decode(JSValue1)));
}

[[ZIG_EXPORT(check_slow)]]
void JSC__JSInternalPromise__resolve(JSC::JSInternalPromise* arg0, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2)
{
    arg0->resolve(arg1, JSC::JSValue::decode(JSValue2));
}

JSC::JSInternalPromise* JSC__JSInternalPromise__resolvedPromise(JSC::JSGlobalObject* arg0,
    JSC::EncodedJSValue JSValue1)
{
    return reinterpret_cast<JSC::JSInternalPromise*>(
        JSC::JSInternalPromise::resolvedPromise(arg0, JSC::JSValue::decode(JSValue1)));
}

JSC::EncodedJSValue JSC__JSInternalPromise__result(const JSC::JSInternalPromise* arg0)
{
    return JSC::JSValue::encode(arg0->result());
}
uint32_t JSC__JSInternalPromise__status(const JSC::JSInternalPromise* arg0)
{
    switch (arg0->status()) {
    case JSC::JSInternalPromise::Status::Pending:
        return 0;
    case JSC::JSInternalPromise::Status::Fulfilled:
        return 1;
    case JSC::JSInternalPromise::Status::Rejected:
        return 2;
    default:
        return 255;
    }
}
bool JSC__JSInternalPromise__isHandled(const JSC::JSInternalPromise* arg0)
{
    return arg0->isHandled();
}
void JSC__JSInternalPromise__setHandled(JSC::JSInternalPromise* promise, JSC::VM* arg1)
{
    auto& vm = *arg1;
    auto flags = promise->internalField(JSC::JSPromise::Field::Flags).get().asUInt32();
    promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(flags | JSC::JSPromise::isHandledFlag));
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
    JSC::EncodedJSValue result = JSC::JSValue::encode(JSONParse(globalObject, jsonString));
    scope.releaseAssertNoException();
    return result;
}

JSC::VM* JSC__JSGlobalObject__vm(JSC::JSGlobalObject* arg0) { return &arg0->vm(); };

void JSC__JSGlobalObject__handleRejectedPromises(JSC::JSGlobalObject* arg0)
{
    return jsCast<Zig::GlobalObject*>(arg0)->handleRejectedPromises();
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
    return JSC::jsDynamicCast<JSC::Exception*>(JSC::JSValue::decode(JSValue0)) != nullptr;
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

void JSC__JSValue__put(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, const ZigString* arg2, JSC::EncodedJSValue JSValue3)
{
    JSC::JSObject* object = JSC::JSValue::decode(JSValue0).asCell()->getObject();
    object->putDirect(arg1->vm(), Zig::toIdentifier(*arg2, arg1), JSC::JSValue::decode(JSValue3));
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

extern "C" bool JSC__JSValue__deleteProperty(JSC::EncodedJSValue target, JSC::JSGlobalObject* globalObject, const ZigString* key)
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
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isCell(JSC::EncodedJSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isCell(); }
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isCustomGetterSetter(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isCustomGetterSetter();
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

    if (JSC::ErrorInstance* err = JSC::jsDynamicCast<JSC::ErrorInstance*>(value)) {
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
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isGetterSetter(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isGetterSetter();
}
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isHeapBigInt(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isHeapBigInt();
}
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isInt32(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isInt32();
}
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isInt32AsAnyInt(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isInt32AsAnyInt();
}
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isNull(JSC::EncodedJSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isNull(); }
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isNumber(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isNumber();
}
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isObject(JSC::EncodedJSValue JSValue0)
{
    return JSValue0 != 0 && JSC::JSValue::decode(JSValue0).isObject();
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
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isUndefined(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isUndefined();
}
[[ZIG_EXPORT(nothrow)]] bool JSC__JSValue__isUndefinedOrNull(JSC::EncodedJSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isUndefinedOrNull();
}

[[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue JSC__JSValue__jsEmptyString(JSC::JSGlobalObject* arg0)
{
    return JSC::JSValue::encode(JSC::jsEmptyString(arg0->vm()));
}
[[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue JSC__JSValue__jsNumberFromChar(unsigned char arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
}
JSC::EncodedJSValue JSC__JSValue__jsNumberFromDouble(double arg0)
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
[[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue JSC__JSValue__jsNumberFromU16(uint16_t arg0)
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
        return static_cast<uint64_t>(value.asInt32());
    }
    ASSERT(value.isDouble());

    int64_t result = JSC::tryConvertToInt52(value.asDouble());
    if (result != JSC::JSValue::notInt52) {
        if (result < 0)
            return 0;

        return static_cast<uint64_t>(result);
    }
    return 0;
}

JSC::EncodedJSValue JSC__JSValue__createObject2(JSC::JSGlobalObject* globalObject, const ZigString* arg1,
    const ZigString* arg2, JSC::EncodedJSValue JSValue3,
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
        if (pathString.characterAt(0) == '.') {
            auto* currPropObject = currProp.toObject(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            currProp = currPropObject->getIfPropertyExists(globalObject, vm.propertyNames->emptyIdentifier);
            RETURN_IF_EXCEPTION(scope, {});
            if (currProp.isEmpty()) {
                return JSValue::encode(currProp);
            }
        }

        while (i < length) {
            char16_t ic = pathString.characterAt(i);
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
                ic = pathString.characterAt(i);
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
            char16_t jc = pathString.characterAt(j);
            while (!(jc == '[' || jc == ']' || jc == '.')) {
                j += 1;
                if (j == length) {
                    // break and search for property
                    break;
                }
                jc = pathString.characterAt(j);
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

    if (isArray(globalObject, path)) {
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

void JSC__JSValue__getSymbolDescription(JSC::EncodedJSValue symbolValue_, JSC::JSGlobalObject* arg1, ZigString* arg2)

{
    JSC::JSValue symbolValue = JSC::JSValue::decode(symbolValue_);

    if (!symbolValue.isSymbol())
        return;

    JSC::Symbol* symbol = JSC::asSymbol(symbolValue);

    auto result = symbol->description();
    if (!result.isEmpty()) {
        *arg2 = Zig::toZigString(result);
    } else {
        *arg2 = ZigStringEmpty;
    }
}

JSC::EncodedJSValue JSC__JSValue__symbolFor(JSC::JSGlobalObject* globalObject, ZigString* arg2)
{

    auto& vm = JSC::getVM(globalObject);
    WTF::String string = Zig::toString(*arg2);
    return JSC::JSValue::encode(JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey(string)));
}

bool JSC__JSValue__symbolKeyFor(JSC::EncodedJSValue symbolValue_, JSC::JSGlobalObject* arg1, ZigString* arg2)
{
    JSC::JSValue symbolValue = JSC::JSValue::decode(symbolValue_);
    JSC::VM& vm = arg1->vm();

    if (!symbolValue.isSymbol())
        return false;

    JSC::PrivateName privateName = JSC::asSymbol(symbolValue)->privateName();
    SymbolImpl& uid = privateName.uid();
    if (!uid.symbolRegistry())
        return false;

    *arg2 = Zig::toZigString(JSC::jsString(vm, String { uid }), arg1);
    return true;
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

JSC::EncodedJSValue JSC__JSValue__getErrorsProperty(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* global)
{
    JSC::JSObject* obj = JSC::JSValue::decode(JSValue0).getObject();
    return JSC::JSValue::encode(obj->getDirect(global->vm(), global->vm().propertyNames->errors));
}

[[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue JSC__JSValue__jsTDZValue()
{
    return JSC::JSValue::encode(JSC::jsTDZValue());
};

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

[[ZIG_EXPORT(check_slow)]] bool JSC__JSValue__toMatch(JSC::EncodedJSValue regexValue, JSC::JSGlobalObject* global, JSC::EncodedJSValue value)
{
    ASSERT_NO_PENDING_EXCEPTION(global);
    JSC::JSValue regex = JSC::JSValue::decode(regexValue);
    JSC::JSValue str = JSC::JSValue::decode(value);
    if (regex.asCell()->type() != RegExpObjectType || !str.isString()) {
        return false;
    }
    JSC::RegExpObject* regexObject = jsDynamicCast<JSC::RegExpObject*>(regex);

    return !!regexObject->match(global, JSC::asString(str));
}

bool JSC__JSValue__stringIncludes(JSC::EncodedJSValue value, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue other)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    WTF::String stringToSearchIn = JSC::JSValue::decode(value).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::String searchString = JSC::JSValue::decode(other).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return stringToSearchIn.find(searchString, 0) != WTF::notFound;
}

extern "C" JSC::EncodedJSValue JSC__Exception__asJSValue(JSC::Exception* exception)
{
    JSC::Exception* jscException = jsCast<JSC::Exception*>(exception);
    return JSC::JSValue::encode(jscException);
}

void JSC__VM__releaseWeakRefs(JSC::VM* arg0)
{
    arg0->finalizeSynchronousJSExecution();
}

void JSC__JSValue__getClassName(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, ZigString* arg2)
{
    JSValue value = JSValue::decode(JSValue0);
    JSC::JSCell* cell = value.asCell();
    if (cell == nullptr || !cell->isObject()) {
        arg2->len = 0;
        return;
    }

    const char* ptr = cell->className();
    auto view = WTF::StringView(std::span { ptr, strlen(ptr) });

    // Fallback to .name if className is empty
    if (view.length() == 0 || StringView("Function"_s) == view) {
        JSC__JSValue__getNameProperty(JSValue0, arg1, arg2);
        return;
    }

    JSObject* obj = value.toObject(arg1);

    auto calculated = JSObject::calculatedClassName(obj);
    if (calculated.length() > 0) {
        *arg2 = Zig::toZigString(calculated);
        return;
    }

    *arg2 = Zig::toZigString(view);
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

void JSC__JSValue__getNameProperty(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* arg1, ZigString* arg2)
{
    JSC::JSObject* obj = JSC::JSValue::decode(JSValue0).getObject();
    JSC::VM& vm = arg1->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (obj == nullptr) {
        arg2->len = 0;
        return;
    }

    JSC::JSValue name = obj->getIfPropertyExists(arg1, vm.propertyNames->toStringTagSymbol);
    RETURN_IF_EXCEPTION(scope, );

    if (name && name.isString()) {
        auto str = name.toWTFString(arg1);
        if (!str.isEmpty()) {
            *arg2 = Zig::toZigString(str);
            return;
        }
    }

    if (JSC::JSFunction* function = JSC::jsDynamicCast<JSC::JSFunction*>(obj)) {

        WTF::String actualName = function->name(vm);
        if (!actualName.isEmpty() || function->isHostOrBuiltinFunction()) {
            *arg2 = Zig::toZigString(actualName);
            return;
        }

        actualName = function->jsExecutable()->name().string();

        *arg2 = Zig::toZigString(actualName);
        return;
    }

    if (JSC::InternalFunction* function = JSC::jsDynamicCast<JSC::InternalFunction*>(obj)) {
        *arg2 = Zig::toZigString(function->name());
        return;
    }

    arg2->len = 0;
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
            JSC::Exception* exception = jsCast<JSC::Exception*>(cell);
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

[[ZIG_EXPORT(nothrow)]] bool JSC__VM__isJITEnabled()
{
    return JSC::Options::useJIT();
}

void JSC__VM__clearExecutionTimeLimit(JSC::VM* vm)
{
    JSC::JSLockHolder locker(vm);
    if (vm->watchdog())
        vm->watchdog()->setTimeLimit(JSC::Watchdog::noTimeLimit);
}
void JSC__VM__setExecutionTimeLimit(JSC::VM* vm, double limit)
{
    JSC::JSLockHolder locker(vm);
    JSC::Watchdog& watchdog = vm->ensureWatchdog();
    watchdog.setTimeLimit(WTF::Seconds { limit });
}

bool JSC__JSValue__isTerminationException(JSC::EncodedJSValue JSValue0)
{
    JSC::Exception* exception = JSC::jsDynamicCast<JSC::Exception*>(JSC::JSValue::decode(JSValue0));
    if (exception == nullptr)
        return false;

    return exception->vm().isTerminationException(exception);
}

void JSC__VM__shrinkFootprint(JSC::VM* arg0)
{
    arg0->shrinkFootprintWhenIdle();
};

void JSC__VM__holdAPILock(JSC::VM* arg0, void* ctx, void (*callback)(void* arg0))
{
    JSC::JSLockHolder locker(arg0);
    callback(ctx);
}

// The following two functions are copied 1:1 from JSLockHolder to provide a
// new, more ergonomic binding for interacting with the lock from Zig
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
    if (JSC::JSObject* obj = JSC::jsDynamicCast<JSC::JSObject*>(globalObject->moduleLoader())) {
        auto id = JSC::Identifier::fromString(globalObject->vm(), "registry"_s);
        JSC::JSMap* map = JSC::JSMap::create(globalObject->vm(), globalObject->mapStructure());
        obj->putDirect(globalObject->vm(), id, map);
    }
    arg1->deleteAllCode(JSC::DeleteAllCodeEffort::PreventCollectionAndDeleteAllCode);
    arg1->heap.reportAbandonedObjectGraph();
}

void JSC__VM__reportExtraMemory(JSC::VM* arg0, size_t arg1)
{
    arg0->heap.deprecatedReportExtraMemory(arg1);
}

void JSC__VM__deinit(JSC::VM* arg1, JSC::JSGlobalObject* globalObject)
{
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

[[ZIG_EXPORT(nothrow)]]
bool JSC__VM__isTerminationException(JSC::VM* vm, JSC::Exception* exception)
{
    return vm->isTerminationException(exception);
}

[[ZIG_EXPORT(nothrow)]]
bool JSC__VM__hasTerminationRequest(JSC::VM* vm)
{
    return vm->hasTerminationRequest();
}

void JSC__VM__setExecutionForbidden(JSC::VM* arg0, bool arg1)
{
    (*arg0).setExecutionForbidden();
}

// These may be called concurrently from another thread.
void JSC__VM__notifyNeedTermination(JSC::VM* arg0)
{
    JSC::VM& vm = *arg0;
    bool didEnter = vm.currentThreadIsHoldingAPILock();
    if (didEnter)
        vm.apiLock().unlock();
    vm.notifyNeedTermination();
    if (didEnter)
        vm.apiLock().lock();
}
void JSC__VM__notifyNeedDebuggerBreak(JSC::VM* arg0)
{
    (*arg0).notifyNeedDebuggerBreak();
}
void JSC__VM__notifyNeedShellTimeoutCheck(JSC::VM* arg0)
{
    (*arg0).notifyNeedShellTimeoutCheck();
}
void JSC__VM__notifyNeedWatchdogCheck(JSC::VM* arg0)
{
    (*arg0).notifyNeedWatchdogCheck();
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
            scope.throwException(arg1, jsCast<JSC::Exception*>(value));
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
    promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(static_cast<unsigned>(JSC::JSPromise::Status::Rejected)));
    promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(vm, promise, JSC::JSValue::decode(JSValue1));
    JSC::ensureStillAliveHere(promise);
    JSC::ensureStillAliveHere(JSC::JSValue::decode(JSValue1));
    return JSC::JSValue::encode(promise);
}

JSC::EncodedJSValue JSC__JSPromise__resolvedPromiseValue(JSC::JSGlobalObject* globalObject,
    JSC::EncodedJSValue JSValue1)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSPromise* promise = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(static_cast<unsigned>(JSC::JSPromise::Status::Fulfilled)));
    promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(vm, promise, JSC::JSValue::decode(JSValue1));
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

// This enum must match the zig enum in src/bun.js/bindings/JSValue.zig JSValue.BuiltinName
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
    PropertySlot slot = PropertySlot(value, PropertySlot::InternalMethodType::GetOwnProperty);
    const Identifier name = builtinNameMap(globalObject->vm(), arg2);
    auto* object = value.getObject();

    if (object->getOwnPropertySlot(object, globalObject, name, slot)) {
        return JSValue::encode(slot.getValue(globalObject, name));
    }

    return {};
}

bool JSC__JSValue__toBoolean(JSC::EncodedJSValue JSValue0)
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
static void JSC__JSValue__forEachPropertyImpl(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, void* arg2, void (*iter)(JSC::JSGlobalObject* arg0, void* ctx, ZigString* arg2, JSC::EncodedJSValue JSValue3, bool isSymbol, bool isPrivateSymbol))
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

            if (JSValue proto = object->getPrototype(globalObject)) {
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
    WTF::Vector<Identifier, 6> visitedProperties;

restart:
    if (fast) {
        bool anyHits = false;
        JSC::JSObject* objectToUse = prototypeObject.getObject();
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

            if (visitedProperties.contains(Identifier::fromUid(vm, prop))) {
                return true;
            }
            visitedProperties.append(Identifier::fromUid(vm, prop));

            ZigString key = toZigString(prop);
            JSC::JSValue propertyValue = JSValue();

            if (objectToUse == object) {
                propertyValue = objectToUse->getDirect(entry.offset());
                if (!propertyValue) {
                    (void)scope.tryClearException();
                    return true;
                }
            }

            if (!propertyValue || propertyValue.isGetterSetter() && !((entry.attributes() & PropertyAttribute::Accessor) != 0)) {
                propertyValue = objectToUse->getIfPropertyExists(globalObject, prop);
            }

            // Ignore exceptions due to getters.
            CLEAR_IF_EXCEPTION(scope);

            if (!propertyValue)
                return true;

            anyHits = true;
            JSC::EnsureStillAliveScope ensureStillAliveScope(propertyValue);

            bool isPrivate = prop->isSymbol() && Identifier::fromUid(vm, prop).isPrivateName();

            if (isPrivate && !JSC::Options::showPrivateScriptsInStackTraces())
                return true;

            iter(globalObject, arg2, &key, JSC::JSValue::encode(propertyValue), prop->isSymbol(), isPrivate);
            // Propagate exceptions from callbacks.
            RETURN_IF_EXCEPTION(scope, false);
            return true;
        });

        // Propagate exceptions from callbacks.
        RETURN_IF_EXCEPTION(scope, );

        if (anyHits) {
            if (prototypeCount++ < 5) {

                if (JSValue proto = prototypeObject.getPrototype(globalObject)) {
                    if (!(proto == globalObject->objectPrototype() || proto == globalObject->functionPrototype() || (proto.inherits<JSGlobalProxy>() && jsCast<JSGlobalProxy*>(proto)->target() != globalObject))) {
                        if ((structure = proto.structureOrNull())) {
                            prototypeObject = proto;
                            fast = canPerformFastPropertyEnumerationForIterationBun(structure);
                            goto restart;
                        }
                    }
                }
                // Ignore exceptions from Proxy "getPrototype" trap.
                CLEAR_IF_EXCEPTION(scope);
            }
            return;
        }
    }

    JSC::PropertyNameArrayBuilder properties(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);

    {

        JSObject* iterating = prototypeObject.getObject();

        while (iterating && !(iterating == globalObject->objectPrototype() || iterating == globalObject->functionPrototype() || (iterating->inherits<JSGlobalProxy>() && jsCast<JSGlobalProxy*>(iterating)->target() != globalObject)) && prototypeCount++ < 5) {
            if constexpr (nonIndexedOnly) {
                iterating->getOwnNonIndexPropertyNames(globalObject, properties, DontEnumPropertiesMode::Include);
            } else {
                iterating->methodTable()->getOwnPropertyNames(iterating, globalObject, properties, DontEnumPropertiesMode::Include);
            }

            RETURN_IF_EXCEPTION(scope, void());
            for (auto& property : properties) {
                if (property.isEmpty() || property.isNull()) [[unlikely]]
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
                if (!object->getPropertySlot(globalObject, property, slot))
                    continue;
                // Ignore exceptions from "Get" proxy traps.
                CLEAR_IF_EXCEPTION(scope);

                if ((slot.attributes() & PropertyAttribute::DontEnum) != 0) {
                    if (property == propertyNames->underscoreProto
                        || property == propertyNames->toStringTagSymbol || property == propertyNames->__esModule)
                        continue;
                }

                if (visitedProperties.contains(property))
                    continue;
                visitedProperties.append(property);

                ZigString key = toZigString(property.isSymbol() && !property.isPrivateName() ? property.impl() : property.string());

                if (key.len == 0)
                    continue;

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
            iterating = iterating->getPrototype(globalObject).getObject();
        }
    }

    properties.releaseData();

    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return;
    }
}

[[ZIG_EXPORT(check_slow)]] void JSC__JSValue__forEachProperty(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, void* arg2, void (*iter)([[ZIG_NONNULL]] JSC::JSGlobalObject* arg0, void* ctx, [[ZIG_NONNULL]] ZigString* arg2, JSC::EncodedJSValue JSValue3, bool isSymbol, bool isPrivateSymbol))
{
    JSC__JSValue__forEachPropertyImpl<false>(JSValue0, globalObject, arg2, iter);
}

extern "C" void JSC__JSValue__forEachPropertyNonIndexed(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, void* arg2, void (*iter)(JSC::JSGlobalObject* arg0, void* ctx, ZigString* arg2, JSC::EncodedJSValue JSValue3, bool isSymbol, bool isPrivateSymbol))
{
    JSC__JSValue__forEachPropertyImpl<true>(JSValue0, globalObject, arg2, iter);
}

extern "C" [[ZIG_EXPORT(nothrow)]] bool JSC__isBigIntInUInt64Range(JSC::EncodedJSValue value, uint64_t max, uint64_t min)
{
    JSValue jsValue = JSValue::decode(value);
    if (!jsValue.isHeapBigInt())
        return false;

    JSC::JSBigInt* bigInt = jsValue.asHeapBigInt();
    auto result = bigInt->compare(bigInt, min);
    if (result == JSBigInt::ComparisonResult::GreaterThan || result == JSBigInt::ComparisonResult::Equal) {
        return true;
    }
    result = bigInt->compare(bigInt, max);
    return result == JSBigInt::ComparisonResult::LessThan || result == JSBigInt::ComparisonResult::Equal;
}

extern "C" [[ZIG_EXPORT(nothrow)]] bool JSC__isBigIntInInt64Range(JSC::EncodedJSValue value, int64_t max, int64_t min)
{
    JSValue jsValue = JSValue::decode(value);
    if (!jsValue.isHeapBigInt())
        return false;

    JSC::JSBigInt* bigInt = jsValue.asHeapBigInt();
    auto result = bigInt->compare(bigInt, min);
    if (result == JSBigInt::ComparisonResult::GreaterThan || result == JSBigInt::ComparisonResult::Equal) {
        return true;
    }
    result = bigInt->compare(bigInt, max);
    return result == JSBigInt::ComparisonResult::LessThan || result == JSBigInt::ComparisonResult::Equal;
}

[[ZIG_EXPORT(check_slow)]] void JSC__JSValue__forEachPropertyOrdered(JSC::EncodedJSValue JSValue0, JSC::JSGlobalObject* globalObject, void* arg2, void (*iter)([[ZIG_NONNULL]] JSC::JSGlobalObject* arg0, void* ctx, [[ZIG_NONNULL]] ZigString* arg2, JSC::EncodedJSValue JSValue3, bool isSymbol, bool isPrivateSymbol))

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
        if (scope.exception()) [[unlikely]] {
            (void)scope.tryClearException();
            return;
        }
    }

    auto vector = properties.data()->propertyNameVector();
    std::sort(vector.begin(), vector.end(), [&](Identifier a, Identifier b) -> bool {
        const WTF::StringImpl* aImpl = a.isSymbol() && !a.isPrivateName() ? a.impl() : a.string().impl();
        const WTF::StringImpl* bImpl = b.isSymbol() && !b.isPrivateName() ? b.impl() : b.string().impl();
        return codePointCompare(aImpl, bImpl) < 0;
    });
    auto clientData = WebCore::clientData(vm);

    for (auto property : vector) {
        if (property.isEmpty() || property.isNull()) [[unlikely]]
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
        ZigString key = toZigString(name);

        JSC::EnsureStillAliveScope ensureStillAliveScope(propertyValue);
        // TODO: properly propagate exception upwards
        iter(globalObject, arg2, &key, JSC::JSValue::encode(propertyValue), property.isSymbol(), property.isPrivateName());
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

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

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
    return JSValue::encode(JSC::jsString(globalObject, JSC::JSValue::decode(JSValue0).toString(globalObject), JSC::JSValue::decode(JSValue1).toString(globalObject)));
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
    JSC::JSFunction* microTaskFunction = globalObject->performMicrotaskFunction();
#if ASSERT_ENABLED
    ASSERT_WITH_MESSAGE(microTaskFunction, "Invalid microtask function");
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

    JSC::QueuedTask task { nullptr, JSC::InternalMicrotask::BunPerformMicrotaskJob, 0, globalObject, microTaskFunction, WTF::move(microtaskArgs[0]), WTF::move(microtaskArgs[1]), WTF::move(microtaskArgs[2]), WTF::move(microtaskArgs[3]) };
    globalObject->vm().queueMicrotask(WTF::move(task));
}

extern "C" WebCore::AbortSignal* WebCore__AbortSignal__new(JSC::JSGlobalObject* globalObject)
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(globalObject);
    auto* context = thisObject->scriptExecutionContext();
    RefPtr<WebCore::AbortSignal> abortSignal = WebCore::AbortSignal::create(context);
    return abortSignal.leakRef();
}

extern "C" JSC::EncodedJSValue WebCore__AbortSignal__create(JSC::JSGlobalObject* globalObject)
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(globalObject);
    auto* context = thisObject->scriptExecutionContext();
    auto abortSignal = WebCore::AbortSignal::create(context);

    return JSValue::encode(toJSNewlyCreated<IDLInterface<WebCore::AbortSignal>>(*globalObject, *jsCast<JSDOMGlobalObject*>(globalObject), WTF::move(abortSignal)));
}
extern "C" JSC::EncodedJSValue WebCore__AbortSignal__toJS(WebCore::AbortSignal* arg0, JSC::JSGlobalObject* globalObject)
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);

    return JSValue::encode(toJS<IDLInterface<WebCore::AbortSignal>>(*globalObject, *jsCast<JSDOMGlobalObject*>(globalObject), *abortSignal));
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

extern "C" WebCore::AbortSignal* WebCore__AbortSignal__signal(WebCore::AbortSignal* arg0, JSC::JSGlobalObject* globalObject, uint8_t reason)
{

    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);
    abortSignal->signalAbort(
        globalObject,
        static_cast<WebCore::CommonAbortReason>(reason));
    ;
    return arg0;
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

extern "C" JSC::EncodedJSValue WebCore__AbortSignal__abortReason(WebCore::AbortSignal* arg0)
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);
    return JSC::JSValue::encode(abortSignal->reason().getValue(jsNull()));
}

extern "C" WebCore::AbortSignalTimeout WebCore__AbortSignal__getTimeout(WebCore::AbortSignal* arg0)
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);
    if (!abortSignal->hasActiveTimeoutTimer()) {
        return nullptr;
    }
    return abortSignal->getTimeout();
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
        callback(ctx, JSC::JSValue::encode(abortSignal->reason().getValue(jsNull())));
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
    WebCore::JSAbortSignal* object = JSC::jsDynamicCast<WebCore::JSAbortSignal*>(decodedValue);
    if (!object)
        return nullptr;

    return reinterpret_cast<WebCore::AbortSignal*>(&object->wrapped());
}

CPP_DECL double JSC__JSValue__getUnixTimestamp(JSC::EncodedJSValue timeValue)
{
    JSC::JSValue decodedValue = JSC::JSValue::decode(timeValue);
    JSC::DateInstance* date = JSC::jsDynamicCast<JSC::DateInstance*>(decodedValue);
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
        if (!object->getOwnPropertySlotByIndex(object, globalObject, index, slot))
            return {};

        RETURN_IF_EXCEPTION(scope, {});

        return JSC::JSValue::encode(slot.getValue(globalObject, index));
    } else {
        auto propertyName = property.toPropertyKey(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (!object->getOwnNonIndexPropertySlot(vm, object->structure(), propertyName, slot))
            return {};

        RETURN_IF_EXCEPTION(scope, {});

        return JSC::JSValue::encode(slot.getValue(globalObject, propertyName));
    }
}

extern "C" [[ZIG_EXPORT(check_slow)]] double Bun__parseDate(JSC::JSGlobalObject* globalObject, BunString* str)
{
    auto& vm = JSC::getVM(globalObject);
    return vm.dateCache.parseDate(globalObject, vm, str->toWTFString());
}

extern "C" [[ZIG_EXPORT(check_slow)]] double Bun__gregorianDateTimeToMS(JSC::JSGlobalObject* globalObject, int year, int month, int day, int hour, int minute, int second, int millisecond)
{
    auto& vm = JSC::getVM(globalObject);
    WTF::GregorianDateTime dateTime;
    dateTime.setYear(year);
    dateTime.setMonth(month - 1);
    dateTime.setMonthDay(day);
    dateTime.setHour(hour);
    dateTime.setMinute(minute);
    dateTime.setSecond(second);
    return vm.dateCache.gregorianDateTimeToMS(dateTime, millisecond, WTF::TimeType::LocalTime);
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

// this is largely copied from dateProtoFuncToISOString
extern "C" int JSC__JSValue__toISOString(JSC::JSGlobalObject* globalObject, EncodedJSValue dateValue, char* buf)
{
    char buffer[64];
    JSC::DateInstance* thisDateObj = JSC::jsDynamicCast<JSC::DateInstance*>(JSC::JSValue::decode(dateValue));
    if (!thisDateObj)
        return -1;

    if (!std::isfinite(thisDateObj->internalNumber()))
        return -1;

    auto& vm = JSC::getVM(globalObject);

    return static_cast<int>(Bun::toISOString(vm, thisDateObj->internalNumber(), buffer));
}

extern "C" int JSC__JSValue__DateNowISOString(JSC::JSGlobalObject* globalObject, char* buf)
{
    char buffer[29];
    JSC::DateInstance* thisDateObj = JSC::DateInstance::create(globalObject->vm(), globalObject->dateStructure(), globalObject->jsDateNow());

    if (!std::isfinite(thisDateObj->internalNumber()))
        return -1;

    auto& vm = JSC::getVM(globalObject);

    const GregorianDateTime* gregorianDateTime = thisDateObj->gregorianDateTimeUTC(vm.dateCache);
    if (!gregorianDateTime)
        return -1;

    // If the year is outside the bounds of 0 and 9999 inclusive we want to use the extended year format (ES 15.9.1.15.1).
    int ms = static_cast<int>(fmod(thisDateObj->internalNumber(), msPerSecond));
    if (ms < 0)
        ms += msPerSecond;

    int charactersWritten;
    if (gregorianDateTime->year() > 9999 || gregorianDateTime->year() < 0)
        charactersWritten = snprintf(buffer, sizeof(buffer), "%+07d-%02d-%02dT%02d:%02d:%02d.%03dZ", gregorianDateTime->year(), gregorianDateTime->month() + 1, gregorianDateTime->monthDay(), gregorianDateTime->hour(), gregorianDateTime->minute(), gregorianDateTime->second(), ms);
    else
        charactersWritten = snprintf(buffer, sizeof(buffer), "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", gregorianDateTime->year(), gregorianDateTime->month() + 1, gregorianDateTime->monthDay(), gregorianDateTime->hour(), gregorianDateTime->minute(), gregorianDateTime->second(), ms);

    memcpy(buf, buffer, charactersWritten);

    ASSERT(charactersWritten > 0 && static_cast<unsigned>(charactersWritten) < sizeof(buffer));
    if (static_cast<unsigned>(charactersWritten) >= sizeof(buffer))
        return -1;

    return charactersWritten;
}

#pragma mark - WebCore::DOMFormData

CPP_DECL void WebCore__DOMFormData__append(WebCore::DOMFormData* arg0, ZigString* arg1, ZigString* arg2)
{
    arg0->append(toStringCopy(*arg1), toStringCopy(*arg2));
}

CPP_DECL void WebCore__DOMFormData__appendBlob(WebCore::DOMFormData* arg0, JSC::JSGlobalObject* arg1, ZigString* arg2, void* blobValueInner, ZigString* fileName)
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
    void (*callback)(void* ctx, ZigString* encoded))
{
    auto str = formData->toURLEncodedString();
    ZigString encoded = toZigString(str);
    callback(ctx, &encoded);
}

CPP_DECL JSC::EncodedJSValue WebCore__DOMFormData__createFromURLQuery(JSC::JSGlobalObject* arg0, ZigString* arg1)
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

CPP_DECL [[ZIG_EXPORT(check_slow)]] bool JSC__JSMap__has(JSC::JSMap* map, JSC::JSGlobalObject* arg1, JSC::EncodedJSValue JSValue2)
{
    const JSC::JSValue value = JSC::JSValue::decode(JSValue2);
    return map->has(arg1, value);
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

CPP_DECL [[ZIG_EXPORT(check_slow)]] uint32_t JSC__JSMap__size(JSC::JSMap* map, JSC::JSGlobalObject* arg1)
{
    return map->size();
}

CPP_DECL void JSC__VM__setControlFlowProfiler(JSC::VM* vm, bool isEnabled)
{
    if (isEnabled) {
        vm->enableControlFlowProfiler();
    } else {
        vm->disableControlFlowProfiler();
    }
}

CPP_DECL void JSC__VM__performOpportunisticallyScheduledTasks(JSC::VM* vm, double until)
{
    vm->performOpportunisticallyScheduledTasks(MonotonicTime::now() + Seconds(until), {});
}

extern "C" EncodedJSValue JSC__createError(JSC::JSGlobalObject* globalObject, const BunString* str)
{
    return JSValue::encode(JSC::createError(globalObject, str->toWTFString(BunString::ZeroCopy)));
}

extern "C" EncodedJSValue JSC__createTypeError(JSC::JSGlobalObject* globalObject, const BunString* str)
{
    return JSValue::encode(JSC::createTypeError(globalObject, str->toWTFString(BunString::ZeroCopy)));
}

extern "C" EncodedJSValue JSC__createRangeError(JSC::JSGlobalObject* globalObject, const BunString* str)
{
    return JSValue::encode(JSC::createRangeError(globalObject, str->toWTFString(BunString::ZeroCopy)));
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
    BunString fn_name,
    NativeFunction implementation,
    unsigned arg_count,
    ImplementationVisibility implementation_visibility,
    Intrinsic intrinsic,
    NativeFunction constructorOrNull)
{
    VM& vm = global->vm();
    auto name = fn_name.toWTFString();
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
    return JSValue::encode(jsCast<ProxyObject*>(JSValue::decode(value))->internalField((ProxyObject::Field)id).get());
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

    ZigStackFrame remappedFrame = {};

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

        remappedFrame.position.line_zero_based = originalLine.zeroBasedInt();
        remappedFrame.position.column_zero_based = originalColumn.zeroBasedInt();
        remappedFrame.source_url = Bun::toStringRef(sourceURL);

        Bun__remapStackFramePositions(Bun::vm(globalObject), &remappedFrame, 1);

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

#if !ENABLE(EXCEPTION_SCOPE_VERIFICATION)
extern "C" [[ZIG_EXPORT(nothrow)]] bool Bun__RETURN_IF_EXCEPTION(JSC::JSGlobalObject* globalObject)
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
        ZigStackFrame remappedFrame = {};
        remappedFrame.position.line_zero_based = lineColumn.line - 1;
        remappedFrame.position.column_zero_based = lineColumn.column;
        remappedFrame.source_url = Bun::toStringRef(sourceURL);

        Bun__remapStackFramePositions(Bun::vm(globalObject), &remappedFrame, 1);

        return remappedFrame.position.line_zero_based + 1;
    }

    return lineColumn.line;
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
}
