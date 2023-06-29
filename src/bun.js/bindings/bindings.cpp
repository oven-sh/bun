#include "root.h"

#include "headers.h"

#include "BunClientData.h"
#include "GCDefferalContext.h"

#include "JavaScriptCore/AggregateError.h"
#include "JavaScriptCore/BytecodeIndex.h"
#include "JavaScriptCore/CodeBlock.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/DeferredWorkTimer.h"
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

#include "JavaScriptCore/JSCallbackObject.h"
#include "JavaScriptCore/JSClassRef.h"
#include "JavaScriptCore/JSInternalPromise.h"
#include "JavaScriptCore/JSMap.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/JSModuleRecord.h"
#include "JavaScriptCore/JSNativeStdFunction.h"
#include "JavaScriptCore/JSONObject.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSSet.h"
#include "JavaScriptCore/JSString.h"
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

#include "wtf/text/ExternalStringImpl.h"
#include "wtf/text/StringCommon.h"
#include "wtf/text/StringImpl.h"
#include "wtf/text/StringView.h"
#include "wtf/text/WTFString.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JSFetchHeaders.h"
#include "FetchHeaders.h"
#include "DOMURL.h"
#include "JSDOMURL.h"

#include <string_view>
#include <uws/src/App.h>
#include <uws/uSockets/src/internal/internal.h>
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
#include "HTTPHeaderNames.h"
#include "JSDOMPromiseDeferred.h"
#include "JavaScriptCore/TestRunnerUtils.h"
#include "JavaScriptCore/DateInstance.h"
#include "JavaScriptCore/RegExpObject.h"
#include "JavaScriptCore/PropertyNameArray.h"
#include "JavaScriptCore/HashMapImpl.h"
#include "JavaScriptCore/HashMapImplInlines.h"
#include "webcore/JSAbortSignal.h"
#include "JSAbortAlgorithm.h"

#include "DOMFormData.h"
#include "JSDOMFormData.h"
#include "ZigGeneratedClasses.h"
#include "JavaScriptCore/JSMapInlines.h"

#include <JavaScriptCore/JSWeakMap.h>
#include "JSURLSearchParams.h"

template<typename UWSResponse>
static void copyToUWS(WebCore::FetchHeaders* headers, UWSResponse* res)
{
    auto& internalHeaders = headers->internalHeaders();

    for (auto& value : internalHeaders.getSetCookieHeaders()) {
        res->writeHeader(std::string_view("set-cookie", 10), std::string_view(value.is8Bit() ? reinterpret_cast<const char*>(value.characters8()) : value.utf8().data(), value.length()));
    }

    for (auto& header : internalHeaders.commonHeaders()) {
        const auto& name = WebCore::httpHeaderNameString(header.key);
        auto& value = header.value;
        res->writeHeader(
            std::string_view(name.is8Bit() ? reinterpret_cast<const char*>(name.characters8()) : name.utf8().data(), name.length()),
            std::string_view(value.is8Bit() ? reinterpret_cast<const char*>(value.characters8()) : value.utf8().data(), value.length()));
    }

    for (auto& header : internalHeaders.uncommonHeaders()) {
        auto& name = header.key;
        auto& value = header.value;
        res->writeHeader(
            std::string_view(name.is8Bit() ? reinterpret_cast<const char*>(name.characters8()) : name.utf8().data(), name.length()),
            std::string_view(value.is8Bit() ? reinterpret_cast<const char*>(value.characters8()) : value.utf8().data(), value.length()));
    }
}

using namespace JSC;

using namespace WebCore;

enum class AsymmetricMatcherResult : uint8_t {
    PASS,
    FAIL,
    NOT_MATCHER,
};

AsymmetricMatcherResult matchAsymmetricMatcher(JSGlobalObject* globalObject, JSCell* matcherPropCell, JSValue otherProp, ThrowScope* throwScope)
{
    VM& vm = globalObject->vm();

    if (auto* expectAnything = jsDynamicCast<JSExpectAnything*>(matcherPropCell)) {
        if (otherProp.isUndefinedOrNull()) {
            return AsymmetricMatcherResult::FAIL;
        }

        return AsymmetricMatcherResult::PASS;
    } else if (auto* expectAny = jsDynamicCast<JSExpectAny*>(matcherPropCell)) {
        JSValue constructorValue = expectAny->m_constructorValue.get();
        JSObject* constructorObject = constructorValue.getObject();

        if (otherProp.isPrimitive()) {
            if (otherProp.isNumber() && globalObject->numberObjectConstructor() == constructorObject) {
                return AsymmetricMatcherResult::PASS;
            } else if (otherProp.isBoolean() && globalObject->booleanObjectConstructor() == constructorObject) {
                return AsymmetricMatcherResult::PASS;
            } else if (otherProp.isSymbol() && globalObject->symbolObjectConstructor() == constructorObject) {
                return AsymmetricMatcherResult::PASS;
            } else if (otherProp.isString()) {
                if (auto* constructorFunction = jsDynamicCast<JSFunction*>(constructorObject)) {
                    String name = constructorFunction->name(vm);
                    if (name == "String"_s) {
                        return AsymmetricMatcherResult::PASS;
                    }
                } else if (auto* internalConstructorFunction = jsDynamicCast<InternalFunction*>(constructorObject)) {
                    String name = internalConstructorFunction->name();
                    if (name == "String"_s) {
                        return AsymmetricMatcherResult::PASS;
                    }
                }
            } else if (otherProp.isBigInt()) {
                if (auto* constructorFunction = jsDynamicCast<JSFunction*>(constructorObject)) {
                    String name = constructorFunction->name(vm);
                    if (name == "BigInt"_s) {
                        return AsymmetricMatcherResult::PASS;
                    }
                } else if (auto* internalConstructorFunction = jsDynamicCast<InternalFunction*>(constructorObject)) {
                    String name = internalConstructorFunction->name();
                    if (name == "BigInt"_s) {
                        return AsymmetricMatcherResult::PASS;
                    }
                }
            }

            return AsymmetricMatcherResult::FAIL;
        }

        if (constructorObject->hasInstance(globalObject, otherProp)) {
            return AsymmetricMatcherResult::PASS;
        }

        return AsymmetricMatcherResult::FAIL;
    } else if (auto* expectStringContaining = jsDynamicCast<JSExpectStringContaining*>(matcherPropCell)) {
        JSValue expectedSubstring = expectStringContaining->m_stringValue.get();

        if (otherProp.isString()) {
            String otherString = otherProp.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(*throwScope, AsymmetricMatcherResult::FAIL);

            String substring = expectedSubstring.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(*throwScope, AsymmetricMatcherResult::FAIL);

            if (otherString.find(substring) != WTF::notFound) {
                return AsymmetricMatcherResult::PASS;
            }
        }

        return AsymmetricMatcherResult::FAIL;
    } else if (auto* expectStringMatching = jsDynamicCast<JSExpectStringMatching*>(matcherPropCell)) {
        JSValue expectedTestValue = expectStringMatching->m_testValue.get();

        if (otherProp.isString()) {
            if (expectedTestValue.isString()) {
                String otherString = otherProp.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(*throwScope, AsymmetricMatcherResult::FAIL);

                String substring = expectedTestValue.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(*throwScope, AsymmetricMatcherResult::FAIL);

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
    }

    return AsymmetricMatcherResult::NOT_MATCHER;
}

template<typename PromiseType, bool isInternal>
static void handlePromise(PromiseType* promise, JSC__JSGlobalObject* globalObject, JSC::EncodedJSValue ctx, JSC__JSValue (*resolverFunction)(JSC__JSGlobalObject* arg0, JSC__CallFrame* callFrame), JSC__JSValue (*rejecterFunction)(JSC__JSGlobalObject* arg0, JSC__CallFrame* callFrame))
{

    auto globalThis = reinterpret_cast<Zig::GlobalObject*>(globalObject);

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
        JSC::call(globalThis, performPromiseThenFunction, callData, jsUndefined(), arguments);
    } else {
        promise->then(globalThis, resolverFunction, rejecterFunction);
    }
}

static bool canPerformFastPropertyEnumerationForIterationBun(Structure* s)
{
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
bool Bun__deepEquals(JSC__JSGlobalObject* globalObject, JSValue v1, JSValue v2, Vector<std::pair<JSC::JSValue, JSC::JSValue>, 16>& stack, ThrowScope* scope, bool addToStack)
{
    VM& vm = globalObject->vm();

    // need to check this before primitives, asymmetric matchers
    // can match against any type of value.
    if constexpr (enableAsymmetricMatchers) {
        JSCell* c1 = v1.asCell();
        JSCell* c2 = v2.asCell();
        if (v2.isCell() && !v2.isEmpty() && c2->type() == JSC::JSType(JSDOMWrapperType)) {
            switch (matchAsymmetricMatcher(globalObject, c2, v1, scope)) {
            case AsymmetricMatcherResult::FAIL:
                return false;
            case AsymmetricMatcherResult::PASS:
                return true;
            case AsymmetricMatcherResult::NOT_MATCHER:
                // continue comparison
                break;
            }
        } else if (v1.isCell() && !v1.isEmpty() && c1->type() == JSC::JSType(JSDOMWrapperType)) {
            switch (matchAsymmetricMatcher(globalObject, c1, v2, scope)) {
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

    if (!v1.isEmpty() && !v2.isEmpty() && JSC::sameValue(globalObject, v1, v2)) {
        return true;
    }

    if (v1.isEmpty() || v2.isEmpty())
        return v1.isEmpty() == v2.isEmpty();

    if (v1.isPrimitive() || v2.isPrimitive())
        return false;

    RELEASE_ASSERT(v1.isCell());
    RELEASE_ASSERT(v2.isCell());

    size_t length = stack.size();
    size_t originalLength = length;
    for (size_t i = 0; i < length; i++) {
        auto values = stack.at(i);
        if (JSC::JSValue::strictEqual(globalObject, values.first, v1)) {
            return JSC::JSValue::strictEqual(globalObject, values.second, v2);
        } else if (JSC::JSValue::strictEqual(globalObject, values.second, v2))
            return false;
    }

    if (addToStack) {
        stack.append({ v1, v2 });
    }

    JSCell* c1 = v1.asCell();
    JSCell* c2 = v2.asCell();
    JSObject* o1 = v1.getObject();
    JSObject* o2 = v2.getObject();
    JSC::JSType c1Type = c1->type();
    JSC::JSType c2Type = c2->type();

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

        IterationRecord iterationRecord1 = iteratorForIterable(globalObject, v1);
        bool isEqual = true;
        while (true) {
            JSValue next1 = iteratorStep(globalObject, iterationRecord1);
            if (next1.isFalse()) {
                break;
            }

            JSValue nextValue1 = iteratorValue(globalObject, next1);
            RETURN_IF_EXCEPTION(*scope, false);

            bool found = false;
            IterationRecord iterationRecord2 = iteratorForIterable(globalObject, v2);
            while (true) {
                JSValue next2 = iteratorStep(globalObject, iterationRecord2);
                if (UNLIKELY(next2.isFalse())) {
                    break;
                }

                JSValue nextValue2 = iteratorValue(globalObject, next2);
                RETURN_IF_EXCEPTION(*scope, false);

                // set has unique values, no need to count
                if (Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, nextValue1, nextValue2, stack, scope, false)) {
                    found = true;
                    if (!nextValue1.isPrimitive()) {
                        stack.append({ nextValue1, nextValue2 });
                    }
                    break;
                }
            }

            if (!found) {
                isEqual = false;
                break;
            }
        }

        if (!isEqual) {
            return false;
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

        IterationRecord iterationRecord1 = iteratorForIterable(globalObject, v1);
        bool isEqual = true;
        while (true) {
            JSValue next1 = iteratorStep(globalObject, iterationRecord1);
            if (next1.isFalse()) {
                break;
            }

            JSValue nextValue1 = iteratorValue(globalObject, next1);
            RETURN_IF_EXCEPTION(*scope, false);

            if (UNLIKELY(!nextValue1.isObject())) {
                return false;
            }

            JSObject* nextValueObject1 = asObject(nextValue1);

            JSValue key1 = nextValueObject1->getIndex(globalObject, static_cast<unsigned>(0));
            RETURN_IF_EXCEPTION(*scope, false);

            JSValue value1 = nextValueObject1->getIndex(globalObject, static_cast<unsigned>(1));
            RETURN_IF_EXCEPTION(*scope, false);

            bool found = false;
            IterationRecord iterationRecord2 = iteratorForIterable(globalObject, v2);
            while (true) {
                JSValue next2 = iteratorStep(globalObject, iterationRecord2);
                if (UNLIKELY(next2.isFalse())) {
                    break;
                }

                JSValue nextValue2 = iteratorValue(globalObject, next2);
                RETURN_IF_EXCEPTION(*scope, false);

                if (UNLIKELY(!nextValue2.isObject())) {
                    return false;
                }

                JSObject* nextValueObject2 = asObject(nextValue2);

                JSValue key2 = nextValueObject2->getIndex(globalObject, static_cast<unsigned>(0));
                RETURN_IF_EXCEPTION(*scope, false);

                JSValue value2 = nextValueObject2->getIndex(globalObject, static_cast<unsigned>(1));
                RETURN_IF_EXCEPTION(*scope, false);

                if (Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, key1, key2, stack, scope, false)) {
                    if (Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, nextValue1, nextValue2, stack, scope, false)) {
                        found = true;
                        if (!nextValue1.isPrimitive()) {
                            stack.append({ nextValue1, nextValue2 });
                        }
                        break;
                    }
                }
            }

            if (!found) {
                isEqual = false;
                break;
            }
        }

        if (!isEqual) {
            return false;
        }

        return true;
    }
    case ArrayBufferType: {
        if (c2Type != ArrayBufferType) {
            return false;
        }

        JSC::ArrayBuffer* left = jsCast<JSArrayBuffer*>(v1)->impl();
        JSC::ArrayBuffer* right = jsCast<JSArrayBuffer*>(v2)->impl();
        size_t byteLength = left->byteLength();

        if (right->byteLength() != byteLength) {
            return false;
        }

        if (byteLength == 0)
            return true;

        if (UNLIKELY(right->isDetached() || left->isDetached())) {
            return false;
        }

        const void* vector = left->data();
        const void* rightVector = right->data();
        if (UNLIKELY(!vector || !rightVector)) {
            return false;
        }

        if (UNLIKELY(vector == rightVector))
            return true;

        return (memcmp(vector, rightVector, byteLength) == 0);
    }
    case JSDateType: {
        if (c2Type != JSDateType) {
            return false;
        }

        JSC::DateInstance* left = jsCast<DateInstance*>(v1);
        JSC::DateInstance* right = jsCast<DateInstance*>(v2);

        return left->internalNumber() == right->internalNumber();
    }
    case RegExpObjectType: {
        if (c2Type != RegExpObjectType) {
            return false;
        }

        if (JSC::RegExpObject* left = jsDynamicCast<JSC::RegExpObject*>(v1)) {
            JSC::RegExpObject* right = jsDynamicCast<JSC::RegExpObject*>(v2);

            if (UNLIKELY(!right)) {
                return false;
            }

            return left->regExp()->key() == right->regExp()->key();
        }

        return false;
    }
    case Int8ArrayType:
    case Uint8ArrayType:
    case Uint8ClampedArrayType:
    case Int16ArrayType:
    case Uint16ArrayType:
    case Int32ArrayType:
    case Uint32ArrayType:
    case Float32ArrayType:
    case Float64ArrayType:
    case BigInt64ArrayType:
    case BigUint64ArrayType: {
        if (!isTypedArrayType(c2Type)) {
            return false;
        }

        JSC::JSArrayBufferView* left = jsCast<JSArrayBufferView*>(v1);
        JSC::JSArrayBufferView* right = jsCast<JSArrayBufferView*>(v2);
        size_t byteLength = left->byteLength();

        if (right->byteLength() != byteLength) {
            return false;
        }

        if (byteLength == 0)
            return true;

        if (UNLIKELY(right->isDetached() || left->isDetached())) {
            return false;
        }

        const void* vector = left->vector();
        const void* rightVector = right->vector();
        if (UNLIKELY(!vector || !rightVector)) {
            return false;
        }

        if (UNLIKELY(vector == rightVector))
            return true;

        return (memcmp(vector, rightVector, byteLength) == 0);
    }
    case StringObjectType: {
        if (c2Type != StringObjectType) {
            return false;
        }

        if (!equal(JSObject::calculatedClassName(o1), JSObject::calculatedClassName(o2))) {
            return false;
        }

        JSString* s1 = c1->toStringInline(globalObject);
        JSString* s2 = c2->toStringInline(globalObject);

        return s1->equal(globalObject, s2);
    }
    case JSFunctionType: {
        return false;
    }
    default: {
        break;
    }
    }

    bool v1Array = isArray(globalObject, v1);
    RETURN_IF_EXCEPTION(*scope, false);
    bool v2Array = isArray(globalObject, v2);
    RETURN_IF_EXCEPTION(*scope, false);

    if (v1Array != v2Array)
        return false;

    if (v1Array && v2Array) {
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
            RETURN_IF_EXCEPTION(*scope, false);
            JSValue right = getIndexWithoutAccessors(globalObject, o2, i);
            RETURN_IF_EXCEPTION(*scope, false);

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

            if (!Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, left, right, stack, scope, true)) {
                return false;
            }

            RETURN_IF_EXCEPTION(*scope, false);
        }

        for (; i < array2Length; i++) {
            JSValue right = getIndexWithoutAccessors(globalObject, o2, i);
            RETURN_IF_EXCEPTION(*scope, false);

            if (((right.isEmpty() || right.isUndefined()))) {
                continue;
            }

            return false;
        }

        JSC::PropertyNameArray a1(vm, PropertyNameMode::Symbols, PrivateSymbolMode::Include);
        JSC::PropertyNameArray a2(vm, PropertyNameMode::Symbols, PrivateSymbolMode::Include);
        JSObject::getOwnPropertyNames(o1, globalObject, a1, DontEnumPropertiesMode::Exclude);
        JSObject::getOwnPropertyNames(o2, globalObject, a2, DontEnumPropertiesMode::Exclude);

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
            RETURN_IF_EXCEPTION(*scope, false);

            if (UNLIKELY(!prop1)) {
                return false;
            }

            JSValue prop2 = o2->getIfPropertyExists(globalObject, propertyName1);
            RETURN_IF_EXCEPTION(*scope, false);

            if constexpr (!isStrict) {
                if (prop1.isUndefined() && prop2.isEmpty()) {
                    continue;
                }
            }

            if (!prop2) {
                return false;
            }

            if (!Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, prop1, prop2, stack, scope, true)) {
                return false;
            }

            RETURN_IF_EXCEPTION(*scope, false);
        }

        if (addToStack) {
            stack.remove(originalLength);
        }

        RETURN_IF_EXCEPTION(*scope, false);

        return true;
    }

    if constexpr (isStrict) {
        if (!equal(JSObject::calculatedClassName(o1), JSObject::calculatedClassName(o2))) {
            return false;
        }
    }

    JSC::Structure* o1Structure = o1->structure();
    if (canPerformFastPropertyEnumerationForIterationBun(o1Structure)) {
        JSC::Structure* o2Structure = o2->structure();
        if (canPerformFastPropertyEnumerationForIterationBun(o2Structure)) {

            size_t count1 = 0;

            bool result = true;
            if constexpr (isStrict) {
                if (o2Structure->inlineSize() + o2Structure->outOfLineSize() != o1Structure->inlineSize() + o1Structure->outOfLineSize()) {
                    return false;
                }
            }

            o1Structure->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
                if (entry.attributes() & PropertyAttribute::DontEnum) {
                    return true;
                }
                count1++;

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

                if (left == right || JSC::sameValue(globalObject, left, right)) {
                    return true;
                }

                if (!Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, left, right, stack, scope, true)) {
                    result = false;
                    return false;
                }

                return true;
            });

            if (result && o2Structure->id() != o1Structure->id()) {
                size_t remain = count1;
                o2Structure->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
                    if (entry.attributes() & PropertyAttribute::DontEnum) {
                        return true;
                    }

                    if constexpr (!isStrict) {
                        if (o2->getDirect(entry.offset()).isUndefined()) {
                            return true;
                        }
                    }

                    if (remain == 0) {
                        result = false;
                        return false;
                    }

                    remain--;
                    return true;
                });
            }

            if (addToStack) {
                stack.remove(originalLength);
            }

            return result;
        }
    }

    JSC::PropertyNameArray a1(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Include);
    JSC::PropertyNameArray a2(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Include);
    o1->getPropertyNames(globalObject, a1, DontEnumPropertiesMode::Exclude);
    o2->getPropertyNames(globalObject, a2, DontEnumPropertiesMode::Exclude);

    const size_t propertyArrayLength = a1.size();
    if (propertyArrayLength != a2.size()) {
        return false;
    }

    // take a property name from one, try to get it from both
    for (size_t i = 0; i < propertyArrayLength; i++) {
        Identifier i1 = a1[i];
        PropertyName propertyName1 = PropertyName(i1);

        JSValue prop1 = o1->get(globalObject, propertyName1);
        RETURN_IF_EXCEPTION(*scope, false);

        if (UNLIKELY(!prop1)) {
            return false;
        }

        JSValue prop2 = o2->getIfPropertyExists(globalObject, propertyName1);
        RETURN_IF_EXCEPTION(*scope, false);

        if constexpr (!isStrict) {
            if (prop1.isUndefined() && prop2.isEmpty()) {
                continue;
            }
        }

        if (!prop2) {
            return false;
        }

        if (!Bun__deepEquals<isStrict, enableAsymmetricMatchers>(globalObject, prop1, prop2, stack, scope, true)) {
            return false;
        }

        RETURN_IF_EXCEPTION(*scope, false);
    }

    if (addToStack) {
        stack.remove(originalLength);
    }

    return true;
}

