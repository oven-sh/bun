// What src/desktop needs from C++.
#include "root.h"
#include "Bindgen/JSWrapper.h"
#include "BunClientData.h"
#include "BunProcess.h"
#include "EventNames.h"
#include "EventTargetConcrete.h"
#include "GeneratedBlob.h"
#include "JSDOMException.h"
#include "JSDOMWrapperCache.h"
#include "JSEvent.h"
#include "JSEventListener.h"
#include "JSEventTarget.h"
#include "JSMessagePort.h"
#include "Secrets.h"
#include "SerializedScriptValue.h"
#include "ZigGlobalObject.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/IntlObject.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalProxy.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSSetInlines.h>
#include <JavaScriptCore/JSSetIterator.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/RegExpConstructor.h>
#include <wtf/RAMSize.h>

namespace Bun {
using namespace JSC;

extern "C" void* Blob__fromBytesWithType(JSGlobalObject*, const uint8_t*, size_t, const char*);

extern "C" EncodedJSValue Bun__Desktop__process(Zig::GlobalObject* globalObject)
{
    return JSValue::encode(globalObject->processObject());
}

extern "C" void Bun__Desktop__await(JSGlobalObject* globalObject, EncodedJSValue value, EncodedJSValue fulfilled, EncodedJSValue rejected)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* promise = JSPromise::resolvedPromise(globalObject, JSValue::decode(value));
    RETURN_IF_EXCEPTION(scope, );
    RELEASE_AND_RETURN(scope, promise->performPromiseThenExported(vm, globalObject, JSValue::decode(fulfilled), JSValue::decode(rejected), jsUndefined()));
}

extern "C" bool Bun__Desktop__hasProperty(JSGlobalObject* globalObject, EncodedJSValue object, EncodedJSValue key)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    auto name = JSValue::decode(key).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    RELEASE_AND_RETURN(scope, asObject(JSValue::decode(object))->hasProperty(globalObject, name));
}

extern "C" EncodedJSValue Bun__Desktop__get(JSGlobalObject* globalObject, EncodedJSValue object, EncodedJSValue key)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    auto name = JSValue::decode(key).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue value = JSValue::decode(object).get(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(value);
}

extern "C" void Bun__Desktop__set(JSGlobalObject* globalObject, EncodedJSValue object, EncodedJSValue key, EncodedJSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    auto name = JSValue::decode(key).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    PutPropertySlot slot(JSValue::decode(object), true);
    scope.release();
    JSValue::decode(object).put(globalObject, name, JSValue::decode(value), slot);
}

extern "C" EncodedJSValue Bun__Desktop__functionPrototype(JSGlobalObject* globalObject)
{
    return JSValue::encode(globalObject->functionPrototype());
}

JSString* objectPrototypeToStringOutOfLine(JSGlobalObject*, JSValue);

extern "C" EncodedJSValue Bun__Desktop__toStringTag(JSGlobalObject* globalObject, EncodedJSValue object)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSString* text = objectPrototypeToStringOutOfLine(globalObject, JSValue::decode(object));
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(jsSubstring(globalObject, text, 8, text->length() - 9)));
}

extern "C" EncodedJSValue Bun__Desktop__ownProperties(JSGlobalObject* globalObject, EncodedJSValue value)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* object = JSValue::decode(value).toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, globalObject, names, DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, {});
    MarkedArgumentBuffer all;
    for (auto& name : names) {
        PropertyDescriptor descriptor;
        bool exists = object->getOwnPropertyDescriptor(globalObject, name, descriptor);
        RETURN_IF_EXCEPTION(scope, {});
        if (!exists)
            continue;
        bool hasValue = descriptor.isDataDescriptor();
        for (JSValue each : { JSValue(jsString(vm, name.string())), jsBoolean(descriptor.enumerable()), jsBoolean(descriptor.configurable()), jsBoolean(hasValue), hasValue ? descriptor.value() : jsUndefined() })
            all.append(each);
    }
    if (all.hasOverflowed()) {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), all)));
}

extern "C" EncodedJSValue Bun__Desktop__createWeakMap(JSGlobalObject* globalObject)
{
    return JSValue::encode(JSWeakMap::create(getVM(globalObject), globalObject->weakMapStructure()));
}

extern "C" EncodedJSValue Bun__Desktop__getWeakly(EncodedJSValue map, EncodedJSValue key)
{
    return JSValue::encode(uncheckedDowncast<JSWeakMap>(JSValue::decode(map))->get(JSValue::decode(key).asCell()));
}

