#pragma once

#include "root.h"

#include "EventLoopKeepAlive.h"
#include "EventNames.h"
#include "EventTarget.h"
#include "ContextDestructionObserver.h"
#include "ExceptionOr.h"
#include <JavaScriptCore/Weak.h>
#include <wtf/URL.h>
#include <wtf/HashSet.h>
#include <wtf/Lock.h>

namespace WebCore {

class GlobalEventScope : public RefCounted<GlobalEventScope>, public EventTargetWithInlineData {
    WTF_MAKE_TZONE_ALLOCATED(GlobalEventScope);

    uint32_t m_messageEventCount { 0 };
    Bun::EventLoopKeepAlive m_keepAlive;
    // Weak: an event keeps the scope of its target, and that must not keep a global object alive.
    JSC::Weak<JSC::JSObject> m_globalThis;

    static void onDidChangeListenerImpl(EventTarget&, const AtomString&, OnDidChangeListenerKind);

public:
    GlobalEventScope()
        : EventTargetWithInlineData()
    {
        this->onDidChangeListener = &onDidChangeListenerImpl;
    }

    using RefCounted::deref;
    using RefCounted::ref;

    static Ref<GlobalEventScope> create()
    {
        return adoptRef(*new GlobalEventScope);
    }

    ~GlobalEventScope();

    EventTargetInterface eventTargetInterface() const final { return EventTargetInterface::DOMWindowEventTargetInterfaceType; }
    ScriptExecutionContext* scriptExecutionContext() const final { return m_context; }
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
    void eventListenersDidChange() final {}

    // The `globalThis` of the global object that owns this scope. Null once the collector finds that object dead.
    JSC::JSObject* globalThis() const;
    void setGlobalThis(JSC::JSObject*);

    ScriptExecutionContext* m_context { nullptr };
};

// `globalThis()`, or null. It reads neither global object that it is handed: the wrapper of an event can be of another realm than its target.
JSC::JSValue toJS(JSC::JSGlobalObject*, JSDOMGlobalObject*, GlobalEventScope&);
}
