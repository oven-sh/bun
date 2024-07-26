#include "v8/ObjectTemplate.h"
#include "wtf/Assertions.h"

namespace v8 {

Local<ObjectTemplate> ObjectTemplate::New(Isolate* isolate, Local<FunctionTemplate> constructor)
{
    ASSERT_NOT_REACHED();
    return Local<ObjectTemplate>();
}

MaybeLocal<Object> ObjectTemplate::NewInstance(Local<Context> context)
{
    ASSERT_NOT_REACHED();
    return MaybeLocal<Object>();
}

void ObjectTemplate::SetInternalFieldCount(int value)
{
    ASSERT_NOT_REACHED();
}

}
