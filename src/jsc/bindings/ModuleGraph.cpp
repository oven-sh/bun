#include "root.h"

#include "ModuleGraph.h"
#include "ZigGlobalObject.h"
#include "NodeValidator.h"
#include "BunClientData.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"

#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/SourceOrigin.h>
#include "JSCommonJSModule.h"
#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/WeakMapImplInlines.h>
#include <JavaScriptCore/StackFrame.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/JSWeakMap.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include <JavaScriptCore/JSLexicalEnvironment.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSModuleEnvironment.h>
#include <JavaScriptCore/JSLexicalEnvironmentInlines.h>
#include <JavaScriptCore/SymbolTable.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/SetForScope.h>
#include <wtf/HexNumber.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSObjectInlines.h>

namespace Bun {
using namespace JSC;

extern "C" JSC::EncodedJSValue Process__getCachedCwd(JSC::JSGlobalObject*);

// Graphs are registered by their overlay (a WeakMap, so a graph object stays
// alive while any code scoped to it does): the overlay is the module scope of the
// graph's loader and sits on the scope chain of all of the graph's code.
static JSModuleGraph* moduleGraphForOverlay(Zig::GlobalObject* globalObject, JSObject* overlay)
{
    JSWeakMap* registry = globalObject->moduleGraphRegistryIfExists();
    return registry ? dynamicDowncast<JSModuleGraph>(registry->get(overlay)) : nullptr;
}

JSModuleGraph* moduleGraphForLoader(JSGlobalObject* globalObject, JSModuleLoader* loader)
{
    if (!loader || loader == globalObject->moduleLoader())
        return nullptr;
    return moduleGraphForOverlay(defaultGlobalObject(globalObject), loader->moduleScope());
}

JSMap* requireMapFor(Zig::GlobalObject* globalObject, JSModuleGraph* graph)
{
    return graph ? graph->requireMap() : globalObject->requireMap();
}

JSModuleLoader* moduleLoaderForRequirer(JSGlobalObject* globalObject, JSCommonJSModule* requirer)
{
    if (requirer && requirer->moduleGraph())
        return requirer->moduleGraph()->loader();
    return globalObject->moduleLoader();
}

void throwModuleGraphDisposed(JSGlobalObject* globalObject, ThrowScope& scope)
{
    throwTypeError(globalObject, scope, "ModuleGraph has been disposed"_s);
}

// A frame of the global loader's CommonJS module code (its scope chain has no
// module environment, unlike ES module code, but it is host module code all the same).
static bool isHostCommonJSModuleCode(JSFunction* function)
{
    if (function->isHostOrBuiltinFunction())
        return false;
    JSC::SourceProvider* provider = function->jsExecutable()->source().provider();
    return provider && provider->sourceType() == JSC::SourceProviderSourceType::Program && provider->sourceOrigin().url().protocolIsFile();
}

// The graph whose code created `scope` (a function / module / CommonJS scope),
// and whether the scope belongs to module-ish code at all (`decisive`): a chain
// with a module environment or a graph overlay on it is module / CommonJS code
// of SOME loader (a graph's or the global object's) and settles attribution;
// plain global-scope functions do not.
static JSModuleGraph* moduleGraphOwningScope(Zig::GlobalObject* globalObject, JSScope* scope, bool& decisive)
{
    decisive = false;
    JSScope* globalLexicalEnvironment = globalObject->globalLexicalEnvironment();
    for (JSScope* cursor = scope; cursor && cursor != globalLexicalEnvironment; cursor = cursor->next()) {
        // An overlay sits directly on the global lexical environment.
        if (cursor->next() == globalLexicalEnvironment) {
            if (JSModuleGraph* graph = moduleGraphForOverlay(globalObject, cursor)) {
                decisive = true;
                return graph;
            }
        }
        if (cursor->type() == ModuleEnvironmentType)
            decisive = true;
    }
    return nullptr;
}

// Whether the frame of `calleeCell` settles which loader's code is running (module /
// CommonJS code of a graph or of the global object), and if so which graph (or null).
static bool frameDecidesModuleGraph(Zig::GlobalObject* globalObject, JSCell* calleeCell, JSModuleGraph*& graph)
{
    graph = nullptr;
    JSScope* scope = nullptr;
    auto* function = dynamicDowncast<JSFunction>(calleeCell);
    if (function) {
        if (function->isHostFunction())
            return false;
        scope = function->scope();
    } else if (auto* callee = dynamicDowncast<JSCallee>(calleeCell))
        scope = callee->scope();
    if (!scope)
        return false;
    bool decisive = false;
    graph = moduleGraphOwningScope(globalObject, scope, decisive);
    return decisive || (function && isHostCommonJSModuleCode(function));
}

// The Bun.unsafe.ModuleGraph whose code is running: the innermost JS frame on
// the current stack (vm.topCallFrame) whose callee/module scope belongs to a
// graph. Used to attribute promise rejections (moduleGraphNoteRejection) and to
// give createRequire() called from graph code the graph's require.
JSModuleGraph* ambientModuleGraph(JSGlobalObject* lexicalGlobalObject)
{
    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    if (!globalObject->moduleGraphRegistryIfExists() || !vm.topCallFrame)
        return nullptr;
    JSModuleGraph* found = nullptr;
    StackVisitor::visit(vm.topCallFrame, vm, [&](StackVisitor& visitor) {
        if (visitor->codeType() == StackVisitor::Frame::CodeType::Native || visitor->codeType() == StackVisitor::Frame::CodeType::Wasm)
            return IterationStatus::Continue;
        JSCell* calleeCell = visitor->callee().isCell() ? visitor->callee().asCell() : nullptr;
        // The innermost frame of module / CommonJS code decides, whichever loader's it is.
        return frameDecidesModuleGraph(globalObject, calleeCell, found) ? IterationStatus::Done : IterationStatus::Continue;
    });
    return found;
}

// $moduleGraphMainOf / $requireMapOf (CommonJS.ts): `owner` is a CommonJS module
// object or a require function bound to one.
static JSCommonJSModule* commonJSModuleForRequire(JSValue owner)
{
    if (auto* bound = dynamicDowncast<JSBoundFunction>(owner))
        owner = bound->boundThis();
    return dynamicDowncast<JSCommonJSModule>(owner);
}

JSC_DEFINE_HOST_FUNCTION(functionModuleGraphMainOf, (JSGlobalObject*, CallFrame* callFrame))
{
    auto* module = commonJSModuleForRequire(callFrame->argument(0));
    JSModuleGraph* graph = module ? module->moduleGraph() : nullptr;
    if (!graph)
        return JSValue::encode(jsUndefined());
    JSValue main = graph->mainPath();
    return JSValue::encode(main.isUndefined() ? jsNull() : main);
}

JSC_DEFINE_HOST_FUNCTION(functionRequireMapOf, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* module = commonJSModuleForRequire(callFrame->argument(0));
    return JSValue::encode(requireMapFor(defaultGlobalObject(globalObject), module ? module->moduleGraph() : nullptr));
}

// The ModuleGraph whose code produced `error`, if any: the innermost frame of the
// captured stack whose callee is module / CommonJS code decides. Works for
// JSC::Exception (sync throws, any value) and ErrorInstance reasons. An
// ErrorInstance drops its frames once its stack string is materialized (or their
// code is collected); moduleGraphNoteErrorFrames records the answer before that.
static JSModuleGraph* moduleGraphForFrames(Zig::GlobalObject* globalObject, const Vector<StackFrame>& frames, bool& decided)
{
    decided = false;
    for (const StackFrame& frame : frames) {
        JSModuleGraph* graph = nullptr;
        if (frameDecidesModuleGraph(globalObject, frame.callee(), graph)) {
            decided = true;
            return graph;
        }
    }
    return nullptr;
}

static JSModuleGraph* moduleGraphForError(Zig::GlobalObject* globalObject, JSValue error, bool& decided)
{
    decided = false;
    if (!globalObject->moduleGraphRegistryIfExists() || !error.isCell())
        return nullptr;
    if (auto* exception = dynamicDowncast<JSC::Exception>(error.asCell()))
        return moduleGraphForFrames(globalObject, exception->stack(), decided);
    auto* instance = dynamicDowncast<ErrorInstance>(error.asCell());
    if (!instance)
        return nullptr;
    if (const Vector<StackFrame>* frames = instance->stackTrace())
        return moduleGraphForFrames(globalObject, *frames, decided);
    if (JSWeakMap* noted = globalObject->moduleGraphAttributionsIfExists()) {
        JSValue graph = noted->get(instance);
        if (!graph.isUndefined()) {
            decided = true;
            return dynamicDowncast<JSModuleGraph>(graph);
        }
    }
    return nullptr;
}

// ErrorInstance::computeErrorInfo is about to drop `frames` (Bun's
// computeErrorInfo hook): keep what they said about the graph.
void moduleGraphNoteErrorFrames(Zig::GlobalObject* globalObject, ErrorInstance* instance, const Vector<StackFrame>& frames)
{
    if (!instance || !globalObject->moduleGraphRegistryIfExists())
        return;
    bool decided = false;
    JSModuleGraph* graph = moduleGraphForFrames(globalObject, frames, decided);
    if (!decided)
        return;
    VM& vm = globalObject->vm();
    globalObject->moduleGraphAttributions()->set(vm, instance, graph ? JSValue(graph) : jsNull());
}

// Rejections by graph code whose reason does not lead back to a graph (a plain value,
// or an Error constructed by host code) are attributed at rejection time, while the
// rejecting code is on the stack: promise -> graph, weakly, consulted when the
// rejection turns out unhandled.
void moduleGraphNoteRejection(Zig::GlobalObject* globalObject, JSPromise* promise)
{
    if (!globalObject->moduleGraphRegistryIfExists())
        return;
    if (JSModuleGraph* graph = ambientModuleGraph(globalObject))
        globalObject->moduleGraphAttributions()->set(globalObject->vm(), promise, graph);
}

static JSModuleGraph* moduleGraphForRejectedPromise(Zig::GlobalObject* globalObject, JSValue promise)
{
    JSWeakMap* noted = globalObject->moduleGraphAttributionsIfExists();
    if (!noted || !promise || !promise.isObject())
        return nullptr;
    return dynamicDowncast<JSModuleGraph>(noted->get(asObject(promise)));
}

static bool moduleGraphReportUnhandled(Zig::GlobalObject* globalObject, JSValue rawError, JSValue error, ASCIILiteral kind, JSValue promise = JSValue())
{
    // What an onError throws synchronously (the error it was given, say) is the host's.
    if (globalObject->m_inModuleGraphOnError)
        return false;
    bool decided = false;
    JSModuleGraph* graph = moduleGraphForError(globalObject, rawError, decided);
    if (!decided)
        graph = moduleGraphForError(globalObject, error, decided);
    if (!decided)
        graph = moduleGraphForRejectedPromise(globalObject, promise);
    if (!graph || !graph->onError())
        return false;
    VM& vm = globalObject->vm();
    // Each error object goes to a graph's onError once: an onError that lets it escape
    // again later (rethrows it from a callback, rejects with it) hands it to the host.
    if (error.isObject()) {
        JSWeakMap* delivered = globalObject->moduleGraphAttributions();
        JSObject* errorObject = asObject(error);
        if (delivered->get(errorObject).isNull())
            return false;
        delivered->set(vm, errorObject, jsNull());
    }
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSObject* onError = graph->onError();
    MarkedArgumentBuffer args;
    args.append(error);
    args.append(jsString(vm, String(kind)));
    SetForScope inOnError(globalObject->m_inModuleGraphOnError, true);
    JSC::call(globalObject, onError, JSC::getCallData(onError), jsUndefined(), args);
    if (scope.exception()) [[unlikely]] {
        if (vm.hasPendingTerminationException())
            return true;
        // onError itself threw: that is the host's error.
        auto* exception = scope.exception();
        (void)scope.tryClearException();
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
    }
    return true;
}

// Called first on every uncaught exception / unhandled rejection on this thread
// (VirtualMachine::uncaught_exception / unhandled_rejection): an error thrown by a
// graph's code, or a rejection by it, goes to that graph's onError. Returns false
// for anything else, which then takes the normal path.
extern "C" bool Bun__ModuleGraph__handleUnhandled(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue encodedError, JSC::EncodedJSValue encodedPromise, int isRejection)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    if (!globalObject->moduleGraphRegistryIfExists())
        return false;
    JSValue rawError = JSValue::decode(encodedError);
    JSValue error = rawError;
    JSValue promise = JSValue::decode(encodedPromise);
    if (error.isCell()) {
        if (auto* wrapped = dynamicDowncast<JSC::Exception>(error.asCell()))
            error = wrapped->value();
    }
    return moduleGraphReportUnhandled(globalObject, rawError, error, isRejection ? "unhandledRejection"_s : "uncaughtException"_s, promise);
}

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
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSModuleGraph::JSModuleGraph(VM& vm, Structure* structure, JSModuleLoader* loader, JSLexicalEnvironment* overlay, JSString* overlaySourceSuffix, JSMap* requireMap, JSObject* onError)
    : Base(vm, structure)
    , m_loader(loader, WriteBarrierEarlyInit)
    , m_overlay(overlay, WriteBarrierEarlyInit)
    , m_overlaySourceSuffix(overlaySourceSuffix, WriteBarrierEarlyInit)
    , m_requireMap(requireMap, WriteBarrierEarlyInit)
    , m_onError(onError, WriteBarrierEarlyInit)
{
}