template<bool enableAsymmetricMatchers>
bool Bun__deepMatch(JSValue objValue, JSValue subsetValue, JSGlobalObject* globalObject, ThrowScope* throwScope, bool replacePropsWithAsymmetricMatchers)
{
    VM& vm = globalObject->vm();
    JSObject* obj = objValue.getObject();
    JSObject* subsetObj = subsetValue.getObject();

    PropertyNameArray subsetProps(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Include);
    subsetObj->getPropertyNames(globalObject, subsetProps, DontEnumPropertiesMode::Exclude);

    // TODO: add fast paths for:
    // - two "simple" objects (using ->forEachProperty in both)
    // - two "simple" arrays
    // similar to what is done in deepEquals (canPerformFastPropertyEnumerationForIterationBun)

    // arrays should match exactly
    if (isArray(globalObject, objValue) && isArray(globalObject, subsetValue)) {
        if (obj->getArrayLength() != subsetObj->getArrayLength()) {
            return false;
        }
        PropertyNameArray objProps(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Include);
        obj->getPropertyNames(globalObject, objProps, DontEnumPropertiesMode::Exclude);
        if (objProps.size() != subsetProps.size()) {
            return false;
        }
    }

    for (size_t i = 0; i < subsetProps.size(); i++) {
        JSValue prop = obj->getIfPropertyExists(globalObject, subsetProps[i]);
        RETURN_IF_EXCEPTION(*throwScope, false);

        if (prop.isEmpty()) {
            return false;
        }

        JSValue subsetProp = subsetObj->get(globalObject, subsetProps[i]);
        RETURN_IF_EXCEPTION(*throwScope, false);

        JSCell* subsetPropCell = subsetProp.asCell();
        JSCell* propCell = prop.asCell();

        if constexpr (enableAsymmetricMatchers) {
            if (subsetProp.isCell() && !subsetProp.isEmpty() && subsetPropCell->type() == JSC::JSType(JSDOMWrapperType)) {
                switch (matchAsymmetricMatcher(globalObject, subsetPropCell, prop, throwScope)) {
                case AsymmetricMatcherResult::FAIL:
                    return false;
                case AsymmetricMatcherResult::PASS:
                    if (replacePropsWithAsymmetricMatchers) {
                        obj->putDirect(vm, subsetProps[i], subsetProp);
                    }
                    // continue to next subset prop
                    continue;
                case AsymmetricMatcherResult::NOT_MATCHER:
                    break;
                }
            } else if (prop.isCell() && !prop.isEmpty() && propCell->type() == JSC::JSType(JSDOMWrapperType)) {
                switch (matchAsymmetricMatcher(globalObject, propCell, subsetProp, throwScope)) {
                case AsymmetricMatcherResult::FAIL:
                    return false;
                case AsymmetricMatcherResult::PASS:
                    if (replacePropsWithAsymmetricMatchers) {
                        subsetObj->putDirect(vm, subsetProps[i], prop);
                    }
                    // continue to next subset prop
                    continue;
                case AsymmetricMatcherResult::NOT_MATCHER:
                    break;
                }
            }
        }

        if (subsetProp.isObject() and prop.isObject()) {
            if (!Bun__deepMatch<enableAsymmetricMatchers>(prop, subsetProp, globalObject, throwScope, replacePropsWithAsymmetricMatchers)) {
                return false;
            }
        } else {
            if (!sameValue(globalObject, prop, subsetProp)) {
                return false;
            }
        }
    }

    return true;
}

extern "C" {

bool WebCore__FetchHeaders__isEmpty(WebCore__FetchHeaders* arg0)
{
    return arg0->size() == 0;
}

void WebCore__FetchHeaders__toUWSResponse(WebCore__FetchHeaders* arg0, bool is_ssl, void* arg2)
{
    if (is_ssl) {
        copyToUWS<uWS::HttpResponse<true>>(arg0, reinterpret_cast<uWS::HttpResponse<true>*>(arg2));
    } else {
        copyToUWS<uWS::HttpResponse<false>>(arg0, reinterpret_cast<uWS::HttpResponse<false>*>(arg2));
    }
}

WebCore__FetchHeaders* WebCore__FetchHeaders__createEmpty()
{
    return new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
}
void WebCore__FetchHeaders__append(WebCore__FetchHeaders* headers, const ZigString* arg1, const ZigString* arg2,
    JSC__JSGlobalObject* lexicalGlobalObject)
{
    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
    WebCore::propagateException(*lexicalGlobalObject, throwScope,
        headers->append(Zig::toString(*arg1), Zig::toString(*arg2)));
}
WebCore__FetchHeaders* WebCore__FetchHeaders__cast_(JSC__JSValue JSValue0, JSC__VM* vm)
{
    return WebCoreCast<WebCore::JSFetchHeaders, WebCore__FetchHeaders>(JSValue0);
}

WebCore__FetchHeaders* WebCore__FetchHeaders__createFromJS(JSC__JSGlobalObject* lexicalGlobalObject, JSC__JSValue argument0_)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    EnsureStillAliveScope argument0 = JSC::JSValue::decode(argument0_);

    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
    // Note that we use IDLDOMString here rather than IDLByteString: while headers
    //  should be ASCII only, we want the headers->fill implementation to discover
    //  and error on invalid names and values
    using TargetType = IDLUnion<IDLSequence<IDLSequence<IDLDOMString>>, IDLRecord<IDLDOMString, IDLDOMString>>;
    using Converter = std::optional<Converter<TargetType>::ReturnType>;
    auto init = argument0.value().isUndefined() ? Converter() : Converter(convert<TargetType>(*lexicalGlobalObject, argument0.value()));
    RETURN_IF_EXCEPTION(throwScope, nullptr);

    auto* headers = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
    if (init) {
        // `fill` doesn't set an exception on the VM if it fails, it returns an
        //  ExceptionOr<void>.  So we need to check for the exception and, if set,
        //  translate it to JSValue and throw it.
        WebCore::propagateException(*lexicalGlobalObject, throwScope,
            headers->fill(WTFMove(init.value())));
    }
    return headers;
}

JSC__JSValue WebCore__FetchHeaders__toJS(WebCore__FetchHeaders* headers, JSC__JSGlobalObject* lexicalGlobalObject)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);

    return JSC::JSValue::encode(WebCore::toJS(lexicalGlobalObject, globalObject, headers));
}
JSC__JSValue WebCore__FetchHeaders__clone(WebCore__FetchHeaders* headers, JSC__JSGlobalObject* arg1)
{
    auto throwScope = DECLARE_THROW_SCOPE(arg1->vm());
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(arg1);
    auto* clone = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
    WebCore::propagateException(*arg1, throwScope,
        clone->fill(*headers));
    return JSC::JSValue::encode(WebCore::toJSNewlyCreated(arg1, globalObject, WTFMove(clone)));
}

WebCore__FetchHeaders* WebCore__FetchHeaders__cloneThis(WebCore__FetchHeaders* headers, JSC__JSGlobalObject* lexicalGlobalObject)
{
    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());
    auto* clone = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
    WebCore::propagateException(*lexicalGlobalObject, throwScope,
        clone->fill(*headers));
    return clone;
}

bool WebCore__FetchHeaders__fastHas_(WebCore__FetchHeaders* arg0, unsigned char HTTPHeaderName1)
{
    return arg0->fastHas(static_cast<HTTPHeaderName>(HTTPHeaderName1));
}

void WebCore__FetchHeaders__copyTo(WebCore__FetchHeaders* headers, StringPointer* names, StringPointer* values, unsigned char* buf)
{
    auto iter = headers->createIterator();
    uint32_t i = 0;
    unsigned count = 0;

    for (auto pair = iter.next(); pair; pair = iter.next()) {
        auto name = pair->key;
        auto value = pair->value;
        names[count] = { i, name.length() };

        if (name.is8Bit())
            memcpy(&buf[i], name.characters8(), name.length());
        else {
            StringImpl::copyCharacters(&buf[i], name.characters16(), name.length());
        }

        i += name.length();
        values[count++] = { i, value.length() };
        if (value.is8Bit())
            memcpy(&buf[i], value.characters8(), value.length());
        else
            StringImpl::copyCharacters(&buf[i], value.characters16(), value.length());

        i += value.length();
    }
}
void WebCore__FetchHeaders__count(WebCore__FetchHeaders* headers, uint32_t* count, uint32_t* buf_len)
{
    auto iter = headers->createIterator();
    uint32_t i = 0;
    for (auto pair = iter.next(); pair; pair = iter.next()) {
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
            if (header.value.len == 0)
                continue;

            StringView nameView = StringView(reinterpret_cast<const char*>(header.name.ptr), header.name.len);

            LChar* data = nullptr;
            auto value = String::createUninitialized(header.value.len, data);
            memcpy(data, header.value.ptr, header.value.len);

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

        headers->setInternalHeaders(WTFMove(map));
    }
    return headers;
}
WebCore::FetchHeaders* WebCore__FetchHeaders__createFromUWS(JSC__JSGlobalObject* arg0, void* arg1)
{
    uWS::HttpRequest req = *reinterpret_cast<uWS::HttpRequest*>(arg1);
    size_t i = 0;

    auto* headers = new WebCore::FetchHeaders({ WebCore::FetchHeaders::Guard::None, {} });
    HTTPHeaderMap map = HTTPHeaderMap();

    for (const auto& header : req) {
        StringView nameView = StringView(reinterpret_cast<const LChar*>(header.first.data()), header.first.length());
        size_t name_len = nameView.length();

        LChar* data = nullptr;
        auto value = String::createUninitialized(header.second.length(), data);
        memcpy(data, header.second.data(), header.second.length());

        HTTPHeaderName name;

        if (WebCore::findHTTPHeaderName(nameView, name)) {
            map.add(name, WTFMove(value));
        } else {
            map.setUncommonHeader(nameView.toString().isolatedCopy(), WTFMove(value));
        }

        // seenHeaderSizes[name_len] = true;

        if (i > 56)
            __builtin_unreachable();
    }

    headers->setInternalHeaders(WTFMove(map));
    return headers;
}
void WebCore__FetchHeaders__deref(WebCore__FetchHeaders* arg0)
{
    arg0->deref();
}

JSC__JSValue WebCore__FetchHeaders__createValue(JSC__JSGlobalObject* arg0, StringPointer* arg1, StringPointer* arg2, const ZigString* arg3, uint32_t count)
{
    auto throwScope = DECLARE_THROW_SCOPE(arg0->vm());
    Vector<KeyValuePair<String, String>> pairs;
    pairs.reserveCapacity(count);
    ZigString buf = *arg3;
    for (uint32_t i = 0; i < count; i++) {
        WTF::String name = Zig::toStringCopy(buf, arg1[i]);
        WTF::String value = Zig::toStringCopy(buf, arg2[i]);
        pairs.uncheckedAppend(KeyValuePair<String, String>(name, value));
    }

    Ref<WebCore::FetchHeaders> headers = WebCore::FetchHeaders::create();
    WebCore::propagateException(*arg0, throwScope,
        headers->fill(WebCore::FetchHeaders::Init(WTFMove(pairs))));
    pairs.releaseBuffer();
    return JSC::JSValue::encode(WebCore::toJSNewlyCreated(arg0, reinterpret_cast<Zig::GlobalObject*>(arg0), WTFMove(headers)));
}
void WebCore__FetchHeaders__get_(WebCore__FetchHeaders* headers, const ZigString* arg1, ZigString* arg2, JSC__JSGlobalObject* global)
{
    auto throwScope = DECLARE_THROW_SCOPE(global->vm());
    auto result = headers->get(Zig::toString(*arg1));
    if (result.hasException())
        WebCore::propagateException(*global, throwScope, result.releaseException());
    else
        *arg2 = Zig::toZigString(result.releaseReturnValue());
}
bool WebCore__FetchHeaders__has(WebCore__FetchHeaders* headers, const ZigString* arg1, JSC__JSGlobalObject* global)
{
    auto throwScope = DECLARE_THROW_SCOPE(global->vm());
    auto result = headers->has(Zig::toString(*arg1));
    if (result.hasException()) {
        WebCore::propagateException(*global, throwScope, result.releaseException());
        return false;
    } else
        return result.releaseReturnValue();
}
void WebCore__FetchHeaders__put_(WebCore__FetchHeaders* headers, const ZigString* arg1, const ZigString* arg2, JSC__JSGlobalObject* global)
{
    auto throwScope = DECLARE_THROW_SCOPE(global->vm());
    WebCore::propagateException(*global, throwScope,
        headers->set(Zig::toString(*arg1), Zig::toString(*arg2)));
}
void WebCore__FetchHeaders__remove(WebCore__FetchHeaders* headers, const ZigString* arg1, JSC__JSGlobalObject* global)
{
    auto throwScope = DECLARE_THROW_SCOPE(global->vm());
    WebCore::propagateException(*global, throwScope,
        headers->remove(Zig::toString(*arg1)));
}

void WebCore__FetchHeaders__fastRemove_(WebCore__FetchHeaders* headers, unsigned char headerName)
{
    headers->fastRemove(static_cast<WebCore::HTTPHeaderName>(headerName));
}

void WebCore__FetchHeaders__fastGet_(WebCore__FetchHeaders* headers, unsigned char headerName, ZigString* arg2)
{
    auto str = headers->fastGet(static_cast<WebCore::HTTPHeaderName>(headerName));
    if (!str) {
        return;
    }

    *arg2 = Zig::toZigString(str);
}

WebCore__DOMURL* WebCore__DOMURL__cast_(JSC__JSValue JSValue0, JSC::VM* vm)
{
    return WebCoreCast<WebCore::JSDOMURL, WebCore__DOMURL>(JSValue0);
}

void WebCore__DOMURL__href_(WebCore__DOMURL* domURL, ZigString* arg1)
{
    const WTF::URL& href = domURL->href();
    *arg1 = Zig::toZigString(href.string());
}
void WebCore__DOMURL__pathname_(WebCore__DOMURL* domURL, ZigString* arg1)
{
    const WTF::URL& href = domURL->href();
    const WTF::StringView& pathname = href.path();
    *arg1 = Zig::toZigString(pathname);
}

BunString WebCore__DOMURL__fileSystemPath(WebCore__DOMURL* arg0)
{
    const WTF::URL& url = arg0->href();
    if (url.isLocalFile()) {
        return Bun::toString(url.fileSystemPath());
    }

    return BunStringEmpty;
}

extern "C" JSC__JSValue ZigString__toJSONObject(const ZigString* strPtr, JSC::JSGlobalObject* globalObject)
{
    auto str = Zig::toString(*strPtr);
    auto throwScope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto scope = DECLARE_CATCH_SCOPE(globalObject->vm());
    JSValue result = JSONParseWithException(globalObject, str);
    if (auto* exception = scope.exception()) {
        scope.clearException();
        RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(exception->value()));
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(result));
}

