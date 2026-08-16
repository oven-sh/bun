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

    JSC::JSValue dynamicImportCallback() const { return m_dynamicImportCallback.get(); }

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
    JSC::Strong<JSC::Unknown> m_dynamicImportCallback;
    // m_owner is the NodeVMScript / JSFunction / module wrapper that holds this
    // fetcher via m_source -> SourceProvider -> SourceOrigin -> RefPtr<fetcher>.
    // A Strong handle here would form an uncollectable cycle (the owner keeps
    // the fetcher alive via RefPtr, and the fetcher would keep the owner alive
    // as a GC root). Use Weak instead: when the owner is collected its
    // SourceCode chain drops the last RefPtr to this fetcher.
    JSC::Weak<JSC::JSCell> m_owner;
    bool m_isUsingDefaultLoader = false;

    NodeVMScriptFetcher(JSC::VM& vm, JSC::JSValue dynamicImportCallback, JSC::JSValue owner)
        : m_dynamicImportCallback(vm, dynamicImportCallback)
    {
        if (owner.isCell())
            m_owner = JSC::Weak<JSC::JSCell>(owner.asCell());
    }
};

}
