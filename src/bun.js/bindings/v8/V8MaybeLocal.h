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

private:
    Local<T> m_local;
};

} // namespace v8
