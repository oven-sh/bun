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
#include <JavaScriptCore/JSSetIterator.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/StackFrame.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/SymbolTable.h>
#include <JavaScriptCore/WeakGCMapInlines.h>
#include <wtf/SetForScope.h>
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

static SymbolTable* overlaySymbolTable(Zig::GlobalObject* globalObject, const Vector<Identifier>& sortedNames)
{
    VM& vm = globalObject->vm();
    // One key per name set: each name as <length>:<name>, so no two sets share a key.
    StringBuilder keyBuilder;
    for (auto& name : sortedNames)
        keyBuilder.append(name.length(), ':', name.string());
    String key = keyBuilder.toString();
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
static JSModuleLoader* createModuleGraphLoader(Zig::GlobalObject* globalObject, JSObject* globals)
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
    SymbolTable* symbolTable = overlaySymbolTable(globalObject, names);
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

JSObject* createModuleGraphDisposedError(JSGlobalObject* globalObject)
{
    return createError(globalObject, ErrorCode::ERR_INVALID_STATE, "ModuleGraph has been disposed"_s);
}

JSModuleLoader* moduleLoaderOf(JSGlobalObject* globalObject, ThrowScope& scope, JSModuleGraph* graph)
{
    if (!graph)
        return globalObject->moduleLoader();
    if (graph->disposed()) {
        throwException(globalObject, scope, createModuleGraphDisposedError(globalObject));
        return nullptr;
    }
    return graph->loader();
}

bool throwIfModuleGraphDisposed(JSGlobalObject* globalObject, ThrowScope& scope, JSModuleLoader* loader)
{
    JSModuleGraph* graph = moduleGraphOfLoader(globalObject, loader);
    if (!graph || !graph->disposed())
        return false;
    throwException(globalObject, scope, createModuleGraphDisposedError(globalObject));
    return true;
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

// The code rejecting `promise` is on the stack now — or, for an async function or a promise
// reaction whose handler threw, nothing is (the runtime rejects right after unwinding) and the
// exception it just caught, the VM's last, carries the throw site. Every tracked rejection
// consumes that exception: it speaks for the rejection that immediately follows the throw, not
// for promises later derived from that one through .then() (those, unhandled, are the host's),
// and never for an unrelated later rejection of the same value.
JSModuleGraph* moduleGraphRejecting(Zig::GlobalObject* globalObject, JSPromise* promise)
{
    if (!globalObject->hasModuleGraphs())
        return nullptr;
    VM& vm = globalObject->vm();
    std::optional<JSModuleGraph*> owner;
    if (moduleGraphState(globalObject).rejectingImport)
        owner = nullptr;
    else
        owner = moduleGraphOwningCurrentStack(globalObject);
    if (!owner) {
        JSC::Exception* last = vm.lastException();
        if (last && last->value() == promise->result())
            owner = moduleGraphOwningFrames(globalObject, last->stack());
    }
    vm.clearLastException();
    return owner.value_or(nullptr);
}

// ─── onError ─────────────────────────────────────────────────────────────────────────

static bool deliverToOnError(Zig::GlobalObject* globalObject, JSModuleGraph* graph, JSValue error, ASCIILiteral kind)
{
    auto& flags = moduleGraphState(globalObject);
    if (!graph || !graph->onError() || flags.inOnError)
        return false;
    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSObject* onError = graph->onError();
    MarkedArgumentBuffer args;
    args.append(error);
    args.append(jsString(vm, String(kind)));
    SetForScope inOnError(flags.inOnError, true);
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
    JSModuleGraph* graph = moduleGraphOwningFrames(globalObject, exception->stack()).value_or(nullptr);
    return deliverToOnError(globalObject, graph, exception->value(), "uncaughtException"_s);
}

// ─── The graph's context ─────────────────────────────────────────────────────────────
//
// A graph's context rides the async context (what AsyncLocalStorage uses): entering it pushes
// a frame shaped like async_hooks.ts's `Frame` whose `storage` is the graph — no
// AsyncLocalStorage ever matches it, so run()/exit()/enterWith() copy or share it like any
// other storage's frame and never drop it — and whose `graph`, which every frame pushed on top
// inherits, is what names the current context.

static JSIsolatedModuleGraph* isolatedModuleGraphOfFrame(VM& vm, JSValue asyncContext)
{
    JSObject* frame = asyncContext.getObject();
    if (!frame)
        return nullptr;
    return dynamicDowncast<JSIsolatedModuleGraph>(frame->getDirect(vm, WebCore::builtinNames(vm).graphPublicName()));
}

JSIsolatedModuleGraph* currentIsolatedModuleGraph(Zig::GlobalObject* globalObject)
{
    return isolatedModuleGraphOfFrame(globalObject->vm(), globalObject->m_asyncContextData.get()->getInternalField(0));
}

// VirtualMachine::current_graph_context (only asked while some graph has a context).
extern "C" void* Bun__currentGraphContext(JSGlobalObject* globalObject)
{
    return defaultGlobalObject(globalObject)->currentScriptExecutionContext()->bunContext();
}

// `graph` null: a frame that leaves the graph's context the frames below are in, keeping their
// AsyncLocalStorage stores.
static JSObject* createModuleGraphFrame(Zig::GlobalObject* globalObject, JSIsolatedModuleGraph* graph, JSValue previous)
{
    VM& vm = globalObject->vm();
    auto& names = WebCore::builtinNames(vm);
    JSObject* frame = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    // No AsyncLocalStorage is ever this frame's storage: the graph, or the frame itself.
    frame->putDirect(vm, names.storagePublicName(), graph ? static_cast<JSObject*>(graph) : frame);
    frame->putDirect(vm, vm.propertyNames->value, jsUndefined());
    frame->putDirect(vm, names.prevPublicName(), previous);
    // What disable()d AsyncLocalStorages the frame below masks, frames above it mask too.
    JSValue masked = previous.isObject() ? asObject(previous)->getDirect(vm, names.maskedPublicName()) : JSValue();
    frame->putDirect(vm, names.maskedPublicName(), masked ? masked : jsUndefined());
    frame->putDirect(vm, names.graphPublicName(), graph ? JSValue(graph) : jsUndefined());
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

// Makes `graph`'s context current. Returns the async context to restore, or the empty value when
// there was nothing to do (no context of its own, or already inside it).
static JSValue enterModuleGraphContext(Zig::GlobalObject* globalObject, JSObject* graph)
{
    auto* isolated = graph ? dynamicDowncast<JSIsolatedModuleGraph>(graph) : nullptr;
    if (!isolated || currentIsolatedModuleGraph(globalObject) == isolated)
        return {};
    auto* asyncContextData = globalObject->m_asyncContextData.get();
    JSValue previous = asyncContextData->getInternalField(0);
    // From the top of the event loop: the frame the graph's loader runs its modules in.
    JSValue frame = previous.isUndefinedOrNull() ? isolated->loader()->asyncContext() : JSValue();
    if (!frame || !frame.isObject())
        frame = createModuleGraphFrame(globalObject, isolated, previous);
    asyncContextData->putInternalField(globalObject->vm(), 0, frame);
    noteEnteredFromEventLoop(globalObject, frame);
    return previous;
}

ModuleGraphContextScope::ModuleGraphContextScope(Zig::GlobalObject* globalObject, JSModuleGraph* graph)
{
    m_previous = enterModuleGraphContext(globalObject, graph);
    if (m_previous)
        m_globalObject = globalObject;
}

// The realm's own context: out of whatever graph's context is current (a completion of the host's
// run from an event-loop tick nested under a graph's script, an event the graph's script dispatches
// to something of the host's). Empty: nothing to do.
static JSValue enterRootContext(Zig::GlobalObject* globalObject)
{
    if (!currentIsolatedModuleGraph(globalObject))
        return {};
    auto* asyncContextData = globalObject->m_asyncContextData.get();
    JSValue previous = asyncContextData->getInternalField(0);
    JSValue frame = createModuleGraphFrame(globalObject, nullptr, previous);
    asyncContextData->putInternalField(globalObject->vm(), 0, frame);
    noteEnteredFromEventLoop(globalObject, frame);
    return previous;
}

ModuleGraphContextScope::ModuleGraphContextScope(WebCore::ScriptExecutionContext& context)
{
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(context.jsGlobalObject());
    if (JSObject* graph = context.moduleGraph())
        m_previous = enterModuleGraphContext(globalObject, graph);
    else if (!context.isForModuleGraph() && globalObject && globalObject->m_moduleGraphs && globalObject->m_moduleGraphs->hasIsolatedGraphs)
        m_previous = enterRootContext(globalObject);
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
extern "C" EncodedJSValue Bun__ModuleGraph__enterContext(WebCore::ScriptExecutionContext* context, bool* gone)
{
    JSObject* graph = context->moduleGraph();
    *gone = !graph;
    if (!graph)
        return JSValue::encode(JSValue());
    return JSValue::encode(enterModuleGraphContext(uncheckedDowncast<Zig::GlobalObject>(context->jsGlobalObject()), graph));
}

extern "C" EncodedJSValue Bun__ModuleGraph__enterRootContext(JSGlobalObject* lexicalGlobalObject)
{
    return JSValue::encode(enterRootContext(defaultGlobalObject(lexicalGlobalObject)));
}

extern "C" void Bun__ModuleGraph__leaveContext(JSGlobalObject* lexicalGlobalObject, EncodedJSValue previous)
{
    leaveModuleGraphContext(defaultGlobalObject(lexicalGlobalObject), JSValue::decode(previous));
}

bool shouldDropCallbackOfStoppedModuleGraph(Zig::GlobalObject* globalObject, JSValue asyncContext)
{
    auto* state = globalObject->m_moduleGraphs.get();
    if (!state || !state->hasIsolatedGraphs)
        return false;
    JSIsolatedModuleGraph* graph = isolatedModuleGraphOfFrame(globalObject->vm(), asyncContext);
    return graph && graph->context().isStopped() && !state->teardownNotificationDepth;
}

// bun_jsc::TeardownNotification. Entering returns whether it counted (some graph has a context
// of its own), which is what leaving is then told.
extern "C" bool Bun__ModuleGraph__enterTeardownNotification(JSGlobalObject* globalObject)
{
    auto* state = defaultGlobalObject(globalObject)->m_moduleGraphs.get();
    if (!state || !state->hasIsolatedGraphs)
        return false;
    state->teardownNotificationDepth++;
    return true;
}

extern "C" void Bun__ModuleGraph__leaveTeardownNotification(JSGlobalObject* globalObject)
{
    defaultGlobalObject(globalObject)->m_moduleGraphs->teardownNotificationDepth--;
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

JSModuleGraph::JSModuleGraph(VM& vm, Structure* structure, JSModuleLoader* loader, JSObject* onError)
    : Base(vm, structure)
    , m_loader(loader, WriteBarrierEarlyInit)
    , m_onError(onError, WriteBarrierEarlyInit)
{
}

JSModuleGraph* JSModuleGraph::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSModuleLoader* loader, JSObject* onError)
{
    auto* cell = new (NotNull, allocateCell<JSModuleGraph>(vm)) JSModuleGraph(vm, structure, loader, onError);
    cell->finishCreation(vm, globalObject);
    return cell;
}

void JSModuleGraph::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_requireMap.set(vm, this, JSMap::create(vm, globalObject->mapStructure()));
    setOverlaySlot(vm, overlay(), moduleGraphSlotName(vm), this);
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
    visitor.append(thisObject->m_mainPath);
    visitor.append(thisObject->m_pendingImports);
}
DEFINE_VISIT_CHILDREN(JSModuleGraph);

// The loader's promise for a graph.import() settled. `context` is [graph, result, key].
static JSC_DECLARE_HOST_FUNCTION(jsModuleGraphImportFulfilled);
static JSC_DECLARE_HOST_FUNCTION(jsModuleGraphImportRejected);

static void importSettled(JSGlobalObject* globalObject, CallFrame* callFrame, bool rejected)
{
    auto* context = uncheckedDowncast<JSArray>(callFrame->argument(1));
    auto* graph = uncheckedDowncast<JSModuleGraph>(context->getIndexQuickly(0));
    auto* result = uncheckedDowncast<JSPromise>(context->getIndexQuickly(1));
    graph->importSettled(defaultGlobalObject(globalObject), result, context->getIndexQuickly(2), callFrame->argument(0), rejected);
}

JSC_DEFINE_HOST_FUNCTION(jsModuleGraphImportFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    importSettled(globalObject, callFrame, false);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsModuleGraphImportRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    importSettled(globalObject, callFrame, true);
    return JSValue::encode(jsUndefined());
}

void JSModuleGraph::importSettled(Zig::GlobalObject* globalObject, JSPromise* result, JSValue key, JSValue settlement, bool rejected)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (JSSet* pending = m_pendingImports.get()) {
        pending->remove(globalObject, result);
        RETURN_IF_EXCEPTION(scope, );
    }
    if (result->status() != JSPromise::Status::Pending)
        return; // dispose() rejected it
    if (!rejected) {
        scope.release();
        result->resolve(globalObject, vm, settlement);
        return;
    }
    // A first import that failed leaves the graph without a main module rather than with one
    // that never loaded.
    if (mainPath() == key)
        m_mainPath.clear();
    SetForScope rejectingImport(moduleGraphState(globalObject).rejectingImport, true);
    result->reject(vm, settlement);
}

// Like dynamic import(), every failure past the receiver check is a rejection of the
// returned promise (the caller turns a throw into one), never a synchronous throw.
JSPromise* JSModuleGraph::import(Zig::GlobalObject* globalObject, JSValue specifierValue)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
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
    JSString* keyString = jsString(vm, key.string());
    bool becameMain = mainPath().isUndefined();
    if (becameMain)
        m_mainPath.set(vm, this, keyString);
    JSPromise* loaded = loader->requestImportModule(globalObject, key, Identifier(), nullptr, nullptr);
    if (scope.exception()) [[unlikely]] {
        if (becameMain)
            m_mainPath.clear();
        return nullptr;
    }

    JSPromise* result = JSPromise::create(vm, globalObject->promiseStructure());
    if (!m_pendingImports)
        m_pendingImports.set(vm, this, JSSet::create(vm, globalObject->setStructure()));
    m_pendingImports->add(globalObject, result);
    RETURN_IF_EXCEPTION(scope, nullptr);
    MarkedArgumentBuffer contextValues;
    contextValues.append(this);
    contextValues.append(result);
    contextValues.append(keyString);
    JSArray* context = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), contextValues);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto* fulfilled = JSFunction::create(vm, globalObject, 2, "importFulfilled"_s, jsModuleGraphImportFulfilled, ImplementationVisibility::Private);
    auto* rejected = JSFunction::create(vm, globalObject, 2, "importRejected"_s, jsModuleGraphImportRejected, ImplementationVisibility::Private);
    loaded->performPromiseThenWithContext(vm, globalObject, fulfilled, rejected, jsUndefined(), context);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return result;
}

