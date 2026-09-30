#include "BunPlugin.h"

#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/ExceptionScope.h"
#include "JavaScriptCore/JSCast.h"
#include "headers-handwritten.h"
#include "helpers.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/ModuleRegistryEntry.h>
#include <JavaScriptCore/CyclicModuleRecord.h>
#include <JavaScriptCore/JSModuleEnvironment.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/JSModuleRecord.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/SymbolTable.h>
#include <JavaScriptCore/SyntheticModuleRecord.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSTypeInfo.h>
#include <JavaScriptCore/JavaScript.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/RegExpObject.h>
#include <JavaScriptCore/RegularExpression.h>
#include <JavaScriptCore/SourceOrigin.h>
#include <JavaScriptCore/Structure.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/text/WTFString.h>

#include "BunClientData.h"
#include "JSCommonJSModule.h"
#include "isBuiltinModule.h"
#include "AsyncContextFrame.h"
#include "ImportMetaObject.h"
#include "JSMockFunction.h"

extern "C" bool Bun__Jest__moduleMockIsPersistent(JSC::JSGlobalObject*);

namespace Zig {

extern "C" void Bun__onDidAppendPlugin(void* bunVM, JSGlobalObject* globalObject);
using OnAppendPluginCallback = void (*)(void*, JSGlobalObject* globalObject);

static bool isValidNamespaceString(String& namespaceString)
{
    static JSC::Yarr::RegularExpression* namespaceRegex = nullptr;
    if (!namespaceRegex) {
        namespaceRegex = new JSC::Yarr::RegularExpression("^([/@a-zA-Z0-9_\\-]+)$"_s);
    }
    return namespaceRegex->match(namespaceString) > -1;
}

static JSC::EncodedJSValue jsFunctionAppendOnLoadPluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target, BunPlugin::Base& plugin, void* ctx, OnAppendPluginCallback callback)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callframe->argumentCount() < 2) {
        throwException(globalObject, scope, createError(globalObject, "onLoad() requires at least 2 arguments"_s));
        return {};
    }

    auto* filterObject = callframe->uncheckedArgument(0).toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::RegExpObject* filter = nullptr;
    auto filterValue = filterObject->getIfPropertyExists(globalObject, Identifier::fromString(vm, "filter"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (filterValue) {
        if (filterValue.isCell() && filterValue.asCell()->inherits<JSC::RegExpObject>())
            filter = uncheckedDowncast<JSC::RegExpObject>(filterValue);
    }

    if (!filter) {
        throwException(globalObject, scope, createError(globalObject, "onLoad() expects first argument to be an object with a filter RegExp"_s));
        return {};
    }

    String namespaceString = String();
    auto namespaceValue = filterObject->getIfPropertyExists(globalObject, Identifier::fromString(vm, "namespace"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (namespaceValue) {
        if (namespaceValue.isString()) {
            namespaceString = namespaceValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (!isValidNamespaceString(namespaceString)) {
                throwException(globalObject, scope, createError(globalObject, "namespace can only contain letters, numbers, dashes, or underscores"_s));
                return {};
            }
        }
    }

    auto func = callframe->uncheckedArgument(1);

    if (!func.isCell() || !func.isCallable()) {
        throwException(globalObject, scope, createError(globalObject, "onLoad() expects second argument to be a function"_s));
        return {};
    }

    plugin.append(vm, filter->regExp(), func.getObject(), namespaceString);
    callback(ctx, globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(callframe->thisValue());
}

static EncodedJSValue jsFunctionAppendVirtualModulePluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callframe->argumentCount() < 2) {
        throwException(globalObject, scope, createError(globalObject, "module() needs 2 arguments: a module ID and a function to call"_s));
        return {};
    }

    JSValue moduleIdValue = callframe->uncheckedArgument(0);
    JSValue functionValue = callframe->uncheckedArgument(1);

    if (!moduleIdValue.isString()) {
        throwException(globalObject, scope, createError(globalObject, "module() expects first argument to be a string for the module ID"_s));
        return {};
    }

    if (!functionValue.isCallable()) {
        throwException(globalObject, scope, createError(globalObject, "module() expects second argument to be a function"_s));
        return {};
    }

    String moduleId = moduleIdValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (moduleId.isEmpty()) {
        throwException(globalObject, scope, createError(globalObject, "virtual module cannot be blank"_s));
        return {};
    }

    if (Bun::isBuiltinModule(moduleId)) {
        throwException(globalObject, scope, createError(globalObject, makeString("module() cannot be used to override builtin module \""_s, moduleId, "\""_s)));
        return {};
    }

    if (moduleId.startsWith("."_s)) {
        throwException(globalObject, scope, createError(globalObject, "virtual module cannot start with \".\""_s));
        return {};
    }

    Zig::GlobalObject* global = defaultGlobalObject(globalObject);

    if (global->onLoadPlugins.virtualModules == nullptr) {
        global->onLoadPlugins.virtualModules = new BunPlugin::VirtualModuleMap;
    }
    auto* virtualModules = global->onLoadPlugins.virtualModules;

    virtualModules->set(moduleId, JSC::Strong<JSC::JSObject> { vm, uncheckedDowncast<JSC::JSObject>(functionValue) });

    auto* requireMap = global->requireMap();
    RETURN_IF_EXCEPTION(scope, {});
    requireMap->remove(globalObject, moduleIdValue);
    RETURN_IF_EXCEPTION(scope, {});

    if (moduleIdValue.isString()) {
        auto idIdent = JSC::Identifier::fromString(vm, asString(moduleIdValue)->value(globalObject));
        RETURN_IF_EXCEPTION(scope, {});
        global->moduleLoader()->removeEntry(idIdent); // takes the loader's cellLock itself
    }

    return JSValue::encode(callframe->thisValue());
}

static JSC::EncodedJSValue jsFunctionAppendOnResolvePluginBody(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target, BunPlugin::Base& plugin, void* ctx, OnAppendPluginCallback callback)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callframe->argumentCount() < 2) {
        throwException(globalObject, scope, createError(globalObject, "onResolve() requires at least 2 arguments"_s));
        return {};
    }

    auto* filterObject = callframe->uncheckedArgument(0).toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::RegExpObject* filter = nullptr;
    auto filterValue = filterObject->getIfPropertyExists(globalObject, Identifier::fromString(vm, "filter"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (filterValue) {
        if (filterValue.isCell() && filterValue.asCell()->inherits<JSC::RegExpObject>())
            filter = uncheckedDowncast<JSC::RegExpObject>(filterValue);
    }

    if (!filter) {
        throwException(globalObject, scope, createError(globalObject, "onResolve() expects first argument to be an object with a filter RegExp"_s));
        return {};
    }

    String namespaceString = String();
    auto namespaceValue = filterObject->getIfPropertyExists(globalObject, Identifier::fromString(vm, "namespace"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (namespaceValue) {
        if (namespaceValue.isString()) {
            namespaceString = namespaceValue.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (!isValidNamespaceString(namespaceString)) {
                throwException(globalObject, scope, createError(globalObject, "namespace can only contain letters, numbers, dashes, or underscores"_s));
                return {};
            }
        }
    }

    auto func = callframe->uncheckedArgument(1);

    if (!func.isCell() || !func.isCallable()) {
        throwException(globalObject, scope, createError(globalObject, "onResolve() expects second argument to be a function"_s));
        return {};
    }

    plugin.append(vm, filter->regExp(), uncheckedDowncast<JSObject>(func), namespaceString);
    callback(ctx, globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(callframe->thisValue());
}

static JSC::EncodedJSValue jsFunctionAppendOnResolvePluginGlobal(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target)
{
    Zig::GlobalObject* global = defaultGlobalObject(globalObject);

    auto& plugins = global->onResolvePlugins;
    auto callback = Bun__onDidAppendPlugin;
    return jsFunctionAppendOnResolvePluginBody(globalObject, callframe, target, plugins, global->bunVM(), callback);
}

static JSC::EncodedJSValue jsFunctionAppendOnLoadPluginGlobal(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target)
{
    Zig::GlobalObject* global = defaultGlobalObject(globalObject);

    auto& plugins = global->onLoadPlugins;
    auto callback = Bun__onDidAppendPlugin;
    return jsFunctionAppendOnLoadPluginBody(globalObject, callframe, target, plugins, global->bunVM(), callback);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendOnLoadPluginNode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return jsFunctionAppendOnLoadPluginGlobal(globalObject, callframe, BunPluginTargetNode);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendOnLoadPluginBun, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return jsFunctionAppendOnLoadPluginGlobal(globalObject, callframe, BunPluginTargetBun);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendOnLoadPluginBrowser, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return jsFunctionAppendOnLoadPluginGlobal(globalObject, callframe, BunPluginTargetBrowser);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendOnResolvePluginNode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return jsFunctionAppendOnResolvePluginGlobal(globalObject, callframe, BunPluginTargetNode);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendOnResolvePluginBun, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return jsFunctionAppendOnResolvePluginGlobal(globalObject, callframe, BunPluginTargetBun);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendVirtualModule, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return jsFunctionAppendVirtualModulePluginBody(globalObject, callframe);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionAppendOnResolvePluginBrowser, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return jsFunctionAppendOnResolvePluginGlobal(globalObject, callframe, BunPluginTargetBrowser);
}

/// `Bun.plugin()`
static inline JSC::EncodedJSValue setupBunPlugin(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callframe, BunPluginTarget target)
{
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callframe->argumentCount() < 1) {
        JSC::throwTypeError(globalObject, throwScope, "plugin needs at least one argument (an object)"_s);
        return {};
    }

    JSC::JSObject* obj = callframe->uncheckedArgument(0).getObject();
    if (!obj) {
        JSC::throwTypeError(globalObject, throwScope, "plugin needs an object as first argument"_s);
        return {};
    }

    JSC::JSValue setupFunctionValue = obj->getIfPropertyExists(globalObject, Identifier::fromString(vm, "setup"_s));
    RETURN_IF_EXCEPTION(throwScope, {});
    if (!setupFunctionValue || setupFunctionValue.isUndefinedOrNull() || !setupFunctionValue.isCell() || !setupFunctionValue.isCallable()) {
        JSC::throwTypeError(globalObject, throwScope, "plugin needs a setup() function"_s);
        return {};
    }

    auto targetValue = obj->getIfPropertyExists(globalObject, Identifier::fromString(vm, "target"_s));
    RETURN_IF_EXCEPTION(throwScope, {});
    if (targetValue) {
        auto* targetJSString = targetValue.toStringOrNull(globalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
        String targetString = targetJSString->value(globalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!(targetString == "node"_s || targetString == "bun"_s || targetString == "browser"_s)) {
            JSC::throwTypeError(globalObject, throwScope, "plugin target must be one of 'node', 'bun' or 'browser'"_s);
            return {};
        }
    }

    JSObject* builderObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 4);

    builderObject->putDirect(vm, Identifier::fromString(vm, "target"_s), jsString(vm, String("bun"_s)), 0);
    builderObject->putDirectNativeFunction(
        vm,
        globalObject,
        JSC::Identifier::fromString(vm, "onLoad"_s),
        1,
        jsFunctionAppendOnLoadPluginBun,
        ImplementationVisibility::Public,
        NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);
    builderObject->putDirectNativeFunction(
        vm,
        globalObject,
        JSC::Identifier::fromString(vm, "onResolve"_s),
        1,
        jsFunctionAppendOnResolvePluginBun,
        ImplementationVisibility::Public,
        NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    builderObject->putDirectNativeFunction(
        vm,
        globalObject,
        JSC::Identifier::fromString(vm, "module"_s),
        1,
        jsFunctionAppendVirtualModule,
        ImplementationVisibility::Public,
        NoIntrinsic,
        JSC::PropertyAttribute::DontDelete | 0);

    JSC::MarkedArgumentBuffer args;
    args.append(builderObject);

    JSObject* function = uncheckedDowncast<JSObject>(setupFunctionValue);
    JSC::CallData callData = JSC::getCallData(function);
    JSValue result = call(globalObject, function, callData, JSC::jsUndefined(), args);

    RETURN_IF_EXCEPTION(throwScope, {});

    if (auto* promise = dynamicDowncast<JSC::JSPromise>(result)) {
        RELEASE_AND_RETURN(throwScope, JSValue::encode(promise));
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
}

void BunPlugin::Group::append(JSC::VM& vm, JSC::RegExp* filter, JSC::JSObject* func)
{
    filters.append(JSC::Strong<JSC::RegExp> { vm, filter });
    callbacks.append(JSC::Strong<JSC::JSObject> { vm, func });
}

void BunPlugin::Base::append(JSC::VM& vm, JSC::RegExp* filter, JSC::JSObject* func, String& namespaceString)
{
    if (namespaceString.isEmpty() || namespaceString == "file"_s) {
        this->fileNamespace.append(vm, filter, func);
    } else if (auto found = this->group(namespaceString)) {
        found->append(vm, filter, func);
    } else {
        Group newGroup;
        newGroup.append(vm, filter, func);
        this->groups.append(WTF::move(newGroup));
        this->namespaces.append(namespaceString);
    }
}

JSC::JSObject* BunPlugin::Group::find(JSC::JSGlobalObject* globalObject, String& path)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    size_t count = filters.size();
    for (size_t i = 0; i < count; i++) {
        auto matchResult = filters[i].get()->match(globalObject, path, 0);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (matchResult) {
            return callbacks[i].get();
        }
    }

    return nullptr;
}

class JSModuleMock final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    mutable WriteBarrier<JSObject> callbackFunctionOrCachedResult;
    WriteBarrier<JSString> specifier;
    // The factory's promise is pending and will patch the already-loaded module when it settles.
    bool hasPendingPatch { false };
    bool hasCalledModuleMock = false;
    // Installed by preload or a file's top level (see Bun__Jest__moduleMockIsPersistent): mock.restore() keeps it.
    bool persistent = false;

    static JSModuleMock* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* callback, JSC::JSString* specifier);
    static Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    JSObject* executeOnce(JSC::JSGlobalObject* lexicalGlobalObject);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSModuleMock, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSModuleMock, m_subspaceForJSModuleMock));
    }

    void finishCreation(JSC::VM&);

private:
    JSModuleMock(JSC::VM&, JSC::Structure*, JSC::JSObject* callback, JSC::JSString* specifier);
};

