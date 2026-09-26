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

#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSLexicalEnvironmentInlines.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSPromise.h>
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
// `globals`, @moduleLoader (what import() compiles to a lookup of) and @moduleGraph (the
// graph, which is how code scoped to the overlay is attributed to it and keeps it alive).
// Graphs whose `globals` have the same names share one SymbolTable, which is what JSC keys
// shared module executables on.

static Identifier moduleGraphSlotName(VM& vm) { return WebCore::builtinNames(vm).moduleGraphPrivateName(); }
static Identifier moduleLoaderSlotName(VM& vm) { return vm.propertyNames->builtinNames().moduleLoaderPrivateName(); }

// The graph whose overlay `scope` is, or null.
static JSModuleGraph* moduleGraphOfOverlay(VM& vm, JSScope* scope)
{
    auto* environment = dynamicDowncast<JSLexicalEnvironment>(scope);
    if (!environment)
        return nullptr;
    auto entry = environment->symbolTable()->get(moduleGraphSlotName(vm).impl());
    return entry.isNull() ? nullptr : dynamicDowncast<JSModuleGraph>(environment->variableAt(entry.scopeOffset()).get());
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
    add(moduleGraphSlotName(vm));
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
    JSLexicalEnvironment* overlay = JSLexicalEnvironment::create(vm, globalObject, globalObject->globalLexicalEnvironment(), symbolTable, jsUndefined());
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
    return moduleGraphOfOverlay(globalObject->vm(), loader->moduleScope());
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

enum class GraphErrorKind : uint8_t {
    UncaughtException,
    UnhandledRejection,
};

// The graph that is given an error of `graph`'s code: the nearest of it and the graphs that made it with a
// handler for it (a graph given none is part of the program of the graph whose code made it). An unhandled
// rejection with no `unhandledRejection` is an uncaught exception, as in Node. Null: the host's handlers.
static JSModuleGraph* graphGivenErrorsOf(JSModuleGraph* graph, GraphErrorKind kind)
{
    while (graph && !graph->uncaughtExceptionHandler() && !(kind == GraphErrorKind::UnhandledRejection && graph->unhandledRejectionHandler()))
        graph = graph->maker();
    return graph;
}

// An error belongs to the graph whose context it happened in: the one that is current when the
// promise is rejected.
JSModuleGraph* moduleGraphRejecting(Zig::GlobalObject* globalObject)
{
    return graphGivenErrorsOf(currentModuleGraph(globalObject), GraphErrorKind::UnhandledRejection);
}

// ─── uncaughtException, unhandledRejection ───────────────────────────────────────────

// virtual_machine_exports.rs: the reason if it is an error, else an ERR_UNHANDLED_REJECTION error that names it.
extern "C" EncodedJSValue Bun__unhandledRejectionAsUncaughtError(JSGlobalObject*, EncodedJSValue reason);

// options.unhandledRejection(reason, promise), or options.uncaughtException(error, origin) with Node's
// origins ("uncaughtException", "unhandledRejection"). `promise`: empty for an uncaught exception.
static bool deliverToHandler(Zig::GlobalObject* globalObject, JSModuleGraph* graph, GraphErrorKind kind, JSValue error, JSValue promise)
{
    graph = graphGivenErrorsOf(graph, kind);
    if (!graph)
        return false;
    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    // The handler is its maker's: it runs in the context the graph was made in (the host's, or the
    // enclosing graph's), so what it throws, rejects or starts is that context's. So does whatever
    // else giving it the error runs (a trap of a reason that is a Proxy).
    ErrorHandlerContextScope inMakersContext(globalObject, graph->maker());
    MarkedArgumentBuffer args;
    JSObject* handler = graph->uncaughtExceptionHandler();
    bool isRejection = kind == GraphErrorKind::UnhandledRejection;
    if (isRejection && graph->unhandledRejectionHandler()) {
        handler = graph->unhandledRejectionHandler();
        args.append(error);
        args.append(promise);
    } else {
        if (isRejection) {
            error = JSValue::decode(Bun__unhandledRejectionAsUncaughtError(globalObject, JSValue::encode(error)));
            if (auto* exception = dynamicDowncast<JSC::Exception>(error); exception && vm.isTerminationException(exception)) [[unlikely]]
                return true;
        }
        args.append(error);
        args.append(jsString(vm, String(isRejection ? "unhandledRejection"_s : "uncaughtException"_s)));
    }
    JSC::call(globalObject, handler, getCallData(handler), jsUndefined(), args);
    if (scope.exception()) [[unlikely]] {
        if (vm.hasPendingTerminationException())
            return true;
        auto* thrown = scope.exception();
        (void)scope.tryClearException();
        // What the handler lets escape is its own error, wherever inside it that was thrown: it goes on
        // to the handler's owner and does not come back here (a handler that re-enters its graph with
        // `run()` and throws there would otherwise be handed its own throw, without end).
        thrown->setAsyncContext(vm, globalObject->m_asyncContextData.get()->getInternalField(0));
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
// when the promise was rejected. Returns whether a graph's handler took it.
extern "C" bool Bun__ModuleGraph__handleUnhandledRejection(JSGlobalObject* lexicalGlobalObject, EncodedJSValue reason, EncodedJSValue promise, EncodedJSValue owner)
{
    auto* graph = dynamicDowncast<JSModuleGraph>(JSValue::decode(owner));
    return graph && deliverToHandler(defaultGlobalObject(lexicalGlobalObject), graph, GraphErrorKind::UnhandledRejection, JSValue::decode(reason), JSValue::decode(promise));
}

static JSModuleGraph* moduleGraphOfFrame(Zig::GlobalObject*, JSValue asyncContext, JSObject** enteredWith);

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
    if (!asyncContext)
        asyncContext = globalObject->m_asyncContextData.get()->getInternalField(0);
    return deliverToHandler(globalObject, moduleGraphOfFrame(globalObject, asyncContext, nullptr), GraphErrorKind::UncaughtException, error, JSValue());
}

// ─── The graph's context ─────────────────────────────────────────────────────────────
//
// A graph's context rides the async context (what AsyncLocalStorage uses): entering it pushes
// a frame shaped like async_hooks.ts's `Frame` whose `storage` is the graph — no
// AsyncLocalStorage ever matches it, so run()/exit()/enterWith() copy or share it like any
// other storage's frame and never drop it. The frames AsyncLocalStorage pushes on top are its
// own, unchanged: the current context is the first such frame from the head down.

// The graph whose context the frame chain headed by `asyncContext` is inside of, and the frame
// that entered it. A frame whose storage is the global object left the context the frames below
// are in, for the realm's own (createModuleGraphFrame). Only asked once a graph has been made.
static JSModuleGraph* moduleGraphOfFrame(Zig::GlobalObject* globalObject, JSValue asyncContext, JSObject** enteredWith = nullptr)
{
    VM& vm = globalObject->vm();
    auto& names = WebCore::builtinNames(vm);
    for (JSObject* frame = asyncContext.getObject(); frame;) {
        JSValue storage = frame->getDirect(vm, names.storagePublicName());
        if (!storage)
            return nullptr;
        if (auto* graph = dynamicDowncast<JSModuleGraph>(storage)) {
            if (enteredWith)
                *enteredWith = frame;
            return graph;
        }
        if (storage == globalObject)
            return nullptr;
        JSValue previous = frame->getDirect(vm, names.prevPublicName());
        frame = previous ? previous.getObject() : nullptr;
    }
    return nullptr;
}

// For built-ins that keep something long-lived of whoever made it (an http.Agent, a Bun.SQL, a
// PerformanceObserver), given the async context they are in: the Bun.ModuleGraph it is inside
// of, and the frame that entered that graph's context (what they `run()` their later work in,
// without keeping the AsyncLocalStorage stores of whoever made them).
JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleGraphOfFrame, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* global = defaultGlobalObject(globalObject);
    if (!global->m_moduleGraphs)
        return JSValue::encode(jsUndefined());
    JSModuleGraph* graph = moduleGraphOfFrame(global, callFrame->argument(0));
    return JSValue::encode(graph ? JSValue(graph) : jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionModuleGraphFrameOfFrame, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* global = defaultGlobalObject(globalObject);
    if (!global->m_moduleGraphs)
        return JSValue::encode(jsUndefined());
    JSObject* enteredWith = nullptr;
    moduleGraphOfFrame(global, callFrame->argument(0), &enteredWith);
    return JSValue::encode(enteredWith ? JSValue(enteredWith) : jsUndefined());
}

// For built-ins that keep something of a graph's in a registry of the realm's (node:perf_hooks'
// observers): whether `frame`, the async context it was made in, is of a disposed graph.
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsFrameOfStoppedModuleGraph, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(jsBoolean(shouldDropCallbackOfStoppedModuleGraph(defaultGlobalObject(globalObject), callFrame->argument(0))));
}

JSModuleGraph* currentModuleGraph(Zig::GlobalObject* globalObject)
{
    if (!globalObject->hasModuleGraphs())
        return nullptr;
    return moduleGraphOfFrame(globalObject, globalObject->m_asyncContextData.get()->getInternalField(0));
}

JSObject* currentModuleGraphFrame(Zig::GlobalObject* globalObject)
{
    if (!globalObject->hasModuleGraphs())
        return nullptr;
    JSObject* enteredWith = nullptr;
    moduleGraphOfFrame(globalObject, globalObject->m_asyncContextData.get()->getInternalField(0), &enteredWith);
    return enteredWith;
}

// VirtualMachine::current_context (only asked once a graph has been made).
extern "C" void* Bun__currentGraphContext(JSGlobalObject* globalObject)
{
    return defaultGlobalObject(globalObject)->currentScriptExecutionContext()->bunContext();
}

// The frame's properties, in the order async_hooks.ts's Frame declares them, at fixed offsets.
enum ModuleGraphFrameOffset : PropertyOffset { FrameStorage,
    FrameValue,
    FramePrev,
    FrameMasked,
    NumberOfFrameProperties };

Structure* createModuleGraphFrameStructure(VM& vm, JSGlobalObject* globalObject)
{
    auto& names = WebCore::builtinNames(vm);
    Structure* structure = JSFinalObject::createStructure(vm, globalObject, jsNull(), NumberOfFrameProperties);
    const Identifier properties[] = { names.storagePublicName(), vm.propertyNames->value, names.prevPublicName(), names.maskedPublicName() };
    for (PropertyOffset expected = 0; expected < NumberOfFrameProperties; expected++) {
        PropertyOffset offset;
        structure = Structure::addPropertyTransition(vm, structure, properties[expected], 0, offset);
        RELEASE_ASSERT(offset == expected);
    }
    return structure;
}

// `graph` null: a frame that leaves the graph's context the frames below are in, keeping their
// AsyncLocalStorage stores.
static JSObject* createModuleGraphFrame(Zig::GlobalObject* globalObject, JSModuleGraph* graph, JSValue previous)
{
    VM& vm = globalObject->vm();
    JSObject* frame = constructEmptyObject(vm, globalObject->moduleGraphFrameStructure());
    // No AsyncLocalStorage is ever this frame's storage: the graph, or the global object for the
    // realm's own context. (Not the frame: AsyncLocalStorage copies frames, and a copy is another object.)
    frame->putDirectOffset(vm, FrameStorage, graph ? static_cast<JSObject*>(graph) : static_cast<JSObject*>(globalObject));
    frame->putDirectOffset(vm, FrameValue, jsUndefined());
    frame->putDirectOffset(vm, FramePrev, previous);
    // What disable()d AsyncLocalStorages the frame below masks, frames above it mask too.
    JSValue masked = previous.isObject() ? asObject(previous)->getDirect(vm, WebCore::builtinNames(vm).maskedPublicName()) : JSValue();
    frame->putDirectOffset(vm, FrameMasked, masked ? masked : jsUndefined());
    return frame;
}

// With no script on the stack, a microtask checkpoint resets the async context
// (GlobalObject::drainMicrotasks): inside a scope native code entered, to what it entered.
static void noteEnteredFromEventLoop(Zig::GlobalObject* globalObject, JSValue asyncContext)
{
    VM& vm = globalObject->vm();
    if (vm.entryScope || !globalObject->m_moduleGraphs)
        return;
    auto& entered = globalObject->m_moduleGraphs->enteredFromEventLoop;
    if (asyncContext.isObject())
        entered.set(vm, asyncContext);
    else
        entered.clear();
}

JSValue moduleGraphAsyncContextAtEventLoop(Zig::GlobalObject* globalObject)
{
    auto* state = globalObject->m_moduleGraphs.get();
    return state && state->enteredFromEventLoop ? state->enteredFromEventLoop.get() : jsUndefined();
}

// Makes `graph`'s context current; null: the realm's own, out of whatever graph's context is
// current (a completion of the host's run from an event-loop tick nested under a graph's script,
// an event the graph's script dispatches to something of the host's). Returns the async context
// to restore, or the empty value when already there.
static JSValue makeContextCurrent(Zig::GlobalObject* globalObject, JSModuleGraph* graph)
{
    if (currentModuleGraph(globalObject) == graph)
        return {};
    auto* asyncContextData = globalObject->m_asyncContextData.get();
    JSValue previous = asyncContextData->getInternalField(0);
    // From the top of the event loop: the frame the graph's loader runs its modules in.
    JSValue frame = graph && previous.isUndefinedOrNull() ? graph->loader()->asyncContext() : JSValue();
    if (!frame || !frame.isObject())
        frame = createModuleGraphFrame(globalObject, graph, previous);
    asyncContextData->putInternalField(globalObject->vm(), 0, frame);
    return previous;
}

// VirtualMachine::entered_context: makes `context` the one native code entered (0: none) and
// returns the one to put back.
extern "C" uint32_t Bun__VirtualMachine__replaceEnteredContext(void* bunVM, uint32_t context);

ErrorHandlerContextScope::ErrorHandlerContextScope(Zig::GlobalObject* globalObject, JSModuleGraph* owner)
    : m_globalObject(globalObject)
    , m_previous(globalObject->m_asyncContextData.get()->getInternalField(0))
    , m_previousEntered(Bun__VirtualMachine__replaceEnteredContext(globalObject->bunVM(), (owner ? owner->context() : *globalObject->scriptExecutionContext()).identifier()))
{
    makeContextCurrent(globalObject, owner);
}

ErrorHandlerContextScope::~ErrorHandlerContextScope()
{
    Bun__VirtualMachine__replaceEnteredContext(m_globalObject->bunVM(), m_previousEntered);
    m_globalObject->m_asyncContextData.get()->putInternalField(m_globalObject->vm(), 0, m_previous);
}

// As makeContextCurrent, for native code coming from the event loop: what it entered is what a
// microtask checkpoint with no script on the stack resets the async context to.
static JSValue enterContext(Zig::GlobalObject* globalObject, JSModuleGraph* graph)
{
    JSValue previous = makeContextCurrent(globalObject, graph);
    if (previous)
        noteEnteredFromEventLoop(globalObject, globalObject->m_asyncContextData.get()->getInternalField(0));
    return previous;
}

ModuleGraphContextScope::ModuleGraphContextScope(Zig::GlobalObject* globalObject, JSModuleGraph* graph)
{
    if (graph)
        m_previous = enterContext(globalObject, graph);
    if (m_previous)
        m_globalObject = globalObject;
}

ModuleGraphContextScope::ModuleGraphContextScope(WebCore::ScriptExecutionContext& context)
{
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(context.jsGlobalObject());
    if (auto* graph = dynamicDowncast<JSModuleGraph>(context.moduleGraph()))
        m_previous = enterContext(globalObject, graph);
    else if (!context.isForModuleGraph() && globalObject && globalObject->hasModuleGraphs())
        m_previous = enterContext(globalObject, nullptr);
    if (m_previous)
        m_globalObject = globalObject;
}

static void leaveModuleGraphContext(Zig::GlobalObject* globalObject, JSValue previous)
{
    globalObject->m_asyncContextData.get()->putInternalField(globalObject->vm(), 0, previous);
    noteEnteredFromEventLoop(globalObject, previous);
}

ModuleGraphContextScope::~ModuleGraphContextScope()
{
    if (m_globalObject)
        leaveModuleGraphContext(m_globalObject, m_previous);
}

// VirtualMachine::enter_context: native code about to run a completion of something a graph's script
// started. Returns the async context to restore.
// `gone`: the graph was collected (its context is about to stop). Empty: nothing to do.
// `entered` is the realm whose async context was changed, which is where it is restored: a graph
// outlives the realm `bun test --isolate` retired, and the VM's global is the next file's by then.
extern "C" EncodedJSValue Bun__ModuleGraph__enterContext(WebCore::ScriptExecutionContext* context, bool* gone, JSGlobalObject** entered)
{
    auto* graph = dynamicDowncast<JSModuleGraph>(context->moduleGraph());
    *gone = !graph;
    if (!graph)
        return JSValue::encode(JSValue());
    *entered = context->jsGlobalObject();
    return JSValue::encode(enterContext(uncheckedDowncast<Zig::GlobalObject>(*entered), graph));
}

extern "C" EncodedJSValue Bun__ModuleGraph__enterRootContext(JSGlobalObject* lexicalGlobalObject)
{
    return JSValue::encode(enterContext(defaultGlobalObject(lexicalGlobalObject), nullptr));
}

extern "C" void Bun__ModuleGraph__leaveContext(JSGlobalObject* lexicalGlobalObject, EncodedJSValue previous)
{
    leaveModuleGraphContext(defaultGlobalObject(lexicalGlobalObject), JSValue::decode(previous));
}

bool shouldDropCallbackOfStoppedModuleGraph(Zig::GlobalObject* globalObject, JSValue asyncContext)
{
    auto* state = globalObject->m_moduleGraphs.get();
    if (!state)
        return false;
    JSModuleGraph* graph = moduleGraphOfFrame(globalObject, asyncContext);
    return graph && graph->context().isStopped();
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

JSModuleGraph::JSModuleGraph(VM& vm, Structure* structure, Ref<WebCore::ScriptExecutionContext>&& context, JSModuleLoader* loader, unsigned overlayShape, JSObject* uncaughtException, JSObject* unhandledRejection, JSModuleGraph* maker)
    : Base(vm, structure)
    , m_context(WTF::move(context))
    , m_loader(loader, WriteBarrierEarlyInit)
    , m_uncaughtExceptionHandler(uncaughtException, WriteBarrierEarlyInit)
    , m_unhandledRejectionHandler(unhandledRejection, WriteBarrierEarlyInit)
    , m_maker(maker, WriteBarrierEarlyInit)
    , m_overlayShape(overlayShape)
{
}

JSModuleGraph* JSModuleGraph::create(VM& vm, Zig::GlobalObject* globalObject, Structure* structure, JSModuleLoader* loader, unsigned overlayShape, JSObject* uncaughtException, JSObject* unhandledRejection, JSModuleGraph* maker)
{
    Ref context = WebCore::ScriptExecutionContext::createForModuleGraph(*globalObject->scriptExecutionContext());
    // Made in a graph's context it is that graph's, like everything else opened there: disposed
    // with it, and its maker for errors.
    if (maker)
        maker->context().ownGraphContext(context.get());
    auto* cell = new (NotNull, allocateCell<JSModuleGraph>(vm)) JSModuleGraph(vm, structure, WTF::move(context), loader, overlayShape, uncaughtException, unhandledRejection, maker);
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
    setOverlaySlot(vm, overlay(), moduleGraphSlotName(vm), this);
    m_context->setModuleGraph(this);
    // The graph's context travels with the async context: the top-level code of the graph's
    // modules runs in it however their evaluation is reached, and run() enters it.
    auto* zigGlobal = defaultGlobalObject(globalObject);
    zigGlobal->setAsyncContextTrackingEnabled(true);
    // moduleGraphRejecting() reads the async context a rejection is reported in: have the engine report in the
    // right one the rejections its own promise jobs make.
    vm.reportUnhandledRejectionsInAsyncContext();
    m_loader->setAsyncContext(vm, createModuleGraphFrame(zigGlobal, this, jsUndefined()));
}

JSLexicalEnvironment* JSModuleGraph::overlay() const
{
    return uncheckedDowncast<JSLexicalEnvironment>(m_loader->moduleScope());
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
    visitor.append(thisObject->m_uncaughtExceptionHandler);
    visitor.append(thisObject->m_unhandledRejectionHandler);
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
// usual; its error handlers stay for its errors.
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
static JSC_DECLARE_HOST_FUNCTION(jsModuleGraphPrototypeFunction_run);
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

// run(fn, ...args): call `fn` inside the graph's context, so what it and everything it starts
// open belongs to the graph — for calling into the graph's code from outside it.
JSC_DEFINE_HOST_FUNCTION(jsModuleGraphPrototypeFunction_run, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSModuleGraph* graph = thisModuleGraph(globalObject, scope, callFrame->thisValue(), "run"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue function = callFrame->argument(0);
    V::validateFunction(scope, globalObject, function, "fn"_s);
    RETURN_IF_EXCEPTION(scope, {});
    // Inside a disposed graph whatever `fn` starts would silently never complete: say so, as import() does.
    throwIfModuleGraphDisposed(globalObject, scope, graph);
    RETURN_IF_EXCEPTION(scope, {});
    ModuleGraphContextScope context(globalObject, graph);
    RELEASE_AND_RETURN(scope, JSValue::encode(JSC::call(globalObject, function, getCallData(function), jsUndefined(), ArgList(callFrame, 1))));
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
    { "run"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsModuleGraphPrototypeFunction_run, 1 } },
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

// options[name]: a function, or null if it is undefined.
static JSObject* handlerOption(Zig::GlobalObject* globalObject, ThrowScope& scope, JSObject* options, ASCIILiteral name, ASCIILiteral label)
{
    JSValue value = options->get(globalObject, Identifier::fromString(globalObject->vm(), name));
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (value.isUndefined())
        return nullptr;
    V::validateFunction(scope, globalObject, value, label);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return asObject(value);
}

// new Bun.ModuleGraph({ globals?, uncaughtException?, unhandledRejection? })
JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSModuleGraphConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* globals = nullptr;
    JSObject* uncaughtException = nullptr;
    JSObject* unhandledRejection = nullptr;
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
        uncaughtException = handlerOption(globalObject, scope, options, "uncaughtException"_s, "options.uncaughtException"_s);
        RETURN_IF_EXCEPTION(scope, {});
        unhandledRejection = handlerOption(globalObject, scope, options, "unhandledRejection"_s, "options.unhandledRejection"_s);
        RETURN_IF_EXCEPTION(scope, {});
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
    return JSValue::encode(JSModuleGraph::create(vm, globalObject, structure, loader, overlayShape, uncaughtException, unhandledRejection, currentModuleGraph(globalObject)));
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