JSModuleGraph* JSModuleGraph::create(VM& vm, Structure* structure, JSModuleLoader* loader, JSLexicalEnvironment* overlay, JSString* overlaySourceSuffix, JSMap* requireMap, JSObject* onError)
{
    auto* cell = new (NotNull, allocateCell<JSModuleGraph>(vm)) JSModuleGraph(vm, structure, loader, overlay, overlaySourceSuffix, requireMap, onError);
    cell->finishCreation(vm);
    return cell;
}

void JSModuleGraph::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

template<typename Visitor>
void JSModuleGraph::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSModuleGraph>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_loader);
    visitor.append(thisObject->m_overlay);
    visitor.append(thisObject->m_overlaySourceSuffix);
    visitor.append(thisObject->m_requireMap);
    visitor.append(thisObject->m_onError);
    visitor.append(thisObject->m_mainPath);
    visitor.append(thisObject->m_requireCache);
    visitor.append(thisObject->m_pendingImports);
}
DEFINE_VISIT_CHILDREN(JSModuleGraph);

static JSModuleGraph* thisModuleGraph(JSGlobalObject* globalObject, ThrowScope& scope, JSValue thisValue, ASCIILiteral method)
{
    auto* graph = dynamicDowncast<JSModuleGraph>(thisValue);
    if (!graph) [[unlikely]]
        throwTypeError(globalObject, scope, makeString("ModuleGraph.prototype."_s, method, " called on an incompatible receiver"_s));
    return graph;
}

