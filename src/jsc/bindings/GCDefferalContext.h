#pragma once

#include "helpers.h"

namespace JSC {

ALWAYS_INLINE GCDeferralContext::GCDeferralContext(VM& vm)
    : m_vm(vm)
{
}

ALWAYS_INLINE GCDeferralContext::~GCDeferralContext()
{
    if constexpr (validateDFGDoesGC)
        m_vm.verifyCanGC();

    if (m_shouldGC) [[unlikely]]
        m_vm.heap.collectIfNecessaryOrDefer();
}

} // namespace JSC
