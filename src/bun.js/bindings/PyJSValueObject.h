#pragma once

#include "root.h"
#include "Python.h"

namespace Bun {

using namespace JSC;

// Base wrapper for JS values in Python - used for functions and other non-container types
struct PyJSValueObject {
    PyObject_HEAD
    JSValue jsValue;
    JSGlobalObject* globalObject;

    static PyJSValueObject* New();
    static PyJSValueObject* NewDict(JSGlobalObject* globalObject, JSValue value);
    static PyJSValueObject* NewList(JSGlobalObject* globalObject, JSValue value);
    static void initType();
};

// Dict subclass wrapper - makes isinstance(obj, dict) return True
// Uses same memory layout as PyJSValueObject but with dict as base type
struct PyJSDictObject {
    PyDictObject dict; // Must be first - inherits from dict
    JSValue jsValue;
    JSGlobalObject* globalObject;
};

// List subclass wrapper - makes isinstance(obj, list) return True
struct PyJSListObject {
    PyListObject list; // Must be first - inherits from list
    JSValue jsValue;
    JSGlobalObject* globalObject;
};

// Bound method wrapper - preserves 'this' context when accessing methods on JS objects
// When you do `obj.method()` in Python, we need to call method with `this` = obj
struct PyJSBoundMethod {
    PyObject_HEAD
    JSValue function;      // The JS function
    JSValue thisObject;    // The object the function was accessed from
    JSGlobalObject* globalObject;

    static PyJSBoundMethod* New(JSGlobalObject* globalObject, JSValue function, JSValue thisObject);
    static void initType();
};

// Try to unwrap a PyObject that wraps a JSValue back to the underlying JSValue
// Returns empty JSValue if the object is not a PyJSValueObject, PyJSDictObject, or PyJSListObject
JSValue tryUnwrapJSValue(PyObject* obj);

} // namespace Bun
