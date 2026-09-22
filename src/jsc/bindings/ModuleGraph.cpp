#include "root.h"

#include "ModuleGraph.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include "BunProcess.h"
#include "ErrorCode.h"
#include "isBuiltinModule.h"
#include "JSDOMExceptionHandling.h"
#include "NodeValidator.h"
#include "PathInlines.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"

#include <JavaScriptCore/AsyncContextSwapScope.h>
#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSLexicalEnvironmentInlines.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSScriptExecutionOwnerEnvironment.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/SymbolTable.h>
#include <wtf/Scope.h>
#include <JavaScriptCore/WeakGCMapInlines.h>
#include <wtf/text/StringBuilder.h>

namespace Bun {
using namespace JSC;

// ─── The overlay ─────────────────────────────────────────────────────────────────────
//
// A lexical environment over the global lexical environment: the module scope of the graph's
// loader, and the scope the wrappers of its CommonJS modules close over. It holds the host's
// `globals` and @moduleLoader (what import() compiles to a lookup of). It is a
// JSScriptExecutionOwnerEnvironment: the script made under it belongs to it, so a function of the
// graph's runs in the graph's context whoever calls it (JavaScriptCore's op_enter,
// CodeBlock::scriptExecutionOwnerDepth()), the overlay is what is current while it does, and the
// graph is the object the overlay keeps (which is how code scoped to the overlay is attributed to
// the graph and keeps it alive). Graphs whose `globals` have the same names share one SymbolTable,
// which is what JSC keys shared module executables on.

static Identifier moduleLoaderSlotName(VM& vm) { return vm.propertyNames->builtinNames().moduleLoaderPrivateName(); }

// The graph whose overlay `scope` is, or null.
static JSModuleGraph* moduleGraphOfOverlay(JSCell* scope)
{
    auto* overlay = dynamicDowncast<JSScriptExecutionOwnerEnvironment>(scope);
    JSCell* graph = overlay ? overlay->embedderObject() : nullptr;
    return graph ? dynamicDowncast<JSModuleGraph>(graph) : nullptr;
}

static ModuleGraphState& moduleGraphState(Zig::GlobalObject* globalObject)
{
    auto& state = globalObject->m_moduleGraphs;
    if (!state)
        state = makeUnique<ModuleGraphState>(globalObject->vm());
    return *state;
}

static SymbolTable* overlaySymbolTable(Zig::GlobalObject* globalObject, const Vector<Identifier>& sortedNames, unsigned& shape)
{
    VM& vm = globalObject->vm();
    // One key per name set: each name as <length>:<name>, so no two sets share a key.
    StringBuilder keyBuilder;
    for (auto& name : sortedNames)
        keyBuilder.append(name.length(), ':', name.string());
    String key = keyBuilder.toString();
    auto& shapes = moduleGraphState(globalObject).overlayShapes;
    shape = shapes.ensure(key, [&] { return shapes.size() + 1; }).iterator->value;
    auto& symbolTables = moduleGraphState(globalObject).overlaySymbolTables;
    if (SymbolTable* existing = symbolTables.get(key))
        return existing;
    SymbolTable* symbolTable = SymbolTable::create(vm);
    auto add = [&](const Identifier& name) {
        symbolTable->add(NoLockingNecessary, name.impl(), SymbolTableEntry(VarOffset(symbolTable->takeNextScopeOffset(NoLockingNecessary))));
    };
    for (auto& name : sortedNames)
        add(name);
    add(moduleLoaderSlotName(vm));
    symbolTables.set(key, symbolTable);
    return symbolTable;
}

// The symbol table is shared by every overlay of its shape, each holding other values: a write
// invalidates the entry's watchpoint so compiled code never takes one overlay's value for a constant.
static void setOverlaySlot(VM& vm, JSLexicalEnvironment* overlay, const Identifier& name, JSValue value)
{
    SymbolTable* symbolTable = overlay->symbolTable();
    InlineWatchpointSet* watchpoints = nullptr;
    ScopeOffset offset;
    {
        ConcurrentJSLocker locker(symbolTable->m_lock);
        auto entry = symbolTable->find(locker, name.impl());
        ASSERT(entry != symbolTable->end(locker));
        offset = entry->value.scopeOffset();
        watchpoints = entry->value.watchpointSet();
    }
    overlay->variableAt(offset).set(vm, overlay, value);
    if (watchpoints)
        watchpoints->invalidate(vm, StringFireDetail("A Bun.ModuleGraph overlay variable was written"));
}

// The new graph's loader, over a new overlay holding `globals`.
static JSModuleLoader* createModuleGraphLoader(Zig::GlobalObject* globalObject, JSObject* globals, unsigned& overlayShape)
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
    SymbolTable* symbolTable = overlaySymbolTable(globalObject, names, overlayShape);
    auto* overlay = JSScriptExecutionOwnerEnvironment::create(vm, globalObject, globalObject->globalLexicalEnvironment(), symbolTable, jsUndefined());
    for (auto& name : names) {
        JSValue value = globals->get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, nullptr);
        setOverlaySlot(vm, overlay, name, value);
    }
    JSModuleLoader* loader = JSModuleLoader::create(globalObject, vm, overlay);
    setOverlaySlot(vm, overlay, moduleLoaderSlotName(vm), loader);
    return loader;
}

