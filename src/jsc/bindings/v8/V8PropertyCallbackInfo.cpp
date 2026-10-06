#include "V8PropertyCallbackInfo.h"
#include "real_v8.h"
#include "v8_compatibility_assertions.h"

#define CHECK_PROPERTY_FRAME_INDEX(NAME)                                              \
    static_assert(static_cast<int>(v8::PropertyCallbackInfo<v8::Value>::NAME)         \
            == static_cast<int>(real_v8::PropertyCallbackInfo<real_v8::Value>::NAME), \
        "Index of `" #NAME "` in the accessor exit frame does not match V8");

CHECK_PROPERTY_FRAME_INDEX(kPropertyKeyIndex)
CHECK_PROPERTY_FRAME_INDEX(kFrameSPIndex)
CHECK_PROPERTY_FRAME_INDEX(kFrameTypeIndex)
CHECK_PROPERTY_FRAME_INDEX(kFrameFPIndex)
CHECK_PROPERTY_FRAME_INDEX(kFramePCIndex)
CHECK_PROPERTY_FRAME_INDEX(kIsolateIndex)
CHECK_PROPERTY_FRAME_INDEX(kReturnValueIndex)
CHECK_PROPERTY_FRAME_INDEX(kCallbackInfoIndex)
CHECK_PROPERTY_FRAME_INDEX(kHolderIndex)
CHECK_PROPERTY_FRAME_INDEX(kShouldThrowOnErrorIndex)
CHECK_PROPERTY_FRAME_INDEX(kValueIndex)
CHECK_PROPERTY_FRAME_INDEX(kFullArgsLength)

static_assert(real_v8::internal::Internals::kFrameCPSlotCount == 0,
    "Bun's v8::PropertyCallbackInfo assumes no constant pool slot in the exit frame");

static_assert(v8::PropertyCallbackInfo<v8::Value>::kFrameTypeApiNamedAccessorExit
        == real_v8::internal::Internals::kFrameTypeApiNamedAccessorExit,
    "Frame type for named accessor exit frames does not match V8");

static_assert(v8::PropertyCallbackInfo<v8::Value>::kDontThrow
        == real_v8::internal::Internals::kDontThrow,
    "kDontThrow does not match V8");

static_assert(v8::PropertyCallbackInfo<v8::Value>::kCallbackInfoDataOffset
        == real_v8::internal::Internals::kCallbackInfoDataOffset,
    "kCallbackInfoDataOffset does not match V8");

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::PropertyCallbackInfo<v8::Value>)

ASSERT_V8_TYPE_FIELD_OFFSET_MATCHES(v8::PropertyCallbackInfo<v8::Value>, args, args_)
