#include "v8/Number.h"
#include "v8/HandleScope.h"

#include <cmath>
#include <cstdint>

namespace v8 {

Local<Number> Number::New(Isolate* isolate, double value)
{
    double int_part;
    RELEASE_ASSERT_WITH_MESSAGE(std::modf(value, &int_part) == 0.0, "TODO handle doubles in Number::New");
    RELEASE_ASSERT_WITH_MESSAGE(int_part >= INT32_MIN && int_part <= INT32_MAX, "TODO handle doubles in Number::New");
    int32_t smi = static_cast<int32_t>(int_part);
    return isolate->currentHandleScope()->createLocal<Number>(TaggedPointer(smi));
}

double Number::Value() const
{
    return toTagged().getSmiUnchecked();
}

}
