#pragma once

#include "root.h"

#include <JavaScriptCore/ScriptFetcher.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakInlines.h>
#include <wtf/Scope.h>

namespace Bun {

// The presence of this class in a JSFunction's sourceOrigin indicates that the function was compiled by Bun's node:vm implementation.
class NodeVMScriptFetcher : public JSC::ScriptFetcher {
public:
    static Ref<NodeVMScriptFetcher> create(JSC::VM& vm, JSC::JSValue dynamicImportCallback, JSC::JSValue owner) { return adoptRef(*new NodeVMScriptFetcher(vm, dynamicImportCallback, owner)); }

    Type fetcherType() const final { return Type::NodeVM; }

    JSC::JSValue dynamicImportCallback() const
    {
        if (auto* cell = m_dynamicImportCallback.get())
            return JSC::JSValue(cell);
        return JSC::jsUndefined();
    }

    JSC::JSValue owner() const
    {
        if (auto* cell = m_owner.get())
            return JSC::JSValue(cell);
        return JSC::jsUndefined();
    }
    void owner(JSC::VM&, JSC::JSValue value)
    {
        if (value.isCell())
            m_owner = JSC::Weak<JSC::JSCell>(value.asCell());
        else
            m_owner.clear();
    }

    bool isUsingDefaultLoader() const { return m_isUsingDefaultLoader; }
    auto temporarilyUseDefaultLoader()
    {
        m_isUsingDefaultLoader = true;
        return makeScopeExit([this] {
            m_isUsingDefaultLoader = false;
        });
    }

private:
    // This fetcher is RefCounted and reachable from its owning JSCell via
    // m_source -> SourceProvider -> SourceOrigin -> RefPtr<fetcher>. Holding
    // either the owner or the importModuleDynamically callback via Strong<>
    // would create an uncollectable cycle whenever the callback's closure can
    // reach the owner (a common pattern in module linker caches). Both are
    // therefore held weakly here; the owning NodeVMScript / NodeVMSourceTextModule /
    // compiled JSFunction is responsible for keeping the callback alive via a
    // normal GC edge (WriteBarrier / property) so that the Weak handle remains
    // valid for as long as the owner is reachable.
    JSC::Weak<JSC::JSCell> m_dynamicImportCallback;
    JSC::Weak<JSC::JSCell> m_owner;
    bool m_isUsingDefaultLoader = false;

    NodeVMScriptFetcher(JSC::VM&, JSC::JSValue dynamicImportCallback, JSC::JSValue owner)
    {
        if (dynamicImportCallback.isCell())
            m_dynamicImportCallback = JSC::Weak<JSC::JSCell>(dynamicImportCallback.asCell());
        if (owner.isCell())
            m_owner = JSC::Weak<JSC::JSCell>(owner.asCell());
    }
};

}
