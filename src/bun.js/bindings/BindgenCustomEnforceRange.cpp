#include "BindgenCustomEnforceRange.h"

namespace Bun {

static String rangeErrorString(double value, double min, double max)
{
    return makeString("Value "_s, value, " is outside the range ["_s, min, ", "_s, max, ']');
}

}
