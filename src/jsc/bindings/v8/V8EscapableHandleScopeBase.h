#pragma once

#include "v8.h"
#include "V8Isolate.h"
#include "V8HandleScope.h"

namespace v8 {

// In Node 26 (V8 14) headers, this class's constructor is the only out-of-line piece of an
// EscapableHandleScope's lifetime: ~EscapableHandleScopeBase and ~EscapableHandleScope are
// inline-defaulted, so destruction runs V8's inline ~HandleScope (v8-local-handle.h), which
// unwinds the isolate's HandleScopeData using this object's three base words as
// { isolate_, prev_next_, prev_limit_ }. Older Node headers (<= 24) instead reach Bun's exported
// ~HandleScope through their inline-defaulted destructors. Therefore this constructor must NOT
// push a Bun handle scope (nothing on either path would pop it); it initializes the base words
// V8-style, and Bun's exported ~HandleScope detects such frames and unwinds them the same way the
// inline destructor would. See V8EscapableHandleScopeBase.cpp and V8HandleScope.cpp.
//
// Consequently the inherited m_previousHandleScope/m_buffer words do NOT hold Bun pointers here,
// so inherited HandleScope methods that use them (like createLocal) must not be called on these
// objects; Bun-internal code should use isolate->currentHandleScope()->createLocal instead.
class EscapableHandleScopeBase : public HandleScope {
public:
    BUN_EXPORT EscapableHandleScopeBase(Isolate* isolate);

protected:
    BUN_EXPORT uintptr_t* EscapeSlot(uintptr_t* escape_value);

private:
    // The buffer of the Bun handle scope that was current when this scope was constructed (the
    // scope an Escape()d value escapes to). Occupies the slot V8 uses for escape_slot_; like
    // escape_slot_, it is only ever touched by out-of-line (Bun-compiled) code, and doubles as
    // the "Escape called twice" flag.
    shim::HandleScopeBuffer* m_escapeBuffer;
};

} // namespace v8
