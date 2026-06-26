#include "V8FunctionCallbackInfo.h"
#include "real_v8.h"
#include "v8_compatibility_assertions.h"

// Check that a slot index in our FunctionCallbackInfo matches the index V8's
// inline accessors use to read that slot of the ApiCallbackExitFrame
#define CHECK_FRAME_INDEX(NAME)                                                       \
    static_assert(static_cast<int>(v8::FunctionCallbackInfo<v8::Value>::NAME)         \
            == static_cast<int>(real_v8::FunctionCallbackInfo<real_v8::Value>::NAME), \
        "Index of `" #NAME "` in the callback exit frame does not match V8");

CHECK_FRAME_INDEX(kNewTargetIndex)
CHECK_FRAME_INDEX(kArgcIndex)
CHECK_FRAME_INDEX(kFrameSPIndex)
CHECK_FRAME_INDEX(kFrameTypeIndex)
CHECK_FRAME_INDEX(kFrameFPIndex)
CHECK_FRAME_INDEX(kFramePCIndex)
CHECK_FRAME_INDEX(kIsolateIndex)
CHECK_FRAME_INDEX(kReturnValueIndex)
CHECK_FRAME_INDEX(kContextIndex)
CHECK_FRAME_INDEX(kTargetIndex)
CHECK_FRAME_INDEX(kReceiverIndex)
CHECK_FRAME_INDEX(kFirstJSArgumentIndex)

// Our enum folds kFrameConstantPoolIndex into kFrameFPIndex, which is only
// valid when no constant pool slot is present (true everywhere but PPC64)
static_assert(real_v8::internal::Internals::kFrameCPSlotCount == 0,
    "Bun's v8::FunctionCallbackInfo assumes no constant pool slot in the exit frame");

static_assert(v8::FunctionCallbackInfo<v8::Value>::kFrameTypeApiCallExit
        == real_v8::internal::Internals::kFrameTypeApiCallExit,
    "Frame type for API callback exit frames does not match V8");

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::FunctionCallbackInfo<v8::Value>)

ASSERT_V8_TYPE_FIELD_OFFSET_MATCHES(v8::FunctionCallbackInfo<v8::Value>, values, values_)
