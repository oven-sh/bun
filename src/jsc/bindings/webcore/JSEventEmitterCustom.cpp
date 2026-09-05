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
    return createWrapper<EventEmitter>(globalObject, WTF::move(value));
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
        return uncheckedDowncast<JSEventEmitter>(thisObject);

    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto clientData = WebCore::clientData(vm);
    auto name = clientData->builtinNames()._eventsPublicName();
    JSValue _events = thisObject->get(lexicalGlobalObject, name);
    RETURN_IF_EXCEPTION(throwScope, nullptr);
    if (_events.inherits<JSEventEmitter>()) {
        return uncheckedDowncast<JSEventEmitter>(asObject(_events));
    }

    auto* globalObject = static_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto impl = EventEmitter::create(*globalObject->scriptExecutionContext());
    impl->setThisObject(thisObject);

    auto result = toJSNewlyCreated<IDLInterface<EventEmitter>>(*lexicalGlobalObject, *globalObject, throwScope, WTF::move(impl));
    RETURN_IF_EXCEPTION(throwScope, nullptr);

    thisObject->putDirect(vm, name, result, 0);

    return uncheckedDowncast<JSEventEmitter>(asObject(result));
}

template<typename Visitor>
void JSEventEmitter::visitAdditionalChildrenInGCThread(Visitor& visitor)
{
    wrapped().eventListenerMap().visitJSEventListeners(visitor);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(JSEventEmitter);

} // namespace WebCore