// ─── Which graph ─────────────────────────────────────────────────────────────────────

JSModuleGraph* moduleGraphOfLoader(JSGlobalObject* globalObject, JSModuleLoader* loader)
{
    if (!loader || loader == globalObject->moduleLoader())
        return nullptr;
    return moduleGraphOfOverlay(loader->moduleScope());
}

JSMap* requireMapOf(Zig::GlobalObject* globalObject, JSModuleGraph* graph)
{
    return graph ? graph->requireMap() : globalObject->requireMap();
}

void throwIfModuleGraphDisposed(JSGlobalObject* globalObject, ThrowScope& scope, JSModuleGraph* graph)
{
    if (graph && graph->disposed())
        throwException(globalObject, scope, createError(globalObject, ErrorCode::ERR_INVALID_STATE, "ModuleGraph has been disposed"_s));
}

JSModuleLoader* moduleLoaderOf(JSGlobalObject* globalObject, ThrowScope& scope, JSModuleGraph* graph)
{
    throwIfModuleGraphDisposed(globalObject, scope, graph);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return graph ? graph->loader() : globalObject->moduleLoader();
}

// The graph whose onError is given the errors of `graph`'s code: a graph that was given no onError
// is part of the program of the graph whose code made it. Null: the host's handlers.
static JSModuleGraph* graphGivenErrorsOf(JSModuleGraph* graph)
{
    while (graph && !graph->onError())
        graph = graph->maker();
    return graph;
}

// An error belongs to the graph whose context it happened in: the one that is current when the
// promise is rejected.
JSModuleGraph* moduleGraphRejecting(Zig::GlobalObject* globalObject)
{
    return graphGivenErrorsOf(currentModuleGraph(globalObject));
}

// ─── onError ─────────────────────────────────────────────────────────────────────────

static bool deliverToOnError(Zig::GlobalObject* globalObject, JSModuleGraph* graph, JSValue error, ASCIILiteral kind)
{
    graph = graphGivenErrorsOf(graph);
    if (!graph)
        return false;
    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSObject* onError = graph->onError();
    MarkedArgumentBuffer args;
    args.append(error);
    args.append(jsString(vm, String(kind)));
    // The handler is its maker's: it runs in the context the graph was made in (the host's, or the
    // enclosing graph's), so what it throws, rejects or starts is that context's.
    ErrorHandlerContextScope inMakersContext(globalObject, graph->maker());
    JSC::call(globalObject, onError, getCallData(onError), jsUndefined(), args);
    if (scope.exception()) [[unlikely]] {
        if (vm.hasPendingTerminationException())
            return true;
        auto* thrown = scope.exception();
        (void)scope.tryClearException();
        // What the handler lets escape is its own error, wherever inside it that was thrown: it goes on
        // to the handler's owner and does not come back here (an onError that calls a function of its
        // graph's that throws would otherwise be handed its own throw, without end).
        thrown->setAsyncContext(vm, AsyncContextSwapScope::current(vm, globalObject));
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, thrown);
    }
    return true;
}

