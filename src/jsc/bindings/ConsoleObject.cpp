#include "root.h"

#include "JavaScriptCore/ArgList.h"
#include "headers.h"
#include "ConsoleObject.h"

#include <JavaScriptCore/ConsoleClient.h>
#include <JavaScriptCore/ConsoleMessage.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/ScriptArguments.h>
#include <wtf/text/WTFString.h>

#include <JavaScriptCore/JSGlobalObjectInspectorController.h>
#include <JavaScriptCore/JSGlobalObjectDebuggable.h>
#include <JavaScriptCore/ConsoleClient.h>

#include "GCDefferalContext.h"
#include <JavaScriptCore/InspectorScriptProfilerAgent.h>
#include <JavaScriptCore/InspectorDebuggerAgent.h>
#include <JavaScriptCore/InspectorConsoleAgent.h>

namespace Bun {
using namespace JSC;
using namespace Inspector;

using ScriptArguments = Inspector::ScriptArguments;
using MessageType = JSC::MessageType;
using MessageLevel = JSC::MessageLevel;
using JSGlobalObject = JSC::JSGlobalObject;

using String = WTF::String;

void ConsoleObject::messageWithTypeAndLevel(MessageType type, MessageLevel level,
    JSC::JSGlobalObject* globalObject,
    Ref<ScriptArguments>&& arguments)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (globalObject->inspectable()) {
        if (auto client = globalObject->inspectorController().consoleClient()) {
            client->messageWithTypeAndLevel(type, level, globalObject, arguments.copyRef());
            RETURN_IF_EXCEPTION(scope, );
        }
    }
    auto args = arguments.ptr();
    JSC::EncodedJSValue jsArgs[255];

    auto count = std::min(args->argumentCount(), (size_t)255);
    for (size_t i = 0; i < count; i++) {
        auto val = args->argumentAt(i);
        jsArgs[i] = JSC::JSValue::encode(val);
    }

    if (type == MessageType::Table && count >= 2 && !args->argumentAt(1).isUndefined() && (!args->argumentAt(1).isCell() || args->argumentAt(1).asCell()->type() != JSC::JSType::ArrayType)) [[unlikely]] {
        JSC::throwTypeError(globalObject, scope, "The \"properties\" argument must be an instance of Array."_s);
        return;
    }

