#include "config.h"
#include "JSEventEmitter.h"

#include "EventEmitter.h"
#include "JSDOMWrapperCache.h"
#include "JSEventListener.h"
#include "ZigGlobalObject.h"

#include "JSDOMConstructor.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertBoolean.h"
#include "JSDOMConvertDictionary.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertNullable.h"
#include "JSDOMConvertNumbers.h"
#include "JSDOMConvertSequences.h"
#include "JSDOMConvertStrings.h"
#include "BunClientData.h"

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
    if (auto* emitter = jsEventEmitterCastFast(vm, lexicalGlobalObject, thisValue)) {
        return std::make_unique<JSEventEmitterWrapper>(emitter->wrapped(), asObject(thisValue));
    }

    return nullptr;
}

JSEventEmitter* jsEventEmitterCastFast(VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSValue thisValue)
{
    if (!thisValue.isCell()) [[unlikely]] {
        return nullptr;
    }

    JSCell* thisCell = thisValue.asCell();
    if (!thisCell->isObject()) [[unlikely]] {
        return nullptr;
    }

    auto* thisObject = asObject(thisCell);

    if (thisObject->inherits<JSEventEmitter>())
        return jsCast<JSEventEmitter*>(thisObject);

    auto clientData = WebCore::clientData(vm);
    auto name = clientData->builtinNames()._eventsPublicName();
    if (JSValue _events = thisObject->getIfPropertyExists(lexicalGlobalObject, name)) {
        if (_events.isCell() && _events.inherits<JSEventEmitter>()) {
            return jsCast<JSEventEmitter*>(asObject(_events));
        }
    }

    auto scope = DECLARE_CATCH_SCOPE(vm);
    auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto impl = EventEmitter::create(*globalObject->scriptExecutionContext());
    impl->setThisObject(thisObject);

    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto result = toJSNewlyCreated<IDLInterface<EventEmitter>>(*lexicalGlobalObject, *globalObject, throwScope, WTFMove(impl));

    thisObject->putDirect(vm, name, result, 0);

    if (scope.exception()) {
        scope.clearException();
        return nullptr;
    }

    RETURN_IF_EXCEPTION(throwScope, nullptr);

    return jsCast<JSEventEmitter*>(asObject(result));
}

template<typename Visitor>
void JSEventEmitter::visitAdditionalChildren(Visitor& visitor)
{
    wrapped().eventListenerMap().visitJSEventListeners(visitor);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN(JSEventEmitter);

} // namespace WebCore