// First write wins per binding / module / specifier. WriteBarriers owned by the global, visited and mutated under its cellLock (like RejectedPromiseQueue).
struct ModuleMockUndoLog {
    struct Binding {
        // Identity of the binding (a leaf record's local name), shared by every re-export of it.
        JSC::WriteBarrier<JSC::AbstractModuleRecord> record;
        JSC::Identifier localName;
        // How to write it back: overrideExportValue() through the namespace the mock went through.
        JSC::WriteBarrier<JSC::JSModuleNamespaceObject> ns;
        JSC::Identifier exportName;
        // Either the value itself, or (for a builtin export nobody had materialized) the object to read it from.
        JSC::WriteBarrier<JSC::Unknown> original;
        JSC::WriteBarrier<JSC::JSObject> lazySource;
    };
    struct CommonJS {
        JSC::WriteBarrier<Bun::JSCommonJSModule> module;
        JSC::WriteBarrier<JSC::Unknown> originalExports;
    };
    struct Installed {
        String specifier;
        // Persistent entry (a preload mock or Bun.plugin module) the test's mock displaced; null removes the key.
        JSC::WriteBarrier<JSC::JSObject> displaced;
    };
    // Not undo state: what a builtin's lazy exports are restored from, its `default` export as of the first mock touching it (null: unmaterialized itself by then).
    struct LazySource {
        JSC::WriteBarrier<JSC::SyntheticModuleRecord> record;
        JSC::WriteBarrier<JSC::JSObject> object;
    };

