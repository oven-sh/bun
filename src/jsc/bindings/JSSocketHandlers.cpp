#include "root.h"

#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JSSocketHandlers.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/JSInternalFieldObjectImplInlines.h>
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "BunClientData.h"

namespace Bun {

using namespace JSC;

const JSC::ClassInfo JSSocketHandlers::s_info = { "SocketHandlers"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSSocketHandlers) };

template<typename, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSSocketHandlers::subspaceFor(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSSocketHandlers, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForJSSocketHandlers.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSSocketHandlers = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForJSSocketHandlers.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForJSSocketHandlers = std::forward<decltype(space)>(space); });
}

JSC::Structure* JSSocketHandlers::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSSocketHandlers::JSSocketHandlers(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

void JSSocketHandlers::finishCreation(JSC::VM& vm, const JSC::EncodedJSValue* callbacks)
{
    Base::finishCreation(vm);
    for (unsigned i = 0; i < numberOfCallbacks; i++) {
        JSC::JSValue value = JSC::JSValue::decode(callbacks[i]);
        Base::internalField(i).setWithoutWriteBarrier(value.isEmpty() ? jsUndefined() : value);
    }
    Base::internalField(static_cast<unsigned>(Field::Promise)).setWithoutWriteBarrier(jsUndefined());
}

template<typename Visitor>
void JSSocketHandlers::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSSocketHandlers>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSSocketHandlers);

JSSocketHandlers* JSSocketHandlers::create(JSC::JSGlobalObject* globalObject, const JSC::EncodedJSValue* callbacks)
{
    auto& vm = JSC::getVM(globalObject);
    // Resolve the cached structure before allocateCell(): allocating any
    // JSCell between it and finishCreation() is not allowed, and the lazily
    // initialized structure allocates on first use.
    auto* structure = defaultGlobalObject(globalObject)->JSSocketHandlersStructure();
    auto* cell = new (NotNull, allocateCell<JSSocketHandlers>(vm)) JSSocketHandlers(vm, structure);
    cell->finishCreation(vm, callbacks);
    return cell;
}

} // namespace Bun

extern "C" JSC::EncodedJSValue Bun__SocketHandlers__create(JSC::JSGlobalObject* globalObject, const JSC::EncodedJSValue* callbacks)
{
    return JSC::JSValue::encode(Bun::JSSocketHandlers::create(globalObject, callbacks));
}

extern "C" JSC::EncodedJSValue Bun__SocketHandlers__getField(JSC::EncodedJSValue cellValue, uint32_t index)
{
    auto* cell = uncheckedDowncast<Bun::JSSocketHandlers>(JSC::JSValue::decode(cellValue).asCell());
    ASSERT(index < Bun::JSSocketHandlers::numberOfInternalFields);
    return JSC::JSValue::encode(cell->internalField(index).get());
}

extern "C" void Bun__SocketHandlers__setField(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue cellValue, uint32_t index, JSC::EncodedJSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    auto* cell = uncheckedDowncast<Bun::JSSocketHandlers>(JSC::JSValue::decode(cellValue).asCell());
    ASSERT(index < Bun::JSSocketHandlers::numberOfInternalFields);
    JSC::JSValue incoming = JSC::JSValue::decode(value);
    cell->internalField(index).set(vm, cell, incoming.isEmpty() ? JSC::jsUndefined() : incoming);
}

extern "C" void Bun__SocketHandlers__setCallbacks(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue cellValue, const JSC::EncodedJSValue* callbacks)
{
    auto& vm = JSC::getVM(globalObject);
    auto* cell = uncheckedDowncast<Bun::JSSocketHandlers>(JSC::JSValue::decode(cellValue).asCell());
    for (unsigned i = 0; i < Bun::JSSocketHandlers::numberOfCallbacks; i++) {
        JSC::JSValue value = JSC::JSValue::decode(callbacks[i]);
        cell->internalField(i).setWithoutWriteBarrier(value.isEmpty() ? JSC::jsUndefined() : value);
    }
    vm.writeBarrier(cell);
}
