#pragma once

#include "root.h"

#include <JavaScriptCore/ScriptFetcher.h>
#include <wtf/Scope.h>

namespace Bun {

// The presence of this class in a JSFunction's sourceOrigin indicates that the function was compiled by Bun's node:vm implementation.
class NodeVMScriptFetcher : public JSC::ScriptFetcher {
public:
    static Ref<NodeVMScriptFetcher> create(JSC::VM& vm, JSC::JSValue dynamicImportCallback, JSC::JSValue owner) { return adoptRef(*new NodeVMScriptFetcher(vm, dynamicImportCallback, owner)); }

    Type fetcherType() const final { return Type::NodeVM; }

    JSC::JSValue dynamicImportCallback() const { return m_dynamicImportCallback.get(); }

    JSC::JSValue owner() const { return m_owner.get(); }
    void owner(JSC::VM& vm, JSC::JSValue value) { m_owner.set(vm, value); }

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
    JSC::Strong<JSC::Unknown> m_owner;
    bool m_isUsingDefaultLoader = false;

    NodeVMScriptFetcher(JSC::VM& vm, JSC::JSValue dynamicImportCallback, JSC::JSValue owner)
        : m_dynamicImportCallback(vm, dynamicImportCallback)
        , m_owner(vm, owner)
    {
    }
};

}