    Vector<Binding> bindings;
    Vector<CommonJS> commonJSModules;
    Vector<Installed> installed;
    Vector<LazySource> lazySources;

    size_t findBinding(JSC::AbstractModuleRecord* record, const JSC::Identifier& localName) const
    {
        return bindings.findIf([&](auto& entry) { return entry.record.get() == record && entry.localName == localName; });
    }
    size_t findCommonJS(Bun::JSCommonJSModule* module) const
    {
        return commonJSModules.findIf([&](auto& entry) { return entry.module.get() == module; });
    }
    size_t findInstalled(const String& specifier) const
    {
        return installed.findIf([&](auto& entry) { return entry.specifier == specifier; });
    }
    size_t findLazySource(JSC::SyntheticModuleRecord* record) const
    {
        return lazySources.findIf([&](auto& entry) { return entry.record.get() == record; });
    }

    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        for (auto& entry : bindings) {
            visitor.append(entry.record);
            visitor.append(entry.ns);
            visitor.append(entry.original);
            visitor.append(entry.lazySource);
        }
        for (auto& entry : commonJSModules) {
            visitor.append(entry.module);
            visitor.append(entry.originalExports);
        }
        for (auto& entry : installed)
            visitor.append(entry.displaced);
        for (auto& entry : lazySources) {
            visitor.append(entry.record);
            visitor.append(entry.object);
        }
    }

    size_t cellCount() const
    {
        return bindings.size() * 4 + commonJSModules.size() * 2 + installed.size();
    }

    // Moves the undo entries out (lazySources stays). The copy is not visited: `cells` keeps them alive for the caller.
    ModuleMockUndoLog take(JSC::JSCell* owner, JSC::MarkedArgumentBuffer& cells)
    {
        ModuleMockUndoLog taken;
        WTF::Locker locker { owner->cellLock() };
        for (auto& entry : bindings) {
            cells.append(entry.record.get());
            cells.append(entry.ns.get());
            cells.append(entry.original.get());
            cells.append(entry.lazySource.get());
        }
        for (auto& entry : commonJSModules) {
            cells.append(entry.module.get());
            cells.append(entry.originalExports.get());
        }
        for (auto& entry : installed)
            cells.append(entry.displaced.get());
        taken.bindings = std::exchange(bindings, {});
        taken.commonJSModules = std::exchange(commonJSModules, {});
        taken.installed = std::exchange(installed, {});
        return taken;
    }

    // Puts taken entries back ahead of what was logged since (an older entry for the same key wins), set through the owner again.
    void putBack(JSC::VM& vm, JSC::JSCell* owner, ModuleMockUndoLog& older, size_t firstBinding)
    {
        WTF::Locker locker { owner->cellLock() };
        Vector<Binding> newerBindings = std::exchange(bindings, {});
        Vector<CommonJS> newerCommonJS = std::exchange(commonJSModules, {});
        Vector<Installed> newerInstalled = std::exchange(installed, {});
        for (size_t i = firstBinding; i < older.bindings.size(); ++i) {
            auto& entry = older.bindings[i];
            bindings.append({});
            auto& restored = bindings.last();
            restored.record.set(vm, owner, entry.record.get());
            restored.localName = entry.localName;
            restored.ns.set(vm, owner, entry.ns.get());
            restored.exportName = entry.exportName;
            restored.original.set(vm, owner, entry.original.get());
            restored.lazySource.setMayBeNull(vm, owner, entry.lazySource.get());
        }
        for (auto& entry : older.commonJSModules) {
            commonJSModules.append({});
            commonJSModules.last().module.set(vm, owner, entry.module.get());
            commonJSModules.last().originalExports.set(vm, owner, entry.originalExports.get());
        }
        for (auto& entry : older.installed) {
            installed.append({ entry.specifier, {} });
            installed.last().displaced.setMayBeNull(vm, owner, entry.displaced.get());
        }
        for (auto& entry : newerBindings) {
            if (findBinding(entry.record.get(), entry.localName) == notFound)
                bindings.append(WTF::move(entry));
        }
        for (auto& entry : newerCommonJS) {
            if (findCommonJS(entry.module.get()) == notFound)
                commonJSModules.append(WTF::move(entry));
        }
        for (auto& entry : newerInstalled) {
            if (findInstalled(entry.specifier) == notFound)
                installed.append(WTF::move(entry));
        }
    }
};

static ModuleMockUndoLog& ensureUndoLog(Zig::GlobalObject* globalObject)
{
    auto& onLoad = globalObject->onLoadPlugins;
    if (!onLoad.moduleMockUndoLog) {
        auto* log = new ModuleMockUndoLog;
        // Published under the lock the visitor takes before it reads the pointer.
        WTF::Locker locker { globalObject->cellLock() };
        onLoad.moduleMockUndoLog = log;
    }
    return *onLoad.moduleMockUndoLog;
}

template<typename Visitor>
void BunPlugin::OnLoad::visitModuleMockUndoLog(JSC::JSCell* owner, Visitor& visitor)
{
    WTF::Locker locker { owner->cellLock() };
    if (moduleMockUndoLog)
        moduleMockUndoLog->visit(visitor);
}

template void BunPlugin::OnLoad::visitModuleMockUndoLog(JSC::JSCell*, JSC::AbstractSlotVisitor&);
template void BunPlugin::OnLoad::visitModuleMockUndoLog(JSC::JSCell*, JSC::SlotVisitor&);

BunPlugin::OnLoad::~OnLoad()
{
    delete virtualModules;
    delete moduleMockUndoLog;
}

