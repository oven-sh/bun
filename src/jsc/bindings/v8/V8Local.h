#pragma once

#include "root.h"

#include "shim/TaggedPointer.h"

namespace v8 {

template<class T>
class Local final {
public:
    Local()
        : m_location(nullptr)
    {
    }

    Local(TaggedPointer* slot)
        : m_location(slot)
    {
    }

    bool IsEmpty() const { return m_location == nullptr; }

    T* operator*() const { return reinterpret_cast<T*>(m_location); }
    T* operator->() const { return reinterpret_cast<T*>(m_location); }

    template<class U>
    Local<U> reinterpret() const
    {
        return Local<U>(m_location);
    }

    TaggedPointer& tagged() const
    {
        return *m_location;
    }

private:
    TaggedPointer* m_location;
};

} // namespace v8