// VirtualMachine::unhandled_rejection, for a rejection native code reports as it happens (a
// `Bun.cron()` tick's, a module's that failed to load): whose it is, as the tracker would decide now.
extern "C" EncodedJSValue Bun__ModuleGraph__rejecting(JSGlobalObject* lexicalGlobalObject)
{
    JSModuleGraph* graph = moduleGraphRejecting(defaultGlobalObject(lexicalGlobalObject));
    return JSValue::encode(graph ? JSValue(graph) : jsNull());
}

// VirtualMachine::unhandled_rejection, first: `owner` is what moduleGraphRejecting decided
// when the promise was rejected. Returns whether a graph's onError took it.
extern "C" bool Bun__ModuleGraph__handleUnhandledRejection(JSGlobalObject* lexicalGlobalObject, EncodedJSValue reason, EncodedJSValue owner)
{
    auto* graph = dynamicDowncast<JSModuleGraph>(JSValue::decode(owner));
    return graph && deliverToOnError(defaultGlobalObject(lexicalGlobalObject), graph, JSValue::decode(reason), "unhandledRejection"_s);
}

// VirtualMachine::uncaught_exception, first. An exception is the graph's whose context it was thrown
// in (the engine notes it on the Exception: by the time it is reported, whoever entered that context
// to call the script has left it). A value nobody threw is reported as it happens: the current one.
extern "C" bool Bun__ModuleGraph__handleUncaughtException(JSGlobalObject* lexicalGlobalObject, EncodedJSValue encodedError)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    if (!globalObject->hasModuleGraphs())
        return false;
    JSValue error = JSValue::decode(encodedError);
    JSValue asyncContext;
    if (auto* exception = error.isCell() ? dynamicDowncast<JSC::Exception>(error.asCell()) : nullptr) {
        error = exception->value();
        asyncContext = exception->asyncContext();
    }
    JSModuleGraph* graph = asyncContext ? moduleGraphOfCapturedContext(asyncContext) : currentModuleGraph(globalObject);
    return deliverToOnError(globalObject, graph, error, "uncaughtException"_s);
}

// ─── The graph's context ─────────────────────────────────────────────────────────────
//
// A graph's context travels next to the async context (what AsyncLocalStorage uses), as the
// script execution owner in JSGlobalObject::m_asyncContextData: JSC captures the two together
// at every then / await / microtask and restores them together (AsyncContextSwapScope), and so
// does Bun where it captures the async context for a callback. No owner: the realm's own.

// The script execution owner is a graph's overlay: the scope the graph's script is made under, which is what the
// engine compares a function's scope chain with when it is called.
static JSModuleGraph* moduleGraphOfScriptExecutionOwner(JSValue owner)
{
    return owner.isCell() ? moduleGraphOfOverlay(owner.asCell()) : nullptr;
}

JSModuleGraph* currentModuleGraph(Zig::GlobalObject* globalObject)
{
    return moduleGraphOfScriptExecutionOwner(globalObject->m_asyncContextData->getInternalField(1));
}

JSModuleGraph* moduleGraphOfCapturedContext(JSValue captured)
{
    JSValue owner = AsyncContextSwapScope::scriptExecutionOwnerOf(captured);
    return moduleGraphOfScriptExecutionOwner(owner);
}

// VirtualMachine::current_context (only asked once a graph has been made).
extern "C" void* Bun__currentGraphContext(JSGlobalObject* globalObject)
{
    return defaultGlobalObject(globalObject)->currentScriptExecutionContext()->bunContext();
}

