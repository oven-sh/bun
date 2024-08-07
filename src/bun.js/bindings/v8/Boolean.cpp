#include "v8/Boolean.h"
#include "v8/Isolate.h"

namespace v8 {

bool Boolean::Value() const
{
    return localToJSValue(Isolate::GetCurrent()->globalInternals()).asBoolean();
}

}