// Drops the loader's registry and the graph's CommonJS cache, and rejects import()s still
// pending. Code of the graph that is still running keeps what it closes over, as usual: its
// import() finds the graph through the overlay's @moduleLoader and rejects, its require()
// throws, and onError stays for its errors.
void JSModuleGraph::dispose(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!std::exchange(m_disposed, true))
        m_loader->clearAll();
    // Everything the graph's script opened goes: servers, sockets, timers, in-flight requests,
    // child processes, workers.
    if (auto* context = this->context())
        context->stop();
    if (JSSet* pending = m_pendingImports.get()) {
        m_pendingImports.clear();
        auto* iterator = JSSetIterator::create(vm, globalObject->setIteratorStructure(), pending, IterationKind::Keys);
        RETURN_IF_EXCEPTION(scope, );
        SetForScope rejectingImport(moduleGraphState(globalObject).rejectingImport, true);
        JSValue value;
        while (iterator->next(globalObject, value)) {
            if (auto* promise = dynamicDowncast<JSPromise>(value); promise && promise->status() == JSPromise::Status::Pending)
                promise->reject(vm, createModuleGraphDisposedError(globalObject));
            RETURN_IF_EXCEPTION(scope, );
        }
    }
    m_requireMap->clear(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    m_requireCache.clear();
}