JSC__JSValue SystemError__toErrorInstance(const SystemError* arg0,
    JSC__JSGlobalObject* globalObject)
{

    static const char* system_error_name = "SystemError";
    SystemError err = *arg0;

    JSC::VM& vm = globalObject->vm();

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue message = JSC::jsUndefined();
    if (err.message.len > 0) {
        message = Zig::toJSString(err.message, globalObject);
    }

    JSC::JSValue options = JSC::jsUndefined();

    JSC::JSObject* result
        = JSC::ErrorInstance::create(globalObject, JSC::ErrorInstance::createStructure(vm, globalObject, globalObject->errorPrototype()), message, options);

    auto clientData = WebCore::clientData(vm);

    if (err.code.len > 0 && !(err.code.len == 1 and err.code.ptr[0] == 0)) {
        JSC::JSValue code = Zig::toJSStringGC(err.code, globalObject);
        result->putDirect(vm, clientData->builtinNames().codePublicName(), code,
            JSC::PropertyAttribute::DontDelete | 0);

        result->putDirect(vm, vm.propertyNames->name, code, JSC::PropertyAttribute::DontEnum | 0);
    } else {

        result->putDirect(
            vm, vm.propertyNames->name,
            JSC::JSValue(JSC::jsOwnedString(
                vm, WTF::String(WTF::StringImpl::createWithoutCopying(system_error_name, 11)))),
            JSC::PropertyAttribute::DontEnum | 0);
    }

    if (err.path.len > 0) {
        JSC::JSValue path = JSC::JSValue(Zig::toJSStringGC(err.path, globalObject));
        result->putDirect(vm, clientData->builtinNames().pathPublicName(), path,
            JSC::PropertyAttribute::DontDelete | 0);
    }

    if (err.fd != -1) {
        JSC::JSValue fd = JSC::JSValue(jsNumber(err.fd));
        result->putDirect(vm, JSC::Identifier::fromString(vm, "fd"_s), fd,
            JSC::PropertyAttribute::DontDelete | 0);
    }

    if (err.syscall.len > 0) {
        JSC::JSValue syscall = JSC::JSValue(Zig::toJSString(err.syscall, globalObject));
        result->putDirect(vm, clientData->builtinNames().syscallPublicName(), syscall,
            JSC::PropertyAttribute::DontDelete | 0);
    }

    result->putDirect(vm, clientData->builtinNames().errnoPublicName(), JSC::JSValue(err.errno_),
        JSC::PropertyAttribute::DontDelete | 0);

    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::JSValue()));
    scope.release();

    return JSC::JSValue::encode(JSC::JSValue(result));
}

JSC__JSValue
JSC__JSObject__create(JSC__JSGlobalObject* globalObject, size_t initialCapacity, void* arg2,
    void (*ArgFn3)(void* arg0, JSC__JSObject* arg1, JSC__JSGlobalObject* arg2))
{
    JSC::JSObject* object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), initialCapacity);

    ArgFn3(arg2, object, globalObject);

    return JSC::JSValue::encode(object);
}

JSC__JSValue JSC__JSValue__createEmptyObject(JSC__JSGlobalObject* globalObject,
    size_t initialCapacity)
{
    return JSC::JSValue::encode(
        JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), initialCapacity));
}

extern "C" uint64_t Bun__Blob__getSizeForBindings(void* blob);

double JSC__JSValue__getLengthIfPropertyExistsInternal(JSC__JSValue value, JSC__JSGlobalObject* globalObject)
{
    JSC::JSValue jsValue = JSC::JSValue::decode(value);
    if (!jsValue || !jsValue.isCell())
        return 0;
    JSCell* cell = jsValue.asCell();
    JSC::JSType type = cell->type();

    switch (type) {
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

    case JSC::JSType(JSDOMWrapperType): {
        if (auto* headers = jsDynamicCast<WebCore::JSFetchHeaders*>(cell))
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
            if (JSValue lengthValue = object->getIfPropertyExists(globalObject, globalObject->vm().propertyNames->length)) {
                RETURN_IF_EXCEPTION(scope, 0);
                RELEASE_AND_RETURN(scope, lengthValue.toNumber(globalObject));
            }
        }
    }
    }

    return std::numeric_limits<double>::infinity();
}

void JSC__JSObject__putRecord(JSC__JSObject* object, JSC__JSGlobalObject* global, ZigString* key,
    ZigString* values, size_t valuesLen)
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
            if ((array = JSC::JSArray::tryCreateUninitializedRestricted(
                     initializationScope, nullptr,
                     global->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
                     valuesLen))) {

                for (size_t i = 0; i < valuesLen; ++i) {
                    array->initializeIndexWithoutBarrier(
                        initializationScope, i, JSC::jsString(global->vm(), Zig::toStringCopy(values[i])));
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
void JSC__JSValue__putRecord(JSC__JSValue objectValue, JSC__JSGlobalObject* global, ZigString* key,
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

JSC__JSInternalPromise* JSC__JSValue__asInternalPromise(JSC__JSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return JSC::jsDynamicCast<JSC::JSInternalPromise*>(value);
}

JSC__JSPromise* JSC__JSValue__asPromise(JSC__JSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return JSC::jsDynamicCast<JSC::JSPromise*>(value);
}
JSC__JSValue JSC__JSValue__createInternalPromise(JSC__JSGlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();
    return JSC::JSValue::encode(
        JSC::JSValue(JSC::JSInternalPromise::create(vm, globalObject->internalPromiseStructure())));
}

void JSC__JSFunction__optimizeSoon(JSC__JSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);

    JSC::optimizeNextInvocation(value);
}

void JSC__JSValue__jsonStringify(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, uint32_t arg2,
    ZigString* arg3)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    WTF::String str = JSC::JSONStringify(arg1, value, (unsigned)arg2);
    *arg3 = Zig::toZigString(str);
}
unsigned char JSC__JSValue__jsType(JSC__JSValue JSValue0)
{
    JSC::JSValue jsValue = JSC::JSValue::decode(JSValue0);
    // if the value is NOT a cell
    // asCell will return an invalid pointer rather than a nullptr
    if (jsValue.isCell())
        return jsValue.asCell()->type();

    return 0;
}

JSC__JSValue JSC__JSPromise__asValue(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1)
{
    return JSC::JSValue::encode(JSC::JSValue(arg0));
}
JSC__JSPromise* JSC__JSPromise__create(JSC__JSGlobalObject* arg0)
{
    return JSC::JSPromise::create(arg0->vm(), arg0->promiseStructure());
}

// TODO: prevent this from allocating so much memory
void JSC__JSValue___then(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, JSC__JSValue arg2, JSC__JSValue (*ArgFn3)(JSC__JSGlobalObject* arg0, JSC__CallFrame* arg1), JSC__JSValue (*ArgFn4)(JSC__JSGlobalObject* arg0, JSC__CallFrame* arg1))
{

    auto* cell = JSC::JSValue::decode(JSValue0).asCell();

    if (JSC::JSPromise* promise = JSC::jsDynamicCast<JSC::JSPromise*>(cell)) {
        handlePromise<JSC::JSPromise, false>(promise, arg1, arg2, ArgFn3, ArgFn4);
    } else if (JSC::JSInternalPromise* promise = JSC::jsDynamicCast<JSC::JSInternalPromise*>(cell)) {
        RELEASE_ASSERT(false);
    }
}

JSC__JSValue JSC__JSValue__parseJSON(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue jsValue = JSC::JSValue::decode(JSValue0);

    JSC::JSValue result = JSC::JSONParse(arg1, jsValue.toWTFString(arg1));

    if (!result) {
        result = JSC::JSValue(JSC::createSyntaxError(arg1->globalObject(), "Failed to parse JSON"_s));
    }

    return JSC::JSValue::encode(result);
}

JSC__JSValue JSC__JSGlobalObject__getCachedObject(JSC__JSGlobalObject* globalObject, const ZigString* arg1)
{
    JSC::VM& vm = globalObject->vm();
    WTF::String string = Zig::toString(*arg1);
    auto symbol = vm.privateSymbolRegistry().symbolForKey(string);
    JSC::Identifier ident = JSC::Identifier::fromUid(symbol);
    JSC::JSValue result = globalObject->getIfPropertyExists(globalObject, ident);
    return JSC::JSValue::encode(result);
}
JSC__JSValue JSC__JSGlobalObject__putCachedObject(JSC__JSGlobalObject* globalObject, const ZigString* arg1, JSC__JSValue JSValue2)
{
    JSC::VM& vm = globalObject->vm();
    WTF::String string = Zig::toString(*arg1);
    auto symbol = vm.privateSymbolRegistry().symbolForKey(string);
    JSC::Identifier ident = JSC::Identifier::fromUid(symbol);
    globalObject->putDirect(vm, ident, JSC::JSValue::decode(JSValue2), JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::DontEnum);
    return JSValue2;
}

void JSC__JSGlobalObject__deleteModuleRegistryEntry(JSC__JSGlobalObject* global, ZigString* arg1)
{
    JSC::JSMap* map = JSC::jsDynamicCast<JSC::JSMap*>(
        global->moduleLoader()->getDirect(global->vm(), JSC::Identifier::fromString(global->vm(), "registry"_s)));
    if (!map)
        return;
    const JSC::Identifier identifier = Zig::toIdentifier(*arg1, global);
    JSC::JSValue val = JSC::identifierToJSValue(global->vm(), identifier);

    map->remove(global, val);
}

void JSC__VM__collectAsync(JSC__VM* vm)
{
    vm->heap.collectAsync();
}

size_t JSC__VM__heapSize(JSC__VM* arg0)
{
    return arg0->heap.size();
}

// This is very naive!
JSC__JSInternalPromise* JSC__VM__reloadModule(JSC__VM* vm, JSC__JSGlobalObject* arg1,
    ZigString arg2)
{
    return nullptr;
    // JSC::JSMap *map = JSC::jsDynamicCast<JSC::JSMap *>(
    //   arg1->vm(), arg1->moduleLoader()->getDirect(
    //                 arg1->vm(), JSC::Identifier::fromString(arg1->vm(), "registry"_s)));

    // const JSC::Identifier identifier = Zig::toIdentifier(arg2, arg1);
    // JSC::JSValue val = JSC::identifierToJSValue(arg1->vm(), identifier);

    // if (!map->has(arg1, val)) return nullptr;

    // if (JSC::JSObject *registryEntry =
    //       JSC::jsDynamicCast<JSC::JSObject *>(arg1-> map->get(arg1, val))) {
    //   auto moduleIdent = JSC::Identifier::fromString(arg1->vm(), "module");
    //   if (JSC::JSModuleRecord *record = JSC::jsDynamicCast<JSC::JSModuleRecord *>(
    //         arg1->vm(), registryEntry->getDirect(arg1->vm(), moduleIdent))) {
    //     registryEntry->putDirect(arg1->vm(), moduleIdent, JSC::jsUndefined());
    //     JSC::JSModuleRecord::destroy(static_cast<JSC::JSCell *>(record));
    //   }
    //   map->remove(arg1, val);
    //   return JSC__JSModuleLoader__loadAndEvaluateModule(arg1, arg2);
    // }

    // return nullptr;
}

bool JSC__JSValue__isSameValue(JSC__JSValue JSValue0, JSC__JSValue JSValue1,
    JSC__JSGlobalObject* globalObject)
{
    JSC::JSValue left = JSC::JSValue::decode(JSValue0);
    JSC::JSValue right = JSC::JSValue::decode(JSValue1);
    return JSC::sameValue(globalObject, left, right);
}

bool JSC__JSValue__deepEquals(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* globalObject)
{
    JSValue v1 = JSValue::decode(JSValue0);
    JSValue v2 = JSValue::decode(JSValue1);

    ThrowScope scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Vector<std::pair<JSValue, JSValue>, 16> stack;
    return Bun__deepEquals<false, false>(globalObject, v1, v2, stack, &scope, true);
}

bool JSC__JSValue__jestDeepEquals(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* globalObject)
{
    JSValue v1 = JSValue::decode(JSValue0);
    JSValue v2 = JSValue::decode(JSValue1);

    ThrowScope scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Vector<std::pair<JSValue, JSValue>, 16> stack;
    return Bun__deepEquals<false, true>(globalObject, v1, v2, stack, &scope, true);
}

bool JSC__JSValue__strictDeepEquals(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* globalObject)
{
    JSValue v1 = JSValue::decode(JSValue0);
    JSValue v2 = JSValue::decode(JSValue1);

    ThrowScope scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Vector<std::pair<JSValue, JSValue>, 16> stack;
    return Bun__deepEquals<true, false>(globalObject, v1, v2, stack, &scope, true);
}

bool JSC__JSValue__jestStrictDeepEquals(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* globalObject)
{
    JSValue v1 = JSValue::decode(JSValue0);
    JSValue v2 = JSValue::decode(JSValue1);

    ThrowScope scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Vector<std::pair<JSValue, JSValue>, 16> stack;
    return Bun__deepEquals<true, true>(globalObject, v1, v2, stack, &scope, true);
}

bool JSC__JSValue__deepMatch(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* globalObject, bool replacePropsWithAsymmetricMatchers)
{
    JSValue obj = JSValue::decode(JSValue0);
    JSValue subset = JSValue::decode(JSValue1);

    ThrowScope scope = DECLARE_THROW_SCOPE(globalObject->vm());

    return Bun__deepMatch<false>(obj, subset, globalObject, &scope, replacePropsWithAsymmetricMatchers);
}

bool JSC__JSValue__jestDeepMatch(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* globalObject, bool replacePropsWithAsymmetricMatchers)
{
    JSValue obj = JSValue::decode(JSValue0);
    JSValue subset = JSValue::decode(JSValue1);

    ThrowScope scope = DECLARE_THROW_SCOPE(globalObject->vm());

    return Bun__deepMatch<true>(obj, subset, globalObject, &scope, replacePropsWithAsymmetricMatchers);
}

// This is the same as the C API version, except it returns a JSValue which may be a *Exception
// We want that so we can return stack traces.
JSC__JSValue JSObjectCallAsFunctionReturnValue(JSContextRef ctx, JSObjectRef object,
    JSObjectRef thisObject, size_t argumentCount,
    const JSValueRef* arguments);

JSC__JSValue JSObjectCallAsFunctionReturnValue(JSContextRef ctx, JSObjectRef object,
    JSObjectRef thisObject, size_t argumentCount,
    const JSValueRef* arguments)
{
    JSC::JSGlobalObject* globalObject = toJS(ctx);
    JSC::VM& vm = globalObject->vm();

    if (!object)
        return JSC::JSValue::encode(JSC::JSValue());

    JSC::JSObject* jsObject = toJS(object);
    JSC::JSObject* jsThisObject = toJS(thisObject);

    if (!jsThisObject)
        jsThisObject = globalObject->globalThis();

    JSC::MarkedArgumentBuffer argList;
    for (size_t i = 0; i < argumentCount; i++)
        argList.append(toJS(globalObject, arguments[i]));

    auto callData = getCallData(jsObject);
    if (callData.type == JSC::CallData::Type::None)
        return JSC::JSValue::encode(JSC::JSValue());

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::call(globalObject, jsObject, callData, jsThisObject, argList, returnedException);

    if (returnedException.get()) {
        return JSC::JSValue::encode(JSC::JSValue(returnedException.get()));
    }

    return JSC::JSValue::encode(result);
}

JSC__JSValue JSObjectCallAsFunctionReturnValueHoldingAPILock(JSContextRef ctx, JSObjectRef object,
    JSObjectRef thisObject,
    size_t argumentCount,
    const JSValueRef* arguments);

JSC__JSValue JSObjectCallAsFunctionReturnValueHoldingAPILock(JSContextRef ctx, JSObjectRef object,
    JSObjectRef thisObject,
    size_t argumentCount,
    const JSValueRef* arguments)
{
    JSC::JSGlobalObject* globalObject = toJS(ctx);
    JSC::VM& vm = globalObject->vm();

    JSC::JSLockHolder lock(vm);

    if (!object)
        return JSC::JSValue::encode(JSC::JSValue());

    JSC::JSObject* jsObject = toJS(object);
    JSC::JSObject* jsThisObject = toJS(thisObject);

    if (!jsThisObject)
        jsThisObject = globalObject->globalThis();

    JSC::MarkedArgumentBuffer argList;
    for (size_t i = 0; i < argumentCount; i++)
        argList.append(toJS(globalObject, arguments[i]));

    auto callData = getCallData(jsObject);
    if (callData.type == JSC::CallData::Type::None)
        return JSC::JSValue::encode(JSC::JSValue());

    NakedPtr<JSC::Exception> returnedException = nullptr;
    auto result = JSC::call(globalObject, jsObject, callData, jsThisObject, argList, returnedException);

    if (returnedException.get()) {
        return JSC::JSValue::encode(JSC::JSValue(returnedException.get()));
    }

    return JSC::JSValue::encode(result);
}

#pragma mark - JSC::Exception

JSC__Exception* JSC__Exception__create(JSC__JSGlobalObject* arg0, JSC__JSObject* arg1,
    unsigned char StackCaptureAction2)
{
    return JSC::Exception::create(arg0->vm(), JSC::JSValue(arg1),
        StackCaptureAction2 == 0
            ? JSC::Exception::StackCaptureAction::CaptureStack
            : JSC::Exception::StackCaptureAction::DoNotCaptureStack);
}
JSC__JSValue JSC__Exception__value(JSC__Exception* arg0)
{
    return JSC::JSValue::encode(arg0->value());
}

//     #pragma mark - JSC::PropertyNameArray

// CPP_DECL size_t JSC__PropertyNameArray__length(JSC__PropertyNameArray* arg0);
// CPP_DECL const JSC__PropertyName*
// JSC__PropertyNameArray__next(JSC__PropertyNameArray* arg0, size_t arg1);
// CPP_DECL void JSC__PropertyNameArray__release(JSC__PropertyNameArray* arg0);
size_t JSC__JSObject__getArrayLength(JSC__JSObject* arg0) { return arg0->getArrayLength(); }
JSC__JSValue JSC__JSObject__getIndex(JSC__JSValue jsValue, JSC__JSGlobalObject* arg1,
    uint32_t arg3)
{
    return JSC::JSValue::encode(JSC::JSValue::decode(jsValue).toObject(arg1)->getIndex(arg1, arg3));
}
JSC__JSValue JSC__JSObject__getDirect(JSC__JSObject* arg0, JSC__JSGlobalObject* arg1,
    const ZigString* arg2)
{
    return JSC::JSValue::encode(arg0->getDirect(arg1->vm(), Zig::toIdentifier(*arg2, arg1)));
}
void JSC__JSObject__putDirect(JSC__JSObject* arg0, JSC__JSGlobalObject* arg1, const ZigString* key,
    JSC__JSValue value)
{
    auto prop = Zig::toIdentifier(*key, arg1);

    arg0->putDirect(arg1->vm(), prop, JSC::JSValue::decode(value));
}

#pragma mark - JSC::JSCell

JSC__JSObject* JSC__JSCell__getObject(JSC__JSCell* arg0)
{
    return arg0->getObject();
}
unsigned char JSC__JSCell__getType(JSC__JSCell* arg0) { return arg0->type(); }

#pragma mark - JSC::JSString

void JSC__JSString__toZigString(JSC__JSString* arg0, JSC__JSGlobalObject* arg1, ZigString* arg2)
{
    *arg2 = Zig::toZigString(arg0->value(arg1));
}

bool JSC__JSString__eql(const JSC__JSString* arg0, JSC__JSGlobalObject* obj, JSC__JSString* arg2)
{
    return arg0->equal(obj, arg2);
}
bool JSC__JSString__is8Bit(const JSC__JSString* arg0) { return arg0->is8Bit(); };
size_t JSC__JSString__length(const JSC__JSString* arg0) { return arg0->length(); }
JSC__JSObject* JSC__JSString__toObject(JSC__JSString* arg0, JSC__JSGlobalObject* arg1)
{
    return arg0->toObject(arg1);
}

#pragma mark - JSC::JSModuleLoader

// JSC__JSValue
// JSC__JSModuleLoader__dependencyKeysIfEvaluated(JSC__JSModuleLoader* arg0,
// JSC__JSGlobalObject* arg1, JSC__JSModuleRecord* arg2) {
//     arg2->depen
// }

class JSMicrotaskCallbackDefaultGlobal final : public RefCounted<JSMicrotaskCallbackDefaultGlobal> {
public:
    static Ref<JSMicrotaskCallbackDefaultGlobal> create(Ref<JSC::Microtask>&& task)
    {
        return adoptRef(*new JSMicrotaskCallbackDefaultGlobal(WTFMove(task).leakRef()));
    }

    void call(JSC::JSGlobalObject* globalObject)
    {

        JSC::VM& vm = globalObject->vm();
        auto task = &m_task.leakRef();
        task->run(globalObject);

        delete this;
    }

private:
    JSMicrotaskCallbackDefaultGlobal(Ref<JSC::Microtask>&& task)
        : m_task { WTFMove(task) }
    {
    }

    Ref<JSC::Microtask> m_task;
};

class JSMicrotaskCallback final : public RefCounted<JSMicrotaskCallback> {
public:
    static Ref<JSMicrotaskCallback> create(JSC::JSGlobalObject& globalObject,
        Ref<JSC::Microtask>&& task)
    {
        return adoptRef(*new JSMicrotaskCallback(globalObject, WTFMove(task).leakRef()));
    }

    void call()
    {
        auto* globalObject = m_globalObject.get();
        if (UNLIKELY(!globalObject)) {
            delete this;
            return;
        }

        JSC::VM& vm = m_globalObject->vm();
        auto task = &m_task.leakRef();
        task->run(globalObject);

        delete this;
    }

private:
    JSMicrotaskCallback(JSC::JSGlobalObject& globalObject, Ref<JSC::Microtask>&& task)
        : m_globalObject { &globalObject }
        , m_task { WTFMove(task) }
    {
    }

    JSC::Weak<JSC::JSGlobalObject> m_globalObject;
    Ref<JSC::Microtask> m_task;
};

void Microtask__run(void* microtask, void* global)
{
    reinterpret_cast<JSMicrotaskCallback*>(microtask)->call();
}

void Microtask__run_default(void* microtask, void* global)
{
    reinterpret_cast<JSMicrotaskCallbackDefaultGlobal*>(microtask)->call(reinterpret_cast<Zig::GlobalObject*>(global));
}

JSC__JSValue JSC__JSModuleLoader__evaluate(JSC__JSGlobalObject* globalObject, const unsigned char* arg1,
    size_t arg2, const unsigned char* originUrlPtr, size_t originURLLen, const unsigned char* referrerUrlPtr, size_t referrerUrlLen,
    JSC__JSValue JSValue5, JSC__JSValue* arg6)
{
    WTF::String src = WTF::String::fromUTF8(arg1, arg2).isolatedCopy();
    WTF::URL origin = WTF::URL::fileURLWithFileSystemPath(WTF::String::fromUTF8(originUrlPtr, originURLLen)).isolatedCopy();
    WTF::URL referrer = WTF::URL::fileURLWithFileSystemPath(WTF::String::fromUTF8(referrerUrlPtr, referrerUrlLen)).isolatedCopy();

    JSC::VM& vm = globalObject->vm();

    JSC::SourceCode sourceCode = JSC::makeSource(
        src, JSC::SourceOrigin { origin }, origin.fileSystemPath(),
        WTF::TextPosition(), JSC::SourceProviderSourceType::Module);
    globalObject->moduleLoader()->provideFetch(globalObject, jsString(vm, origin.fileSystemPath()), WTFMove(sourceCode));
    auto* promise = JSC::importModule(globalObject, JSC::Identifier::fromString(vm, origin.fileSystemPath()), JSValue(jsString(vm, referrer.fileSystemPath())), JSValue(), JSValue());

    auto scope = DECLARE_THROW_SCOPE(vm);

    if (scope.exception()) {
        promise->rejectWithCaughtException(globalObject, scope);
    }

    auto status = promise->status(vm);

    if (status == JSC::JSPromise::Status::Fulfilled) {
        return JSC::JSValue::encode(promise->result(vm));
    } else if (status == JSC::JSPromise::Status::Rejected) {
        *arg6 = JSC::JSValue::encode(promise->result(vm));
        return JSC::JSValue::encode(JSC::jsUndefined());
    } else {
        return JSC::JSValue::encode(promise);
    }
}

static JSC::Identifier jsValueToModuleKey(JSC::JSGlobalObject* lexicalGlobalObject,
    JSC::JSValue value)
{
    if (value.isSymbol())
        return JSC::Identifier::fromUid(JSC::jsCast<JSC::Symbol*>(value)->privateName());
    return JSC::asString(value)->toIdentifier(lexicalGlobalObject);
}

static JSC::JSValue doLink(JSC__JSGlobalObject* globalObject, JSC::JSValue moduleKeyValue)
{
    JSC::VM& vm = globalObject->vm();
    JSC::JSLockHolder lock { vm };
    if (!(moduleKeyValue.isString() || moduleKeyValue.isSymbol())) {
        return JSC::jsUndefined();
    }
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::Identifier moduleKey = jsValueToModuleKey(globalObject, moduleKeyValue);
    RETURN_IF_EXCEPTION(scope, {});

    return JSC::linkAndEvaluateModule(globalObject, moduleKey, JSC::JSValue());
}

JSC__JSValue ReadableStream__empty(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto clientData = WebCore::clientData(vm);
    auto* function = globalObject->getDirect(vm, clientData->builtinNames().createEmptyReadableStreamPrivateName()).getObject();
    return JSValue::encode(JSC::call(globalObject, function, JSC::ArgList(), "ReadableStream.create"_s));
}

JSC__JSValue JSC__JSValue__createRangeError(const ZigString* message, const ZigString* arg1,
    JSC__JSGlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();
    ZigString code = *arg1;
    JSC::JSObject* rangeError = Zig::getErrorInstance(message, globalObject).asCell()->getObject();
    static const char* range_error_name = "RangeError";

    rangeError->putDirect(
        vm, vm.propertyNames->name,
        JSC::JSValue(JSC::jsOwnedString(
            vm, WTF::String(WTF::StringImpl::createWithoutCopying(range_error_name, 10)))),
        0);

    if (code.len > 0) {
        auto clientData = WebCore::clientData(vm);
        JSC::JSValue codeValue = Zig::toJSStringValue(code, globalObject);
        rangeError->putDirect(vm, clientData->builtinNames().codePublicName(), codeValue,
            JSC::PropertyAttribute::ReadOnly | 0);
    }

    return JSC::JSValue::encode(rangeError);
}
JSC__JSValue JSC__JSValue__createTypeError(const ZigString* message, const ZigString* arg1,
    JSC__JSGlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();
    ZigString code = *arg1;
    JSC::JSObject* typeError = Zig::getErrorInstance(message, globalObject).asCell()->getObject();
    static const char* range_error_name = "TypeError";

    typeError->putDirect(
        vm, vm.propertyNames->name,
        JSC::JSValue(JSC::jsOwnedString(
            vm, WTF::String(WTF::StringImpl::createWithoutCopying(range_error_name, 9)))),
        0);

    if (code.len > 0) {
        auto clientData = WebCore::clientData(vm);
        JSC::JSValue codeValue = Zig::toJSStringValue(code, globalObject);
        typeError->putDirect(vm, clientData->builtinNames().codePublicName(), codeValue, 0);
    }

    return JSC::JSValue::encode(typeError);
}

JSC__JSValue JSC__JSValue__fromEntries(JSC__JSGlobalObject* globalObject, ZigString* keys,
    ZigString* values, size_t initialCapacity, bool clone)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (initialCapacity == 0) {
        return JSC::JSValue::encode(JSC::constructEmptyObject(globalObject));
    }

    JSC::JSObject* object = nullptr;
    {
        JSC::ObjectInitializationScope initializationScope(vm);
        object = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), initialCapacity);

        if (!clone) {
            for (size_t i = 0; i < initialCapacity; ++i) {
                object->putDirect(
                    vm, JSC::PropertyName(JSC::Identifier::fromString(vm, Zig::toString(keys[i]))),
                    Zig::toJSStringValueGC(values[i], globalObject), 0);
            }
        } else {
            for (size_t i = 0; i < initialCapacity; ++i) {
                object->putDirect(vm, JSC::PropertyName(Zig::toIdentifier(keys[i], globalObject)),
                    Zig::toJSStringValueGC(values[i], globalObject), 0);
            }
        }
    }

    return JSC::JSValue::encode(object);
}

