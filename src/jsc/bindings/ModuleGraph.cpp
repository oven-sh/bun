#include "root.h"

#include "ModuleGraph.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include "BunProcess.h"
#include "ErrorCode.h"
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
#include <JavaScriptCore/JSModuleEnvironment.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/StackFrame.h>
#include <JavaScriptCore/StackVisitor.h>
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

// Which graph's code a function, an error or a rejection belongs to. std::optional: nullopt =
// this frame / stack does not say (plain global-scope code, natives), nullptr = the global
// object's own module code, else the graph.

// A frame of the global loader's CommonJS module code: no module environment on its scope
// chain, unlike ES module code, but host module code all the same. (Function() and eval code
// carry their creator's origin but no source URL of their own.)
static bool isHostCommonJSModuleCode(JSFunction* function)
{
    if (function->isHostOrBuiltinFunction())
        return false;
    JSC::SourceProvider* provider = function->jsExecutable()->source().provider();
    return provider && provider->sourceType() == SourceProviderSourceType::Program && !provider->sourceURL().isEmpty() && provider->sourceOrigin().url().protocolIsFile();
}

static std::optional<JSModuleGraph*> moduleGraphOwningScope(Zig::GlobalObject* globalObject, JSScope* scope)
{
    VM& vm = globalObject->vm();
    JSScope* globalLexicalEnvironment = globalObject->globalLexicalEnvironment();
    bool isModuleCode = false;
    for (JSScope* cursor = scope; cursor && cursor != globalLexicalEnvironment; cursor = cursor->next()) {
        // An overlay sits directly on the global lexical environment.
        if (cursor->next() == globalLexicalEnvironment) {
            if (JSModuleGraph* graph = moduleGraphOfOverlay(vm, cursor))
                return graph;
        }
        isModuleCode |= cursor->type() == ModuleEnvironmentType;
    }
    return isModuleCode ? std::optional<JSModuleGraph*>(nullptr) : std::nullopt;
}

static std::optional<JSModuleGraph*> moduleGraphOwningFrame(Zig::GlobalObject* globalObject, JSCell* callee)
{
    if (auto* function = dynamicDowncast<JSFunction>(callee)) {
        if (function->isHostFunction())
            return std::nullopt;
        auto owner = moduleGraphOwningScope(globalObject, function->scope());
        if (!owner && isHostCommonJSModuleCode(function))
            return nullptr;
        return owner;
    }
    if (auto* code = dynamicDowncast<JSCallee>(callee)) // module / program / eval code
        return moduleGraphOwningScope(globalObject, code->scope());
    return std::nullopt;
}

// The code running now: the innermost frame on the stack (vm.topCallFrame) that says.
static std::optional<JSModuleGraph*> moduleGraphOwningCurrentStack(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    std::optional<JSModuleGraph*> found;
    if (!vm.topCallFrame)
        return found;
    StackVisitor::visit(vm.topCallFrame, vm, [&](StackVisitor& visitor) {
        if (visitor->codeType() == StackVisitor::Frame::CodeType::Native || visitor->codeType() == StackVisitor::Frame::CodeType::Wasm)
            return IterationStatus::Continue;
        found = moduleGraphOwningFrame(globalObject, visitor->callee().isCell() ? visitor->callee().asCell() : nullptr);
        return found ? IterationStatus::Done : IterationStatus::Continue;
    });
    return found;
}

// The code that captured `frames` (a throw site, or where an Error was created).
static std::optional<JSModuleGraph*> moduleGraphOwningFrames(Zig::GlobalObject* globalObject, const Vector<StackFrame>& frames)
{
    for (const StackFrame& frame : frames) {
        if (auto found = moduleGraphOwningFrame(globalObject, frame.callee()))
            return found;
    }
    return std::nullopt;
}

JSModuleGraph* moduleGraphOfRunningCode(JSGlobalObject* globalObject)
{
    auto* zigGlobal = defaultGlobalObject(globalObject);
    if (!zigGlobal->hasModuleGraphs())
        return nullptr;
    return moduleGraphOwningCurrentStack(zigGlobal).value_or(nullptr);
}

// The graph whose onError is given the errors of `graph`'s code: a graph that was given no onError
// is part of the program of the graph whose code made it. Null: the host's handlers.
static JSModuleGraph* graphGivenErrorsOf(JSModuleGraph* graph)
{
    while (graph && !graph->onError())
        graph = graph->maker();
    return graph;
}

