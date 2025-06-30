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
    bool ToLocal(Local<T>* out) const {
        if (IsEmpty()) {
            return false;
        }
        *out = m_local;
        return true;
    }
    
    // Get the Local<T> value (should only be called if not empty)
    Local<T> ToLocalChecked() const {
        return m_local;
    }

private:
    Local<T> m_local;
};

} // namespace v8
