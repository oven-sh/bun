#pragma once

#include "engine/support/FastMalloc.h"
#include "engine/support/Noncopyable.h"

extern "C" uintptr_t Support__ThreadKey__create(void (*destroy)(void*));
extern "C" void* Support__ThreadKey__get(uintptr_t key);
extern "C" void Support__ThreadKey__set(uintptr_t key, void* value);

namespace WTF {

// A value for each thread, from when the thread asks for it until it ends. It must never be destroyed itself.
template<typename T>
class ThreadSpecific {
    WTF_MAKE_NONCOPYABLE(ThreadSpecific);

public:
    ThreadSpecific() = default;
    ~ThreadSpecific() = delete;

    operator T*()
    {
        if (void* value = Support__ThreadKey__get(m_key))
            return static_cast<T*>(value);
        auto* value = ::new (NotNull, fastMalloc(sizeof(T))) T;
        Support__ThreadKey__set(m_key, value);
        return value;
    }

private:
    static void destroy(void* value)
    {
        static_cast<T*>(value)->~T();
        fastFree(value);
    }

    const uintptr_t m_key { Support__ThreadKey__create(destroy) };
};

}

using WTF::ThreadSpecific;
