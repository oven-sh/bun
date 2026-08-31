#pragma once

#include "NodeVM.h"

namespace JSC {
class UnlinkedProgramCodeBlock;
}

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
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, Base::StructureFlags), info());
    }

private:
    NodeVMScriptConstructor(JSC::VM& vm, JSC::Structure* structure);

    void finishCreation(JSC::VM&, JSC::JSObject* prototype);
};

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeVMScriptConstructor, JSC::InternalFunction);

class NodeVMScript final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    static NodeVMScript* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::SourceCode source, ScriptOptions options);

    DECLARE_EXPORT_INFO;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NodeVMScript, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForNodeVMScript, m_subspaceForNodeVMScript));
    }

    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSObject* createPrototype(VM& vm, JSGlobalObject* globalObject);

    JSC::ProgramExecutable* createExecutable();
    void cacheBytecode();
    JSC::JSUint8Array* getBytecodeBuffer();

    // The source compiled the way globalObject compiles programs (see ProgramExecutable::initializeGlobalProperties):
    // m_unlinkedCodeBlock if it qualifies, otherwise a fresh compile that replaces it. Null with `error` set if
    // that compile fails.
    JSC::UnlinkedProgramCodeBlock* unlinkedCodeBlockFor(JSC::JSGlobalObject*, JSC::ParserError& error);
    JSC::JSValue evaluate(JSC::JSGlobalObject*, NakedPtr<JSC::Exception>& exception);

    const JSC::SourceCode& source() const { return m_source; }
    const ScriptOptions& options() const { return m_options; }
    WTF::Vector<uint8_t>& cachedData() { return m_options.cachedData; }
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
    // The compile every run links. Only recompiled (and replaced) when a global object with a different
    // CodeGenerationMode, i.e. a debugger attached, runs the Script.
    JSC::WriteBarrier<JSC::UnlinkedProgramCodeBlock> m_unlinkedCodeBlock;
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
