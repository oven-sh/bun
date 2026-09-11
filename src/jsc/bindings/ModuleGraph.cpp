#include "root.h"

#include "ModuleGraph.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include "BunProcess.h"
#include "ErrorCode.h"
#include "JSDOMExceptionHandling.h"
#include "NodeValidator.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"

#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/JSLexicalEnvironmentInlines.h>
#include <JavaScriptCore/JSModuleEnvironment.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSSet.h>
#include <JavaScriptCore/JSSetIterator.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/StackFrame.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/WeakGCMapInlines.h>
#include <wtf/SetForScope.h>
#include <wtf/text/StringBuilder.h>

namespace Bun {
using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(jsModuleGraphPrototypeFunction_import);
static JSC_DECLARE_HOST_FUNCTION(jsModuleGraphPrototypeFunction_dispose);
static JSC_DECLARE_HOST_FUNCTION(jsModuleGraphImportFulfilled);
static JSC_DECLARE_HOST_FUNCTION(jsModuleGraphImportRejected);
static JSC_DECLARE_CUSTOM_GETTER(jsModuleGraphGetter_mainModule);

static ModuleGraphState& moduleGraphState(Zig::GlobalObject* globalObject)
{
    auto& state = globalObject->m_moduleGraphs;
    if (!state)
        state = makeUnique<ModuleGraphState>(globalObject->vm());
    return *state;
}

// Graphs are registered by their overlay (a WeakMap, so a graph object stays
// alive while any code scoped to it does): the overlay is the module scope of the
// graph's loader and sits on the scope chain of all of the graph's code.
static JSModuleGraph* moduleGraphForOverlay(Zig::GlobalObject* globalObject, JSObject* overlay)
{
    return globalObject->hasModuleGraphs() ? dynamicDowncast<JSModuleGraph>(globalObject->moduleGraphRegistry()->get(overlay)) : nullptr;
}

JSModuleGraph* moduleGraphForLoader(JSGlobalObject* globalObject, JSModuleLoader* loader)
{
    if (!loader || loader == globalObject->moduleLoader())
        return nullptr;
    return moduleGraphForOverlay(defaultGlobalObject(globalObject), loader->moduleScope());
}

static JSObject* createModuleGraphDisposedError(JSGlobalObject* globalObject)
{
    return createError(globalObject, ErrorCode::ERR_INVALID_STATE, "ModuleGraph has been disposed"_s);
}

bool throwIfModuleGraphDisposed(JSGlobalObject* globalObject, ThrowScope& scope, JSModuleLoader* loader)
{
    JSModuleGraph* graph = moduleGraphForLoader(globalObject, loader);
    if (!graph || !graph->disposed())
        return false;
    throwException(globalObject, scope, createModuleGraphDisposedError(globalObject));
    return true;
}

// ─── Attribution: which graph's code an error / rejection belongs to ────────────────
//
// std::optional<JSModuleGraph*>: nullopt = this frame / stack does not say (plain
// global-scope code, natives), nullptr = the global object's own module code, else
// the graph.

// A frame of the global loader's CommonJS module code: no module environment on its
// scope chain, unlike ES module code, but host module code all the same. (Function()
// and eval code carry their creator's origin but no source URL of their own.)
static bool isHostCommonJSModuleCode(JSFunction* function)
{
    if (function->isHostOrBuiltinFunction())
        return false;
    JSC::SourceProvider* provider = function->jsExecutable()->source().provider();
    return provider && provider->sourceType() == SourceProviderSourceType::Program && !provider->sourceURL().isEmpty() && provider->sourceOrigin().url().protocolIsFile();
}

static std::optional<JSModuleGraph*> moduleGraphOwningScope(Zig::GlobalObject* globalObject, JSScope* scope)
{
    JSScope* globalLexicalEnvironment = globalObject->globalLexicalEnvironment();
    for (JSScope* cursor = scope; cursor && cursor != globalLexicalEnvironment; cursor = cursor->next()) {
        if (cursor->type() == ModuleEnvironmentType) {
            // A graph's module environments sit on its overlay; the global loader's on
            // the global lexical environment.
            JSScope* parent = cursor->next();
            return parent == globalLexicalEnvironment ? nullptr : moduleGraphForOverlay(globalObject, parent);
        }
    }
    return std::nullopt;
}

static std::optional<JSModuleGraph*> moduleGraphForFrame(Zig::GlobalObject* globalObject, JSCell* calleeCell)
{
    if (auto* function = dynamicDowncast<JSFunction>(calleeCell)) {
        if (function->isHostFunction())
            return std::nullopt;
        auto owner = moduleGraphOwningScope(globalObject, function->scope());
        if (!owner && isHostCommonJSModuleCode(function))
            return nullptr;
        return owner;
    }
    if (auto* callee = dynamicDowncast<JSCallee>(calleeCell)) // module / program / eval code
        return moduleGraphOwningScope(globalObject, callee->scope());
    return std::nullopt;
}

// The code running now: the innermost frame on the stack (vm.topCallFrame) that says.
static std::optional<JSModuleGraph*> moduleGraphForCurrentStack(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    std::optional<JSModuleGraph*> found;
    if (!vm.topCallFrame)
        return found;
    StackVisitor::visit(vm.topCallFrame, vm, [&](StackVisitor& visitor) {
        if (visitor->codeType() == StackVisitor::Frame::CodeType::Native || visitor->codeType() == StackVisitor::Frame::CodeType::Wasm)
            return IterationStatus::Continue;
        found = moduleGraphForFrame(globalObject, visitor->callee().isCell() ? visitor->callee().asCell() : nullptr);
        return found ? IterationStatus::Done : IterationStatus::Continue;
    });
    return found;
}

// The code that captured `frames` (a throw site, or where an Error was created).
static std::optional<JSModuleGraph*> moduleGraphForFrames(Zig::GlobalObject* globalObject, const Vector<StackFrame>& frames)
{
    for (const StackFrame& frame : frames) {
        if (auto found = moduleGraphForFrame(globalObject, frame.callee()))
            return found;
    }
    return std::nullopt;
}

// promiseRejectionTracker, for a promise rejected with no handler: the code rejecting it
// is on the stack now — or, for an async function or a promise reaction whose handler
// threw, nothing is (the runtime rejects after unwinding) and the exception it caught,
// still the VM's last, carries the throw site. promise -> graph, or -> null for the
// global object's module code.
void moduleGraphNoteRejection(Zig::GlobalObject* globalObject, JSPromise* promise)
{
    if (!globalObject->hasModuleGraphs())
        return;
    VM& vm = globalObject->vm();
    auto owner = moduleGraphForCurrentStack(globalObject);
    if (!owner) {
        JSC::Exception* last = vm.lastException();
        if (last && last->value() == promise->result())
            owner = moduleGraphForFrames(globalObject, last->stack());
    }
    if (owner)
        globalObject->moduleGraphAttributions()->set(vm, promise, *owner ? JSValue(*owner) : jsNull());
}

// An ErrorInstance drops its frames when its stack string is materialized (e.stack,
// console.error, Error.captureStackTrace): keep the graph they point at, for an error
// that escapes later. error -> graph; the same map holds error -> true once an error
// object has been delivered to an onError.
void moduleGraphNoteErrorFrames(Zig::GlobalObject* globalObject, ErrorInstance* instance, const Vector<StackFrame>& frames)
{
    if (!instance || !globalObject->hasModuleGraphs())
        return;
    auto owner = moduleGraphForFrames(globalObject, frames);
    if (!owner || !*owner)
        return;
    JSWeakMap* attributions = globalObject->moduleGraphAttributions();
    if (attributions->get(instance).isUndefined())
        attributions->set(globalObject->vm(), instance, *owner);
}

// Called first for every uncaught exception / unhandled rejection on this thread
// (VirtualMachine.rs). The code that threw (the Exception's stack) or rejected (noted
// on the promise) decides; failing that, the code that created the error. Returns
// whether a graph's onError took it; anything else takes the normal path.
extern "C" bool Bun__ModuleGraph__handleUnhandled(JSGlobalObject* lexicalGlobalObject, EncodedJSValue encodedError, EncodedJSValue encodedPromise, bool isRejection)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    if (!globalObject->hasModuleGraphs() || moduleGraphState(globalObject).inOnError)
        return false;
    VM& vm = globalObject->vm();
    JSWeakMap* attributions = globalObject->moduleGraphAttributions();
    JSValue error = JSValue::decode(encodedError);
    JSValue promise = JSValue::decode(encodedPromise);
    auto* exception = error.isCell() ? dynamicDowncast<JSC::Exception>(error.asCell()) : nullptr;
    if (exception)
        error = exception->value();
    auto* errorInstance = error.isCell() ? dynamicDowncast<ErrorInstance>(error.asCell()) : nullptr;

