#pragma once

#include "v8.h"
#include "V8Context.h"
#include "V8Isolate.h"
#include "V8Local.h"
#include "V8MaybeLocal.h"
#include "V8Value.h"
#include "V8Signature.h"
#include "V8Template.h"
#include "V8FunctionCallbackInfo.h"
#include "V8String.h"
#include "shim/FunctionTemplate.h"

namespace v8 {

class Function;

namespace shim {
class Function;
}

enum class ConstructorBehavior {
    kThrow,
    kAllow,
};

enum class SideEffectType {
    kHasSideEffect,
    kHasNoSideEffect,
    kHasSideEffectToReceiver,
};

// Only used by v8 fast API calls, which Node.js doesn't seem to intend to support
// (v8-fast-api-calls.h is not in the headers distribution)
class CFunction {
private:
    const void* address;
    const void* type_info;
};

class ObjectTemplate;

class FunctionTemplate : public Template {
public:
    BUN_EXPORT static Local<FunctionTemplate> New(
        Isolate* isolate,
        FunctionCallback callback = nullptr,
        Local<Value> data = Local<Value>(),
        Local<Signature> signature = Local<Signature>(),
        int length = 0,
        ConstructorBehavior behavior = ConstructorBehavior::kAllow,
        SideEffectType side_effect_type = SideEffectType::kHasSideEffect,
        const CFunction* c_function = nullptr,
        uint16_t instance_type = 0,
        uint16_t allowed_receiver_instance_type_range_start = 0,
        uint16_t allowed_receiver_instance_type_range_end = 0);

    BUN_EXPORT MaybeLocal<Function> GetFunction(Local<Context> context);

    // Check if object is an instance of this function template
    BUN_EXPORT bool HasInstance(Local<Value> object);

    // Set the name displayed when printing objects created with this FunctionTemplate as the constructor
    BUN_EXPORT void SetClassName(Local<String> name);

    // Get the template used for instances constructed with this function
    BUN_EXPORT Local<ObjectTemplate> InstanceTemplate();

    // Get the template used for the prototype object of the function created by this template
    BUN_EXPORT Local<ObjectTemplate> PrototypeTemplate();

private:
    shim::FunctionTemplate* localToObjectPointer()
    {
        return Data::localToObjectPointer<shim::FunctionTemplate>();
    }

    const shim::FunctionTemplate* localToObjectPointer() const
    {
        return Data::localToObjectPointer<shim::FunctionTemplate>();
    }
};

} // namespace v8
