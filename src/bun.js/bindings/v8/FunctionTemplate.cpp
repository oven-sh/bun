#include "v8/FunctionTemplate.h"

namespace v8 {

Local<FunctionTemplate> FunctionTemplate::New(
    Isolate* isolate,
    FunctionCallback callback,
    Local<Value> data,
    Local<Signature> signature,
    int length,
    ConstructorBehavior behavior,
    SideEffectType side_effect_type,
    const CFunction* c_function,
    uint16_t instance_type,
    uint16_t allowed_receiver_instance_type_range_start,
    uint16_t allowed_receiver_instance_type_range_end)
{
    assert("FunctionTemplate::New" && 0);
}

MaybeLocal<Function> FunctionTemplate::GetFunction(Local<Context> context)
{
    assert("FunctionTemplate::GetFunction" && 0);
}

}
