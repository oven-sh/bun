#include "config.h"
#include "BunWebLocksRegistry.h"

#include "BunClientData.h"
#include "InternalModuleRegistry.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSObject.h>
#include <wtf/Locker.h>
#include <wtf/NeverDestroyed.h>

namespace WebCore {

std::atomic<bool> BunWebLocksRegistry::s_hasBeenUsed { false };

BunWebLocksRegistry& BunWebLocksRegistry::singleton()
{
    static NeverDestroyed<BunWebLocksRegistry> registry;
    return registry.get();
}

uint64_t BunWebLocksRegistry::enqueue(ScriptExecutionContextIdentifier contextId, const String& name, bool exclusive, bool steal, bool ifAvailable)
{
    s_hasBeenUsed.store(true, std::memory_order_release);
    uint64_t id = m_nextId.fetch_add(1, std::memory_order_relaxed);
    PendingRequest request { id, contextId, name.isolatedCopy(), exclusive, steal, ifAvailable };
    Locker locker { m_lock };
    // Steal requests are processed ahead of every queued request.
    if (steal)
        m_pending.insert(0, WTF::move(request));
    else
        m_pending.append(WTF::move(request));
    return id;
}

void BunWebLocksRegistry::release(ScriptExecutionContextIdentifier contextId, uint64_t id, const String& name)
{
    Locker locker { m_lock };
    auto it = m_held.find(name);
    if (it == m_held.end())
        return;
    it->value.removeAllMatching([&](auto& lock) {
        return lock.id == id && lock.contextId == contextId;
    });
    if (it->value.isEmpty())
        m_held.remove(it);
}

bool BunWebLocksRegistry::isGrantableLocked(const PendingRequest& request) const
{
    auto it = m_held.find(request.name);
    if (it == m_held.end())
        return true;
    if (request.exclusive)
        return false;
    for (auto& held : it->value) {
        if (held.exclusive)
            return false;
    }
    return true;
}

void BunWebLocksRegistry::commitGrantLocked(size_t pendingIndex, Vector<Event>& events)
{
    PendingRequest request = WTF::move(m_pending[pendingIndex]);
    m_pending.removeAt(pendingIndex);
    m_held.ensure(request.name, [] { return Vector<HeldLock>(); }).iterator->value.append(HeldLock { request.id, request.contextId, request.exclusive });
    events.append(Event { GrantedEvent, request.id });
}

// One pass of the Web Locks grant algorithm (https://w3c.github.io/web-locks/#algorithms),
// mirroring Node's LockManager::ProcessQueue: requests are scanned in queue
// order, a request must wait behind an earlier incompatible request for the
// same name, and only requests belonging to `self` produce a decision here.
bool BunWebLocksRegistry::takeDecisionLocked(ScriptExecutionContextIdentifier self, Vector<Event>& events)
{
    HashMap<String, size_t> firstSeenForName;
    for (size_t i = 0; i < m_pending.size(); i++) {
        auto& request = m_pending[i];
        auto firstSeen = firstSeenForName.ensure(request.name, [&] { return i; });
        bool hasEarlier = firstSeen.iterator->value != i;
        bool mustWait = hasEarlier && (request.exclusive || m_pending[firstSeen.iterator->value].exclusive);

        if (request.contextId != self)
            continue;

        if (request.steal) {
            // Steal bypasses the granting rules: every current holder loses
            // its lock. Holders on this thread get their Stolen event before
            // the grant below; holders on other threads are notified on
            // their own thread via m_stolenToDeliver.
            auto victims = m_held.take(request.name);
            for (auto& victim : victims) {
                if (victim.contextId == self)
                    events.append(Event { StolenEvent, victim.id });
                else
                    m_stolenToDeliver.ensure(victim.contextId, [] { return Vector<uint64_t>(); }).iterator->value.append(victim.id);
            }
            commitGrantLocked(i, events);
            return true;
        }

        if (mustWait || !isGrantableLocked(request)) {
            if (request.ifAvailable) {
                Event event { MissEvent, request.id };
                m_pending.removeAt(i);
                events.append(event);
                return true;
            }
            continue;
        }

        commitGrantLocked(i, events);
        return true;
    }
    return false;
}

// Contexts that could make progress right now: anything with an undelivered
// steal notification, or a pending request that is currently decidable
// (grantable, or an ifAvailable request that would miss).
Vector<ScriptExecutionContextIdentifier> BunWebLocksRegistry::computeWakeTargetsLocked()
{
    HashSet<ScriptExecutionContextIdentifier> targets;
    for (auto& contextId : m_stolenToDeliver.keys())
        targets.add(contextId);

    HashMap<String, size_t> firstSeenForName;
    for (size_t i = 0; i < m_pending.size(); i++) {
        auto& request = m_pending[i];
        auto firstSeen = firstSeenForName.ensure(request.name, [&] { return i; });
        bool hasEarlier = firstSeen.iterator->value != i;
        bool mustWait = hasEarlier && (request.exclusive || m_pending[firstSeen.iterator->value].exclusive);
        bool decidable = request.steal || ((mustWait || !isGrantableLocked(request)) ? request.ifAvailable : true);
        if (decidable)
            targets.add(request.contextId);
    }

    Vector<ScriptExecutionContextIdentifier> result;
    result.reserveInitialCapacity(targets.size());
    for (auto& contextId : targets)
        result.append(contextId);
    return result;
}

void BunWebLocksRegistry::purgeContextLocked(ScriptExecutionContextIdentifier contextId)
{
    m_pending.removeAllMatching([&](auto& request) { return request.contextId == contextId; });
    m_held.removeIf([&](auto& entry) {
        entry.value.removeAllMatching([&](auto& lock) { return lock.contextId == contextId; });
        return entry.value.isEmpty();
    });
    m_stolenToDeliver.remove(contextId);
}

void BunWebLocksRegistry::wakeContexts(Vector<ScriptExecutionContextIdentifier>&& initial)
{
    Vector<ScriptExecutionContextIdentifier> queue = WTF::move(initial);
    HashSet<ScriptExecutionContextIdentifier> attempted;
    while (!queue.isEmpty()) {
        auto contextId = queue.takeLast();
        if (!attempted.add(contextId).isNewEntry)
            continue;
        bool posted = ScriptExecutionContext::postTaskTo(contextId, [](ScriptExecutionContext& context) {
            BunWebLocksRegistry::singleton().drain(context.jsGlobalObject());
        });
        if (posted)
            continue;
        // The context is gone (or terminating): nothing will ever process its
        // entries, so drop them now and wake whoever that unblocks.
        Vector<ScriptExecutionContextIdentifier> next;
        {
            Locker locker { m_lock };
            purgeContextLocked(contextId);
            next = computeWakeTargetsLocked();
        }
        for (auto& id : next) {
            if (!attempted.contains(id))
                queue.append(id);
        }
    }
}

bool BunWebLocksRegistry::dispatchEventsToJS(Zig::GlobalObject* globalObject, const Vector<Event>& events)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* moduleObject = globalObject->internalModuleRegistry()->requireId(globalObject, vm, Bun::InternalModuleRegistry::InternalLocks).getObject();
    RETURN_IF_EXCEPTION(scope, false);
    if (!moduleObject) [[unlikely]]
        return false;
    JSC::JSValue handler = moduleObject->get(globalObject, WebCore::clientData(vm)->builtinNames().onNativeEventPublicName());
    RETURN_IF_EXCEPTION(scope, false);

