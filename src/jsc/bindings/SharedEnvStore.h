#pragma once

#include "root.h"
#include <wtf/HashMap.h>
#include <wtf/Lock.h>
#include <wtf/ThreadSafeRefCounted.h>
#include <wtf/text/StringHash.h>
#include <wtf/text/WTFString.h>

namespace Bun {

// worker_threads `env: SHARE_ENV`. Node shares the *creating thread's* KVStore by
// reference (node_worker.cc: `env_vars = env->env_vars()`), so disjoint SHARE_ENV
// chains stay isolated. Refcounted: threads in a tree die in any order.
class SharedEnvStore : public ThreadSafeRefCounted<SharedEnvStore> {
public:
    static Ref<SharedEnvStore> create() { return adoptRef(*new SharedEnvStore()); }

    String get(const String& key)
    {
        Locker locker { m_lock };
        auto it = m_map.find(normalizeKey(key));
        if (it == m_map.end())
            return String();
        return it->value.isolatedCopy();
    }

    void set(const String& key, const String& value)
    {
        Locker locker { m_lock };
        m_map.set(normalizeKey(key).isolatedCopy(), value.isolatedCopy());
    }

    void remove(const String& key)
    {
        Locker locker { m_lock };
        m_map.remove(normalizeKey(key));
    }

    Vector<String> keys()
    {
        Locker locker { m_lock };
        Vector<String> out;
        out.reserveInitialCapacity(m_map.size());
        for (const auto& key : m_map.keys())
            out.append(key.isolatedCopy());
        return out;
    }

    // Windows env keys are case-insensitive; match the regular env object's
    // OS(WINDOWS) behavior.
    static ALWAYS_INLINE String normalizeKey(const String& key)
    {
#if OS(WINDOWS)
        return key.convertToASCIIUppercase();
#else
        return key;
#endif
    }

private:
    SharedEnvStore() = default;

    Lock m_lock;
    HashMap<String, String> m_map WTF_GUARDED_BY_LOCK(m_lock);
};

} // namespace Bun
