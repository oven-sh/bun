#pragma once

#include "engine/support/FastMalloc.h"
#include "engine/support/Noncopyable.h"

namespace WTF {

// Gives a variable a value until the end of the scope.
template<typename T>
class SetForScope {
    WTF_MAKE_NONCOPYABLE(SetForScope);
    WTF_MAKE_TZONE_ALLOCATED(SetForScope);

public:
    template<typename U>
    SetForScope(T& variable, U&& value)
        : m_variable(variable)
        , m_oldValue(variable)
    {
        m_variable = std::forward<U>(value);
    }

    ~SetForScope() { m_variable = WTF::move(m_oldValue); }

private:
    T& m_variable;
    T m_oldValue;
};

}

using WTF::SetForScope;
