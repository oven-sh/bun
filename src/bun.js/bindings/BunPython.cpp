#include "BunPython.h"
#include "JSPyObject.h"
#include "PyJSValueObject.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include "InternalModuleRegistry.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/JSInternalPromise.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/Error.h>
#include <wtf/text/WTFString.h>
#include <wtf/text/StringBuilder.h>
#include <memory>
#include <optional>
#include <unordered_map>
#include <string_view>
#include <unistd.h>
#include <sys/stat.h>
#include <mach/mach_time.h>

extern "C" void Bun__atexit(void (*callback)());
extern "C" JSC::EncodedJSValue Bun__Process__getCwd(JSC::JSGlobalObject* globalObject);

// Zig timer functions
extern "C" JSC::EncodedJSValue Bun__Timer__setTimeout(JSC::JSGlobalObject* globalThis, JSC::EncodedJSValue callback, JSC::EncodedJSValue arguments, JSC::EncodedJSValue countdown);
extern "C" JSC::EncodedJSValue Bun__Timer__setImmediate(JSC::JSGlobalObject* globalThis, JSC::EncodedJSValue callback, JSC::EncodedJSValue arguments);

namespace Bun::Python {

using namespace JSC;

// =============================================================================
// Python Callback Management for Event Loop Integration
// =============================================================================

static bool g_bunEventLoopInitialized = false;
static PyObject* g_bunEventLoop = nullptr;

// Forward declarations
static JSGlobalObject* getThreadJSGlobal();
static void setThreadJSGlobal(JSGlobalObject* global);

// Get monotonic time in seconds (for Python asyncio)
static double getMonotonicTimeSeconds()
{
    static mach_timebase_info_data_t timebaseInfo;
    static bool timebaseInitialized = false;

    if (!timebaseInitialized) {
        mach_timebase_info(&timebaseInfo);
        timebaseInitialized = true;
    }

    uint64_t machTime = mach_absolute_time();
    uint64_t nanos = machTime * timebaseInfo.numer / timebaseInfo.denom;
    return static_cast<double>(nanos) / 1e9;
}

// Helper to get or create JSPyObject structure
static Structure* getJSPyObjectStructure(JSGlobalObject* globalObject)
{
    auto* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    VM& vm = globalObject->vm();

    Structure* structure = zigGlobalObject->m_JSPyObjectStructure.get();
    if (!structure) {
        structure = JSPyObject::createStructure(vm, globalObject, globalObject->objectPrototype());
        zigGlobalObject->m_JSPyObjectStructure.set(vm, zigGlobalObject, structure);
    }
    return structure;
}

// Python C function: _bun._schedule_timer(delay_ms, callable) -> timer_id
static PyObject* bun_schedule_timer(PyObject* self, PyObject* args)
{
    double delay_ms;
    PyObject* callable;

    if (!PyArg_ParseTuple(args, "dO", &delay_ms, &callable)) {
        return nullptr;
    }

    if (!PyCallable_Check(callable)) {
        PyErr_SetString(PyExc_TypeError, "callback must be callable");
        return nullptr;
    }

    JSGlobalObject* globalObject = getThreadJSGlobal();
    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "No JavaScript context available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    Structure* structure = getJSPyObjectStructure(globalObject);

    // Wrap Python callable in JSPyObject - this handles reference counting
    JSPyObject* jsCallable = JSPyObject::create(vm, globalObject, structure, callable);

    // Call setTimeout with the JSPyObject as callback
    JSValue result = JSValue::decode(Bun__Timer__setTimeout(
        globalObject,
        JSValue::encode(jsCallable),
        JSValue::encode(jsUndefined()), // no arguments needed
        JSValue::encode(jsNumber(delay_ms))));

    if (result.isEmpty()) {
        PyErr_SetString(PyExc_RuntimeError, "Failed to schedule timer");
        return nullptr;
    }

    // Return 0 for now - cancellation is handled by Python's _cancelled flag
    // The timer object is kept alive by JSC until it fires
    return PyLong_FromLong(0);
}

// Python C function: _bun._schedule_soon(callable) -> timer_id
static PyObject* bun_schedule_soon(PyObject* self, PyObject* args)
{
    PyObject* callable;

    if (!PyArg_ParseTuple(args, "O", &callable)) {
        return nullptr;
    }

    if (!PyCallable_Check(callable)) {
        PyErr_SetString(PyExc_TypeError, "callback must be callable");
        return nullptr;
    }

    JSGlobalObject* globalObject = getThreadJSGlobal();
    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "No JavaScript context available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    Structure* structure = getJSPyObjectStructure(globalObject);

    // Wrap Python callable in JSPyObject - this handles reference counting
    JSPyObject* jsCallable = JSPyObject::create(vm, globalObject, structure, callable);

    // Call setImmediate with the JSPyObject as callback
    JSValue result = JSValue::decode(Bun__Timer__setImmediate(
        globalObject,
        JSValue::encode(jsCallable),
        JSValue::encode(jsUndefined()) // no arguments needed
        ));

    if (result.isEmpty()) {
        PyErr_SetString(PyExc_RuntimeError, "Failed to schedule immediate");
        return nullptr;
    }

    // Return 0 for now - cancellation is handled by Python's _cancelled flag
    return PyLong_FromLong(0);
}

// Python C function: _bun._time() -> float (seconds)
static PyObject* bun_time(PyObject* self, PyObject* args)
{
    return PyFloat_FromDouble(getMonotonicTimeSeconds());
}

// Python C function: _bun._cancel_handle(timer_id) -> None
// Note: Currently a no-op - cancellation is handled by Python's _cancelled flag
// TODO: Implement proper timer cancellation by storing timer objects
static PyObject* bun_cancel_handle(PyObject* self, PyObject* args)
{
    // Cancellation is handled by Python's BunHandle._cancelled flag
    // which prevents the callback from executing when _run() is called.
    // The timer will still fire, but the callback will be a no-op.
    Py_RETURN_NONE;
}

// Extern declaration for Bun's event loop tick
extern "C" void Bun__drainMicrotasks();

// Python C function: _bun._tick() -> None
// Runs one iteration of Bun's event loop (processes I/O, timers, microtasks)
static PyObject* bun_tick(PyObject* self, PyObject* args)
{
    Bun__drainMicrotasks();
    Py_RETURN_NONE;
}

// =============================================================================
// BunEventLoop Python Class Definition
// =============================================================================

static const char* bunEventLoopCode = R"(
import asyncio
import asyncio.events as events
import asyncio.futures as futures
import asyncio.tasks as tasks
import contextvars

class BunHandle:
    __slots__ = ('_callback', '_args', '_cancelled', '_loop', '_context', '_handle_id')

    def __init__(self, callback, args, loop, context=None):
        self._loop = loop
        self._callback = callback
        self._args = args
        self._cancelled = False
        self._context = context if context is not None else contextvars.copy_context()
        self._handle_id = None

    def cancel(self):
        if not self._cancelled:
            self._cancelled = True
            if self._handle_id is not None:
                import _bun
                _bun._cancel_handle(self._handle_id)
            self._callback = None
            self._args = None

    def cancelled(self):
        return self._cancelled

