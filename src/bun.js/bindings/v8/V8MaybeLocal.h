#pragma once

#include "V8Local.h"

namespace v8 {

template<class T>
class MaybeLocal {
public:
    MaybeLocal()
        : local_(Local<T>()) {};

    template<class S> MaybeLocal(Local<S> that)
        : local_(that)
    {
    }

    bool IsEmpty() const { return local_.IsEmpty(); }

private:
    Local<T> local_;
};

}