bool JSC__JSValue__asArrayBuffer_(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1,
    Bun__ArrayBuffer* arg2)
{
    JSC::VM& vm = arg1->vm();

    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (UNLIKELY(!value) || !value.isCell()) {
        return false;
    }

    auto type = value.asCell()->type();

    switch (type) {
    case JSC::JSType::Uint8ArrayType:
    case JSC::JSType::Int8ArrayType:
    case JSC::JSType::DataViewType:
    case JSC::JSType::Uint8ClampedArrayType:
    case JSC::JSType::Int16ArrayType:
    case JSC::JSType::Uint16ArrayType:
    case JSC::JSType::Int32ArrayType:
    case JSC::JSType::Uint32ArrayType:
    case JSC::JSType::Float32ArrayType:
    case JSC::JSType::Float64ArrayType:
    case JSC::JSType::BigInt64ArrayType:
    case JSC::JSType::BigUint64ArrayType: {
        JSC::JSArrayBufferView* typedArray = JSC::jsCast<JSC::JSArrayBufferView*>(value);
        arg2->len = typedArray->length();
        arg2->byte_len = typedArray->byteLength();
        // the offset is already set by vector()
        // https://github.com/oven-sh/bun/issues/561
        arg2->offset = 0;
        arg2->cell_type = type;
        arg2->ptr = (char*)typedArray->vectorWithoutPACValidation();
        arg2->_value = JSValue::encode(value);
        return true;
    }
    case JSC::JSType::ArrayBufferType: {
        JSC::ArrayBuffer* typedArray = JSC::jsCast<JSC::JSArrayBuffer*>(value)->impl();
        arg2->len = typedArray->byteLength();
        arg2->byte_len = typedArray->byteLength();
        arg2->offset = 0;
        arg2->cell_type = JSC::JSType::ArrayBufferType;
        arg2->ptr = (char*)typedArray->data();
        arg2->shared = typedArray->isShared();
        arg2->_value = JSValue::encode(value);
        return true;
    }
    case JSC::JSType::ObjectType:
    case JSC::JSType::FinalObjectType: {
        if (JSC::JSArrayBufferView* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(value)) {
            arg2->len = view->length();
            arg2->byte_len = view->byteLength();
            arg2->offset = 0;
            arg2->cell_type = view->type();
            arg2->ptr = (char*)view->vectorWithoutPACValidation();
            arg2->_value = JSValue::encode(value);
            return true;
        }

        if (JSC::JSArrayBuffer* jsBuffer = JSC::jsDynamicCast<JSC::JSArrayBuffer*>(value)) {
            JSC::ArrayBuffer* buffer = jsBuffer->impl();
            if (!buffer)
                return false;
            arg2->len = buffer->byteLength();
            arg2->byte_len = buffer->byteLength();
            arg2->offset = 0;
            arg2->cell_type = JSC::JSType::ArrayBufferType;
            arg2->ptr = (char*)buffer->data();
            arg2->_value = JSValue::encode(value);
            return true;
        }
        break;
    }
    }

    return false;
}

CPP_DECL JSC__JSValue JSC__JSValue__createEmptyArray(JSC__JSGlobalObject* arg0, size_t length)
{
    JSC::VM& vm = arg0->vm();
    return JSC::JSValue::encode(JSC::constructEmptyArray(arg0, nullptr, length));
}
CPP_DECL void JSC__JSValue__putIndex(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, uint32_t arg2, JSC__JSValue JSValue3)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    JSC::JSValue value2 = JSC::JSValue::decode(JSValue3);
    JSC::JSArray* array = JSC::jsCast<JSC::JSArray*>(value);
    array->putDirectIndex(arg1, arg2, value2);
}

JSC__JSValue JSC__JSValue__createStringArray(JSC__JSGlobalObject* globalObject, const ZigString* arg1,
    size_t arg2, bool clone)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (arg2 == 0) {
        return JSC::JSValue::encode(JSC::constructEmptyArray(globalObject, nullptr));
    }

    JSC::JSArray* array = nullptr;
    {
        JSC::ObjectInitializationScope initializationScope(vm);
        if ((array = JSC::JSArray::tryCreateUninitializedRestricted(
                 initializationScope, nullptr,
                 globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
                 arg2))) {

            if (!clone) {
                for (size_t i = 0; i < arg2; ++i) {
                    array->putDirectIndex(globalObject, i, JSC::jsString(vm, Zig::toString(arg1[i])));
                }
            } else {
                for (size_t i = 0; i < arg2; ++i) {
                    array->putDirectIndex(globalObject, i, JSC::jsString(vm, Zig::toStringCopy(arg1[i])));
                }
            }
        }
    }
    if (!array) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return JSC::JSValue::encode(JSC::JSValue());
    }

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::JSValue(array)));
}

JSC__JSValue JSC__JSGlobalObject__createAggregateError(JSC__JSGlobalObject* globalObject,
    void** errors, uint16_t errors_count,
    const ZigString* arg3)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue message = JSC::JSValue(JSC::jsOwnedString(vm, Zig::toString(*arg3)));
    JSC::JSValue options = JSC::jsUndefined();
    JSC::JSArray* array = nullptr;
    {
        JSC::ObjectInitializationScope initializationScope(vm);
        if ((array = JSC::JSArray::tryCreateUninitializedRestricted(
                 initializationScope, nullptr,
                 globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous),
                 errors_count))) {

            for (uint16_t i = 0; i < errors_count; ++i) {
                array->initializeIndexWithoutBarrier(
                    initializationScope, i, JSC::JSValue(reinterpret_cast<JSC::JSCell*>(errors[i])));
            }
        }
    }
    if (!array) {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return JSC::JSValue::encode(JSC::JSValue());
    }

    JSC::Structure* errorStructure = globalObject->errorStructure(JSC::ErrorType::AggregateError);

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::createAggregateError(globalObject, vm, errorStructure, array, message, options, nullptr, JSC::TypeNothing, false)));
}
// static JSC::JSNativeStdFunction* resolverFunction;
// static JSC::JSNativeStdFunction* rejecterFunction;
// static bool resolverFunctionInitialized = false;

JSC__JSValue ZigString__toValue(const ZigString* arg0, JSC__JSGlobalObject* arg1)
{
    return JSC::JSValue::encode(JSC::JSValue(JSC::jsOwnedString(arg1->vm(), Zig::toString(*arg0))));
}

JSC__JSValue ZigString__toAtomicValue(const ZigString* arg0, JSC__JSGlobalObject* arg1)
{
    if (arg0->len == 0) {
        return JSC::JSValue::encode(JSC::jsEmptyString(arg1->vm()));
    }

    if (isTaggedUTF16Ptr(arg0->ptr)) {
        if (auto impl = WTF::AtomStringImpl::lookUp(reinterpret_cast<const UChar*>(untag(arg0->ptr)), arg0->len)) {
            return JSC::JSValue::encode(JSC::jsString(arg1->vm(), WTF::String(WTFMove(impl))));
        }
    } else {
        if (auto impl = WTF::AtomStringImpl::lookUp(untag(arg0->ptr), arg0->len)) {
            return JSC::JSValue::encode(JSC::jsString(arg1->vm(), WTF::String(WTFMove(impl))));
        }
    }

    return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(arg1->vm(), makeAtomString(Zig::toStringCopy(*arg0)))));
}

JSC__JSValue ZigString__to16BitValue(const ZigString* arg0, JSC__JSGlobalObject* arg1)
{
    auto str = WTF::String::fromUTF8(arg0->ptr, arg0->len);
    return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(arg1->vm(), str)));
}

JSC__JSValue ZigString__toExternalU16(const uint16_t* arg0, size_t len, JSC__JSGlobalObject* global)
{
    if (len == 0) {
        return JSC::JSValue::encode(JSC::jsEmptyString(global->vm()));
    }

    auto ref = String(ExternalStringImpl::create(reinterpret_cast<const UChar*>(arg0), len, reinterpret_cast<void*>(const_cast<uint16_t*>(arg0)), free_global_string));

    return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(
        global->vm(), WTFMove(ref))));
}
// This must be a globally allocated string
JSC__JSValue ZigString__toExternalValue(const ZigString* arg0, JSC__JSGlobalObject* arg1)
{

    ZigString str = *arg0;
    if (str.len == 0) {
        return JSC::JSValue::encode(JSC::jsEmptyString(arg1->vm()));
    }

    if (Zig::isTaggedUTF16Ptr(str.ptr)) {
        auto ref = String(ExternalStringImpl::create(reinterpret_cast<const UChar*>(Zig::untag(str.ptr)), str.len, Zig::untagVoid(str.ptr), free_global_string));

        return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(
            arg1->vm(), WTFMove(ref))));
    } else {
        auto ref = String(ExternalStringImpl::create(Zig::untag(str.ptr), str.len, Zig::untagVoid(str.ptr), free_global_string));
        return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(
            arg1->vm(),
            WTFMove(ref))));
    }
}

