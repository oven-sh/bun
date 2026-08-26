// Process-global subscriber map for BroadcastChannel.
//
// Unlike the WebKit design, which bounces every operation through the main
// thread, this registry is directly thread-safe: subscribe/unsubscribe/post
// take a single lock, and fan-out posts tasks straight to each subscriber's
// own context. There is no MainThreadBridge and no per-context registry —
// one singleton serves the whole process.

#pragma once

#include "ScriptExecutionContext.h"
#include <wtf/HashMap.h>
#include <wtf/Lock.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/ThreadSafeWeakPtr.h>
#include <wtf/Vector.h>
#include <wtf/text/StringHash.h>
#include <wtf/text/WTFString.h>

namespace WebCore {

class BroadcastChannel;
class SerializedScriptValue;

class BunBroadcastChannelRegistry {
public:
    static BunBroadcastChannelRegistry& singleton();

    void subscribe(const String& name, ScriptExecutionContextIdentifier, BroadcastChannel&);
    void unsubscribe(const String& name, BroadcastChannel&);
    void post(const String& name, BroadcastChannel& source, Ref<SerializedScriptValue>&&);

private:
    friend class WTF::NeverDestroyed<BunBroadcastChannelRegistry>;
    BunBroadcastChannelRegistry() = default;

    struct Subscriber {
        ScriptExecutionContextIdentifier ctxId;
        ThreadSafeWeakPtr<BroadcastChannel> channel;
        // Raw pointer used only for identity comparison under the lock;
        // never dereferenced.
        BroadcastChannel* identity;
    };

    WTF::Lock m_lock;
    HashMap<String, Vector<Subscriber>> m_subscribers WTF_GUARDED_BY_LOCK(m_lock);
};

} // namespace WebCore