    def _run(self):
        if self._cancelled:
            return
        # Mark as cancelled to prevent double-execution
        # (callbacks may be scheduled on both Bun's queue and our queue)
        self._cancelled = True
        try:
            self._context.run(self._callback, *self._args)
        except (SystemExit, KeyboardInterrupt):
            raise
        except BaseException as exc:
            self._loop.call_exception_handler({
                'message': f'Exception in callback {self._callback!r}',
                'exception': exc,
                'handle': self,
            })


class BunTimerHandle(BunHandle):
    __slots__ = ('_when', '_scheduled')

    def __init__(self, when, callback, args, loop, context=None):
        super().__init__(callback, args, loop, context)
        self._when = when
        self._scheduled = True

    def when(self):
        return self._when

    def cancel(self):
        if not self._cancelled:
            self._loop._timer_handle_cancelled(self)
        super().cancel()


class BunEventLoop(asyncio.AbstractEventLoop):
    def __init__(self):
        self._closed = False
        self._timer_cancelled_count = 0
        self._debug = False
        self._ready = []  # Queue of callbacks to run
        self._scheduled = []  # Heap of timer handles

    def time(self):
        import _bun
        return _bun._time()

    def call_later(self, delay, callback, *args, context=None):
        if delay < 0:
            delay = 0
        when = self.time() + delay
        return self.call_at(when, callback, *args, context=context)

    def call_at(self, when, callback, *args, context=None):
        import _bun
        import heapq
        handle = BunTimerHandle(when, callback, args, self, context)
        delay = max(0, when - self.time())
        # Use Bun's timer so it fires on Bun's event loop
        handle._handle_id = _bun._schedule_timer(delay * 1000, handle._run)
        # Also add to scheduled heap for Python-driven loop
        heapq.heappush(self._scheduled, (when, handle))
        return handle

    def call_soon(self, callback, *args, context=None):
        import _bun
        handle = BunHandle(callback, args, self, context)
        # Use Bun's setImmediate so callbacks run on Bun's event loop
        # This is important for JS->Python async where Bun's loop is driving
        handle._handle_id = _bun._schedule_soon(handle._run)
        # Also add to ready queue for Python->JS async where our loop is driving
        self._ready.append(handle)
        return handle

    def call_soon_threadsafe(self, callback, *args, context=None):
        return self.call_soon(callback, *args, context=context)

    def _run_once(self):
        import _bun
        import heapq

        # Tick Bun's event loop first - this processes I/O and setImmediate callbacks
        # which may include our call_soon callbacks
        _bun._tick()

        # Process any remaining ready callbacks that weren't run by Bun
        # (BunHandle._run checks _cancelled to avoid double-execution)
        ready = self._ready
        self._ready = []
        for handle in ready:
            if not handle._cancelled:
                handle._run()

        # Check for timers that are ready
        now = self.time()
        while self._scheduled and self._scheduled[0][0] <= now:
            when, handle = heapq.heappop(self._scheduled)
            if not handle._cancelled:
                handle._run()

    def create_future(self):
        return futures.Future(loop=self)

    def create_task(self, coro, *, name=None, context=None):
        return tasks.Task(coro, loop=self, name=name, context=context)

    def is_running(self):
        return True

    def is_closed(self):
        return self._closed

    def close(self):
        self._closed = True

    def get_debug(self):
        return self._debug

    def set_debug(self, enabled):
        self._debug = enabled

    def _timer_handle_cancelled(self, handle):
        self._timer_cancelled_count += 1

    def call_exception_handler(self, context):
        message = context.get('message', 'Unhandled exception in event loop')
        exception = context.get('exception')
        if exception:
            import traceback
            print(f"{message}: {exception}")
            traceback.print_exception(type(exception), exception, exception.__traceback__)
        else:
            print(message)

    def run_forever(self):
        while not self._closed:
            self._run_once()

    def run_until_complete(self, future):
        import asyncio

        # Convert coroutine to future if needed
        future = asyncio.ensure_future(future, loop=self)

        # Set this loop as the running loop
        events._set_running_loop(self)

        try:
            # Run until the future is done
            while not future.done():
                self._run_once()

            # Return the result or raise exception
            return future.result()
        finally:
            events._set_running_loop(None)

    def stop(self):
        self._closed = True

    async def shutdown_asyncgens(self):
        pass

    async def shutdown_default_executor(self, timeout=None):
        pass


# Singleton event loop instance
_bun_loop = None

def get_bun_loop():
    global _bun_loop
    if _bun_loop is None:
        _bun_loop = BunEventLoop()
    return _bun_loop

def set_bun_loop_running():
    loop = get_bun_loop()
    events._set_running_loop(loop)
    return loop


class BunEventLoopPolicy(asyncio.AbstractEventLoopPolicy):
    """Event loop policy that uses BunEventLoop for all operations."""

    def __init__(self):
        self._local = None

    def get_event_loop(self):
        return get_bun_loop()

    def set_event_loop(self, loop):
        pass  # We always use the singleton BunEventLoop

    def new_event_loop(self):
        return get_bun_loop()


# Install our event loop policy so asyncio.run() uses BunEventLoop
asyncio.set_event_loop_policy(BunEventLoopPolicy())
)";

// =============================================================================
// PyPromiseResolver - Python type to resolve JS Promises when Tasks complete
// =============================================================================

struct PyPromiseResolver {
    PyObject_HEAD
        JSC::Strong<JSPromise>
            promise;
    JSGlobalObject* globalObject;
};

static void PyPromiseResolver_dealloc(PyPromiseResolver* self)
{
    self->promise.clear();
    Py_TYPE(self)->tp_free(reinterpret_cast<PyObject*>(self));
}

static PyObject* PyPromiseResolver_call(PyPromiseResolver* self, PyObject* args, PyObject* kwargs)
{
    PyObject* task;
    if (!PyArg_ParseTuple(args, "O", &task)) {
        return nullptr;
    }

    JSPromise* promise = self->promise.get();
    if (!promise) {
        // Promise was garbage collected
        Py_RETURN_NONE;
    }

    JSGlobalObject* globalObject = self->globalObject;
    VM& vm = globalObject->vm();

    // Check if task was cancelled
    PyObject* cancelledMethod = PyObject_GetAttrString(task, "cancelled");
    if (cancelledMethod) {
        PyObject* cancelled = PyObject_CallNoArgs(cancelledMethod);
        Py_DECREF(cancelledMethod);
        if (cancelled && PyObject_IsTrue(cancelled)) {
            Py_DECREF(cancelled);
            promise->reject(vm, globalObject, JSC::createError(globalObject, "Task was cancelled"_s));
            Py_RETURN_NONE;
        }
        Py_XDECREF(cancelled);
    }
    PyErr_Clear();

    // Check for exception
    PyObject* exceptionMethod = PyObject_GetAttrString(task, "exception");
    if (exceptionMethod) {
        PyObject* exception = PyObject_CallNoArgs(exceptionMethod);
        Py_DECREF(exceptionMethod);
        if (exception && exception != Py_None) {
            PyObject* excStr = PyObject_Str(exception);
            const char* excCStr = excStr ? PyUnicode_AsUTF8(excStr) : "Unknown error";
            promise->reject(vm, globalObject, JSC::createError(globalObject, String::fromUTF8(excCStr)));
            Py_XDECREF(excStr);
            Py_DECREF(exception);
            Py_RETURN_NONE;
        }
        Py_XDECREF(exception);
    }
    PyErr_Clear();

    // Get result
    PyObject* resultMethod = PyObject_GetAttrString(task, "result");
    if (!resultMethod) {
        PyErr_Clear();
        promise->reject(vm, globalObject, JSC::createError(globalObject, "Failed to get task result"_s));
        Py_RETURN_NONE;
    }

    PyObject* result = PyObject_CallNoArgs(resultMethod);
    Py_DECREF(resultMethod);

    if (!result) {
        PyErr_Clear();
        promise->reject(vm, globalObject, JSC::createError(globalObject, "Task result raised exception"_s));
        Py_RETURN_NONE;
    }

    // Convert result to JS and resolve
    JSValue jsResult = toJS(globalObject, result);
    Py_DECREF(result);

    promise->resolve(globalObject, jsResult);
    Py_RETURN_NONE;
}