extern "C" void Bun__Desktop__setWeakly(JSGlobalObject* globalObject, EncodedJSValue map, EncodedJSValue key, EncodedJSValue value)
{
    uncheckedDowncast<JSWeakMap>(JSValue::decode(map))->set(getVM(globalObject), JSValue::decode(key).asCell(), JSValue::decode(value));
}

extern "C" EncodedJSValue Bun__Desktop__natives(Zig::GlobalObject* globalObject)
{
    return JSValue::encode(globalObject->natives());
}

extern "C" EncodedJSValue Bun__Desktop__createObject(JSGlobalObject* globalObject, EncodedJSValue prototype)
{
    return JSValue::encode(constructEmptyObject(globalObject, asObject(JSValue::decode(prototype))));
}

extern "C" EncodedJSValue Bun__Desktop__createEventTarget(Zig::GlobalObject* globalObject, EncodedJSValue prototype, EncodedJSValue instance)
{
    VM& vm = getVM(globalObject);
    auto* structure = WebCore::JSEventTarget::createStructure(vm, globalObject, JSValue::decode(prototype));
    auto* target = WebCore::createWrapper<WebCore::EventTarget>(globalObject, structure, WebCore::EventTarget::create(*globalObject->scriptExecutionContext()));
    target->putDirect(vm, WebCore::builtinNames(vm).implPrivateName(), JSValue::decode(instance));
    return JSValue::encode(target);
}

extern "C" void Bun__Desktop__dispatchEvent(EncodedJSValue target, EncodedJSValue event)
{
    uncheckedDowncast<WebCore::JSEventTarget>(JSValue::decode(target))->wrapped().dispatchEvent(uncheckedDowncast<WebCore::JSEvent>(JSValue::decode(event))->wrapped());
}

static const AtomString& eventOfSocket(uint8_t event)
{
    auto& names = WebCore::eventNames();
    return *std::array { &names.openEvent, &names.messageEvent, &names.errorEvent, &names.closeEvent }[event];
}

extern "C" EncodedJSValue Bun__Desktop__eventHandler(EncodedJSValue encodedTarget, uint8_t event)
{
    auto* target = uncheckedDowncast<WebCore::JSEventTarget>(JSValue::decode(encodedTarget));
    return JSValue::encode(WebCore::eventHandlerAttribute(target->wrapped(), eventOfSocket(event), WebCore::worldForDOMObject(*target)));
}

extern "C" void Bun__Desktop__setEventHandler(EncodedJSValue encodedTarget, uint8_t event, EncodedJSValue handler)
{
    auto* target = uncheckedDowncast<WebCore::JSEventTarget>(JSValue::decode(encodedTarget));
    WebCore::setEventHandlerAttribute<WebCore::JSEventListener>(target->wrapped(), eventOfSocket(event), JSValue::decode(handler), *target);
    target->vm().writeBarrier(target, JSValue::decode(handler));
}

extern "C" JSGlobalObject* Bun__Desktop__realmOf(EncodedJSValue value)
{
    JSObject* object = asObject(JSValue::decode(value));
    if (auto* proxy = dynamicDowncast<JSGlobalProxy>(object))
        return proxy->target();
    return object->realm();
}

// realm::Module
extern "C" EncodedJSValue Bun__Desktop__require(Zig::GlobalObject* globalObject, uint8_t module)
{
    switch (module) {
    case 0:
        return JSValue::encode(Bun::Bindgen::requireNodeModule(globalObject, "childProcess"_s));
    case 1:
        return JSValue::encode(Bun::Bindgen::requireNodeModule(globalObject, "events"_s));
    case 2:
        return JSValue::encode(globalObject->m_nodeModuleConstructor.getInitializedOnMainThread(globalObject));
    case 3:
        return JSValue::encode(Bun::Bindgen::requireNodeModule(globalObject, "url"_s));
    case 4:
        return JSValue::encode(Bun::Bindgen::requireNodeModule(globalObject, "dns"_s));
    case 5:
        return JSValue::encode(Bun::Bindgen::requireNodeModule(globalObject, "fs"_s));
    case 6:
        return JSValue::encode(Bun::Bindgen::requireNodeModule(globalObject, "os"_s));
    case 7:
        return JSValue::encode(Bun::Bindgen::requireNodeModule(globalObject, "stream"_s));
    default:
        return JSValue::encode(Bun::Bindgen::requireNodeModule(globalObject, "tls"_s));
    }
}

