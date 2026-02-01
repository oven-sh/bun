#include "root.h"
#include "PyJSValueObject.h"
#include "Python.h"
#include "BunPython.h"
#include "JSPyObject.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSPromise.h>

namespace Bun {

using namespace JSC;

// =============================================================================
// PyFutureCallback - Python callable that resolves/rejects a Python Future
// Used for JS Promise -> Python await bridging
// =============================================================================

struct PyFutureCallback {
    PyObject_HEAD PyObject* future; // The asyncio.Future to resolve/reject
    bool isReject; // true = set_exception, false = set_result
};

static void PyFutureCallback_dealloc(PyFutureCallback* self)
{
    Py_XDECREF(self->future);
    Py_TYPE(self)->tp_free(reinterpret_cast<PyObject*>(self));
}

static PyObject* PyFutureCallback_call(PyFutureCallback* self, PyObject* args, PyObject* kwargs)
{
    if (!self->future) {
        Py_RETURN_NONE;
    }

    // Check if future is already done (cancelled, etc.)
    PyObject* doneMethod = PyObject_GetAttrString(self->future, "done");
    if (doneMethod) {
        PyObject* done = PyObject_CallNoArgs(doneMethod);
        Py_DECREF(doneMethod);
        if (done && PyObject_IsTrue(done)) {
            Py_DECREF(done);
            Py_RETURN_NONE;
        }
        Py_XDECREF(done);
    }
    PyErr_Clear();

    // Get the value argument
    PyObject* value = Py_None;
    if (PyTuple_Size(args) > 0) {
        value = PyTuple_GetItem(args, 0);
    }

    if (self->isReject) {
        // Convert the JS error to a Python exception
        // Create a RuntimeError with the error message
        PyObject* excType = PyExc_RuntimeError;
        PyObject* excValue = nullptr;

        if (PyUnicode_Check(value)) {
            excValue = value;
            Py_INCREF(excValue);
        } else {
            // Get string representation
            excValue = PyObject_Str(value);
            if (!excValue) {
                PyErr_Clear();
                excValue = PyUnicode_FromString("Unknown JavaScript error");
            }
        }

        // Create an exception instance
        PyObject* exception = PyObject_CallOneArg(excType, excValue);
        Py_DECREF(excValue);

        if (exception) {
            PyObject* setException = PyObject_GetAttrString(self->future, "set_exception");
            if (setException) {
                PyObject* result = PyObject_CallOneArg(setException, exception);
                Py_XDECREF(result);
                Py_DECREF(setException);
            }
            Py_DECREF(exception);
        }
        PyErr_Clear();
    } else {
        // Resolve with the value
        PyObject* setResult = PyObject_GetAttrString(self->future, "set_result");
        if (setResult) {
            PyObject* result = PyObject_CallOneArg(setResult, value);
            Py_XDECREF(result);
            Py_DECREF(setResult);
        }
        PyErr_Clear();
    }

    Py_RETURN_NONE;
}

static PyTypeObject PyFutureCallback_Type = {
    .ob_base = PyVarObject_HEAD_INIT(nullptr, 0)
        .tp_name
    = "_bun.FutureCallback",
    .tp_basicsize = sizeof(PyFutureCallback),
    .tp_itemsize = 0,
    .tp_dealloc = reinterpret_cast<destructor>(PyFutureCallback_dealloc),
    .tp_call = reinterpret_cast<ternaryfunc>(PyFutureCallback_call),
    .tp_flags = Py_TPFLAGS_DEFAULT,
    .tp_doc = "Resolves/rejects a Python Future when called from JavaScript",
};

static bool g_futureCallbackTypeReady = false;

static PyFutureCallback* createFutureCallback(PyObject* future, bool isReject)
{
    if (!g_futureCallbackTypeReady) {
        if (PyType_Ready(&PyFutureCallback_Type) < 0) {
            return nullptr;
        }
        g_futureCallbackTypeReady = true;
    }

    PyFutureCallback* callback = PyObject_New(PyFutureCallback, &PyFutureCallback_Type);
    if (!callback) {
        return nullptr;
    }

    Py_INCREF(future);
    callback->future = future;
    callback->isReject = isReject;
    return callback;
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

// ============================================================================
// PyJSValueObject - Base wrapper for functions and other non-container types
// ============================================================================

static void pyjsvalue_dealloc(PyObject* self);
static PyObject* pyjsvalue_repr(PyObject* self);
static PyObject* pyjsvalue_getattro(PyObject* self, PyObject* name);
static int pyjsvalue_setattro(PyObject* self, PyObject* name, PyObject* value);
static PyObject* pyjsvalue_call(PyObject* self, PyObject* args, PyObject* kwargs);
static PyObject* pyjsvalue_subscript(PyObject* self, PyObject* key);
static int pyjsvalue_ass_subscript(PyObject* self, PyObject* key, PyObject* value);
static PyObject* pyjsvalue_await(PyObject* self);

// am_await implementation - allows Python to await JS Promises
static PyObject* pyjsvalue_await(PyObject* self)
{
    PyJSValueObject* wrapper = reinterpret_cast<PyJSValueObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // Check if this is a Promise
    JSPromise* promise = jsDynamicCast<JSPromise*>(wrapper->jsValue);
    if (!promise) {
        PyErr_SetString(PyExc_TypeError, "object is not awaitable (not a Promise)");
        return nullptr;
    }

    // Import asyncio and get the running loop
    PyObject* asyncio = PyImport_ImportModule("asyncio");
    if (!asyncio) {
        PyErr_SetString(PyExc_RuntimeError, "Failed to import asyncio");
        return nullptr;
    }

    PyObject* getRunningLoop = PyObject_GetAttrString(asyncio, "get_running_loop");
    if (!getRunningLoop) {
        Py_DECREF(asyncio);
        PyErr_SetString(PyExc_RuntimeError, "Failed to get get_running_loop");
        return nullptr;
    }

    PyObject* loop = PyObject_CallNoArgs(getRunningLoop);
    Py_DECREF(getRunningLoop);

    if (!loop) {
        Py_DECREF(asyncio);
        PyErr_SetString(PyExc_RuntimeError, "No running event loop");
        return nullptr;
    }

    // Create a Future: loop.create_future()
    PyObject* createFuture = PyObject_GetAttrString(loop, "create_future");
    if (!createFuture) {
        Py_DECREF(loop);
        Py_DECREF(asyncio);
        PyErr_SetString(PyExc_RuntimeError, "Failed to get create_future");
        return nullptr;
    }

    PyObject* future = PyObject_CallNoArgs(createFuture);
    Py_DECREF(createFuture);

    if (!future) {
        Py_DECREF(loop);
        Py_DECREF(asyncio);
        PyErr_SetString(PyExc_RuntimeError, "Failed to create future");
        return nullptr;
    }

    // Create resolve and reject callbacks
    PyFutureCallback* resolver = createFutureCallback(future, false);
    PyFutureCallback* rejecter = createFutureCallback(future, true);

    if (!resolver || !rejecter) {
        Py_XDECREF(reinterpret_cast<PyObject*>(resolver));
        Py_XDECREF(reinterpret_cast<PyObject*>(rejecter));
        Py_DECREF(future);
        Py_DECREF(loop);
        Py_DECREF(asyncio);
        PyErr_SetString(PyExc_RuntimeError, "Failed to create callbacks");
        return nullptr;
    }

    // Wrap the Python callbacks as JSPyObjects so JS can call them
    Structure* structure = getJSPyObjectStructure(globalObject);
    JSPyObject* jsResolver = JSPyObject::create(vm, globalObject, structure, reinterpret_cast<PyObject*>(resolver));
    JSPyObject* jsRejecter = JSPyObject::create(vm, globalObject, structure, reinterpret_cast<PyObject*>(rejecter));

    // We can release Python references now - JSPyObject holds them
    Py_DECREF(reinterpret_cast<PyObject*>(resolver));
    Py_DECREF(reinterpret_cast<PyObject*>(rejecter));

    // Call promise.then(resolver, rejecter)
    // Get the 'then' method from the promise
    JSValue thenMethod = promise->get(globalObject, Identifier::fromString(vm, "then"_s));
    if (scope.exception()) {
        scope.clearException();
        Py_DECREF(future);
        Py_DECREF(loop);
        Py_DECREF(asyncio);
        PyErr_SetString(PyExc_RuntimeError, "Failed to get Promise.then");
        return nullptr;
    }

    auto callData = JSC::getCallData(thenMethod);
    if (callData.type == CallData::Type::None) {
        Py_DECREF(future);
        Py_DECREF(loop);
        Py_DECREF(asyncio);
        PyErr_SetString(PyExc_RuntimeError, "Promise.then is not callable");
        return nullptr;
    }

    MarkedArgumentBuffer thenArgs;
    thenArgs.append(jsResolver);
    thenArgs.append(jsRejecter);

    JSC::profiledCall(globalObject, ProfilingReason::API, thenMethod, callData, promise, thenArgs);

    if (scope.exception()) {
        scope.clearException();
        Py_DECREF(future);
        Py_DECREF(loop);
        Py_DECREF(asyncio);
        PyErr_SetString(PyExc_RuntimeError, "Failed to attach Promise handlers");
        return nullptr;
    }

    Py_DECREF(loop);
    Py_DECREF(asyncio);

    // Return future.__await__() which is the iterator Python expects
    PyObject* awaitMethod = PyObject_GetAttrString(future, "__await__");
    if (!awaitMethod) {
        Py_DECREF(future);
        PyErr_SetString(PyExc_RuntimeError, "Future has no __await__ method");
        return nullptr;
    }

    PyObject* awaiter = PyObject_CallNoArgs(awaitMethod);
    Py_DECREF(awaitMethod);
    Py_DECREF(future);

    return awaiter;
}

// am_aiter implementation - allows Python to use 'async for' on JS async iterators
static PyObject* pyjsvalue_aiter(PyObject* self)
{
    PyJSValueObject* wrapper = reinterpret_cast<PyJSValueObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSValue jsValue = wrapper->jsValue;

    if (!jsValue.isObject()) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an async iterable");
        return nullptr;
    }

    JSObject* jsObj = jsValue.getObject();

    // Check if it's already an async iterator (has a 'next' method that returns promises)
    JSValue nextMethod = jsObj->get(globalObject, Identifier::fromString(vm, "next"_s));
    if (scope.exception()) {
        scope.clearException();
    } else if (nextMethod.isCallable()) {
        // It's already an async iterator, return self
        Py_INCREF(self);
        return self;
    }

    // Try to get Symbol.asyncIterator
    JSValue asyncIteratorMethod = jsObj->get(globalObject, vm.propertyNames->asyncIteratorSymbol);
    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_TypeError, "JavaScript object is not an async iterable");
        return nullptr;
    }

    if (asyncIteratorMethod.isCallable()) {
        // Call [Symbol.asyncIterator]() to get the async iterator
        auto callData = JSC::getCallData(asyncIteratorMethod);
        MarkedArgumentBuffer args;
        JSValue iterator = JSC::profiledCall(globalObject, ProfilingReason::API, asyncIteratorMethod, callData, jsObj, args);

        if (scope.exception()) {
            scope.clearException();
            PyErr_SetString(PyExc_RuntimeError, "Error calling Symbol.asyncIterator");
            return nullptr;
        }

        // Wrap the iterator and return it
        return Python::fromJS(globalObject, iterator);
    }

    PyErr_SetString(PyExc_TypeError, "JavaScript object is not an async iterable");
    return nullptr;
}

