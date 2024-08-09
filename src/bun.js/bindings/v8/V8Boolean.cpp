#include "V8Boolean.h"
#include "V8Isolate.h"

namespace v8 {

bool Boolean::Value() const
{
    return localToJSValue(Isolate::GetCurrent()->globalInternals()).asBoolean();
}

}
