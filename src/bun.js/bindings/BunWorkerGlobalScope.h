#include "root.h"

#include "EventTarget.h"
#include "ContextDestructionObserver.h"
#include "ExceptionOr.h"
#include <wtf/URL.h>
#include <wtf/HashSet.h>
#include <wtf/Lock.h>

namespace Bun {
class GlobalScope final : public RefCounted<GlobalScope>, public EventTargetWithInlineData {
    WTF_MAKE_ISO_ALLOCATED(GlobalScope);

public:
    GlobalScope(ScriptExecutionContext* context)
        : EventTargetWithInlineData()
        , m_context(context)
    {
    }
    using RefCounted::deref;
    using RefCounted::ref;

    static Ref<GlobalScope> create(ScriptExecutionContext* context)
    {
        return adoptRef(*new GlobalScope(context));
    }

    ~GlobalScope() = default;

    EventTargetInterface eventTargetInterface() const final { return EventTargetInterface::DOMWindowEventTargetInterfaceType; }
    ScriptExecutionContext* scriptExecutionContext() const final { return m_context; }
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }
    void eventListenersDidChange() final {}

    ScriptExecutionContext* m_context;
};
}