    std::optional<JSModuleGraph*> owner;
    if (promise && promise.isObject()) { // empty for an uncaught exception
        JSValue noted = attributions->get(asObject(promise));
        if (auto* graph = dynamicDowncast<JSModuleGraph>(noted))
            owner = graph;
        else if (noted.isNull())
            owner = nullptr;
    }
    if (!owner && exception)
        owner = moduleGraphForFrames(globalObject, exception->stack());
    bool byOrigin = false;
    if (!owner && errorInstance) {
        byOrigin = true;
        if (const Vector<StackFrame>* frames = errorInstance->stackTrace())
            owner = moduleGraphForFrames(globalObject, *frames);
        else if (auto* graph = dynamicDowncast<JSModuleGraph>(attributions->get(errorInstance)))
            owner = graph;
    }
    JSModuleGraph* graph = owner.value_or(nullptr);
    if (!graph || !graph->onError())
        return false;
    if (error.isObject()) {
        // An error object attributed only by where it was created goes to that graph's
        // onError once: an onError that lets it escape again where no code claims it
        // (a bare promise chain, say) hands it to the host instead of looping.
        JSObject* errorObject = asObject(error);
        if (byOrigin && attributions->get(errorObject).isTrue())
            return false;
        attributions->set(vm, errorObject, jsBoolean(true));
    }

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSObject* onError = graph->onError();
    MarkedArgumentBuffer args;
    args.append(error);
    args.append(jsString(vm, isRejection ? String("unhandledRejection"_s) : String("uncaughtException"_s)));
    SetForScope inOnError(moduleGraphState(globalObject).inOnError, true);
    JSC::call(globalObject, onError, getCallData(onError), jsUndefined(), args);
    if (scope.exception()) [[unlikely]] {
        if (vm.hasPendingTerminationException())
            return true;
        // onError itself threw: that is the host's error.
        auto* thrown = scope.exception();
        (void)scope.tryClearException();
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, thrown);
    }
    return true;
}