JSC_DECLARE_HOST_FUNCTION(jsModuleGraphProtoFuncImport);
JSC_DECLARE_HOST_FUNCTION(jsModuleGraphProtoFuncDispose);

// The promise import() returned settles like the loader's, unless the graph was
// disposed first (dispose() rejects it). Bound: this = graph, argument 0 = that
// promise, argument 1 = the module key; the loader's result / error follows.
JSC_DECLARE_HOST_FUNCTION(moduleGraphImportFulfilled);
JSC_DECLARE_HOST_FUNCTION(moduleGraphImportRejected);
static JSPromise* takePendingImport(JSGlobalObject* globalObject, JSModuleGraph* graph, JSValue promiseValue)
{
    auto* promise = dynamicDowncast<JSPromise>(promiseValue);
    // Settled now: the graph need not keep it (or its value) for dispose().
    JSArray* pending = graph->pendingImports();
    for (unsigned i = 0, length = pending ? pending->length() : 0; i < length; ++i) {
        if (pending->canGetIndexQuickly(i) && pending->getIndexQuickly(i) == promiseValue) {
            pending->putDirectIndex(globalObject, i, jsUndefined());
            break;
        }
    }
    return promise && promise->status() == JSPromise::Status::Pending ? promise : nullptr;
}
JSC_DEFINE_HOST_FUNCTION(moduleGraphImportFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* graph = uncheckedDowncast<JSModuleGraph>(callFrame->thisValue());
    JSPromise* promise = takePendingImport(globalObject, graph, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    if (promise)
        promise->resolve(globalObject, vm, callFrame->argument(2));
    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}
JSC_DEFINE_HOST_FUNCTION(moduleGraphImportRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* graph = uncheckedDowncast<JSModuleGraph>(callFrame->thisValue());
    JSPromise* promise = takePendingImport(globalObject, graph, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});
    // A first import that failed leaves the graph without a main module rather than
    // with one that never loaded.
    if (graph->mainPath() == callFrame->argument(1))
        graph->clearMainPath();
    if (promise)
        promise->reject(vm, callFrame->argument(2));
    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}