// ─── JSIsolatedModuleGraph ───────────────────────────────────────────────────────────

const ClassInfo JSIsolatedModuleGraph::s_info = { "ModuleGraph"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSIsolatedModuleGraph) };

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSIsolatedModuleGraph::subspaceFor(VM& vm)
{
    if constexpr (mode == SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSIsolatedModuleGraph, WebCore::UseCustomHeapCellType::Yes>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSIsolatedModuleGraph, m_subspaceForJSIsolatedModuleGraph),
        [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForJSIsolatedModuleGraph; });
}

Structure* JSIsolatedModuleGraph::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return createClassStructure(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

JSIsolatedModuleGraph::JSIsolatedModuleGraph(VM& vm, Structure* structure, Ref<WebCore::ScriptExecutionContext>&& context, JSModuleLoader* loader, JSObject* onError)
    : Base(vm, structure, loader, onError)
    , m_context(WTF::move(context))
{
}

JSIsolatedModuleGraph* JSIsolatedModuleGraph::create(VM& vm, Zig::GlobalObject* globalObject, Structure* structure, JSModuleLoader* loader, JSObject* onError)
{
    Ref context = WebCore::ScriptExecutionContext::createForModuleGraph(*globalObject->scriptExecutionContext());
    auto* cell = new (NotNull, allocateCell<JSIsolatedModuleGraph>(vm)) JSIsolatedModuleGraph(vm, structure, WTF::move(context), loader, onError);
    cell->finishCreation(vm, globalObject);
    return cell;
}

void JSIsolatedModuleGraph::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm, globalObject);
    m_context->setModuleGraph(this);
    // The graph's context travels with the async context: the top-level code of the graph's
    // modules runs in it however their evaluation is reached, and run() enters it.
    auto* zigGlobal = defaultGlobalObject(globalObject);
    moduleGraphState(zigGlobal).hasIsolatedGraphs = true;
    zigGlobal->setAsyncContextTrackingEnabled(true);
    loader()->setAsyncContext(vm, createModuleGraphFrame(zigGlobal, this, jsUndefined()));
}