// ─── JSModuleGraph ───────────────────────────────────────────────────────────────────

const ClassInfo JSModuleGraph::s_info = { "ModuleGraph"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleGraph) };

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSModuleGraph::subspaceFor(VM& vm)
{
    if constexpr (mode == SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSModuleGraph, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSModuleGraph, m_subspaceForJSModuleGraph));
}

Structure* JSModuleGraph::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return createClassStructure(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSModuleGraph::JSModuleGraph(VM& vm, Structure* structure, JSModuleLoader* loader, JSLexicalEnvironment* overlay, JSObject* onError)
    : Base(vm, structure)
    , m_loader(loader, WriteBarrierEarlyInit)
    , m_overlay(overlay, WriteBarrierEarlyInit)
    , m_onError(onError, WriteBarrierEarlyInit)
{
}

JSModuleGraph* JSModuleGraph::create(VM& vm, Structure* structure, JSModuleLoader* loader, JSLexicalEnvironment* overlay, JSObject* onError)
{
    auto* cell = new (NotNull, allocateCell<JSModuleGraph>(vm)) JSModuleGraph(vm, structure, loader, overlay, onError);
    cell->finishCreation(vm);
    return cell;
}

void JSModuleGraph::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

void JSModuleGraph::setImportSettledHandlers(VM& vm, JSFunction* fulfilled, JSFunction* rejected)
{
    m_importFulfilled.set(vm, this, fulfilled);
    m_importRejected.set(vm, this, rejected);
}

template<typename Visitor>
void JSModuleGraph::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSModuleGraph>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_loader);
    visitor.append(thisObject->m_overlay);
    visitor.append(thisObject->m_onError);
    visitor.append(thisObject->m_mainPath);
    visitor.append(thisObject->m_pendingImports);
    visitor.append(thisObject->m_importFulfilled);
    visitor.append(thisObject->m_importRejected);
}
DEFINE_VISIT_CHILDREN(JSModuleGraph);

