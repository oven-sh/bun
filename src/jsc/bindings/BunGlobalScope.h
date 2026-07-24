#pragma once

#include "root.h"
#include "JavaScriptCore/JSGlobalObject.h"

namespace Bun {

using namespace JSC;

class GlobalScope : public JSC::JSGlobalObject {
    using Base = JSC::JSGlobalObject;

protected:
    void finishCreation(JSC::VM& vm);

public:
    GlobalScope(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    GlobalScope(JSC::VM& vm, JSC::Structure* structure, const JSC::GlobalObjectMethodTable* methodTable)
        : Base(vm, structure, methodTable)
    {
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    JSC::Structure* encodeIntoObjectStructure() const { return m_encodeIntoObjectStructure.getInitializedOnMainThread(this); }
    JSC::Structure* callSiteStructure() const { return m_callSiteStructure.getInitializedOnMainThread(this); }

    /**
     * WARNING: You must update visitChildrenImpl() if you add a new field.
     *
     * That informs the garbage collector that these fields exist. If you don't
     * do that, the garbage collector will not know about these fields and will
     * not trace them. This will lead to crashes and very strange behavior at runtime.
     *
     * For example, if you don't add the queueMicrotask functions to visitChildrenImpl(),
     * those callbacks will eventually never be called anymore. But it'll work the first time!
     */
    LazyProperty<JSGlobalObject, Structure> m_encodeIntoObjectStructure;
    // CallSite structure lives here (rather than Zig::GlobalObject) so that
    // node:vm realms get their own per-realm prototype chain for the
    // `sites` array entries passed to Error.prepareStackTrace. Otherwise the
    // host-realm Object/Function constructors leak into the vm sandbox.
    LazyProperty<JSGlobalObject, Structure> m_callSiteStructure;
};

} // namespace Bun