// am_anext implementation - returns an awaitable for the next value
static PyObject* pyjsvalue_anext(PyObject* self)
{
    PyJSValueObject* wrapper = reinterpret_cast<PyJSValueObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSValue jsValue = wrapper->jsValue;

    if (!jsValue.isObject()) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an async iterator");
        return nullptr;
    }

    JSObject* jsObj = jsValue.getObject();

    // Get the 'next' method
    JSValue nextMethod = jsObj->get(globalObject, Identifier::fromString(vm, "next"_s));
    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_TypeError, "JavaScript async iterator has no 'next' method");
        return nullptr;
    }

    if (!nextMethod.isCallable()) {
        PyErr_SetString(PyExc_TypeError, "JavaScript async iterator 'next' is not callable");
        return nullptr;
    }

    // Call next() - returns a Promise
    auto callData = JSC::getCallData(nextMethod);
    MarkedArgumentBuffer args;
    JSValue promiseValue = JSC::profiledCall(globalObject, ProfilingReason::API, nextMethod, callData, jsObj, args);

    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_RuntimeError, "Error calling async iterator.next()");
        return nullptr;
    }

    // The result should be a Promise that resolves to {value, done}
    // We need to create an awaitable that:
    // 1. Awaits the promise
    // 2. Checks if done is true -> raise StopAsyncIteration
    // 3. Otherwise returns value

    // Create a wrapper coroutine in Python to handle the async iteration logic
    // We'll use Python code to handle this cleanly
    PyObject* asyncioModule = PyImport_ImportModule("asyncio");
    if (!asyncioModule) {
        PyErr_SetString(PyExc_RuntimeError, "Failed to import asyncio");
        return nullptr;
    }

    // Get the wrapped Promise
    PyObject* pyPromise = Python::fromJS(globalObject, promiseValue);
    if (!pyPromise) {
        Py_DECREF(asyncioModule);
        return nullptr;
    }

    // Create a coroutine that awaits the promise and handles {value, done}
    // We use Python code defined in the event loop setup
    PyObject* mainModule = PyImport_AddModule("__main__");
    if (!mainModule) {
        Py_DECREF(pyPromise);
        Py_DECREF(asyncioModule);
        PyErr_SetString(PyExc_RuntimeError, "Failed to get __main__ module");
        return nullptr;
    }

    PyObject* mainDict = PyModule_GetDict(mainModule);
    PyObject* anextHelper = PyDict_GetItemString(mainDict, "_js_anext_helper");

    if (!anextHelper) {
        // Define the helper function if it doesn't exist
        const char* helperCode = R"(
async def _js_anext_helper(promise):
    result = await promise
    if result.done:
        raise StopAsyncIteration
    return result.value
)";
        PyObject* result = PyRun_String(helperCode, Py_file_input, mainDict, mainDict);
        if (!result) {
            Py_DECREF(pyPromise);
            Py_DECREF(asyncioModule);
            PyErr_Print();
            PyErr_SetString(PyExc_RuntimeError, "Failed to define _js_anext_helper");
            return nullptr;
        }
        Py_DECREF(result);
        anextHelper = PyDict_GetItemString(mainDict, "_js_anext_helper");
    }

    if (!anextHelper) {
        Py_DECREF(pyPromise);
        Py_DECREF(asyncioModule);
        PyErr_SetString(PyExc_RuntimeError, "Failed to get _js_anext_helper");
        return nullptr;
    }

    // Call _js_anext_helper(promise) to get a coroutine
    PyObject* coro = PyObject_CallOneArg(anextHelper, pyPromise);
    Py_DECREF(pyPromise);
    Py_DECREF(asyncioModule);

    if (!coro) {
        return nullptr;
    }

    return coro;
}

static PyMappingMethods PyJSValue_as_mapping = {
    nullptr,
    pyjsvalue_subscript,
    pyjsvalue_ass_subscript,
};

static PyAsyncMethods PyJSValue_as_async = {
    pyjsvalue_await, // am_await
    pyjsvalue_aiter, // am_aiter
    pyjsvalue_anext, // am_anext
    nullptr, // am_send (Python 3.10+)
};

// ============================================================================
// PyJSBoundMethod - Preserves 'this' context when calling JS methods
// ============================================================================

static void pyjsboundmethod_dealloc(PyObject* self);
static PyObject* pyjsboundmethod_repr(PyObject* self);
static PyObject* pyjsboundmethod_call(PyObject* self, PyObject* args, PyObject* kwargs);

static PyTypeObject PyJSBoundMethod_Type = {
    PyVarObject_HEAD_INIT(NULL, 0) "bun.JSBoundMethod",
    sizeof(PyJSBoundMethod),
    0,
    pyjsboundmethod_dealloc,
    0,
    nullptr,
    nullptr,
    nullptr,
    pyjsboundmethod_repr,
    nullptr,
    nullptr,
    nullptr,
    nullptr,
    pyjsboundmethod_call,
    nullptr,
    nullptr,
    nullptr,
    nullptr,
    Py_TPFLAGS_DEFAULT,
    "JavaScript bound method wrapper",
};

static bool g_boundMethodTypeReady = false;

PyJSBoundMethod* PyJSBoundMethod::New(JSGlobalObject* globalObject, JSValue function, JSValue thisObject)
{
    if (!g_boundMethodTypeReady) {
        if (PyType_Ready(&PyJSBoundMethod_Type) < 0) {
            return nullptr;
        }
        g_boundMethodTypeReady = true;
    }

    PyJSBoundMethod* method = PyObject_New(PyJSBoundMethod, &PyJSBoundMethod_Type);
    if (!method) {
        return nullptr;
    }

    method->function = function;
    method->thisObject = thisObject;
    method->globalObject = globalObject;

    // Protect both from GC
    if (function.isCell()) {
        gcProtect(function.asCell());
    }
    if (thisObject.isCell()) {
        gcProtect(thisObject.asCell());
    }

    return method;
}

void PyJSBoundMethod::initType()
{
    if (!g_boundMethodTypeReady) {
        if (PyType_Ready(&PyJSBoundMethod_Type) < 0) {
            PyErr_Print();
        }
        g_boundMethodTypeReady = true;
    }
}

static void pyjsboundmethod_dealloc(PyObject* self)
{
    PyJSBoundMethod* method = reinterpret_cast<PyJSBoundMethod*>(self);

    if (method->function.isCell()) {
        gcUnprotect(method->function.asCell());
    }
    if (method->thisObject.isCell()) {
        gcUnprotect(method->thisObject.asCell());
    }

    Py_TYPE(self)->tp_free(self);
}