static JSModuleGraph* thisModuleGraph(JSGlobalObject* globalObject, ThrowScope& scope, JSValue thisValue, ASCIILiteral method)
{
    auto* graph = dynamicDowncast<JSModuleGraph>(thisValue);
    if (!graph) [[unlikely]]
        WebCore::throwThisTypeError(*globalObject, scope, "ModuleGraph"_s, method);
    return graph;
}

// The promise import() returned settles like the loader's unless dispose() rejected it
// first. Called with (the loader's result / error, [that promise, the module key]).
static JSPromise* settlingImport(JSGlobalObject* globalObject, JSModuleGraph* graph, JSValue context, JSString*& key)
{
    JSValue promise = context.get(globalObject, 0u);
    key = context.get(globalObject, 1u).toStringOrNull(globalObject);
    if (JSSet* pending = graph->pendingImports())
        pending->remove(globalObject, promise);
    auto* result = dynamicDowncast<JSPromise>(promise);
    return result && result->status() == JSPromise::Status::Pending ? result : nullptr;
}

JSC_DEFINE_HOST_FUNCTION(jsModuleGraphImportFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSString* key = nullptr;
    JSPromise* promise = settlingImport(globalObject, uncheckedDowncast<JSModuleGraph>(callFrame->jsCallee()->getDirect(vm, WebCore::clientData(vm)->builtinNames().selfPrivateName())), callFrame->argument(1), key);
    RETURN_IF_EXCEPTION(scope, {});
    if (promise)
        promise->resolve(globalObject, vm, callFrame->argument(0));
    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}

