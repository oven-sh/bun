#pragma once

#include "engine/support/Assertions.h"
#include "engine/support/Forward.h"

namespace WTF {

// A raw pointer that starts as null.
template<typename T>
class NakedPtr {
public:
    NakedPtr() {}
    NakedPtr(T* pointer)
        : m_ptr(pointer)
    {
    }

    T* get() const { return m_ptr; }
    T* operator->() const { return m_ptr; }
    T& operator*() const
    {
        ASSERT(m_ptr);
        return *m_ptr;
    }
    operator T*() { return m_ptr; }

    explicit operator bool() const { return m_ptr; }
    bool operator!() const { return !m_ptr; }

    void clear() { m_ptr = nullptr; }

private:
    T* m_ptr { nullptr };
};

}

using WTF::NakedPtr;