    for (auto& event : events) {
        JSC::MarkedArgumentBuffer args;
        args.append(JSC::jsNumber(event.type));
        args.append(JSC::jsNumber(static_cast<double>(event.id)));
        ASSERT(!args.hasOverflowed());
        JSC::call(globalObject, handler, args, "BunWebLocksRegistry event handler"_s);
        RETURN_IF_EXCEPTION(scope, false);
    }
    return true;
}

void BunWebLocksRegistry::drain(JSC::JSGlobalObject* lexicalGlobalObject)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* context = globalObject->scriptExecutionContext();
    if (!context)
        return;
    ASSERT(context->isContextThread());
    auto self = context->identifier();

    // Dispatch one decision at a time with the lock released: the JS side
    // runs user callbacks synchronously and may re-enter enqueue/release.
    while (true) {
        Vector<Event> events;
        {
            Locker locker { m_lock };
            auto stolen = m_stolenToDeliver.take(self);
            for (auto id : stolen)
                events.append(Event { StolenEvent, id });
            takeDecisionLocked(self, events);
        }
        if (events.isEmpty())
            break;
        if (!dispatchEventsToJS(globalObject, events))
            break;
    }

    Vector<ScriptExecutionContextIdentifier> targets;
    {
        Locker locker { m_lock };
        targets = computeWakeTargetsLocked();
    }
    wakeContexts(WTF::move(targets));
}

void BunWebLocksRegistry::contextDestroyed(ScriptExecutionContextIdentifier contextId)
{
    if (!s_hasBeenUsed.load(std::memory_order_acquire))
        return;
    auto& registry = singleton();
    Vector<ScriptExecutionContextIdentifier> targets;
    {
        Locker locker { registry.m_lock };
        registry.purgeContextLocked(contextId);
        targets = registry.computeWakeTargetsLocked();
    }
    registry.wakeContexts(WTF::move(targets));
}

} // namespace WebCore

namespace Bun {

using namespace JSC;
using namespace WebCore;

// enqueue(name: string, exclusive: boolean, steal: boolean, ifAvailable: boolean) -> request id
JSC_DEFINE_HOST_FUNCTION(jsWebLocksEnqueueRequest, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* context = defaultGlobalObject(globalObject)->scriptExecutionContext();
    if (!context) [[unlikely]]
        return JSValue::encode(jsNumber(0));

    String name = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    bool exclusive = callFrame->argument(1).toBoolean(globalObject);
    bool steal = callFrame->argument(2).toBoolean(globalObject);
    bool ifAvailable = callFrame->argument(3).toBoolean(globalObject);

    uint64_t id = BunWebLocksRegistry::singleton().enqueue(context->identifier(), name, exclusive, steal, ifAvailable);
    return JSValue::encode(jsNumber(static_cast<double>(id)));
}

// drain() — deliver pending events for this thread synchronously
JSC_DEFINE_HOST_FUNCTION(jsWebLocksDrain, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    BunWebLocksRegistry::singleton().drain(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

// release(id: number, name: string)
JSC_DEFINE_HOST_FUNCTION(jsWebLocksRelease, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* context = defaultGlobalObject(globalObject)->scriptExecutionContext();
    if (!context) [[unlikely]]
        return JSValue::encode(jsUndefined());

    uint64_t id = static_cast<uint64_t>(callFrame->argument(0).toNumber(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    String name = callFrame->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto& registry = BunWebLocksRegistry::singleton();
    registry.release(context->identifier(), id, name);
    registry.drain(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

} // namespace Bun
