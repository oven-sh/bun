#pragma once

#include "EventNames.h"
#include "JSDOMCastThisValue.h"
#include "JSEventListener.h"
#include "JSEventTarget.h"

namespace WebCore {

// The accessors of the event handler IDL attributes (`onclick`) are alike but for the type of the event, and an interface with GlobalEventHandlers has 200 of them.
// The generator prints the whole work into each. In Bun each one only calls the function here that does the work for its kind,
// with the event's member of EventNames as an argument. The work is the generator's, line by line.

using EventTypeMember = const AtomString EventNames::*;

// The handler listens on the object that has the attribute. JSWindowEventHandlerAttribute.h has the kind that listens on the window.
struct OwnEventHandlerAttribute {
    using Wrapper = JSEventTarget;

    static JSC::JSValue get(EventTarget& target, const AtomString& eventType, DOMWrapperWorld& world) { return eventHandlerAttribute(target, eventType, world); }

    template<typename Listener>
    static void set(EventTarget& target, const AtomString& eventType, JSC::JSValue value, JSC::JSObject& wrapper) { setEventHandlerAttribute<Listener>(target, eventType, value, wrapper); }
};

namespace Detail {

// JSC has tested the receiver: these are getters of rows with PropertyAttribute::DOMAttribute (CastedThisErrorBehavior::Assert in the generator's text).
template<typename Kind>
NEVER_INLINE JSC::EncodedJSValue eventHandlerAttributeGetter(JSC::EncodedJSValue thisValue, EventTypeMember eventType)
{
    auto& thisObject = *uncheckedDowncast<typename Kind::Wrapper>(JSC::JSValue::decode(thisValue));
    return JSC::JSValue::encode(Kind::get(protect(thisObject.wrapped()), eventNames().*eventType, protect(worldForDOMObject(thisObject))));
}

// [LegacyLenientThis]
template<typename Kind>
NEVER_INLINE JSC::EncodedJSValue lenientEventHandlerAttributeGetter(JSC::EncodedJSValue thisValue, const JSC::ClassInfo* classInfo, EventTypeMember eventType)
{
    if (!JSC::JSValue::decode(thisValue).inherits(classInfo)) [[unlikely]]
        return JSC::JSValue::encode(JSC::jsUndefined());
    return eventHandlerAttributeGetter<Kind>(thisValue, eventType);
}

template<typename Kind, typename Listener, CastedThisErrorBehavior shouldThrow>
NEVER_INLINE bool eventHandlerAttributeSetter(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName attributeName, const JSC::ClassInfo* classInfo, EventTypeMember eventType)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (!JSC::JSValue::decode(thisValue).inherits(classInfo)) [[unlikely]] {
        if constexpr (shouldThrow == CastedThisErrorBehavior::Throw)
            return JSC::throwVMDOMAttributeSetterTypeError(lexicalGlobalObject, throwScope, classInfo, attributeName);
        else
            return false;
    }

    auto& thisObject = *uncheckedDowncast<typename Kind::Wrapper>(JSC::JSValue::decode(thisValue));
    auto value = JSC::JSValue::decode(encodedValue);
    Kind::template set<Listener>(protect(thisObject.wrapped()), eventNames().*eventType, value, thisObject);
    vm.writeBarrier(&thisObject, value);
    ensureStillAliveHere(value);

    return true;
}

} // namespace Detail

template<typename JSClass, typename Kind, CastedThisErrorBehavior shouldThrow>
ALWAYS_INLINE JSC::EncodedJSValue eventHandlerAttributeGetter(JSC::EncodedJSValue thisValue, EventTypeMember eventType)
{
    static_assert(std::is_base_of_v<typename Kind::Wrapper, JSClass>);
    static_assert(shouldThrow == CastedThisErrorBehavior::Assert || shouldThrow == CastedThisErrorBehavior::ReturnEarly);
    if constexpr (shouldThrow == CastedThisErrorBehavior::Assert) {
        ASSERT(JSC::JSValue::decode(thisValue).inherits(JSClass::info()));
        return Detail::eventHandlerAttributeGetter<Kind>(thisValue, eventType);
    } else
        return Detail::lenientEventHandlerAttributeGetter<Kind>(thisValue, JSClass::info(), eventType);
}

template<typename JSClass, typename Kind, typename Listener, CastedThisErrorBehavior shouldThrow>
ALWAYS_INLINE bool eventHandlerAttributeSetter(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue thisValue, JSC::EncodedJSValue encodedValue, JSC::PropertyName attributeName, EventTypeMember eventType)
{
    static_assert(std::is_base_of_v<typename Kind::Wrapper, JSClass>);
    static_assert(shouldThrow == CastedThisErrorBehavior::Throw || shouldThrow == CastedThisErrorBehavior::ReturnEarly);
    return Detail::eventHandlerAttributeSetter<Kind, Listener, shouldThrow>(lexicalGlobalObject, thisValue, encodedValue, attributeName, JSClass::info(), eventType);
}

} // namespace WebCore