void BunPlugin::OnLoad::clearVirtualModules(JSC::JSCell* owner)
{
    delete virtualModules;
    virtualModules = nullptr;
    // The entries these would put back or remove are gone with the map.
    if (moduleMockUndoLog) {
        WTF::Locker locker { owner->cellLock() };
        moduleMockUndoLog->installed.clear();
    }
}

void BunPlugin::OnLoad::addModuleMock(Zig::GlobalObject* globalObject, const String& path, JSC::JSObject* mockObject)
{
    auto& vm = JSC::getVM(globalObject);
    if (!virtualModules)
        virtualModules = new BunPlugin::VirtualModuleMap;

    auto* mock = uncheckedDowncast<JSModuleMock>(mockObject);
    auto existing = virtualModules->find(path);
    JSObject* current = existing != virtualModules->end() ? existing->value.get() : nullptr;

    auto& log = ensureUndoLog(globalObject);
    if (mock->persistent) {
        // File-level setup supersedes whatever an earlier test left behind for this specifier.
        if (size_t index = log.findInstalled(path); index != notFound) {
            WTF::Locker locker { globalObject->cellLock() };
            log.installed.removeAt(index);
        }
    } else if (log.findInstalled(path) == notFound) {
        auto* currentMock = dynamicDowncast<JSModuleMock>(current);
        bool currentIsPersistent = current && (!currentMock || currentMock->persistent);
        WTF::Locker locker { globalObject->cellLock() };
        log.installed.append({ path, {} });
        if (currentIsPersistent)
            log.installed.last().displaced.set(vm, globalObject, current);
    }

    virtualModules->set(path, JSC::Strong<JSC::JSObject> { vm, mockObject });
}

const JSC::ClassInfo JSModuleMock::s_info = { "ModuleMock"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleMock) };

JSModuleMock* JSModuleMock::create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* callback, JSC::JSString* specifier)
{
    JSModuleMock* ptr = new (NotNull, JSC::allocateCell<JSModuleMock>(vm)) JSModuleMock(vm, structure, callback, specifier);
    ptr->finishCreation(vm);
    return ptr;
}

void JSModuleMock::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
}

JSModuleMock::JSModuleMock(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* callback, JSC::JSString* specifier)
    : Base(vm, structure)
    , callbackFunctionOrCachedResult(callback, JSC::WriteBarrierEarlyInit)
    , specifier(specifier, JSC::WriteBarrierEarlyInit)
{
}

Structure* JSModuleMock::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

static void throwFactoryMustReturnObject(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope)
{
    JSC::throwTypeError(globalObject, scope, "mock(module, fn) requires a function that returns an object"_s);
}

JSObject* JSModuleMock::executeOnce(JSC::JSGlobalObject* lexicalGlobalObject)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (hasCalledModuleMock) {
        return callbackFunctionOrCachedResult.get();
    }

    hasCalledModuleMock = true;

    if (!callbackFunctionOrCachedResult) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "Cannot call mock without a callback"_s));
        return nullptr;
    }

    JSC::JSValue callbackValue = callbackFunctionOrCachedResult.get();
    if (!callbackValue.isCell() || !callbackValue.isCallable()) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a function"_s));
        return nullptr;
    }

    JSObject* callback = callbackValue.getObject();
    JSC::JSValue result = JSC::profiledCall(lexicalGlobalObject, ProfilingReason::API, callback, JSC::getCallData(callback), JSC::jsUndefined(), ArgList());
    RETURN_IF_EXCEPTION(scope, {});

    if (!result.isObject()) {
        throwFactoryMustReturnObject(lexicalGlobalObject, scope);
        return nullptr;
    }

    auto* object = result.getObject();
    this->callbackFunctionOrCachedResult.set(vm, this, object);

    return object;
}

struct ExportBinding {
    JSC::AbstractModuleRecord* record = nullptr;
    // The binding's own name inside `record`; differs from the export name across `export { a as b }`.
    JSC::Identifier localName;
    // Empty for a lazy builtin export nothing has materialized yet (see SyntheticModuleRecord::materializeLazyExport).
    JSC::JSValue value;
};

// Reads the slot an export currently binds to. Unlike namespace->get(), this never runs a lazy export's getter.
static std::optional<ExportBinding> readExportBinding(JSC::JSGlobalObject* globalObject, JSC::AbstractModuleRecord* record, const JSC::Identifier& exportName)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto resolution = record->resolveExport(globalObject, exportName);
    RETURN_IF_EXCEPTION(scope, std::nullopt);
    if (resolution.type != JSC::AbstractModuleRecord::Resolution::Type::Resolved)
        return std::nullopt;
    auto* environment = resolution.moduleRecord->moduleEnvironmentMayBeNull();
    if (!environment)
        return std::nullopt;
    JSC::SymbolTable& symbolTable = *environment->symbolTable();
    JSC::ConcurrentJSLocker locker(symbolTable.m_lock);
    auto iter = symbolTable.find(locker, resolution.localName.impl());
    if (iter == symbolTable.end(locker))
        return std::nullopt;
    JSC::ScopeOffset offset = iter->value.scopeOffset();
    if (!environment->isValidScopeOffset(offset))
        return std::nullopt;
    return ExportBinding { resolution.moduleRecord, resolution.localName, environment->variableAt(offset).get() };
}

// Sees through a spy on this binding (restore clears spies before it replays the log); a spy on anything else is the value.
static JSC::JSValue valueBeneathSpy(JSC::JSGlobalObject* globalObject, const ExportBinding& binding)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto spy = Bun::moduleExportSpy(binding.value);
    if (!spy)
        return binding.value;
    auto spied = readExportBinding(globalObject, spy->ns->moduleRecord(), spy->exportName);
    RETURN_IF_EXCEPTION(scope, {});
    if (!spied || spied->record != binding.record || spied->localName != binding.localName)
        return binding.value;
    return spy->original;
}

// Every override is preceded by a note, so the first note on a module reads a `default` no mock has replaced yet.
static JSC::JSObject* lazySourceFor(Zig::GlobalObject* globalObject, ModuleMockUndoLog& log, JSC::SyntheticModuleRecord* record)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    size_t index = log.findLazySource(record);
    if (index == notFound) {
        auto defaultBinding = readExportBinding(globalObject, record, vm.propertyNames->defaultKeyword);
        RETURN_IF_EXCEPTION(scope, nullptr);
        JSC::JSObject* object = nullptr;
        if (defaultBinding && defaultBinding->value) {
            JSValue value = valueBeneathSpy(globalObject, *defaultBinding);
            RETURN_IF_EXCEPTION(scope, nullptr);
            object = value.getObject();
        }
        index = log.lazySources.size();
        WTF::Locker locker { globalObject->cellLock() };
        log.lazySources.append({});
        log.lazySources.last().record.set(vm, globalObject, record);
        log.lazySources.last().object.setMayBeNull(vm, globalObject, object);
    }
    return log.lazySources[index].object.get();
}

