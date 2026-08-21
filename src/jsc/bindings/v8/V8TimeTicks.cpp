#include "V8TimeTicks.h"

#include <wtf/MonotonicTime.h>

namespace v8 {
namespace base {

TimeTicks TimeTicks::Now()
{
    return TimeTicks(WTF::MonotonicTime::now().secondsSinceEpoch().microsecondsAs<int64_t>());
}

} // namespace base
} // namespace v8