// The code rejecting `promise` is on the stack now — or nothing is (the runtime rejects an async
// function's promise right after unwinding, and forwards a rejection to the promises derived
// from it from bare jobs), and the exception the VM last saw thrown, if it is this rejection's
// reason, carries the throw site: an error belongs to the graph whose code threw it, however
// far the promises carried it before someone left it unhandled. That exception is good for the
// turn it was thrown in (GlobalObject::drainMicrotasks clears it).
JSModuleGraph* moduleGraphRejecting(Zig::GlobalObject* globalObject, JSPromise* promise)
{
    if (!globalObject->hasModuleGraphs())
        return nullptr;
    VM& vm = globalObject->vm();
    std::optional<JSModuleGraph*> owner = moduleGraphOwningCurrentStack(globalObject);
    if (!owner) {
        JSC::Exception* last = vm.lastException();
        if (last && last->value() == promise->result())
            owner = moduleGraphOwningFrames(globalObject, last->stack());
    }
    JSModuleGraph* graph = graphGivenErrorsOf(owner ? *owner : currentModuleGraph(globalObject));
    return graph && !graph->inOnError() ? graph : nullptr;
}

// ─── onError ─────────────────────────────────────────────────────────────────────────

static bool deliverToOnError(Zig::GlobalObject* globalObject, JSModuleGraph* graph, JSValue error, ASCIILiteral kind)
{
    graph = graphGivenErrorsOf(graph);
    if (!graph || graph->inOnError())
        return false;
    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSObject* onError = graph->onError();
    MarkedArgumentBuffer args;
    args.append(error);
    args.append(jsString(vm, String(kind)));
    // Until what onError itself threw has been reported, too.
    graph->setInOnError(true);
    auto leaveOnError = makeScopeExit([&] { graph->setInOnError(false); });
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

// VirtualMachine::unhandled_rejection, first: `owner` is what moduleGraphRejecting decided
// when the promise was rejected. Returns whether a graph's onError took it.
extern "C" bool Bun__ModuleGraph__handleUnhandledRejection(JSGlobalObject* lexicalGlobalObject, EncodedJSValue reason, EncodedJSValue owner)
{
    auto* graph = dynamicDowncast<JSModuleGraph>(JSValue::decode(owner));
    return graph && deliverToOnError(defaultGlobalObject(lexicalGlobalObject), graph, JSValue::decode(reason), "unhandledRejection"_s);
}

// VirtualMachine::uncaught_exception, first: the throw site (the Exception's stack) decides.
// Callers that caught the error in JS (the nextTick drain, node-style callback shims) report
// the bare value; the exception they just caught is still the VM's last.
extern "C" bool Bun__ModuleGraph__handleUncaughtException(JSGlobalObject* lexicalGlobalObject, EncodedJSValue encodedError)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    if (!globalObject->hasModuleGraphs())
        return false;
    VM& vm = globalObject->vm();
    JSValue error = JSValue::decode(encodedError);
    auto* exception = error.isCell() ? dynamicDowncast<JSC::Exception>(error.asCell()) : nullptr;
    if (!exception && vm.lastException() && vm.lastException()->value() == error)
        exception = vm.lastException();
    vm.clearLastException();
    if (!exception)
        return false;
    auto owner = moduleGraphOwningFrames(globalObject, exception->stack());
    JSModuleGraph* graph = owner ? *owner : currentModuleGraph(globalObject);
    return deliverToOnError(globalObject, graph, exception->value(), "uncaughtException"_s);
}

// ─── The graph's context ─────────────────────────────────────────────────────────────
//
// A graph's context rides the async context (what AsyncLocalStorage uses): entering it pushes
// a frame shaped like async_hooks.ts's `Frame` whose `storage` is the graph — no
// AsyncLocalStorage ever matches it, so run()/exit()/enterWith() copy or share it like any
// other storage's frame and never drop it — and whose `graph`, which every frame pushed on top
// inherits, is what names the current context.

static JSModuleGraph* moduleGraphOfFrame(VM& vm, JSValue asyncContext)
{
    JSObject* frame = asyncContext.getObject();
    if (!frame)
        return nullptr;
    return dynamicDowncast<JSModuleGraph>(frame->getDirect(vm, WebCore::builtinNames(vm).graphPublicName()));
}

