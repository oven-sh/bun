#include "root.h"

#include "ModuleGraph.h"
#include "ZigGlobalObject.h"
#include "BunProcess.h"
#include "ErrorCode.h"
#include "NodeValidator.h"
#include "BunClientData.h"
#include "PathInlines.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"

#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/Microtask.h>
#include <JavaScriptCore/JSInternalFieldObjectImplInlines.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/SourceOrigin.h>
#include "JSCommonJSModule.h"
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/BuiltinNames.h>
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/StrongInlines.h>
#include <JavaScriptCore/WeakMapImplInlines.h>
#include <JavaScriptCore/StackFrame.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/JSWeakMap.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include <JavaScriptCore/JSLexicalEnvironment.h>
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSModuleEnvironment.h>
#include <JavaScriptCore/JSModuleRecord.h>
#include <JavaScriptCore/JSLexicalEnvironmentInlines.h>
#include <JavaScriptCore/SymbolTable.h>
#include <JavaScriptCore/FunctionConstructor.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <wtf/SetForScope.h>
#include <wtf/URL.h>

namespace Bun {
JSC_DECLARE_HOST_FUNCTION(functionModuleGraphProcess);
JSC_DECLARE_HOST_FUNCTION(functionModuleGraphOf);
extern "C" JSC::EncodedJSValue Bun__ModuleGraph__mainPath(JSModuleGraph*);

using namespace JSC;

extern "C" JSC::EncodedJSValue Process__getCachedCwd(JSC::JSGlobalObject* globalObject);

// Graphs are registered by their overlay (a WeakMap, so a graph object stays
// alive while any code scoped to it does): the overlay is the module scope of the
// graph's loader and sits on the scope chain of all of the graph's code.
static JSModuleGraph* moduleGraphForOverlay(Zig::GlobalObject* globalObject, JSValue overlay)
{
    if (!overlay || !overlay.isObject())
        return nullptr;
    JSValue registryValue = globalObject->m_moduleGraphRegistry.get();
    if (!registryValue)
        return nullptr;
    return dynamicDowncast<JSModuleGraph>(uncheckedDowncast<JSWeakMap>(registryValue)->get(asObject(overlay)));
}

JSModuleGraph* moduleGraphForLoader(JSGlobalObject* globalObject, JSModuleLoader* loader)
{
    if (!loader || loader == globalObject->moduleLoader())
        return nullptr;
    return moduleGraphForOverlay(defaultGlobalObject(globalObject), loader->moduleScope());
}

// The graph whose code created `scope` (a function / module / CommonJS scope),
// and whether the scope belongs to module-ish code at all (`decisive`): a chain
// with a module environment or a graph overlay on it is module / CommonJS code
// of SOME loader (a graph's or the global object's) and settles attribution;
// plain global-scope functions do not.
static JSModuleGraph* moduleGraphOwningScope(Zig::GlobalObject* globalObject, JSScope* scope, bool& decisive)
{
    decisive = false;
    for (JSScope* cursor = scope; cursor; cursor = cursor->next()) {
        if (JSModuleGraph* graph = moduleGraphForOverlay(globalObject, cursor)) {
            decisive = true;
            return graph;
        }
        if (dynamicDowncast<JSModuleEnvironment>(cursor))
            decisive = true;
    }
    return nullptr;
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

// The ModuleGraph whose code has `scope` in its chain (module code, or a CommonJS
// wrapper / createRequire'd / Function() code scoped to the graph's overlay), or null.
extern "C" JSModuleGraph* Bun__moduleGraphForScope(JSGlobalObject* lexicalGlobalObject, JSScope* scope)
{
    bool decisive = false;
    return scope ? moduleGraphOwningScope(defaultGlobalObject(lexicalGlobalObject), scope, decisive) : nullptr;
}

// The Bun.unsafe.ModuleGraph whose code is running: the innermost JS frame on
// the current stack (vm.topCallFrame) whose callee/module scope belongs to a
// graph. Lets shared builtin code (child_process, os, Worker, Bun.spawn) act
// with the graph's process state when called from graph code.
static JSModuleGraph* ambientModuleGraph(JSGlobalObject* lexicalGlobalObject)
{
    VM& vm = lexicalGlobalObject->vm();
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    if (!globalObject->m_moduleGraphRegistry.get() || !vm.topCallFrame)
        return nullptr;
    JSModuleGraph* found = nullptr;
    StackVisitor::visit(vm.topCallFrame, vm, [&](StackVisitor& visitor) {
        if (visitor->codeType() == StackVisitor::Frame::CodeType::Native || visitor->codeType() == StackVisitor::Frame::CodeType::Wasm)
            return IterationStatus::Continue;
        JSScope* scope = nullptr;
        JSCell* calleeCell = visitor->callee().isCell() ? visitor->callee().asCell() : nullptr;
        if (auto* function = dynamicDowncast<JSFunction>(calleeCell)) {
            if (function->isHostFunction())
                return IterationStatus::Continue;
            scope = function->scope();
        } else if (auto* callee = dynamicDowncast<JSCallee>(calleeCell))
            scope = callee->scope();
        if (!scope)
            return IterationStatus::Continue;
        // The innermost frame of module / CommonJS code decides, whether it is a
        // graph's or the global loader's.
        bool decisive = false;
        found = moduleGraphOwningScope(globalObject, scope, decisive);
        if (!decisive && !found) {
            auto* function = dynamicDowncast<JSFunction>(calleeCell);
            decisive = function && isHostCommonJSModuleCode(function);
        }
        return decisive ? IterationStatus::Done : IterationStatus::Continue;
    });
    return found;
}

extern "C" JSModuleGraph* Bun__ambientModuleGraph(JSGlobalObject* lexicalGlobalObject)
{
    return ambientModuleGraph(lexicalGlobalObject);
}

// $moduleGraphOf(require | module): { mainModule, requireMap, requireCache } of
// the graph a bound require function / CommonJS module belongs to (builtin JS).
JSC_DEFINE_HOST_FUNCTION(functionModuleGraphOf, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    JSValue value = callFrame->argument(0);
    if (auto* bound = dynamicDowncast<JSBoundFunction>(value))
        value = bound->boundThis();
    auto* module = dynamicDowncast<JSCommonJSModule>(value);
    JSModuleGraph* graph = module ? module->moduleGraph() : nullptr;
    if (!graph)
        return JSValue::encode(jsUndefined());
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* result = constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    result->putDirect(vm, Identifier::fromString(vm, "mainModule"_s), JSValue::decode(Bun__ModuleGraph__mainPath(graph)));
    result->putDirect(vm, Identifier::fromString(vm, "requireMap"_s), graph->requireMap());
    JSValue cache = graph->field(JSModuleGraph::Field::RequireCache);
    result->putDirect(vm, Identifier::fromString(vm, "requireCache"_s), cache ? cache : jsUndefined());
    return JSValue::encode(result);
}

// $moduleGraphProcess(): the ambient graph's `process`, or undefined (builtin JS).
JSC_DEFINE_HOST_FUNCTION(functionModuleGraphProcess, (JSGlobalObject * globalObject, CallFrame*))
{
    JSModuleGraph* graph = ambientModuleGraph(globalObject);
    return JSValue::encode(graph ? graph->field(JSModuleGraph::Field::Process) : jsUndefined());
}


// The ModuleGraph whose code produced `error`, if any: the innermost JS frame
// of the captured stack whose callee runs in a graph. Works for JSC::Exception
// (sync throws, any value) and ErrorInstance reasons (rejections with an Error).
static JSModuleGraph* moduleGraphForError(Zig::GlobalObject* globalObject, JSValue error)
{
    if (!globalObject->m_moduleGraphRegistry.get())
        return nullptr;
    const Vector<StackFrame>* frames = nullptr;
    if (error.isCell()) {
        if (auto* exception = dynamicDowncast<JSC::Exception>(error.asCell()))
            frames = &exception->stack();
        else if (auto* instance = dynamicDowncast<ErrorInstance>(error.asCell()))
            frames = instance->stackTrace();
    }
    if (!frames)
        return nullptr;
    for (const StackFrame& frame : *frames) {
        JSScope* scope = nullptr;
        if (auto* function = dynamicDowncast<JSFunction>(frame.callee())) {
            if (function->isHostFunction())
                continue;
            scope = function->scope();
        } else if (auto* callee = dynamicDowncast<JSCallee>(frame.callee()))
            scope = callee->scope();
        if (!scope)
            continue;
        bool decisive = false;
        JSModuleGraph* graph = moduleGraphOwningScope(globalObject, scope, decisive);
        if (!decisive) {
            auto* function = dynamicDowncast<JSFunction>(frame.callee());
            decisive = function && isHostCommonJSModuleCode(function);
        }
        if (decisive)
            return graph;
    }
    return nullptr;
}

// Deliver an error attributed to a graph to the
// graph's onError(error, kind) if it has one. Returns true if handled.

// Rejections by graph code whose reason carries no stack (a plain value) are
// attributed at rejection time, while the rejecting code is on the stack:
// promise -> graph, weakly, consulted when the rejection turns out unhandled.
void moduleGraphNoteRejection(Zig::GlobalObject* globalObject, JSPromise* promise)
{
    if (!globalObject->m_moduleGraphRegistry.get())
        return;
    JSModuleGraph* graph = ambientModuleGraph(globalObject);
    if (!graph)
        return;
    VM& vm = globalObject->vm();
    JSWeakMap* rejections = globalObject->m_moduleGraphRejections.get() ? uncheckedDowncast<JSWeakMap>(globalObject->m_moduleGraphRejections.get()) : nullptr;
    if (!rejections) {
        rejections = JSWeakMap::create(vm, globalObject->weakMapStructure());
        globalObject->m_moduleGraphRejections.set(vm, globalObject, rejections);
    }
    rejections->set(vm, promise, graph);
}

static JSModuleGraph* moduleGraphForRejectedPromise(Zig::GlobalObject* globalObject, JSValue promise)
{
    if (!promise || !promise.isObject() || !globalObject->m_moduleGraphRejections.get())
        return nullptr;
    return dynamicDowncast<JSModuleGraph>(uncheckedDowncast<JSWeakMap>(globalObject->m_moduleGraphRejections.get())->get(asObject(promise)));
}

static bool moduleGraphReportUnhandled(Zig::GlobalObject* globalObject, JSValue rawError, JSValue error, ASCIILiteral kind, JSValue promise = JSValue())
{
    JSModuleGraph* graph = moduleGraphForError(globalObject, rawError);
    if (!graph)
        graph = moduleGraphForError(globalObject, error);
    if (!graph)
        graph = moduleGraphForRejectedPromise(globalObject, promise);
    if (!graph)
        return false;
    VM& vm = globalObject->vm();
    JSValue dispatchError = graph->field(JSModuleGraph::Field::DispatchError);
    JSValue onError = graph->field(JSModuleGraph::Field::OnError);
    if (!dispatchError.isCallable())
        return false;
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    MarkedArgumentBuffer args;
    args.append(error);
    args.append(jsString(vm, String(kind)));
    args.append(onError.isCallable() ? onError : jsUndefined());
    JSValue handled = JSC::call(globalObject, dispatchError, JSC::getCallData(dispatchError), jsUndefined(), args);
    if (scope.exception()) [[unlikely]] {
        if (vm.hasPendingTerminationException())
            return true;
        auto* exception = scope.exception();
        (void)scope.tryClearException();
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(globalObject, exception);
        return true;
    }
    return handled.toBoolean(globalObject);
}

// Called first on every uncaught exception / unhandled rejection on this thread
// (VirtualMachine::uncaught_exception / unhandled_rejection): an error thrown by a
// graph's code, or a rejection by it, goes to that graph's process listeners /
// onError. Returns false for anything else, which then takes the normal path.
extern "C" bool Bun__ModuleGraph__handleUnhandled(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue encodedError, JSC::EncodedJSValue encodedPromise, int isRejection)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    if (!globalObject->m_moduleGraphRegistry.get())
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

// Bun.spawn / spawnSync / Bun.env default env when called from code of a
// Bun.unsafe.ModuleGraph: that graph's process.env object. Null otherwise (the
// caller keeps the thread-wide environment).
extern "C" JSC::JSObject* Bun__ModuleGraph__spawnEnv(JSC::JSGlobalObject* lexicalGlobalObject)
{
    if (JSModuleGraph* graph = ambientModuleGraph(lexicalGlobalObject)) {
        VM& vm = lexicalGlobalObject->vm();
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        JSValue process = graph->field(JSModuleGraph::Field::Process);
        JSValue env = process.isObject() ? process.getObject()->get(lexicalGlobalObject, Identifier::fromString(vm, "env"_s)) : JSValue();
        if (scope.exception()) {
            (void)scope.tryClearException();
            return nullptr;
        }
        return env.isObject() ? env.getObject() : nullptr;
    }
    return nullptr;
}

// new Worker() from inside a Bun.unsafe.ModuleGraph without an `env` option:
// the graph's process.env object (snapshotted by the caller), else null.
extern "C" JSC::JSObject* Bun__ModuleGraph__workerEnv(JSC::JSGlobalObject* lexicalGlobalObject)
{
    return Bun__ModuleGraph__spawnEnv(lexicalGlobalObject);
}

// Default cwd for Bun.spawn from inside a Bun.unsafe.ModuleGraph: the graph's
// process.cwd(). Null = keep the process cwd.
extern "C" JSC::EncodedJSValue Bun__ModuleGraph__spawnCwd(JSC::JSGlobalObject* lexicalGlobalObject)
{
    JSModuleGraph* graph = ambientModuleGraph(lexicalGlobalObject);
    if (!graph)
        return {};
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue process = graph->field(JSModuleGraph::Field::Process);
    if (!process.isObject())
        return {};
    JSValue cwdFunction = process.getObject()->get(lexicalGlobalObject, Identifier::fromString(vm, "cwd"_s));
    if (scope.exception()) {
        (void)scope.tryClearException();
        return {};
    }
    JSValue cwd = cwdFunction.isCallable() ? JSC::call(lexicalGlobalObject, cwdFunction, JSC::getCallData(cwdFunction), process, MarkedArgumentBuffer()) : JSValue();
    if (scope.exception()) {
        (void)scope.tryClearException();
        return {};
    }
    return cwd.isString() ? JSValue::encode(cwd) : EncodedJSValue {};
}

// ─── Bun.unsafe.ModuleGraph ───────────────────────────────────────────────────
//
// A JSC::JSModuleLoader of its own in THIS global whose module scope is the
// graph's overlay: a lexical environment holding the graph's values for a fixed
// set of global names (moduleGraphOverlayNames), between the graph's module
// environments and the global scope. Everything the graph imports is fetched,
// linked and evaluated by that loader; JSC shares the executables (CodeBlocks,
// JIT code) of modules another loader already linked from the same source.
//
//   const g = new Bun.unsafe.ModuleGraph({ env, cwd, globals: { ... } })
//   const exports = await g.import('/abs/or/relative.mjs')
//   g.dispose()


// Builds the default per-graph globals from { env, cwd, onExit, globals }:
// a `process` view with its own env/cwd/exit, a globalThis/global shadow whose
// prototype is the real global, and timer functions tracked per graph so
// dispose() can clear what the graph left armed. Returns { globals, dispose }.
static constexpr ASCIILiteral s_moduleGraphPresetSource = R"JS((function (options) {
  'use strict';
  options = options || {};
  var realProcess = globalThis.process;
  // Like Node's process.env: values are coerced to strings on assignment.
  var envStore = Object.assign(Object.create(null), options.env || realProcess.env);
  for (var ek in envStore) envStore[ek] = String(envStore[ek]);
  var env = new Proxy(envStore, {
    set: function (t, k, v) { if (typeof k === 'symbol') return false; t[k] = String(v); return true; },
    defineProperty: function (t, k, d) { if ('value' in d) d = { value: String(d.value), writable: true, enumerable: true, configurable: true }; return Reflect.defineProperty(t, k, d); },
    getPrototypeOf: function () { return Object.prototype; },
  });
  var cwd = options.cwd || realProcess.cwd();
  var onExit = options.onExit;
  var hostOnErrorOption = typeof options.onError === 'function' ? options.onError : null;
  var exited = false;
  var timers = new Set();
  var immediates = new Set();
  // Every process event listener a graph adds is the graph's: 'exit' /
  // 'beforeExit' fire for this graph's exit, 'uncaughtException' /
  // 'unhandledRejection' for this graph's errors (see dispatchError); events
  // that originate on the real process (signals, 'warning', 'message') are
  // forwarded to the graph's listeners by ONE real listener per event name,
  // installed while any graph handler exists. Nothing lands on the real process.
  var localEvents = { exit: [], beforeExit: [], uncaughtException: [], unhandledRejection: [], uncaughtExceptionMonitor: [] };
  var forwardedEvents = { warning: true, message: true, disconnect: true };
  // Signal listeners are per graph as well: the graph's handlers are kept
  // here and ONE forwarding listener per signal is installed on the real
  // process while any graph handler exists, removed when the last one goes
  // (and on exit/dispose) - so a graph's handlers never outlive the graph and
  // never pin its module state from the real process's listener list.
  var signalForwarders = {};
  function isSignal(name) { return typeof name === 'string' && name.length > 3 && name.charCodeAt(0) === 83 && name.charCodeAt(1) === 73 && name.charCodeAt(2) === 71 && name === name.toUpperCase(); }
  // isLocal: signals are always handled locally (a local table entry is made
  // on first mention); installForwarder: only adding a listener installs the one
  // real handler for that signal - counting / listing / emitting never does.
  function ensureLocal(name) { if (!Object.prototype.hasOwnProperty.call(localEvents, name)) localEvents[name] = []; }
  function ensureSignal(name) {
    ensureLocal(name);
    if (!signalForwarders[name]) {
      var f = function () { if (!exited) emit.apply(null, [name].concat(Array.prototype.slice.call(arguments))); };
      signalForwarders[name] = f;
      realProcess.on(name, f);
    }
  }
  function releaseSignal(name) {
    if (signalForwarders[name] && (!localEvents[name] || localEvents[name].length === 0)) { realProcess.off(name, signalForwarders[name]); delete signalForwarders[name]; }
  }
  function releaseAllSignals() { for (var k in signalForwarders) { realProcess.off(k, signalForwarders[k]); } signalForwarders = {}; }
  function isForwarded(name) { return isSignal(name) || forwardedEvents[name] === true; }
  function isLocal(name) { ensureLocal(name); return true; }
  function on(name, fn) { if (isLocal(name)) { if (isForwarded(name)) ensureSignal(name); localEvents[name].push(fn); return proc; } realProcess.on(name, fn); return proc; }
  function once(name, fn) { if (!isLocal(name)) { realProcess.once(name, fn); return proc; } var w = function () { off(name, w); return fn.apply(this, arguments); }; w.listener = fn; return on(name, w); }
  function off(name, fn) { if (isLocal(name)) { var l = localEvents[name]; for (var i = l.length - 1; i >= 0; i--) if (l[i] === fn || l[i].listener === fn) l.splice(i, 1); if (isForwarded(name)) releaseSignal(name); return proc; } realProcess.off(name, fn); return proc; }
  function emit(name) { var args = Array.prototype.slice.call(arguments, 1); if (isLocal(name)) { var l = localEvents[name].slice(); for (var i = 0; i < l.length; i++) l[i].apply(proc, args); return l.length > 0; } return realProcess.emit.apply(realProcess, arguments); }
  function listenerCount(name) { return isLocal(name) ? localEvents[name].length : realProcess.listenerCount(name); }
  function listeners(name) { return isLocal(name) ? localEvents[name].map(function (f) { return f.listener || f; }) : realProcess.listeners(name); }
  function removeAllListeners(name) { if (name === undefined) { for (var k in localEvents) localEvents[k].length = 0; releaseAllSignals(); return proc; } if (isLocal(name)) { localEvents[name].length = 0; if (isForwarded(name)) releaseSignal(name); return proc; } realProcess.removeAllListeners(name); return proc; }
  // Set by the constructor: the graph object's own dispose(), so an in-graph
  // process.exit() releases the instance's module environments exactly like a
  // host-side graph.dispose() (a host that keeps the handle must not pin them).
  var nativeDispose = null;
  // Node's validation for exit codes (process.exit(code) / process.exitCode = code):
  // undefined/null keep the current code; an integer, or a string that is one, sets
  // it; anything else throws ERR_INVALID_ARG_TYPE / ERR_OUT_OF_RANGE.
  var exitCodeValue;
  function coerceExitCode(code, name) {
    if (code === undefined || code === null) return undefined;
    var n = code;
    if (typeof code === 'string' && code !== '' && Number.isInteger(Number(code))) n = Number(code);
    if (typeof n !== 'number') { var e = new TypeError('The "' + name + '" argument must be of type number. Received ' + (typeof code === 'string' ? "'" + code + "'" : typeof code)); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    if (!Number.isInteger(n)) { var r = new RangeError('The value of "' + name + '" is out of range. It must be an integer. Received ' + String(code)); r.code = 'ERR_OUT_OF_RANGE'; throw r; }
    return n & 0xff;   // stored as the process does (a byte): -1 -> 255, 256 -> 0
  }
  function currentExitCode() { return exitCodeValue === undefined ? 0 : exitCodeValue; }
  function exit(code) {
    if (exited) return;
    var c = coerceExitCode(code, 'code');
    if (c !== undefined) exitCodeValue = c;
    exited = true;
    // 'exit' listeners run one by one; a throwing listener is this graph's
    // uncaught exception (reported like any other), the rest still run.
    var ls = localEvents.exit ? localEvents.exit.slice() : [];
    try { for (var i = 0; i < ls.length; i++) { try { ls[i].call(proc, currentExitCode()); } catch (e) { try { if (!dispatchError(e, 'uncaughtException', hostOnErrorOption)) console.error(e); } catch (x) {} } } } finally {
      dispose();
      try { if (onExit) onExit(currentExitCode()); } finally {
        if (nativeDispose) { var d = nativeDispose; nativeDispose = null; d(); }
      }
    }
  }
  // Listeners graph code adds to the host's stdio streams are remembered and
  // removed on dispose (the streams are shared; the listeners are graph closures).
  var hop = Object.prototype.hasOwnProperty;
  var stdioListeners = [];
  function stdioFacade(name) {
    var real = realProcess[name]; if (!real || typeof real.on !== 'function') return real;
    function forget(ev, fn) { for (var i = stdioListeners.length - 1; i >= 0; i--) { var e = stdioListeners[i]; if (e[0] === real && e[1] === ev && (e[2] === fn || e[3] === fn)) { stdioListeners.splice(i, 1); return e[2]; } } return fn; }
    function add(method, once) { return function (ev, fn) { var installed = fn; if (once) { installed = function () { real.removeListener(ev, installed); forget(ev, fn); return fn.apply(this, arguments); }; installed.listener = fn; } stdioListeners.push([real, ev, installed, fn]); real[once ? (method === 'prependOnceListener' ? 'prependListener' : 'on') : method](ev, installed); return this; }; }
    function remove(ev, fn) { real.removeListener(ev, forget(ev, fn)); return this; }
    function removeAll(ev) { for (var i = stdioListeners.length - 1; i >= 0; i--) { var e = stdioListeners[i]; if (e[0] === real && (ev === undefined || e[1] === ev)) { stdioListeners.splice(i, 1); real.removeListener(e[1], e[2]); } } return this; }   // only this graph's listeners
    var facadeOwn = { on: add('on'), addListener: add('addListener'), once: add('once', true), prependListener: add('prependListener'), prependOnceListener: add('prependOnceListener', true), off: remove, removeListener: remove, removeAllListeners: removeAll };
    var bound = Object.create(null);
    return new Proxy(real, {
      get: function (t, k, r) { if (hop.call(facadeOwn, k)) return facadeOwn[k]; var v = Reflect.get(t, k); if (typeof v !== 'function') return v; return bound[k] && bound[k].target === v ? bound[k] : (bound[k] = Object.assign(v.bind(t), { target: v })); },
      set: function (t, k, v) { return Reflect.set(t, k, v); },
    });
  }
  function releaseStdioListeners() { stdioListeners.forEach(function (e) { try { e[0].removeListener(e[1], e[2]); } catch (x) {} }); stdioListeners.length = 0; }
  var stdoutFacade, stderrFacade, stdinFacade;
  // Handles graph code opened through ITS copy of a builtin (fs.watch,
  // fs.watchFile) - closed on dispose. Timers reached through node:timers /
  // timers/promises go through the graph's tracked timers.
  var watchers = new Set();
  var watchFiles = [];
  function graphPathModule(mod) {
    var realResolve = mod.resolve, realRelative = mod.relative;
    function anyAbsolute(args) { for (var i = args.length - 1; i >= 0; i--) { var a = args[i]; if (typeof a === 'string' && a.charCodeAt(0) === 47) return true; } return false; }
    mod.resolve = function () { if (anyAbsolute(arguments)) return realResolve.apply(this, arguments); var a = [cwd]; for (var i = 0; i < arguments.length; i++) a.push(arguments[i]); return realResolve.apply(this, a); };
    mod.relative = function (from, to) { return realRelative.call(this, mod.resolve(from), mod.resolve(to)); };
  }
  function customizeBuiltin(specifier, copy) {
    if (specifier === 'node:timers' || specifier === 'timers') {
      copy.setTimeout = st[0]; copy.clearTimeout = st[1]; copy.setInterval = si[0]; copy.clearInterval = si[1]; copy.setImmediate = sm[0]; copy.clearImmediate = sm[1];
      if (copy.promises) copy.promises = graphTimersPromises(copy.promises);
    } else if (specifier === 'node:timers/promises' || specifier === 'timers/promises') {
      var p = graphTimersPromises(copy); Object.keys(p).forEach(function (k) { copy[k] = p[k]; });
    } else if (specifier === 'node:path' || specifier === 'path' || specifier === 'node:path/posix' || specifier === 'path/posix') {
      // path.resolve()/relative() are defined against process.cwd(): in a graph that is the graph's cwd.
      // (Kernel-level relative paths -- fs, Bun.file -- keep resolving against the real process cwd, as in a Worker.)
      if (copy.sep === '/') graphPathModule(copy);
      if (copy.posix && copy.posix !== copy && copy.posix.sep === '/') { copy.posix = Object.assign(Object.create(Object.getPrototypeOf(copy.posix)), copy.posix); graphPathModule(copy.posix); }
    } else if (specifier === 'node:url' || specifier === 'url') {
      var realPathToFileURL = copy.pathToFileURL;
      copy.pathToFileURL = function (path) { if (typeof path === 'string' && path.charCodeAt(0) !== 47) { var a = Array.prototype.slice.call(arguments); a[0] = cwd + '/' + path; return realPathToFileURL.apply(this, a); } return realPathToFileURL.apply(this, arguments); };
    } else if (specifier === 'node:net' || specifier === 'net' || specifier === 'node:http' || specifier === 'http' || specifier === 'node:https' || specifier === 'https' || specifier === 'node:tls' || specifier === 'tls' || specifier === 'node:http2' || specifier === 'http2') {
      // Servers created through the graph's copy are tracked from listen() to close().
      ['createServer', 'createSecureServer'].forEach(function (name) {
        var real = copy[name]; if (typeof real !== 'function') return;
        copy[name] = function () { var srv = real.apply(this, arguments); var listen = srv.listen; srv.listen = function () { if (!exited) trackServer(srv); return listen.apply(this, arguments); }; return srv; };
      });
      if (typeof copy.Server === 'function') {
        var RealServer = copy.Server;
        var GraphServer = function Server() { var srv = new.target ? Reflect.construct(RealServer, arguments, new.target) : RealServer.apply(this, arguments); var listen = srv.listen; srv.listen = function () { if (!exited) trackServer(srv); return listen.apply(this, arguments); }; return srv; };
        GraphServer.prototype = RealServer.prototype; Object.setPrototypeOf(GraphServer, RealServer); copy.Server = GraphServer;
      }
    } else if (specifier === 'node:child_process' || specifier === 'child_process') {
      ['spawn', 'fork', 'exec', 'execFile'].forEach(function (name) {
        var real = copy[name]; if (typeof real !== 'function') return;
        copy[name] = function () { var c = real.apply(this, arguments); return exited || !c ? c : trackChild(c); };
        if (real[Symbol.for('nodejs.util.promisify.custom')]) copy[name][Symbol.for('nodejs.util.promisify.custom')] = real[Symbol.for('nodejs.util.promisify.custom')];
      });
    } else if (specifier === 'node:worker_threads' || specifier === 'worker_threads') {
      if (typeof copy.Worker === 'function') {
        var RealWT = copy.Worker;
        var GraphWT = function Worker() { var w = Reflect.construct(RealWT, arguments, new.target || GraphWT); if (!exited) { workers.add(w); var forget = function () { workers.delete(w); }; try { w.on('exit', forget); } catch (x) {} } return w; };
        GraphWT.prototype = RealWT.prototype; Object.setPrototypeOf(GraphWT, RealWT); copy.Worker = GraphWT;
      }
    } else if (specifier === 'node:fs' || specifier === 'fs') {
      var realWatch = copy.watch, realWatchFile = copy.watchFile, realUnwatchFile = copy.unwatchFile;
      unwatchFileImpl = realUnwatchFile;
      copy.watch = function () { var w = realWatch.apply(this, arguments); watchers.add(w); var close = w.close; w.close = function () { watchers.delete(w); return close.apply(this, arguments); }; return w; };
      // StatWatchers are keyed by resolved path; remember exactly what we passed and the listener.
      copy.watchFile = function (path) { var r = realWatchFile.apply(this, arguments); watchFiles.push([path, arguments[arguments.length - 1]]); return r; };
      copy.unwatchFile = function (path, listener) { watchFiles = watchFiles.filter(function (e) { return !(String(e[0]) === String(path) && (!listener || e[1] === listener)); }); return realUnwatchFile.apply(this, arguments); };
    }
  }
  function graphTimersPromises(realP) {
    function abortError(signal) { var r = signal.reason; if (r !== undefined) return r; var e = new Error('The operation was aborted'); e.name = 'AbortError'; e.code = 'ABORT_ERR'; return e; }
    function abortable(arm, o, clear) {
      var signal = o && o.signal;
      return new Promise(function (resolve, reject) {
        if (signal && signal.aborted) { reject(abortError(signal)); return; }
        var onAbort;
        var id = arm(function (v) { if (signal) signal.removeEventListener('abort', onAbort); resolve(v); });
        if (o && o.ref === false && id && typeof id.unref === 'function') id.unref();
        if (signal) { onAbort = function () { clear(id); reject(abortError(signal)); }; signal.addEventListener('abort', onAbort, { once: true }); }
      });
    }
    return {
      setTimeout: function (ms, value, o) { return abortable(function (done) { return st[0](function () { done(value); }, ms); }, o, st[1]); },
      setImmediate: function (value, o) { return abortable(function (done) { return sm[0](function () { done(value); }); }, o, sm[1]); },
      setInterval: realP.setInterval,
      scheduler: realP.scheduler,
    };
  }
  var unwatchFileImpl = null;
  function releaseHandles() {
    watchers.forEach(function (w) { try { w.close(); } catch (x) {} }); watchers.clear();
    var pending = watchFiles; watchFiles = [];
    pending.forEach(function (e) { try { unwatchFileImpl(e[0], e[1]); } catch (x) {} });
  }
  // Long-lived resources graph code opens that a process exit would end:
  // listening servers, Workers, child processes. Remembered weakly enough
  // (closed/exited ones drop out) and ended on exit/dispose -- servers are
  // stopped, Workers terminated, children get their stdio closed and SIGHUP
  // (what a dying parent does to them).
  var servers = new Set(), workers = new Set(), children = new Set();
  function trackServer(server, how) {
    servers.add(server);
    var forget = function () { servers.delete(server); };
    try { if (typeof server.on === 'function') server.on('close', forget); } catch (x) {}
    server.__graphStop = how;
    return server;
  }
  function trackChild(child) {
    children.add(child);
    var forget = function () { children.delete(child); };
    try {
      if (typeof child.on === 'function') child.on('exit', forget);        // node:child_process
      else if (child.exited && typeof child.exited.then === 'function') child.exited.then(forget, forget);   // Bun.spawn
    } catch (x) {}
    return child;
  }
  function releaseResources() {
    servers.forEach(function (s) { try { s.__graphStop ? s.__graphStop(s) : s.close(); } catch (x) {} }); servers.clear();
    workers.forEach(function (w) { try { w.terminate(); } catch (x) {} }); workers.clear();
    children.forEach(function (c) {
      try { if (c.stdin && typeof c.stdin.end === 'function') c.stdin.end(); } catch (x) {}
      try { typeof c.kill === 'function' && c.kill('SIGHUP'); } catch (x) {}
    });
    children.clear();
  }
  // Per-graph `Bun`: env is the graph's; serve()/spawn() are tracked; everything else is the host's Bun.
  var realBun = globalThis.Bun;
  // Plain object over the real Bun (prototype) so property reads stay IC-cacheable;
  // own overrides: env (the graph's), serve/listen/udpSocket/spawn (tracked).
  var graphBun = Object.create(realBun, {
    env: { get: function () { return env; }, enumerable: true, configurable: true },
    serve: { value: function serve() { var s = realBun.serve.apply(realBun, arguments); return exited ? s : trackServer(s, function (x) { x.stop(true); }); }, writable: true, enumerable: true, configurable: true },
    spawn: { value: function spawn() { var c = realBun.spawn.apply(realBun, arguments); return exited ? c : trackChild(c); }, writable: true, enumerable: true, configurable: true },
    listen: { value: function listen() { var s = realBun.listen.apply(realBun, arguments); return exited ? s : trackServer(s, function (x) { x.stop ? x.stop(true) : x.close(); }); }, writable: true, enumerable: true, configurable: true },
    udpSocket: { value: function udpSocket() { var s = realBun.udpSocket.apply(realBun, arguments); return exited ? s : trackServer(s, function (x) { x.close(); }); }, writable: true, enumerable: true, configurable: true },
  });
  try { Object.defineProperty(graphBun, Symbol.toStringTag, { value: 'Bun', configurable: true }); } catch (x) {}
  var RealWorker = globalThis.Worker;
  var GraphWorker = typeof RealWorker === 'function' ? function Worker(url, opts) {
    if (!new.target) throw new TypeError("Class constructor Worker cannot be invoked without 'new'");
    var w = Reflect.construct(RealWorker, [url, opts], new.target);
    if (!exited) { workers.add(w); var forget = function () { workers.delete(w); }; try { w.addEventListener('close', forget); w.addEventListener('exit', forget); } catch (x) {} }
    return w;
  } : undefined;
  if (GraphWorker) { GraphWorker.prototype = RealWorker.prototype; Object.setPrototypeOf(GraphWorker, RealWorker); }
  var overrides = {
    env: env,
    get stdout() { return stdoutFacade || (stdoutFacade = stdioFacade('stdout')); }, set stdout(v) { stdoutFacade = v; },
    get stderr() { return stderrFacade || (stderrFacade = stdioFacade('stderr')); }, set stderr(v) { stderrFacade = v; },
    get stdin() { return stdinFacade || (stdinFacade = stdioFacade('stdin')); }, set stdin(v) { stdinFacade = v; },
    cwd: function () { return cwd; },
    chdir: function (d) { var p = Bun.fileURLToPath(new URL(String(d), Bun.pathToFileURL(cwd.endsWith('/') ? cwd : cwd + '/'))); cwd = p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p; },
    exit: exit,
    reallyExit: exit,
    get exitCode() { return exitCodeValue; }, set exitCode(v) { var c = coerceExitCode(v, 'code'); exitCodeValue = c; },
    abort: function () { exit(134); },
    on: on, addListener: on, once: once, off: off, removeListener: off, emit: emit,
    prependListener: function (n, f) { if (isLocal(n)) { if (isForwarded(n)) ensureSignal(n); localEvents[n].unshift(f); return proc; } realProcess.prependListener(n, f); return proc; },
    prependOnceListener: function (n, f) { if (!isLocal(n)) { realProcess.prependOnceListener(n, f); return proc; } var w = function () { off(n, w); return f.apply(this, arguments); }; w.listener = f; if (isForwarded(n)) ensureSignal(n); localEvents[n].unshift(w); return proc; },
    listenerCount: listenerCount, listeners: listeners, rawListeners: listeners, removeAllListeners: removeAllListeners,
  };
  // `process` for graph code: a Proxy over a SHELL object (same prototype as
  // the real process) that physically holds whatever graph code adds to or
  // redefines on process (signal-exit's __signal_exit_emitter__, a patched
  // emit, ad-hoc flags); per-graph `overrides` (env, cwd, exit, on, ...) come
  // first, then the shell, then the real process. The real process never ends
  // up holding graph closures, and Proxy invariants hold against the shell.
  var shell = Object.create(Object.getPrototypeOf(realProcess));
  var proc = new Proxy(shell, {
    get: function (t, k, r) { if (hop.call(overrides, k)) return overrides[k]; if (hop.call(t, k)) return Reflect.get(t, k, r); return Reflect.get(realProcess, k); },
    set: function (t, k, v, r) {
      if (hop.call(overrides, k)) { overrides[k] = v; return true; }
      if (hop.call(t, k)) return Reflect.set(t, k, v, r);
      var rd = Object.getOwnPropertyDescriptor(realProcess, k);
      if (rd && rd.set) return Reflect.set(realProcess, k, v);      // real accessor (title, exitCode, ...): node semantics
      return Reflect.defineProperty(t, k, { value: v, writable: true, enumerable: true, configurable: true });
    },
    has: function (t, k) { return hop.call(overrides, k) || k in t || k in realProcess; },
    defineProperty: function (t, k, d) { if (hop.call(overrides, k)) { if ('value' in d) overrides[k] = d.value; return true; } return Reflect.defineProperty(t, k, d); },
    deleteProperty: function (t, k) { if (hop.call(overrides, k)) return false; if (hop.call(t, k)) return Reflect.deleteProperty(t, k); return true; },
    getOwnPropertyDescriptor: function (t, k) {
      if (hop.call(overrides, k)) return { value: overrides[k], writable: true, enumerable: true, configurable: true };
      if (hop.call(t, k)) return Reflect.getOwnPropertyDescriptor(t, k);
      var rd = Reflect.getOwnPropertyDescriptor(realProcess, k);
      if (rd) rd.configurable = true;                                  // not on the shell, so it must read as configurable
      return rd;
    },
    ownKeys: function (t) { var ks = Reflect.ownKeys(realProcess); Reflect.ownKeys(t).forEach(function (k) { if (ks.indexOf(k) < 0) ks.push(k); }); for (var k in overrides) if (ks.indexOf(k) < 0) ks.push(k); return ks; },
  });
  // One-shot timers (setTimeout / setImmediate) leave the set when they fire,
  // so a fired timer's callback (and whatever it closes over) is not kept
  // alive for the graph's lifetime; intervals stay until cleared.
  function track(set, real, clear, oneShot) {
    var wrapped = function (fn) {
      var args = Array.prototype.slice.call(arguments);
      var id;
      if (typeof fn === 'function') args[0] = oneShot
        ? function () { set.delete(id); if (!exited) return fn.apply(this, arguments); }
        : function () { if (!exited) return fn.apply(this, arguments); };
      id = real.apply(globalThis, args);
      set.add(id);
      return id;
    };
    // util.promisify(setTimeout) etc. keep working (the host's promisified form, through the tracked timer).
    var custom = Symbol.for('nodejs.util.promisify.custom');
    if (real[custom]) wrapped[custom] = function () { var a = arguments; return new Promise(function (resolve) { wrapped.apply(null, [resolve].concat(Array.prototype.slice.call(a))); }); };
    // clearTimeout accepts the Timeout object or its numeric id.
    var unwrapped = function (id) { if (!set.delete(id) && (typeof id === 'number' || typeof id === 'string')) set.forEach(function (t) { if (+t == id) set.delete(t); }); return clear(id); };
    return [wrapped, unwrapped];
  }
  var st = track(timers, globalThis.setTimeout, globalThis.clearTimeout, true);
  var si = track(timers, globalThis.setInterval, globalThis.clearInterval, false);
  var sm = track(immediates, globalThis.setImmediate, globalThis.clearImmediate, true);
  // AbortSignal.timeout() / AbortSignal.any() made by graph code: such a
  // signal is kept alive natively (pending timeout / live source) together
  // with its abort listeners, which are graph closures. Track them (weakly)
  // and abort them when the graph goes away so nothing of the graph stays
  // pinned behind a long timeout or a long-lived source signal.
  var realAbortSignal = globalThis.AbortSignal;
  var graphSignals = new Set();
  var graphSignalRegistry = new FinalizationRegistry(function (ref) { graphSignals.delete(ref); });
  function trackSignal(signal) {
    var ref = new WeakRef(signal); graphSignals.add(ref); graphSignalRegistry.register(signal, ref);
    Object.defineProperty(signal, 'addEventListener', { configurable: true, writable: true, value: function (type, listener, options) { if (type === 'abort' && listener) trackListener(this, listener, options); return realAdd.call(this, type, listener, options); } });
    return signal;
  }
  var graphAbortSignal = function AbortSignal() { throw new TypeError('Illegal constructor'); };
  Object.setPrototypeOf(graphAbortSignal, realAbortSignal);
  graphAbortSignal.prototype = realAbortSignal.prototype;
  graphAbortSignal.timeout = function timeout(ms) { return trackSignal(realAbortSignal.timeout(ms)); };
  graphAbortSignal.any = function any(signals) { return trackSignal(realAbortSignal.any(signals)); };
  graphAbortSignal.abort = function abort(reason) { return arguments.length ? realAbortSignal.abort(reason) : realAbortSignal.abort(); };
  Object.defineProperty(graphAbortSignal, Symbol.hasInstance, { value: function (v) { return v instanceof realAbortSignal; } });
  function disposeSignals() {
    graphSignals.forEach(function (ref) {
      var s = ref.deref();
      if (s && !s.aborted) { try { realAbortSignalDispatchAbort(s); } catch (e) {} }
    });
    graphSignals.clear();
  }
  // There is no public way to abort a timeout()/any() signal; dispatching an
  // 'abort' event does not release the native hold. What does: dropping every
  // listener the graph added, which is what makes the wrapper collectable
  // (isReachableFromOpaqueRoots keys on hasAbortEventListener). We wrap
  // addEventListener for tracked signals to remember graph listeners.
  var signalListeners = new WeakMap();
  var realAdd = realAbortSignal.prototype.addEventListener;
  function realAbortSignalDispatchAbort(s) {
    var ls = signalListeners.get(s);
    if (ls) { ls.forEach(function (entry) { try { s.removeEventListener('abort', entry[0], entry[1]); } catch (e) {} }); signalListeners.delete(s); }
    if ('onabort' in s) s.onabort = null;
  }
  function trackListener(signal, listener, options) {
    var ls = signalListeners.get(signal); if (!ls) { ls = []; signalListeners.set(signal, ls); }
    ls.push([listener, options]);
  }
  function dispose() {
    timers.forEach(function (id) { try { globalThis.clearTimeout(id); } catch (e) {} });
    immediates.forEach(function (id) { try { globalThis.clearImmediate(id); } catch (e) {} });
    timers.clear(); immediates.clear();
    releaseAllSignals();
    disposeSignals();
    releaseStdioListeners();
    releaseHandles();
    releaseResources();
    for (var k in localEvents) localEvents[k].length = 0;
  }
  // 'uncaughtException' / 'unhandledRejection' raised by this graph's code:
  // the graph's own process listeners first (like Node), then the host's
  // onError. Returns true if something handled it.
  // A graph handler that itself throws does not escape to the host's
  // uncaught path: that error goes to the host's onError for this graph.
  function dispatchError(error, kind, hostOnError) {
    try {
      if (kind === 'uncaughtException' && localEvents.uncaughtExceptionMonitor.length) emit('uncaughtExceptionMonitor', error, 'uncaughtException');
      if (localEvents[kind] && localEvents[kind].length) { emit(kind, error, kind === 'unhandledRejection' ? undefined : 'uncaughtException'); return true; }
    } catch (handlerError) {
      error = handlerError; kind = 'uncaughtException';
    }
    if (hostOnError) { try { hostOnError(error, kind); } catch (e) { try { console.error('ModuleGraph onError threw while handling %s:', kind, e); } catch (x) {} } return true; }
    return false;
  }
  var globals = {
    process: proc,
    Bun: graphBun,
    AbortSignal: graphAbortSignal,
    setTimeout: st[0], clearTimeout: st[1],
    setInterval: si[0], clearInterval: si[1],
    setImmediate: sm[0], clearImmediate: sm[1],
  };
  if (GraphWorker) globals.Worker = GraphWorker;
  if (options.globals) Object.assign(globals, options.globals);
  // globalThis / global / self for graph code: a Proxy over a graph-local
  // SHELL. Reads: the overlaid names, then what this graph put on the global,
  // then the real global. Writes and defineProperty never reach the real global:
  // they land on the shell (graceful-fs's global[Symbol.for('graceful-fs.queue')],
  // signal-exit's emitter, polyfills), so nothing a graph installs "globally"
  // outlives it or is seen by other graphs. Writes to an OVERLAID name also
  // update the overlay slot, so `globalThis.setTimeout = f` makes bare
  // `setTimeout` be f in this graph. Other names: a bare identifier does not see
  // a property added this way (`globalThis.X = 1; X` -> ReferenceError, and
  // `globalThis.Array = Y` leaves bare `Array` the shared intrinsic); `globalThis.X` does.
  var names = Object.assign({}, globals);
  var writeOverlay = null;   // set by the host: (name, value) -> the overlay slot bare identifiers read
  function setName(k, v) { names[k] = v; if (writeOverlay) writeOverlay(k, v); }
  var gshell = Object.create(null);
  var g = new Proxy(gshell, {
    get: function (t, k, r) { if (k === 'globalThis' || k === 'global' || k === 'self') return g; if (hop.call(names, k)) return names[k]; if (hop.call(t, k)) return Reflect.get(t, k, r); return Reflect.get(globalThis, k); },
    has: function (t, k) { return hop.call(names, k) || hop.call(t, k) || Reflect.has(globalThis, k); },
    set: function (t, k, v, r) { if (hop.call(names, k)) { setName(k, v); return true; } if (hop.call(t, k)) return Reflect.set(t, k, v, r); return Reflect.defineProperty(t, k, { value: v, writable: true, enumerable: true, configurable: true }); },
    deleteProperty: function (t, k) { if (hop.call(names, k)) return false; if (hop.call(t, k)) return Reflect.deleteProperty(t, k); return true; },
    getOwnPropertyDescriptor: function (t, k) {
      if (hop.call(names, k)) return { value: names[k], writable: true, enumerable: false, configurable: true };
      if (hop.call(t, k)) return Reflect.getOwnPropertyDescriptor(t, k);
      var rd = Reflect.getOwnPropertyDescriptor(globalThis, k); if (rd) rd.configurable = true; return rd;
    },
    defineProperty: function (t, k, d) { if (hop.call(names, k)) { if ('value' in d) setName(k, d.value); return true; } return Reflect.defineProperty(t, k, d); },
    ownKeys: function (t) { var ks = Reflect.ownKeys(globalThis); Reflect.ownKeys(t).forEach(function (k) { if (ks.indexOf(k) < 0) ks.push(k); }); for (var k in names) if (ks.indexOf(k) < 0) ks.push(k); return ks; },
    getPrototypeOf: function () { return Object.getPrototypeOf(globalThis); },
  });
  globals.globalThis = g; globals.global = g; globals.self = g;
  return { globals: globals, dispose: dispose, process: proc, dispatchError: dispatchError, customizeBuiltin: customizeBuiltin, setNativeDispose: function (fn) { nativeDispose = fn; }, setOverlayWriter: function (fn) { writeOverlay = fn; }, defineName: function (k, v) { names[k] = v; globals[k] = v; } };
}))JS"_s;