// Before a mock overwrites a binding: a test's mock logs its current value (first write wins), a persistent mock unlogs it (new baseline).
static void noteBindingBeforeOverride(Zig::GlobalObject* globalObject, ModuleMockUndoLog& log, JSC::JSModuleNamespaceObject* ns, const JSC::Identifier& exportName, bool persistent)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto binding = readExportBinding(globalObject, ns->moduleRecord(), exportName);
    RETURN_IF_EXCEPTION(scope, void());
    // Not an export of this module; overrideExportValue will not write it either.
    if (!binding)
        return;

    JSC::JSObject* lazySource = nullptr;
    if (auto* synthetic = dynamicDowncast<JSC::SyntheticModuleRecord>(binding->record); synthetic && synthetic->hasLazyExports()) {
        lazySource = lazySourceFor(globalObject, log, synthetic);
        RETURN_IF_EXCEPTION(scope, void());
    }

    size_t logged = log.findBinding(binding->record, binding->localName);
    if (persistent) {
        if (logged != notFound) {
            WTF::Locker locker { globalObject->cellLock() };
            log.bindings.removeAt(logged);
        }
        return;
    }
    if (logged != notFound)
        return;

    JSValue original;
    if (binding->value) {
        original = valueBeneathSpy(globalObject, *binding);
        RETURN_IF_EXCEPTION(scope, void());
    } else if (!lazySource) {
        // Empty slot: a builtin export gets restored by reading it off the source object; without one (TDZ binding, or `default` unmaterialized too) the mock stays.
        return;
    }

    WTF::Locker locker { globalObject->cellLock() };
    log.bindings.append({});
    auto& entry = log.bindings.last();
    entry.record.set(vm, globalObject, binding->record);
    entry.localName = binding->localName;
    entry.ns.set(vm, globalObject, ns);
    entry.exportName = exportName;
    if (original)
        entry.original.set(vm, globalObject, original);
    else
        entry.lazySource.set(vm, globalObject, lazySource);
}

static void noteCommonJSBeforeOverride(Zig::GlobalObject* globalObject, ModuleMockUndoLog& log, Bun::JSCommonJSModule* module, bool persistent)
{
    auto& vm = JSC::getVM(globalObject);
    size_t logged = log.findCommonJS(module);
    if (persistent) {
        if (logged != notFound) {
            WTF::Locker locker { globalObject->cellLock() };
            log.commonJSModules.removeAt(logged);
        }
        return;
    }
    if (logged != notFound)
        return;
    // Source not run yet: it is evaluated from the mock, like a module the mock creates, and keeps it.
    if (!module->hasEvaluated && !module->sourceCode.isNull())
        return;
    // module.exports is always a data property of ours (see JSCommonJSModule::setExportsObject).
    JSValue exports = module->getDirect(vm, Bun::builtinNames(vm).exportsPublicName());
    if (!exports || exports.isGetterSetter())
        return;
    WTF::Locker locker { globalObject->cellLock() };
    log.commonJSModules.append({});
    log.commonJSModules.last().module.set(vm, globalObject, module);
    log.commonJSModules.last().originalExports.set(vm, globalObject, exports);
}

struct LoadedModule {
    JSC::JSModuleNamespaceObject* esmNamespace { nullptr };
    Bun::JSCommonJSModule* commonJSModule { nullptr };
    // In the registry / require.cache with nothing to patch: removed so the next import loads the mock.
    bool staleESMEntry { false };
    bool staleCommonJSEntry { false };
};

static void findLoadedESModule(Zig::GlobalObject* globalObject, JSC::JSString* specifierString, LoadedModule& loaded)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    loaded.esmNamespace = nullptr;
    loaded.staleESMEntry = false;

    auto specifierIdent = JSC::Identifier::fromString(vm, specifierString->value(globalObject));
    RETURN_IF_EXCEPTION(scope, );
    auto* entry = globalObject->moduleLoader()->registryEntry(specifierIdent);
    if (!entry)
        return;

    loaded.staleESMEntry = true;
    if (auto* mod = entry->record()) {
        // getModuleNamespace asserts the record has progressed past linking.
        // A previous import that failed during link (e.g. unresolved binding)
        // leaves the record at New/Unlinked; in that case there is no
        // namespace to patch — drop the stale entry so the mock takes over
        // on the next import.
        bool linked = true;
        if (auto* cyclic = dynamicDowncast<JSC::CyclicModuleRecord>(mod))
            linked = cyclic->status() >= JSC::CyclicModuleRecord::Status::Linked;
        if (linked) {
            loaded.esmNamespace = mod->getModuleNamespace(globalObject);
            RETURN_IF_EXCEPTION(scope, );
            if (loaded.esmNamespace)
                loaded.staleESMEntry = false;
        }
    }
}

static void findLoadedCommonJSModule(Zig::GlobalObject* globalObject, JSC::JSString* specifierString, LoadedModule& loaded)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    loaded.commonJSModule = nullptr;
    loaded.staleCommonJSEntry = false;

    JSValue entryValue = globalObject->requireMap()->get(globalObject, specifierString);
    RETURN_IF_EXCEPTION(scope, );
    if (entryValue) {
        loaded.commonJSModule = dynamicDowncast<Bun::JSCommonJSModule>(entryValue);
        loaded.staleCommonJSEntry = !loaded.commonJSModule;
    }
}

static LoadedModule findLoadedModule(Zig::GlobalObject* globalObject, JSC::JSString* specifierString)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    LoadedModule loaded;
    findLoadedESModule(globalObject, specifierString, loaded);
    RETURN_IF_EXCEPTION(scope, {});
    findLoadedCommonJSModule(globalObject, specifierString, loaded);
    RETURN_IF_EXCEPTION(scope, {});
    return loaded;
}

// `persistent` is the mock's (JSModuleMock::persistent): a pending factory patches with the phase its mock.module() call ran in.
static void overrideLoadedModuleExports(Zig::GlobalObject* globalObject, const LoadedModule& loaded, JSC::JSObject* exports, bool persistent)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ModuleMockUndoLog& undoLog = ensureUndoLog(globalObject);

    if (auto* moduleNamespaceObject = loaded.esmNamespace) {
        JSC::PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        // Via the method table so a module namespace object (`() => import("./mocked")`) lists its exports.
        exports->methodTable()->getOwnPropertyNames(exports, globalObject, names, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, );

        // Read every export before overriding any, so a throwing getter leaves the
        // namespace untouched.
        MarkedArgumentBuffer values;
        values.ensureCapacity(names.size());
        for (auto& name : names) {
            JSValue value = exports->get(globalObject, name);
            RETURN_IF_EXCEPTION(scope, );
            values.append(value);
        }
        if (values.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return;
        }
        for (size_t i = 0; i < names.size(); ++i) {
            noteBindingBeforeOverride(globalObject, undoLog, moduleNamespaceObject, names[i], persistent);
            RETURN_IF_EXCEPTION(scope, );
            moduleNamespaceObject->overrideExportValue(globalObject, names[i], values.at(i));
            RETURN_IF_EXCEPTION(scope, );
        }
    }

    if (auto* moduleObject = loaded.commonJSModule) {
        noteCommonJSBeforeOverride(globalObject, undoLog, moduleObject, persistent);
        moduleObject->putDirect(vm, Bun::builtinNames(vm).exportsPublicName(), exports, 0);
        moduleObject->hasEvaluated = true;
    }
}