// For built-ins that keep something of a graph's in a registry of the realm's (node:perf_hooks'
// observers): whether `graph`, the one it was made in (undefined: the host), is disposed. `graph` is what script reads
// for the current one: its script execution owner.
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsDisposedModuleGraph, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* graph = moduleGraphOfScriptExecutionOwner(callFrame->argument(0));
    return JSValue::encode(jsBoolean(graph && graph->disposed()));
}

// Makes `graph`'s context current; null: the realm's own, out of whatever graph's context is
// current (a completion of the host's run from an event-loop tick nested under a graph's script,
// an event the graph's script dispatches to something of the host's). Returns what to put back on
// leaving it (an empty owner: already there, nothing to put back): the owner, and the async
// context with it, so that what the entered script leaves there with
// AsyncLocalStorage.enterWith() ends with its context instead of reaching the caller.
static Bun::PreviousModuleGraphContext makeContextCurrent(Zig::GlobalObject* globalObject, JSModuleGraph* graph)
{
    auto* asyncContextData = globalObject->m_asyncContextData.get();
    JSValue previous = asyncContextData->getInternalField(1);
    JSValue owner = graph ? JSValue(graph->overlay()) : jsUndefined();
    if (previous == owner)
        return {};
    asyncContextData->putInternalField(globalObject->vm(), 1, owner);
    return { JSValue::encode(previous), JSValue::encode(asyncContextData->getInternalField(0)) };
}

static void leaveContext(Zig::GlobalObject* globalObject, Bun::PreviousModuleGraphContext previous)
{
    auto* asyncContextData = globalObject->m_asyncContextData.get();
    asyncContextData->putInternalField(globalObject->vm(), 0, JSValue::decode(previous.asyncContext));
    asyncContextData->putInternalField(globalObject->vm(), 1, JSValue::decode(previous.owner));
}

// VirtualMachine::entered_context: makes `context` the one native code entered (0: none) and
// returns the one to put back.
extern "C" uint32_t Bun__VirtualMachine__replaceEnteredContext(void* bunVM, uint32_t context);

ErrorHandlerContextScope::ErrorHandlerContextScope(Zig::GlobalObject* globalObject, JSModuleGraph* owner)
    : m_globalObject(globalObject)
    , m_previousAsyncContext(globalObject->m_asyncContextData->getInternalField(0))
    , m_previousOwner(globalObject->m_asyncContextData->getInternalField(1))
    , m_previousEntered(Bun__VirtualMachine__replaceEnteredContext(globalObject->bunVM(), (owner ? owner->context() : *globalObject->scriptExecutionContext()).identifier()))
{
    makeContextCurrent(globalObject, owner);
}

ErrorHandlerContextScope::~ErrorHandlerContextScope()
{
    Bun__VirtualMachine__replaceEnteredContext(m_globalObject->bunVM(), m_previousEntered);
    auto* asyncContextData = m_globalObject->m_asyncContextData.get();
    asyncContextData->putInternalField(m_globalObject->vm(), 0, m_previousAsyncContext);
    asyncContextData->putInternalField(m_globalObject->vm(), 1, m_previousOwner);
}

ModuleGraphContextScope::ModuleGraphContextScope(Zig::GlobalObject* globalObject, JSModuleGraph* graph)
{
    if (graph)
        m_previous = makeContextCurrent(globalObject, graph);
    if (m_previous.owner)
        m_globalObject = globalObject;
}

ModuleGraphContextScope::ModuleGraphContextScope(WebCore::ScriptExecutionContext& context)
{
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(context.jsGlobalObject());
    if (auto* graph = dynamicDowncast<JSModuleGraph>(context.moduleGraph()))
        m_previous = makeContextCurrent(globalObject, graph);
    else if (!context.isForModuleGraph() && globalObject)
        m_previous = makeContextCurrent(globalObject, nullptr);
    if (m_previous.owner)
        m_globalObject = globalObject;
}