// ─── JSModuleGraph cell / prototype / constructor ────────────────────────────

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

JSModuleGraph* JSModuleGraph::create(VM& vm, Structure* structure)
{
    auto* cell = new (NotNull, allocateCell<JSModuleGraph>(vm)) JSModuleGraph(vm, structure);
    cell->finishCreation(vm);
    return cell;
}

void JSModuleGraph::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    for (unsigned i = 0; i < numberOfInternalFields; ++i)
        internalField(i).setWithoutWriteBarrier(jsUndefined());
}

template<typename Visitor>
void JSModuleGraph::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSModuleGraph>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}
DEFINE_VISIT_CHILDREN(JSModuleGraph);

JSModuleLoader* JSModuleGraph::loader() const
{
    JSValue v = field(Field::Loader);
    return v.isCell() ? uncheckedDowncast<JSModuleLoader>(v.asCell()) : nullptr;
}
JSScope* JSModuleGraph::overlay() const
{
    JSValue v = field(Field::Overlay);
    return v.isCell() ? uncheckedDowncast<JSScope>(v.asCell()) : nullptr;
}
JSMap* JSModuleGraph::requireMap() const
{
    JSValue v = field(Field::RequireMap);
    return v.isCell() ? uncheckedDowncast<JSMap>(v) : nullptr;
}
JSMap* JSModuleGraph::builtins() const
{
    JSValue v = field(Field::Builtins);
    return v.isCell() ? uncheckedDowncast<JSMap>(v) : nullptr;
}

