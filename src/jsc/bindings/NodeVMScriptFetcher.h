#pragma once

#include "root.h"

#include <JavaScriptCore/ScriptFetcher.h>
#include <JavaScriptCore/SourceCode.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakHandleOwner.h>
#include <JavaScriptCore/WeakInlines.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/Scope.h>

namespace Bun {

// The presence of this class in a JSFunction's sourceOrigin indicates that the function was compiled by Bun's node:vm implementation.
class NodeVMScriptFetcher : public JSC::ScriptFetcher {
public:
    static Ref<NodeVMScriptFetcher> create(JSC::VM& vm, JSC::JSValue dynamicImportCallback, JSC::JSValue owner, JSC::JSValue initializeImportMeta = {}) { return adoptRef(*new NodeVMScriptFetcher(vm, dynamicImportCallback, owner, initializeImportMeta)); }
    // For the records of vm.SyntheticModules, which have no code: no callback, and no owner.
    static Ref<NodeVMScriptFetcher> createForSyntheticModule()
    {
        Ref fetcher = adoptRef(*new NodeVMScriptFetcher);
        fetcher->m_isSyntheticModule = true;
        return fetcher;
    }

    Type fetcherType() const final { return Type::NodeVM; }

    // The fetcher of code that node:vm compiled, or null for any other code.
    static NodeVMScriptFetcher* of(const JSC::SourceCode& source)
    {
        JSC::ScriptFetcher* fetcher = source.provider()->sourceOrigin().fetcher();
        if (!fetcher || fetcher->fetcherType() != Type::NodeVM)
            return nullptr;
        return static_cast<NodeVMScriptFetcher*>(fetcher);
    }

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
    void owner(JSC::VM&, JSC::JSValue value) { m_owner = makeOwnerWeak(value); }

    // The `initializeImportMeta` option of a vm.SourceTextModule. Undefined once the module's body has started.
    JSC::JSValue takeInitializeImportMeta()
    {
        auto* callback = m_initializeImportMeta.get();
        m_initializeImportMeta.clear();
        if (callback && !hasUserCallback())
            m_owner = JSC::Weak<JSC::JSCell>(m_owner.get());
        return callback ? JSC::JSValue(callback) : JSC::jsUndefined();
    }

    bool isSyntheticModule() const { return m_isSyntheticModule; }

    bool isUsingDefaultLoader() const { return m_isUsingDefaultLoader; }
    auto temporarilyUseDefaultLoader()
    {
        m_isUsingDefaultLoader = true;
        return makeScopeExit([this] {
            m_isUsingDefaultLoader = false;
        });
    }

    template<typename Visitor>
    static void visitSource(Visitor& visitor, const JSC::SourceCode& source)
    {
        visitor.addOpaqueRoot(source.provider()->sourceOrigin().fetcher());
    }

private:
    // Alive while code from this source can still import(), as in Node.js:
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/modules/esm/utils.js#L151-L164
    class CodeIsAlive final : public JSC::WeakHandleOwner {
        bool isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown>, void* fetcher, JSC::AbstractSlotVisitor& visitor, ASCIILiteral* reason) final
        {
            if (reason) [[unlikely]]
                *reason = "node:vm code is alive"_s;
            return visitor.containsOpaqueRoot(fetcher);
        }
    };

    JSC::Weak<JSC::JSCell> makeWeak(JSC::JSCell* cell)
    {
        static NeverDestroyed<CodeIsAlive> codeIsAlive;
        return JSC::Weak<JSC::JSCell>(cell, &codeIsAlive.get(), this);
    }

    bool hasUserCallback() const
    {
        if (m_initializeImportMeta)
            return true;
        auto* cell = m_dynamicImportCallback.get();
        return cell && cell->isObject();
    }

    // Node retains the referrer only while a user callback exists (registerModule).
    JSC::Weak<JSC::JSCell> makeOwnerWeak(JSC::JSValue value)
    {
        if (!value.isCell())
            return {};
        if (hasUserCallback())
            return makeWeak(value.asCell());
        return JSC::Weak<JSC::JSCell>(value.asCell());
    }

    // First, where the base class has padding.
    bool m_isUsingDefaultLoader = false;
    bool m_isSyntheticModule = false;
    JSC::Weak<JSC::JSCell> m_dynamicImportCallback;
    JSC::Weak<JSC::JSCell> m_initializeImportMeta;
    // m_owner is the NodeVMScript / JSFunction / module wrapper that holds this
    // fetcher via m_source -> SourceProvider -> SourceOrigin -> RefPtr<fetcher>.
    // A Strong handle here would form an uncollectable cycle (the owner keeps
    // the fetcher alive via RefPtr, and the fetcher would keep the owner alive
    // as a GC root). Use Weak instead: when the owner is collected its
    // SourceCode chain drops the last RefPtr to this fetcher.
    JSC::Weak<JSC::JSCell> m_owner;

    NodeVMScriptFetcher() = default;
    NodeVMScriptFetcher(JSC::VM&, JSC::JSValue dynamicImportCallback, JSC::JSValue owner, JSC::JSValue initializeImportMeta)
    {
        if (dynamicImportCallback && dynamicImportCallback.isCell())
            m_dynamicImportCallback = makeWeak(dynamicImportCallback.asCell());
        if (initializeImportMeta && initializeImportMeta.isCell())
            m_initializeImportMeta = makeWeak(initializeImportMeta.asCell());
        m_owner = makeOwnerWeak(owner);
    }
};

}
