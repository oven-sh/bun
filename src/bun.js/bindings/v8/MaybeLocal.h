#pragma once

#include "v8.h"
#include "v8/Local.h"

namespace v8 {

template<class T>
class MaybeLocal {
public:
    MaybeLocal()
        : local_(Local<T>(nullptr)) {};

    template<class S> MaybeLocal(Local<S> that)
        : local_(that)
    {
    }

    bool IsEmpty() const { return local_.IsEmpty(); }

private:
    Local<T> local_;
};

}