JSValue graphLocalBuiltin(JSGlobalObject* globalObject, JSModuleGraph* graph, const String& specifier, JSValue hostExports)
{
    if (!graph || !hostExports.isObject())
        return hostExports;
    // `process` as a module is the graph's process.
    if (specifier == "node:process"_s || specifier == "process"_s) {
        JSValue process = graph->field(JSModuleGraph::Field::Process);
        return process.isObject() ? process : hostExports;
    }
    JSObject* host = hostExports.getObject();
    // Classes / functions (node:events, node:assert, …) keep their identity.
    if (host->type() != FinalObjectType && host->type() != ObjectType)
        return hostExports;
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSMap* cache = graph->builtins();
    if (!cache) {
        cache = JSMap::create(vm, globalObject->mapStructure());
        RETURN_IF_EXCEPTION(scope, {});
        graph->setField(vm, JSModuleGraph::Field::Builtins, cache);
    }
    JSString* key = jsString(vm, specifier);
    JSValue cached = cache->get(globalObject, key);
    RETURN_IF_EXCEPTION(scope, {});
    if (cached.isObject())
        return cached;
    JSObject* copy = constructEmptyObject(globalObject, host->getPrototypeDirect().isObject() ? host->getPrototypeDirect().getObject() : globalObject->objectPrototype());
    RETURN_IF_EXCEPTION(scope, {});
    PropertyNameArrayBuilder names(vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
    host->methodTable()->getOwnPropertyNames(host, globalObject, names, DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, {});
    for (auto& name : names) {
        PropertyDescriptor descriptor;
        bool found = host->getOwnPropertyDescriptor(globalObject, name, descriptor);
        RETURN_IF_EXCEPTION(scope, {});
        if (!found)
            continue;
        // Keep the copy patchable even where the host froze a binding.
        if (descriptor.isDataDescriptor())
            descriptor.setWritable(true);
        descriptor.setConfigurable(true);
        copy->methodTable()->defineOwnProperty(copy, globalObject, name, descriptor, false);
        RETURN_IF_EXCEPTION(scope, {});
    }
    cache->set(globalObject, key, copy);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue customize = graph->field(JSModuleGraph::Field::CustomizeBuiltin);
    if (customize.isCallable()) {
        MarkedArgumentBuffer args;
        args.append(key);
        args.append(copy);
        JSC::call(globalObject, customize, JSC::getCallData(customize), jsUndefined(), args);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return copy;
}

static JSModuleGraph* thisModuleGraph(JSGlobalObject* globalObject, ThrowScope& scope, JSValue thisValue, ASCIILiteral method)
{
    auto* graph = dynamicDowncast<JSModuleGraph>(thisValue);
    if (!graph) [[unlikely]]
        throwTypeError(globalObject, scope, makeString("ModuleGraph.prototype."_s, method, " called on an incompatible receiver"_s));
    return graph;
}

JSC_DECLARE_HOST_FUNCTION(jsModuleGraphProtoFuncImport);
JSC_DECLARE_HOST_FUNCTION(jsModuleGraphProtoFuncDispose);
JSC_DECLARE_CUSTOM_GETTER(jsModuleGraphGetter_process);

// The promise import() returned settles like the loader's, unless the graph was
// disposed first (dispose() rejects it). Bound: this = graph, argument 0 = that promise.
JSC_DECLARE_HOST_FUNCTION(moduleGraphImportFulfilled);
JSC_DECLARE_HOST_FUNCTION(moduleGraphImportRejected);
static JSPromise* takePendingImport(JSGlobalObject*, CallFrame* callFrame)
{
    auto* promise = dynamicDowncast<JSPromise>(callFrame->argument(0));
    return promise && promise->status() == JSPromise::Status::Pending ? promise : nullptr;
}
JSC_DEFINE_HOST_FUNCTION(moduleGraphImportFulfilled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSPromise* promise = takePendingImport(globalObject, callFrame);
    RETURN_IF_EXCEPTION(scope, {});
    if (promise)
        promise->resolve(globalObject, vm, callFrame->argument(1));
    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}
JSC_DEFINE_HOST_FUNCTION(moduleGraphImportRejected, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSPromise* promise = takePendingImport(globalObject, callFrame);
    RETURN_IF_EXCEPTION(scope, {});
    if (promise)
        promise->reject(vm, callFrame->argument(1));
    RELEASE_AND_RETURN(scope, JSValue::encode(jsUndefined()));
}

// import(): like dynamic import(), every failure past the receiver check is a
// rejection of the returned promise, never a synchronous throw.
static EncodedJSValue moduleGraphImport(JSGlobalObject* globalObject, JSModuleGraph* graph, JSValue specifierValue)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSModuleLoader* loader = graph->loader();
    if (!loader)
        return throwVMTypeError(globalObject, scope, "ModuleGraph has been disposed"_s);
    if (!specifierValue.isString())
        return throwVMTypeError(globalObject, scope, "ModuleGraph.prototype.import: specifier must be a string"_s);
    String specifier = specifierValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    // Bare/relative specifiers resolve against the graph's process.cwd().
    String cwdString;
    {
        JSValue process = graph->field(JSModuleGraph::Field::Process);
        JSValue cwdFunction = process.isObject() ? process.getObject()->get(globalObject, Identifier::fromString(vm, "cwd"_s)) : JSValue();
        RETURN_IF_EXCEPTION(scope, {});
        JSValue cwd = cwdFunction && cwdFunction.isCallable() ? JSC::call(globalObject, cwdFunction, JSC::getCallData(cwdFunction), process, MarkedArgumentBuffer()) : JSValue::decode(Process__getCachedCwd(defaultGlobalObject(globalObject)));
        RETURN_IF_EXCEPTION(scope, {});
        cwdString = cwd.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    auto referrer = Identifier::fromString(vm, makeString(cwdString, PLATFORM_SEP, "[module-graph]"_s));
    Identifier key = loader->resolve(globalObject, Identifier::fromString(vm, specifier), referrer, nullptr, false);
    RETURN_IF_EXCEPTION(scope, {});
    if (graph->field(JSModuleGraph::Field::MainPath).isUndefined())
        graph->setField(vm, JSModuleGraph::Field::MainPath, identifierToJSValue(vm, key));
    JSPromise* loaded = loader->requestImportModule(globalObject, key, Identifier(), nullptr, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    JSPromise* result = JSPromise::create(vm, globalObject->promiseStructure());
    {
        // Remember it for dispose(); drop the ones that settled since.
        auto* previous = dynamicDowncast<JSArray>(graph->field(JSModuleGraph::Field::PendingImports));
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
        graph->setField(vm, JSModuleGraph::Field::PendingImports, pending);
    }
    MarkedArgumentBuffer boundArguments;
    boundArguments.append(result);
    auto bind = [&](ASCIILiteral name, NativeFunction function) -> JSValue {
        JSFunction* handler = JSFunction::create(vm, globalObject, 2, name, function, ImplementationVisibility::Private);
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
    JSValue presetDispose = graph->field(JSModuleGraph::Field::PresetDispose);
    if (presetDispose.isCallable()) {
        graph->setField(vm, JSModuleGraph::Field::PresetDispose, jsUndefined());
        JSC::call(globalObject, presetDispose, JSC::getCallData(presetDispose), jsUndefined(), MarkedArgumentBuffer());
        RETURN_IF_EXCEPTION(scope, {});
    }
    // Drop the loader's registry and this graph's CJS cache. Code that is still
    // running from the graph keeps what it closes over alive, as usual. (The loader
    // itself stays reachable from the overlay's @moduleLoader, so import() from such
    // code still finds the graph, and rejects.)
    if (JSModuleLoader* loader = graph->loader())
        loader->clearAll();
    graph->setField(vm, JSModuleGraph::Field::Loader, jsNull());
    if (auto* pending = dynamicDowncast<JSArray>(graph->field(JSModuleGraph::Field::PendingImports))) {
        graph->setField(vm, JSModuleGraph::Field::PendingImports, jsUndefined());
        for (unsigned i = 0, length = pending->length(); i < length; ++i) {
            JSValue value = pending->getIndex(globalObject, i);
            RETURN_IF_EXCEPTION(scope, {});
            if (auto* promise = dynamicDowncast<JSPromise>(value); promise && promise->status() == JSPromise::Status::Pending)
                promise->reject(vm, createTypeError(globalObject, "ModuleGraph has been disposed"_s));
        }
    }
    if (JSMap* requireMap = graph->requireMap()) {
        requireMap->clear(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    }
    // OnError stays: code of this graph that still runs (a callback it handed
    // to the host) and throws is still reported as this graph's error.
    graph->setField(vm, JSModuleGraph::Field::RequireCache, jsUndefined());
    return JSValue::encode(jsUndefined());
}

extern "C" JSC::JSObject* Bun__ModuleGraph__envForImportMeta(JSC::JSGlobalObject* globalObject, JSC::JSObject* importMeta)
{
    VM& vm = globalObject->vm();
    JSValue graphValue = importMeta->getDirect(vm, WebCore::clientData(vm)->builtinNames().moduleGraphPrivateName());
    JSModuleGraph* graph = graphValue ? dynamicDowncast<JSModuleGraph>(graphValue) : nullptr;
    if (!graph)
        return nullptr;
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue process = graph->field(JSModuleGraph::Field::Process);
    JSValue env = process.isObject() ? process.getObject()->get(globalObject, Identifier::fromString(vm, "env"_s)) : JSValue();
    if (scope.exception()) {
        (void)scope.tryClearException();
        return nullptr;
    }
    return env.isObject() ? env.getObject() : nullptr;
}

extern "C" JSC::EncodedJSValue Bun__ModuleGraph__mainPath(JSModuleGraph* graph)
{
    JSValue path = graph->field(JSModuleGraph::Field::MainPath);
    return JSValue::encode(path ? path : jsUndefined());
}

JSC_DECLARE_CUSTOM_GETTER(jsModuleGraphGetter_mainModule);
JSC_DEFINE_CUSTOM_GETTER(jsModuleGraphGetter_mainModule, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSModuleGraph* graph = thisModuleGraph(globalObject, scope, JSValue::decode(thisValue), "mainModule"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return Bun__ModuleGraph__mainPath(graph);
}

JSC_DEFINE_CUSTOM_GETTER(jsModuleGraphGetter_process, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSModuleGraph* graph = thisModuleGraph(globalObject, scope, JSValue::decode(thisValue), "process"_s);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(graph->field(JSModuleGraph::Field::Process));
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
    { "process"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsModuleGraphGetter_process, 0 } },
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

// Per-graph `Function` constructor: compiles like %Function% but the resulting
// function's scope is the graph's overlay, so free `process` / `setTimeout` /
// `globalThis` / `Bun` (and import() from it) belong to the graph, as they would
// for any other code of the graph. The graph rides on the callee. The body gets a
// trailing comment so this code is not the code cache's entry for the same text
// compiled in the global scope, whose identifiers resolve differently.
JSC_DECLARE_HOST_FUNCTION(callModuleGraphFunctionConstructor);
JSC_DECLARE_HOST_FUNCTION(constructModuleGraphFunctionConstructor);
static EncodedJSValue moduleGraphFunctionConstructorImpl(JSGlobalObject* globalObject, CallFrame* callFrame, JSValue newTarget)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue graphValue = callFrame->jsCallee()->getDirect(vm, WebCore::clientData(vm)->builtinNames().moduleGraphPrivateName());
    auto* graph = graphValue ? dynamicDowncast<JSModuleGraph>(graphValue) : nullptr;
    MarkedArgumentBuffer args;
    for (unsigned i = 0; i < callFrame->argumentCount(); ++i)
        args.append(callFrame->uncheckedArgument(i));
    if (graph && graph->overlay()) {
        JSValue body = args.size() ? args.at(args.size() - 1) : jsEmptyString(vm);
        String bodyString = body.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        JSValue marked = jsString(vm, makeString(bodyString, "\n/* ModuleGraph */"_s));
        if (args.size())
            args.takeLast();
        args.append(marked);
    }
    JSObject* made = newTarget ? constructFunction(globalObject, callFrame, ArgList(args), FunctionConstructionMode::Function, newTarget) : constructFunction(globalObject, callFrame, ArgList(args));
    RETURN_IF_EXCEPTION(scope, {});
    auto* function = dynamicDowncast<JSFunction>(made);
    if (!function || function->isHostFunction() || !graph || !graph->overlay())
        return JSValue::encode(made);
    JSFunction* rescoped = JSFunction::create(vm, globalObject, function->jsExecutable(), graph->overlay());
    // Keep the subclass prototype NewTarget asked for (class X extends Function).
    if (made->getPrototypeDirect() != rescoped->getPrototypeDirect())
        rescoped->setPrototypeDirect(vm, made->getPrototypeDirect());
    return JSValue::encode(rescoped);
}
// Called as a function: no NewTarget. (The `this` slot may hold the environment the
// identifier resolved in -- the caller convention for scope-resolved callees -- so it
// must not be read as NewTarget.)
JSC_DEFINE_HOST_FUNCTION(callModuleGraphFunctionConstructor, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return moduleGraphFunctionConstructorImpl(globalObject, callFrame, JSValue());
}
JSC_DEFINE_HOST_FUNCTION(constructModuleGraphFunctionConstructor, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return moduleGraphFunctionConstructorImpl(globalObject, callFrame, callFrame->newTarget());
}

// (name, value): write an overlay slot; `this` is the overlay environment (bound).
JSC_DECLARE_HOST_FUNCTION(functionModuleGraphWriteOverlay);
JSC_DEFINE_HOST_FUNCTION(functionModuleGraphWriteOverlay, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* overlay = dynamicDowncast<JSLexicalEnvironment>(callFrame->thisValue());
    if (!overlay)
        return JSValue::encode(jsUndefined());
    auto name = callFrame->argument(0).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    SymbolTable* symbolTable = overlay->symbolTable();
    ScopeOffset offset;
    {
        ConcurrentJSLocker locker(symbolTable->m_lock);
        auto it = symbolTable->find(locker, name.impl());
        if (it == symbolTable->end(locker))
            return JSValue::encode(jsUndefined());
        offset = it->value.scopeOffset();
    }
    overlay->variableAt(offset).set(vm, overlay, callFrame->argument(1));
    return JSValue::encode(jsUndefined());
}

// The global names a graph rebinds for bare identifiers. Fixed for the process:
// every module CodeBlock is linked against this set (shared by all instances),
// so it is configured when the global object is created -- before any module
// links -- and the preset provides exactly these keys.
static constexpr ASCIILiteral moduleGraphOverlayNames[] = {
    "process"_s, "Bun"_s, "AbortSignal"_s,
    "setTimeout"_s, "clearTimeout"_s, "setInterval"_s, "clearInterval"_s, "setImmediate"_s, "clearImmediate"_s,
    "Worker"_s, "Function"_s, "globalThis"_s, "global"_s, "self"_s,
};

// One symbol table for every graph's overlay in this global (names in the order of
// moduleGraphOverlayNames): loaders whose module scopes have the same symbol table
// share their modules' executables.
static SymbolTable* moduleGraphOverlaySymbolTable(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    if (JSValue existing = globalObject->m_moduleGraphOverlaySymbolTable.get())
        return uncheckedDowncast<SymbolTable>(existing.asCell());
    SymbolTable* symbolTable = SymbolTable::create(vm);
    for (ASCIILiteral name : moduleGraphOverlayNames)
        symbolTable->add(NoLockingNecessary, Identifier::fromString(vm, name).impl(), SymbolTableEntry(VarOffset(symbolTable->takeNextScopeOffset(NoLockingNecessary))));
    // import() compiles to a lookup of @moduleLoader up the scope chain (JSC); binding it
    // here sends import() from ANY code scoped to the graph (CommonJS wrappers, Function()
    // code, not only its ES modules) to the graph's loader.
    symbolTable->add(NoLockingNecessary, vm.propertyNames->builtinNames().moduleLoaderPrivateName().impl(), SymbolTableEntry(VarOffset(symbolTable->takeNextScopeOffset(NoLockingNecessary))));
    globalObject->m_moduleGraphOverlaySymbolTable.set(vm, globalObject, symbolTable);
    return symbolTable;
}

// The graph's overlay: a lexical environment in the global lexical environment with
// the graph's value for each overlaid name (from `globals`, else the global's own).
static JSLexicalEnvironment* createModuleGraphOverlay(JSGlobalObject* globalObject, JSObject* globals)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    SymbolTable* symbolTable = moduleGraphOverlaySymbolTable(defaultGlobalObject(globalObject));
    JSLexicalEnvironment* overlay = JSLexicalEnvironment::create(vm, globalObject, globalObject->globalLexicalEnvironment(), symbolTable, jsUndefined());
    for (ASCIILiteral name : moduleGraphOverlayNames) {
        Identifier identifier = Identifier::fromString(vm, name);
        JSValue value;
        bool own = globals && globals->hasOwnProperty(globalObject, identifier);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (own)
            value = globals->get(globalObject, identifier);
        else
            value = globalObject->get(globalObject, identifier);
        RETURN_IF_EXCEPTION(scope, nullptr);
        overlay->variableAt(symbolTable->get(identifier.impl()).scopeOffset()).set(vm, overlay, value);
    }
    return overlay;
}

// ModuleGraph.overlaidGlobals: the fixed set of global names a graph rebinds for bare
// identifiers. Other `globals` keys are reachable as globalThis.<key> only.
JSC_DECLARE_CUSTOM_GETTER(moduleGraphOverlaidGlobalsGetter);
JSC_DEFINE_CUSTOM_GETTER(moduleGraphOverlaidGlobalsGetter, (JSGlobalObject * globalObject, EncodedJSValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    MarkedArgumentBuffer names;
    for (ASCIILiteral name : moduleGraphOverlayNames)
        names.append(jsString(vm, String(name)));
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), names)));
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
        putDirectCustomAccessor(vm, Identifier::fromString(vm, "overlaidGlobals"_s), CustomGetterSetter::create(vm, moduleGraphOverlaidGlobalsGetter, nullptr), PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor);
    }
};

