#pragma once

#include "NodeVM.h"

#include "../vm/SigintReceiver.h"

namespace JSC {
class SourceCodeKey;
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
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, Base::StructureFlags), info());
    }

private:
    NodeVMScriptConstructor(JSC::VM& vm, JSC::Structure* structure);

    void finishCreation(JSC::VM&, JSC::JSObject* prototype);
};

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeVMScriptConstructor, JSC::InternalFunction);

class NodeVMScript;

// The SourceProvider behind a vm.Script. JSC's CodeCache consults it before parsing the
// script's source and hands it what it parses (SourceProvider::pinnedUnlinkedCode /
// pinUnlinkedCode), so every runInContext / runInThisContext of one Script links the same
// UnlinkedProgramCodeBlock, however many contexts it runs in and whatever else has gone
// through the CodeCache since. The Script cell owns that code block (it is what keeps it
// alive); the provider only knows which Script to ask. The provider can outlive the Script
// through the executables and stack traces earlier runs created, so the Script unlinks
// itself when it is destroyed.
class NodeVMScriptSourceProvider final : public JSC::StringSourceProvider {
public:
    static Ref<NodeVMScriptSourceProvider> create(const WTF::String& source, const JSC::SourceOrigin& sourceOrigin, WTF::String&& sourceURL, const TextPosition& startPosition)
    {
        return adoptRef(*new NodeVMScriptSourceProvider(source, sourceOrigin, WTF::move(sourceURL), startPosition));
    }

    void setScript(NodeVMScript* script) { m_script = script; }

    JSC::JSCell* pinnedUnlinkedCode(const JSC::SourceCodeKey&) const final;
    void pinUnlinkedCode(const JSC::SourceCodeKey&, JSC::JSCell*) const final;

private:
    NodeVMScriptSourceProvider(const WTF::String& source, const JSC::SourceOrigin& sourceOrigin, WTF::String&& sourceURL, const TextPosition& startPosition)
        : JSC::StringSourceProvider(source, sourceOrigin, JSC::SourceTaintedOrigin::Untainted, WTF::move(sourceURL), startPosition, JSC::SourceProviderSourceType::Program)
    {
    }

    NodeVMScript* m_script = nullptr;
};

class NodeVMScript final : public JSC::JSDestructibleObject, public SigintReceiver {
public:
    using Base = JSC::JSDestructibleObject;

    static NodeVMScript* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::SourceCode source, ScriptOptions options);
    ~NodeVMScript();

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
    // Parses the source once and pins the result; false (with `error` filled in) on a syntax error.
    bool compile(JSC::JSGlobalObject*, JSC::ParserError& error);
    void cacheBytecode();
    JSC::JSUint8Array* getBytecodeBuffer();

    // The hash is SourceCodeKey::hash(): the source plus the parse flags (code type, strictness,
    // code generation mode) the block was produced under. A lookup under different flags is a
    // miss, and the block JSC then produces replaces the pinned one.
    JSC::UnlinkedProgramCodeBlock* pinnedUnlinkedCode(unsigned keyHash) const { return m_pinnedKeyHash == keyHash ? m_pinnedUnlinkedCode.get() : nullptr; }
    void pinUnlinkedCode(unsigned keyHash, JSC::UnlinkedProgramCodeBlock*);
    bool hasPinnedUnlinkedCode() const { return !!m_pinnedUnlinkedCode; }

    const JSC::SourceCode& source() const { return m_source; }
    WTF::Vector<uint8_t>& cachedData() { return m_options.cachedData; }
    JSC::ProgramExecutable* cachedExecutable() const { return m_cachedExecutable.get(); }
    bool cachedDataProduced() const { return m_cachedDataProduced; }
    void cachedDataProduced(bool value) { m_cachedDataProduced = value; }
    TriState cachedDataRejected() const { return m_cachedDataRejected; }
    void cachedDataRejected(TriState value) { m_cachedDataRejected = value; }
    bool sourceMapURLParsed() const { return m_sourceMapURLParsed; }
    void sourceMapURLParsed(bool value) { m_sourceMapURLParsed = value; }

    DECLARE_VISIT_CHILDREN;

private:
    JSC::SourceCode m_source;
    RefPtr<JSC::CachedBytecode> m_cachedBytecode;
    JSC::WriteBarrier<JSC::JSUint8Array> m_cachedBytecodeBuffer;
    JSC::WriteBarrier<JSC::ProgramExecutable> m_cachedExecutable;
    JSC::WriteBarrier<JSC::UnlinkedProgramCodeBlock> m_pinnedUnlinkedCode;
    unsigned m_pinnedKeyHash = 0;
    ScriptOptions m_options;
    bool m_cachedDataProduced = false;
    bool m_sourceMapURLParsed = false;
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