static PyTypeObject PyPromiseResolverType = {
    .ob_base = PyVarObject_HEAD_INIT(nullptr, 0)
        .tp_name
    = "_bun.PromiseResolver",
    .tp_basicsize = sizeof(PyPromiseResolver),
    .tp_itemsize = 0,
    .tp_dealloc = reinterpret_cast<destructor>(PyPromiseResolver_dealloc),
    .tp_call = reinterpret_cast<ternaryfunc>(PyPromiseResolver_call),
    .tp_flags = Py_TPFLAGS_DEFAULT,
    .tp_doc = "Resolves a JavaScript Promise when a Python Task completes",
};

static PyPromiseResolver* createPromiseResolver(JSGlobalObject* globalObject, JSPromise* promise)
{
    PyPromiseResolver* resolver = PyObject_New(PyPromiseResolver, &PyPromiseResolverType);
    if (!resolver) {
        return nullptr;
    }

    new (&resolver->promise) JSC::Strong<JSPromise>(globalObject->vm(), promise);
    resolver->globalObject = globalObject;
    return resolver;
}

// =============================================================================
// Coroutine to Promise Conversion (used internally by toJS)
// =============================================================================

// Forward declaration
static void ensureBunEventLoopRunning();

static JSValue coroutineToPromise(JSGlobalObject* globalObject, PyObject* coro)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Ensure BunEventLoop is running
    ensureBunEventLoopRunning();

    // Import asyncio
    PyObject* asyncio = PyImport_ImportModule("asyncio");
    if (!asyncio) {
        PyErr_Print();
        throwTypeError(globalObject, scope, "Failed to import asyncio"_s);
        return {};
    }

    // Get the running loop
    PyObject* getRunningLoop = PyObject_GetAttrString(asyncio, "get_running_loop");
    if (!getRunningLoop) {
        Py_DECREF(asyncio);
        PyErr_Print();
        throwTypeError(globalObject, scope, "Failed to get get_running_loop"_s);
        return {};
    }

    PyObject* loop = PyObject_CallNoArgs(getRunningLoop);
    Py_DECREF(getRunningLoop);

    if (!loop) {
        Py_DECREF(asyncio);
        PyErr_Print();
        throwTypeError(globalObject, scope, "No running event loop"_s);
        return {};
    }

    // Create a Task: loop.create_task(coro)
    PyObject* createTask = PyObject_GetAttrString(loop, "create_task");
    if (!createTask) {
        Py_DECREF(loop);
        Py_DECREF(asyncio);
        PyErr_Print();
        throwTypeError(globalObject, scope, "Failed to get create_task"_s);
        return {};
    }

    PyObject* task = PyObject_CallOneArg(createTask, coro);
    Py_DECREF(createTask);

    if (!task) {
        Py_DECREF(loop);
        Py_DECREF(asyncio);
        PyErr_Print();
        throwTypeError(globalObject, scope, "Failed to create task"_s);
        return {};
    }

    // Create JavaScript Promise
    JSPromise* promise = JSPromise::create(vm, globalObject->promiseStructure());

    // Create the resolver callback
    PyPromiseResolver* resolver = createPromiseResolver(globalObject, promise);
    if (!resolver) {
        Py_DECREF(task);
        Py_DECREF(loop);
        Py_DECREF(asyncio);
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    // Add done callback: task.add_done_callback(resolver)
    PyObject* addDoneCallback = PyObject_GetAttrString(task, "add_done_callback");
    if (!addDoneCallback) {
        Py_DECREF(reinterpret_cast<PyObject*>(resolver));
        Py_DECREF(task);
        Py_DECREF(loop);
        Py_DECREF(asyncio);
        PyErr_Print();
        throwTypeError(globalObject, scope, "Failed to get add_done_callback"_s);
        return {};
    }

    PyObject* callbackResult = PyObject_CallOneArg(addDoneCallback, reinterpret_cast<PyObject*>(resolver));
    Py_DECREF(addDoneCallback);
    Py_DECREF(reinterpret_cast<PyObject*>(resolver));

    if (!callbackResult) {
        Py_DECREF(task);
        Py_DECREF(loop);
        Py_DECREF(asyncio);
        PyErr_Print();
        throwTypeError(globalObject, scope, "Failed to add done callback"_s);
        return {};
    }
    Py_DECREF(callbackResult);

    Py_DECREF(task);
    Py_DECREF(loop);
    Py_DECREF(asyncio);

    return promise;
}

static void ensureBunEventLoopRunning()
{
    if (g_bunEventLoopInitialized && g_bunEventLoop) {
        // Already set up, but make sure it's still the running loop
        PyObject* asyncioEvents = PyImport_ImportModule("asyncio.events");
        if (asyncioEvents) {
            PyObject* setRunningLoop = PyObject_GetAttrString(asyncioEvents, "_set_running_loop");
            if (setRunningLoop) {
                PyObject* result = PyObject_CallOneArg(setRunningLoop, g_bunEventLoop);
                Py_XDECREF(result);
                Py_DECREF(setRunningLoop);
            }
            Py_DECREF(asyncioEvents);
        }
        PyErr_Clear();
        return;
    }

    // Get the _bun_event_loop module from __main__
    PyObject* mainModule = PyImport_AddModule("__main__");
    if (!mainModule) {
        PyErr_Print();
        return;
    }

    PyObject* mainDict = PyModule_GetDict(mainModule);

    // Call set_bun_loop_running()
    PyObject* setBunLoopRunning = PyDict_GetItemString(mainDict, "set_bun_loop_running");
    if (!setBunLoopRunning) {
        PyErr_Print();
        return;
    }

    PyObject* loop = PyObject_CallNoArgs(setBunLoopRunning);
    if (!loop) {
        PyErr_Print();
        return;
    }

    g_bunEventLoop = loop; // Keep a reference
    g_bunEventLoopInitialized = true;
}

