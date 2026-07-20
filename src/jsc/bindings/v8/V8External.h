#pragma once

#include "v8.h"
#include "V8Value.h"
#include "V8MaybeLocal.h"
#include "V8Isolate.h"

namespace v8 {

class External : public Value {
public:
    // Kept for addons compiled against older Node headers, where this overload was out-of-line.
    // In V8 14 it is an inline wrapper around the tagged overload below.
    BUN_EXPORT static Local<External> New(Isolate* isolate, void* value);
    // The tag is a v8::ExternalPointerTypeTag (uint16_t), used to type entries in V8's sandbox
    // external pointer table so that sandboxed code cannot type-confuse one external pointer for
    // another. We have no V8 sandbox and no external pointer table -- the pointer is stored
    // directly in a NapiExternal cell -- so there is nothing for the tag to tag and it is ignored.
    BUN_EXPORT static Local<External> New(Isolate* isolate, void* value, uint16_t tag);
    BUN_EXPORT void* Value() const;
    // Same deal as New: the tag selects the external pointer table tag to validate against, which
    // does not exist here. V8 14's inline Value() forwards to this overload.
    BUN_EXPORT void* Value(uint16_t tag) const;
};

} // namespace v8