static PyObject* pyjsboundmethod_repr(PyObject* self)
{
    PyJSBoundMethod* method = reinterpret_cast<PyJSBoundMethod*>(self);
    JSGlobalObject* globalObject = method->globalObject;

    if (!globalObject) {
        return PyUnicode_FromString("<bound JSMethod>");
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // Try to get the function name
    JSObject* funcObj = method->function.getObject();
    if (funcObj) {
        JSValue nameVal = funcObj->get(globalObject, Identifier::fromString(vm, "name"_s));
        if (!scope.exception() && nameVal.isString()) {
            auto name = nameVal.toWTFString(globalObject);
            auto utf8 = name.utf8();
            return PyUnicode_FromFormat("<bound JSMethod %s>", utf8.data());
        }
        scope.clearException();
    }

    return PyUnicode_FromString("<bound JSMethod>");
}

static PyObject* pyjsboundmethod_call(PyObject* self, PyObject* args, PyObject* kwargs)
{
    PyJSBoundMethod* method = reinterpret_cast<PyJSBoundMethod*>(self);
    JSGlobalObject* globalObject = method->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSValue calleeValue = method->function;

    Py_ssize_t argc = PyTuple_Size(args);
    MarkedArgumentBuffer jsArgs;

    for (Py_ssize_t i = 0; i < argc; i++) {
        PyObject* arg = PyTuple_GetItem(args, i);
        jsArgs.append(Python::toJS(globalObject, arg));
    }

    JSValue result;

    // Get call and construct data
    auto callData = JSC::getCallData(calleeValue);
    auto constructData = JSC::getConstructData(calleeValue);

    // Determine if we should use 'new' semantics:
    // 1. ES6 class - callData.js.functionExecutable->isClassConstructorFunction() is true
    // 2. Native constructor - callData is Native type AND constructData is non-None
    //    (Native constructors that are not callable have a call handler that throws)
    // 3. Not callable at all but constructable
    bool useConstruct = false;

    if (callData.type == CallData::Type::None) {
        // Not callable - must be construct-only
        if (constructData.type != CallData::Type::None) {
            useConstruct = true;
        } else {
            PyErr_SetString(PyExc_TypeError, "JavaScript value is not callable");
            return nullptr;
        }
    } else if (callData.type == CallData::Type::JS && callData.js.functionExecutable) {
        // JS function - check if it's an ES6 class constructor
        useConstruct = callData.js.functionExecutable->isClassConstructorFunction();
    } else if (callData.type == CallData::Type::Native && constructData.type != CallData::Type::None) {
        // Native function that is also constructable - prefer construct
        // This handles Bun classes like Glob, File, etc. that require 'new'
        useConstruct = true;
    }

    if (useConstruct) {
        // Use 'new' semantics
        result = JSC::profiledConstruct(globalObject, ProfilingReason::API, calleeValue, constructData, jsArgs);
    } else {
        // Regular function call - use the stored thisObject
        result = JSC::profiledCall(globalObject, ProfilingReason::API, calleeValue, callData, method->thisObject, jsArgs);
    }

    if (scope.exception()) {
        JSValue exception = scope.exception()->value();
        scope.clearException();

        if (exception.isObject()) {
            JSObject* errObj = exception.getObject();
            JSValue msgVal = errObj->get(globalObject, Identifier::fromString(vm, "message"_s));
            if (msgVal.isString()) {
                auto msg = msgVal.toWTFString(globalObject);
                PyErr_Format(PyExc_RuntimeError, "JavaScript error: %s", msg.utf8().data());
                return nullptr;
            }
        }
        PyErr_SetString(PyExc_RuntimeError, "JavaScript error during call");
        return nullptr;
    }

    return Python::fromJS(globalObject, result);
}

// Iterator support for JS iterators/generators
static PyObject* pyjsvalue_iter(PyObject* self)
{
    PyJSValueObject* wrapper = reinterpret_cast<PyJSValueObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSValue jsValue = wrapper->jsValue;

    // Check if it's already an iterator (has a 'next' method)
    if (jsValue.isObject()) {
        JSObject* jsObj = jsValue.getObject();
        JSValue nextMethod = jsObj->get(globalObject, Identifier::fromString(vm, "next"_s));
        if (scope.exception()) {
            scope.clearException();
        } else if (nextMethod.isCallable()) {
            // It's already an iterator, return self
            Py_INCREF(self);
            return self;
        }
    }

    // Try to get Symbol.iterator to make it iterable
    if (jsValue.isObject()) {
        JSObject* jsObj = jsValue.getObject();
        JSValue iteratorMethod = jsObj->get(globalObject, vm.propertyNames->iteratorSymbol);
        if (scope.exception()) {
            scope.clearException();
            PyErr_SetString(PyExc_TypeError, "JavaScript object is not iterable");
            return nullptr;
        }

        if (iteratorMethod.isCallable()) {
            // Call [Symbol.iterator]() to get the iterator
            auto callData = JSC::getCallData(iteratorMethod);
            MarkedArgumentBuffer args;
            JSValue iterator = JSC::profiledCall(globalObject, ProfilingReason::API, iteratorMethod, callData, jsObj, args);

            if (scope.exception()) {
                scope.clearException();
                PyErr_SetString(PyExc_RuntimeError, "Error calling Symbol.iterator");
                return nullptr;
            }

            // Wrap the iterator and return it
            return Python::fromJS(globalObject, iterator);
        }
    }

    PyErr_SetString(PyExc_TypeError, "JavaScript object is not iterable");
    return nullptr;
}

static PyObject* pyjsvalue_iternext(PyObject* self)
{
    PyJSValueObject* wrapper = reinterpret_cast<PyJSValueObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSValue jsValue = wrapper->jsValue;

    if (!jsValue.isObject()) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an iterator");
        return nullptr;
    }

    JSObject* jsObj = jsValue.getObject();

    // Get the 'next' method
    JSValue nextMethod = jsObj->get(globalObject, Identifier::fromString(vm, "next"_s));
    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_TypeError, "JavaScript iterator has no 'next' method");
        return nullptr;
    }

    if (!nextMethod.isCallable()) {
        PyErr_SetString(PyExc_TypeError, "JavaScript iterator 'next' is not callable");
        return nullptr;
    }

    // Call next()
    auto callData = JSC::getCallData(nextMethod);
    MarkedArgumentBuffer args;
    JSValue result = JSC::profiledCall(globalObject, ProfilingReason::API, nextMethod, callData, jsObj, args);

    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_RuntimeError, "Error calling iterator.next()");
        return nullptr;
    }

    // Result should be {value, done}
    if (!result.isObject()) {
        PyErr_SetString(PyExc_TypeError, "Iterator next() did not return an object");
        return nullptr;
    }

    JSObject* resultObj = result.getObject();

    // Check 'done' property
    JSValue doneValue = resultObj->get(globalObject, Identifier::fromString(vm, "done"_s));
    if (scope.exception()) {
        scope.clearException();
    }

    if (doneValue.toBoolean(globalObject)) {
        // Iterator exhausted - signal StopIteration by returning NULL without setting error
        PyErr_SetNone(PyExc_StopIteration);
        return nullptr;
    }

    // Get 'value' property
    JSValue valueValue = resultObj->get(globalObject, Identifier::fromString(vm, "value"_s));
    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_RuntimeError, "Error getting iterator value");
        return nullptr;
    }

    return Python::fromJS(globalObject, valueValue);
}

static PyTypeObject PyJSValue_Type = {
    PyVarObject_HEAD_INIT(NULL, 0) "bun.JSValue", // tp_name
    sizeof(PyJSValueObject), // tp_basicsize
    0, // tp_itemsize
    pyjsvalue_dealloc, // tp_dealloc
    0, // tp_vectorcall_offset
    nullptr, // tp_getattr
    nullptr, // tp_setattr
    &PyJSValue_as_async, // tp_as_async - makes JSValue awaitable
    pyjsvalue_repr, // tp_repr
    nullptr, // tp_as_number
    nullptr, // tp_as_sequence
    &PyJSValue_as_mapping, // tp_as_mapping
    nullptr, // tp_hash
    pyjsvalue_call, // tp_call
    nullptr, // tp_str
    pyjsvalue_getattro, // tp_getattro
    pyjsvalue_setattro, // tp_setattro
    nullptr, // tp_as_buffer
    Py_TPFLAGS_DEFAULT, // tp_flags
    "JavaScript value wrapper", // tp_doc
    nullptr, // tp_traverse
    nullptr, // tp_clear
    nullptr, // tp_richcompare
    0, // tp_weaklistoffset
    pyjsvalue_iter, // tp_iter
    pyjsvalue_iternext, // tp_iternext
};

// ============================================================================
// PyJSDictObject - Dict subclass for JS objects
// ============================================================================

static void pyjsdict_dealloc(PyObject* self);
static PyObject* pyjsdict_repr(PyObject* self);
static Py_ssize_t pyjsdict_length(PyObject* self);
static PyObject* pyjsdict_subscript(PyObject* self, PyObject* key);
static int pyjsdict_ass_subscript(PyObject* self, PyObject* key, PyObject* value);
static PyObject* pyjsdict_getattro(PyObject* self, PyObject* name);
static int pyjsdict_setattro(PyObject* self, PyObject* name, PyObject* value);
static PyObject* pyjsdict_iter(PyObject* self);
static int pyjsdict_contains(PyObject* self, PyObject* key);
static PyObject* pyjsdict_keys(PyObject* self, PyObject* args);
static PyObject* pyjsdict_values(PyObject* self, PyObject* args);
static PyObject* pyjsdict_items(PyObject* self, PyObject* args);
static PyObject* pyjsdict_get(PyObject* self, PyObject* args);
static PyObject* pyjsdict_pop(PyObject* self, PyObject* args);
static PyObject* pyjsdict_update(PyObject* self, PyObject* args);
static PyObject* pyjsdict_setdefault(PyObject* self, PyObject* args);
static PyObject* pyjsdict_clear(PyObject* self, PyObject* args);

static PyMethodDef pyjsdict_methods[] = {
    { "keys", pyjsdict_keys, METH_NOARGS, "Return keys" },
    { "values", pyjsdict_values, METH_NOARGS, "Return values" },
    { "items", pyjsdict_items, METH_NOARGS, "Return items" },
    { "get", pyjsdict_get, METH_VARARGS, "Get item with default" },
    { "pop", pyjsdict_pop, METH_VARARGS, "Remove key and return value" },
    { "update", pyjsdict_update, METH_O, "Update dict with key/value pairs" },
    { "setdefault", pyjsdict_setdefault, METH_VARARGS, "Set default value for key" },
    { "clear", pyjsdict_clear, METH_NOARGS, "Remove all items" },
    { nullptr, nullptr, 0, nullptr }
};

static PyMappingMethods PyJSDict_as_mapping = {
    pyjsdict_length,
    pyjsdict_subscript,
    pyjsdict_ass_subscript,
};

static PySequenceMethods PyJSDict_as_sequence = {
    nullptr, // sq_length
    nullptr, // sq_concat
    nullptr, // sq_repeat
    nullptr, // sq_item
    nullptr, // was_sq_slice
    nullptr, // sq_ass_item
    nullptr, // was_sq_ass_slice
    pyjsdict_contains, // sq_contains
    nullptr, // sq_inplace_concat
    nullptr, // sq_inplace_repeat
};

static PyTypeObject PyJSDict_Type = {
    PyVarObject_HEAD_INIT(NULL, 0) "bun.JSObject",
    sizeof(PyJSDictObject),
    0,
    pyjsdict_dealloc, // tp_dealloc
    0, // tp_vectorcall_offset
    nullptr, // tp_getattr
    nullptr, // tp_setattr
    nullptr, // tp_as_async
    pyjsdict_repr, // tp_repr
    nullptr, // tp_as_number
    &PyJSDict_as_sequence, // tp_as_sequence
    &PyJSDict_as_mapping, // tp_as_mapping
    nullptr, // tp_hash
    nullptr, // tp_call
    nullptr, // tp_str
    pyjsdict_getattro, // tp_getattro
    pyjsdict_setattro, // tp_setattro
    nullptr, // tp_as_buffer
    Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE, // tp_flags
    "JavaScript object wrapper (dict-like)", // tp_doc
    nullptr, // tp_traverse
    nullptr, // tp_clear
    nullptr, // tp_richcompare
    0, // tp_weaklistoffset
    pyjsdict_iter, // tp_iter
    nullptr, // tp_iternext
    pyjsdict_methods, // tp_methods
    nullptr, // tp_members
    nullptr, // tp_getset
    &PyDict_Type, // tp_base - INHERIT FROM DICT
};

