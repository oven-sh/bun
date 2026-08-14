#pragma once

#include "root.h"

#include <JavaScriptCore/ScriptFetcher.h>
#include <JavaScriptCore/SourceProvider.h>
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

    // The compileFunction wrapper (see stringifyAnonymousFunction) shares the program's first line with the body.
    void setWrapper(JSC::SourceProvider& program, unsigned textLength, unsigned columnsBeyondNode)
    {
        m_wrapperSourceID = program.asID();
        m_wrapperTextLength = textLength;
        m_wrapperColumns = columnsBeyondNode;
    }

    // Wrapper text starting the first line; 0 unless `provider` is a compileFunction program.
    static unsigned wrapperTextLength(JSC::SourceProvider& provider)
    {
        auto* fetcher = wrapperFetcherFor(provider);
        return fetcher ? fetcher->m_wrapperTextLength : 0;
    }

    // By how much JSC's columns exceed Node's on this line; 0 unless it is a compileFunction program's first line.
    static unsigned wrapperColumnsOnLine(JSC::SourceProvider& provider, int lineZeroBased)
    {
        auto* fetcher = wrapperFetcherFor(provider);
        if (!fetcher)
            return 0;
        // SourceCode clamps the start line to the first line, so JSC reports the first physical line as max(lineOffset, 0).
        int firstLine = std::max(0, provider.startPosition().m_line.zeroBasedInt());
        return lineZeroBased == firstLine ? fetcher->m_wrapperColumns : 0;
    }

private:
    // Matched by provider: eval() and new Function() code inside the body inherits this fetcher without the wrapper.
    static NodeVMScriptFetcher* wrapperFetcherFor(JSC::SourceProvider& provider)
    {
        auto* fetcher = provider.sourceOrigin().fetcher();
        if (!fetcher || fetcher->fetcherType() != Type::NodeVM)
            return nullptr;
        auto* vmFetcher = static_cast<NodeVMScriptFetcher*>(fetcher);
        if (!vmFetcher->m_wrapperTextLength || provider.asID() != vmFetcher->m_wrapperSourceID)
            return nullptr;
        return vmFetcher;
    }

    JSC::Strong<JSC::Unknown> m_dynamicImportCallback;
    // m_owner is the NodeVMScript / JSFunction / module wrapper that holds this
    // fetcher via m_source -> SourceProvider -> SourceOrigin -> RefPtr<fetcher>.
    // A Strong handle here would form an uncollectable cycle (the owner keeps
    // the fetcher alive via RefPtr, and the fetcher would keep the owner alive
    // as a GC root). Use Weak instead: when the owner is collected its
    // SourceCode chain drops the last RefPtr to this fetcher.
    JSC::Weak<JSC::JSCell> m_owner;
    JSC::SourceID m_wrapperSourceID = 0;
    unsigned m_wrapperTextLength = 0;
    unsigned m_wrapperColumns = 0;
    bool m_isUsingDefaultLoader = false;

    NodeVMScriptFetcher(JSC::VM& vm, JSC::JSValue dynamicImportCallback, JSC::JSValue owner)
        : m_dynamicImportCallback(vm, dynamicImportCallback)
    {
        if (owner.isCell())
            m_owner = JSC::Weak<JSC::JSCell>(owner.asCell());
    }
};

}