VirtualMachine* JSC__JSGlobalObject__bunVM(JSC__JSGlobalObject* arg0)
{
    return reinterpret_cast<VirtualMachine*>(reinterpret_cast<Zig::GlobalObject*>(arg0)->bunVM());
}

JSC__JSValue ZigString__toValueGC(const ZigString* arg0, JSC__JSGlobalObject* arg1)
{
    return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(arg1->vm(), Zig::toStringCopy(*arg0))));
}

void JSC__JSValue__toZigString(JSC__JSValue JSValue0, ZigString* arg1, JSC__JSGlobalObject* arg2)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);

    // if (!value.isString()) {
    //   arg1->len = 0;
    //   arg1->ptr = nullptr;
    //   return;
    // }

    auto* strValue = value.toStringOrNull(arg2);

    if (UNLIKELY(!strValue)) {
        arg1->len = 0;
        arg1->ptr = nullptr;
        return;
    }

    auto str = strValue->value(arg2);

    if (str.is8Bit()) {
        arg1->ptr = str.characters8();
    } else {
        arg1->ptr = Zig::taggedUTF16Ptr(str.characters16());
    }

    arg1->len = str.length();
}

JSC__JSValue ZigString__external(const ZigString* arg0, JSC__JSGlobalObject* arg1, void* arg2, void (*ArgFn3)(void* arg0, void* arg1, size_t arg2))
{
    ZigString str
        = *arg0;
    if (Zig::isTaggedUTF16Ptr(str.ptr)) {
        return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(
            arg1->vm(),
            WTF::String(ExternalStringImpl::create(reinterpret_cast<const UChar*>(Zig::untag(str.ptr)), str.len, arg2, ArgFn3)))));
    } else {
        return JSC::JSValue::encode(JSC::JSValue(JSC::jsString(
            arg1->vm(),
            WTF::String(ExternalStringImpl::create(reinterpret_cast<const LChar*>(Zig::untag(str.ptr)), str.len, arg2, ArgFn3)))));
    }
}

JSC__JSValue ZigString__toExternalValueWithCallback(const ZigString* arg0, JSC__JSGlobalObject* arg1, void (*ArgFn2)(void* arg2, void* arg0, size_t arg1))
{

    ZigString str
        = *arg0;
    if (Zig::isTaggedUTF16Ptr(str.ptr)) {
        return JSC::JSValue::encode(JSC::JSValue(JSC::jsOwnedString(
            arg1->vm(),
            WTF::String(ExternalStringImpl::create(reinterpret_cast<const UChar*>(Zig::untag(str.ptr)), str.len, nullptr, ArgFn2)))));
    } else {
        return JSC::JSValue::encode(JSC::JSValue(JSC::jsOwnedString(
            arg1->vm(),
            WTF::String(ExternalStringImpl::create(reinterpret_cast<const LChar*>(Zig::untag(str.ptr)), str.len, nullptr, ArgFn2)))));
    }
}

JSC__JSValue ZigString__toErrorInstance(const ZigString* str, JSC__JSGlobalObject* globalObject)
{
    return JSC::JSValue::encode(Zig::getErrorInstance(str, globalObject));
}

JSC__JSValue ZigString__toTypeErrorInstance(const ZigString* str, JSC__JSGlobalObject* globalObject)
{
    return JSC::JSValue::encode(Zig::getTypeErrorInstance(str, globalObject));
}

JSC__JSValue ZigString__toSyntaxErrorInstance(const ZigString* str, JSC__JSGlobalObject* globalObject)
{
    return JSC::JSValue::encode(Zig::getSyntaxErrorInstance(str, globalObject));
}

JSC__JSValue ZigString__toRangeErrorInstance(const ZigString* str, JSC__JSGlobalObject* globalObject)
{
    return JSC::JSValue::encode(Zig::getRangeErrorInstance(str, globalObject));
}

static JSC::EncodedJSValue resolverFunctionCallback(JSC::JSGlobalObject* globalObject,
    JSC::CallFrame* callFrame)
{
    return JSC::JSValue::encode(doLink(globalObject, callFrame->argument(0)));
}

JSC__JSInternalPromise*
JSC__JSModuleLoader__loadAndEvaluateModule(JSC__JSGlobalObject* globalObject,
    const BunString* arg1)
{
    globalObject->vm().drainMicrotasks();
    auto name = Bun::toWTFString(*arg1);
    name.impl()->ref();

    auto* promise = JSC::loadAndEvaluateModule(globalObject, name, JSC::jsUndefined(), JSC::jsUndefined());
    if (!promise) {
        // usually this is a GC issue
        return jsCast<JSC::JSInternalPromise*>(JSC::JSInternalPromise::rejectedPromise(globalObject, JSC::jsUndefined()));
    }

    JSC::JSNativeStdFunction* resolverFunction = JSC::JSNativeStdFunction::create(
        globalObject->vm(), globalObject, 1, String(), resolverFunctionCallback);
    JSC::JSNativeStdFunction* rejecterFunction = JSC::JSNativeStdFunction::create(
        globalObject->vm(), globalObject, 1, String(),
        [&arg1](JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame) -> JSC::EncodedJSValue {
            return JSC::JSValue::encode(
                JSC::JSInternalPromise::rejectedPromise(globalObject, callFrame->argument(0)));
        });

    globalObject->vm().drainMicrotasks();
    auto result = promise->then(globalObject, resolverFunction, rejecterFunction);
    globalObject->vm().drainMicrotasks();

    // if (promise->status(globalObject->vm()) ==
    // JSC::JSPromise::Status::Fulfilled) {
    //     return reinterpret_cast<JSC::JSInternalPromise*>(
    //         JSC::JSInternalPromise::resolvedPromise(
    //             globalObject,
    //             doLink(globalObject, promise->result(globalObject->vm()))
    //         )
    //     );
    // }

    return result;
}
#pragma mark - JSC::JSPromise

void JSC__JSPromise__reject(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1,
    JSC__JSValue JSValue2)
{
    arg0->reject(arg1, JSC::JSValue::decode(JSValue2));
}
void JSC__JSPromise__rejectAsHandled(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1,
    JSC__JSValue JSValue2)
{
    arg0->rejectAsHandled(arg1, JSC::JSValue::decode(JSValue2));
}
void JSC__JSPromise__rejectAsHandledException(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1,
    JSC__Exception* arg2)
{
    arg0->rejectAsHandled(arg1, arg2);
}
JSC__JSPromise* JSC__JSPromise__rejectedPromise(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1)
{
    return JSC::JSPromise::rejectedPromise(arg0, JSC::JSValue::decode(JSValue1));
}

void JSC__JSPromise__rejectWithCaughtException(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1,
    bJSC__ThrowScope arg2)
{
    Wrap<JSC::ThrowScope, bJSC__ThrowScope> wrapped = Wrap<JSC::ThrowScope, bJSC__ThrowScope>(arg2);

    arg0->rejectWithCaughtException(arg1, *wrapped.cpp);
}
void JSC__JSPromise__resolve(JSC__JSPromise* arg0, JSC__JSGlobalObject* arg1,
    JSC__JSValue JSValue2)
{
    arg0->resolve(arg1, JSC::JSValue::decode(JSValue2));
}

// This implementation closely mimicks the one in JSC::JSPromise::resolve
void JSC__JSPromise__resolveOnNextTick(JSC__JSPromise* promise, JSC__JSGlobalObject* lexicalGlobalObject,
    JSC__JSValue encoedValue)
{
    return JSC__JSPromise__resolve(promise, lexicalGlobalObject, encoedValue);
}

bool JSC__JSValue__isAnyError(JSC__JSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);

    JSC::JSCell* cell = value.asCell();
    JSC::JSType type = cell->type();

    if (type == JSC::CellType) {
        return cell->inherits<JSC::Exception>();
    }

    return type == JSC::ErrorInstanceType;
}

// This implementation closely mimicks the one in JSC::JSPromise::reject
void JSC__JSPromise__rejectOnNextTickWithHandled(JSC__JSPromise* promise, JSC__JSGlobalObject* lexicalGlobalObject,
    JSC__JSValue encoedValue, bool handled)
{
    JSC::JSValue value = JSC::JSValue::decode(encoedValue);
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    uint32_t flags = promise->internalField(JSC::JSPromise::Field::Flags).get().asUInt32();
    if (!(flags & JSC::JSPromise::isFirstResolvingFunctionCalledFlag)) {
        if (handled) {
            flags |= JSC::JSPromise::isHandledFlag;
        }

        promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(flags | JSC::JSPromise::isFirstResolvingFunctionCalledFlag));
        auto* globalObject = jsCast<Zig::GlobalObject*>(promise->globalObject());

        globalObject->queueMicrotask(
            globalObject->performMicrotaskFunction(),
            globalObject->rejectPromiseFunction(),
            promise,
            value,
            JSValue {});
        RETURN_IF_EXCEPTION(scope, void());
    }
}
JSC__JSPromise* JSC__JSPromise__resolvedPromise(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1)
{
    Zig::GlobalObject* global = reinterpret_cast<Zig::GlobalObject*>(arg0);
    JSC::JSPromise* promise = JSC::JSPromise::create(arg0->vm(), arg0->promiseStructure());
    promise->internalField(JSC::JSPromise::Field::Flags).set(arg0->vm(), promise, jsNumber(static_cast<unsigned>(JSC::JSPromise::Status::Fulfilled)));
    promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(arg0->vm(), promise, JSC::JSValue::decode(JSValue1));
    JSC::ensureStillAliveHere(promise);
    JSC::ensureStillAliveHere(JSC::JSValue::decode(JSValue1));
    return promise;
}

JSC__JSValue JSC__JSPromise__result(JSC__JSPromise* promise, JSC__VM* arg1)
{
    auto& vm = *arg1;

    // if the promise is rejected we automatically mark it as handled so it
    // doesn't end up in the promise rejection tracker
    switch (promise->status(vm)) {
    case JSC::JSPromise::Status::Rejected: {
        uint32_t flags = promise->internalField(JSC::JSPromise::Field::Flags).get().asUInt32();
        if (!(flags & JSC::JSPromise::isFirstResolvingFunctionCalledFlag)) {
            promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(flags | JSC::JSPromise::isHandledFlag));
        }
    }
    // fallthrough intended
    case JSC::JSPromise::Status::Fulfilled: {
        return JSValue::encode(promise->result(vm));
    }
    default:
        return JSValue::encode(JSValue {});
    }
}