// ============================================================================
// PyJSListObject - List subclass for JS arrays
// ============================================================================

static void pyjslist_dealloc(PyObject* self);
static PyObject* pyjslist_repr(PyObject* self);
static Py_ssize_t pyjslist_length(PyObject* self);
static PyObject* pyjslist_item(PyObject* self, Py_ssize_t index);
static int pyjslist_ass_item(PyObject* self, Py_ssize_t index, PyObject* value);
static PyObject* pyjslist_subscript(PyObject* self, PyObject* key);
static int pyjslist_ass_subscript(PyObject* self, PyObject* key, PyObject* value);
static PyObject* pyjslist_iter(PyObject* self);
static int pyjslist_contains(PyObject* self, PyObject* value);

// List methods
static PyObject* pyjslist_append(PyObject* self, PyObject* value);
static PyObject* pyjslist_pop(PyObject* self, PyObject* args);
static PyObject* pyjslist_insert(PyObject* self, PyObject* args);
static PyObject* pyjslist_extend(PyObject* self, PyObject* iterable);
static PyObject* pyjslist_clear(PyObject* self, PyObject* args);
static PyObject* pyjslist_reverse(PyObject* self, PyObject* args);

static PyMethodDef pyjslist_methods[] = {
    { "append", pyjslist_append, METH_O, "Append object to the end of the list" },
    { "pop", pyjslist_pop, METH_VARARGS, "Remove and return item at index (default last)" },
    { "insert", pyjslist_insert, METH_VARARGS, "Insert object before index" },
    { "extend", pyjslist_extend, METH_O, "Extend list by appending elements from the iterable" },
    { "clear", pyjslist_clear, METH_NOARGS, "Remove all items from list" },
    { "reverse", pyjslist_reverse, METH_NOARGS, "Reverse list in place" },
    { nullptr, nullptr, 0, nullptr }
};

static PySequenceMethods PyJSList_as_sequence = {
    pyjslist_length, // sq_length
    nullptr, // sq_concat
    nullptr, // sq_repeat
    pyjslist_item, // sq_item
    nullptr, // was_sq_slice
    pyjslist_ass_item, // sq_ass_item
    nullptr, // was_sq_ass_slice
    pyjslist_contains, // sq_contains
    nullptr, // sq_inplace_concat
    nullptr, // sq_inplace_repeat
};

static PyMappingMethods PyJSList_as_mapping = {
    pyjslist_length,
    pyjslist_subscript,
    pyjslist_ass_subscript,
};

static PyTypeObject PyJSList_Type = {
    PyVarObject_HEAD_INIT(NULL, 0) "bun.JSArray",
    sizeof(PyJSListObject),
    0,
    pyjslist_dealloc, // tp_dealloc
    0, // tp_vectorcall_offset
    nullptr, // tp_getattr
    nullptr, // tp_setattr
    nullptr, // tp_as_async
    pyjslist_repr, // tp_repr
    nullptr, // tp_as_number
    &PyJSList_as_sequence, // tp_as_sequence
    &PyJSList_as_mapping, // tp_as_mapping
    nullptr, // tp_hash
    nullptr, // tp_call
    nullptr, // tp_str
    PyObject_GenericGetAttr, // tp_getattro
    nullptr, // tp_setattro
    nullptr, // tp_as_buffer
    Py_TPFLAGS_DEFAULT | Py_TPFLAGS_BASETYPE, // tp_flags
    "JavaScript array wrapper (list-like)", // tp_doc
    nullptr, // tp_traverse
    nullptr, // tp_clear
    nullptr, // tp_richcompare
    0, // tp_weaklistoffset
    pyjslist_iter, // tp_iter
    nullptr, // tp_iternext
    pyjslist_methods, // tp_methods
    nullptr, // tp_members
    nullptr, // tp_getset
    &PyList_Type, // tp_base - INHERIT FROM LIST
};

// ============================================================================
// Type initialization
// ============================================================================

void PyJSValueObject::initType()
{
    if (PyType_Ready(&PyJSValue_Type) < 0) {
        PyErr_Print();
    }
    if (PyType_Ready(&PyJSDict_Type) < 0) {
        PyErr_Print();
    }
    if (PyType_Ready(&PyJSList_Type) < 0) {
        PyErr_Print();
    }
    PyJSBoundMethod::initType();
}

PyJSValueObject* PyJSValueObject::New()
{
    return PyObject_New(PyJSValueObject, &PyJSValue_Type);
}

PyJSValueObject* PyJSValueObject::NewDict(JSGlobalObject* globalObject, JSValue value)
{
    // Use GC_New since we inherit from dict (which is GC-tracked)
    PyJSDictObject* wrapper = PyObject_GC_New(PyJSDictObject, &PyJSDict_Type);
    if (!wrapper) {
        return nullptr;
    }

    // Initialize dict internal fields - we don't use them but they must be valid
    wrapper->dict.ma_used = 0;
    wrapper->dict.ma_keys = nullptr;
    wrapper->dict.ma_values = nullptr;

    wrapper->jsValue = value;
    wrapper->globalObject = globalObject;

    if (value.isCell()) {
        gcProtect(value.asCell());
    }

    // Untrack from Python's cyclic GC - we manage JS references via gcProtect
    PyObject_GC_UnTrack(wrapper);

    return reinterpret_cast<PyJSValueObject*>(wrapper);
}

PyJSValueObject* PyJSValueObject::NewList(JSGlobalObject* globalObject, JSValue value)
{
    // Use GC_New since we inherit from list (which is GC-tracked)
    PyJSListObject* wrapper = PyObject_GC_New(PyJSListObject, &PyJSList_Type);
    if (!wrapper) {
        return nullptr;
    }

    // Initialize list internal fields - we don't use them but they must be valid
    wrapper->list.ob_item = nullptr;
    wrapper->list.allocated = 0;
    Py_SET_SIZE(reinterpret_cast<PyObject*>(&wrapper->list), 0);

    wrapper->jsValue = value;
    wrapper->globalObject = globalObject;

    if (value.isCell()) {
        gcProtect(value.asCell());
    }

    // Untrack from Python's cyclic GC - we manage JS references via gcProtect
    PyObject_GC_UnTrack(wrapper);

    return reinterpret_cast<PyJSValueObject*>(wrapper);
}

// Try to unwrap a PyObject that wraps a JSValue back to the underlying JSValue
// Returns empty JSValue if the object is not a PyJSValueObject, PyJSDictObject, or PyJSListObject
JSValue tryUnwrapJSValue(PyObject* obj)
{
    if (!obj) {
        return JSValue();
    }

    PyTypeObject* type = Py_TYPE(obj);

    // Check for PyJSValueObject
    if (type == &PyJSValue_Type) {
        PyJSValueObject* wrapper = reinterpret_cast<PyJSValueObject*>(obj);
        return wrapper->jsValue;
    }

    // Check for PyJSDictObject
    if (type == &PyJSDict_Type) {
        PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(obj);
        return wrapper->jsValue;
    }

    // Check for PyJSListObject
    if (type == &PyJSList_Type) {
        PyJSListObject* wrapper = reinterpret_cast<PyJSListObject*>(obj);
        return wrapper->jsValue;
    }

    // Check for PyJSBoundMethod
    if (type == &PyJSBoundMethod_Type) {
        PyJSBoundMethod* wrapper = reinterpret_cast<PyJSBoundMethod*>(obj);
        return wrapper->function;
    }

    return JSValue();
}

// ============================================================================
// PyJSValueObject implementations
// ============================================================================

static void pyjsvalue_dealloc(PyObject* self)
{
    PyJSValueObject* wrapper = reinterpret_cast<PyJSValueObject*>(self);

    if (wrapper->jsValue.isCell()) {
        gcUnprotect(wrapper->jsValue.asCell());
    }

    Py_TYPE(self)->tp_free(self);
}

static PyObject* pyjsvalue_repr(PyObject* self)
{
    PyJSValueObject* wrapper = reinterpret_cast<PyJSValueObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        return PyUnicode_FromString("<JSValue: no global>");
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    auto str = wrapper->jsValue.toWTFString(globalObject);
    if (scope.exception()) {
        scope.clearException();
        return PyUnicode_FromString("<JSValue>");
    }

    auto utf8 = str.utf8();
    return PyUnicode_FromStringAndSize(utf8.data(), utf8.length());
}

static PyObject* pyjsvalue_getattro(PyObject* self, PyObject* name)
{
    PyJSValueObject* wrapper = reinterpret_cast<PyJSValueObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!PyUnicode_Check(name)) {
        PyErr_SetString(PyExc_TypeError, "attribute name must be string");
        return nullptr;
    }

    const char* attrName = PyUnicode_AsUTF8(name);
    if (!attrName) {
        return nullptr;
    }

    // For Python dunder attributes (__class__, __dict__, etc.), use generic lookup
    if (attrName[0] == '_' && attrName[1] == '_') {
        return PyObject_GenericGetAttr(self, name);
    }

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return nullptr;
    }

    Identifier ident = Identifier::fromString(vm, WTF::String::fromUTF8(attrName));

    // Check if property exists - raise AttributeError if not
    bool hasProperty = jsObj->hasProperty(globalObject, ident);
    if (scope.exception()) {
        scope.clearException();
    }

    if (!hasProperty) {
        PyErr_Format(PyExc_AttributeError, "'%.100s' object has no attribute '%.400s'",
            Py_TYPE(self)->tp_name, attrName);
        return nullptr;
    }

    JSValue result = jsObj->get(globalObject, ident);

    if (scope.exception()) {
        scope.clearException();
        PyErr_Format(PyExc_AttributeError, "Error accessing '%s'", attrName);
        return nullptr;
    }

    // If the result is callable, return a bound method to preserve 'this' context
    auto callData = JSC::getCallData(result);
    if (callData.type != CallData::Type::None) {
        return reinterpret_cast<PyObject*>(PyJSBoundMethod::New(globalObject, result, wrapper->jsValue));
    }

    return Python::fromJS(globalObject, result);
}

