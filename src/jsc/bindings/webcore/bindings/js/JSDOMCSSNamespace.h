#pragma once

#include "JSDOMWrapper.h"

namespace WebCore {

// The `CSS` object, https://drafts.csswg.org/cssom/#namespacedef-css. A namespace has no interface object and no prototype of its own:
// it is a plain object with functions. There is one for each global object, kept where the interface objects are kept.
class JSDOMCSSNamespace final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSDOMCSSNamespace* create(JSC::VM&, JSC::Structure*, JSDOMGlobalObject&);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject&, JSC::JSValue prototype);
    static JSC::JSValue prototypeForStructure(JSC::VM&, const JSDOMGlobalObject&);

    // The object itself. It has the name the interface objects' function has, so that one list can export them all.
    static JSC::JSValue getConstructor(JSC::VM&, const JSC::JSGlobalObject*);

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSDOMCSSNamespace, Base);
        return &vm.plainObjectSpace();
    }

private:
    JSDOMCSSNamespace(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};

} // namespace WebCore