// import(): like dynamic import(), every failure past the receiver check is a
// rejection of the returned promise, never a synchronous throw.
static EncodedJSValue moduleGraphImport(JSGlobalObject* globalObject, JSModuleGraph* graph, JSValue specifierValue)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSModuleLoader* loader = graph->loader();
    if (!loader) {
        throwModuleGraphDisposed(globalObject, scope);
        return {};
    }
    if (!specifierValue.isString())
        return throwVMTypeError(globalObject, scope, "ModuleGraph.prototype.import: specifier must be a string"_s);
    String specifier = specifierValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    // Bare/relative specifiers resolve against process.cwd().
    JSValue cwd = JSValue::decode(Process__getCachedCwd(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    String cwdString = cwd.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto referrer = Identifier::fromString(vm, makeString(cwdString, PLATFORM_SEP, "[module-graph]"_s));
    Identifier key = loader->resolve(globalObject, Identifier::fromString(vm, specifier), referrer, nullptr, false);
    RETURN_IF_EXCEPTION(scope, {});
    JSString* keyString = identifierToJSValue(vm, key).toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (graph->mainPath().isUndefined())
        graph->setMainPath(vm, keyString);
    JSPromise* loaded = loader->requestImportModule(globalObject, key, Identifier(), nullptr, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    JSPromise* result = JSPromise::create(vm, globalObject->promiseStructure());
    {
        // Remember it for dispose(); drop the ones that settled since.
        JSArray* previous = graph->pendingImports();
        MarkedArgumentBuffer stillPending;
        for (unsigned i = 0, length = previous ? previous->length() : 0; i < length; ++i) {
            JSValue value = previous->getIndex(globalObject, i);
            RETURN_IF_EXCEPTION(scope, {});
            if (auto* promise = dynamicDowncast<JSPromise>(value); promise && promise->status() == JSPromise::Status::Pending)
                stillPending.append(promise);
        }
        stillPending.append(result);
        JSArray* pending = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), stillPending);
        RETURN_IF_EXCEPTION(scope, {});
        graph->setPendingImports(vm, pending);
    }
    MarkedArgumentBuffer boundArguments;
    boundArguments.append(result);
    boundArguments.append(keyString);
    auto bind = [&](ASCIILiteral name, NativeFunction function) -> JSValue {
        JSFunction* handler = JSFunction::create(vm, globalObject, 3, name, function, ImplementationVisibility::Private);
        return JSBoundFunction::create(vm, globalObject, handler, graph, ArgList(boundArguments), 1, jsEmptyString(vm), makeSource(name, SourceOrigin(), SourceTaintedOrigin::Untainted));
    };
    JSValue onFulfilled = bind("importFulfilled"_s, moduleGraphImportFulfilled);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue onRejected = bind("importRejected"_s, moduleGraphImportRejected);
    RETURN_IF_EXCEPTION(scope, {});
    loaded->performPromiseThenExported(vm, globalObject, onFulfilled, onRejected, jsUndefined());
    RELEASE_AND_RETURN(scope, JSValue::encode(result));
}

