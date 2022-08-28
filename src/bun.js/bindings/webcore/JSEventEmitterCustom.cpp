#include "config.h"
#include "JSEventEmitter.h"

#include "EventEmitter.h"
#include "JSDOMWrapperCache.h"
#include "JSEventListener.h"

namespace WebCore {
using namespace JSC;

JSValue toJSNewlyCreated(JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<EventEmitter>&& value)
{
    return createWrapper<EventEmitter>(globalObject, WTFMove(value));
}

EventEmitter* JSEventEmitter::toWrapped(VM& vm, JSValue value)
{
    if (value.inherits<JSEventEmitter>())
        return &jsCast<JSEventEmitter*>(asObject(value))->wrapped();
    return nullptr;
}

std::unique_ptr<JSEventEmitterWrapper> jsEventEmitterCast(VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSValue thisValue)
{
    if (auto* target = jsDynamicCast<JSEventEmitter*>(thisValue))
        return makeUnique<JSEventEmitterWrapper>(target->wrapped(), *target);
    if (auto* object = jsDynamicCast<JSNonFinalObject*>(thisValue)) {
        // need to create a EventEmitter for Object.
        // use `mapPrivateName` as it is not occupied.
        auto emitterTag = WebCore::clientData(vm)->builtinNames().mapPrivateName();
        JSC::JSValue value = object->getDirect(vm, emitterTag);
        if (!value) {
            Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
            value = WebCore::toJSNewlyCreated(lexicalGlobalObject, globalObject, EventEmitter::create(*globalObject->scriptExecutionContext()));
            object->putDirect(vm, emitterTag, value);
        }
        auto* target = jsCast<JSEventEmitter*>(value);
        return makeUnique<JSEventEmitterWrapper>(target->wrapped(), *target);
    }

    return nullptr;
}

template<typename Visitor>
void JSEventEmitter::visitAdditionalChildren(Visitor& visitor)
{
    wrapped().eventListenerMap().visitJSEventListeners(visitor);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN(JSEventEmitter);

} // namespace WebCore
