#pragma once

#include <cstdint>

namespace WTF {

enum class TriState : uint8_t { False,
    True,
    Indeterminate };

constexpr TriState triState(bool value)
{
    return static_cast<TriState>(value);
}

}

using WTF::TriState;
using WTF::triState;