static int pyjsvalue_setattro(PyObject* self, PyObject* name, PyObject* value)
{
    PyJSValueObject* wrapper = reinterpret_cast<PyJSValueObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!PyUnicode_Check(name)) {
        PyErr_SetString(PyExc_TypeError, "attribute name must be string");
        return -1;
    }

    const char* attrName = PyUnicode_AsUTF8(name);
    if (!attrName) {
        return -1;
    }

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return -1;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return -1;
    }

    Identifier ident = Identifier::fromString(vm, WTF::String::fromUTF8(attrName));
    JSValue jsVal = Python::toJS(globalObject, value);

    jsObj->putDirect(vm, ident, jsVal);

    if (scope.exception()) {
        scope.clearException();
        PyErr_Format(PyExc_AttributeError, "Error setting '%s'", attrName);
        return -1;
    }

    return 0;
}

static PyObject* pyjsvalue_call(PyObject* self, PyObject* args, PyObject* kwargs)
{
    PyJSValueObject* wrapper = reinterpret_cast<PyJSValueObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSValue calleeValue = wrapper->jsValue;

    Py_ssize_t argc = PyTuple_Size(args);
    MarkedArgumentBuffer jsArgs;

    for (Py_ssize_t i = 0; i < argc; i++) {
        PyObject* arg = PyTuple_GetItem(args, i);
        jsArgs.append(Python::toJS(globalObject, arg));
    }

    JSValue result;

    // Get call and construct data
    auto callData = JSC::getCallData(calleeValue);
    auto constructData = JSC::getConstructData(calleeValue);

    // Determine if we should use 'new' semantics:
    // 1. ES6 class - callData.js.functionExecutable->isClassConstructorFunction() is true
    // 2. Native constructor - callData is Native type AND constructData is non-None
    //    (Native constructors that are not callable have a call handler that throws)
    // 3. Not callable at all but constructable
    bool useConstruct = false;

    if (callData.type == CallData::Type::None) {
        // Not callable - must be construct-only
        if (constructData.type != CallData::Type::None) {
            useConstruct = true;
        } else {
            PyErr_SetString(PyExc_TypeError, "JavaScript value is not callable");
            return nullptr;
        }
    } else if (callData.type == CallData::Type::JS && callData.js.functionExecutable) {
        // JS function - check if it's an ES6 class constructor
        useConstruct = callData.js.functionExecutable->isClassConstructorFunction();
    } else if (callData.type == CallData::Type::Native && constructData.type != CallData::Type::None) {
        // Native function that is also constructable - prefer construct
        // This handles Bun classes like Glob, File, etc. that require 'new'
        useConstruct = true;
    }

    if (useConstruct) {
        // Use 'new' semantics
        result = JSC::profiledConstruct(globalObject, ProfilingReason::API, calleeValue, constructData, jsArgs);
    } else {
        // Regular function call
        result = JSC::profiledCall(globalObject, ProfilingReason::API, calleeValue, callData, jsUndefined(), jsArgs);
    }

    if (scope.exception()) {
        JSValue exception = scope.exception()->value();
        scope.clearException();

        if (exception.isObject()) {
            JSObject* errObj = exception.getObject();
            JSValue msgVal = errObj->get(globalObject, Identifier::fromString(vm, "message"_s));
            if (msgVal.isString()) {
                auto msg = msgVal.toWTFString(globalObject);
                PyErr_Format(PyExc_RuntimeError, "JavaScript error: %s", msg.utf8().data());
                return nullptr;
            }
        }
        PyErr_SetString(PyExc_RuntimeError, "JavaScript error during call");
        return nullptr;
    }

    return Python::fromJS(globalObject, result);
}

static PyObject* pyjsvalue_subscript(PyObject* self, PyObject* key)
{
    PyJSValueObject* wrapper = reinterpret_cast<PyJSValueObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return nullptr;
    }

    JSValue result;

    if (PyLong_Check(key)) {
        long index = PyLong_AsLong(key);
        if (index >= 0) {
            result = jsObj->get(globalObject, static_cast<unsigned>(index));
        } else {
            PyErr_SetString(PyExc_IndexError, "negative index not supported");
            return nullptr;
        }
    } else if (PyUnicode_Check(key)) {
        const char* keyStr = PyUnicode_AsUTF8(key);
        if (!keyStr) {
            return nullptr;
        }
        Identifier ident = Identifier::fromString(vm, WTF::String::fromUTF8(keyStr));
        result = jsObj->get(globalObject, ident);
    } else {
        PyErr_SetString(PyExc_TypeError, "key must be string or integer");
        return nullptr;
    }

    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_KeyError, "Error accessing property");
        return nullptr;
    }

    return Python::fromJS(globalObject, result);
}

static int pyjsvalue_ass_subscript(PyObject* self, PyObject* key, PyObject* value)
{
    PyJSValueObject* wrapper = reinterpret_cast<PyJSValueObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return -1;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return -1;
    }

    JSValue jsVal = Python::toJS(globalObject, value);

    if (PyLong_Check(key)) {
        long index = PyLong_AsLong(key);
        if (index >= 0) {
            jsObj->putDirectIndex(globalObject, static_cast<unsigned>(index), jsVal);
        } else {
            PyErr_SetString(PyExc_IndexError, "negative index not supported");
            return -1;
        }
    } else if (PyUnicode_Check(key)) {
        const char* keyStr = PyUnicode_AsUTF8(key);
        if (!keyStr) {
            return -1;
        }
        Identifier ident = Identifier::fromString(vm, WTF::String::fromUTF8(keyStr));
        jsObj->putDirect(vm, ident, jsVal);
    } else {
        PyErr_SetString(PyExc_TypeError, "key must be string or integer");
        return -1;
    }

    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_KeyError, "Error setting property");
        return -1;
    }

    return 0;
}

// ============================================================================
// PyJSDictObject implementations
// ============================================================================

static void pyjsdict_dealloc(PyObject* self)
{
    PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(self);

    if (wrapper->jsValue.isCell()) {
        gcUnprotect(wrapper->jsValue.asCell());
    }

    // Use GC_Del since we allocated with GC_New
    PyObject_GC_Del(self);
}

static PyObject* pyjsdict_repr(PyObject* self)
{
    PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        return PyUnicode_FromString("{}");
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    auto str = wrapper->jsValue.toWTFString(globalObject);
    if (scope.exception()) {
        scope.clearException();
        return PyUnicode_FromString("{}");
    }

    auto utf8 = str.utf8();
    return PyUnicode_FromStringAndSize(utf8.data(), utf8.length());
}

static Py_ssize_t pyjsdict_length(PyObject* self)
{
    PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        return 0;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        return 0;
    }

    PropertyNameArrayBuilder propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    JSObject::getOwnPropertyNames(jsObj, globalObject, propertyNames, DontEnumPropertiesMode::Exclude);

    if (scope.exception()) {
        scope.clearException();
        return 0;
    }

    return static_cast<Py_ssize_t>(propertyNames.size());
}

static PyObject* pyjsdict_subscript(PyObject* self, PyObject* key)
{
    PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    if (!PyUnicode_Check(key)) {
        PyErr_SetString(PyExc_TypeError, "key must be string");
        return nullptr;
    }

    const char* keyStr = PyUnicode_AsUTF8(key);
    if (!keyStr) {
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return nullptr;
    }

    Identifier ident = Identifier::fromString(vm, WTF::String::fromUTF8(keyStr));

    // Check if property exists
    if (!jsObj->hasProperty(globalObject, ident)) {
        if (scope.exception()) {
            scope.clearException();
        }
        PyErr_SetObject(PyExc_KeyError, key);
        return nullptr;
    }

    JSValue result = jsObj->get(globalObject, ident);

    if (scope.exception()) {
        scope.clearException();
        PyErr_SetObject(PyExc_KeyError, key);
        return nullptr;
    }

    return Python::fromJS(globalObject, result);
}

static int pyjsdict_ass_subscript(PyObject* self, PyObject* key, PyObject* value)
{
    PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return -1;
    }

    if (!PyUnicode_Check(key)) {
        PyErr_SetString(PyExc_TypeError, "key must be string");
        return -1;
    }

    const char* keyStr = PyUnicode_AsUTF8(key);
    if (!keyStr) {
        return -1;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return -1;
    }

    Identifier ident = Identifier::fromString(vm, WTF::String::fromUTF8(keyStr));

    if (value == nullptr) {
        // Delete
        jsObj->deleteProperty(globalObject, ident);
    } else {
        JSValue jsVal = Python::toJS(globalObject, value);
        jsObj->putDirect(vm, ident, jsVal);
    }

    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_RuntimeError, "Error modifying property");
        return -1;
    }

    return 0;
}

