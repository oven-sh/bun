#include "config.h"
#include "JSEventEmitterOnceWrapper.h"

#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMWrapperCache.h"
#include "JSEventEmitter.h"
#include "WebCoreJSClientData.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/NeverDestroyed.h>

namespace WebCore {
using namespace JSC;

// https://github.com/nodejs/node/blob/v26.3.0/lib/events.js#L625-L633
JSC_DEFINE_HOST_FUNCTION(JSEventEmitterOnceWrapper::call, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* wrapper = uncheckedDowncast<JSEventEmitterOnceWrapper>(callFrame->jsCallee());
    JSEventEmitter* emitter = wrapper->m_emitter.get();
    if (!emitter)
        return JSValue::encode(jsUndefined());

    auto eventType = wrapper->m_eventName.get().toPropertyKey(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    JSObject* target = wrapper->m_target.get();
    JSObject* listener = wrapper->m_listener.get();
    wrapper->m_emitter.clear();
    wrapper->m_target.clear();
    wrapper->m_eventName.clear();

    auto& impl = emitter->wrapped();
    // By value, as node does: the last registration of the wrapper, which is not always the one it was created for.
    impl.removeListener(eventType, *wrapper);

    // The `this` of the emit loop, so that a rawListeners() read does not change it. removeAllListeners() leaves the emitter with none.
    if (auto* current = impl.thisObject())
        target = current;
    auto callData = JSC::getCallData(listener);
    ASSERT(callData.type != CallData::Type::None);
    RELEASE_AND_RETURN(throwScope, JSValue::encode(JSC::call(lexicalGlobalObject, listener, callData, target ? JSValue(target) : jsUndefined(), ArgList(callFrame))));
}

const ClassInfo JSEventEmitterOnceWrapper::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSEventEmitterOnceWrapper) };

JSEventEmitterOnceWrapper::JSEventEmitterOnceWrapper(VM& vm, NativeExecutable* executable, JSGlobalObject* globalObject, Structure* structure)
    : Base(vm, executable, globalObject, structure)
{
}

JSObject* JSEventEmitterOnceWrapper::createPrototype(VM&, JSDOMGlobalObject& globalObject)
{
    return globalObject.functionPrototype();
}

JSC::GCClient::IsoSubspace* JSEventEmitterOnceWrapper::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSEventEmitterOnceWrapper, UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForEventEmitterOnceWrapper, m_subspaceForEventEmitterOnceWrapper));
}

JSEventEmitterOnceWrapper* JSEventEmitterOnceWrapper::create(VM& vm, JSDOMGlobalObject& globalObject, JSEventEmitter& emitter, JSObject* target, JSValue eventName, JSObject& listener)
{
    // The same name as the wrapper of the JS EventEmitter in node:events.
    static NeverDestroyed<const String> name(MAKE_STATIC_STRING_IMPL("onceWrapper"));
    NativeExecutable* executable = vm.getHostFunction(call, ImplementationVisibility::Public, callHostFunctionAsConstructor, 0, name);
    auto* structure = getDOMStructure<JSEventEmitterOnceWrapper>(vm, globalObject);
    auto* wrapper = new (NotNull, allocateCell<JSEventEmitterOnceWrapper>(vm)) JSEventEmitterOnceWrapper(vm, executable, &globalObject, structure);
    wrapper->finishCreation(vm, emitter, target, eventName, listener);
    return wrapper;
}

void JSEventEmitterOnceWrapper::finishCreation(VM& vm, JSEventEmitter& emitter, JSObject* target, JSValue eventName, JSObject& listener)
{
    Base::finishCreation(vm);
    m_emitter.set(vm, this, &emitter);
    m_target.setMayBeNull(vm, this, target);
    m_eventName.set(vm, this, eventName);
    m_listener.set(vm, this, &listener);
    putDirect(vm, WebCore::builtinNames(vm).listenerPublicName(), &listener, 0);
}

template<typename Visitor>
void JSEventEmitterOnceWrapper::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSEventEmitterOnceWrapper>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_emitter);
    visitor.append(thisObject->m_target);
    visitor.append(thisObject->m_eventName);
    visitor.append(thisObject->m_listener);
}

DEFINE_VISIT_CHILDREN(JSEventEmitterOnceWrapper);

} // namespace WebCore
