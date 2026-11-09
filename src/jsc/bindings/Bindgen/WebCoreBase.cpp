#include "root.h"
#include "Bindgen/WebCoreBase.h"
#include "JSDOMGlobalObject.h"
#include "ScriptWrappableInlines.h"
#include <JavaScriptCore/Error.h>
#include <wtf/TZoneMallocInlines.h>

namespace Bun::Bindgen {

WTF_MAKE_TZONE_ALLOCATED_IMPL(EventTargetOfWrapper);

Ref<WebCore::EventTarget> createEventTarget(WebCore::JSDOMGlobalObject& globalObject)
{
    return EventTargetOfWrapper::create(*globalObject.scriptExecutionContext());
}

Ref<WebCore::Event> createEvent(EventInit init)
{
    WebCore::EventInit eventInit { init.bubbles, init.cancelable, init.composed };
    // An empty `bun_core::String` is a null `WTF::String`, which is not the type of any event.
    WTF::String type = init.type.transferToWTFString();
    return WebCore::Event::create(type.isNull() ? WTF::emptyAtom() : WTF::AtomString { type }, eventInit, init.isTrusted ? WebCore::Event::IsTrusted::Yes : WebCore::Event::IsTrusted::No);
}

Ref<WebCore::DOMException> createDOMException(DOMExceptionInit init)
{
    return WebCore::DOMException::create(init.message.transferToWTFString(), init.name.transferToWTFString());
}

void didCreateWrapper(WebCore::JSDOMGlobalObject&, WebCore::JSDOMObject& wrapper, WebCore::ScriptWrappable& wrapped)
{
    wrapped.setWrapper(&wrapper, nullptr, nullptr);
}

void didCreateWrapper(WebCore::JSDOMGlobalObject& globalObject, WebCore::JSDOMObject& wrapper, WebCore::DOMException&)
{
    JSC::addErrorInfo(&globalObject, &wrapper, true);
}

// `bindgen::dispatch_event`. False if a listener called `preventDefault()`.
extern "C" bool Bun__Bindgen__dispatchEvent(JSC::EncodedJSValue target, JSC::EncodedJSValue event)
{
    auto& eventTarget = uncheckedDowncast<WebCore::JSEventTarget>(JSC::JSValue::decode(target))->wrapped();
    auto& dispatched = uncheckedDowncast<WebCore::JSEvent>(JSC::JSValue::decode(event))->wrapped();
    eventTarget.dispatchEvent(dispatched);
    return !dispatched.defaultPrevented();
}

}