JSC_DEFINE_HOST_FUNCTION(jsModuleGraphProtoFuncImport, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSModuleGraph* graph = thisModuleGraph(globalObject, scope, callFrame->thisValue(), "import"_s);
    RETURN_IF_EXCEPTION(scope, {});
    EncodedJSValue result = moduleGraphImport(globalObject, graph, callFrame->argument(0));
    if (scope.exception()) [[unlikely]] {
        JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());
        return JSValue::encode(promise->rejectWithCaughtException(vm, scope));
    }
    return result;
}

JSC_DEFINE_HOST_FUNCTION(jsModuleGraphProtoFuncDispose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSModuleGraph* graph = thisModuleGraph(globalObject, scope, callFrame->thisValue(), "dispose"_s);
    RETURN_IF_EXCEPTION(scope, {});
    // Drop the loader's registry and this graph's CommonJS cache; reject import()s
    // still pending. Code of the graph that is still running keeps what it closes
    // over, as usual (the loader stays reachable from the overlay's @moduleLoader,
    // so import() from such code still finds the graph, and rejects); onError stays
    // for its errors.
    if (JSModuleLoader* loader = graph->loader())
        loader->clearAll();
    graph->clearLoader();
    if (JSArray* pending = graph->pendingImports()) {
        graph->setPendingImports(vm, nullptr);
        for (unsigned i = 0, length = pending->length(); i < length; ++i) {
            JSValue value = pending->getIndex(globalObject, i);
            RETURN_IF_EXCEPTION(scope, {});
            if (auto* promise = dynamicDowncast<JSPromise>(value); promise && promise->status() == JSPromise::Status::Pending)
                promise->reject(vm, createTypeError(globalObject, "ModuleGraph has been disposed"_s));
        }
    }
    graph->requireMap()->clear(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    graph->setRequireCache(vm, jsUndefined());
    return JSValue::encode(jsUndefined());
}

JSC_DECLARE_CUSTOM_GETTER(jsModuleGraphGetter_mainModule);
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
        auto* ptr = new (NotNull, allocateCell<JSModuleGraphPrototype>(vm)) JSModuleGraphPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
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
        auto* structure = Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
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
    { "import"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsModuleGraphProtoFuncImport, 1 } },
    { "dispose"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsModuleGraphProtoFuncDispose, 0 } },
    { "mainModule"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsModuleGraphGetter_mainModule, 0 } },
};

