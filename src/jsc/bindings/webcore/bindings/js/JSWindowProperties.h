#pragma once

#include "JSDOMGlobalObject.h"
#include <JavaScriptCore/JSObject.h>

namespace WebCore {

// A read of the global object on behalf of a window that is under way. It lives on the stack of the function that makes the read.
struct WindowGlobalObjectRead {
    UniquedStringImpl* name;
    WindowGlobalObjectRead* outer;
};

// The object between Window.prototype and EventTarget.prototype, where browsers have the named properties object.
// A window is not the global object here, so this is where `window.setTimeout` and `window.Array` come from: a name that
// nothing else on the prototype chain has is read from the realm's global object. After that come the elements of the window's
// document that have the name as their `id` or `name`, as in browsers. All windows of a realm share this object.
// It only answers reads. It lists no keys, and `window.setTimeout = f` makes a property on that window.
class JSWindowProperties final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    // "Impure" keeps every lookup that gets as far as this object out of the inline caches, whatever object it started at.
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::GetOwnPropertySlotIsImpure | JSC::GetOwnPropertySlotIsImpureForPropertyAbsence | JSC::IsImmutablePrototypeExoticObject | JSC::OverridesGetOwnPropertySlot;

    static JSWindowProperties* create(JSC::VM&, JSDOMGlobalObject&);

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWindowProperties, Base);
        return &vm.plainObjectSpace();
    }

    static bool getOwnPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);

private:
    JSWindowProperties(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};

} // namespace WebCore