void JSIsolatedModuleGraph::destroy(JSCell* cell)
{
    auto* graph = static_cast<JSIsolatedModuleGraph*>(cell);
    graph->m_context->moduleGraphDestroyed();
    graph->JSIsolatedModuleGraph::~JSIsolatedModuleGraph();
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
    JSIsolatedModuleGraph* graph = currentIsolatedModuleGraph(defaultGlobalObject(globalObject));
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

// new Bun.ModuleGraph({ globals?, onError?, isolateIO? })
JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSModuleGraphConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSObject* globals = nullptr;
    JSObject* onError = nullptr;
    bool isolateIO = false;
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
        JSValue isolateIOValue = options->get(globalObject, Identifier::fromString(vm, "isolateIO"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!isolateIOValue.isUndefined()) {
            V::validateBoolean(scope, globalObject, isolateIOValue, "options.isolateIO"_s);
            RETURN_IF_EXCEPTION(scope, {});
            isolateIO = isolateIOValue.asBoolean();
        }
    }

    Structure* structure = isolateIO ? globalObject->JSIsolatedModuleGraphStructure() : globalObject->JSModuleGraphStructure();
    JSObject* newTarget = asObject(callFrame->newTarget());
    if (newTarget != callFrame->jsCallee()) {
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget, structure);
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSModuleLoader* loader = createModuleGraphLoader(globalObject, globals);
    RETURN_IF_EXCEPTION(scope, {});
    if (isolateIO)
        return JSValue::encode(JSIsolatedModuleGraph::create(vm, globalObject, structure, loader, onError));
    return JSValue::encode(JSModuleGraph::create(vm, globalObject, structure, loader, onError));
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
