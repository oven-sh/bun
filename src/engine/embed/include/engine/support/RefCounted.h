#pragma once

#include "engine/support/FastMalloc.h"
#include "engine/support/Noncopyable.h"

namespace WTF {

// An object starts with one reference, which adoptRef() takes.
template<typename T>
class RefCounted {
    WTF_MAKE_NONCOPYABLE(RefCounted);
    WTF_MAKE_TZONE_ALLOCATED(RefCounted);

public:
    void ref() const { RELEASE_ASSERT(++m_refCount); }

    void deref() const
    {
        ASSERT(m_refCount);
        // The count stays at one, so that the destructor can take references and give them back.
        if (m_refCount != 1) {
            --m_refCount;
            return;
        }
#if ENABLE(SECURITY_ASSERTIONS)
        m_deletionHasBegun = true;
#endif
        delete const_cast<T*>(static_cast<const T*>(this));
    }

    bool hasOneRef() const { return m_refCount == 1; }
    uint32_t refCount() const { return m_refCount; }

protected:
    RefCounted() = default;

    ~RefCounted()
    {
        ASSERT_WITH_SECURITY_IMPLICATION(m_deletionHasBegun);
        RELEASE_ASSERT(m_refCount == 1);
    }

private:
    mutable uint32_t m_refCount { 1 };
#if ENABLE(SECURITY_ASSERTIONS)
    mutable bool m_deletionHasBegun { false };
#endif
};

}

using WTF::RefCounted;