// For built-ins that keep something of a graph's in a registry of the realm's (node:perf_hooks'
// observers): whether `frame`, the async context it was made in, is of a disposed graph.
JSC_DEFINE_HOST_FUNCTION(jsFunctionIsFrameOfStoppedModuleGraph, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(jsBoolean(shouldDropCallbackOfStoppedModuleGraph(defaultGlobalObject(globalObject), callFrame->argument(0))));
}

JSModuleGraph* currentModuleGraph(Zig::GlobalObject* globalObject)
{
    return moduleGraphOfFrame(globalObject->vm(), globalObject->m_asyncContextData.get()->getInternalField(0));
}

// VirtualMachine::current_context_or_root (only asked once a graph has been made).
extern "C" void* Bun__currentGraphContext(JSGlobalObject* globalObject)
{
    return defaultGlobalObject(globalObject)->currentScriptExecutionContext()->bunContext();
}

// The frame's properties, in the order async_hooks.ts's Frame declares them, at fixed offsets.
enum ModuleGraphFrameOffset : PropertyOffset { FrameStorage,
    FrameValue,
    FramePrev,
    FrameMasked,
    FrameGraph,
    NumberOfFrameProperties };

Structure* createModuleGraphFrameStructure(VM& vm, JSGlobalObject* globalObject)
{
    auto& names = WebCore::builtinNames(vm);
    Structure* structure = JSFinalObject::createStructure(vm, globalObject, jsNull(), NumberOfFrameProperties);
    const Identifier properties[] = { names.storagePublicName(), vm.propertyNames->value, names.prevPublicName(), names.maskedPublicName(), names.graphPublicName() };
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
    // No AsyncLocalStorage is ever this frame's storage: the graph, or the frame itself.
    frame->putDirectOffset(vm, FrameStorage, graph ? static_cast<JSObject*>(graph) : frame);
    frame->putDirectOffset(vm, FrameValue, jsUndefined());
    frame->putDirectOffset(vm, FramePrev, previous);
    // What disable()d AsyncLocalStorages the frame below masks, frames above it mask too.
    JSValue masked = previous.isObject() ? asObject(previous)->getDirect(vm, WebCore::builtinNames(vm).maskedPublicName()) : JSValue();
    frame->putDirectOffset(vm, FrameMasked, masked ? masked : jsUndefined());
    frame->putDirectOffset(vm, FrameGraph, graph ? JSValue(graph) : jsUndefined());
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
static JSValue enterContext(Zig::GlobalObject* globalObject, JSModuleGraph* graph)
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
    noteEnteredFromEventLoop(globalObject, frame);
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
    JSModuleGraph* graph = moduleGraphOfFrame(globalObject->vm(), asyncContext);
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
    setOverlaySlot(vm, overlay(), moduleGraphSlotName(vm), this);
    m_context->setModuleGraph(this);
    // The graph's context travels with the async context: the top-level code of the graph's
    // modules runs in it however their evaluation is reached, and run() enters it.
    auto* zigGlobal = defaultGlobalObject(globalObject);
    zigGlobal->setAsyncContextTrackingEnabled(true);
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
    visitor.append(thisObject->m_onError);
    visitor.append(thisObject->m_maker);
    visitor.append(thisObject->m_mainPath);
    visitor.append(thisObject->m_mainImport);
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
    // The first import makes its module main. If it fails the graph is left without one (the next
    // import becomes it) rather than with one that never ran: mainPath() looks at this promise.
    bool becomesMain = mainPath().isUndefined();
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
    if (becomesMain)
        m_mainImport.set(vm, this, result);
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
    // Only its status was still of use (mainPath); fulfilled, it holds the main module's namespace.
    if (m_mainImport && m_mainImport->status() == JSPromise::Status::Rejected)
        m_mainPath.clear();
    m_mainImport.clear();
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
static JSC_DECLARE_CUSTOM_GETTER(jsModuleGraphGetter_mainModule);
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

JSC_DEFINE_CUSTOM_GETTER(jsModuleGraphGetter_mainModule, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSModuleGraph* graph = thisModuleGraph(globalObject, scope, JSValue::decode(thisValue), "mainModule"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(graph->mainPath());
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