uint32_t JSC__JSPromise__status(const JSC__JSPromise* arg0, JSC__VM* arg1)
{
    switch (arg0->status(reinterpret_cast<JSC::VM&>(arg1))) {
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
bool JSC__JSPromise__isHandled(const JSC__JSPromise* arg0, JSC__VM* arg1)
{
    return arg0->isHandled(reinterpret_cast<JSC::VM&>(arg1));
}
void JSC__JSPromise__setHandled(JSC__JSPromise* promise, JSC__VM* arg1)
{
    auto& vm = *arg1;
    auto flags = promise->internalField(JSC::JSPromise::Field::Flags).get().asUInt32();
    promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(flags | JSC::JSPromise::isHandledFlag));
}

#pragma mark - JSC::JSInternalPromise

JSC__JSInternalPromise* JSC__JSInternalPromise__create(JSC__JSGlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();
    return JSC::JSInternalPromise::create(vm, globalObject->internalPromiseStructure());
}

void JSC__JSInternalPromise__reject(JSC__JSInternalPromise* arg0, JSC__JSGlobalObject* arg1,
    JSC__JSValue JSValue2)
{
    arg0->reject(arg1, JSC::JSValue::decode(JSValue2));
}
void JSC__JSInternalPromise__rejectAsHandled(JSC__JSInternalPromise* arg0,
    JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2)
{
    arg0->rejectAsHandled(arg1, JSC::JSValue::decode(JSValue2));
}
void JSC__JSInternalPromise__rejectAsHandledException(JSC__JSInternalPromise* arg0,
    JSC__JSGlobalObject* arg1,
    JSC__Exception* arg2)
{
    arg0->rejectAsHandled(arg1, arg2);
}
JSC__JSInternalPromise* JSC__JSInternalPromise__rejectedPromise(JSC__JSGlobalObject* arg0,
    JSC__JSValue JSValue1)
{
    return reinterpret_cast<JSC::JSInternalPromise*>(
        JSC::JSInternalPromise::rejectedPromise(arg0, JSC::JSValue::decode(JSValue1)));
}

void JSC__JSInternalPromise__rejectWithCaughtException(JSC__JSInternalPromise* arg0,
    JSC__JSGlobalObject* arg1,
    bJSC__ThrowScope arg2)
{
    Wrap<JSC::ThrowScope, bJSC__ThrowScope> wrapped = Wrap<JSC::ThrowScope, bJSC__ThrowScope>(arg2);

    arg0->rejectWithCaughtException(arg1, *wrapped.cpp);
}
void JSC__JSInternalPromise__resolve(JSC__JSInternalPromise* arg0, JSC__JSGlobalObject* arg1,
    JSC__JSValue JSValue2)
{
    arg0->resolve(arg1, JSC::JSValue::decode(JSValue2));
}
JSC__JSInternalPromise* JSC__JSInternalPromise__resolvedPromise(JSC__JSGlobalObject* arg0,
    JSC__JSValue JSValue1)
{
    return reinterpret_cast<JSC::JSInternalPromise*>(
        JSC::JSInternalPromise::resolvedPromise(arg0, JSC::JSValue::decode(JSValue1)));
}

JSC__JSValue JSC__JSInternalPromise__result(const JSC__JSInternalPromise* arg0, JSC__VM* arg1)
{
    return JSC::JSValue::encode(arg0->result(reinterpret_cast<JSC::VM&>(arg1)));
}
uint32_t JSC__JSInternalPromise__status(const JSC__JSInternalPromise* arg0, JSC__VM* arg1)
{
    switch (arg0->status(reinterpret_cast<JSC::VM&>(arg1))) {
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
bool JSC__JSInternalPromise__isHandled(const JSC__JSInternalPromise* arg0, JSC__VM* arg1)
{
    return arg0->isHandled(reinterpret_cast<JSC::VM&>(arg1));
}
void JSC__JSInternalPromise__setHandled(JSC__JSInternalPromise* promise, JSC__VM* arg1)
{
    auto& vm = *arg1;
    auto flags = promise->internalField(JSC::JSPromise::Field::Flags).get().asUInt32();
    promise->internalField(JSC::JSPromise::Field::Flags).set(vm, promise, jsNumber(flags | JSC::JSPromise::isHandledFlag));
}

#pragma mark - JSC::JSGlobalObject

JSC__JSValue JSC__JSGlobalObject__generateHeapSnapshot(JSC__JSGlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();

    JSC::JSLockHolder lock(vm);
    // JSC::DeferTermination deferScope(vm);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::HeapSnapshotBuilder snapshotBuilder(vm.ensureHeapProfiler());
    snapshotBuilder.buildSnapshot();

    WTF::String jsonString = snapshotBuilder.json();
    JSC::EncodedJSValue result = JSC::JSValue::encode(JSONParse(globalObject, jsonString));
    scope.releaseAssertNoException();
    return result;
}

JSC__VM* JSC__JSGlobalObject__vm(JSC__JSGlobalObject* arg0) { return &arg0->vm(); };
// JSC__JSObject* JSC__JSGlobalObject__createError(JSC__JSGlobalObject* arg0,
// unsigned char ErrorType1, WTF__String* arg2) {}; JSC__JSObject*
// JSC__JSGlobalObject__throwError(JSC__JSGlobalObject* arg0, JSC__JSObject*
// arg1) {};

void JSC__JSGlobalObject__handleRejectedPromises(JSC__JSGlobalObject* arg0)
{
    return static_cast<Zig::GlobalObject*>(arg0)->handleRejectedPromises();
}

#pragma mark - JSC::JSValue

JSC__JSCell* JSC__JSValue__asCell(JSC__JSValue JSValue0)
{
    auto value = JSC::JSValue::decode(JSValue0);
    return value.asCell();
}
double JSC__JSValue__asNumber(JSC__JSValue JSValue0)
{
    auto value = JSC::JSValue::decode(JSValue0);
    return value.asNumber();
};
bJSC__JSObject JSC__JSValue__asObject(JSC__JSValue JSValue0)
{
    auto value = JSC::JSValue::decode(JSValue0);
    auto obj = JSC::asObject(value);
    return cast<bJSC__JSObject>(&obj);
};
JSC__JSString* JSC__JSValue__asString(JSC__JSValue JSValue0)
{
    auto value = JSC::JSValue::decode(JSValue0);
    return JSC::asString(value);
};
// uint64_t JSC__JSValue__encode(JSC__JSValue JSValue0) {

// }
bool JSC__JSValue__eqlCell(JSC__JSValue JSValue0, JSC__JSCell* arg1)
{
    return JSC::JSValue::decode(JSValue0) == arg1;
};
bool JSC__JSValue__eqlValue(JSC__JSValue JSValue0, JSC__JSValue JSValue1)
{
    return JSC::JSValue::decode(JSValue0) == JSC::JSValue::decode(JSValue1);
};
JSC__JSValue JSC__JSValue__getPrototype(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    auto value = JSC::JSValue::decode(JSValue0);
    return JSC::JSValue::encode(value.getPrototype(arg1));
}
bool JSC__JSValue__isException(JSC__JSValue JSValue0, JSC__VM* arg1)
{
    return JSC::jsDynamicCast<JSC::Exception*>(JSC::JSValue::decode(JSValue0)) != nullptr;
}
bool JSC__JSValue__isAnyInt(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isAnyInt();
}
bool JSC__JSValue__isBigInt(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isBigInt();
}
bool JSC__JSValue__isBigInt32(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isBigInt32();
}
bool JSC__JSValue__isBoolean(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isBoolean();
}

void JSC__JSValue__put(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, const ZigString* arg2, JSC__JSValue JSValue3)
{
    JSC::JSObject* object = JSC::JSValue::decode(JSValue0).asCell()->getObject();
    object->putDirect(arg1->vm(), Zig::toIdentifier(*arg2, arg1), JSC::JSValue::decode(JSValue3));
}

bool JSC__JSValue__isClass(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return value.isConstructor();
}
bool JSC__JSValue__isCell(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isCell(); }
bool JSC__JSValue__isCustomGetterSetter(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isCustomGetterSetter();
}
bool JSC__JSValue__isError(JSC__JSValue JSValue0)
{
    JSC::JSObject* obj = JSC::JSValue::decode(JSValue0).getObject();
    return obj != nullptr && obj->isErrorInstance();
}

bool JSC__JSValue__isAggregateError(JSC__JSValue JSValue0, JSC__JSGlobalObject* global)
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

bool JSC__JSValue__isIterable(JSC__JSValue JSValue, JSC__JSGlobalObject* global)
{
    return JSC::hasIteratorMethod(global, JSC::JSValue::decode(JSValue));
}

void JSC__JSValue__forEach(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, void* ctx, void (*ArgFn3)(JSC__VM* arg0, JSC__JSGlobalObject* arg1, void* arg2, JSC__JSValue JSValue3))
{

    JSC::forEachInIterable(
        arg1, JSC::JSValue::decode(JSValue0),
        [ArgFn3, ctx](JSC::VM& vm, JSC::JSGlobalObject* global, JSC::JSValue value) -> void {
            ArgFn3(&vm, global, ctx, JSC::JSValue::encode(value));
        });
}

bool JSC__JSValue__isCallable(JSC__JSValue JSValue0, JSC__VM* arg1)
{
    return JSC::JSValue::decode(JSValue0).isCallable();
}
bool JSC__JSValue__isGetterSetter(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isGetterSetter();
}
bool JSC__JSValue__isHeapBigInt(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isHeapBigInt();
}
bool JSC__JSValue__isInt32(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isInt32();
}
bool JSC__JSValue__isInt32AsAnyInt(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isInt32AsAnyInt();
}
bool JSC__JSValue__isNull(JSC__JSValue JSValue0) { return JSC::JSValue::decode(JSValue0).isNull(); }
bool JSC__JSValue__isNumber(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isNumber();
}
bool JSC__JSValue__isObject(JSC__JSValue JSValue0)
{
    return JSValue0 != 0 && JSC::JSValue::decode(JSValue0).isObject();
}
bool JSC__JSValue__isPrimitive(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isPrimitive();
}
bool JSC__JSValue__isSymbol(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isSymbol();
}
bool JSC__JSValue__isUInt32AsAnyInt(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isUInt32AsAnyInt();
}
bool JSC__JSValue__isUndefined(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isUndefined();
}
bool JSC__JSValue__isUndefinedOrNull(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).isUndefinedOrNull();
}
JSC__JSValue JSC__JSValue__jsBoolean(bool arg0)
{
    return JSC::JSValue::encode(JSC::jsBoolean(arg0));
};
JSC__JSValue JSC__JSValue__jsDoubleNumber(double arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
}
JSC__JSValue JSC__JSValue__jsNull() { return JSC::JSValue::encode(JSC::jsNull()); };
JSC__JSValue JSC__JSValue__jsNumberFromChar(unsigned char arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsNumberFromDouble(double arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsNumberFromInt32(int32_t arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsNumberFromInt64(int64_t arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsNumberFromU16(uint16_t arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
};
JSC__JSValue JSC__JSValue__jsNumberFromUint64(uint64_t arg0)
{
    return JSC::JSValue::encode(JSC::jsNumber(arg0));
};

int64_t JSC__JSValue__toInt64(JSC__JSValue val)
{
    JSC::JSValue _val = JSC::JSValue::decode(val);

    int64_t result = JSC::tryConvertToInt52(_val.asDouble());
    if (result != JSC::JSValue::notInt52) {
        return result;
    }

    if (_val.isHeapBigInt()) {

        if (auto* heapBigInt = _val.asHeapBigInt()) {
            return heapBigInt->toBigInt64(heapBigInt);
        }
    }
    return _val.asAnyInt();
}

uint8_t JSC__JSValue__asBigIntCompare(JSC__JSValue JSValue0, JSC__JSGlobalObject* globalObject, JSC__JSValue JSValue1)
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

JSC__JSValue JSC__JSValue__fromInt64NoTruncate(JSC__JSGlobalObject* globalObject, int64_t val)
{
    return JSC::JSValue::encode(JSC::JSValue(JSC::JSBigInt::createFrom(globalObject, val)));
}

JSC__JSValue JSC__JSValue__fromUInt64NoTruncate(JSC__JSGlobalObject* globalObject, uint64_t val)
{
    return JSC::JSValue::encode(JSC::JSValue(JSC::JSBigInt::createFrom(globalObject, val)));
}

uint64_t JSC__JSValue__toUInt64NoTruncate(JSC__JSValue val)
{
    JSC::JSValue _val = JSC::JSValue::decode(val);

    int64_t result = JSC::tryConvertToInt52(_val.asDouble());
    if (result != JSC::JSValue::notInt52) {
        if (result < 0)
            return 0;

        return static_cast<uint64_t>(result);
    }

    if (_val.isHeapBigInt()) {

        if (auto* heapBigInt = _val.asHeapBigInt()) {
            return heapBigInt->toBigUInt64(heapBigInt);
        }
    }

    if (!_val.isNumber()) {
        return 0;
    }

    return static_cast<uint64_t>(_val.asAnyInt());
}

JSC__JSValue JSC__JSValue__createObject2(JSC__JSGlobalObject* globalObject, const ZigString* arg1,
    const ZigString* arg2, JSC__JSValue JSValue3,
    JSC__JSValue JSValue4)
{
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
    object->methodTable()
        ->defineOwnProperty(object, globalObject, key1, descriptor1, true);

    return JSC::JSValue::encode(object);
}

JSC__JSValue JSC__JSValue__getIfPropertyExistsImpl(JSC__JSValue JSValue0,
    JSC__JSGlobalObject* globalObject,
    const unsigned char* arg1, uint32_t arg2)
{

    JSC::VM& vm = globalObject->vm();
    JSC::JSObject* object = JSC::JSValue::decode(JSValue0).asCell()->getObject();
    auto propertyName = JSC::PropertyName(
        JSC::Identifier::fromString(vm, reinterpret_cast<const LChar*>(arg1), (int)arg2));
    return JSC::JSValue::encode(object->getIfPropertyExists(globalObject, propertyName));
}

JSC__JSValue JSC__JSValue__getIfPropertyExistsFromPath(JSC__JSValue JSValue0, JSC__JSGlobalObject* globalObject, JSC__JSValue arg1)
{
    VM& vm = globalObject->vm();
    ThrowScope scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSValue::decode(JSValue0);
    JSValue path = JSValue::decode(arg1);

    if (path.isString()) {
        String pathString = path.toWTFString(globalObject);
        uint32_t length = pathString.length();

        if (length == 0) {
            JSValue prop = value.toObject(globalObject)->getIfPropertyExists(globalObject, PropertyName(Identifier::EmptyIdentifier));
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
            currProp = currProp.toObject(globalObject)->getIfPropertyExists(globalObject, PropertyName(Identifier::EmptyIdentifier));
            RETURN_IF_EXCEPTION(scope, {});
            if (currProp.isEmpty()) {
                return JSValue::encode(currProp);
            }
        }

        while (i < length) {
            UChar ic = pathString.characterAt(i);
            while (ic == '[' || ic == ']' || ic == '.') {
                i += 1;
                if (i == length) {

                    if (ic == '.') {
                        currProp = currProp.toObject(globalObject)->getIfPropertyExists(globalObject, PropertyName(Identifier::EmptyIdentifier));
                        RETURN_IF_EXCEPTION(scope, {});
                        return JSValue::encode(currProp);
                    }

                    // nothing found.
                    if (j == 0) {
                        return JSValue::encode({});
                    }

                    return JSValue::encode(currProp);
                }

                UChar previous = ic;
                ic = pathString.characterAt(i);
                if (previous == '.' && ic == '.') {
                    currProp = currProp.toObject(globalObject)->getIfPropertyExists(globalObject, PropertyName(Identifier::EmptyIdentifier));
                    RETURN_IF_EXCEPTION(scope, {});
                    if (currProp.isEmpty()) {
                        return JSValue::encode(currProp);
                    }
                    continue;
                }
            }

            j = i;
            UChar jc = pathString.characterAt(j);
            while (!(jc == '[' || jc == ']' || jc == '.')) {
                j += 1;
                if (j == length) {
                    // break and search for property
                    break;
                }
                jc = pathString.characterAt(j);
            }

            PropertyName propName = PropertyName(Identifier::fromString(vm, pathString.substring(i, j - i)));
            currProp = currProp.toObject(globalObject)->getIfPropertyExists(globalObject, propName);
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
        forEachInArrayLike(globalObject, path.toObject(globalObject), [&](JSValue item) -> bool {
            if (!(item.isString() || item.isNumber())) {
                currProp = {};
                return false;
            }

            JSString* propNameString = item.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, false);
            PropertyName propName = PropertyName(propNameString->toIdentifier(globalObject));
            RETURN_IF_EXCEPTION(scope, false);

            currProp = currProp.toObject(globalObject)->getIfPropertyExists(globalObject, propName);
            RETURN_IF_EXCEPTION(scope, false);
            if (currProp.isEmpty()) {
                return false;
            }

            return true;
        });

        return JSValue::encode(currProp);
    }

    return JSValue::encode({});
}

void JSC__JSValue__getSymbolDescription(JSC__JSValue symbolValue_, JSC__JSGlobalObject* arg1, ZigString* arg2)

{
    JSC::JSValue symbolValue = JSC::JSValue::decode(symbolValue_);

    if (!symbolValue.isSymbol())
        return;

    JSC::Symbol* symbol = JSC::asSymbol(symbolValue);
    JSC::VM& vm = arg1->vm();
    WTF::String string = symbol->description();

    *arg2 = Zig::toZigString(string);
}

JSC__JSValue JSC__JSValue__symbolFor(JSC__JSGlobalObject* globalObject, ZigString* arg2)
{

    JSC::VM& vm = globalObject->vm();
    WTF::String string = Zig::toString(*arg2);
    return JSC::JSValue::encode(JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey(string)));
}

bool JSC__JSValue__symbolKeyFor(JSC__JSValue symbolValue_, JSC__JSGlobalObject* arg1, ZigString* arg2)
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

bool JSC__JSValue__toBoolean(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).asBoolean();
}
int32_t JSC__JSValue__toInt32(JSC__JSValue JSValue0)
{
    return JSC::JSValue::decode(JSValue0).asInt32();
}

CPP_DECL double JSC__JSValue__coerceToDouble(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    auto catchScope = DECLARE_CATCH_SCOPE(arg1->vm());
    double result = value.toNumber(arg1);
    if (catchScope.exception()) {
        result = PNaN;
        catchScope.clearException();
    }

    return result;
}

// truncates values larger than int32
int32_t JSC__JSValue__coerceToInt32(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (value.isCell() && value.isHeapBigInt()) {
        return static_cast<int32_t>(value.toBigInt64(arg1));
    }
    return value.toInt32(arg1);
}

int64_t JSC__JSValue__coerceToInt64(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSValue value = JSValue::decode(JSValue0);
    if (value.isCell() && value.isHeapBigInt()) {
        return value.toBigInt64(arg1);
    }

    int64_t result = tryConvertToInt52(value.asDouble());
    if (result != JSValue::notInt52) {
        return result;
    }

    return value.toInt32(arg1);
}

JSC__JSValue JSC__JSValue__getErrorsProperty(JSC__JSValue JSValue0, JSC__JSGlobalObject* global)
{
    JSC::JSObject* obj = JSC::JSValue::decode(JSValue0).getObject();
    return JSC::JSValue::encode(obj->getDirect(global->vm(), global->vm().propertyNames->errors));
}

JSC__JSValue JSC__JSValue__jsTDZValue() { return JSC::JSValue::encode(JSC::jsTDZValue()); };
JSC__JSValue JSC__JSValue__jsUndefined() { return JSC::JSValue::encode(JSC::jsUndefined()); };
JSC__JSObject* JSC__JSValue__toObject(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return value.toObject(arg1);
}

JSC__JSString* JSC__JSValue__toString(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return value.toString(arg1);
};
JSC__JSString* JSC__JSValue__toStringOrNull(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    return value.toStringOrNull(arg1);
}

bool JSC__JSValue__toMatch(JSC__JSValue regexValue, JSC__JSGlobalObject* global, JSC__JSValue value)
{
    JSC::JSValue regex = JSC::JSValue::decode(regexValue);
    JSC::JSValue str = JSC::JSValue::decode(value);
    if (regex.asCell()->type() != RegExpObjectType || !str.isString()) {
        return false;
    }
    JSC::RegExpObject* regexObject = jsDynamicCast<JSC::RegExpObject*>(regex);

    return !!regexObject->match(global, JSC::asString(str));
}

bool JSC__JSValue__stringIncludes(JSC__JSValue value, JSC__JSGlobalObject* globalObject, JSC__JSValue other)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_CATCH_SCOPE(vm);

    WTF::String stringToSearchIn = JSC::JSValue::decode(value).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, false);

    WTF::String searchString = JSC::JSValue::decode(other).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, false);

    return stringToSearchIn.find(searchString, 0) != WTF::notFound;
}

static void populateStackFrameMetadata(JSC::VM& vm, const JSC::StackFrame* stackFrame, ZigStackFrame* frame)
{
    String str = stackFrame->sourceURL(vm);
    if (!str.isEmpty())
        str.impl()->ref();

    frame->source_url = Bun::toString(str);

    if (stackFrame->isWasmFrame()) {
        frame->code_type = ZigStackFrameCodeWasm;
        return;
    }

    auto m_codeBlock = stackFrame->codeBlock();
    if (m_codeBlock) {
        switch (m_codeBlock->codeType()) {
        case JSC::EvalCode: {
            frame->code_type = ZigStackFrameCodeEval;
            return;
        }
        case JSC::ModuleCode: {
            frame->code_type = ZigStackFrameCodeModule;
            return;
        }
        case JSC::GlobalCode: {
            frame->code_type = ZigStackFrameCodeGlobal;
            return;
        }
        case JSC::FunctionCode: {
            frame->code_type = !m_codeBlock->isConstructor() ? ZigStackFrameCodeFunction : ZigStackFrameCodeConstructor;
            break;
        }
        default:
            ASSERT_NOT_REACHED();
        }
    }

    auto calleeCell = stackFrame->callee();
    if (!calleeCell || !calleeCell->isObject())
        return;

    JSC::JSObject* callee = JSC::jsCast<JSC::JSObject*>(calleeCell);

    String displayName = JSC::getCalculatedDisplayName(vm, callee);
    if (!displayName.isEmpty())
        displayName.impl()->ref();
    frame->function_name = Bun::toString(displayName);
}
// Based on
// https://github.com/mceSystems/node-jsc/blob/master/deps/jscshim/src/shim/JSCStackTrace.cpp#L298
static void populateStackFramePosition(const JSC::StackFrame* stackFrame, BunString* source_lines,
    int32_t* source_line_numbers, uint8_t source_lines_count,
    ZigStackFramePosition* position)
{
    auto m_codeBlock = stackFrame->codeBlock();
    if (!m_codeBlock)
        return;

    JSC::BytecodeIndex bytecodeOffset = stackFrame->hasBytecodeIndex() ? stackFrame->bytecodeIndex() : JSC::BytecodeIndex();

    /* Get the "raw" position info.
     * Note that we're using m_codeBlock->unlinkedCodeBlock()->expressionRangeForBytecodeOffset
     * rather than m_codeBlock->expressionRangeForBytecodeOffset in order get the "raw" offsets and
     * avoid the CodeBlock's expressionRangeForBytecodeOffset modifications to the line and column
     * numbers, (we don't need the column number from it, and we'll calculate the line "fixes"
     * ourselves). */
    int startOffset = 0;
    int endOffset = 0;
    int divotPoint = 0;
    unsigned line = 0;
    unsigned unusedColumn = 0;
    m_codeBlock->unlinkedCodeBlock()->expressionRangeForBytecodeIndex(
        bytecodeOffset, divotPoint, startOffset, endOffset, line, unusedColumn);
    divotPoint += m_codeBlock->sourceOffset();

    // TODO: evaluate if using the API from UnlinkedCodeBlock can be used instead of iterating
    // through source text.

    /* On the first line of the source code, it seems that we need to "fix" the column with the
     * starting offset. We currently use codeBlock->source()->startPosition().m_column.oneBasedInt()
     * as the offset in the first line rather than codeBlock->firstLineColumnOffset(), which seems
     * simpler (and what CodeBlock::expressionRangeForBytecodeOffset does). This is because
     * firstLineColumnOffset values seems different from what we expect (according to v8's tests)
     * and I haven't dove into the relevant parts in JSC (yet) to figure out why. */
    unsigned columnOffset = line ? 0 : m_codeBlock->source().startColumn().zeroBasedInt();

    // "Fix" the line number
    JSC::ScriptExecutable* executable = m_codeBlock->ownerExecutable();
    if (std::optional<int> overrideLine = executable->overrideLineNumber(m_codeBlock->vm())) {
        line = overrideLine.value();
    } else {
        line += executable->firstLine();
    }

    // Calculate the staring\ending offsets of the entire expression
    int expressionStart = divotPoint - startOffset;
    int expressionStop = divotPoint + endOffset;

    // Make sure the range is valid
    WTF::StringView sourceString = m_codeBlock->source().provider()->source();
    if (expressionStop < 1 || expressionStart > static_cast<int>(sourceString.length())) {
        return;
    }

    // Search for the beginning of the line
    unsigned int lineStart = expressionStart;
    while ((lineStart > 0) && ('\n' != sourceString[lineStart - 1])) {
        lineStart--;
    }
    // Search for the end of the line
    unsigned int lineStop = expressionStop;
    unsigned int sourceLength = sourceString.length();
    while ((lineStop < sourceLength) && ('\n' != sourceString[lineStop])) {
        lineStop++;
    }
    if (source_lines_count > 1 && source_lines != nullptr) {
        auto chars = sourceString.characters8();

        // Most of the time, when you look at a stack trace, you want a couple lines above

        source_lines[0] = Bun::toString(sourceString.substring(lineStart, lineStop - lineStart).toStringWithoutCopying());
        source_line_numbers[0] = line;

        if (lineStart > 0) {
            auto byte_offset_in_source_string = lineStart - 1;
            uint8_t source_line_i = 1;
            auto remaining_lines_to_grab = source_lines_count - 1;

            while (byte_offset_in_source_string > 0 && remaining_lines_to_grab > 0) {
                unsigned int end_of_line_offset = byte_offset_in_source_string;

                // This should probably be code points instead of newlines
                while (byte_offset_in_source_string > 0 && chars[byte_offset_in_source_string] != '\n') {
                    byte_offset_in_source_string--;
                }

                // We are at the beginning of the line
                source_lines[source_line_i] = Bun::toString(sourceString.substring(byte_offset_in_source_string, end_of_line_offset - byte_offset_in_source_string + 1).toStringWithoutCopying());

                source_line_numbers[source_line_i] = line - source_line_i;
                source_line_i++;

                remaining_lines_to_grab--;

                byte_offset_in_source_string -= byte_offset_in_source_string > 0;
            }
        }
    }

    /* Finally, store the source "positions" info.
     * Notes:
     * - The retrieved column seem to point the "end column". To make sure we're current, we'll
     *calculate the columns ourselves, since we've already found where the line starts. Note that in
     *v8 it should be 0-based here (in contrast the 1-based column number in v8::StackFrame).
     * - The static_casts are ugly, but comes from differences between JSC and v8's api, and should
     *be OK since no source should be longer than "max int" chars.
     * TODO: If expressionStart == expressionStop, then m_endColumn will be equal to m_startColumn.
     *Should we handle this case?
     */
    position->expression_start = expressionStart;
    position->expression_stop = expressionStop;
    position->line = WTF::OrdinalNumber::fromOneBasedInt(static_cast<int>(line)).zeroBasedInt();
    position->column_start = (expressionStart - lineStart) + columnOffset;
    position->column_stop = position->column_start + (expressionStop - expressionStart);
    position->line_start = lineStart;
    position->line_stop = lineStop;

    return;
}
static void populateStackFrame(JSC::VM& vm, ZigStackTrace* trace, const JSC::StackFrame* stackFrame,
    ZigStackFrame* frame, bool is_top)
{
    populateStackFrameMetadata(vm, stackFrame, frame);
    populateStackFramePosition(stackFrame, is_top ? trace->source_lines_ptr : nullptr,
        is_top ? trace->source_lines_numbers : nullptr,
        is_top ? trace->source_lines_to_collect : 0, &frame->position);
}
static void populateStackTrace(JSC::VM& vm, const WTF::Vector<JSC::StackFrame>& frames, ZigStackTrace* trace)
{
    uint8_t frame_i = 0;
    size_t stack_frame_i = 0;
    const size_t total_frame_count = frames.size();
    const uint8_t frame_count = total_frame_count < trace->frames_len ? total_frame_count : trace->frames_len;

    while (frame_i < frame_count && stack_frame_i < total_frame_count) {
        // Skip native frames
        while (stack_frame_i < total_frame_count && !(&frames.at(stack_frame_i))->codeBlock() && !(&frames.at(stack_frame_i))->isWasmFrame()) {
            stack_frame_i++;
        }
        if (stack_frame_i >= total_frame_count)
            break;

        ZigStackFrame* frame = &trace->frames_ptr[frame_i];
        populateStackFrame(vm, trace, &frames[stack_frame_i], frame, frame_i == 0);
        stack_frame_i++;
        frame_i++;
    }
    trace->frames_len = frame_i;
}

#define SYNTAX_ERROR_CODE 4

static void fromErrorInstance(ZigException* except, JSC::JSGlobalObject* global,
    JSC::ErrorInstance* err, const Vector<JSC::StackFrame>* stackTrace,
    JSC::JSValue val)
{
    JSC::JSObject* obj = JSC::jsDynamicCast<JSC::JSObject*>(val);
    JSC::VM& vm = global->vm();

    bool getFromSourceURL = false;
    if (stackTrace != nullptr && stackTrace->size() > 0) {
        populateStackTrace(vm, *stackTrace, &except->stack);
    } else if (err->stackTrace() != nullptr && err->stackTrace()->size() > 0) {
        populateStackTrace(vm, *err->stackTrace(), &except->stack);
    } else {
        getFromSourceURL = true;
    }
    except->code = (unsigned char)err->errorType();
    if (err->isStackOverflowError()) {
        except->code = 253;
    }
    if (err->isOutOfMemoryError()) {
        except->code = 8;
    }
    if (except->code == SYNTAX_ERROR_CODE) {
        except->message = Bun::toString(err->sanitizedMessageString(global));
    } else if (JSC::JSValue message = obj->getIfPropertyExists(global, vm.propertyNames->message)) {

        except->message = Bun::toString(global, message);

    } else {
        except->message = Bun::toString(err->sanitizedMessageString(global));
    }
    except->name = Bun::toString(err->sanitizedNameString(global));
    except->runtime_type = err->runtimeTypeForCause();

    auto clientData = WebCore::clientData(vm);
    if (except->code != SYNTAX_ERROR_CODE) {

        if (JSC::JSValue syscall = obj->getIfPropertyExists(global, clientData->builtinNames().syscallPublicName())) {
            except->syscall = Bun::toString(global, syscall);
        }

        if (JSC::JSValue code = obj->getIfPropertyExists(global, clientData->builtinNames().codePublicName())) {
            except->code_ = Bun::toString(global, code);
        }

        if (JSC::JSValue path = obj->getIfPropertyExists(global, clientData->builtinNames().pathPublicName())) {
            except->path = Bun::toString(global, path);
        }

        if (JSC::JSValue fd = obj->getIfPropertyExists(global, Identifier::fromString(vm, "fd"_s))) {
            if (fd.isAnyInt()) {
                except->fd = fd.toInt32(global);
            }
        }

        if (JSC::JSValue errno_ = obj->getIfPropertyExists(global, clientData->builtinNames().errnoPublicName())) {
            except->errno_ = errno_.toInt32(global);
        }
    }

    if (getFromSourceURL) {
        if (JSC::JSValue sourceURL = obj->getIfPropertyExists(global, vm.propertyNames->sourceURL)) {
            except->stack.frames_ptr[0].source_url = Bun::toString(global, sourceURL);

            if (JSC::JSValue column = obj->getIfPropertyExists(global, vm.propertyNames->column)) {
                except->stack.frames_ptr[0].position.column_start = column.toInt32(global);
            }

            if (JSC::JSValue line = obj->getIfPropertyExists(global, vm.propertyNames->line)) {
                except->stack.frames_ptr[0].position.line = line.toInt32(global);

                if (JSC::JSValue lineText = obj->getIfPropertyExists(global, JSC::Identifier::fromString(vm, "lineText"_s))) {
                    if (JSC::JSString* jsStr = lineText.toStringOrNull(global)) {
                        auto str = jsStr->value(global);
                        except->stack.source_lines_ptr[0] = Bun::toString(str);
                        except->stack.source_lines_numbers[0] = except->stack.frames_ptr[0].position.line;
                        except->stack.source_lines_len = 1;
                        except->remapped = true;
                    }
                }
            }

            except->stack.frames_len = 1;
            except->stack.frames_ptr[0].remapped = obj->hasProperty(global, JSC::Identifier::fromString(vm, "originalLine"_s));
        }
    }

    except->exception = err;
}

void exceptionFromString(ZigException* except, JSC::JSValue value, JSC::JSGlobalObject* global)
{
    // Fallback case for when it's a user-defined ErrorLike-object that doesn't inherit from
    // ErrorInstance
    if (JSC::JSObject* obj = JSC::jsDynamicCast<JSC::JSObject*>(value)) {
        if (obj->hasProperty(global, global->vm().propertyNames->name)) {
            auto name_str = obj->getIfPropertyExists(global, global->vm().propertyNames->name).toWTFString(global);
            except->name = Bun::toString(name_str);
            if (name_str == "Error"_s) {
                except->code = JSErrorCodeError;
            } else if (name_str == "EvalError"_s) {
                except->code = JSErrorCodeEvalError;
            } else if (name_str == "RangeError"_s) {
                except->code = JSErrorCodeRangeError;
            } else if (name_str == "ReferenceError"_s) {
                except->code = JSErrorCodeReferenceError;
            } else if (name_str == "SyntaxError"_s) {
                except->code = JSErrorCodeSyntaxError;
            } else if (name_str == "TypeError"_s) {
                except->code = JSErrorCodeTypeError;
            } else if (name_str == "URIError"_s) {
                except->code = JSErrorCodeURIError;
            } else if (name_str == "AggregateError"_s) {
                except->code = JSErrorCodeAggregateError;
            }
        }

        if (JSC::JSValue message = obj->getIfPropertyExists(global, global->vm().propertyNames->message)) {
            if (message) {
                except->message = Bun::toString(
                    message.toWTFString(global));
            }
        }

        if (JSC::JSValue sourceURL = obj->getIfPropertyExists(global, global->vm().propertyNames->sourceURL)) {
            if (sourceURL) {
                except->stack.frames_ptr[0].source_url = Bun::toString(
                    sourceURL.toWTFString(global));
                except->stack.frames_len = 1;
            }
        }

        if (JSC::JSValue line = obj->getIfPropertyExists(global, global->vm().propertyNames->line)) {
            if (line) {
                // TODO: don't sourcemap it twice
                if (auto originalLine = obj->getIfPropertyExists(global, JSC::Identifier::fromString(global->vm(), "originalLine"_s))) {
                    except->stack.frames_ptr[0].position.line = originalLine.toInt32(global);
                } else {
                    except->stack.frames_ptr[0].position.line = line.toInt32(global);
                }
                except->stack.frames_len = 1;
            }
        }

        return;
    }
    auto scope = DECLARE_THROW_SCOPE(global->vm());
    auto str = value.toWTFString(global);
    if (scope.exception()) {
        scope.clearException();
        scope.release();
        return;
    }
    scope.release();

    except->message = Bun::toString(str);
}

void JSC__VM__releaseWeakRefs(JSC__VM* arg0)
{
    arg0->finalizeSynchronousJSExecution();
}

static auto function_string_view = MAKE_STATIC_STRING_IMPL("Function");
void JSC__JSValue__getClassName(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, ZigString* arg2)
{
    JSValue value = JSValue::decode(JSValue0);
    JSC::JSCell* cell = value.asCell();
    if (cell == nullptr) {
        arg2->len = 0;
        return;
    }

    const char* ptr = cell->className();
    auto view = WTF::StringView(ptr, strlen(ptr));

    // Fallback to .name if className is empty
    if (view.length() == 0 || StringView(String(function_string_view)) == view) {
        JSC__JSValue__getNameProperty(JSValue0, arg1, arg2);
        return;
    }

    JSObject* obj = value.toObject(arg1);
    StringView calculated = StringView(JSObject::calculatedClassName(obj));
    if (calculated.length() > 0) {
        *arg2 = Zig::toZigString(calculated);
        return;
    }

    *arg2 = Zig::toZigString(view);
}

void JSC__JSValue__getNameProperty(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1, ZigString* arg2)
{
    JSC::JSObject* obj = JSC::JSValue::decode(JSValue0).getObject();
    JSC::VM& vm = arg1->vm();

    if (obj == nullptr) {
        arg2->len = 0;
        return;
    }

    JSC::JSValue name = obj->getIfPropertyExists(arg1, vm.propertyNames->toStringTagSymbol);

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
        auto view = WTF::StringView(function->name());
        *arg2 = Zig::toZigString(view);
        return;
    }

    arg2->len = 0;
}