// Convert PyObject to JSValue - may return JSPyObject for complex types
JSValue toJS(JSGlobalObject* globalObject, PyObject* obj)
{
    if (!obj || obj == Py_None) {
        return jsNull();
    }

    // Check if this is a wrapped JSValue (PyJSValueObject, PyJSDictObject, PyJSListObject)
    // If so, unwrap it directly instead of wrapping in JSPyObject
    JSValue unwrapped = tryUnwrapJSValue(obj);
    if (unwrapped) {
        return unwrapped;
    }

    // Primitive types get converted directly
    if (PyBool_Check(obj)) {
        return jsBoolean(obj == Py_True);
    }

    if (PyLong_Check(obj)) {
        // Check if it fits in a safe integer range
        int overflow;
        long long val = PyLong_AsLongLongAndOverflow(obj, &overflow);
        if (overflow == 0) {
            return jsNumber(static_cast<double>(val));
        }
        // For large integers, convert to double (may lose precision)
        return jsNumber(PyLong_AsDouble(obj));
    }

    if (PyFloat_Check(obj)) {
        return jsNumber(PyFloat_AsDouble(obj));
    }

    VM& vm = globalObject->vm();

    if (PyUnicode_Check(obj)) {
        Py_ssize_t size;
        const char* str = PyUnicode_AsUTF8AndSize(obj, &size);
        if (str) {
            return jsString(vm, WTF::String::fromUTF8({ str, static_cast<size_t>(size) }));
        }
        return jsNull();
    }

    // Check for coroutines - convert to JavaScript Promise
    if (PyCoro_CheckExact(obj) || PyAsyncGen_CheckExact(obj)) {
        return coroutineToPromise(globalObject, obj);
    }

    // For all other types (lists, dicts, objects, callables, etc.),
    // wrap in JSPyObject
    auto* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);

    // Use Array.prototype for sequences (lists, tuples) so JS array methods work
    Structure* structure;
    if (PySequence_Check(obj) && !PyUnicode_Check(obj) && !PyBytes_Check(obj)) {
        structure = zigGlobalObject->m_JSPyArrayStructure.get();
        if (!structure) {
            structure = JSPyObject::createStructure(vm, globalObject, globalObject->arrayPrototype());
            zigGlobalObject->m_JSPyArrayStructure.set(vm, zigGlobalObject, structure);
        }
    } else {
        structure = zigGlobalObject->m_JSPyObjectStructure.get();
        if (!structure) {
            structure = JSPyObject::createStructure(vm, globalObject, globalObject->objectPrototype());
            zigGlobalObject->m_JSPyObjectStructure.set(vm, zigGlobalObject, structure);
        }
    }

    return JSPyObject::create(vm, globalObject, structure, obj);
}

// Create a PyObject from a JSValue
// For arrays: returns PyJSListObject (list-like wrapper with shared reference)
// For objects: returns PyJSDictObject (dict-like wrapper with shared reference)
// For primitives: returns native Python types
// For functions/other: returns PyJSValueObject
PyObject* fromJS(JSGlobalObject* globalObject, JSValue value)
{
    // Convert primitives directly to Python types
    if (value.isUndefined() || value.isNull()) {
        Py_RETURN_NONE;
    }
    if (value.isBoolean()) {
        if (value.asBoolean()) {
            Py_RETURN_TRUE;
        }
        Py_RETURN_FALSE;
    }
    if (value.isInt32()) {
        return PyLong_FromLong(value.asInt32());
    }
    if (value.isNumber()) {
        return PyFloat_FromDouble(value.asNumber());
    }
    if (value.isString()) {
        auto str = value.toWTFString(globalObject);
        auto utf8 = str.utf8();
        return PyUnicode_FromStringAndSize(utf8.data(), utf8.length());
    }

    // For arrays, use PyJSListObject (wrapper with shared reference)
    if (isArray(globalObject, value)) {
        return reinterpret_cast<PyObject*>(PyJSValueObject::NewList(globalObject, value));
    }

    // For Promises, use PyJSValueObject (which has am_await support)
    if (jsDynamicCast<JSPromise*>(value)) {
        PyJSValueObject* wrapper = PyJSValueObject::New();
        if (!wrapper) {
            return nullptr;
        }
        wrapper->jsValue = value;
        wrapper->globalObject = globalObject;
        if (value.isCell()) {
            gcProtect(value.asCell());
        }
        return reinterpret_cast<PyObject*>(wrapper);
    }

    // For iterators/generators (objects with 'next' method), use PyJSValueObject (which has iterator support)
    if (value.isObject()) {
        VM& vm = globalObject->vm();
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        JSObject* jsObj = value.getObject();
        JSValue nextMethod = jsObj->get(globalObject, Identifier::fromString(vm, "next"_s));
        if (!scope.exception() && nextMethod.isCallable()) {
            // It's an iterator - wrap in PyJSValueObject for iterator protocol support
            PyJSValueObject* wrapper = PyJSValueObject::New();
            if (!wrapper) {
                return nullptr;
            }
            wrapper->jsValue = value;
            wrapper->globalObject = globalObject;
            if (value.isCell()) {
                gcProtect(value.asCell());
            }
            return reinterpret_cast<PyObject*>(wrapper);
        }
        scope.clearException();
    }

    // For plain objects, use PyJSDictObject (wrapper with shared reference)
    if (value.isObject() && !value.isCallable()) {
        return reinterpret_cast<PyObject*>(PyJSValueObject::NewDict(globalObject, value));
    }

    // For functions and other complex objects - wrap in PyJSValueObject
    PyJSValueObject* wrapper = PyJSValueObject::New();
    if (!wrapper) {
        return nullptr;
    }

    wrapper->jsValue = value;
    wrapper->globalObject = globalObject;

    // Protect from JavaScript GC while Python holds a reference
    if (value.isCell()) {
        gcProtect(value.asCell());
    }

    return reinterpret_cast<PyObject*>(wrapper);
}

static std::once_flag pythonInitFlag;

static void finalizePython()
{
    if (Py_IsInitialized()) {
        Py_Finalize();
    }
}

// Forward declarations
static void registerJSImportHook();
static void initPyJSValueType();

// Stringify macros for constructing paths
#define PYTHON_STRINGIFY(x) #x
#define PYTHON_TOSTRING(x) PYTHON_STRINGIFY(x)
#define PYTHON_VERSION_STRING PYTHON_TOSTRING(PY_MAJOR_VERSION) "." PYTHON_TOSTRING(PY_MINOR_VERSION)

// Python install root - set by CMake via target_compile_definitions
// Fallback only used if CMake doesn't define it (shouldn't happen in normal builds)
#ifndef PYTHON_ROOT
#error "PYTHON_ROOT must be defined by CMake"
#endif

void ensurePythonInitialized()
{
    std::call_once(pythonInitFlag, []() {
        if (!Py_IsInitialized()) {
            PyConfig config;
            PyConfig_InitPythonConfig(&config);

            // Construct paths using Python version from the linked library
            static const wchar_t* pythonHome = L"" PYTHON_ROOT;
            static const wchar_t* stdlibDir = L"" PYTHON_ROOT "/lib/python" PYTHON_VERSION_STRING;

            PyConfig_SetString(&config, &config.home, pythonHome);
            PyConfig_SetString(&config, &config.stdlib_dir, stdlibDir);
            // Disable buffered stdio so Python's print() flushes immediately
            config.buffered_stdio = 0;

            PyStatus status = Py_InitializeFromConfig(&config);
            if (PyStatus_Exception(status)) {
                PyConfig_Clear(&config);
                Py_Initialize();
            } else {
                PyConfig_Clear(&config);
            }

            Bun__atexit(finalizePython);

            // Initialize the PyJSValueObject type for wrapping JS values in Python
            PyJSValueObject::initType();

            // Register the JS import hook so Python can import JS modules
            registerJSImportHook();
        }
    });
}

static std::once_flag venvPathFlag;

