#include "root.h"
#include "headers.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/JSFunction.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "ZigGlobalObject.h"
#include "JSBuffer.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/PropertyNameArray.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/IdentifierInlines.h"
#include "JavaScriptCore/JSMapIterator.h"
#include "JavaScriptCore/JSSetIterator.h"

namespace Bun {

using namespace JSC;

Structure* createUtilInspectOptionsStructure(VM& vm, JSC::JSGlobalObject* globalObject)
{
    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(globalObject, globalObject->objectPrototype(), 3);
    PropertyOffset offset;
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "stylize"_s), 0, offset);
    RELEASE_ASSERT(offset == 0);
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "depth"_s), 0, offset);
    RELEASE_ASSERT(offset == 1);
    structure = Structure::addPropertyTransition(vm, structure, Identifier::fromString(vm, "colors"_s), 0, offset);
    RELEASE_ASSERT(offset == 2);
    return structure;
}

JSObject* createInspectOptionsObject(VM& vm, Zig::GlobalObject* globalObject, unsigned max_depth, bool colors)
{
    JSFunction* stylizeFn = colors ? globalObject->utilInspectStylizeColorFunction() : globalObject->utilInspectStylizeNoColorFunction();
    if (!stylizeFn) return nullptr;
    JSObject* options = JSC::constructEmptyObject(vm, globalObject->utilInspectOptionsStructure());
    options->putDirectOffset(vm, 0, stylizeFn);
    options->putDirectOffset(vm, 1, jsNumber(max_depth));
    options->putDirectOffset(vm, 2, jsBoolean(colors));
    return options;
}

extern "C" JSC::EncodedJSValue JSC__JSValue__callCustomInspectFunction(
    Zig::GlobalObject* globalObject,
    JSC::EncodedJSValue encodedFunctionValue,
    JSC::EncodedJSValue encodedThisValue,
    unsigned depth,
    unsigned max_depth,
    bool colors)
{
    JSValue functionToCall = JSValue::decode(encodedFunctionValue);
    JSValue thisValue = JSValue::decode(encodedThisValue);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto callData = JSC::getCallData(functionToCall);
    MarkedArgumentBuffer arguments;
    arguments.append(jsNumber(depth));
    if (WebCore::isInspectFunctionOfBuffer(functionToCall)) {
        // Of its operands it reads `showHidden` of the second.
        arguments.append(constructEmptyObject(globalObject));
    } else {
        JSObject* options = Bun::createInspectOptionsObject(vm, globalObject, max_depth, colors);
        RETURN_IF_EXCEPTION(scope, {});
        JSFunction* inspectFn = globalObject->utilInspectFunction();
        RETURN_IF_EXCEPTION(scope, {});
        arguments.append(options);
        arguments.append(inspectFn);
    }

    auto inspectRet = JSC::profiledCall(globalObject, ProfilingReason::API, functionToCall, callData, thisValue, arguments);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(inspectRet));
}

// Port of V8's `internalBinding('util').getOwnNonIndexProperties(object, filter)` used by
// util.inspect and the REPL completer: own keys minus array indices, without materializing
// a name (or descriptor) per element the way Object.getOwnPropertyNames() on an array would.
// `filter` is Node's PropertyFilter bitmask: ONLY_ENUMERABLE = 2, SKIP_STRINGS = 8, SKIP_SYMBOLS = 16.
JSC_DEFINE_HOST_FUNCTION(jsFunctionGetOwnNonIndexProperties, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* object = callFrame->argument(0).toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    int32_t filter = callFrame->argument(1).toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    constexpr int32_t ONLY_ENUMERABLE = 1 << 1;
    constexpr int32_t SKIP_STRINGS = 1 << 3;
    constexpr int32_t SKIP_SYMBOLS = 1 << 4;

    if ((filter & SKIP_STRINGS) && (filter & SKIP_SYMBOLS))
        RELEASE_AND_RETURN(scope, JSValue::encode(constructEmptyArray(globalObject, nullptr)));
    PropertyNameMode propertyNameMode = PropertyNameMode::StringsAndSymbols;
    if (filter & SKIP_STRINGS)
        propertyNameMode = PropertyNameMode::Symbols;
    else if (filter & SKIP_SYMBOLS)
        propertyNameMode = PropertyNameMode::Strings;
    DontEnumPropertiesMode dontEnumMode = (filter & ONLY_ENUMERABLE) ? DontEnumPropertiesMode::Exclude : DontEnumPropertiesMode::Include;

    PropertyNameArrayBuilder propertyNames(vm, propertyNameMode, PrivateSymbolMode::Exclude);
    // The ordinary [[OwnPropertyKeys]] (Array included) and the typed array one are both "the
    // indices, then getOwnNonIndexPropertyNames()", so for those the indices are never produced.
    // Anything else that overrides it (Proxy, String objects, arguments, module namespaces, ...)
    // has to be asked for all of its keys, and the loop below drops the indices again.
    if (isTypedArrayType(object->type()) || !object->structure()->typeInfo().overridesGetOwnPropertyNames())
        object->getOwnNonIndexPropertyNames(globalObject, propertyNames, dontEnumMode);
    else
        object->methodTable()->getOwnPropertyNames(object, globalObject, propertyNames, dontEnumMode);
    RETURN_IF_EXCEPTION(scope, {});

    MarkedArgumentBuffer keys;
    for (const auto& propertyName : propertyNames) {
        if (!propertyName.isSymbol() && parseIndex(propertyName))
            continue;
        keys.append(identifierToJSValue(vm, propertyName));
    }
    if (keys.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), keys)));
}

