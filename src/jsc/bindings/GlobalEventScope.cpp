#include "config.h"

#include "GlobalEventScope.h"
#include "MessagePort.h"
#include "ScriptExecutionContext.h"
#include "ZigGlobalObject.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(GlobalEventScope);

bool GlobalEventScope::addEventListener(const AtomString& eventType, Ref<EventListener>&& listener, const AddEventListenerOptions& options)
{
    if (!EventTarget::addEventListener(eventType, WTF::move(listener), options))
        return false;

    if (eventType == eventNames().messageEvent) {
        if (!m_messageEventCount)
            scriptExecutionContext()->refEventLoop();
        m_messageEventCount++;
    }
    return true;
}

bool GlobalEventScope::removeEventListener(const AtomString& eventType, EventListener& listener, const EventListenerOptions& options)
{
    if (!EventTarget::removeEventListener(eventType, listener, options))
        return false;

    if (eventType == eventNames().messageEvent) {
        m_messageEventCount--;
        if (!m_messageEventCount)
            scriptExecutionContext()->unrefEventLoop();
    }
    return true;
}

void GlobalEventScope::removeAllEventListeners()
{
    EventTarget::removeAllEventListeners();

    if (m_messageEventCount > 0)
        scriptExecutionContext()->unrefEventLoop();
    m_messageEventCount = 0;
}

}
