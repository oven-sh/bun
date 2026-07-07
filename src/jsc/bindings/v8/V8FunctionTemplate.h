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
    [[maybe_unused]] const void* address;
    [[maybe_unused]] const void* type_info;
};

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