JSC__JSValue JSC__JSValue__toError_(JSC__JSValue JSValue0)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (value.isEmpty() || !value.isCell())
        return JSC::JSValue::encode({});

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

    return JSC::JSValue::encode({});
}

void JSC__JSValue__toZigException(JSC__JSValue JSValue0, JSC__JSGlobalObject* arg1,
    ZigException* exception)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (value == JSC::JSValue {}) {
        exception->code = JSErrorCodeError;
        exception->name = Bun::toString("Error"_s);
        exception->message = Bun::toString("Unknown error"_s);
        return;
    }

    if (JSC::Exception* jscException = JSC::jsDynamicCast<JSC::Exception*>(value)) {
        if (JSC::ErrorInstance* error = JSC::jsDynamicCast<JSC::ErrorInstance*>(jscException->value())) {
            fromErrorInstance(exception, arg1, error, &jscException->stack(), value);
            return;
        }
    }

    if (JSC::ErrorInstance* error = JSC::jsDynamicCast<JSC::ErrorInstance*>(value)) {
        fromErrorInstance(exception, arg1, error, nullptr, value);
        return;
    }

    exceptionFromString(exception, value, arg1);
}

void JSC__Exception__getStackTrace(JSC__Exception* arg0, ZigStackTrace* trace)
{
    populateStackTrace(arg0->vm(), arg0->stack(), trace);
}

#pragma mark - JSC::VM

JSC__JSValue JSC__VM__runGC(JSC__VM* vm, bool sync)
{
    JSC::JSLockHolder lock(vm);

    vm->finalizeSynchronousJSExecution();
    WTF::releaseFastMallocFreeMemory();

    if (sync) {
        vm->heap.collectNow(JSC::Sync, JSC::CollectionScope::Full);
    } else {
        vm->heap.collectSync(JSC::CollectionScope::Full);
    }

    vm->finalizeSynchronousJSExecution();

    return JSC::JSValue::encode(JSC::jsNumber(vm->heap.sizeAfterLastFullCollection()));
}

bool JSC__VM__isJITEnabled() { return JSC::Options::useJIT(); }

void JSC__VM__clearExecutionTimeLimit(JSC__VM* vm)
{
    JSC::JSLockHolder locker(vm);
    if (vm->watchdog())
        vm->watchdog()->setTimeLimit(JSC::Watchdog::noTimeLimit);
}
void JSC__VM__setExecutionTimeLimit(JSC__VM* vm, double limit)
{
    JSC::JSLockHolder locker(vm);
    JSC::Watchdog& watchdog = vm->ensureWatchdog();
    watchdog.setTimeLimit(WTF::Seconds { limit });
}

bool JSC__JSValue__isTerminationException(JSC__JSValue JSValue0, JSC__VM* arg1)
{
    JSC::Exception* exception = JSC::jsDynamicCast<JSC::Exception*>(JSC::JSValue::decode(JSValue0));
    return exception != NULL && arg1->isTerminationException(exception);
}

void JSC__VM__shrinkFootprint(JSC__VM* arg0) { arg0->shrinkFootprintWhenIdle(); };
void JSC__VM__whenIdle(JSC__VM* arg0, void (*ArgFn1)()) { arg0->whenIdle(ArgFn1); };

JSC__VM* JSC__VM__create(unsigned char HeapType0)
{
}

void JSC__VM__holdAPILock(JSC__VM* arg0, void* ctx, void (*callback)(void* arg0))
{
    JSC::JSLockHolder locker(arg0);
    callback(ctx);
}

void JSC__JSString__iterator(JSC__JSString* arg0, JSC__JSGlobalObject* arg1, void* arg2)
{
    jsstring_iterator* iter = (jsstring_iterator*)arg2;
    arg0->value(iter);
}
void JSC__VM__deferGC(JSC__VM* vm, void* ctx, void (*callback)(void* arg0))
{
    JSC::GCDeferralContext deferralContext(reinterpret_cast<JSC__VM&>(vm));
    JSC::DisallowGC disallowGC;

    callback(ctx);
}

void JSC__VM__deleteAllCode(JSC__VM* arg1, JSC__JSGlobalObject* globalObject)
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

void JSC__VM__doWork(JSC__VM* vm)
{
    vm->deferredWorkTimer->doWork(*vm);
}

void JSC__VM__deinit(JSC__VM* arg1, JSC__JSGlobalObject* globalObject) {}
void JSC__VM__drainMicrotasks(JSC__VM* arg0) { arg0->drainMicrotasks(); }

bool JSC__VM__executionForbidden(JSC__VM* arg0) { return (*arg0).executionForbidden(); }

bool JSC__VM__isEntered(JSC__VM* arg0) { return (*arg0).isEntered(); }

void JSC__VM__setExecutionForbidden(JSC__VM* arg0, bool arg1) { (*arg0).setExecutionForbidden(); }

void JSC__VM__throwError(JSC__VM* vm_, JSC__JSGlobalObject* arg1, JSC__JSValue value)
{
    JSC::VM& vm = *reinterpret_cast<JSC::VM*>(vm_);

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSObject* error = JSC::JSValue::decode(value).getObject();
    JSC::Exception* exception = JSC::Exception::create(vm, error);
    scope.throwException(arg1, exception);
}

JSC__JSValue JSC__JSPromise__rejectedPromiseValue(JSC__JSGlobalObject* arg0,
    JSC__JSValue JSValue1)
{
    Zig::GlobalObject* global = reinterpret_cast<Zig::GlobalObject*>(arg0);
    JSC::JSPromise* promise = JSC::JSPromise::create(arg0->vm(), arg0->promiseStructure());
    promise->internalField(JSC::JSPromise::Field::Flags).set(arg0->vm(), promise, jsNumber(static_cast<unsigned>(JSC::JSPromise::Status::Rejected)));
    promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(arg0->vm(), promise, JSC::JSValue::decode(JSValue1));
    JSC::ensureStillAliveHere(promise);
    JSC::ensureStillAliveHere(JSC::JSValue::decode(JSValue1));
    return JSC::JSValue::encode(promise);
}
JSC__JSValue JSC__JSPromise__resolvedPromiseValue(JSC__JSGlobalObject* arg0,
    JSC__JSValue JSValue1)
{
    Zig::GlobalObject* global = reinterpret_cast<Zig::GlobalObject*>(arg0);
    JSC::JSPromise* promise = JSC::JSPromise::create(arg0->vm(), arg0->promiseStructure());
    promise->internalField(JSC::JSPromise::Field::Flags).set(arg0->vm(), promise, jsNumber(static_cast<unsigned>(JSC::JSPromise::Status::Fulfilled)));
    promise->internalField(JSC::JSPromise::Field::ReactionsOrResult).set(arg0->vm(), promise, JSC::JSValue::decode(JSValue1));
    JSC::ensureStillAliveHere(promise);
    JSC::ensureStillAliveHere(JSC::JSValue::decode(JSValue1));
    return JSC::JSValue::encode(promise);
}
}

JSC__JSValue JSC__JSValue__createUninitializedUint8Array(JSC__JSGlobalObject* arg0, size_t arg1)
{
    JSC::JSValue value = JSC::JSUint8Array::createUninitialized(arg0, arg0->m_typedArrayUint8.get(arg0), arg1);
    return JSC::JSValue::encode(value);
}