ModuleGraphContextScope::~ModuleGraphContextScope()
{
    if (m_globalObject)
        leaveContext(m_globalObject, m_previous);
}

// VirtualMachine::enter_context: native code about to run a completion of something a graph's script
// started. Returns what to put back.
// `gone`: the graph was collected (its context is about to stop). Empty: nothing to do.
// `entered` is the realm whose owner was changed, which is where it is restored: a graph
// outlives the realm `bun test --isolate` retired, and the VM's global is the next file's by then.
extern "C" Bun::PreviousModuleGraphContext Bun__ModuleGraph__enterContext(WebCore::ScriptExecutionContext* context, bool* gone, JSGlobalObject** entered)
{
    auto* graph = dynamicDowncast<JSModuleGraph>(context->moduleGraph());
    *gone = !graph;
    if (!graph)
        return {};
    *entered = context->jsGlobalObject();
    return makeContextCurrent(uncheckedDowncast<Zig::GlobalObject>(*entered), graph);
}

extern "C" Bun::PreviousModuleGraphContext Bun__ModuleGraph__enterRootContext(JSGlobalObject* lexicalGlobalObject)
{
    return makeContextCurrent(defaultGlobalObject(lexicalGlobalObject), nullptr);
}

extern "C" void Bun__ModuleGraph__leaveContext(JSGlobalObject* lexicalGlobalObject, Bun::PreviousModuleGraphContext previous)
{
    leaveContext(defaultGlobalObject(lexicalGlobalObject), previous);
}

bool shouldDropCallbackOfStoppedModuleGraph(JSValue capturedContext)
{
    JSModuleGraph* graph = moduleGraphOfCapturedContext(capturedContext);
    return graph && graph->disposed();
}

// ─── JSModuleGraph ───────────────────────────────────────────────────────────────────

const ClassInfo JSModuleGraph::s_info = { "ModuleGraph"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleGraph) };

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSModuleGraph::subspaceFor(VM& vm)
{
    if constexpr (mode == SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSModuleGraph, WebCore::UseCustomHeapCellType::Yes>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSModuleGraph, m_subspaceForJSModuleGraph),
        [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForJSModuleGraph; });
}

Structure* JSModuleGraph::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return createClassStructure(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSModuleGraph::JSModuleGraph(VM& vm, Structure* structure, Ref<WebCore::ScriptExecutionContext>&& context, JSModuleLoader* loader, unsigned overlayShape, JSObject* onError, JSModuleGraph* maker)
    : Base(vm, structure)
    , m_context(WTF::move(context))
    , m_loader(loader, WriteBarrierEarlyInit)
    , m_onError(onError, WriteBarrierEarlyInit)
    , m_maker(maker, WriteBarrierEarlyInit)
    , m_overlayShape(overlayShape)
{
}

JSModuleGraph* JSModuleGraph::create(VM& vm, Zig::GlobalObject* globalObject, Structure* structure, JSModuleLoader* loader, unsigned overlayShape, JSObject* onError, JSModuleGraph* maker)
{
    Ref context = WebCore::ScriptExecutionContext::createForModuleGraph(*globalObject->scriptExecutionContext());
    // Made in a graph's context it is that graph's, like everything else opened there: disposed
    // with it, and its maker for errors.
    if (maker)
        maker->context().ownGraphContext(context.get());
    auto* cell = new (NotNull, allocateCell<JSModuleGraph>(vm)) JSModuleGraph(vm, structure, WTF::move(context), loader, overlayShape, onError, maker);
    cell->finishCreation(vm, globalObject);
    return cell;
}

void JSModuleGraph::destroy(JSCell* cell)
{
    auto* graph = static_cast<JSModuleGraph*>(cell);
    graph->m_context->moduleGraphDestroyed();
    graph->JSModuleGraph::~JSModuleGraph();
}

void JSModuleGraph::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_requireMap.set(vm, this, JSMap::create(vm, globalObject->mapStructure()));
    overlay()->setEmbedderObject(vm, this);
    m_context->setModuleGraph(this);
    // The graph's context travels with the async context: the top-level code of the graph's
    // modules runs in it however their evaluation is reached.
    globalObject->setAsyncContextTrackingEnabled(true);
    m_loader->setAsyncContext(vm, AsyncContextSwapScope::captured(vm, globalObject, jsUndefined(), overlay()));
}

