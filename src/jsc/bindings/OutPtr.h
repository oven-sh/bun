#pragma once

#include "root.h"

namespace Bun {

// std::out_ptr, which libstdc++ 13 lacks: the owner gets what a C function wrote to `T**`, at the end of the statement.
template<typename Owner>
class OutPtr {
    WTF_MAKE_NONCOPYABLE(OutPtr);

public:
    using Pointer = decltype(std::declval<Owner&>().get());

    OutPtr(Owner& owner, Pointer& slot)
        : m_owner(owner)
        , m_slot(slot)
    {
    }
    ~OutPtr() { m_owner.reset(m_slot); }

    operator Pointer*() const { return &m_slot; }

private:
    Owner& m_owner;
    Pointer& m_slot;
};

// The slot is a temporary of its own so that the callee gets no address that leads to the owner, which can then stay in a register.
template<typename Owner>
[[nodiscard]] OutPtr<Owner> outPtr(Owner& owner, typename OutPtr<Owner>::Pointer&& slot LIFETIME_BOUND = nullptr)
{
    return { owner, slot };
}

} // namespace Bun
