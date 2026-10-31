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
class String;
class ObjectTemplate;

namespace shim {
class Function;
}

enum class ConstructorBehavior {
    kThrow,
    kAllow,
};

// Same field layout as V8 14's v8-fast-api-calls.h, which Node's headers omit: an addon constructs these in its own storage and reads the fields inline.
class CTypeInfo {
public:
    enum class Type : uint8_t;
    enum class Flags : uint8_t;

    Type type_;
    Flags flags_;
};

static_assert(sizeof(CTypeInfo) == 2, "CTypeInfo has wrong layout");

class CFunctionInfo {
public:
    enum class Int64Representation : uint8_t {
        kNumber = 0,
        kBigInt = 1,
    };

    // The constructor may not read arg_info: V8's CFunctionInfoImpl passes the array that follows this base before initializing it.
    BUN_EXPORT CFunctionInfo(const CTypeInfo& return_info, unsigned int arg_count, const CTypeInfo* arg_info, Int64Representation repr = Int64Representation::kNumber);

    const CTypeInfo return_info_;
    const Int64Representation repr_;
    const unsigned int arg_count_;
    const CTypeInfo* arg_info_;
};

static_assert(sizeof(CFunctionInfo) == 16, "CFunctionInfo has wrong layout");
static_assert(offsetof(CFunctionInfo, return_info_) == 0, "CFunctionInfo has wrong layout");
static_assert(offsetof(CFunctionInfo, repr_) == 2, "CFunctionInfo has wrong layout");
static_assert(offsetof(CFunctionInfo, arg_count_) == 4, "CFunctionInfo has wrong layout");
static_assert(offsetof(CFunctionInfo, arg_info_) == 8, "CFunctionInfo has wrong layout");

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

    /** Get the InstanceTemplate. */
    BUN_EXPORT Local<ObjectTemplate> InstanceTemplate();

    /**
     * A PrototypeTemplate is the template used to create the prototype object
     * of the function created by this template.
     */
    BUN_EXPORT Local<ObjectTemplate> PrototypeTemplate();

    /**
     * Set the class name of the FunctionTemplate.  This is used for
     * printing objects created with the function created from the
     * FunctionTemplate as its constructor.
     */
    BUN_EXPORT void SetClassName(Local<String> name);

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
