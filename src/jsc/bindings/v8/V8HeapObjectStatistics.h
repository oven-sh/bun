#pragma once

#include "v8.h"

namespace v8 {

class HeapObjectStatistics {
public:
    BUN_EXPORT HeapObjectStatistics();

    const char* object_type() { return object_type_; }
    const char* object_sub_type() { return object_sub_type_; }
    size_t object_count() { return object_count_; }
    size_t object_size() { return object_size_; }

private:
    const char* object_type_;
    const char* object_sub_type_;
    size_t object_count_;
    size_t object_size_;

    friend class Isolate;
};

} // namespace v8
