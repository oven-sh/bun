#include "v8/Roots.h"
#include "v8/GlobalInternals.h"

namespace v8 {

Roots::Roots(GlobalInternals* parent_)
    : parent(parent_)
{
    roots[kUndefinedValueRootIndex] = TaggedPointer(&parent->undefinedValue);
    roots[kNullValueRootIndex] = TaggedPointer(&parent->nullValue);
    // TODO point to real objects
    roots[kTrueValueRootIndex] = TaggedPointer(reinterpret_cast<void*>(0x5555555555555550));
    roots[kFalseValueRootIndex] = TaggedPointer(reinterpret_cast<void*>(0xaaaaaaaaaaaaaaa0));
}

}
