#pragma once
#include "root.h"
#include "headers-handwritten.h"

namespace Zig {
class GlobalObject;
}
namespace JSC {
class SourceCode;
class JSSourceCode;
class ProgramExecutable;
class AbstractModuleRecord;
}

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(jsFunctionCreateCommonJSModule);
JSC_DECLARE_HOST_FUNCTION(jsFunctionLoadModule);

void populateESMExports(
    JSC::JSGlobalObject* globalObject,
    JSC::JSValue result,
    WTF::Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues,
    bool ignoreESModuleAnnotation);

class JSCommonJSModule final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    mutable JSC::WriteBarrier<JSString> m_id;
    mutable JSC::WriteBarrier<Unknown> m_filename;
    mutable JSC::WriteBarrier<JSString> m_dirname;
    mutable JSC::WriteBarrier<Unknown> m_paths;
    mutable JSC::WriteBarrier<Unknown> m_parent;
    mutable JSC::WriteBarrier<JSSourceCode> sourceCode;
    bool ignoreESModuleAnnotation { false };

    static void destroy(JSC::JSCell*);
    ~JSCommonJSModule();

    void finishCreation(JSC::VM& vm,
        JSC::JSString* id, JSValue filename,
        JSC::JSString* dirname, JSC::JSSourceCode* sourceCode);

    static JSC::Structure* createStructure(JSC::JSGlobalObject* globalObject);

    bool evaluate(Zig::GlobalObject* globalObject, const WTF::String& sourceURL, ResolvedSource resolvedSource, bool isBuiltIn);
    inline bool evaluate(Zig::GlobalObject* globalObject, const WTF::String& sourceURL, ResolvedSource resolvedSource)
    {
        return evaluate(globalObject, sourceURL, resolvedSource, false);
    }
    bool evaluate(Zig::GlobalObject* globalObject, const WTF::String& key, const SyntheticSourceProvider::SyntheticSourceGenerator& generator);
    bool evaluate(Zig::GlobalObject* globalObject, const WTF::String& key, JSSourceCode* sourceCode);

    static JSCommonJSModule* create(JSC::VM& vm, JSC::Structure* structure,
        JSC::JSString* id,
        JSValue filename,
        JSC::JSString* dirname, JSC::JSSourceCode* sourceCode);

    static JSCommonJSModule* create(
        Zig::GlobalObject* globalObject,
        const WTF::String& key,
        JSValue exportsObject, bool hasEvaluated, JSValue parent);

    static JSCommonJSModule* create(
        Zig::GlobalObject* globalObject,
        const WTF::String& key,
        ResolvedSource resolvedSource);

    static JSObject* createBoundRequireFunction(VM& vm, JSGlobalObject* lexicalGlobalObject, const WTF::String& pathString);

    void toSyntheticSource(JSC::JSGlobalObject* globalObject,
        JSC::Identifier moduleKey,
        Vector<JSC::Identifier, 4>& exportNames,
        JSC::MarkedArgumentBuffer& exportValues);

    JSValue exportsObject();
    JSValue id();

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;


    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    template<typename, SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSCommonJSModule, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForCommonJSModuleRecord.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForCommonJSModuleRecord = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForCommonJSModuleRecord.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForCommonJSModuleRecord = std::forward<decltype(space)>(space); });
    }

    bool hasEvaluated = false;

    JSCommonJSModule(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

JSCommonJSModule* createCommonJSModuleWithoutRunning(
    Zig::GlobalObject* globalObject,
    Ref<Zig::SourceProvider> sourceProvider,
    const WTF::String& sourceURL,
    ResolvedSource source);

JSC::Structure* createCommonJSModuleStructure(
    Zig::GlobalObject* globalObject);

std::optional<JSC::SourceCode> createCommonJSModule(
    Zig::GlobalObject* globalObject,
    ResolvedSource source,
    bool isBuiltIn);

inline std::optional<JSC::SourceCode> createCommonJSModule(
    Zig::GlobalObject* globalObject,
    ResolvedSource source)
{
    return createCommonJSModule(globalObject, source, false);
}

class RequireResolveFunctionPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static RequireResolveFunctionPrototype* create(JSC::JSGlobalObject* globalObject);
    static Structure* createStructure(VM& vm, JSC::JSGlobalObject* globalObject);

    DECLARE_INFO;

    RequireResolveFunctionPrototype(
        JSC::VM& vm,
        JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(RequireResolveFunctionPrototype, Base);
        return &vm.plainObjectSpace();
    }

    void finishCreation(JSC::VM& vm);
};

class RequireFunctionPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static RequireFunctionPrototype* create(JSC::JSGlobalObject* globalObject);
    static Structure* createStructure(VM& vm, JSC::JSGlobalObject* globalObject);

    DECLARE_INFO;

    RequireFunctionPrototype(
        JSC::VM& vm,
        JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(RequireFunctionPrototype, Base);
        return &vm.plainObjectSpace();
    }

    void finishCreation(JSC::VM&);
};

} // namespace Bun
