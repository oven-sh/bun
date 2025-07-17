#include "V8FunctionCallbackInfo.h"
#include "real_v8.h"
#include "v8_compatibility_assertions.h"

// Check that the offset of a field in our ImplicitArgs struct matches the array index
// that V8 uses to access that field
#define CHECK_IMPLICIT_ARG(BUN_NAME, V8_NAME)                                          \
    static_assert(offsetof(v8::ImplicitArgs, BUN_NAME)                                 \
            == sizeof(void*) * real_v8::FunctionCallbackInfo<real_v8::Value>::V8_NAME, \
        "Position of `" #BUN_NAME "` in implicit arguments does not match V8");

CHECK_IMPLICIT_ARG(unused, kUnusedIndex)
CHECK_IMPLICIT_ARG(isolate, kIsolateIndex)
CHECK_IMPLICIT_ARG(context, kContextIndex)
CHECK_IMPLICIT_ARG(return_value, kReturnValueIndex)
CHECK_IMPLICIT_ARG(target, kTargetIndex)
CHECK_IMPLICIT_ARG(new_target, kNewTargetIndex)

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::FunctionCallbackInfo<v8::Value>)

ASSERT_V8_TYPE_FIELD_OFFSET_MATCHES(v8::FunctionCallbackInfo<v8::Value>, implicit_args, implicit_args_)
ASSERT_V8_TYPE_FIELD_OFFSET_MATCHES(v8::FunctionCallbackInfo<v8::Value>, values, values_)
ASSERT_V8_TYPE_FIELD_OFFSET_MATCHES(v8::FunctionCallbackInfo<v8::Value>, length, length_)
