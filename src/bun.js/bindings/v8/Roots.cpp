#include "v8/Roots.h"
#include "v8/GlobalInternals.h"

namespace v8 {

Roots::Roots(GlobalInternals* parent_)
    : parent(parent_)
{
    roots[kUndefinedValueRootIndex] = TaggedPointer(&parent->undefinedValue);
    roots[kNullValueRootIndex] = TaggedPointer(&parent->nullValue);
    roots[kTrueValueRootIndex] = TaggedPointer(&parent->trueValue);
    roots[kFalseValueRootIndex] = TaggedPointer(&parent->falseValue);
}

}