static PyObject* pyjsdict_getattro(PyObject* self, PyObject* name)
{
    // First try to find the attribute in the type (for methods like keys(), values(), etc.)
    PyObject* result = PyObject_GenericGetAttr(self, name);
    if (result || !PyErr_ExceptionMatches(PyExc_AttributeError)) {
        return result;
    }
    PyErr_Clear();

    // Fall back to JS property access
    PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!PyUnicode_Check(name)) {
        PyErr_SetString(PyExc_TypeError, "attribute name must be string");
        return nullptr;
    }

    const char* attrName = PyUnicode_AsUTF8(name);
    if (!attrName) {
        return nullptr;
    }

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return nullptr;
    }

    Identifier ident = Identifier::fromString(vm, WTF::String::fromUTF8(attrName));

    // Check if property exists - raise AttributeError if not
    bool hasProperty = jsObj->hasProperty(globalObject, ident);
    if (scope.exception()) {
        scope.clearException();
    }

    if (!hasProperty) {
        PyErr_Format(PyExc_AttributeError, "'%.100s' object has no attribute '%.400s'",
            Py_TYPE(self)->tp_name, attrName);
        return nullptr;
    }

    JSValue jsResult = jsObj->get(globalObject, ident);

    if (scope.exception()) {
        scope.clearException();
        PyErr_Format(PyExc_AttributeError, "Error accessing '%s'", attrName);
        return nullptr;
    }

    // If the result is callable, return a bound method to preserve 'this' context
    auto callData = JSC::getCallData(jsResult);
    if (callData.type != CallData::Type::None) {
        return reinterpret_cast<PyObject*>(PyJSBoundMethod::New(globalObject, jsResult, wrapper->jsValue));
    }

    return Python::fromJS(globalObject, jsResult);
}

static int pyjsdict_setattro(PyObject* self, PyObject* name, PyObject* value)
{
    PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!PyUnicode_Check(name)) {
        PyErr_SetString(PyExc_TypeError, "attribute name must be string");
        return -1;
    }

    const char* attrName = PyUnicode_AsUTF8(name);
    if (!attrName) {
        return -1;
    }

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return -1;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return -1;
    }

    Identifier ident = Identifier::fromString(vm, WTF::String::fromUTF8(attrName));
    JSValue jsVal = Python::toJS(globalObject, value);

    jsObj->putDirect(vm, ident, jsVal);

    if (scope.exception()) {
        scope.clearException();
        PyErr_Format(PyExc_AttributeError, "Error setting '%s'", attrName);
        return -1;
    }

    return 0;
}

static int pyjsdict_contains(PyObject* self, PyObject* key)
{
    PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject || !PyUnicode_Check(key)) {
        return 0;
    }

    const char* keyStr = PyUnicode_AsUTF8(key);
    if (!keyStr) {
        PyErr_Clear();
        return 0;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        return 0;
    }

    Identifier ident = Identifier::fromString(vm, WTF::String::fromUTF8(keyStr));
    bool has = jsObj->hasProperty(globalObject, ident);

    if (scope.exception()) {
        scope.clearException();
        return 0;
    }

    return has ? 1 : 0;
}

// Helper to get property names as a Python list
static PyObject* getPropertyNamesAsList(PyJSDictObject* wrapper)
{
    JSGlobalObject* globalObject = wrapper->globalObject;
    if (!globalObject) {
        return PyList_New(0);
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        return PyList_New(0);
    }

    PropertyNameArrayBuilder propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    JSObject::getOwnPropertyNames(jsObj, globalObject, propertyNames, DontEnumPropertiesMode::Exclude);

    if (scope.exception()) {
        scope.clearException();
        return PyList_New(0);
    }

    PyObject* list = PyList_New(propertyNames.size());
    if (!list) {
        return nullptr;
    }

    for (size_t i = 0; i < propertyNames.size(); i++) {
        auto& propName = propertyNames[i];
        auto str = propName.string().string(); // AtomString -> String
        auto utf8 = str.utf8();
        PyObject* pyStr = PyUnicode_FromStringAndSize(utf8.data(), utf8.length());
        if (!pyStr) {
            Py_DECREF(list);
            return nullptr;
        }
        PyList_SET_ITEM(list, i, pyStr);
    }

    return list;
}

static PyObject* pyjsdict_keys(PyObject* self, PyObject* args)
{
    return getPropertyNamesAsList(reinterpret_cast<PyJSDictObject*>(self));
}

static PyObject* pyjsdict_values(PyObject* self, PyObject* args)
{
    PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        return PyList_New(0);
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        return PyList_New(0);
    }

    PropertyNameArrayBuilder propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    JSObject::getOwnPropertyNames(jsObj, globalObject, propertyNames, DontEnumPropertiesMode::Exclude);

    if (scope.exception()) {
        scope.clearException();
        return PyList_New(0);
    }

    PyObject* list = PyList_New(propertyNames.size());
    if (!list) {
        return nullptr;
    }

    for (size_t i = 0; i < propertyNames.size(); i++) {
        JSValue val = jsObj->get(globalObject, propertyNames[i]);
        if (scope.exception()) {
            scope.clearException();
            Py_DECREF(list);
            return PyList_New(0);
        }
        PyObject* pyVal = Python::fromJS(globalObject, val);
        if (!pyVal) {
            Py_DECREF(list);
            return nullptr;
        }
        PyList_SET_ITEM(list, i, pyVal);
    }

    return list;
}

static PyObject* pyjsdict_items(PyObject* self, PyObject* args)
{
    PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        return PyList_New(0);
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        return PyList_New(0);
    }

    PropertyNameArrayBuilder propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    JSObject::getOwnPropertyNames(jsObj, globalObject, propertyNames, DontEnumPropertiesMode::Exclude);

    if (scope.exception()) {
        scope.clearException();
        return PyList_New(0);
    }

    PyObject* list = PyList_New(propertyNames.size());
    if (!list) {
        return nullptr;
    }

    for (size_t i = 0; i < propertyNames.size(); i++) {
        auto& propName = propertyNames[i];
        auto str = propName.string().string(); // AtomString -> String
        auto utf8 = str.utf8();

        JSValue val = jsObj->get(globalObject, propName);
        if (scope.exception()) {
            scope.clearException();
            Py_DECREF(list);
            return PyList_New(0);
        }

        PyObject* pyKey = PyUnicode_FromStringAndSize(utf8.data(), utf8.length());
        PyObject* pyVal = Python::fromJS(globalObject, val);
        if (!pyKey || !pyVal) {
            Py_XDECREF(pyKey);
            Py_XDECREF(pyVal);
            Py_DECREF(list);
            return nullptr;
        }

        PyObject* tuple = PyTuple_Pack(2, pyKey, pyVal);
        Py_DECREF(pyKey);
        Py_DECREF(pyVal);
        if (!tuple) {
            Py_DECREF(list);
            return nullptr;
        }
        PyList_SET_ITEM(list, i, tuple);
    }

    return list;
}

static PyObject* pyjsdict_get(PyObject* self, PyObject* args)
{
    PyObject* key;
    PyObject* defaultValue = Py_None;

    if (!PyArg_ParseTuple(args, "O|O", &key, &defaultValue)) {
        return nullptr;
    }

    PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject || !PyUnicode_Check(key)) {
        Py_INCREF(defaultValue);
        return defaultValue;
    }

    const char* keyStr = PyUnicode_AsUTF8(key);
    if (!keyStr) {
        PyErr_Clear();
        Py_INCREF(defaultValue);
        return defaultValue;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        Py_INCREF(defaultValue);
        return defaultValue;
    }

    Identifier ident = Identifier::fromString(vm, WTF::String::fromUTF8(keyStr));

    if (!jsObj->hasProperty(globalObject, ident)) {
        if (scope.exception()) {
            scope.clearException();
        }
        Py_INCREF(defaultValue);
        return defaultValue;
    }

    JSValue result = jsObj->get(globalObject, ident);

    if (scope.exception()) {
        scope.clearException();
        Py_INCREF(defaultValue);
        return defaultValue;
    }

    return Python::fromJS(globalObject, result);
}

static PyObject* pyjsdict_pop(PyObject* self, PyObject* args)
{
    PyObject* key;
    PyObject* defaultValue = nullptr;

    if (!PyArg_ParseTuple(args, "O|O", &key, &defaultValue)) {
        return nullptr;
    }

    PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject || !PyUnicode_Check(key)) {
        if (defaultValue) {
            Py_INCREF(defaultValue);
            return defaultValue;
        }
        PyErr_SetObject(PyExc_KeyError, key);
        return nullptr;
    }

    const char* keyStr = PyUnicode_AsUTF8(key);
    if (!keyStr) {
        PyErr_Clear();
        if (defaultValue) {
            Py_INCREF(defaultValue);
            return defaultValue;
        }
        PyErr_SetObject(PyExc_KeyError, key);
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        if (defaultValue) {
            Py_INCREF(defaultValue);
            return defaultValue;
        }
        PyErr_SetObject(PyExc_KeyError, key);
        return nullptr;
    }

    Identifier ident = Identifier::fromString(vm, WTF::String::fromUTF8(keyStr));

    if (!jsObj->hasProperty(globalObject, ident)) {
        if (scope.exception()) {
            scope.clearException();
        }
        if (defaultValue) {
            Py_INCREF(defaultValue);
            return defaultValue;
        }
        PyErr_SetObject(PyExc_KeyError, key);
        return nullptr;
    }

    // Get the value first
    JSValue result = jsObj->get(globalObject, ident);
    if (scope.exception()) {
        scope.clearException();
        if (defaultValue) {
            Py_INCREF(defaultValue);
            return defaultValue;
        }
        PyErr_SetObject(PyExc_KeyError, key);
        return nullptr;
    }

    // Delete the property
    jsObj->deleteProperty(globalObject, ident);
    if (scope.exception()) {
        scope.clearException();
    }

    return Python::fromJS(globalObject, result);
}