const ClassInfo JSModuleGraphConstructor::s_info = { "ModuleGraph"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSModuleGraphConstructor) };

// new Bun.unsafe.ModuleGraph({ env?, cwd?, onExit?, onError?, globals? })
JSC_HOST_CALL_ATTRIBUTES EncodedJSValue JSModuleGraphConstructor::construct(JSGlobalObject* globalObject, CallFrame* callFrame)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* zigGlobal = defaultGlobalObject(globalObject);

    JSValue optionsValue = callFrame->argument(0);
    if (!optionsValue.isUndefinedOrNull() && !optionsValue.isObject())
        return throwVMTypeError(globalObject, scope, "ModuleGraph options must be an object"_s);

    // { env?, cwd?, onExit?, globals? } → per-graph process/globalThis/timers
    // (s_moduleGraphPresetSource), user `globals` layered on top.
    JSValue presetFactory = zigGlobal->m_moduleGraphPreset.get();
    if (!presetFactory) {
        SourceCode source = makeSource(String(s_moduleGraphPresetSource), SourceOrigin(), SourceTaintedOrigin::Untainted, "module-graph-preset.js"_s);
        NakedPtr<JSC::Exception> exception;
        presetFactory = JSC::evaluate(globalObject, source, globalObject->globalThis(), exception);
        if (exception) {
            throwException(globalObject, scope, exception.get());
            return {};
        }
        zigGlobal->m_moduleGraphPreset.set(vm, zigGlobal, presetFactory);
    }
    if (!optionsValue.isUndefinedOrNull()) {
        Bun::V::validateObject(scope, globalObject, optionsValue, "options"_s);
        RETURN_IF_EXCEPTION(scope, {});
        JSObject* options = optionsValue.getObject();
        JSValue v = options->get(globalObject, Identifier::fromString(vm, "env"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!v.isUndefined()) { Bun::V::validateObject(scope, globalObject, v, "options.env"_s); RETURN_IF_EXCEPTION(scope, {}); }
        v = options->get(globalObject, Identifier::fromString(vm, "cwd"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!v.isUndefined()) { Bun::V::validateString(scope, globalObject, v, "options.cwd"_s); RETURN_IF_EXCEPTION(scope, {}); }
        for (ASCIILiteral name : { "onExit"_s, "onError"_s }) {
            v = options->get(globalObject, Identifier::fromString(vm, name));
            RETURN_IF_EXCEPTION(scope, {});
            if (!v.isUndefined()) { Bun::V::validateFunction(scope, globalObject, v, name == "onExit"_s ? "options.onExit"_s : "options.onError"_s); RETURN_IF_EXCEPTION(scope, {}); }
        }
        v = options->get(globalObject, Identifier::fromString(vm, "globals"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!v.isUndefined()) { Bun::V::validateObject(scope, globalObject, v, "options.globals"_s); RETURN_IF_EXCEPTION(scope, {}); }
    }
    MarkedArgumentBuffer presetArgs;
    presetArgs.append(optionsValue);
    JSValue preset = JSC::call(globalObject, presetFactory, JSC::getCallData(presetFactory), jsUndefined(), presetArgs);
    RETURN_IF_EXCEPTION(scope, {});
    JSObject* globals = preset.get(globalObject, Identifier::fromString(vm, "globals"_s)).getObject();
    RETURN_IF_EXCEPTION(scope, {});
    JSValue presetDispose = preset.get(globalObject, Identifier::fromString(vm, "dispose"_s));
    RETURN_IF_EXCEPTION(scope, {});
    JSValue graphProcess = preset.get(globalObject, Identifier::fromString(vm, "process"_s));
    RETURN_IF_EXCEPTION(scope, {});
    JSValue dispatchError = preset.get(globalObject, Identifier::fromString(vm, "dispatchError"_s));
    RETURN_IF_EXCEPTION(scope, {});
    JSValue customizeBuiltin = preset.get(globalObject, Identifier::fromString(vm, "customizeBuiltin"_s));
    RETURN_IF_EXCEPTION(scope, {});
    JSValue onExit = optionsValue.isObject() ? optionsValue.getObject()->get(globalObject, Identifier::fromString(vm, "onExit"_s)) : jsUndefined();
    RETURN_IF_EXCEPTION(scope, {});
    JSValue onError = optionsValue.isObject() ? optionsValue.getObject()->get(globalObject, Identifier::fromString(vm, "onError"_s)) : jsUndefined();
    RETURN_IF_EXCEPTION(scope, {});

    Structure* structure = zigGlobal->JSModuleGraphStructure();
    JSObject* newTarget = asObject(callFrame->newTarget());
    if (newTarget != callFrame->jsCallee()) {
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget, structure);
        RETURN_IF_EXCEPTION(scope, {});
    }
    JSModuleGraph* graph = JSModuleGraph::create(vm, structure);
    if (globals) {
        // The graph's own Function constructor (see moduleGraphFunctionConstructorImpl).
        JSFunction* functionConstructor = JSFunction::create(vm, globalObject, 1, vm.propertyNames->Function.string(), callModuleGraphFunctionConstructor, ImplementationVisibility::Public, NoIntrinsic, constructModuleGraphFunctionConstructor);
        functionConstructor->putDirect(vm, WebCore::clientData(vm)->builtinNames().moduleGraphPrivateName(), graph, static_cast<unsigned>(PropertyAttribute::DontEnum));
        functionConstructor->putDirect(vm, vm.propertyNames->prototype, globalObject->functionPrototype(), PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
        globals->putDirect(vm, vm.propertyNames->Function, functionConstructor);
        JSValue defineName = preset.get(globalObject, Identifier::fromString(vm, "defineName"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (defineName.isCallable()) {
            MarkedArgumentBuffer args;
            args.append(jsString(vm, String("Function"_s)));
            args.append(functionConstructor);
            JSC::call(globalObject, defineName, JSC::getCallData(defineName), preset, args);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    // Keys outside the fixed set still become properties of the graph's globalThis
    // (globalThis.<key> works); only bare-identifier resolution is limited to the
    // fixed set (moduleGraphOverlayNames / ModuleGraph.overlaidGlobals).
    JSLexicalEnvironment* overlay = createModuleGraphOverlay(globalObject, globals);
    RETURN_IF_EXCEPTION(scope, {});
    JSModuleLoader* loader = JSModuleLoader::create(globalObject, vm, overlay);
    overlay->variableAt(overlay->symbolTable()->get(vm.propertyNames->builtinNames().moduleLoaderPrivateName().impl()).scopeOffset()).set(vm, overlay, loader);
    {
        // globalThis.<overlaid name> = v inside the graph also writes the overlay slot.
        JSValue setOverlayWriter = preset.get(globalObject, Identifier::fromString(vm, "setOverlayWriter"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (setOverlayWriter.isCallable()) {
            JSFunction* writeOverlay = JSFunction::create(vm, globalObject, 2, "writeOverlay"_s, functionModuleGraphWriteOverlay, ImplementationVisibility::Public);
            JSValue writer = JSBoundFunction::create(vm, globalObject, writeOverlay, overlay, ArgList(), 2, jsEmptyString(vm), makeSource("writeOverlay"_s, SourceOrigin(), SourceTaintedOrigin::Untainted));
            RETURN_IF_EXCEPTION(scope, {});
            MarkedArgumentBuffer args;
            args.append(writer);
            JSC::call(globalObject, setOverlayWriter, JSC::getCallData(setOverlayWriter), preset, args);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    JSMap* requireMap = JSMap::create(vm, globalObject->mapStructure());
    RETURN_IF_EXCEPTION(scope, {});

    graph->setField(vm, JSModuleGraph::Field::Loader, loader);
    graph->setField(vm, JSModuleGraph::Field::Overlay, overlay);
    graph->setField(vm, JSModuleGraph::Field::RequireMap, requireMap);
    graph->setField(vm, JSModuleGraph::Field::OnExit, onExit);
    graph->setField(vm, JSModuleGraph::Field::OnError, onError);
    graph->setField(vm, JSModuleGraph::Field::Process, graphProcess);
    graph->setField(vm, JSModuleGraph::Field::PresetDispose, presetDispose);
    graph->setField(vm, JSModuleGraph::Field::DispatchError, dispatchError);
    if (customizeBuiltin.isCallable())
        graph->setField(vm, JSModuleGraph::Field::CustomizeBuiltin, customizeBuiltin);

    // overlay → graph, for attributing errors / scopes / loaders to it.
    JSWeakMap* registry = zigGlobal->m_moduleGraphRegistry.get() ? uncheckedDowncast<JSWeakMap>(zigGlobal->m_moduleGraphRegistry.get()) : nullptr;
    if (!registry) {
        registry = JSWeakMap::create(vm, globalObject->weakMapStructure());
        zigGlobal->m_moduleGraphRegistry.set(vm, zigGlobal, registry);
    }
    registry->set(vm, overlay, graph);
    {
        // Let an in-graph process.exit() run this graph's native dispose (drops the
        // loader / require cache) — see setNativeDispose in the preset.
        JSValue setNativeDispose = preset.get(globalObject, Identifier::fromString(vm, "setNativeDispose"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (setNativeDispose.isCallable()) {
            JSObject* disposeFn = graph->get(globalObject, Identifier::fromString(vm, "dispose"_s)).getObject();
            RETURN_IF_EXCEPTION(scope, {});
            if (disposeFn) {
                JSValue bound = JSBoundFunction::create(vm, globalObject, disposeFn, graph, ArgList(), 0, jsEmptyString(vm), makeSource("dispose"_s, SourceOrigin(), SourceTaintedOrigin::Untainted));
                RETURN_IF_EXCEPTION(scope, {});
                MarkedArgumentBuffer a;
                a.append(bound);
                JSC::call(globalObject, setNativeDispose, JSC::getCallData(setNativeDispose), jsUndefined(), a);
                RETURN_IF_EXCEPTION(scope, {});
            }
        }
    }
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

extern "C" JSC::EncodedJSValue Bun__ModuleGraph__getConstructor(JSC::JSGlobalObject* globalObject)
{
    return JSValue::encode(defaultGlobalObject(globalObject)->JSModuleGraphConstructor());
}

} // namespace Bun
