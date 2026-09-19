#pragma once
#include "root.h"

#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSString.h"
#include "headers-handwritten.h"
#include "wtf/HashSet.h"
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
class JSModuleGraph;

using namespace JSC;

// What `require("module").wrapper` reports and every CommonJS module body is wrapped in unless that is overridden.
static constexpr ASCIILiteral commonJSDefaultWrapperStart = "(function(exports,require,module,__filename,__dirname){"_s;
static constexpr ASCIILiteral commonJSDefaultWrapperEnd = "})"_s;

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
    // Vector of pointers, each child once (see addChild). If accessed, the
    // array is moved into JavaScript.
    // `m_childrenValue` can be set to any value via the user-exposed setter,
    // but Bun does not test that behavior besides ensuring it does not crash.
    mutable JSC::WriteBarrier<Unknown> m_childrenValue;
    // This must be WriteBarrier<Unknown> to compile; always JSCommonJSModule
    // Only addChild and clearChildren change it.
    WTF::Vector<WriteBarrier<Unknown>> m_children;
    // Hash index of m_children once it is long (see addChild). m_children keeps the cells alive, and visitChildren does not read it, so it needs no cellLock().
    std::unique_ptr<WTF::HashSet<JSC::JSCell*>> m_childrenIndex;

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
    // The Bun.ModuleGraph the module belongs to (what loaded it, or the module that
    // required it, did): its require cache, its loader for require(esm), and the scope its
    // wrapper closes over are the graph's. Null: the global object's.
    JSC::WriteBarrier<JSModuleGraph> m_moduleGraph;

    bool ignoreESModuleAnnotation { false };
    bool hasEvaluated = false;
    JSC::SourceCode sourceCode = JSC::SourceCode();

    static size_t estimatedSize(JSC::JSCell* cell, JSC::VM& vm);

    static void destroy(JSC::JSCell*);
    ~JSCommonJSModule();

    void finishCreation(JSC::VM& vm, const JSC::SourceCode& sourceCode);

    static JSC::Structure* createStructure(JSC::JSGlobalObject* globalObject);

    void evaluate(Zig::GlobalObject* globalObject, const WTF::String& sourceURL, ResolvedSource& resolvedSource, bool isBuiltIn);
    void evaluate(Zig::GlobalObject* globalObject, Ref<JSC::SourceProvider>&& sourceProvider, bool ignoreESModuleAnnotation);
    void evaluateWithPotentiallyOverriddenCompile(Zig::GlobalObject* globalObject, const WTF::String& sourceURL, JSValue keyJSString, ResolvedSource& resolvedSource);
    inline void evaluate(Zig::GlobalObject* globalObject, const WTF::String& sourceURL, ResolvedSource& resolvedSource)
    {
        return evaluate(globalObject, sourceURL, resolvedSource, false);
    }

    static JSCommonJSModule* create(JSC::VM& vm, JSC::Structure* structure,
        JSC::JSString* id,
        JSValue filename,
        JSC::JSString* dirname, const JSC::SourceCode& sourceCode, JSModuleGraph* = nullptr);

    static JSCommonJSModule* create(
        Zig::GlobalObject* globalObject,
        const WTF::String& key,
        JSValue exportsObject, bool hasEvaluated, JSValue parent);

    static JSCommonJSModule* create(
        Zig::GlobalObject* globalObject,
        JSC::JSString* key,
        JSValue exportsObject, bool hasEvaluated, JSValue parent);

    static JSObject* createBoundRequireFunction(VM& vm, JSGlobalObject* lexicalGlobalObject, const WTF::String& pathString, JSModuleGraph* = nullptr);
    JSModuleGraph* moduleGraph() const { return m_moduleGraph.get(); }
    void setModuleGraph(JSC::VM&, JSModuleGraph*);

    void toSyntheticSource(JSC::JSGlobalObject* globalObject,
        const JSC::Identifier& moduleKey,
        Vector<JSC::Identifier, 4>& exportNames,
        JSC::MarkedArgumentBuffer& exportValues);

    JSValue exportsObject()
    {
        return this->get(globalObject(), JSC::PropertyName(WebCore::clientData(vm())->builtinNames().exportsPublicName()));
    }
    void setExportsObject(JSC::JSValue exportsObject);
    JSValue filename() { return m_filename.get(); }

    bool load(JSC::VM& vm, Zig::GlobalObject* globalObject);

    // Appends `child` to m_children unless it is already there.
    void addChild(JSC::VM& vm, JSC::JSCell* child);
    // Empties m_children and m_childrenIndex. `module.children` then lives in m_childrenValue.
    void clearChildren();

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static void analyzeHeap(JSCell*, JSC::HeapAnalyzer&);

    template<typename, SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSCommonJSModule, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSCommonJSModule, m_subspaceForJSCommonJSModule));
    }

    JSCommonJSModule(JSC::VM& vm, JSC::Structure* structure, JSC::JSString* id, JSC::JSValue filename, JSC::JSString* dirname)
        : Base(vm, structure)
        , m_id(id, JSC::WriteBarrierEarlyInit)
        , m_filename(filename, JSC::WriteBarrierEarlyInit)
        , m_dirname(dirname, JSC::WriteBarrierEarlyInit)
    {
    }
};

JSC::Structure* createCommonJSModuleStructure(
    Zig::GlobalObject* globalObject);

// A `require.cache` object over `requireMap`: the global one, or a Bun.ModuleGraph's
// together with one of the graph's modules (whose loader's ES modules it also lists).
JSC::JSValue createRequireCacheObject(JSC::JSGlobalObject*, JSC::JSMap* requireMap, JSCommonJSModule* owner = nullptr);

// `graph`: the Bun.ModuleGraph whose loader is importing the file (the module goes in
// its require cache), or null for the global object's loader.
std::optional<JSC::SourceCode> createCommonJSModule(
    Zig::GlobalObject* globalObject,
    JSModuleGraph* graph,
    JSC::JSString* specifierValue,
    ResolvedSource& source,
    bool isBuiltIn);

std::optional<JSC::SourceCode> createCommonJSModule(
    Zig::GlobalObject* globalObject,
    JSModuleGraph* graph,
    JSC::JSString* specifierValue,
    Ref<JSC::SourceProvider>&& provider,
    bool ignoreESModuleAnnotation);

inline std::optional<JSC::SourceCode> createCommonJSModule(
    Zig::GlobalObject* globalObject,
    JSModuleGraph* graph,
    JSC::JSString* specifierValue,
    ResolvedSource& source)
{
    return createCommonJSModule(globalObject, graph, specifierValue, source, false);
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
