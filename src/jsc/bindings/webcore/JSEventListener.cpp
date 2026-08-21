/*
 *  Copyright (C) 2001 Peter Kelly (pmk@post.com)
 *  Copyright (C) 2003-2021 Apple Inc. All Rights Reserved.
 *
 *  This library is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU Lesser General Public
 *  License as published by the Free Software Foundation; either
 *  version 2 of the License, or (at your option) any later version.
 *
 *  This library is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 *  Lesser General Public License for more details.
 *
 *  You should have received a copy of the GNU Lesser General Public
 *  License along with this library; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

#include "config.h"
#include "JSEventListener.h"

#include "BunProcess.h"
#include "EventNames.h"
#include "JSDOMConvertNullable.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMGlobalObject.h"
// #include "JSDocument.h"
#include "JSEvent.h"
#include "JSEventTarget.h"
#include "WebCoreJSClientData.h"
// #include "JSExecState.h"
// #include "JSExecStateInstrumentation.h"
// #include "JSWorkerGlobalScope.h"
// #include "ScriptController.h"
// #include "WorkerGlobalScope.h"
#include <JavaScriptCore/ExceptionHelpers.h>
#include <JavaScriptCore/JSLock.h>
#include <JavaScriptCore/Watchdog.h>
#include <wtf/Ref.h>
#include <wtf/Scope.h>

namespace WebCore {
using namespace JSC;

JSEventListener::JSEventListener(JSObject* function, JSObject* wrapper, bool isAttribute, DOMWrapperWorld& isolatedWorld)
    : EventListener(JSEventListenerType)
    , m_isAttribute(isAttribute)
    , m_isInitialized(false)
    , m_wrapper(wrapper)
    , m_isolatedWorld(&isolatedWorld)
{
    if (function) {
        ASSERT(wrapper);
        m_jsFunction = JSC::Weak<JSC::JSObject>(function);
        m_isInitialized = true;
    }
    auto* clientData = WebCore::clientData(isolatedWorld.vm());
    if (clientData->isWorkerVM())
        clientData->addClient(*this);
}

JSEventListener::~JSEventListener()
{
    // Still linked ⇒ the VM is alive (its teardown unlinks before invalidating).
    if (isOnList())
        remove();
}

void JSEventListener::invalidate()
{
    m_jsFunction.clear();
    m_wrapper.clear();
    m_isInitialized = false;
    m_isolatedWorld = nullptr;
}

// ~JSVMClientData, after unlinking: the heap these handles point into is going.
void JSEventListener::willDestroyVM()
{
    invalidate();
}

Ref<JSEventListener> JSEventListener::create(JSC::JSObject& listener, JSC::JSObject& wrapper, bool isAttribute, DOMWrapperWorld& world)
{
    return adoptRef(*new JSEventListener(&listener, &wrapper, isAttribute, world));
}

JSObject* JSEventListener::initializeJSFunction(ScriptExecutionContext&) const
{
    return nullptr;
}

void JSEventListener::replaceJSFunctionForAttributeListener(JSObject* function, JSObject* wrapper)
{
    ASSERT(m_isAttribute);
    ASSERT(function);
    ASSERT(wrapper);

    m_jsFunction = Weak { function };
    if (m_isInitialized)
        ASSERT(m_wrapper.get() == wrapper);
    else {
        m_wrapper = Weak { wrapper };
        m_isInitialized = true;
    }
}

JSValue eventHandlerAttribute(EventTarget& eventTarget, const AtomString& eventType, DOMWrapperWorld& isolatedWorld)
{
    if (auto* jsListener = eventTarget.attributeEventListener(eventType, isolatedWorld)) {
        if (auto* context = eventTarget.scriptExecutionContext()) {
            if (auto* jsFunction = jsListener->ensureJSFunction(*context))
                return jsFunction;
        }
    }

    return jsNull();
}

template<typename Visitor>
inline void JSEventListener::visitJSFunctionImpl(Visitor& visitor)
{
    // If m_wrapper is null, we are not keeping m_jsFunction alive.
    if (!m_wrapper)
        return;

    visitor.append(m_jsFunction);
}

void JSEventListener::visitJSFunction(AbstractSlotVisitor& visitor) { visitJSFunctionImpl(visitor); }
void JSEventListener::visitJSFunction(SlotVisitor& visitor) { visitJSFunctionImpl(visitor); }

JSC_DEFINE_HOST_FUNCTION(jsFunctionEmitUncaughtException, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto exception = callFrame->argument(0);
    reportException(lexicalGlobalObject, exception);
    return JSValue::encode(JSC::jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(jsFunctionEmitUncaughtExceptionNextTick, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    Bun::Process* process = globalObject->processObject();
    auto exception = callFrame->argument(0);
    auto func = JSFunction::create(globalObject->vm(), globalObject, 1, String(), jsFunctionEmitUncaughtException, JSC::ImplementationVisibility::Private);
    process->queueNextTick(lexicalGlobalObject, func, exception);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

void JSEventListener::handleEvent(ScriptExecutionContext& scriptExecutionContext, Event& event)
{
    if (scriptExecutionContext.isJSExecutionForbidden())
        return;

    VM& vm = scriptExecutionContext.vm();
    JSLockHolder lock(vm);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // See https://dom.spec.whatwg.org/#dispatching-events spec on calling handleEvent.
    // "If this throws an exception, report the exception." It should not propagate the
    // exception.

    JSObject* jsFunction = ensureJSFunction(scriptExecutionContext);
    if (!jsFunction)
        return;

    if (!m_isolatedWorld) [[unlikely]]
        return;

    JSDOMGlobalObject* globalObject = toJSDOMGlobalObject(scriptExecutionContext, *m_isolatedWorld);
    if (!globalObject)
        return;

    JSGlobalObject* lexicalGlobalObject = jsFunction->globalObject();

    JSValue handleEventFunction = jsFunction;

    auto callData = getCallData(handleEventFunction);

    // If jsFunction is not actually a function and this is an EventListener, see if it implements callback interface.
    if (callData.type == CallData::Type::None) {
        if (m_isAttribute)
            return;

        handleEventFunction = jsFunction->get(lexicalGlobalObject, WebCore::builtinNames(vm).handleEventPublicName());
        if (scope.exception()) [[unlikely]] {
            auto* exception = scope.exception();
            (void)scope.tryClearException();
            event.target()->uncaughtExceptionInEventHandler();
            reportException(lexicalGlobalObject, exception);
            return;
        }
        callData = getCallData(handleEventFunction);
        if (callData.type == CallData::Type::None) {
            event.target()->uncaughtExceptionInEventHandler();
            reportException(lexicalGlobalObject, createTypeError(lexicalGlobalObject, "'handleEvent' property of event listener should be callable"_s));
            return;
        }
    }

    Ref<JSEventListener> protectedThis(*this);

    MarkedArgumentBuffer args;
    args.append(toJS(lexicalGlobalObject, globalObject, &event));
    ASSERT(!args.hasOverflowed());

    // JSExecState::instrumentFunction(&scriptExecutionContext, callData);

    JSValue thisValue = [&]() -> JSValue {
        if (handleEventFunction != jsFunction)
            return jsFunction;
        RefPtr currentTarget = event.currentTarget();
        if (!currentTarget)
            return jsNull();
        return toJS(lexicalGlobalObject, globalObject, *currentTarget);
    }();
    NakedPtr<JSC::Exception> uncaughtException;
    JSValue retval = JSC::profiledCall(lexicalGlobalObject, JSC::ProfilingReason::Other, handleEventFunction, callData, thisValue, args, uncaughtException);

    // InspectorInstrumentation::didCallFunction(&scriptExecutionContext);

    auto handleExceptionIfNeeded = [&](JSC::Exception* exception) -> bool {
        if (exception) {
            event.target()->uncaughtExceptionInEventHandler();
            reportException(lexicalGlobalObject, exception);
            return true;
        }
        return false;
    };

    if (handleExceptionIfNeeded(uncaughtException))
        return;

    // Node handles promises in the return value and throws an uncaught exception on nextTick if it rejects.
    // See event_target.js function addCatch in node
    if (retval.isObject()) {
        auto then = retval.get(lexicalGlobalObject, vm.propertyNames->then);
        if (scope.exception()) [[unlikely]] {
            auto* exception = scope.exception();
            (void)scope.tryClearException();
            event.target()->uncaughtExceptionInEventHandler();
            reportException(lexicalGlobalObject, exception);
            return;
        }
        if (then.isCallable()) {
            MarkedArgumentBuffer arglist;
            arglist.append(JSValue(JSC::jsUndefined()));
            arglist.append(JSValue(JSC::JSFunction::create(vm, lexicalGlobalObject, 1, String(), jsFunctionEmitUncaughtExceptionNextTick, ImplementationVisibility::Public, NoIntrinsic))); // err => process.nextTick(() => throw err)
            JSC::call(lexicalGlobalObject, then, retval, arglist, "Promise.then is not callable"_s);
            if (scope.exception()) [[unlikely]] {
                auto* exception = scope.exception();
                (void)scope.tryClearException();
                event.target()->uncaughtExceptionInEventHandler();
                reportException(lexicalGlobalObject, exception);
                return;
            }
        }
    }

    if (!m_isAttribute) {
        // This is an EventListener and there is therefore no need for any return value handling.
        return;
    }

    // Do return value handling for event handlers (https://html.spec.whatwg.org/#the-event-handler-processing-algorithm).

    if (retval.isFalse())
        event.preventDefault();
}

bool JSEventListener::operator==(const EventListener& listener) const
{
    if (!is<JSEventListener>(listener))
        return false;
    auto& other = downcast<JSEventListener>(listener);
    return m_jsFunction == other.m_jsFunction && m_isAttribute == other.m_isAttribute;
}

} // namespace WebCore
