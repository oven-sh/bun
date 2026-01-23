#pragma once

#include "NodeVM.h"

#include "../vm/SigintReceiver.h"

namespace Bun {

class ScriptOptions : public BaseVMOptions {
public:
    WTF::Vector<uint8_t> cachedData;
    std::optional<int64_t> timeout = std::nullopt;
    bool produceCachedData = false;

    using BaseVMOptions::BaseVMOptions;

    bool fromJS(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSC::JSValue optionsArg, JSValue* importer);
};

class NodeVMScriptConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static NodeVMScriptConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype);

    DECLARE_EXPORT_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, Base::StructureFlags), info());
    }

private:
    NodeVMScriptConstructor(JSC::VM& vm, JSC::Structure* structure);

    void finishCreation(JSC::VM&, JSC::JSObject* prototype);
};

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeVMScriptConstructor, JSC::InternalFunction);

class NodeVMScript final : public JSC::JSDestructibleObject, public SigintReceiver {
public:
    using Base = JSC::JSDestructibleObject;

    static NodeVMScript* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::SourceCode source, ScriptOptions options);

    DECLARE_EXPORT_INFO;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NodeVMScript, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForNodeVMScript.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeVMScript = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForNodeVMScript.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeVMScript = std::forward<decltype(space)>(space); });
    }

    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSObject* createPrototype(VM& vm, JSGlobalObject* globalObject);

    JSC::ProgramExecutable* createExecutable();
    void cacheBytecode();
    JSC::JSUint8Array* getBytecodeBuffer();

    const JSC::SourceCode& source() const { return m_source; }
    WTF::Vector<uint8_t>& cachedData() { return m_options.cachedData; }
    RefPtr<JSC::CachedBytecode> cachedBytecode() const { return m_cachedBytecode; }
    JSC::ProgramExecutable* cachedExecutable() const { return m_cachedExecutable.get(); }
    bool cachedDataProduced() const { return m_cachedDataProduced; }
    void cachedDataProduced(bool value) { m_cachedDataProduced = value; }
    TriState cachedDataRejected() const { return m_cachedDataRejected; }
    void cachedDataRejected(TriState value) { m_cachedDataRejected = value; }

    DECLARE_VISIT_CHILDREN;

private:
    JSC::SourceCode m_source;
    RefPtr<JSC::CachedBytecode> m_cachedBytecode;
    JSC::WriteBarrier<JSC::JSUint8Array> m_cachedBytecodeBuffer;
    JSC::WriteBarrier<JSC::ProgramExecutable> m_cachedExecutable;
    ScriptOptions m_options;
    bool m_cachedDataProduced = false;
    TriState m_cachedDataRejected = TriState::Indeterminate;

    NodeVMScript(JSC::VM& vm, JSC::Structure* structure, JSC::SourceCode source, ScriptOptions options)
        : Base(vm, structure)
        , m_source(WTF::move(source))
        , m_options(WTF::move(options))
    {
    }

    void finishCreation(JSC::VM&);
};

class RunningScriptOptions : public BaseVMOptions {
public:
    bool displayErrors = true;
    std::optional<int64_t> timeout = std::nullopt;
    bool breakOnSigint = false;

    using BaseVMOptions::BaseVMOptions;

    bool fromJS(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSC::JSValue optionsArg);
};

} // namespace Bun