extern "C" EncodedJSValue Bun__Desktop__construct(JSGlobalObject* globalObject, EncodedJSValue constructor, EncodedJSValue list)
{
    auto* array = uncheckedDowncast<JSArray>(JSValue::decode(list));
    MarkedArgumentBuffer arguments;
    for (unsigned i = 0; i < array->length(); ++i)
        arguments.append(array->getIndexQuickly(i));
    return JSValue::encode(construct(globalObject, JSValue::decode(constructor), arguments, "Not a constructor"_s));
}

// wire::Kind
extern "C" EncodedJSValue Bun__Desktop__create(JSGlobalObject* globalObject, uint8_t kind, EncodedJSValue a, EncodedJSValue b)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (kind == 2)
        return JSValue::encode(JSSet::create(vm, globalObject->setStructure()));
    MarkedArgumentBuffer arguments;
    if (kind == 1) {
        arguments.append(JSValue::decode(a));
        arguments.append(JSValue::decode(b));
        RELEASE_AND_RETURN(scope, JSValue::encode(construct(globalObject, globalObject->regExpConstructor(), arguments, "Not a constructor"_s)));
    }
    auto name = JSValue::decode(a).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (kind == 0) {
        auto type = ErrorType::Error;
        for (auto candidate : { ErrorType::EvalError, ErrorType::RangeError, ErrorType::ReferenceError, ErrorType::SyntaxError, ErrorType::TypeError, ErrorType::URIError }) {
            if (name == errorTypeName(candidate))
                type = candidate;
        }
        auto message = JSValue::decode(b).toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        return JSValue::encode(createError(globalObject, type, message));
    }
    JSObject* constructor = globalObject->typedArrayConstructor(TypeUint8);
#define BUN_DESKTOP_FIND_VIEW(type) \
    if (name == #type "Array"_s)    \
        constructor = globalObject->typedArrayConstructor(Type##type);
    FOR_EACH_TYPED_ARRAY_TYPE_EXCLUDING_DATA_VIEW(BUN_DESKTOP_FIND_VIEW)
#undef BUN_DESKTOP_FIND_VIEW
    if (name == "DataView"_s)
        constructor = globalObject->typedArrayConstructor(TypeDataView);
    arguments.append(JSValue::decode(b));
    RELEASE_AND_RETURN(scope, JSValue::encode(construct(globalObject, constructor, arguments, "Not a constructor"_s)));
}

extern "C" void Bun__Desktop__addToSet(JSGlobalObject* globalObject, EncodedJSValue set, EncodedJSValue item)
{
    uncheckedDowncast<JSSet>(JSValue::decode(set))->add(globalObject, JSValue::decode(item));
}

extern "C" EncodedJSValue Bun__Desktop__itemsOf(JSGlobalObject* globalObject, EncodedJSValue collection)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer items;
    JSValue key, value;
    if (auto* map = dynamicDowncast<JSMap>(JSValue::decode(collection))) {
        auto* iterator = JSMapIterator::create(vm, globalObject->mapIteratorStructure(), map, IterationKind::Entries);
        while (iterator->nextKeyValue(globalObject, key, value)) {
            items.append(key);
            items.append(value);
        }
    } else if (auto* set = dynamicDowncast<JSSet>(JSValue::decode(collection))) {
        auto* iterator = JSSetIterator::create(vm, globalObject->setIteratorStructure(), set, IterationKind::Keys);
        while (iterator->next(globalObject, key))
            items.append(key);
    }
    if (items.hasOverflowed()) {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), items)));
}

extern "C" EncodedJSValue Bun__Desktop__copyPlainData(JSGlobalObject* to, EncodedJSValue value)
{
    return JSValue::encode(WebCore::SerializedScriptValue::tryCopyPlainData(*to, JSValue::decode(value)));
}

