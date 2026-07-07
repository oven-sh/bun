#pragma once

#include "v8.h"
#include "V8Isolate.h"
#include "v8_internal.h"
#include "shim/HandleScopeBuffer.h"
#include "shim/GlobalInternals.h"
#include "shim/Map.h"

namespace v8 {

class Number;

class HandleScope {
public:
    BUN_EXPORT HandleScope(Isolate* isolate);
    BUN_EXPORT ~HandleScope();

    template<typename T> Local<T> createLocal(JSC::VM& vm, JSC::JSValue value)
    {
        // TODO(@190n) handle more types
        if (value.isString()) {
            return Local<T>(m_buffer->createHandle(value.asCell(), &shim::Map::string_map(), vm));
        } else if (value.isCell()) {
            return Local<T>(m_buffer->createHandle(value.asCell(), &shim::Map::object_map(), vm));
        } else if (value.isInt32()) {
            return Local<T>(m_buffer->createSmiHandle(value.asInt32()));
        } else if (value.isNumber()) {
            return Local<T>(m_buffer->createDoubleHandle(value.asNumber()));
        } else if (value.isUndefined()) {
            return Local<T>(m_isolate->undefinedSlot());
        } else if (value.isNull()) {
            return Local<T>(m_isolate->nullSlot());
        } else if (value.isTrue()) {
            return Local<T>(m_isolate->trueSlot());
        } else if (value.isFalse()) {
            return Local<T>(m_isolate->falseSlot());
        } else {
            V8_UNIMPLEMENTED();
            return Local<T>();
        }
    }

    friend class EscapableHandleScopeBase;

protected:
    // Used by EscapableHandleScopeBase, whose constructor must initialize the fields itself
    // (V8-style, without pushing a Bun handle scope). Mirrors V8's protected
    // `HandleScope() = default`.
    HandleScope() = default;

    // must be 24 bytes to match V8 layout
    Isolate* m_isolate;
    HandleScope* m_previousHandleScope;
    shim::HandleScopeBuffer* m_buffer;

    // is protected in v8, which matters on windows
    BUN_EXPORT static uintptr_t* CreateHandle(internal::Isolate* isolate, uintptr_t value);
    // V8 14's headers also declare a V8_INLINE overload taking v8::Isolate*
    // with an out-of-class body (v8-local-handle.h); MSVC debug builds import
    // it instead of emitting it, so it must exist as a real export. Protected
    // in V8 (affects the MSVC mangling).
    BUN_EXPORT static uintptr_t* CreateHandle(Isolate* isolate, uintptr_t value);
    // Same story for the inline constructor's Initialize: under MSVC /Ob0 the
    // addon-side inline HandleScope constructor calls an imported Initialize.
    // Initializes the frame in V8's inline style (snapshot next/limit,
    // level++) — never pushes a Bun scope, mirroring EscapableHandleScopeBase.
    BUN_EXPORT void Initialize(Isolate* isolate);

private:
    // Out-of-line slow path of V8 14's fully-inline HandleScope (v8-local-handle.h). The inline
    // CreateHandle calls Extend whenever HandleScopeData::next == HandleScopeData::limit, and the
    // inline destructor calls DeleteExtensions whenever the scope changed HandleScopeData::limit.
    // Private to match V8's declarations, which affects the mangled name on MSVC.
    //
    // Note that when these are called, `this` (for DeleteExtensions) is a V8-layout HandleScope
    // living in the addon's stack frame -- not one of ours -- so they must not touch our members
    // through `this`.
    BUN_EXPORT static uintptr_t* Extend(Isolate* isolate);
    BUN_EXPORT void DeleteExtensions(Isolate* isolate);
};

static_assert(sizeof(HandleScope) == 24, "HandleScope has wrong layout");

} // namespace v8
