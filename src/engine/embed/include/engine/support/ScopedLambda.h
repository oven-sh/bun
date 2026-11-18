#pragma once

#include "engine/support/FastMalloc.h"
#include "engine/support/Forward.h"
#include "engine/support/Noncopyable.h"

namespace WTF {

// Refers to something to call, which has to outlive it.
template<typename Result, typename... Arguments>
class ScopedLambda<Result(Arguments...)> final {
    WTF_MAKE_NONMOVABLE(ScopedLambda);
    WTF_FORBID_HEAP_ALLOCATION;

public:
    template<Invocable<Result(Arguments...)> Functor>
        requires(!std::same_as<std::remove_cvref_t<Functor>, ScopedLambda>)
    ScopedLambda(Functor&& functor LIFETIME_BOUND)
        : m_call([](const void* functor, Arguments... arguments) -> Result {
            return static_cast<Result>((*static_cast<std::remove_reference_t<Functor>*>(const_cast<void*>(functor)))(std::forward<Arguments>(arguments)...));
        })
        , m_functor(std::addressof(functor))
    {
    }

    Result operator()(Arguments... arguments) const { return m_call(m_functor, std::forward<Arguments>(arguments)...); }

private:
    Result (*m_call)(const void*, Arguments...);
    const void* m_functor;
};

}

using WTF::ScopedLambda;
