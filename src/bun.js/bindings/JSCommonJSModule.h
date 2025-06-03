#pragma once
#include "root.h"

#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSString.h"
#include "headers-handwritten.h"
#include "wtf/NakedPtr.h"
#include "BunClientData.h"

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

using namespace JSC;

JSC_DECLARE_HOST_FUNCTION(jsFunctionCreateCommonJSModule);
JSC_DECLARE_HOST_FUNCTION(jsFunctionEvaluateCommonJSModule);
JSC_DECLARE_HOST_FUNCTION(functionJSCommonJSModule_compile);

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

    // `module.id` Initialized eagerly; can be overridden.
    mutable JSC::WriteBarrier<JSString> m_id;
    // Initialized eagerly; can be overridden.
    mutable JSC::WriteBarrier<Unknown> m_filename;
    // Initialized eagerly; can be overridden.
    mutable JSC::WriteBarrier<JSString> m_dirname;
    // Initialized lazily; can be overridden.
    mutable JSC::WriteBarrier<Unknown> m_paths;
    // Children must always be tracked in case the script decides to access
    // `module.children`. In that case, all children may also need their
    // children fields to exist, recursively. To avoid allocating a *JSArray for
    // each module, the children array is constructed internally as a
    // Vector of pointers. If accessed, deduplication happens and array is
    // moved into JavaScript. These two fields add 16 bytes to JSCommonJSModule.
    // `m_childrenValue` can be set to any value via the user-exposed setter,
    // but Bun does not test that behavior besides ensuring it does not crash.
    mutable JSC::WriteBarrier<Unknown> m_childrenValue;
    // This must be WriteBarrier<Unknown> to compile; always JSCommonJSModule
    WTF::Vector<WriteBarrier<Unknown>> m_children;

    // Visited by the GC. When the module is assigned a non-JSCommonJSModule
    // parent, it is assigned to this field.
    //
    //    module.parent = parent;
    //
    mutable JSC::WriteBarrier<Unknown> m_overriddenParent;
    // Not visited by the GC.
    // When the module is assigned a JSCommonJSModule parent, it is assigned to this field.
    // This is the normal state.
    JSC::Weak<JSCommonJSModule> m_parent {};
    // If compile is overridden, it is assigned to this field. The default
    // compile function is not stored here, but in
    mutable JSC::WriteBarrier<Unknown> m_overriddenCompile;

    bool ignoreESModuleAnnotation { false };
    JSC::SourceCode sourceCode = JSC::SourceCode();

    static size_t estimatedSize(JSC::JSCell* cell, JSC::VM& vm);

    void setSourceCode(JSC::SourceCode&& sourceCode);

    static void destroy(JSC::JSCell*);
    ~JSCommonJSModule();

    void clearSourceCode() { sourceCode = JSC::SourceCode(); }

    void finishCreation(JSC::VM& vm,
        JSC::JSString* id, JSValue filename,
        JSC::JSString* dirname, const JSC::SourceCode& sourceCode);

    static JSC::Structure* createStructure(JSC::JSGlobalObject* globalObject);

    void evaluate(Zig::GlobalObject* globalObject, const WTF::String& sourceURL, ResolvedSource& resolvedSource, bool isBuiltIn);
    void evaluateWithPotentiallyOverriddenCompile(Zig::GlobalObject* globalObject, const WTF::String& sourceURL, JSValue keyJSString, ResolvedSource& resolvedSource);
    inline void evaluate(Zig::GlobalObject* globalObject, const WTF::String& sourceURL, ResolvedSource& resolvedSource)
    {
        return evaluate(globalObject, sourceURL, resolvedSource, false);
    }

    static JSCommonJSModule* create(JSC::VM& vm, JSC::Structure* structure,
        JSC::JSString* id,
        JSValue filename,
        JSC::JSString* dirname, const JSC::SourceCode& sourceCode);

    static JSCommonJSModule* create(
        Zig::GlobalObject* globalObject,
        const WTF::String& key,
        JSValue exportsObject, bool hasEvaluated, JSValue parent);

    static JSCommonJSModule* create(
        Zig::GlobalObject* globalObject,
        JSC::JSString* key,
        JSValue exportsObject, bool hasEvaluated, JSValue parent);

    static JSCommonJSModule* create(
        Zig::GlobalObject* globalObject,
        const WTF::String& key,
        ResolvedSource resolvedSource);

    static JSObject* createBoundRequireFunction(VM& vm, JSGlobalObject* lexicalGlobalObject, const WTF::String& pathString);

    void toSyntheticSource(JSC::JSGlobalObject* globalObject,
        const JSC::Identifier& moduleKey,
        Vector<JSC::Identifier, 4>& exportNames,
        JSC::MarkedArgumentBuffer& exportValues);

    JSValue exportsObject()
    {
        return this->get(globalObject(), JSC::PropertyName(WebCore::clientData(vm())->builtinNames().exportsPublicName()));
    }
    void setExportsObject(JSC::JSValue exportsObject);
    JSValue idOrDot() { return m_id.get(); }
    JSValue filename() { return m_filename.get(); }

    bool load(JSC::VM& vm, Zig::GlobalObject* globalObject);

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
            [](auto& spaces) { return spaces.m_clientSubspaceForJSCommonJSModule.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSCommonJSModule = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSCommonJSModule.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSCommonJSModule = std::forward<decltype(space)>(space); });
    }

    bool hasEvaluated = false;

    JSCommonJSModule(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

JSC::Structure* createCommonJSModuleStructure(
    Zig::GlobalObject* globalObject);

std::optional<JSC::SourceCode> createCommonJSModule(
    Zig::GlobalObject* globalObject,
    JSC::JSString* specifierValue,
    ResolvedSource& source,
    bool isBuiltIn);

inline std::optional<JSC::SourceCode> createCommonJSModule(
    Zig::GlobalObject* globalObject,
    JSC::JSString* specifierValue,
    ResolvedSource& source)
{
    return createCommonJSModule(globalObject, specifierValue, source, false);
}

class RequireResolveFunctionPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static RequireResolveFunctionPrototype* create(JSC::JSGlobalObject* globalObject);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

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
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject);

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