// Add .venv/lib/python{version}/site-packages to sys.path for local Python packages
// This is called after ensurePythonInitialized() when we have access to the JSGlobalObject
void ensureVenvPathAdded(JSGlobalObject* globalObject)
{
    std::call_once(venvPathFlag, [globalObject]() {
        // Get cwd using Bun's process.cwd() implementation
        auto cwdValue = JSC::JSValue::decode(Bun__Process__getCwd(globalObject));
        if (!cwdValue || !cwdValue.isString())
            return;

        auto cwdString = cwdValue.toWTFString(globalObject);
        auto cwdUTF8 = cwdString.utf8();

        // Construct path: <cwd>/.venv/lib/python{major}.{minor}/site-packages
        // This matches where bun install puts Python packages
        char venvPath[PATH_MAX];
        snprintf(venvPath, sizeof(venvPath), "%s/.venv/lib/python" PYTHON_VERSION_STRING "/site-packages", cwdUTF8.data());

        // Check if directory exists
        struct stat st;
        if (stat(venvPath, &st) == 0 && S_ISDIR(st.st_mode)) {
            PyObject* sysPath = PySys_GetObject("path");
            if (sysPath && PyList_Check(sysPath)) {
                PyObject* dirStr = PyUnicode_FromString(venvPath);
                if (dirStr) {
                    PyList_Insert(sysPath, 0, dirStr);
                    Py_DECREF(dirStr);
                }
            }
        }
    });
}

static const char* BUN_GLOBAL_KEY = "bun.jsglobal";

// Store JSGlobalObject in Python's thread state dict
static void setThreadJSGlobal(JSGlobalObject* global)
{
    PyObject* threadDict = PyThreadState_GetDict();
    if (!threadDict)
        return;

    PyObject* capsule = PyCapsule_New(global, BUN_GLOBAL_KEY, nullptr);
    if (capsule) {
        PyDict_SetItemString(threadDict, BUN_GLOBAL_KEY, capsule);
        Py_DECREF(capsule);
    }
}

// Retrieve JSGlobalObject from Python's thread state dict
static JSGlobalObject* getThreadJSGlobal()
{
    PyObject* threadDict = PyThreadState_GetDict();
    if (!threadDict)
        return nullptr;

    PyObject* capsule = PyDict_GetItemString(threadDict, BUN_GLOBAL_KEY);
    if (!capsule || !PyCapsule_CheckExact(capsule))
        return nullptr;

    return static_cast<JSGlobalObject*>(PyCapsule_GetPointer(capsule, BUN_GLOBAL_KEY));
}

// C function callable from Python to load a JS/TS/JSX module
static PyObject* bun_load_js_module(PyObject* self, PyObject* args)
{
    const char* filePath;

    if (!PyArg_ParseTuple(args, "s", &filePath)) {
        return nullptr;
    }

    JSGlobalObject* globalObject = getThreadJSGlobal();
    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "No JavaScript context available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // Create the file URL for the module
    WTF::String filePathStr = WTF::String::fromUTF8(filePath);

    // Use importModule to load the ES module
    auto* promise = JSC::importModule(globalObject, Identifier::fromString(vm, filePathStr), jsUndefined(), jsUndefined(), jsUndefined());

    if (!promise) {
        if (scope.exception()) {
            JSValue exception = scope.exception()->value();
            scope.clearException();
            auto msg = exception.toWTFString(globalObject);
            PyErr_Format(PyExc_RuntimeError, "JavaScript error: %s", msg.utf8().data());
        } else {
            PyErr_Format(PyExc_RuntimeError, "Failed to import module: %s", filePath);
        }
        return nullptr;
    }

    // Drain the microtask queue to allow the module to load
    vm.drainMicrotasks();

    auto status = promise->status();

    if (status == JSPromise::Status::Fulfilled) {
        JSValue result = promise->result();
        return Python::fromJS(globalObject, result);
    } else if (status == JSPromise::Status::Rejected) {
        JSValue error = promise->result();
        auto msg = error.toWTFString(globalObject);
        PyErr_Format(PyExc_RuntimeError, "JavaScript error: %s", msg.utf8().data());
        return nullptr;
    } else {
        // Promise is still pending - this shouldn't happen for simple modules
        PyErr_SetString(PyExc_RuntimeError, "Module loading is pending - async imports not yet supported");
        return nullptr;
    }
}

// Get the current working directory
static PyObject* bun_get_cwd(PyObject* self, PyObject* args)
{
    char cwd[PATH_MAX];
    if (getcwd(cwd, sizeof(cwd))) {
        return PyUnicode_FromString(cwd);
    }
    Py_RETURN_NONE;
}

// Python C function: _bun._load_bun_module() -> Bun module object
// This loads the JS "Bun" global object and wraps it for Python
static PyObject* bun_load_bun_module(PyObject* self, PyObject* args)
{
    JSGlobalObject* globalObject = getThreadJSGlobal();
    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "No JavaScript context available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // Get the "Bun" object from global scope
    JSValue bunObject = globalObject->get(globalObject,
        Identifier::fromString(vm, "Bun"_s));

    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_RuntimeError, "Error accessing Bun global");
        return nullptr;
    }

    if (bunObject.isUndefined() || bunObject.isNull()) {
        PyErr_SetString(PyExc_RuntimeError, "Bun global not found");
        return nullptr;
    }

    // Wrap the Bun object as a Python object
    // This will create a JSPyObject that proxies all attribute access to the JS object
    return Python::fromJS(globalObject, bunObject);
}

// Map node module names to InternalModuleRegistry::Field enum values
static std::optional<Bun::InternalModuleRegistry::Field> getNodeModuleField(const char* name)
{
    using Field = Bun::InternalModuleRegistry::Field;

    // Note: These mappings correspond to the generated InternalModuleRegistry+enum.h
    static const std::unordered_map<std::string_view, Field> moduleMap = {
        { "assert", Field::NodeAssert },
        { "assert/strict", Field::NodeAssertStrict },
        { "async_hooks", Field::NodeAsyncHooks },
        { "buffer", Field::NodeBuffer },
        { "child_process", Field::NodeChildProcess },
        { "cluster", Field::NodeCluster },
        { "console", Field::NodeConsole },
        { "constants", Field::NodeConstants },
        { "crypto", Field::NodeCrypto },
        { "dgram", Field::NodeDgram },
        { "diagnostics_channel", Field::NodeDiagnosticsChannel },
        { "dns", Field::NodeDNS },
        { "dns/promises", Field::NodeDNSPromises },
        { "domain", Field::NodeDomain },
        { "events", Field::NodeEvents },
        { "fs", Field::NodeFS },
        { "fs/promises", Field::NodeFSPromises },
        { "http", Field::NodeHttp },
        { "http2", Field::NodeHttp2 },
        { "https", Field::NodeHttps },
        { "inspector", Field::NodeInspector },
        { "module", Field::NodeModule },
        { "net", Field::NodeNet },
        { "os", Field::NodeOS },
        { "path", Field::NodePath },
        { "path/posix", Field::NodePathPosix },
        { "path/win32", Field::NodePathWin32 },
        { "perf_hooks", Field::NodePerfHooks },
        { "process", Field::NodeProcess },
        { "punycode", Field::NodePunycode },
        { "querystring", Field::NodeQuerystring },
        { "readline", Field::NodeReadline },
        { "readline/promises", Field::NodeReadlinePromises },
        { "repl", Field::NodeRepl },
        { "stream", Field::NodeStream },
        { "stream/consumers", Field::NodeStreamConsumers },
        { "stream/promises", Field::NodeStreamPromises },
        { "stream/web", Field::NodeStreamWeb },
        { "string_decoder", Field::NodeStringDecoder },
        { "test", Field::NodeTest },
        { "timers", Field::NodeTimers },
        { "timers/promises", Field::NodeTimersPromises },
        { "tls", Field::NodeTLS },
        { "trace_events", Field::NodeTraceEvents },
        { "tty", Field::NodeTty },
        { "url", Field::NodeUrl },
        { "util", Field::NodeUtil },
        { "util/types", Field::NodeUtilTypes },
        { "v8", Field::NodeV8 },
        { "vm", Field::NodeVM },
        { "wasi", Field::NodeWasi },
        { "worker_threads", Field::NodeWorkerThreads },
        { "zlib", Field::NodeZlib },
    };

    auto it = moduleMap.find(name);
    if (it != moduleMap.end()) {
        return it->second;
    }
    return std::nullopt;
}

