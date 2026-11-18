#pragma once

#include "engine/support/FastMalloc.h"
#include "engine/support/Forward.h"

namespace WTF {

namespace Detail {

template<typename Result, typename... Arguments>
class CallableBase {
public:
    virtual Result call(Arguments...) = 0;
    virtual void destroy() = 0;
};

template<typename Functor, typename Result, typename... Arguments>
class Callable final : public CallableBase<Result, Arguments...> {
    WTF_MAKE_TZONE_ALLOCATED(Callable);

public:
    static Callable* create(Functor&& functor)
    {
        if constexpr (isStateless) {
            static constinit Callable shared { Functor() };
            return &shared;
        } else
            return new Callable(WTF::move(functor));
    }

private:
    static constexpr bool isStateless = std::is_empty_v<Functor> && std::is_trivially_default_constructible_v<Functor> && std::is_trivially_copyable_v<Functor>;

    constexpr explicit Callable(Functor&& functor)
        : m_functor(WTF::move(functor))
    {
    }

    Result call(Arguments... arguments) final { return m_functor(std::forward<Arguments>(arguments)...); }

    void destroy() final
    {
        if constexpr (!isStateless)
            delete this;
    }

    Functor m_functor;
};

template<typename T>
concept FunctionPointer = std::is_pointer_v<T> && std::is_function_v<std::remove_pointer_t<T>>;

template<typename T>
concept TemporaryFunctor = !FunctionPointer<T> && std::is_rvalue_reference_v<T&&>;

}

// Owns something to call. It moves and is never copied.
template<typename Result, typename... Arguments>
class TRIVIAL_ABI Function<Result(Arguments...)> {
    WTF_MAKE_TZONE_ALLOCATED(Function);

public:
    Function() = default;
    Function(std::nullptr_t) {}

    template<Detail::TemporaryFunctor Functor>
    Function(Functor&& functor)
        : m_callable(Detail::Callable<Functor, Result, Arguments...>::create(WTF::move(functor)))
    {
    }

    template<Detail::FunctionPointer Pointer>
    Function(Pointer function)
        : m_callable(Detail::Callable<Pointer, Result, Arguments...>::create(WTF::move(function)))
    {
    }

    Function(Function&& other)
        : m_callable(std::exchange(other.m_callable, nullptr))
    {
    }

    ~Function() { adopt(nullptr); }

    Function& operator=(Function&& other) { return adopt(std::exchange(other.m_callable, nullptr)); }
    Function& operator=(std::nullptr_t) { return adopt(nullptr); }
    template<Detail::TemporaryFunctor Functor> Function& operator=(Functor&& functor) { return *this = Function(WTF::move(functor)); }
    template<Detail::FunctionPointer Pointer> Function& operator=(Pointer function) { return *this = Function(function); }

    Result operator()(Arguments... arguments) const
    {
        ASSERT(m_callable);
        return m_callable->call(std::forward<Arguments>(arguments)...);
    }

    explicit operator bool() const { return m_callable; }

private:
    using Callable = Detail::CallableBase<Result, Arguments...>;

    Function& adopt(Callable* callable)
    {
        if (auto* old = std::exchange(m_callable, callable))
            old->destroy();
        return *this;
    }

    Callable* m_callable { nullptr };
};

}

using WTF::Function;
