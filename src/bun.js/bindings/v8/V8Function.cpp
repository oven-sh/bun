#include "V8Function.h"

#include "shim/Function.h"

namespace v8 {

void Function::SetName(Local<String> name)
{
    auto* thisObj = localToObjectPointer();
    thisObj->setName(name->localToJSString());
}

} // namespace v8
