#pragma once

#include "v8.h"
#include "v8/Context.h"
#include "v8/Isolate.h"
#include "v8/Local.h"
#include "v8/MaybeLocal.h"
#include "v8/Value.h"
#include "v8/Signature.h"
#include "v8/Function.h"

namespace v8 {

template<typename T>
class FunctionCallbackInfo {
private:
    uintptr_t* implicit_args;
    uintptr_t* values;
    uintptr_t length;
};

using FunctionCallback = void (*)(const FunctionCallbackInfo<Value>&);

enum class ConstructorBehavior {
    kThrow,
    kAllow,
};

enum class SideEffectType {
    kHasSideEffect,
    kHasNoSideEffect,
    kHasSideEffectToReceiver,
};

class CFunction {
private:
    const void* address;
    const void* type_info;
};

class FunctionTemplate {
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
};

}