BUN_DECLARE_HOST_FUNCTION(JSMock__jsModuleMock);
extern "C" JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(JSMock__jsModuleMock, __attribute__((minsize)), (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!globalObject) [[unlikely]] {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "Cannot run mock from a different global context"_s));
        return {};
    }

    if (callframe->argumentCount() < 1) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a module and function"_s));
        return {};
    }

    if (!callframe->argument(0).isString()) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a module name string"_s));
        return {};
    }

    JSC::JSString* specifierString = callframe->argument(0).toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    WTF::String specifier = specifierString->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    if (specifier.isEmpty()) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a module and function"_s));
        return {};
    }

    JSC::JSValue callbackValue = callframe->argument(1);
    if (!callbackValue.isCell() || !callbackValue.isCallable()) {
        scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "mock(module, fn) requires a function"_s));
        return {};
    }

    auto resolveSpecifier = [&]() -> void {
        JSC::SourceOrigin sourceOrigin = callframe->callerSourceOrigin(vm);
        if (sourceOrigin.isNull())
            return;
        const URL& url = sourceOrigin.url();

        if (specifier.startsWith("file:"_s)) {
            URL fileURL = URL(url, specifier);
            if (fileURL.isValid()) {
                specifier = fileURL.fileSystemPath();
                specifierString = jsString(vm, specifier);
                globalObject->onLoadPlugins.mustDoExpensiveRelativeLookup = true;
                return;
            } else {
                scope.throwException(lexicalGlobalObject, JSC::createTypeError(lexicalGlobalObject, "Invalid \"file:\" URL"_s));
                return;
            }
        }

        if (url.isValid() && url.protocolIsFile()) {
            auto fromString = url.fileSystemPath();
            BunString from = Bun::toString(fromString);
            // Not resolving is fine (mocking a module that does not exist yet); anything else thrown
            // while resolving (e.g. by an onResolve plugin) propagates.
            auto result = JSValue::decode(Bun__resolveSyncWithSourceIfExists(globalObject, JSValue::encode(specifierString), &from, true));
            RETURN_IF_EXCEPTION(scope, );

            if (result.isString()) {
                auto* specifierStr = asString(result);
                if (specifierStr->length() > 0) {
                    specifierString = specifierStr;
                    specifier = specifierString->value(globalObject);
                }
            } else if (specifier.startsWith("./"_s) || specifier.startsWith(".."_s)) {
                // If module resolution fails, we try to resolve it relative to the current file
                auto relativeURL = URL(url, specifier);

                if (relativeURL.isValid()) {
                    globalObject->onLoadPlugins.mustDoExpensiveRelativeLookup = true;

                    if (relativeURL.protocolIsFile())
                        specifier = relativeURL.fileSystemPath();
                    else
                        specifier = relativeURL.string();

                    specifierString = jsString(vm, specifier);
                }
            }
        }
    };

    resolveSpecifier();
    RETURN_IF_EXCEPTION(scope, {});

    JSC::JSObject* callback = callbackValue.getObject();

    JSModuleMock* mock = JSModuleMock::create(vm, globalObject->mockModule.mockModuleStructure.getInitializedOnMainThread(globalObject), callback, specifierString);
    mock->persistent = Bun__Jest__moduleMockIsPersistent(globalObject);

    LoadedModule loaded = findLoadedModule(globalObject, specifierString);
    RETURN_IF_EXCEPTION(scope, {});

    JSC::JSPromise* pendingFactory = nullptr;
    if (loaded.esmNamespace || loaded.commonJSModule) {
        JSValue exportsValue = mock->executeOnce(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        if (auto* promise = dynamicDowncast<JSC::JSPromise>(exportsValue)) {
            switch (promise->status()) {
            case JSC::JSPromise::Status::Rejected: {
                promise->markAsHandled();
                scope.throwException(globalObject, promise->result());
                return {};
            }
            case JSC::JSPromise::Status::Fulfilled: {
                exportsValue = promise->result();
                break;
            }
            case JSC::JSPromise::Status::Pending: {
                pendingFactory = promise;
                break;
            }
            }
        }

        // The factory may have require()d the module itself: `() => ({ ...require("./m"), extra })`.
        findLoadedCommonJSModule(globalObject, specifierString, loaded);
        RETURN_IF_EXCEPTION(scope, {});

        if (!pendingFactory) {
            if (!exportsValue.isObject()) {
                throwFactoryMustReturnObject(globalObject, scope);
                return {};
            }
            overrideLoadedModuleExports(globalObject, loaded, exportsValue.getObject(), mock->persistent);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    if (loaded.staleESMEntry) {
        auto specifierIdent = JSC::Identifier::fromString(vm, specifier);
        globalObject->moduleLoader()->removeEntry(specifierIdent); // takes the loader's cellLock itself
    }

    if (loaded.staleCommonJSEntry) {
        globalObject->requireMap()->remove(globalObject, specifierString);
        RETURN_IF_EXCEPTION(scope, {});
    }

    globalObject->onLoadPlugins.addModuleMock(globalObject, specifier, mock);

    if (!pendingFactory)
        return JSValue::encode(jsUndefined());

    JSC::JSPromise* patched = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    pendingFactory->performPromiseThenWithContext(vm, globalObject, globalObject->thenable(jsFunctionMockModuleFactoryResolve), globalObject->thenable(jsFunctionMockModuleFactoryReject), patched, mock);
    mock->hasPendingPatch = true;

    return JSValue::encode(patched);
}

static bool isRegisteredModuleMock(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier)
{
    auto* virtualModules = globalObject->onLoadPlugins.virtualModules;
    if (!virtualModules)
        return false;
    auto entry = virtualModules->find(specifier);
    return entry != virtualModules->end() && entry->value.get() == mock;
}

// False once a later mock.module() or Bun.plugin.clearAll() replaced `mock` while its factory was pending.
static bool didSettlePendingModulePatch(Zig::GlobalObject* globalObject, JSModuleMock* mock, String& specifier)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    mock->hasPendingPatch = false;

    specifier = mock->specifier->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    return isRegisteredModuleMock(globalObject, mock, specifier);
}

static void unregisterModuleMock(Zig::GlobalObject* globalObject, JSModuleMock* mock, const String& specifier)
{
    if (isRegisteredModuleMock(globalObject, mock, specifier))
        globalObject->onLoadPlugins.virtualModules->remove(specifier);
}

// Mocks replaced or cleared while their factory was pending are no longer in the map.
template<typename Functor>
static void forEachPendingModulePatch(Zig::GlobalObject* globalObject, const Functor& functor)
{
    auto* virtualModules = globalObject->onLoadPlugins.virtualModules;
    if (!virtualModules)
        return;
    for (auto& value : virtualModules->values()) {
        auto* mock = dynamicDowncast<JSModuleMock>(value.get());
        if (mock && mock->hasPendingPatch)
            functor(mock);
    }
}

extern "C" [[ZIG_EXPORT(nothrow)]] bool JSMock__hasPendingModulePatches(Zig::GlobalObject* globalObject)
{
    bool hasPending = false;
    forEachPendingModulePatch(globalObject, [&](JSModuleMock*) { hasPending = true; });
    return hasPending;
}

extern "C" [[ZIG_EXPORT(nothrow)]] void JSMock__forgetPendingModulePatches(Zig::GlobalObject* globalObject)
{
    forEachPendingModulePatch(globalObject, [](JSModuleMock* mock) { mock->hasPendingPatch = false; });
}

template<typename Visitor>
void JSModuleMock::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSModuleMock* mock = uncheckedDowncast<JSModuleMock>(cell);
    ASSERT_GC_OBJECT_INHERITS(mock, info());
    Base::visitChildren(mock, visitor);

    visitor.append(mock->callbackFunctionOrCachedResult);
    visitor.append(mock->specifier);
}