const ClassInfo JSModuleGraphPrototype::s_info = { "ModuleGraph"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleGraphPrototype) };

void JSModuleGraphPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSModuleGraph::info(), JSModuleGraphPrototypeTableValues, *this);
    putDirectWithoutTransition(vm, vm.propertyNames->disposeSymbol, getDirect(vm, Identifier::fromString(vm, "dispose"_s)), static_cast<unsigned>(PropertyAttribute::DontEnum));
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// The overlay's names are the host's `globals` keys. Graphs made with the same set of
// names get overlays of one symbol table, so the modules they load share executables
// (m_moduleGraphOverlaySymbolTables: sorted names → SymbolTable). Every overlay also
// binds @moduleLoader (what import() compiles to a lookup of), which sends import()
// from ANY code scoped to the graph — CommonJS wrappers too, not only its ES
// modules — to the graph's loader.
static JSLexicalEnvironment* createModuleGraphOverlay(JSGlobalObject* globalObject, JSObject* globals, JSModuleLoader*& loader, JSString*& sourceSuffix)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* zigGlobal = defaultGlobalObject(globalObject);

    Vector<Identifier> names;
    if (globals) {
        PropertyNameArrayBuilder properties(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        globals->methodTable()->getOwnPropertyNames(globals, globalObject, properties, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, nullptr);
        for (auto& name : properties)
            names.append(name);
        std::sort(names.begin(), names.end(), [](const Identifier& a, const Identifier& b) { return codePointCompare(a.string(), b.string()) < 0; });
    }
    // One text per name set: each name as <length>:<name>, so no two sets share a key.
    StringBuilder joined;
    for (auto& name : names)
        joined.append(name.length(), ':', name.string());
    JSMap* symbolTables = zigGlobal->moduleGraphOverlaySymbolTables();
    JSString* namesKey = jsString(vm, joined.toString());
    // Classic code compiled to run in this overlay (CommonJS wrappers) carries this comment,
    // so the code cache keeps it apart from the same text compiled for the global scope or
    // for another overlay shape: names percent-encoded onto one line.
    {
        StringBuilder suffix;
        suffix.append("\n// ModuleGraph scope:"_s);
        for (auto& name : names) {
            suffix.append(' ');
            for (auto codeUnit : StringView(name.string()).codeUnits()) {
                if (isASCIIAlphanumeric(codeUnit) || codeUnit == '_' || codeUnit == '$')
                    suffix.append(static_cast<char>(codeUnit));
                else
                    suffix.append('%', hex(codeUnit, 4));
            }
        }
        sourceSuffix = jsString(vm, suffix.toString());
    }
    JSValue existing = symbolTables->get(globalObject, namesKey);
    RETURN_IF_EXCEPTION(scope, nullptr);
    SymbolTable* symbolTable = existing ? dynamicDowncast<SymbolTable>(existing) : nullptr;
    if (!symbolTable) {
        symbolTable = SymbolTable::create(vm);
        for (auto& name : names)
            symbolTable->add(NoLockingNecessary, name.impl(), SymbolTableEntry(VarOffset(symbolTable->takeNextScopeOffset(NoLockingNecessary))));
        symbolTable->add(NoLockingNecessary, vm.propertyNames->builtinNames().moduleLoaderPrivateName().impl(), SymbolTableEntry(VarOffset(symbolTable->takeNextScopeOffset(NoLockingNecessary))));
        symbolTables->set(globalObject, namesKey, symbolTable);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }

    JSLexicalEnvironment* overlay = JSLexicalEnvironment::create(vm, globalObject, globalObject->globalLexicalEnvironment(), symbolTable, jsUndefined());
    loader = JSModuleLoader::create(globalObject, vm, overlay);
    overlay->variableAt(symbolTable->get(vm.propertyNames->builtinNames().moduleLoaderPrivateName().impl()).scopeOffset()).set(vm, overlay, loader);
    for (auto& name : names) {
        JSValue value = globals->get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, nullptr);
        overlay->variableAt(symbolTable->get(name.impl()).scopeOffset()).set(vm, overlay, value);
    }
    return overlay;
}