JSScriptExecutionOwnerEnvironment* JSModuleGraph::overlay() const
{
    return uncheckedDowncast<JSScriptExecutionOwnerEnvironment>(m_loader->moduleScope());
}

template<typename Visitor>
void JSModuleGraph::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSModuleGraph>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_loader);
    visitor.append(thisObject->m_requireMap);
    visitor.append(thisObject->m_requireCache);
    visitor.append(thisObject->m_onError);
    visitor.append(thisObject->m_maker);
    visitor.append(thisObject->m_mainPath);
}
DEFINE_VISIT_CHILDREN(JSModuleGraph);

// Like dynamic import(), every failure past the receiver check is a rejection of the
// returned promise (the caller turns a throw into one), never a synchronous throw.
JSPromise* JSModuleGraph::import(Zig::GlobalObject* globalObject, JSValue specifierValue)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    // Called by what a disposed graph had queued (on a graph it made, or still holds): like
    // everything such code starts, it does not start. The host is told the graph is disposed.
    if (auto* current = globalObject->currentScriptExecutionContext(); current->isForModuleGraph() && current->isStopped())
        return JSPromise::create(vm, globalObject->promiseStructure());
    JSModuleLoader* loader = moduleLoaderOf(globalObject, scope, this);
    RETURN_IF_EXCEPTION(scope, nullptr);
    V::validateString(scope, globalObject, specifierValue, "specifier"_s);
    RETURN_IF_EXCEPTION(scope, nullptr);
    String specifier = specifierValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    // Bare/relative specifiers resolve against process.cwd().
    JSValue cwdValue = getCachedCwd(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    String cwd = cwdValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto referrer = Identifier::fromString(vm, makeString(cwd, PLATFORM_SEP, "[module-graph]"_s));
    Identifier key = loader->resolve(globalObject, Identifier::fromString(vm, specifier), referrer, nullptr, false);
    RETURN_IF_EXCEPTION(scope, nullptr);
    // The first import makes its module main, whether or not it then loads. (Not a builtin: it
    // is no graph's module.)
    bool becomesMain = !m_mainPath && !Bun::isBuiltinModule(key.string());
    if (becomesMain)
        m_mainPath.set(vm, this, jsString(vm, key.string()));
    JSPromise* loaded = loader->requestImportModule(globalObject, key, Identifier(), nullptr, nullptr);
    if (scope.exception()) [[unlikely]] {
        if (becomesMain)
            m_mainPath.clear();
        return nullptr;
    }
    // The loader marks its promise handled (import() in script derives one from it): so is what is
    // returned here derived, by a reaction of JSC's own with no handler, so that a failure nobody
    // handles is reported.
    JSPromise* result = JSPromise::create(vm, globalObject->promiseStructure());
    result->pipeFrom(vm, loaded);
    return result;
}

// Drops the loader's registry and the graph's CommonJS cache, and stops the graph's context.
// No promise is settled. Code of the graph that is still running keeps what it closes over, as
// usual; onError stays for its errors.
void JSModuleGraph::dispose(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!disposed())
        m_loader->clearAll();
    // Everything the graph's script opened goes: servers, sockets, timers, in-flight requests,
    // child processes, workers.
    m_context->stop();
    m_requireMap->clear(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    m_requireCache.clear();
}

void disposeModuleGraphOfContext(WebCore::ScriptExecutionContext& context)
{
    auto* graph = dynamicDowncast<JSModuleGraph>(context.moduleGraph());
    if (!graph) {
        context.stop();
        return;
    }
    auto* globalObject = defaultGlobalObject(graph->globalObject());
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
    graph->dispose(globalObject);
    // (Emptying its require map can run a getter; the graph being disposed has nobody to tell.)
    (void)scope.tryClearException();
}