DEFINE_VISIT_CHILDREN(JSModuleMock);

void BunPlugin::OnLoad::restoreModuleMocks(Zig::GlobalObject* globalObject)
{
    auto* log = moduleMockUndoLog;
    if (!log)
        return;

    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Taken out first: a lazy getter may run JS that mocks (logged afresh, for the next restore) or restores (sees only that).
    JSC::MarkedArgumentBuffer cells;
    cells.ensureCapacity(log->cellCount());
    ModuleMockUndoLog pending = log->take(globalObject, cells);
    if (cells.hasOverflowed()) [[unlikely]] {
        log->putBack(vm, globalObject, pending, 0);
        throwOutOfMemoryError(globalObject, scope);
        return;
    }

    // A getter that throws is not retried (the log outlives the file): its binding keeps the mock, the rest is put back, the first error is rethrown.
    JSC::Exception* getterFailure = nullptr;
    size_t handled = 0;
    for (auto& binding : pending.bindings) {
        JSValue value = binding.original.get();
        if (auto* lazySource = binding.lazySource.get()) {
            value = lazySource->get(globalObject, binding.localName);
            if (auto* exception = scope.exception()) [[unlikely]] {
                // A termination stays pending and stops the replay.
                if (!scope.tryClearException())
                    break;
                if (!getterFailure)
                    getterFailure = exception;
                handled++;
                continue;
            }
        }
        binding.ns->overrideExportValue(globalObject, binding.exportName, value);
        if (scope.exception()) [[unlikely]]
            break;
        handled++;
        // A getter that re-mocked this while it was pending logged the value just undone as the original; its mock went with it.
        if (size_t relogged = log->findBinding(binding.record.get(), binding.localName); relogged != notFound) {
            WTF::Locker locker { globalObject->cellLock() };
            log->bindings.removeAt(relogged);
        }
    }
    if (handled < pending.bindings.size()) {
        // Threw: everything not yet undone goes back, ahead of what was logged meanwhile, for the next restore().
        log->putBack(vm, globalObject, pending, handled);
    }
    RETURN_IF_EXCEPTION(scope, void());

    for (auto& entry : pending.commonJSModules) {
        entry.module->putDirect(vm, Bun::builtinNames(vm).exportsPublicName(), entry.originalExports.get(), 0);
        if (size_t relogged = log->findCommonJS(entry.module.get()); relogged != notFound) {
            WTF::Locker locker { globalObject->cellLock() };
            log->commonJSModules.removeAt(relogged);
        }
    }

    for (auto& entry : pending.installed) {
        if (virtualModules) {
            // Only a test's mock is taken out (or already gone: its factory rejected). A Bun.plugin module registered over it since stays.
            auto current = virtualModules->find(entry.specifier);
            auto* currentMock = current != virtualModules->end() ? dynamicDowncast<JSModuleMock>(current->value.get()) : nullptr;
            bool testMockGone = current == virtualModules->end();
            if (testMockGone || (currentMock && !currentMock->persistent)) {
                if (entry.displaced)
                    virtualModules->set(entry.specifier, JSC::Strong<JSC::JSObject> { vm, entry.displaced.get() });
                else
                    virtualModules->remove(entry.specifier);
            }
        }
        if (size_t relogged = log->findInstalled(entry.specifier); relogged != notFound) {
            WTF::Locker locker { globalObject->cellLock() };
            log->installed.removeAt(relogged);
        }
    }

    if (getterFailure) [[unlikely]]
        scope.throwException(globalObject, getterFailure);
}

EncodedJSValue BunPlugin::OnLoad::run(JSC::JSGlobalObject* globalObject, const BunString* namespaceString, const BunString* path)
{
    Group* groupPtr = this->group(namespaceString ? namespaceString->toWTFString(BunString::ZeroCopy) : String());
    if (groupPtr == nullptr) {
        return JSValue::encode(jsUndefined());
    }
    Group& group = *groupPtr;

    auto pathString = path->toWTFString(BunString::ZeroCopy);

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* function = group.find(globalObject, pathString);
    RETURN_IF_EXCEPTION(scope, {});
    if (!function) {
        return JSValue::encode(JSC::jsUndefined());
    }

    JSC::MarkedArgumentBuffer arguments;

    JSC::JSObject* paramsObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 1);
    const auto& builtinNames = WebCore::builtinNames(vm);
    paramsObject->putDirect(
        vm, builtinNames.pathPublicName(),
        jsString(vm, pathString));
    arguments.append(paramsObject);

    auto result = AsyncContextFrame::call(globalObject, function, JSC::jsUndefined(), arguments);
    RETURN_IF_EXCEPTION(scope, {});

    if (auto* promise = dynamicDowncast<JSPromise>(result)) {
        switch (promise->status()) {
        case JSPromise::Status::Rejected:
        case JSPromise::Status::Pending: {
            return JSValue::encode(promise);
        }
        case JSPromise::Status::Fulfilled: {
            result = promise->result();
            break;
        }
        }
    }

    if (!result.isObject()) {
        JSC::throwTypeError(globalObject, scope, "onLoad() expects an object returned"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(result));
}

std::optional<String> BunPlugin::OnLoad::resolveVirtualModule(const String& path, const String& from)
{
    ASSERT(virtualModules);

    if (this->mustDoExpensiveRelativeLookup) {
        String joinedPath = path;

        if (path.startsWith("./"_s) || path.startsWith(".."_s)) {
            auto url = WTF::URL::fileURLWithFileSystemPath(from);
            ASSERT(url.isValid());
            joinedPath = URL(url, path).fileSystemPath();
        }

        return virtualModules->contains(joinedPath) ? std::optional<String> { joinedPath } : std::nullopt;
    }

    return virtualModules->contains(path) ? std::optional<String> { path } : std::nullopt;
}

