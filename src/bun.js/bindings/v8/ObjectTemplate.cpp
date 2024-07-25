#include "v8/ObjectTemplate.h"

namespace v8 {

Local<ObjectTemplate> ObjectTemplate::New(Isolate* isolate, Local<FunctionTemplate> constructor)
{
    assert("ObjectTemplate::New" && 0);
    return Local<ObjectTemplate>();
}

MaybeLocal<Object> ObjectTemplate::NewInstance(Local<Context> context)
{
    assert("ObjectTemplate::NewInstance" && 0);
    return MaybeLocal<Object>();
}

void ObjectTemplate::SetInternalFieldCount(int value)
{
    assert("ObjectTemplate::SetInternalFieldCount" && 0);
}

}