extern "C" EncodedJSValue Bun__Desktop__clone(JSGlobalObject* from, Zig::GlobalObject* to, EncodedJSValue encodedValue)
{
    auto& vm = getVM(from);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSValue::decode(encodedValue);
    JSValue copy = WebCore::SerializedScriptValue::tryCopyPlainData(*to, value);
    RETURN_IF_EXCEPTION(scope, {});
    if (copy)
        return JSValue::encode(copy);
    auto fail = [&] {
        throwException(from, scope, createError(from, "An object could not be cloned."_s));
        return EncodedJSValue {};
    };
    Vector<RefPtr<WebCore::MessagePort>> ports;
    auto serialized = WebCore::SerializedScriptValue::create(*from, value, {}, ports);
    if (auto* exception = scope.exception()) {
        if (!dynamicDowncast<WebCore::JSDOMException>(exception->value()) || !scope.tryClearException())
            return {};
        return fail();
    }
    if (serialized.hasException())
        return fail();
    JSValue result = serialized.releaseReturnValue()->deserialize(*to, to, ports);
    if (scope.exception())
        return scope.tryClearException() ? fail() : EncodedJSValue {};
    return JSValue::encode(result);
}

// Runs no script: a proxy is an instance of nothing.
static void freezeDeeply(JSGlobalObject* realm, JSValue value)
{
    auto& vm = getVM(realm);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!value.isObject() || (value.asCell()->type() != FinalObjectType && !isJSArray(value)))
        return;
    JSObject* object = asObject(value);
    if (!object->isStructureExtensible())
        return;
    if (!vm.isSafeToRecurse())
        return void(throwStackOverflowError(realm, scope));
    objectConstructorFreeze(realm, object);
    RETURN_IF_EXCEPTION(scope, );
    PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, realm, names, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, );
    for (auto& name : names) {
        JSValue member = object->get(realm, name);
        RETURN_IF_EXCEPTION(scope, );
        freezeDeeply(realm, member);
        RETURN_IF_EXCEPTION(scope, );
    }
}

// False if the name is taken.
extern "C" bool Bun__Desktop__expose(JSGlobalObject* realm, EncodedJSValue key, EncodedJSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(realm));
    auto name = JSValue::decode(key).toPropertyKey(realm);
    RETURN_IF_EXCEPTION(scope, false);
    bool isTaken = realm->hasOwnProperty(realm, name);
    RETURN_IF_EXCEPTION(scope, false);
    if (isTaken)
        return false;
    freezeDeeply(realm, JSValue::decode(value));
    RETURN_IF_EXCEPTION(scope, false);
    PropertyDescriptor descriptor(JSValue::decode(value), PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete);
    RELEASE_AND_RETURN(scope, realm->methodTable()->defineOwnProperty(realm, realm, name, descriptor, true));
}

extern "C" EncodedJSValue Bun__Desktop__createBlob(Zig::GlobalObject* globalObject, const uint8_t* bytes, size_t length, const char* type)
{
    return JSValue::encode(Bindgen::createWrapper<Bindgen::Generated::JSBlob>(globalObject, Blob__fromBytesWithType(globalObject, bytes, length, type)));
}

extern "C" BunString Bun__Desktop__defaultLocale(JSGlobalObject* globalObject)
{
    return toStringRef(defaultLocale(globalObject)).leak();
}

extern "C" size_t Bun__Desktop__totalMemory()
{
    return ramSize();
}

extern "C" void Bun__Desktop__heapStatistics(JSGlobalObject* globalObject, size_t* capacity, size_t* size)
{
    auto& vm = getVM(globalObject);
    *capacity = vm.heap.blockBytesAllocated();
    *size = WebCore::clientData(vm)->heapSizeAfterLastCollection() ?: *capacity;
}

using Receive = void (*)(void* context, bool isError, const uint8_t*, size_t);

static UTF8CString copy(const char* text)
{
    return String::fromUTF8(text).utf8();
}

static void report(const Secrets::Error& error, void* context, Receive receive)
{
    auto message = error.message.utf8();
    receive(context, true, byteCast<uint8_t>(message.span()).data(), message.length());
}

extern "C" void Bun__Desktop__getSecret(const char* service, const char* name, void* context, Receive receive)
{
    Secrets::Error error;
    auto secret = Secrets::getPassword(copy(service), copy(name), error);
    if (error.isError() && error.type != Secrets::ErrorType::NotFound)
        return report(error, context, receive);
    if (!secret)
        return;
    receive(context, false, secret->span().data(), secret->size());
    memsetSpan(secret->mutableSpan(), 0);
}

extern "C" void Bun__Desktop__setSecret(const char* service, const char* name, const char* secret, void* context, Receive receive)
{
    auto error = Secrets::setPassword(copy(service), copy(name), copy(secret), false, Secrets::Persist::Enterprise);
    if (error.isError())
        report(error, context, receive);
}

} // namespace Bun
