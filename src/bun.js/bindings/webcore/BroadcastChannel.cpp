#include "config.h"
#include "BroadcastChannel.h"

#include "BunBroadcastChannelRegistry.h"
#include "BunClientData.h"
#include "EventNames.h"
#include "MessageEvent.h"
#include "SerializedScriptValue.h"
#include <wtf/TZoneMallocInlines.h>

extern "C" void Bun__eventLoop__incrementRefConcurrently(void* bunVM, int delta);

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(BroadcastChannel);

BroadcastChannel::BroadcastChannel(ScriptExecutionContext& context, const String& name)
    : ContextDestructionObserver(&context)
    , m_name(name.isolatedCopy())
    , m_contextId(context.identifier())
{
    initializeWeakPtrFactory();
    BunBroadcastChannelRegistry::singleton().subscribe(m_name, m_contextId, *this);
    jsRef(context.jsGlobalObject());
}

BroadcastChannel::~BroadcastChannel()
{
    close();
}

ExceptionOr<void> BroadcastChannel::postMessage(JSC::JSGlobalObject& globalObject, JSC::JSValue messageValue)
{
    if (isClosed())
        return Exception { InvalidStateError, "This BroadcastChannel is closed"_s };

    Vector<RefPtr<MessagePort>> dummyPorts;
    auto serialized = SerializedScriptValue::create(globalObject, messageValue, {}, dummyPorts, SerializationForStorage::No, SerializationContext::WorkerPostMessage);
    if (serialized.hasException())
        return serialized.releaseException();
    ASSERT(dummyPorts.isEmpty());

    BunBroadcastChannelRegistry::singleton().post(m_name, *this, serialized.releaseReturnValue());
    return {};
}

void BroadcastChannel::dispatchMessage(Ref<SerializedScriptValue>&& message)
{
    // Balance the queued count bumped by the registry at post time; do it
    // first so that if we bail (closed / no context) the channel can still
    // become collectable.
    m_state.fetch_sub(QueuedOne, std::memory_order_acq_rel);

    if (isClosed())
        return;

    auto* context = scriptExecutionContext();
    if (!context || !context->globalObject())
        return;
    ASSERT(context->isContextThread());

    auto* globalObject = context->jsGlobalObject();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    Vector<RefPtr<MessagePort>> dummyPorts;
    auto event = MessageEvent::create(*globalObject, WTF::move(message), {}, {}, nullptr, WTF::move(dummyPorts));
    if (scope.exception()) [[unlikely]] {
        RELEASE_ASSERT(vm.hasPendingTerminationException());
        return;
    }
    dispatchEvent(event.event);
}

void BroadcastChannel::close()
{
    uint64_t prev = m_state.fetch_or(Closed, std::memory_order_acq_rel);
    if (prev & Closed)
        return;
    BunBroadcastChannelRegistry::singleton().unsubscribe(m_name, *this);
}

void BroadcastChannel::contextDestroyed()
{
    close();
}

void BroadcastChannel::eventListenersDidChange()
{
    m_hasRelevantEventListener = hasEventListeners(eventNames().messageEvent);
}

bool BroadcastChannel::hasPendingActivity() const
{
    uint64_t s = m_state.load(std::memory_order_acquire);
    if (s & Closed)
        return false;
    return m_hasRelevantEventListener || (s >> QueuedShift) > 0;
}

void BroadcastChannel::jsRef(JSGlobalObject* lexicalGlobalObject)
{
    if (!m_hasRef) {
        m_hasRef = true;
        Bun__eventLoop__incrementRefConcurrently(WebCore::clientData(lexicalGlobalObject->vm())->bunVM, 1);
    }
}

void BroadcastChannel::jsUnref(JSGlobalObject* lexicalGlobalObject)
{
    if (m_hasRef) {
        m_hasRef = false;
        Bun__eventLoop__incrementRefConcurrently(WebCore::clientData(lexicalGlobalObject->vm())->bunVM, -1);
    }
}

} // namespace WebCore
