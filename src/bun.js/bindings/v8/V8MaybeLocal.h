#pragma once

#include "V8Local.h"

namespace v8 {

template<class T>
class MaybeLocal {
public:
    MaybeLocal()
        : m_local(Local<T>()) {};

    template<class S> MaybeLocal(Local<S> that)
        : m_local(that)
    {
    }

    bool IsEmpty() const { return m_local.IsEmpty(); }

    // Extract the Local<T> value if not empty
    bool ToLocal(Local<T>* out) const
    {
        if (IsEmpty()) {
            *out = nullptr; // V8 assigns nullptr when empty
            return false;
        }
        *out = m_local;
        return true;
    }

private:
    Local<T> m_local;
};

} // namespace v8
