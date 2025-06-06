#pragma once

#include "root.h"

#include <JavaScriptCore/ScriptFetcher.h>

namespace Bun {

// The presence of this class in a JSFunction's sourceOrigin indicates that the function was compiled by Bun's node:vm implementation.
class NodeVMScriptFetcher : public JSC::ScriptFetcher {
public:
    static Ref<NodeVMScriptFetcher> create(JSC::VM& vm, JSC::JSValue dynamicImportCallback) { return adoptRef(*new NodeVMScriptFetcher(vm, dynamicImportCallback)); }

    Type fetcherType() const final { return Type::NodeVM; }

    JSC::JSValue dynamicImportCallback() const { return m_dynamicImportCallback.get(); }

    JSC::JSFunction* owner() const { return m_owner.get(); }
    void owner(JSC::VM& vm, JSC::JSFunction* value) { m_owner.set(vm, value); }

private:
    JSC::Strong<JSC::Unknown> m_dynamicImportCallback;
    JSC::Strong<JSC::JSFunction> m_owner;

    NodeVMScriptFetcher(JSC::VM& vm, JSC::JSValue dynamicImportCallback)
        : m_dynamicImportCallback(vm, dynamicImportCallback)
    {
    }
};

}