static PyObject* pyjsdict_update(PyObject* self, PyObject* other)
{
    PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return nullptr;
    }

    // Handle dict-like objects
    if (PyDict_Check(other)) {
        PyObject* key;
        PyObject* value;
        Py_ssize_t pos = 0;

        while (PyDict_Next(other, &pos, &key, &value)) {
            if (!PyUnicode_Check(key)) {
                continue;
            }
            const char* keyStr = PyUnicode_AsUTF8(key);
            if (!keyStr) {
                PyErr_Clear();
                continue;
            }

            Identifier ident = Identifier::fromString(vm, WTF::String::fromUTF8(keyStr));
            JSValue jsVal = Python::toJS(globalObject, value);
            jsObj->putDirect(vm, ident, jsVal);

            if (scope.exception()) {
                scope.clearException();
            }
        }
    } else if (PyMapping_Check(other)) {
        // Handle mapping protocol
        PyObject* keys = PyMapping_Keys(other);
        if (!keys) {
            return nullptr;
        }

        Py_ssize_t len = PyList_Size(keys);
        for (Py_ssize_t i = 0; i < len; i++) {
            PyObject* key = PyList_GetItem(keys, i);
            if (!PyUnicode_Check(key)) {
                continue;
            }
            const char* keyStr = PyUnicode_AsUTF8(key);
            if (!keyStr) {
                PyErr_Clear();
                continue;
            }

            PyObject* value = PyObject_GetItem(other, key);
            if (!value) {
                PyErr_Clear();
                continue;
            }

            Identifier ident = Identifier::fromString(vm, WTF::String::fromUTF8(keyStr));
            JSValue jsVal = Python::toJS(globalObject, value);
            Py_DECREF(value);
            jsObj->putDirect(vm, ident, jsVal);

            if (scope.exception()) {
                scope.clearException();
            }
        }
        Py_DECREF(keys);
    } else {
        PyErr_SetString(PyExc_TypeError, "argument must be a mapping");
        return nullptr;
    }

    Py_RETURN_NONE;
}

static PyObject* pyjsdict_setdefault(PyObject* self, PyObject* args)
{
    PyObject* key;
    PyObject* defaultValue = Py_None;

    if (!PyArg_ParseTuple(args, "O|O", &key, &defaultValue)) {
        return nullptr;
    }

    PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject || !PyUnicode_Check(key)) {
        Py_INCREF(defaultValue);
        return defaultValue;
    }

    const char* keyStr = PyUnicode_AsUTF8(key);
    if (!keyStr) {
        PyErr_Clear();
        Py_INCREF(defaultValue);
        return defaultValue;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        Py_INCREF(defaultValue);
        return defaultValue;
    }

    Identifier ident = Identifier::fromString(vm, WTF::String::fromUTF8(keyStr));

    if (jsObj->hasProperty(globalObject, ident)) {
        if (scope.exception()) {
            scope.clearException();
        }
        JSValue result = jsObj->get(globalObject, ident);
        if (scope.exception()) {
            scope.clearException();
            Py_INCREF(defaultValue);
            return defaultValue;
        }
        return Python::fromJS(globalObject, result);
    }

    // Key doesn't exist, set default value
    if (scope.exception()) {
        scope.clearException();
    }
    JSValue jsVal = Python::toJS(globalObject, defaultValue);
    jsObj->putDirect(vm, ident, jsVal);

    if (scope.exception()) {
        scope.clearException();
    }

    Py_INCREF(defaultValue);
    return defaultValue;
}

static PyObject* pyjsdict_clear(PyObject* self, PyObject* args)
{
    PyJSDictObject* wrapper = reinterpret_cast<PyJSDictObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        Py_RETURN_NONE;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        Py_RETURN_NONE;
    }

    // Get all property names and delete them
    PropertyNameArrayBuilder propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    JSObject::getOwnPropertyNames(jsObj, globalObject, propertyNames, DontEnumPropertiesMode::Exclude);

    if (scope.exception()) {
        scope.clearException();
        Py_RETURN_NONE;
    }

    for (size_t i = 0; i < propertyNames.size(); i++) {
        jsObj->deleteProperty(globalObject, propertyNames[i]);
        if (scope.exception()) {
            scope.clearException();
        }
    }

    Py_RETURN_NONE;
}

// Iterator for dict - iterates over keys
struct PyJSDictIterator {
    PyObject_HEAD PyJSDictObject* dict;
    PyObject* keys; // List of keys
    Py_ssize_t index; // Current position
};

static void pyjsdictiter_dealloc(PyObject* self)
{
    PyJSDictIterator* iter = reinterpret_cast<PyJSDictIterator*>(self);
    Py_XDECREF(iter->dict);
    Py_XDECREF(iter->keys);
    PyObject_Del(self);
}

static PyObject* pyjsdictiter_next(PyObject* self)
{
    PyJSDictIterator* iter = reinterpret_cast<PyJSDictIterator*>(self);

    if (!iter->keys || iter->index >= PyList_Size(iter->keys)) {
        return nullptr; // StopIteration
    }

    PyObject* key = PyList_GetItem(iter->keys, iter->index);
    iter->index++;
    Py_INCREF(key);
    return key;
}

static PyTypeObject PyJSDictIterator_Type = {
    PyVarObject_HEAD_INIT(NULL, 0) "bun.JSObjectIterator",
    sizeof(PyJSDictIterator),
    0,
    pyjsdictiter_dealloc,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    Py_TPFLAGS_DEFAULT,
    "JavaScript object key iterator",
    0,
    0,
    0,
    0,
    PyObject_SelfIter,
    pyjsdictiter_next,
};

static PyObject* pyjsdict_iter(PyObject* self)
{
    if (PyType_Ready(&PyJSDictIterator_Type) < 0) {
        return nullptr;
    }

    PyJSDictIterator* iter = PyObject_New(PyJSDictIterator, &PyJSDictIterator_Type);
    if (!iter) {
        return nullptr;
    }

    iter->dict = reinterpret_cast<PyJSDictObject*>(self);
    Py_INCREF(iter->dict);
    iter->keys = getPropertyNamesAsList(iter->dict);
    iter->index = 0;

    if (!iter->keys) {
        Py_DECREF(iter);
        return nullptr;
    }

    return reinterpret_cast<PyObject*>(iter);
}

// ============================================================================
// PyJSListObject implementations
// ============================================================================

static void pyjslist_dealloc(PyObject* self)
{
    PyJSListObject* wrapper = reinterpret_cast<PyJSListObject*>(self);

    if (wrapper->jsValue.isCell()) {
        gcUnprotect(wrapper->jsValue.asCell());
    }

    // Use GC_Del since we allocated with GC_New
    PyObject_GC_Del(self);
}

static PyObject* pyjslist_repr(PyObject* self)
{
    PyJSListObject* wrapper = reinterpret_cast<PyJSListObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        return PyUnicode_FromString("[]");
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    auto str = wrapper->jsValue.toWTFString(globalObject);
    if (scope.exception()) {
        scope.clearException();
        return PyUnicode_FromString("[]");
    }

    auto utf8 = str.utf8();
    return PyUnicode_FromStringAndSize(utf8.data(), utf8.length());
}

static Py_ssize_t pyjslist_length(PyObject* self)
{
    PyJSListObject* wrapper = reinterpret_cast<PyJSListObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        return 0;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        return 0;
    }

    JSArray* jsArray = jsDynamicCast<JSArray*>(jsObj);
    if (!jsArray) {
        return 0;
    }

    unsigned length = jsArray->length();

    if (scope.exception()) {
        scope.clearException();
        return 0;
    }

    return static_cast<Py_ssize_t>(length);
}

static PyObject* pyjslist_item(PyObject* self, Py_ssize_t index)
{
    PyJSListObject* wrapper = reinterpret_cast<PyJSListObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    if (index < 0) {
        // Convert negative index
        Py_ssize_t len = pyjslist_length(self);
        index = len + index;
        if (index < 0) {
            PyErr_SetString(PyExc_IndexError, "list index out of range");
            return nullptr;
        }
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return nullptr;
    }

    JSValue result = jsObj->get(globalObject, static_cast<unsigned>(index));

    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_IndexError, "list index out of range");
        return nullptr;
    }

    if (result.isUndefined()) {
        JSArray* jsArray = jsDynamicCast<JSArray*>(jsObj);
        if (jsArray && static_cast<unsigned>(index) >= jsArray->length()) {
            PyErr_SetString(PyExc_IndexError, "list index out of range");
            return nullptr;
        }
    }

    return Python::fromJS(globalObject, result);
}

static int pyjslist_ass_item(PyObject* self, Py_ssize_t index, PyObject* value)
{
    PyJSListObject* wrapper = reinterpret_cast<PyJSListObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return -1;
    }

    if (index < 0) {
        Py_ssize_t len = pyjslist_length(self);
        index = len + index;
        if (index < 0) {
            PyErr_SetString(PyExc_IndexError, "list assignment index out of range");
            return -1;
        }
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return -1;
    }

    if (value == nullptr) {
        // Delete - not directly supported, set to undefined
        jsObj->putDirectIndex(globalObject, static_cast<unsigned>(index), jsUndefined());
    } else {
        JSValue jsVal = Python::toJS(globalObject, value);
        jsObj->putDirectIndex(globalObject, static_cast<unsigned>(index), jsVal);
    }

    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_IndexError, "Error setting list item");
        return -1;
    }

    return 0;
}

static PyObject* pyjslist_subscript(PyObject* self, PyObject* key)
{
    if (PyLong_Check(key)) {
        Py_ssize_t index = PyLong_AsSsize_t(key);
        if (index == -1 && PyErr_Occurred()) {
            return nullptr;
        }
        return pyjslist_item(self, index);
    }

    if (PySlice_Check(key)) {
        // Handle slices - for now, create a new Python list
        Py_ssize_t len = pyjslist_length(self);
        Py_ssize_t start, stop, step, slicelength;

        if (PySlice_GetIndicesEx(key, len, &start, &stop, &step, &slicelength) < 0) {
            return nullptr;
        }

        PyObject* result = PyList_New(slicelength);
        if (!result) {
            return nullptr;
        }

        for (Py_ssize_t i = 0, cur = start; i < slicelength; i++, cur += step) {
            PyObject* item = pyjslist_item(self, cur);
            if (!item) {
                Py_DECREF(result);
                return nullptr;
            }
            PyList_SET_ITEM(result, i, item);
        }

        return result;
    }

    PyErr_SetString(PyExc_TypeError, "list indices must be integers or slices");
    return nullptr;
}

static int pyjslist_ass_subscript(PyObject* self, PyObject* key, PyObject* value)
{
    if (PyLong_Check(key)) {
        Py_ssize_t index = PyLong_AsSsize_t(key);
        if (index == -1 && PyErr_Occurred()) {
            return -1;
        }
        return pyjslist_ass_item(self, index, value);
    }

    PyErr_SetString(PyExc_TypeError, "list indices must be integers");
    return -1;
}

