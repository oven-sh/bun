#pragma once

#include "engine/support/Noncopyable.h"
#include "engine/support/StdLibExtras.h"

namespace WTF {

template<typename Functor>
class ScopeExit final {
    WTF_MAKE_NONCOPYABLE(ScopeExit);

public:
    explicit ScopeExit(Functor&& functor)
        : m_functor(std::forward<Functor>(functor))
    {
    }

    ScopeExit(ScopeExit&& other)
        : m_functor(std::forward<Functor>(other.m_functor))
        , m_isArmed(std::exchange(other.m_isArmed, false))
    {
    }

    ~ScopeExit()
    {
        if (m_isArmed)
            m_functor();
    }

    void release() { m_isArmed = false; }

private:
    Functor m_functor;
    bool m_isArmed { true };
};

template<typename Functor>
[[nodiscard]] ScopeExit<Functor> makeScopeExit(Functor&& functor)
{
    return ScopeExit<Functor>(std::forward<Functor>(functor));
}

}

using WTF::makeScopeExit;