enum class BuiltinNamesMap : uint8_t {
    method,
    headers,
    status,
    url,
    body,
    data,
    toString,
    redirect,
};

static JSC::Identifier builtinNameMap(JSC::JSGlobalObject* globalObject, unsigned char name)
{
    auto& vm = globalObject->vm();
    auto clientData = WebCore::clientData(vm);
    switch (static_cast<BuiltinNamesMap>(name)) {
    case BuiltinNamesMap::method: {
        return clientData->builtinNames().methodPublicName();
    }
    case BuiltinNamesMap::headers: {
        return clientData->builtinNames().headersPublicName();
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
    }
}

JSC__JSValue JSC__JSValue__fastGetDirect_(JSC__JSValue JSValue0, JSC__JSGlobalObject* globalObject, unsigned char arg2)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (!value.isCell()) {
        return JSValue::encode({});
    }

    return JSValue::encode(
        value.getObject()->getDirect(globalObject->vm(), PropertyName(builtinNameMap(globalObject, arg2))));
}

JSC__JSValue JSC__JSValue__fastGet_(JSC__JSValue JSValue0, JSC__JSGlobalObject* globalObject, unsigned char arg2)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    if (!value.isCell()) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    return JSValue::encode(
        value.getObject()->getIfPropertyExists(globalObject, builtinNameMap(globalObject, arg2)));
}

bool JSC__JSValue__toBooleanSlow(JSC__JSValue JSValue0, JSC__JSGlobalObject* globalObject)
{
    return JSValue::decode(JSValue0).toBoolean(globalObject);
}

void JSC__JSValue__forEachProperty(JSC__JSValue JSValue0, JSC__JSGlobalObject* globalObject, void* arg2, void (*iter)(JSC__JSGlobalObject* arg0, void* ctx, ZigString* arg2, JSC__JSValue JSValue3, bool isSymbol))
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    JSC::JSObject* object = value.getObject();
    if (!object)
        return;

    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_CATCH_SCOPE(vm);

    size_t prototypeCount = 0;

    JSC::Structure* structure = object->structure();
    bool fast = canPerformFastPropertyEnumerationForIterationBun(structure);
    JSValue prototypeObject = value;

    if (fast) {
        if (structure->outOfLineSize() == 0 && structure->inlineSize() == 0) {
            fast = false;
            if (JSValue proto = object->getPrototype(vm, globalObject)) {
                if ((structure = proto.structureOrNull())) {
                    prototypeObject = proto;
                    fast = canPerformFastPropertyEnumerationForIterationBun(structure);
                    prototypeCount = 1;
                }
            }
        }
    }

    auto* clientData = WebCore::clientData(vm);
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

            if (prop == vm.propertyNames->constructor
                || prop == vm.propertyNames->length
                || prop == vm.propertyNames->underscoreProto
                || prop == vm.propertyNames->toStringTagSymbol)
                return true;

            if (clientData->builtinNames().bunNativePtrPrivateName() == prop)
                return true;

            if (visitedProperties.contains(Identifier::fromUid(vm, prop))) {
                return true;
            }
            visitedProperties.append(Identifier::fromUid(vm, prop));

            ZigString key = toZigString(prop);

            if (key.len == 0)
                return true;

            JSC::JSValue propertyValue = JSValue();

            if (objectToUse == object) {
                propertyValue = objectToUse->getDirect(entry.offset());
                if (!propertyValue) {
                    scope.clearException();
                    return true;
                }
            }

            if (!propertyValue || propertyValue.isGetterSetter() && !((entry.attributes() & PropertyAttribute::Accessor) != 0)) {
                propertyValue = objectToUse->getIfPropertyExists(globalObject, prop);
            }

            if (scope.exception())
                scope.clearException();

            if (!propertyValue)
                return true;

            anyHits = true;
            JSC::EnsureStillAliveScope ensureStillAliveScope(propertyValue);
            iter(globalObject, arg2, &key, JSC::JSValue::encode(propertyValue), prop->isSymbol());
            return true;
        });
        if (scope.exception()) {
            scope.clearException();
        }

        fast = false;

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
            }
            return;
        }
    }

    JSC::PropertyNameArray properties(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);

    {

        JSObject* iterating = prototypeObject.getObject();

        while (iterating && !(iterating == globalObject->objectPrototype() || iterating == globalObject->functionPrototype() || (iterating->inherits<JSGlobalProxy>() && jsCast<JSGlobalProxy*>(iterating)->target() != globalObject)) && prototypeCount++ < 5) {
            iterating->methodTable()->getOwnPropertyNames(iterating, globalObject, properties, DontEnumPropertiesMode::Include);
            RETURN_IF_EXCEPTION(scope, void());
            for (auto& property : properties) {
                if (UNLIKELY(property.isEmpty() || property.isNull()))
                    continue;

                // ignore constructor
                if (property == vm.propertyNames->constructor || clientData->builtinNames().bunNativePtrPrivateName() == property)
                    continue;

                JSC::PropertySlot slot(object, PropertySlot::InternalMethodType::Get);
                if (!object->getPropertySlot(globalObject, property, slot))
                    continue;

                if ((slot.attributes() & PropertyAttribute::DontEnum) != 0) {
                    if (property == vm.propertyNames->length
                        || property == vm.propertyNames->underscoreProto
                        || property == vm.propertyNames->toStringTagSymbol)
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

                if (scope.exception()) {
                    scope.clearException();
                    propertyValue = jsUndefined();
                }

                JSC::EnsureStillAliveScope ensureStillAliveScope(propertyValue);
                iter(globalObject, arg2, &key, JSC::JSValue::encode(propertyValue), property.isSymbol());
            }
            // reuse memory
            properties.data()->propertyNameVector().shrink(0);
            if (iterating->isCallable())
                break;
            if (iterating == globalObject)
                break;
            iterating = iterating->getPrototype(vm, globalObject).getObject();
        }
    }

    properties.releaseData();

    if (scope.exception()) {
        scope.clearException();
        return;
    }
}

void JSC__JSValue__forEachPropertyOrdered(JSC__JSValue JSValue0, JSC__JSGlobalObject* globalObject, void* arg2, void (*iter)(JSC__JSGlobalObject* arg0, void* ctx, ZigString* arg2, JSC__JSValue JSValue3, bool isSymbol))
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue0);
    JSC::JSObject* object = value.getObject();
    if (!object)
        return;

    JSC::VM& vm = globalObject->vm();

    JSC::PropertyNameArray properties(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    {

        auto scope = DECLARE_CATCH_SCOPE(vm);
        JSC::JSObject::getOwnPropertyNames(object, globalObject, properties, DontEnumPropertiesMode::Include);
        if (scope.exception()) {
            scope.clearException();
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
        if (UNLIKELY(property.isEmpty() || property.isNull()))
            continue;

        // ignore constructor
        if (property == vm.propertyNames->constructor || clientData->builtinNames().bunNativePtrPrivateName() == property)
            continue;

        JSC::PropertySlot slot(object, PropertySlot::InternalMethodType::Get);
        if (!object->getPropertySlot(globalObject, property, slot))
            continue;

        if ((slot.attributes() & PropertyAttribute::DontEnum) != 0) {
            if (property == vm.propertyNames->underscoreProto
                || property == vm.propertyNames->toStringTagSymbol)
                continue;
        }

        JSC::JSValue propertyValue = jsUndefined();
        auto scope = DECLARE_CATCH_SCOPE(vm);
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

        if (UNLIKELY(scope.exception())) {
            scope.clearException();
            propertyValue = jsUndefined();
        }

        const WTF::StringImpl* name = property.isSymbol() && !property.isPrivateName() ? property.impl() : property.string().impl();
        ZigString key = toZigString(name);

        JSC::EnsureStillAliveScope ensureStillAliveScope(propertyValue);
        iter(globalObject, arg2, &key, JSC::JSValue::encode(propertyValue), property.isSymbol());
    }
    properties.releaseData();
}

bool JSC__JSValue__isConstructor(JSC__JSValue JSValue0)
{
    JSValue value = JSValue::decode(JSValue0);
    return value.isConstructor();
}

bool JSC__JSValue__isInstanceOf(JSC__JSValue JSValue0, JSC__JSGlobalObject* globalObject, JSC__JSValue JSValue1)
{
    VM& vm = globalObject->vm();

    auto scope = DECLARE_CATCH_SCOPE(vm);

    JSValue jsValue = JSValue::decode(JSValue0);
    JSValue jsValue1 = JSValue::decode(JSValue1);
    if (UNLIKELY(!jsValue1.isObject())) {
        return false;
    }
    JSObject* jsConstructor = JSC::asObject(jsValue1);
    if (UNLIKELY(!jsConstructor->structure()->typeInfo().implementsHasInstance()))
        return false;
    bool result = jsConstructor->hasInstance(globalObject, jsValue);

    RETURN_IF_EXCEPTION(scope, false);

    return result;
}

extern "C" JSC__JSValue JSC__JSValue__createRopeString(JSC__JSValue JSValue0, JSC__JSValue JSValue1, JSC__JSGlobalObject* globalObject)
{
    return JSValue::encode(JSC::jsString(globalObject, JSC::JSValue::decode(JSValue0).toString(globalObject), JSC::JSValue::decode(JSValue1).toString(globalObject)));
}

extern "C" size_t JSC__VM__blockBytesAllocated(JSC__VM* vm)
{
#if ENABLE(RESOURCE_USAGE)
    return vm->heap.blockBytesAllocated() + vm->heap.extraMemorySize();
#else
    return 0;
#endif
}
extern "C" size_t JSC__VM__externalMemorySize(JSC__VM* vm)
{
#if ENABLE(RESOURCE_USAGE)
    return vm->heap.externalMemorySize();
#else
    return 0;
#endif
}

extern "C" void JSC__JSGlobalObject__queueMicrotaskJob(JSC__JSGlobalObject* arg0, JSC__JSValue JSValue1, JSC__JSValue JSValue2, JSC__JSValue JSValue3, JSC__JSValue JSValue4)
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(arg0);
    JSC::VM& vm = globalObject->vm();
    globalObject->queueMicrotask(
        JSValue(globalObject->performMicrotaskFunction()),
        JSC::JSValue::decode(JSValue1),
        JSC::JSValue::decode(JSValue2),
        JSC::JSValue::decode(JSValue3),
        JSC::JSValue::decode(JSValue4));
}

extern "C" JSC__JSValue WebCore__AbortSignal__create(JSC__JSGlobalObject* globalObject)
{
    Zig::GlobalObject* thisObject = JSC::jsCast<Zig::GlobalObject*>(globalObject);
    auto* context = thisObject->scriptExecutionContext();
    auto abortSignal = WebCore::AbortSignal::create(context);

    return JSValue::encode(toJSNewlyCreated<IDLInterface<WebCore__AbortSignal>>(*globalObject, *jsCast<JSDOMGlobalObject*>(globalObject), WTFMove(abortSignal)));
}
extern "C" JSC__JSValue WebCore__AbortSignal__toJS(WebCore__AbortSignal* arg0, JSC__JSGlobalObject* globalObject)
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);

    return JSValue::encode(toJS<IDLInterface<WebCore__AbortSignal>>(*globalObject, *jsCast<JSDOMGlobalObject*>(globalObject), *abortSignal));
}

extern "C" WebCore__AbortSignal* WebCore__AbortSignal__signal(WebCore__AbortSignal* arg0, JSC__JSValue JSValue1)
{

    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);
    abortSignal->signalAbort(JSC::JSValue::decode(JSValue1));
    return arg0;
}

extern "C" bool WebCore__AbortSignal__aborted(WebCore__AbortSignal* arg0)
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);
    return abortSignal->aborted();
}

extern "C" JSC__JSValue WebCore__AbortSignal__abortReason(WebCore__AbortSignal* arg0)
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);
    return JSC::JSValue::encode(abortSignal->reason());
}

extern "C" WebCore__AbortSignal* WebCore__AbortSignal__ref(WebCore__AbortSignal* arg0)
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);
    abortSignal->ref();
    return arg0;
}

extern "C" WebCore__AbortSignal* WebCore__AbortSignal__unref(WebCore__AbortSignal* arg0)
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);
    abortSignal->deref();
    return arg0;
}
extern "C" void WebCore__AbortSignal__cleanNativeBindings(WebCore__AbortSignal* arg0, void* arg1)
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);
    abortSignal->cleanNativeBindings(arg1);
}

extern "C" WebCore__AbortSignal* WebCore__AbortSignal__addListener(WebCore__AbortSignal* arg0, void* ctx, void (*callback)(void* ctx, JSC__JSValue reason))
{
    WebCore::AbortSignal* abortSignal = reinterpret_cast<WebCore::AbortSignal*>(arg0);

    if (abortSignal->aborted()) {
        callback(ctx, JSC::JSValue::encode(abortSignal->reason()));
        return arg0;
    }

    abortSignal->addNativeCallback(std::make_tuple(ctx, callback));

    return arg0;
}
extern "C" WebCore__AbortSignal* WebCore__AbortSignal__fromJS(JSC__JSValue value)
{
    JSC::JSValue decodedValue = JSC::JSValue::decode(value);
    if (decodedValue.isEmpty())
        return nullptr;
    WebCore::JSAbortSignal* object = JSC::jsDynamicCast<WebCore::JSAbortSignal*>(decodedValue);
    if (!object)
        return nullptr;

    return reinterpret_cast<WebCore__AbortSignal*>(&object->wrapped());
}
static auto ABORT_ERROR_NAME = MAKE_STATIC_STRING_IMPL("AbortError");
extern "C" JSC__JSValue WebCore__AbortSignal__createAbortError(const ZigString* message, const ZigString* arg1,
    JSC__JSGlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();
    ZigString code = *arg1;
    JSC::JSObject* error = Zig::getErrorInstance(message, globalObject).asCell()->getObject();

    error->putDirect(
        vm, vm.propertyNames->name,
        JSC::JSValue(JSC::jsOwnedString(vm, ABORT_ERROR_NAME)),
        0);

    if (code.len > 0) {
        auto clientData = WebCore::clientData(vm);
        JSC::JSValue codeValue = Zig::toJSStringValue(code, globalObject);
        error->putDirect(vm, clientData->builtinNames().codePublicName(), codeValue, 0);
    }

    return JSC::JSValue::encode(error);
}

static auto TIMEOUT_ERROR_NAME = MAKE_STATIC_STRING_IMPL("TimeoutError");
extern "C" JSC__JSValue WebCore__AbortSignal__createTimeoutError(const ZigString* message, const ZigString* arg1,
    JSC__JSGlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();
    ZigString code = *arg1;
    JSC::JSObject* error = Zig::getErrorInstance(message, globalObject).asCell()->getObject();

    error->putDirect(
        vm, vm.propertyNames->name,
        JSC::JSValue(JSC::jsOwnedString(vm, TIMEOUT_ERROR_NAME)),
        0);

    if (code.len > 0) {
        auto clientData = WebCore::clientData(vm);
        JSC::JSValue codeValue = Zig::toJSStringValue(code, globalObject);
        error->putDirect(vm, clientData->builtinNames().codePublicName(), codeValue, 0);
    }

    return JSC::JSValue::encode(error);
}

CPP_DECL double JSC__JSValue__getUnixTimestamp(JSC__JSValue timeValue)
{
    JSC::JSValue decodedValue = JSC::JSValue::decode(timeValue);
    JSC::DateInstance* date = JSC::jsDynamicCast<JSC::DateInstance*>(decodedValue);
    if (!date)
        return PNaN;

    return date->internalNumber();
}

#pragma mark - WebCore::DOMFormData

CPP_DECL void WebCore__DOMFormData__append(WebCore__DOMFormData* arg0, ZigString* arg1, ZigString* arg2)
{
    arg0->append(toStringCopy(*arg1), toStringCopy(*arg2));
}

CPP_DECL void WebCore__DOMFormData__appendBlob(WebCore__DOMFormData* arg0, JSC__JSGlobalObject* arg1, ZigString* arg2, void* blobValueInner, ZigString* fileName)
{
    RefPtr<Blob> blob = WebCore::Blob::create(blobValueInner);
    arg0->append(toStringCopy(*arg2), blob, toStringCopy(*fileName));
}
CPP_DECL size_t WebCore__DOMFormData__count(WebCore__DOMFormData* arg0)
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

CPP_DECL JSC__JSValue WebCore__DOMFormData__createFromURLQuery(JSC__JSGlobalObject* arg0, ZigString* arg1)
{
    JSC::VM& vm = arg0->vm();
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(arg0);
    // don't need to copy the string because it internally does.
    auto formData = DOMFormData::create(globalObject->scriptExecutionContext(), toString(*arg1));
    return JSValue::encode(toJSNewlyCreated(arg0, globalObject, WTFMove(formData)));
}

CPP_DECL JSC__JSValue WebCore__DOMFormData__create(JSC__JSGlobalObject* arg0)
{
    JSC::VM& vm = arg0->vm();
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(arg0);
    auto formData = DOMFormData::create(globalObject->scriptExecutionContext());
    return JSValue::encode(toJSNewlyCreated(arg0, globalObject, WTFMove(formData)));
}

CPP_DECL WebCore__DOMFormData* WebCore__DOMFormData__fromJS(JSC__JSValue JSValue1)
{
    return WebCoreCast<WebCore::JSDOMFormData, WebCore__DOMFormData>(JSValue1);
}

#pragma mark - JSC::JSMap

CPP_DECL JSC__JSValue JSC__JSMap__create(JSC__JSGlobalObject* arg0)
{
    JSC::JSMap* map = JSC::JSMap::create(arg0->vm(), arg0->mapStructure());
    return JSC::JSValue::encode(map);
}
CPP_DECL JSC__JSValue JSC__JSMap__get_(JSC__JSMap* map, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue2);

    return JSC::JSValue::encode(map->get(arg1, value));
}
CPP_DECL bool JSC__JSMap__has(JSC__JSMap* map, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue2);
    return map->has(arg1, value);
}
CPP_DECL bool JSC__JSMap__remove(JSC__JSMap* map, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2)
{
    JSC::JSValue value = JSC::JSValue::decode(JSValue2);
    return map->remove(arg1, value);
}
CPP_DECL void JSC__JSMap__set(JSC__JSMap* map, JSC__JSGlobalObject* arg1, JSC__JSValue JSValue2, JSC__JSValue JSValue3)
{
    map->set(arg1, JSC::JSValue::decode(JSValue2), JSC::JSValue::decode(JSValue3));
}
