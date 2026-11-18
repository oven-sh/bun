#pragma once

#include "engine/support/Assertions.h"

namespace WTF {

class CrashOnOverflow {
public:
    [[noreturn]] static ALWAYS_INLINE void overflowed() { CRASH(); }
    constexpr bool hasOverflowed() const { return false; }
};

class RecordOverflow {
public:
    constexpr void overflowed() { m_hasOverflowed = true; }
    constexpr bool hasOverflowed() const { return m_hasOverflowed; }

private:
    bool m_hasOverflowed { false };
};

}

using WTF::CrashOnOverflow;
using WTF::RecordOverflow;