JSC_DEFINE_HOST_FUNCTION(jsModuleGraphImportRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSString* key = nullptr;
    auto* graph = uncheckedDowncast<JSModuleGraph>(callFrame->jsCallee()->getDirect(vm, WebCore::clientData(vm)->builtinNames().selfPrivateName()));
    JSPromise* promise = settlingImport(globalObject, graph, callFrame->argument(1), key);
    RETURN_IF_EXCEPTION(scope, {});
    // A first import that failed leaves the graph without a main module rather than
    // with one that never loaded.
    if (key && graph->mainPath() == JSValue(key))
        graph->clearMainPath();
    if (promise) {
        promise->reject(vm, callFrame->argument(0));
        // graph.import()'s promise is its caller's to handle, not the graph's (whose code threw).
        defaultGlobalObject(globalObject)->moduleGraphAttributions()->set(vm, promise, jsNull());
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}

// import(): like dynamic import(), every failure past the receiver check is a
// rejection of the returned promise, never a synchronous throw.
static JSPromise* moduleGraphImport(Zig::GlobalObject* globalObject, JSModuleGraph* graph, JSValue specifierValue)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSModuleLoader* loader = graph->loader();
    if (!loader) {
        throwException(globalObject, scope, createModuleGraphDisposedError(globalObject));
        return nullptr;
    }
    V::validateString(scope, globalObject, specifierValue, "specifier"_s);
    RETURN_IF_EXCEPTION(scope, nullptr);
    String specifier = specifierValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    // Bare/relative specifiers resolve against process.cwd().
    String cwd = getCachedCwd(globalObject).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto referrer = Identifier::fromString(vm, makeString(cwd, PLATFORM_SEP, "[module-graph]"_s));
    Identifier key = loader->resolve(globalObject, Identifier::fromString(vm, specifier), referrer, nullptr, false);
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSString* keyString = jsString(vm, key.string());
    bool becameMain = graph->mainPath().isUndefined();
    if (becameMain)
        graph->setMainPath(vm, keyString);
    JSPromise* loaded = loader->requestImportModule(globalObject, key, Identifier(), nullptr, nullptr);
    if (scope.exception()) [[unlikely]] {
        if (becameMain)
            graph->clearMainPath();
        return nullptr;
    }

    JSPromise* result = JSPromise::create(vm, globalObject->promiseStructure());
    JSSet* pending = graph->pendingImports();
    if (!pending) {
        pending = JSSet::create(vm, globalObject->setStructure());
        graph->setPendingImports(vm, pending);
    }
    pending->add(globalObject, result);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (!graph->importSettledHandler(false)) {
        auto* fulfilled = JSFunction::create(vm, globalObject, 2, "importFulfilled"_s, jsModuleGraphImportFulfilled, ImplementationVisibility::Private);
        auto* rejected = JSFunction::create(vm, globalObject, 2, "importRejected"_s, jsModuleGraphImportRejected, ImplementationVisibility::Private);
        fulfilled->putDirect(vm, WebCore::clientData(vm)->builtinNames().selfPrivateName(), graph);
        rejected->putDirect(vm, WebCore::clientData(vm)->builtinNames().selfPrivateName(), graph);
        graph->setImportSettledHandlers(vm, fulfilled, rejected);
    }
    MarkedArgumentBuffer contextValues;
    contextValues.append(result);
    contextValues.append(keyString);
    JSArray* context = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), contextValues);
    RETURN_IF_EXCEPTION(scope, nullptr);
    loaded->performPromiseThenWithContext(vm, globalObject, graph->importSettledHandler(false), graph->importSettledHandler(true), jsUndefined(), context);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return result;
}

