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
    // `mainRooted` records whether the founding thread was the main thread. Node roots
    // a main-founded tree at its RealEnvStore, so *any* thread writing through the tree
    // reaches the OS environment; a tree founded by a snapshot worker never does.
    static Ref<SharedEnvStore> create(bool mainRooted) { return adoptRef(*new SharedEnvStore(mainRooted)); }
    bool isMainRooted() const { return m_mainRooted; }

    String get(const String& key)
    {
        Locker locker { m_lock };
        auto it = m_map.find(normalizeKey(key));
        if (it == m_map.end())
            return String();
        return it->value.value.isolatedCopy();
    }

    // Key on the normalized form, keep the case first written. `add` leaves an
    // existing entry's name alone (unlike `set`), so overwrites preserve the case.
    void set(const String& key, const String& value)
    {
        Locker locker { m_lock };
        String normalized = normalizeKey(key).isolatedCopy();
        auto result = m_map.add(normalized, Entry {});
        if (result.isNewEntry) {
#if OS(WINDOWS)
            result.iterator->value.name = key.isolatedCopy();
#else
            result.iterator->value.name = normalized;
#endif
        }
        result.iterator->value.value = value.isolatedCopy();
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
        for (const auto& entry : m_map.values())
            out.append(entry.name.isolatedCopy());
        return out;
    }

    // Windows env keys are case-insensitive. This follows bun's own Windows env
    // object, not node: node only folds case for a main-rooted tree (RealEnvStore),
    // and is case-sensitive for one rooted at a snapshot worker (MapKVStore).
    static ALWAYS_INLINE String normalizeKey(const String& key)
    {
#if OS(WINDOWS)
        return key.convertToASCIIUppercase();
#else
        return key;
#endif
    }

private:
    explicit SharedEnvStore(bool mainRooted)
        : m_mainRooted(mainRooted)
    {
    }

    const bool m_mainRooted;

    // `name` is the key as first written; on POSIX it always equals the map key.
    struct Entry {
        String name;
        String value;
    };

    Lock m_lock;
    HashMap<String, Entry> m_map WTF_GUARDED_BY_LOCK(m_lock);
};

} // namespace Bun
