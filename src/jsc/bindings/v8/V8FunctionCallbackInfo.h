#pragma once

#include "shim/TaggedPointer.h"

namespace v8 {

class Isolate;
class Context;
class Value;

// T = return value
//
// Since V8 13.8 (crbug.com/326505377), FunctionCallbackInfo is no longer a
// {implicit_args, values, length} triple. It is a single-pointer-sized view
// into an ApiCallbackExitFrame: `this` points directly at the argc slot of a
// contiguous array of pointer-sized slots, and V8's inline accessors index
// `values_` both backwards (new.target) and forwards (frame words, API
// arguments, receiver, JS arguments) relative to that slot.
template<typename T>
class FunctionCallbackInfo {
public:
    // Slot indices relative to `values`. These must match the private enum in
    // V8's v8-function-callback.h (checked by static_asserts in
    // V8FunctionCallbackInfo.cpp). kFrameConstantPoolIndex is folded into
    // kFrameFPIndex because Internals::kFrameCPSlotCount == 0 on every
    // architecture Bun supports (it is only 1 on PPC64).
    enum {
        // Optional frame arguments block (only for API_CONSTRUCT_EXIT frames).
        kNewTargetIndex = -1,

        // Mandatory part.
        kArgcIndex = 0, // raw integer, not a Smi
        kFrameSPIndex = 1,
        kFrameTypeIndex = 2, // Smi-encoded frame type
        kFrameFPIndex = 3,
        kFramePCIndex = 4,

        // API arguments block.
        kIsolateIndex = 5, // raw Isolate*
        kReturnValueIndex = 6,
        kContextIndex = 7, // raw context pointer
        kTargetIndex = 8,

        // JS arguments block.
        kReceiverIndex = 9,
        kFirstJSArgumentIndex = 10,
    };

    // v8::internal::Internals::kFrameTypeApiCallExit. Stored Smi-encoded in
    // the kFrameTypeIndex slot; IsConstructCall() compares against it.
    static constexpr int kFrameTypeApiCallExit = 18;

    // V8 declares this as `internal::Address values_[1]` and indexes it
    // out-of-bounds in both directions; the object provides a view of the
    // frame rather than owning any storage. Mutable for parity with V8 (GC
    // may rewrite slots through a const view).
    mutable TaggedPointer values[1];

    FunctionCallbackInfo() = delete;
    FunctionCallbackInfo(const FunctionCallbackInfo&) = delete;
    FunctionCallbackInfo& operator=(const FunctionCallbackInfo&) = delete;
};

using FunctionCallback = void (*)(const FunctionCallbackInfo<Value>&);

}