// Python C function: _bun._load_node_module(name) -> Node module object
// This loads a Node.js built-in module like "path", "fs", etc.
static PyObject* bun_load_node_module(PyObject* self, PyObject* args)
{
    const char* moduleName;
    if (!PyArg_ParseTuple(args, "s", &moduleName)) {
        return nullptr;
    }

    auto* globalObject = jsCast<Zig::GlobalObject*>(getThreadJSGlobal());
    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "No JavaScript context available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // Look up the module in our mapping
    auto fieldOpt = getNodeModuleField(moduleName);
    if (!fieldOpt.has_value()) {
        PyErr_Format(PyExc_ImportError, "Unknown Node.js module: '%s'", moduleName);
        return nullptr;
    }

    // Load the module via internalModuleRegistry
    JSValue moduleValue = globalObject->internalModuleRegistry()->requireId(
        globalObject, vm, fieldOpt.value());

    if (scope.exception()) {
        JSValue exception = scope.exception()->value();
        scope.clearException();

        // Try to get a useful error message
        if (exception.isObject()) {
            JSObject* errObj = exception.getObject();
            JSValue msgVal = errObj->get(globalObject, Identifier::fromString(vm, "message"_s));
            if (msgVal.isString()) {
                auto msg = msgVal.toWTFString(globalObject);
                PyErr_Format(PyExc_ImportError, "Cannot import 'node:%s': %s", moduleName, msg.utf8().data());
                return nullptr;
            }
        }
        PyErr_Format(PyExc_ImportError, "Cannot import 'node:%s'", moduleName);
        return nullptr;
    }

    if (moduleValue.isUndefined() || moduleValue.isNull()) {
        PyErr_Format(PyExc_ImportError, "Module 'node:%s' not found", moduleName);
        return nullptr;
    }

    return Python::fromJS(globalObject, moduleValue);
}

// Python C function: _bun._get_global_this() -> globalThis object
// This returns the JavaScript globalThis wrapped as a PyJSValue
static PyObject* bun_get_global_this(PyObject* self, PyObject* args)
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(getThreadJSGlobal());
    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "No JavaScript context available");
        return nullptr;
    }

    JSValue globalThis = globalObject->globalThis();
    return Python::fromJS(globalObject, globalThis);
}

static PyMethodDef bunModuleMethods[] = {
    { "_load_js_module", bun_load_js_module, METH_VARARGS, "Load a JavaScript module" },
    { "_load_bun_module", bun_load_bun_module, METH_NOARGS, "Load Bun APIs as Python module" },
    { "_load_node_module", bun_load_node_module, METH_VARARGS, "Load a Node.js built-in module" },
    { "_get_global_this", bun_get_global_this, METH_NOARGS, "Get JavaScript globalThis object" },
    { "_get_cwd", bun_get_cwd, METH_NOARGS, "Get current working directory" },
    { "_schedule_timer", bun_schedule_timer, METH_VARARGS, "Schedule a timer callback" },
    { "_schedule_soon", bun_schedule_soon, METH_VARARGS, "Schedule an immediate callback" },
    { "_time", bun_time, METH_NOARGS, "Get monotonic time in seconds" },
    { "_cancel_handle", bun_cancel_handle, METH_VARARGS, "Cancel a scheduled callback" },
    { "_tick", bun_tick, METH_NOARGS, "Run one iteration of Bun's event loop" },
    { nullptr, nullptr, 0, nullptr }
};

static struct PyModuleDef bunModuleDef = {
    PyModuleDef_HEAD_INIT,
    "_bun",
    "Bun internal module",
    -1,
    bunModuleMethods
};

// Python code for the JS import hook
static const char* jsImportHookCode = R"(
import sys
import os
from types import ModuleType
from importlib.machinery import ModuleSpec
import _bun

class BunModuleFinder:
    """Special finder for 'bun' module - bridges to Bun's JS APIs"""

    def find_spec(self, fullname, path, target=None):
        if fullname == "bun":
            return ModuleSpec("bun", BunModuleLoader(), origin="bun://runtime")
        return None


class BunModuleLoader:
    """Loader for the 'bun' module - wraps JS Bun object"""

    def create_module(self, spec):
        # Load Bun's JS "Bun" global object and wrap it for Python
        return _bun._load_bun_module()

    def exec_module(self, module):
        pass


class NodeProxyModule(ModuleType):
    """Proxy module for 'node' that lazily loads submodules on attribute access.

    Supports:
        import node
        node.path.join(...)
        from node import path, fs
        import node.path
    """
    _cache = {}

    def __init__(self):
        super().__init__('node')
        self.__path__ = []  # Makes it a package
        self.__package__ = 'node'

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(f"module 'node' has no attribute '{name}'")

        # Check cache first
        if name in NodeProxyModule._cache:
            return NodeProxyModule._cache[name]

        # Load the node module
        try:
            module = _bun._load_node_module(name)
            NodeProxyModule._cache[name] = module
            # Also register in sys.modules for subsequent imports
            sys.modules[f'node.{name}'] = module
            return module
        except ImportError as e:
            raise AttributeError(f"module 'node' has no attribute '{name}'") from e


class NodeModuleFinder:
    """Finder for 'node' and 'node.*' imports"""

    def find_spec(self, fullname, path, target=None):
        if fullname == "node":
            return ModuleSpec("node", NodeModuleLoader(), origin="node://builtin", is_package=True)

        if fullname.startswith("node."):
            # Handle node.path, node.fs, node.fs.promises, etc.
            submodule = fullname.split('.', 1)[1]
            # Convert dots to slashes for Node.js submodule format
            # e.g., "fs.promises" -> "fs/promises"
            node_module_name = submodule.replace('.', '/')
            return ModuleSpec(fullname, NodeSubmoduleLoader(node_module_name), origin=f"node://{node_module_name}")

        return None


class NodeModuleLoader:
    """Loader for the 'node' package - returns the proxy module"""

    def create_module(self, spec):
        return NodeProxyModule()

    def exec_module(self, module):
        pass


class NodeModuleWrapper(ModuleType):
    """Wrapper that makes a Node.js module appear as a Python package.

    This allows imports like:
        from node.fs.promises import writeFile
        from node.path.posix import basename
    """

    def __init__(self, name, js_module, python_name):
        super().__init__(python_name)
        self._js_module = js_module
        self.__path__ = []  # Makes it a package
        self.__package__ = python_name

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(f"module has no attribute '{name}'")
        return getattr(self._js_module, name)

    def __dir__(self):
        return dir(self._js_module)