static ALWAYS_INLINE bool nextEntry(VM& vm, JSMapIterator* iterator, JSValue& key, JSValue& value)
{
    auto next = iterator->nextWithAdvance(vm);
    key = next.key;
    value = next.value;
    return !!key;
}

static ALWAYS_INLINE bool nextEntry(VM& vm, JSSetIterator* iterator, JSValue& key, JSValue& value)
{
    // A Set stores keys only. Its entries() pairs each key with itself.
    key = value = iterator->nextWithAdvance(vm);
    return !!key;
}

// Steps a private copy of `iterator` with the engine's own next(), so the caller's iterator does not move. Returns how many entries are left.
template<typename Iterator>
static uint32_t remainingEntries(VM& vm, Structure* structure, Iterator* iterator, uint32_t limit, MarkedArgumentBuffer& entries)
{
    Iterator* copy = Iterator::createWithInitialValues(vm, structure);
    for (auto field : { Iterator::Field::Entry, Iterator::Field::IteratedObject, Iterator::Field::Storage, Iterator::Field::Kind }) {
        // Storage is empty until the collection has one.
        if (JSValue value = iterator->internalField(field).get())
            copy->internalField(field).set(vm, copy, value);
    }

    JSValue key;
    JSValue value;
    if (!nextEntry(vm, copy, key, value))
        return 0;

    // The collection holds at least what the iterator has left, so one allocation is enough.
    IterationKind kind = iterator->kind();
    size_t copied = std::min<size_t>(limit, iterator->iteratedObject()->size());
    entries.ensureCapacity(kind == IterationKind::Entries ? copied * 2 : copied);
    uint32_t remaining = 0;
    do {
        if (remaining++ >= limit)
            continue;
        if (kind != IterationKind::Values)
            entries.append(key);
        if (kind != IterationKind::Keys)
            entries.append(value);
    } while (nextEntry(vm, copy, key, value));
    return remaining;
}

// False if `value` is not a Map or Set iterator. `entries` is flat: [key, value, key, value, ...] when `isKeyValue`.
static bool remainingEntriesOf(JSGlobalObject* globalObject, JSValue value, uint32_t limit, MarkedArgumentBuffer& entries, bool& isKeyValue, uint32_t& length)
{
    auto& vm = JSC::getVM(globalObject);
    if (auto* mapIterator = dynamicDowncast<JSMapIterator>(value)) {
        isKeyValue = mapIterator->kind() == IterationKind::Entries;
        length = remainingEntries(vm, globalObject->mapIteratorStructure(), mapIterator, limit, entries);
        return true;
    }
    if (auto* setIterator = dynamicDowncast<JSSetIterator>(value)) {
        isKeyValue = setIterator->kind() == IterationKind::Entries;
        length = remainingEntries(vm, globalObject->setIteratorStructure(), setIterator, limit, entries);
        return true;
    }
    return false;
}

// internalBinding('util').previewEntries(iterator, true) plus a limit: [flat entries (at most `limit`), isKeyValue, entries left].
JSC_DEFINE_HOST_FUNCTION(jsFunctionPreviewEntries, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue limitValue = callFrame->argument(1);
    uint32_t limit = std::numeric_limits<uint32_t>::max();
    if (limitValue.isNumber()) {
        double number = limitValue.asNumber();
        // NaN is not > 0.
        if (!(number > 0))
            limit = 0;
        else if (number < limit)
            limit = static_cast<uint32_t>(number);
    }

    MarkedArgumentBuffer entries;
    uint32_t length = 0;
    bool isKeyValue = false;
    if (!remainingEntriesOf(globalObject, callFrame->argument(0), limit, entries, isKeyValue, length))
        return throwVMTypeError(globalObject, scope, "previewEntries() expects a Map or Set iterator"_s);

    if (entries.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    JSArray* entriesArray = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), entries);
    RETURN_IF_EXCEPTION(scope, {});

    MarkedArgumentBuffer result;
    result.append(entriesArray);
    result.append(jsBoolean(isKeyValue));
    result.append(jsNumber(length));
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), result)));
}

}