// ─── Bun.ModuleGraph ──────────────────────────────────────────────────────────

static JSC_DECLARE_HOST_FUNCTION(jsModuleGraphPrototypeFunction_import);
static JSC_DECLARE_HOST_FUNCTION(jsModuleGraphPrototypeFunction_dispose);
static JSC_DECLARE_CUSTOM_GETTER(jsModuleGraphConstructorGetter_current);

static JSModuleGraph* thisModuleGraph(JSGlobalObject* globalObject, ThrowScope& scope, JSValue thisValue, ASCIILiteral method)
{
    auto* graph = dynamicDowncast<JSModuleGraph>(thisValue);
    if (!graph) [[unlikely]]
        WebCore::throwThisTypeError(*globalObject, scope, "ModuleGraph"_s, method);
    return graph;
}

JSC_DEFINE_HOST_FUNCTION(jsModuleGraphPrototypeFunction_import, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSModuleGraph* graph = thisModuleGraph(globalObject, scope, callFrame->thisValue(), "import"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSPromise* result = graph->import(globalObject, callFrame->argument(0));
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
    graph->dispose(defaultGlobalObject(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

// ModuleGraph.current: the graph whose context the calling code is running in (what it opens now
// would be that graph's), or undefined in the host's. For host functions shared by several graphs.
JSC_DEFINE_CUSTOM_GETTER(jsModuleGraphConstructorGetter_current, (JSGlobalObject * globalObject, EncodedJSValue, PropertyName))
{
    JSModuleGraph* graph = currentModuleGraph(defaultGlobalObject(globalObject));
    return JSValue::encode(graph ? JSValue(graph) : jsUndefined());
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
};

const ClassInfo JSModuleGraphPrototype::s_info = { "ModuleGraph"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleGraphPrototype) };

void JSModuleGraphPrototype::finishCreation(VM& vm, JSGlobalObject*)
{
    Base::finishCreation(vm);
    reifyStaticPropertyTable(vm, JSModuleGraph::info(), JSModuleGraphPrototypeTableValues, *this);
    putDirectWithoutTransition(vm, vm.propertyNames->disposeSymbol, getDirect(vm, Identifier::fromString(vm, "dispose"_s)), static_cast<unsigned>(PropertyAttribute::DontEnum));
    putToStringTagWithoutTransition(vm, this, info());
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
        putDirectCustomAccessor(vm, Identifier::fromString(vm, "current"_s), CustomGetterSetter::create(vm, jsModuleGraphConstructorGetter_current, nullptr), PropertyAttribute::CustomAccessor | PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum);
    }
};

const ClassInfo JSModuleGraphConstructor::s_info = { "ModuleGraph"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleGraphConstructor) };

// new Bun.ModuleGraph({ globals?, onError? })
JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSModuleGraphConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* globals = nullptr;
    JSObject* onError = nullptr;
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
        JSValue onErrorValue = options->get(globalObject, Identifier::fromString(vm, "onError"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!onErrorValue.isUndefined()) {
            V::validateFunction(scope, globalObject, onErrorValue, "options.onError"_s);
            RETURN_IF_EXCEPTION(scope, {});
            onError = asObject(onErrorValue);
        }
    }

    Structure* structure = globalObject->JSModuleGraphStructure();
    JSObject* newTarget = asObject(callFrame->newTarget());
    if (newTarget != callFrame->jsCallee()) {
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget, structure);
        RETURN_IF_EXCEPTION(scope, {});
    }
    unsigned overlayShape = 0;
    JSModuleLoader* loader = createModuleGraphLoader(globalObject, globals, overlayShape);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(JSModuleGraph::create(vm, globalObject, structure, loader, overlayShape, onError, currentModuleGraph(globalObject)));
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

} // namespace Bun