static int pyjslist_contains(PyObject* self, PyObject* value)
{
    Py_ssize_t len = pyjslist_length(self);

    for (Py_ssize_t i = 0; i < len; i++) {
        PyObject* item = pyjslist_item(self, i);
        if (!item) {
            PyErr_Clear();
            continue;
        }

        int cmp = PyObject_RichCompareBool(item, value, Py_EQ);
        Py_DECREF(item);

        if (cmp < 0) {
            PyErr_Clear();
            continue;
        }
        if (cmp) {
            return 1;
        }
    }

    return 0;
}

// ============================================================================
// PyJSListObject method implementations
// ============================================================================

static PyObject* pyjslist_append(PyObject* self, PyObject* value)
{
    PyJSListObject* wrapper = reinterpret_cast<PyJSListObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return nullptr;
    }

    JSArray* jsArray = jsDynamicCast<JSArray*>(jsObj);
    if (!jsArray) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an array");
        return nullptr;
    }

    unsigned length = jsArray->length();
    JSValue jsVal = Python::toJS(globalObject, value);
    jsArray->putDirectIndex(globalObject, length, jsVal);

    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_RuntimeError, "Error appending to array");
        return nullptr;
    }

    Py_RETURN_NONE;
}

static PyObject* pyjslist_pop(PyObject* self, PyObject* args)
{
    PyJSListObject* wrapper = reinterpret_cast<PyJSListObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    Py_ssize_t index = -1;
    if (!PyArg_ParseTuple(args, "|n", &index)) {
        return nullptr;
    }

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return nullptr;
    }

    JSArray* jsArray = jsDynamicCast<JSArray*>(jsObj);
    if (!jsArray) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an array");
        return nullptr;
    }

    unsigned length = jsArray->length();
    if (length == 0) {
        PyErr_SetString(PyExc_IndexError, "pop from empty list");
        return nullptr;
    }

    // Handle negative index
    if (index < 0) {
        index = static_cast<Py_ssize_t>(length) + index;
    }

    if (index < 0 || static_cast<unsigned>(index) >= length) {
        PyErr_SetString(PyExc_IndexError, "pop index out of range");
        return nullptr;
    }

    // Get the item to return
    JSValue result = jsArray->get(globalObject, static_cast<unsigned>(index));
    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_RuntimeError, "Error getting item");
        return nullptr;
    }

    // Use Array.prototype.splice to remove the item
    JSValue spliceMethod = jsArray->get(globalObject, Identifier::fromString(vm, "splice"_s));
    if (scope.exception() || !spliceMethod.isObject()) {
        scope.clearException();
        PyErr_SetString(PyExc_RuntimeError, "Cannot access splice method");
        return nullptr;
    }

    auto callData = JSC::getCallData(spliceMethod);
    if (callData.type == CallData::Type::None) {
        PyErr_SetString(PyExc_RuntimeError, "splice is not callable");
        return nullptr;
    }

    MarkedArgumentBuffer spliceArgs;
    spliceArgs.append(jsNumber(index));
    spliceArgs.append(jsNumber(1));

    JSC::profiledCall(globalObject, ProfilingReason::API, spliceMethod, callData, jsArray, spliceArgs);

    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_RuntimeError, "Error removing item");
        return nullptr;
    }

    return Python::fromJS(globalObject, result);
}

static PyObject* pyjslist_insert(PyObject* self, PyObject* args)
{
    PyJSListObject* wrapper = reinterpret_cast<PyJSListObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    Py_ssize_t index;
    PyObject* value;
    if (!PyArg_ParseTuple(args, "nO", &index, &value)) {
        return nullptr;
    }

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return nullptr;
    }

    JSArray* jsArray = jsDynamicCast<JSArray*>(jsObj);
    if (!jsArray) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an array");
        return nullptr;
    }

    unsigned length = jsArray->length();

    // Handle negative index
    if (index < 0) {
        index = static_cast<Py_ssize_t>(length) + index;
        if (index < 0) {
            index = 0;
        }
    } else if (static_cast<unsigned>(index) > length) {
        index = static_cast<Py_ssize_t>(length);
    }

    // Use Array.prototype.splice to insert the item
    JSValue spliceMethod = jsArray->get(globalObject, Identifier::fromString(vm, "splice"_s));
    if (scope.exception() || !spliceMethod.isObject()) {
        scope.clearException();
        PyErr_SetString(PyExc_RuntimeError, "Cannot access splice method");
        return nullptr;
    }

    auto callData = JSC::getCallData(spliceMethod);
    if (callData.type == CallData::Type::None) {
        PyErr_SetString(PyExc_RuntimeError, "splice is not callable");
        return nullptr;
    }

    JSValue jsVal = Python::toJS(globalObject, value);

    MarkedArgumentBuffer spliceArgs;
    spliceArgs.append(jsNumber(index));
    spliceArgs.append(jsNumber(0));
    spliceArgs.append(jsVal);

    JSC::profiledCall(globalObject, ProfilingReason::API, spliceMethod, callData, jsArray, spliceArgs);

    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_RuntimeError, "Error inserting item");
        return nullptr;
    }

    Py_RETURN_NONE;
}

static PyObject* pyjslist_extend(PyObject* self, PyObject* iterable)
{
    PyJSListObject* wrapper = reinterpret_cast<PyJSListObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return nullptr;
    }

    JSArray* jsArray = jsDynamicCast<JSArray*>(jsObj);
    if (!jsArray) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an array");
        return nullptr;
    }

    // Iterate over the Python iterable and append each item
    PyObject* iter = PyObject_GetIter(iterable);
    if (!iter) {
        return nullptr;
    }

    PyObject* item;
    while ((item = PyIter_Next(iter))) {
        unsigned length = jsArray->length();
        JSValue jsVal = Python::toJS(globalObject, item);
        Py_DECREF(item);

        jsArray->putDirectIndex(globalObject, length, jsVal);

        if (scope.exception()) {
            scope.clearException();
            Py_DECREF(iter);
            PyErr_SetString(PyExc_RuntimeError, "Error extending array");
            return nullptr;
        }
    }

    Py_DECREF(iter);

    if (PyErr_Occurred()) {
        return nullptr;
    }

    Py_RETURN_NONE;
}

static PyObject* pyjslist_clear(PyObject* self, PyObject* args)
{
    PyJSListObject* wrapper = reinterpret_cast<PyJSListObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return nullptr;
    }

    JSArray* jsArray = jsDynamicCast<JSArray*>(jsObj);
    if (!jsArray) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an array");
        return nullptr;
    }

    // Set length to 0 to clear the array
    jsArray->setLength(globalObject, 0, true);

    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_RuntimeError, "Error clearing array");
        return nullptr;
    }

    Py_RETURN_NONE;
}

static PyObject* pyjslist_reverse(PyObject* self, PyObject* args)
{
    PyJSListObject* wrapper = reinterpret_cast<PyJSListObject*>(self);
    JSGlobalObject* globalObject = wrapper->globalObject;

    if (!globalObject) {
        PyErr_SetString(PyExc_RuntimeError, "JavaScript global not available");
        return nullptr;
    }

    VM& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* jsObj = wrapper->jsValue.getObject();
    if (!jsObj) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an object");
        return nullptr;
    }

    JSArray* jsArray = jsDynamicCast<JSArray*>(jsObj);
    if (!jsArray) {
        PyErr_SetString(PyExc_TypeError, "JavaScript value is not an array");
        return nullptr;
    }

    // Use Array.prototype.reverse
    JSValue reverseMethod = jsArray->get(globalObject, Identifier::fromString(vm, "reverse"_s));
    if (scope.exception() || !reverseMethod.isObject()) {
        scope.clearException();
        PyErr_SetString(PyExc_RuntimeError, "Cannot access reverse method");
        return nullptr;
    }

    auto callData = JSC::getCallData(reverseMethod);
    if (callData.type == CallData::Type::None) {
        PyErr_SetString(PyExc_RuntimeError, "reverse is not callable");
        return nullptr;
    }

    MarkedArgumentBuffer noArgs;
    JSC::profiledCall(globalObject, ProfilingReason::API, reverseMethod, callData, jsArray, noArgs);

    if (scope.exception()) {
        scope.clearException();
        PyErr_SetString(PyExc_RuntimeError, "Error reversing array");
        return nullptr;
    }

    Py_RETURN_NONE;
}

// Iterator for list
struct PyJSListIterator {
    PyObject_HEAD PyJSListObject* list;
    Py_ssize_t index;
    Py_ssize_t length;
};

static void pyjslistiter_dealloc(PyObject* self)
{
    PyJSListIterator* iter = reinterpret_cast<PyJSListIterator*>(self);
    Py_XDECREF(iter->list);
    PyObject_Del(self);
}

static PyObject* pyjslistiter_next(PyObject* self)
{
    PyJSListIterator* iter = reinterpret_cast<PyJSListIterator*>(self);

    if (iter->index >= iter->length) {
        return nullptr; // StopIteration
    }

    PyObject* item = pyjslist_item(reinterpret_cast<PyObject*>(iter->list), iter->index);
    iter->index++;
    return item;
}

static PyTypeObject PyJSListIterator_Type = {
    PyVarObject_HEAD_INIT(NULL, 0) "bun.JSArrayIterator",
    sizeof(PyJSListIterator),
    0,
    pyjslistiter_dealloc,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    Py_TPFLAGS_DEFAULT,
    "JavaScript array iterator",
    0,
    0,
    0,
    0,
    PyObject_SelfIter,
    pyjslistiter_next,
};

static PyObject* pyjslist_iter(PyObject* self)
{
    if (PyType_Ready(&PyJSListIterator_Type) < 0) {
        return nullptr;
    }

    PyJSListIterator* iter = PyObject_New(PyJSListIterator, &PyJSListIterator_Type);
    if (!iter) {
        return nullptr;
    }

    iter->list = reinterpret_cast<PyJSListObject*>(self);
    Py_INCREF(iter->list);
    iter->index = 0;
    iter->length = pyjslist_length(self);

    return reinterpret_cast<PyObject*>(iter);
}

} // namespace Bun
