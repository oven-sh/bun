#include "V8HeapObjectStatistics.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::HeapObjectStatistics)

namespace v8 {

HeapObjectStatistics::HeapObjectStatistics()
    : object_type_(nullptr)
    , object_sub_type_(nullptr)
    , object_count_(0)
    , object_size_(0)
{
}

} // namespace v8
