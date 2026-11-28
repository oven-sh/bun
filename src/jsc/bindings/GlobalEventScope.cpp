#include "config.h"

#include "GlobalEventScope.h"
#include "MessagePort.h"
#include "ScriptExecutionContext.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/WeakInlines.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(GlobalEventScope);

GlobalEventScope::~GlobalEventScope() = default;

JSC::JSObject* GlobalEventScope::globalThis() const
{
    return m_globalThis.get();
}

void GlobalEventScope::setGlobalThis(JSC::JSObject* globalThis)
{
    m_globalThis = JSC::Weak<JSC::JSObject>(globalThis);
}

JSC::JSValue toJS(JSC::JSGlobalObject*, JSDOMGlobalObject*, GlobalEventScope& scope)
{
    if (auto* globalThis = scope.globalThis())
        return globalThis;
    return JSC::jsNull();
}

void GlobalEventScope::onDidChangeListenerImpl(EventTarget& self, const AtomString& eventType, OnDidChangeListenerKind kind)
{
    if (eventType == eventNames().messageEvent) {
        auto& global = static_cast<GlobalEventScope&>(self);
        switch (kind) {
        case Add:
            global.m_messageEventCount++;
            break;
        case Remove:
            global.m_messageEventCount--;
            break;
        case Clear:
            global.m_messageEventCount = 0;
            break;
        }
        global.m_keepAlive.setActive(global.m_messageEventCount > 0);
    }
};

}
