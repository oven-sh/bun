#pragma once

#include "v8.h"
#include "V8Isolate.h"
#include "v8_internal.h"
#include "shim/HandleScopeBuffer.h"
#include "shim/GlobalInternals.h"

namespace v8 {

class Number;

// Opens a Bun::HandleScopeImpl (the scope Node-API uses too) for the lifetime of the object. Only
// Bun itself and addons built against Node <= 24 headers construct these: Node 26 headers inline
// the constructor and destructor, and such a scope reaches Bun only through Extend/DeleteExtensions.
class HandleScope {
public:
    BUN_EXPORT HandleScope(Isolate* isolate);
    BUN_EXPORT ~HandleScope();

    template<typename T> Local<T> createLocal(JSC::VM& vm, JSC::JSValue value)
    {
        return m_isolate->currentHandleScope()->createLocal<T>(vm, value);
    }

protected:
    // Used by EscapableHandleScopeBase, whose constructor must initialize the fields itself
    // (V8-style, without opening a Bun scope). Mirrors V8's protected `HandleScope() = default`.
    HandleScope() = default;

    // V8's layout: { isolate_, prev_next_, prev_limit_ }. Frames the exported constructor builds
    // hold the scope they opened and `this` as a marker; frames initialized V8-style
    // (EscapableHandleScopeBase, Initialize) hold V8's next/limit snapshot. See ~HandleScope.
    Isolate* m_isolate;
    Bun::HandleScopeImpl* m_scope;
    HandleScope* m_openedScopeMarker;

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
    // level++) and never opens a Bun scope, like EscapableHandleScopeBase.
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