JSC_DEFINE_HOST_FUNCTION(jsModuleGraphPrototypeFunction_import, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSModuleGraph* graph = thisModuleGraph(globalObject, scope, callFrame->thisValue(), "import"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSPromise* result = moduleGraphImport(globalObject, graph, callFrame->argument(0));
    if (scope.exception()) [[unlikely]]
        return JSValue::encode(JSPromise::rejectedPromiseWithCaughtException(globalObject, scope));
    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsModuleGraphPrototypeFunction_dispose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSModuleGraph* graph = thisModuleGraph(globalObject, scope, callFrame->thisValue(), "dispose"_s);
    RETURN_IF_EXCEPTION(scope, {});
    // Drop the loader's registry; reject import()s still pending. Code of the graph
    // that is still running keeps what it closes over, as usual (the loader stays
    // reachable from the overlay's @moduleLoader, so import() from such code still
    // finds the graph, and rejects); onError stays for its errors.
    if (JSModuleLoader* loader = graph->loader())
        loader->clearAll();
    graph->clearLoader();
    if (JSSet* pending = graph->pendingImports()) {
        graph->setPendingImports(vm, nullptr);
        auto* iterator = JSSetIterator::create(vm, globalObject->setIteratorStructure(), pending, IterationKind::Keys);
        RETURN_IF_EXCEPTION(scope, {});
        JSValue value;
        while (iterator->next(globalObject, value)) {
            if (auto* promise = dynamicDowncast<JSPromise>(value); promise && promise->status() == JSPromise::Status::Pending) {
                promise->reject(vm, createModuleGraphDisposedError(globalObject));
                defaultGlobalObject(globalObject)->moduleGraphAttributions()->set(vm, promise, jsNull());
            }
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(jsModuleGraphGetter_mainModule, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSModuleGraph* graph = thisModuleGraph(globalObject, scope, JSValue::decode(thisValue), "mainModule"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(graph->mainPath());
}

class JSModuleGraphPrototype final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static JSModuleGraphPrototype* create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
    {
        auto* prototype = new (NotNull, allocatePlainObjectCell(vm, sizeof(JSModuleGraphPrototype))) JSModuleGraphPrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }
    DECLARE_INFO;
    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSModuleGraphPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        auto* structure = createClassStructure(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSModuleGraphPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(VM&, JSGlobalObject*);
};

static const HashTableValue JSModuleGraphPrototypeTableValues[] = {
    { "import"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsModuleGraphPrototypeFunction_import, 1 } },
    { "dispose"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsModuleGraphPrototypeFunction_dispose, 0 } },
    { "mainModule"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsModuleGraphGetter_mainModule, 0 } },
};

const ClassInfo JSModuleGraphPrototype::s_info = { "ModuleGraph"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleGraphPrototype) };

void JSModuleGraphPrototype::finishCreation(VM& vm, JSGlobalObject*)
{
    Base::finishCreation(vm);
    reifyStaticPropertyTable(vm, JSModuleGraph::info(), JSModuleGraphPrototypeTableValues, *this);
    putDirectWithoutTransition(vm, vm.propertyNames->disposeSymbol, getDirect(vm, Identifier::fromString(vm, "dispose"_s)), static_cast<unsigned>(PropertyAttribute::DontEnum));
    putToStringTagWithoutTransition(vm, this, info());
}

// The overlay: a lexical environment over the global lexical environment holding the
// host's `globals` and @moduleLoader (what import() compiles to a lookup of), bound to
// the new loader. Graphs whose `globals` have the same names share one SymbolTable, so
// the modules they load share executables.
static JSLexicalEnvironment* createModuleGraphOverlay(Zig::GlobalObject* globalObject, JSObject* globals)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    Vector<Identifier> names;
    if (globals) {
        PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        globals->methodTable()->getOwnPropertyNames(globals, globalObject, properties, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, nullptr);
        for (auto& name : properties)
            names.append(name);
        std::sort(names.begin(), names.end(), [](const Identifier& a, const Identifier& b) { return codePointCompare(a.string(), b.string()) < 0; });
    }
    // One key per name set: each name as <length>:<name>, so no two sets share a key.
    StringBuilder joined;
    for (auto& name : names)
        joined.append(name.length(), ':', name.string());
    String namesKey = joined.toString();
    auto& symbolTables = moduleGraphState(globalObject).overlaySymbolTables;
    SymbolTable* symbolTable = symbolTables.get(namesKey);
    if (!symbolTable) {
        symbolTable = SymbolTable::create(vm);
        for (auto& name : names)
            symbolTable->add(NoLockingNecessary, name.impl(), SymbolTableEntry(VarOffset(symbolTable->takeNextScopeOffset(NoLockingNecessary))));
        symbolTable->add(NoLockingNecessary, vm.propertyNames->builtinNames().moduleLoaderPrivateName().impl(), SymbolTableEntry(VarOffset(symbolTable->takeNextScopeOffset(NoLockingNecessary))));
        symbolTables.set(namesKey, symbolTable);
    }

    JSLexicalEnvironment* overlay = JSLexicalEnvironment::create(vm, globalObject, globalObject->globalLexicalEnvironment(), symbolTable, jsUndefined());
    JSModuleLoader* loader = JSModuleLoader::create(globalObject, vm, overlay);
    overlay->variableAt(symbolTable->get(vm.propertyNames->builtinNames().moduleLoaderPrivateName().impl()).scopeOffset()).set(vm, overlay, loader);
    for (auto& name : names) {
        JSValue value = globals->get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, nullptr);
        overlay->variableAt(symbolTable->get(name.impl()).scopeOffset()).set(vm, overlay, value);
    }
    return overlay;
}

static JSModuleLoader* moduleLoaderOfOverlay(VM& vm, JSLexicalEnvironment* overlay)
{
    return uncheckedDowncast<JSModuleLoader>(overlay->variableAt(overlay->symbolTable()->get(vm.propertyNames->builtinNames().moduleLoaderPrivateName().impl()).scopeOffset()).get());
}

