#pragma once

#include "v8.h"

namespace v8 {
namespace base {

// V8's monotonic clock (src/base/platform/time.h). Only the layout-affecting
// pieces addons depend on are mirrored here: a single int64_t holding
// microseconds since an unspecified epoch.
class TimeTicks final {
public:
    constexpr TimeTicks()
        : m_us(0)
    {
    }

    BUN_EXPORT static TimeTicks Now();

private:
    constexpr explicit TimeTicks(int64_t us)
        : m_us(us)
    {
    }

    [[maybe_unused]] int64_t m_us;
};

static_assert(sizeof(TimeTicks) == sizeof(int64_t), "v8::base::TimeTicks must be a bare int64_t");

} // namespace base
} // namespace v8
