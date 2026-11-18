#pragma once

#include "engine/support/Ref.h"
#include "engine/support/ThreadSafeRefCounted.h"

namespace WTF {

template<typename Result, typename... Arguments>
class SharedTask<Result(Arguments...)> : public ThreadSafeRefCounted<SharedTask<Result(Arguments...)>> {
public:
    virtual ~SharedTask() = default;
    virtual Result run(Arguments...) = 0;
};

namespace Detail {

template<typename Signature, typename Functor> class SharedTaskFunctor;

template<typename Result, typename... Arguments, typename Functor>
class SharedTaskFunctor<Result(Arguments...), Functor> final : public SharedTask<Result(Arguments...)> {
public:
    explicit SharedTaskFunctor(Functor&& functor)
        : m_functor(WTF::move(functor))
    {
    }

private:
    Result run(Arguments... arguments) final { return m_functor(std::forward<Arguments>(arguments)...); }

    Functor m_functor;
};

}

template<typename Signature, typename Functor>
Ref<SharedTask<Signature>> createSharedTask(Functor functor)
{
    return adoptRef(*new Detail::SharedTaskFunctor<Signature, Functor>(WTF::move(functor)));
}

}

using WTF::createSharedTask;
using WTF::SharedTask;