EncodedJSValue BunPlugin::OnResolve::run(JSC::JSGlobalObject* globalObject, const BunString* namespaceString, const BunString* path, const BunString* importer)
{
    Group* groupPtr = this->group(namespaceString ? namespaceString->toWTFString(BunString::ZeroCopy) : String());
    if (groupPtr == nullptr) {
        return JSValue::encode(jsUndefined());
    }
    Group& group = *groupPtr;
    auto& filters = group.filters;

    if (filters.size() == 0) {
        return JSValue::encode(jsUndefined());
    }

    auto& callbacks = group.callbacks;
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    WTF::String pathString = path->toWTFString(BunString::ZeroCopy);

    JSC::MarkedArgumentBuffer matchedCallbacks;
    matchedCallbacks.ensureCapacity(filters.size());
    if (matchedCallbacks.hasOverflowed()) [[unlikely]] {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    for (size_t i = 0; i < filters.size(); i++) {
        auto matchResult = filters[i].get()->match(globalObject, pathString, 0);
        RETURN_IF_EXCEPTION(scope, {});
        if (!matchResult) {
            continue;
        }
        auto* function = callbacks[i].get();
        if (!function) [[unlikely]] {
            continue;
        }
        matchedCallbacks.append(function);
    }
    if (matchedCallbacks.hasOverflowed()) [[unlikely]] {
        JSC::throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    for (size_t i = 0; i < matchedCallbacks.size(); i++) {
        auto* function = matchedCallbacks.at(i).getObject();

        JSC::MarkedArgumentBuffer arguments;

        JSC::JSObject* paramsObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 2);
        const auto& builtinNames = WebCore::builtinNames(vm);
        auto* pathJS = Bun::toJS(globalObject, *path);
        RETURN_IF_EXCEPTION(scope, {});
        paramsObject->putDirect(
            vm, builtinNames.pathPublicName(),
            pathJS);
        auto* importerJS = Bun::toJS(globalObject, *importer);
        RETURN_IF_EXCEPTION(scope, {});
        paramsObject->putDirect(
            vm, builtinNames.importerPublicName(),
            importerJS);
        arguments.append(paramsObject);

        auto result = AsyncContextFrame::call(globalObject, function, JSC::jsUndefined(), arguments);
        RETURN_IF_EXCEPTION(scope, {});

        if (result.isUndefinedOrNull()) {
            continue;
        }

        if (auto* promise = dynamicDowncast<JSPromise>(result)) {
            switch (promise->status()) {
            case JSPromise::Status::Pending: {
                JSC::throwTypeError(globalObject, scope, "onResolve() doesn't support pending promises yet"_s);
                return {};
            }
            case JSPromise::Status::Rejected: {
                promise->setFlags(static_cast<uint16_t>(JSC::JSPromise::Status::Fulfilled));
                result = promise->result();
                return JSValue::encode(result);
            }
            case JSPromise::Status::Fulfilled: {
                result = promise->result();
                break;
            }
            }
        }

        // Check again after promise resolution
        if (result.isUndefinedOrNull()) {
            continue;
        }

        if (!result.isObject()) {
            JSC::throwTypeError(globalObject, scope, "onResolve() expects an object returned"_s);
            return {};
        }

        RELEASE_AND_RETURN(scope, JSValue::encode(result));
    }

    return JSValue::encode(JSC::jsUndefined());
}

} // namespace Zig

BUN_DEFINE_HOST_FUNCTION(jsFunctionMockModuleFactoryResolve, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* mock = uncheckedDowncast<Zig::JSModuleMock>(callFrame->argument(1));
    String specifier;
    bool isCurrent = Zig::didSettlePendingModulePatch(globalObject, mock, specifier);
    RETURN_IF_EXCEPTION(scope, {});
    if (!isCurrent)
        return JSC::JSValue::encode(JSC::jsUndefined());

    JSC::JSValue exportsValue = callFrame->argument(0);
    if (!exportsValue.isObject()) {
        Zig::throwFactoryMustReturnObject(globalObject, scope);
    } else {
        Zig::LoadedModule loaded = Zig::findLoadedModule(globalObject, mock->specifier.get());
        if (!scope.exception()) [[likely]]
            Zig::overrideLoadedModuleExports(globalObject, loaded, exportsValue.getObject(), mock->persistent);
    }
    if (scope.exception()) [[unlikely]] {
        Zig::unregisterModuleMock(globalObject, mock, specifier);
        return {};
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionMockModuleFactoryReject, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig::GlobalObject* globalObject = defaultGlobalObject(lexicalGlobalObject);
    String specifier;
    bool isCurrent = Zig::didSettlePendingModulePatch(globalObject, uncheckedDowncast<Zig::JSModuleMock>(callFrame->argument(1)), specifier);
    RETURN_IF_EXCEPTION(scope, {});
    if (!isCurrent)
        return JSC::JSValue::encode(JSC::jsUndefined());

    globalObject->onLoadPlugins.virtualModules->remove(specifier);
    scope.throwException(globalObject, callFrame->argument(0));
    return {};
}

extern "C" JSC::EncodedJSValue Bun__runOnResolvePlugins(Zig::GlobalObject* globalObject, const BunString* namespaceString, const BunString* path, const BunString* from, BunPluginTarget target)
{
    return globalObject->onResolvePlugins.run(globalObject, namespaceString, path, from);
}

extern "C" JSC::EncodedJSValue Bun__runOnLoadPlugins(Zig::GlobalObject* globalObject, const BunString* namespaceString, const BunString* path, BunPluginTarget target)
{
    return globalObject->onLoadPlugins.run(globalObject, namespaceString, path);
}

namespace Bun {

Structure* createModuleMockStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return Zig::JSModuleMock::createStructure(vm, globalObject, prototype);
}

JSC::JSValue runVirtualModule(Zig::GlobalObject* globalObject, BunString* specifier, bool& wasModuleMock)
{
    auto fallback = [&]() -> JSC::JSValue {
        return JSValue::decode(Bun__runVirtualModule(globalObject, specifier));
    };

    if (!globalObject->onLoadPlugins.hasVirtualModules()) {
        return fallback();
    }
    auto& virtualModules = *globalObject->onLoadPlugins.virtualModules;
    WTF::String specifierString = specifier->toWTFString(BunString::ZeroCopy);

    if (auto virtualModuleFn = virtualModules.get(specifierString)) {
        auto& vm = JSC::getVM(globalObject);
        JSC::JSObject* function = virtualModuleFn.get();
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        JSValue result;

        if (Zig::JSModuleMock* moduleMock = dynamicDowncast<Zig::JSModuleMock>(function)) {
            wasModuleMock = true;
            // module mock
            result = moduleMock->executeOnce(globalObject);
        } else {
            // regular function
            JSC::MarkedArgumentBuffer arguments;
            JSC::CallData callData = JSC::getCallData(function);
            RELEASE_ASSERT(callData.type != JSC::CallData::Type::None);

            result = call(globalObject, function, callData, JSC::jsUndefined(), arguments);
        }

        RETURN_IF_EXCEPTION(throwScope, JSC::jsUndefined());

        if (auto* promise = dynamicDowncast<JSPromise>(result)) {
            switch (promise->status()) {
            case JSPromise::Status::Rejected:
            case JSPromise::Status::Pending: {
                return promise;
            }
            case JSPromise::Status::Fulfilled: {
                result = promise->result();
                break;
            }
            }
        }

        if (!result.isObject()) {
            JSC::throwTypeError(globalObject, throwScope, "virtual module expects an object returned"_s);
            return {};
        }

        return result;
    }

    return fallback();
}

} // namespace Bun

BUN_DEFINE_HOST_FUNCTION(jsFunctionBunPluginClear, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    Zig::GlobalObject* global = static_cast<Zig::GlobalObject*>(globalObject);
    global->onLoadPlugins.clear(global);
    global->onResolvePlugins.clear();

    return JSC::JSValue::encode(JSC::jsUndefined());
}

BUN_DEFINE_HOST_FUNCTION(jsFunctionBunPlugin, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callframe))
{
    return Bun::setupBunPlugin(globalObject, callframe, BunPluginTargetBun);
}
