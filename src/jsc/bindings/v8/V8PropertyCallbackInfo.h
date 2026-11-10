#pragma once

#include "shim/TaggedPointer.h"
#include "V8Local.h"

namespace v8 {

class Isolate;
class Value;
class Name;
class Object;

// T = return value
//
// Like FunctionCallbackInfo, PropertyCallbackInfo is a single-pointer-sized view
// into an ApiAccessorExitFrame: `this` points at args_[kPropertyKeyIndex] of a
// contiguous array of pointer-sized slots, and V8's inline accessors index
// `args_` relative to that slot (see v8-function-callback.h).
template<typename T>
class PropertyCallbackInfo {
public:
    // Slot indices relative to `args_`. kFrameConstantPoolIndex is folded into
    // kFrameFPIndex because Internals::kFrameCPSlotCount == 0 on every
    // architecture Bun supports (it is only 1 on PPC64).
    enum {
        // Frame arguments block.
        kPropertyKeyIndex = 0,

        // Regular ExitFrame structure.
        kFrameSPIndex = 1,
        kFrameTypeIndex = 2, // Smi-encoded frame type
        kFrameFPIndex = 3,
        kFramePCIndex = 4,

        // Other arguments block (kFirstApiArgumentIndex).
        kIsolateIndex = 5, // raw Isolate*
        kReturnValueIndex = 6,
        kCallbackInfoIndex = 7, // tagged pointer to AccessorInfo-like {map, data}
        kHolderIndex = 8,

        // Optional part, used only by setter/definer/deleter callbacks.
        kShouldThrowOnErrorIndex = 9,
        kValueIndex = 10,

        kFullArgsLength = 11,
    };

    // v8::internal::Internals::kFrameTypeApiNamedAccessorExit. Stored Smi-encoded
    // in the kFrameTypeIndex slot; IsNamed() compares against it.
    static constexpr int kFrameTypeApiNamedAccessorExit = 20;

    // v8::internal::Internals::kDontThrow. Stored Smi-encoded in the
    // kShouldThrowOnErrorIndex slot so ShouldThrowOnError() returns false.
    static constexpr int kDontThrow = 0;

    // v8::internal::Internals::kCallbackInfoDataOffset. The byte offset from the
    // tagged AccessorInfo pointer to the `data` tagged pointer.
    static constexpr int kCallbackInfoDataOffset = 8;

    // V8 declares this as `internal::Address args_[1]` and indexes it
    // out-of-bounds; the object provides a view of the frame rather than owning
    // any storage.
    mutable TaggedPointer args[1];

    PropertyCallbackInfo(const PropertyCallbackInfo&) = delete;
    PropertyCallbackInfo& operator=(const PropertyCallbackInfo&) = delete;

private:
    PropertyCallbackInfo() = default;
};

using AccessorNameGetterCallback = void (*)(Local<Name> property, const PropertyCallbackInfo<Value>& info);
using AccessorNameSetterCallback = void (*)(Local<Name> property, Local<Value> value, const PropertyCallbackInfo<void>& info);

} // namespace v8