class JSModuleGraphConstructor final : public InternalFunction {
public:
    using Base = InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr DestructionMode needsDestruction = DoesNotNeedDestruction;
    static JSModuleGraphConstructor* create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
    {
        auto* constructor = new (NotNull, allocateCell<JSModuleGraphConstructor>(vm)) JSModuleGraphConstructor(vm, structure);
        constructor->finishCreation(vm, globalObject, prototype);
        return constructor;
    }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return createClassStructure(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
    }
    DECLARE_INFO;
    static JSC_HOST_CALL_ATTRIBUTES EncodedJSValue construct(JSGlobalObject*, CallFrame*);
    static JSC_HOST_CALL_ATTRIBUTES EncodedJSValue call(JSGlobalObject* globalObject, CallFrame*)
    {
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        return throwVMTypeError(globalObject, scope, "Class constructor ModuleGraph cannot be invoked without 'new'"_s);
    }

private:
    JSModuleGraphConstructor(VM& vm, Structure* structure)
        : Base(vm, structure, call, construct)
    {
    }
    void finishCreation(VM& vm, JSGlobalObject*, JSObject* prototype)
    {
        Base::finishCreation(vm, 1, "ModuleGraph"_s, PropertyAdditionMode::WithoutStructureTransition);
        putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    }
};

const ClassInfo JSModuleGraphConstructor::s_info = { "ModuleGraph"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleGraphConstructor) };

// new Bun.unsafe.ModuleGraph({ globals?, onError? })
JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSModuleGraphConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* globals = nullptr;
    JSValue onError = jsUndefined();
    JSValue optionsValue = callFrame->argument(0);
    if (!optionsValue.isUndefined()) {
        V::validateObject(scope, globalObject, optionsValue, "options"_s);
        RETURN_IF_EXCEPTION(scope, {});
        JSObject* options = optionsValue.getObject();
        JSValue globalsValue = options->get(globalObject, Identifier::fromString(vm, "globals"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!globalsValue.isUndefined()) {
            V::validateObject(scope, globalObject, globalsValue, "options.globals"_s);
            RETURN_IF_EXCEPTION(scope, {});
            globals = globalsValue.getObject();
        }
        onError = options->get(globalObject, Identifier::fromString(vm, "onError"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!onError.isUndefined()) {
            V::validateFunction(scope, globalObject, onError, "options.onError"_s);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    Structure* structure = globalObject->JSModuleGraphStructure();
    JSObject* newTarget = asObject(callFrame->newTarget());
    if (newTarget != callFrame->jsCallee()) {
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget, structure);
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSLexicalEnvironment* overlay = createModuleGraphOverlay(globalObject, globals);
    RETURN_IF_EXCEPTION(scope, {});
    JSModuleGraph* graph = JSModuleGraph::create(vm, structure, moduleLoaderOfOverlay(vm, overlay), overlay, onError.isUndefined() ? nullptr : asObject(onError));
    globalObject->moduleGraphRegistry()->set(vm, overlay, graph);
    return JSValue::encode(graph);
}

void initJSModuleGraphClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototype = JSModuleGraphPrototype::create(init.vm, init.global, JSModuleGraphPrototype::createStructure(init.vm, init.global, init.global->objectPrototype()));
    auto* structure = JSModuleGraph::createStructure(init.vm, init.global, prototype);
    auto* constructor = JSModuleGraphConstructor::create(init.vm, init.global, JSModuleGraphConstructor::createStructure(init.vm, init.global, init.global->functionPrototype()), prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

// UnsafeObject.rs: Bun.unsafe.ModuleGraph
extern "C" EncodedJSValue Bun__ModuleGraph__constructor(JSGlobalObject* globalObject)
{
    return JSValue::encode(defaultGlobalObject(globalObject)->JSModuleGraphConstructor());
}

} // namespace Bun