class NodeSubmoduleLoader:
    """Loader for node.* submodules like node.path, node.fs, node.fs.promises"""

    def __init__(self, name):
        # name is in Node.js format: "fs", "fs/promises", "path/posix", etc.
        self.name = name

    def create_module(self, spec):
        # Check if already cached
        if self.name in NodeProxyModule._cache:
            cached = NodeProxyModule._cache[self.name]
            # Return existing module if it's already wrapped
            if isinstance(cached, NodeModuleWrapper):
                return cached
            return cached

        js_module = _bun._load_node_module(self.name)

        # Wrap in NodeModuleWrapper to make it act as a package
        # This allows submodule imports like node.fs.promises
        module = NodeModuleWrapper(self.name, js_module, spec.name)

        NodeProxyModule._cache[self.name] = module
        # Also register in sys.modules for the full Python path
        sys.modules[spec.name] = module
        return module

    def exec_module(self, module):
        pass


class JSModuleFinder:
    def find_spec(self, fullname, path, target=None):
        # Skip standard library and already-loaded modules
        if fullname in sys.modules:
            return None

        # Search sys.path entries (similar to how Python searches for .py files)
        search_paths = sys.path if sys.path else [_bun._get_cwd() or os.getcwd()]

        for base_dir in search_paths:
            if not base_dir:
                base_dir = _bun._get_cwd() or os.getcwd()

            # Look for JS/TS/JSX/TSX files
            for ext in ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.mts']:
                js_path = os.path.join(base_dir, fullname + ext)
                if os.path.exists(js_path):
                    return ModuleSpec(fullname, JSModuleLoader(js_path), origin=js_path)

        return None


class JSModuleLoader:
    def __init__(self, path):
        self.path = path

    def create_module(self, spec):
        return _bun._load_js_module(self.path)

    def exec_module(self, module):
        pass


class JSGlobalProxyModule(ModuleType):
    """Proxy module for 'js' that wraps JavaScript's globalThis.

    Supports:
        import js
        js.Response, js.fetch, js.console, etc.
        from js import Response, fetch, URL, Headers
    """
    _global_this = None

    def __init__(self):
        super().__init__('js')
        self.__package__ = 'js'

    @classmethod
    def _get_global(cls):
        if cls._global_this is None:
            cls._global_this = _bun._get_global_this()
        return cls._global_this

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(f"module 'js' has no attribute '{name}'")
        return getattr(JSGlobalProxyModule._get_global(), name)

    def __dir__(self):
        return dir(JSGlobalProxyModule._get_global())


class JSGlobalModuleFinder:
    """Finder for 'js' module - provides access to JavaScript globalThis"""

    def find_spec(self, fullname, path, target=None):
        if fullname == "js":
            return ModuleSpec("js", JSGlobalModuleLoader(), origin="js://globalThis")
        return None


class JSGlobalModuleLoader:
    """Loader for the 'js' module - returns the globalThis proxy"""

    def create_module(self, spec):
        return JSGlobalProxyModule()

    def exec_module(self, module):
        pass


# Register finders in order of priority
sys.meta_path.insert(0, BunModuleFinder())
sys.meta_path.insert(1, NodeModuleFinder())
sys.meta_path.insert(2, JSGlobalModuleFinder())
sys.meta_path.insert(3, JSModuleFinder())
)";

static bool jsImportHookRegistered = false;

static void registerJSImportHook()
{
    if (jsImportHookRegistered)
        return;

    // Initialize the PyPromiseResolverType
    if (PyType_Ready(&PyPromiseResolverType) < 0) {
        PyErr_Print();
        return;
    }

    // Create the _bun module
    PyObject* bunModule = PyModule_Create(&bunModuleDef);
    if (!bunModule) {
        PyErr_Print();
        return;
    }

    // Add PromiseResolver type to the module
    Py_INCREF(&PyPromiseResolverType);
    if (PyModule_AddObject(bunModule, "PromiseResolver", reinterpret_cast<PyObject*>(&PyPromiseResolverType)) < 0) {
        Py_DECREF(&PyPromiseResolverType);
        Py_DECREF(bunModule);
        PyErr_Print();
        return;
    }

    PyObject* sysModules = PyImport_GetModuleDict();
    PyDict_SetItemString(sysModules, "_bun", bunModule);
    Py_DECREF(bunModule);

    // Execute the import hook registration code
    PyObject* mainModule = PyImport_AddModule("__main__");
    PyObject* mainDict = PyModule_GetDict(mainModule);

    PyObject* result = PyRun_String(jsImportHookCode, Py_file_input, mainDict, mainDict);
    if (!result) {
        PyErr_Print();
        return;
    }
    Py_DECREF(result);

    // Execute the BunEventLoop registration code
    result = PyRun_String(bunEventLoopCode, Py_file_input, mainDict, mainDict);
    if (!result) {
        PyErr_Print();
        return;
    }
    Py_DECREF(result);

    jsImportHookRegistered = true;
}