class JSModuleGraphConstructor final : public InternalFunction {
public:
    using Base = InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr DestructionMode needsDestruction = DoesNotNeedDestruction;
    static JSModuleGraphConstructor* create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
    {
        auto* ctor = new (NotNull, allocateCell<JSModuleGraphConstructor>(vm)) JSModuleGraphConstructor(vm, structure);
        ctor->finishCreation(vm, globalObject, prototype);
        return ctor;
    }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
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
JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSModuleGraphConstructor::construct(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* zigGlobal = defaultGlobalObject(globalObject);

    JSObject* globals = nullptr;
    JSValue onError = jsUndefined();
    JSValue optionsValue = callFrame->argument(0);
    if (!optionsValue.isUndefinedOrNull()) {
        Bun::V::validateObject(scope, globalObject, optionsValue, "options"_s);
        RETURN_IF_EXCEPTION(scope, {});
        JSObject* options = optionsValue.getObject();
        JSValue globalsValue = options->get(globalObject, Identifier::fromString(vm, "globals"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!globalsValue.isUndefined()) {
            Bun::V::validateObject(scope, globalObject, globalsValue, "options.globals"_s);
            RETURN_IF_EXCEPTION(scope, {});
            globals = globalsValue.getObject();
        }
        onError = options->get(globalObject, Identifier::fromString(vm, "onError"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!onError.isUndefined()) {
            Bun::V::validateFunction(scope, globalObject, onError, "options.onError"_s);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    Structure* structure = zigGlobal->JSModuleGraphStructure();
    JSObject* newTarget = asObject(callFrame->newTarget());
    if (newTarget != callFrame->jsCallee()) {
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget, structure);
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSModuleLoader* loader = nullptr;
    JSString* overlaySourceSuffix = nullptr;
    JSLexicalEnvironment* overlay = createModuleGraphOverlay(globalObject, globals, loader, overlaySourceSuffix);
    RETURN_IF_EXCEPTION(scope, {});
    JSMap* requireMap = JSMap::create(vm, globalObject->mapStructure());
    RETURN_IF_EXCEPTION(scope, {});
    JSModuleGraph* graph = JSModuleGraph::create(vm, structure, loader, overlay, overlaySourceSuffix, requireMap, onError.isUndefined() ? nullptr : asObject(onError));
    // overlay → graph, for attributing errors / scopes / loaders to it.
    zigGlobal->moduleGraphRegistry()->set(vm, overlay, graph);
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

// Bun.unsafe.ModuleGraph (UnsafeObject.rs): the class is created on first access.
JSC_DECLARE_CUSTOM_GETTER(moduleGraphConstructorGetter);
JSC_DEFINE_CUSTOM_GETTER(moduleGraphConstructorGetter, (JSGlobalObject * globalObject, EncodedJSValue, PropertyName))
{
    return JSValue::encode(defaultGlobalObject(globalObject)->JSModuleGraphConstructor());
}
extern "C" void Bun__ModuleGraph__installConstructor(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue target)
{
    VM& vm = globalObject->vm();
    asObject(JSValue::decode(target))->putDirectCustomAccessor(vm, Identifier::fromString(vm, "ModuleGraph"_s), CustomGetterSetter::create(vm, moduleGraphConstructorGetter, nullptr), PropertyAttribute::CustomValue | PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete);
}

} // namespace Bun