    RELEASE_AND_RETURN(scope, Bun__ConsoleObject__messageWithTypeAndLevel(this->m_client, static_cast<uint32_t>(type), static_cast<uint32_t>(level), globalObject, jsArgs, count));
}
void ConsoleObject::count(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Bun__ConsoleObject__count(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}

void ConsoleObject::countReset(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Bun__ConsoleObject__countReset(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}

void ConsoleObject::takeHeapSnapshot(JSC::JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Bun__ConsoleObject__takeHeapSnapshot(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void ConsoleObject::time(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Bun__ConsoleObject__time(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void ConsoleObject::timeLog(JSGlobalObject* globalObject, const String& label,
    Ref<ScriptArguments>&& arguments)
{
    auto input = label.tryGetUTF8().value();

    auto args = arguments.ptr();
    JSC::EncodedJSValue jsArgs[255];
    auto count = std::min(args->argumentCount(), (size_t)255);
    for (size_t i = 0; i < count; i++) {
        auto val = args->argumentAt(i);
        jsArgs[i] = JSC::JSValue::encode(val);
    }

    Bun__ConsoleObject__timeLog(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length(), jsArgs, count);
}
void ConsoleObject::timeEnd(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Bun__ConsoleObject__timeEnd(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void ConsoleObject::timeStamp(JSGlobalObject* globalObject, Ref<ScriptArguments>&& args)
{
    Bun__ConsoleObject__timeStamp(this->m_client, globalObject, args.ptr());
}
void ConsoleObject::record(JSGlobalObject*, Ref<ScriptArguments>&&) {}
void ConsoleObject::recordEnd(JSGlobalObject*, Ref<ScriptArguments>&&) {}
void ConsoleObject::screenshot(JSGlobalObject*, Ref<ScriptArguments>&&)
{
}

void ConsoleObject::profile(JSC::JSGlobalObject* globalObject, const String& title)
{
    if (globalObject->inspectable()) {
        if (auto client = globalObject->inspectorController().consoleClient()) {
            client->profile(globalObject, title);
        }
    }
}

void ConsoleObject::profileEnd(JSC::JSGlobalObject* globalObject, const String& title)
{
    if (globalObject->inspectable()) {
        if (auto client = globalObject->inspectorController().consoleClient()) {
            client->profileEnd(globalObject, title);
        }
    }
}

}

// `JSC::forEachInIterable` with the iterator protocol bounded: by the collection's element count when it has one, else by `budget`. `sizeAlreadyRead` is a Map or Set `size` the caller read, or -1. True when elements were left.
extern "C" bool Bun__ConsoleObject__forEachLimited(JSC::EncodedJSValue encodedIterable, JSC::JSGlobalObject* globalObject, uint32_t budget, int32_t sizeAlreadyRead, void* ctx, void (*callback)(JSC::VM*, JSC::JSGlobalObject*, void* ctx, JSC::EncodedJSValue))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue iterable = JSC::JSValue::decode(encodedIterable);
    JSC::JSCell* sentinel = vm.orderedHashTableSentinel();

    auto visit = [&](JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue value) {
        callback(&vm, globalObject, ctx, JSC::JSValue::encode(value));
    };

    // The walks `forEachInIterable` takes when user code cannot observe the iteration. The collection itself bounds them.
    if (JSC::getIterationMode(iterable) == JSC::IterationMode::FastArray) {
        JSC::forEachInFastArray(globalObject, iterable, uncheckedDowncast<JSC::JSArray>(iterable), visit);
        RETURN_IF_EXCEPTION(scope, false);
        return false;
    }
    auto* map = dynamicDowncast<JSC::JSMap>(iterable);
    if (map && map->isIteratorProtocolFastAndNonObservable()) {
        JSC::JSCell* storage = map->storageOrSentinel(vm);
        if (storage != sentinel) {
            JSC::forEachInMapStorage(vm, globalObject, storage, 0, JSC::IterationKind::Entries, visit);
            RETURN_IF_EXCEPTION(scope, false);
        }
        return false;
    }
    auto* set = dynamicDowncast<JSC::JSSet>(iterable);
    if (set && set->isIteratorProtocolFastAndNonObservable()) {
        JSC::JSCell* storage = set->storageOrSentinel(vm);
        if (storage != sentinel) {
            JSC::forEachInSetStorage(vm, globalObject, storage, 0, visit);
            RETURN_IF_EXCEPTION(scope, false);
        }
        return false;
    }

    uint64_t bound = budget;
    if (map || set) {
        // Node's rule for a replaced iterator: it gets as many steps as the collection reports entries.
        double size = sizeAlreadyRead;
        if (sizeAlreadyRead < 0) {
            JSC::JSObject* collection = map ? static_cast<JSC::JSObject*>(map) : set;
            JSC::JSValue sizeValue = collection->get(globalObject, vm.propertyNames->size);
            RETURN_IF_EXCEPTION(scope, false);
            size = sizeValue.toNumber(globalObject);
            RETURN_IF_EXCEPTION(scope, false);
        }
        // A size that is not a finite count says nothing about where the walk ends, so the budget stays.
        if (std::isfinite(size) && size >= 0)
            bound = size < static_cast<double>(UINT32_MAX) ? static_cast<uint64_t>(size) : UINT32_MAX;
    } else if (auto* array = dynamicDowncast<JSC::JSArray>(iterable))
        bound = array->length();
    else if (auto* view = dynamicDowncast<JSC::JSArrayBufferView>(iterable))
        bound = view->length();
    else if (auto* mapIterator = dynamicDowncast<JSC::JSMapIterator>(iterable)) {
        if (auto* iterated = dynamicDowncast<JSC::JSMap>(mapIterator->internalField(JSC::JSMapIterator::Field::IteratedObject).get()))
            bound = iterated->size();
    } else if (auto* setIterator = dynamicDowncast<JSC::JSSetIterator>(iterable)) {
        if (auto* iterated = dynamicDowncast<JSC::JSSet>(setIterator->internalField(JSC::JSSetIterator::Field::IteratedObject).get()))
            bound = iterated->size();
    }

    JSC::IterationRecord iterationRecord = JSC::iteratorForIterable(globalObject, iterable);
    RETURN_IF_EXCEPTION(scope, false);

    bool truncated = false;
    for (uint64_t visited = 0;; visited++) {
        JSC::JSValue next = JSC::iteratorStep(globalObject, iterationRecord);
        RETURN_IF_EXCEPTION(scope, false);
        if (next.isFalse())
            return false;

        if (visited >= bound) {
            truncated = true;
            break;
        }

        JSC::JSValue nextValue = JSC::iteratorValue(globalObject, next);
        RETURN_IF_EXCEPTION(scope, false);

        callback(&vm, globalObject, ctx, JSC::JSValue::encode(nextValue));
        if (scope.exception()) [[unlikely]]
            break;
    }

    scope.release();
    JSC::iteratorClose(globalObject, iterationRecord.iterator);
    return truncated;
}