SyntheticSourceProvider::SyntheticSourceGenerator
generatePythonModuleSourceCode(JSGlobalObject* globalObject, const WTF::String& filePath, bool isMainEntry)
{
    return [filePath = filePath.isolatedCopy(), isMainEntry](JSGlobalObject* lexicalGlobalObject,
               Identifier moduleKey,
               Vector<Identifier, 4>& exportNames,
               MarkedArgumentBuffer& exportValues) -> void {
        VM& vm = lexicalGlobalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);

        ensurePythonInitialized();
        ensureVenvPathAdded(lexicalGlobalObject);

        // Set the JavaScript global for this thread so Python can import JS modules
        setThreadJSGlobal(lexicalGlobalObject);

        // Read the Python file
        auto pathUTF8 = filePath.utf8();
        FILE* fp = fopen(pathUTF8.data(), "rb");
        if (!fp) {
            throwTypeError(lexicalGlobalObject, scope, makeString("Cannot open Python file: "_s, filePath));
            return;
        }

        // Read file content
        fseek(fp, 0, SEEK_END);
        long fileSize = ftell(fp);
        fseek(fp, 0, SEEK_SET);

        auto fileContent = std::make_unique<char[]>(fileSize + 1);
        size_t bytesRead = fread(fileContent.get(), 1, fileSize, fp);
        fclose(fp);
        fileContent[bytesRead] = '\0';

        // Create the module name following Python semantics:
        // - If running as main entry point: use "__main__"
        // - If imported: derive from filename without path and .py extension
        WTF::String moduleName;
        if (isMainEntry) {
            moduleName = "__main__"_s;
        } else {
            // Extract just the filename without path
            size_t lastSlash = filePath.reverseFind('/');
            size_t lastBackslash = filePath.reverseFind('\\');
            size_t start = 0;
            if (lastSlash != notFound)
                start = lastSlash + 1;
            if (lastBackslash != notFound && lastBackslash >= start)
                start = lastBackslash + 1;

            // Remove .py extension if present
            size_t lastDot = filePath.reverseFind('.');
            size_t end = filePath.length();
            if (lastDot != notFound && lastDot > start)
                end = lastDot;

            moduleName = filePath.substring(start, end - start);
        }
        auto moduleNameUTF8 = moduleName.utf8();

        // Add the script's directory to sys.path[0] (standard Python behavior)
        {
            size_t lastSlash = filePath.reverseFind('/');
            size_t lastBackslash = filePath.reverseFind('\\');
            WTF::String scriptDir;
            if (lastSlash != notFound || lastBackslash != notFound) {
                size_t lastSep = lastSlash != notFound ? lastSlash : 0;
                if (lastBackslash != notFound && lastBackslash > lastSep)
                    lastSep = lastBackslash;
                scriptDir = filePath.substring(0, lastSep);
            } else {
                scriptDir = "."_s;
            }

            PyObject* sysPath = PySys_GetObject("path");
            if (sysPath && PyList_Check(sysPath)) {
                auto scriptDirUTF8 = scriptDir.utf8();
                PyObject* dirStr = PyUnicode_FromString(scriptDirUTF8.data());
                if (dirStr) {
                    PyList_Insert(sysPath, 0, dirStr);
                    Py_DECREF(dirStr);
                }
            }
        }

        // Compile the Python source
        PyObject* code = Py_CompileString(fileContent.get(), pathUTF8.data(), Py_file_input);

        if (!code) {
            PyErr_Print();
            PyErr_Clear();
            throwTypeError(lexicalGlobalObject, scope, makeString("Python compile error in: "_s, filePath));
            return;
        }

        // Execute as a module
        PyObject* module = PyImport_ExecCodeModule(moduleNameUTF8.data(), code);
        Py_DECREF(code);

        if (!module) {
            PyErr_Print();
            PyErr_Clear();
            throwTypeError(lexicalGlobalObject, scope, makeString("Python execution error in: "_s, filePath));
            return;
        }

        // Get module dict (borrowed reference)
        PyObject* dict = PyModule_GetDict(module);

        // Create the module object as default export
        auto* zigGlobalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
        Structure* structure = zigGlobalObject->m_JSPyObjectStructure.get();
        if (!structure) {
            structure = JSPyObject::createStructure(vm, lexicalGlobalObject, lexicalGlobalObject->objectPrototype());
            zigGlobalObject->m_JSPyObjectStructure.set(vm, zigGlobalObject, structure);
        }

        // Add default export - the module itself
        exportNames.append(vm.propertyNames->defaultKeyword);
        JSPyObject* moduleValue = JSPyObject::create(vm, lexicalGlobalObject, structure, module);
        exportValues.append(moduleValue);

        // Iterate module dict and add named exports for public symbols
        PyObject *key, *value;
        Py_ssize_t pos = 0;
        while (PyDict_Next(dict, &pos, &key, &value)) {
            if (!PyUnicode_Check(key))
                continue;

            const char* keyStr = PyUnicode_AsUTF8(key);
            if (!keyStr)
                continue;

            // Skip private attributes (single underscore) but allow dunder attributes
            if (keyStr[0] == '_') {
                // Check if it's a dunder attribute (starts with __ and ends with __)
                // These are useful: __version__, __name__, __file__, __doc__, __all__, etc.
                size_t len = strlen(keyStr);
                bool isDunder = len >= 4 && keyStr[1] == '_' && keyStr[len - 1] == '_' && keyStr[len - 2] == '_';
                if (!isDunder)
                    continue; // Skip single underscore private attributes
            }

            exportNames.append(Identifier::fromString(vm, String::fromUTF8(keyStr)));
            exportValues.append(Python::toJS(lexicalGlobalObject, value));
        }

        // Don't DECREF module here - the JSPyObject holds a reference
    };
}

SyntheticSourceProvider::SyntheticSourceGenerator
generatePythonBuiltinModuleSourceCode(JSGlobalObject* globalObject, const WTF::String& moduleName)
{
    return [moduleName = moduleName.isolatedCopy()](JSGlobalObject* lexicalGlobalObject,
               Identifier moduleKey,
               Vector<Identifier, 4>& exportNames,
               MarkedArgumentBuffer& exportValues) -> void {
        VM& vm = lexicalGlobalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);

        ensurePythonInitialized();
        ensureVenvPathAdded(lexicalGlobalObject);

        // Set the JavaScript global for this thread so Python can import JS modules
        setThreadJSGlobal(lexicalGlobalObject);

        // Strip "python:" prefix to get the actual Python module name
        WTF::String pythonModuleName = moduleName;
        if (moduleName.startsWith("python:"_s)) {
            pythonModuleName = moduleName.substring(7);
        }

        // Convert slashes to dots for Python submodule notation
        // e.g., "matplotlib/pyplot" -> "matplotlib.pyplot"
        // Dots in the original name are left as-is (valid in package names)
        auto moduleNameUTF8 = pythonModuleName.utf8();
        const char* moduleNameToImport = moduleNameUTF8.data();
        char convertedBuffer[512];

        // Check if we need to convert slashes
        if (pythonModuleName.contains('/') && moduleNameUTF8.length() < sizeof(convertedBuffer) - 1) {
            for (size_t i = 0; i < moduleNameUTF8.length(); i++) {
                char c = moduleNameUTF8.data()[i];
                convertedBuffer[i] = (c == '/') ? '.' : c;
            }
            convertedBuffer[moduleNameUTF8.length()] = '\0';
            moduleNameToImport = convertedBuffer;
        }

        // Import the Python builtin module
        PyObject* module = PyImport_ImportModule(moduleNameToImport);

        if (!module) {
            PyErr_Print();
            PyErr_Clear();
            throwTypeError(lexicalGlobalObject, scope, makeString("Cannot import Python module: "_s, moduleName));
            return;
        }

        // Get module dict (borrowed reference)
        PyObject* dict = PyModule_GetDict(module);

        // Create the module object as default export
        auto* zigGlobalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
        Structure* structure = zigGlobalObject->m_JSPyObjectStructure.get();
        if (!structure) {
            structure = JSPyObject::createStructure(vm, lexicalGlobalObject, lexicalGlobalObject->objectPrototype());
            zigGlobalObject->m_JSPyObjectStructure.set(vm, zigGlobalObject, structure);
        }

        // Add default export - the module itself
        exportNames.append(vm.propertyNames->defaultKeyword);
        JSPyObject* moduleValue = JSPyObject::create(vm, lexicalGlobalObject, structure, module);
        exportValues.append(moduleValue);

        // Iterate module dict and add named exports for public symbols
        PyObject *key, *value;
        Py_ssize_t pos = 0;
        while (PyDict_Next(dict, &pos, &key, &value)) {
            if (!PyUnicode_Check(key))
                continue;

            const char* keyStr = PyUnicode_AsUTF8(key);
            if (!keyStr)
                continue;

            // Skip private attributes (single underscore) but allow dunder attributes
            if (keyStr[0] == '_') {
                // Check if it's a dunder attribute (starts with __ and ends with __)
                // These are useful: __version__, __name__, __file__, __doc__, __all__, etc.
                size_t len = strlen(keyStr);
                bool isDunder = len >= 4 && keyStr[1] == '_' && keyStr[len - 1] == '_' && keyStr[len - 2] == '_';
                if (!isDunder)
                    continue; // Skip single underscore private attributes
            }

            exportNames.append(Identifier::fromString(vm, String::fromUTF8(keyStr)));
            exportValues.append(Python::toJS(lexicalGlobalObject, value));
        }

        // Don't DECREF module here - the JSPyObject holds a reference
    };
}

} // namespace Bun::Python
