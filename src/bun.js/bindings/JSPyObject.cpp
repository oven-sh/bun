#include "JSPyObject.h"
#include "BunPython.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/JSFunction.h>
#include <wtf/text/WTFString.h>

namespace Bun {

using namespace JSC;

// Forward declaration for toString
static JSC_DECLARE_HOST_FUNCTION(jsPyObjectToString);

// Forward declaration for call
static JSC_DECLARE_HOST_FUNCTION(jsPyObjectCall);

// Forward declaration for iterator
static JSC_DECLARE_HOST_FUNCTION(jsPyObjectIterator);

// Forward declaration for iterator next
static JSC_DECLARE_HOST_FUNCTION(jsPyIteratorNext);

const ClassInfo JSPyObject::s_info = { "PythonValue"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSPyObject) };

template<typename Visitor>
void JSPyObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSPyObject* thisObject = jsCast<JSPyObject*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

DEFINE_VISIT_CHILDREN(JSPyObject);

void JSPyObject::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSC::GCClient::IsoSubspace* JSPyObject::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSPyObject, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForPyObject.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForPyObject = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForPyObject.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForPyObject = std::forward<decltype(space)>(space); });
}

// Property access - proxy to Python's getattr
bool JSPyObject::getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName propertyName, PropertySlot& slot)
{
    JSPyObject* thisObject = jsCast<JSPyObject*>(object);
    VM& vm = globalObject->vm();

    // Handle special JS properties
    if (propertyName == vm.propertyNames->toStringTagSymbol) {
        slot.setValue(object, static_cast<unsigned>(PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly), jsString(vm, String("PythonValue"_s)));
        return true;
    }

    // Handle toString
    if (propertyName == vm.propertyNames->toString) {
        slot.setValue(object, static_cast<unsigned>(PropertyAttribute::DontEnum),
            JSFunction::create(vm, globalObject, 0, "toString"_s, jsPyObjectToString, ImplementationVisibility::Public));
        return true;
    }

    // Handle nodejs.util.inspect.custom for console.log
    if (propertyName == Identifier::fromUid(vm.symbolRegistry().symbolForKey("nodejs.util.inspect.custom"_s))) {
        slot.setValue(object, static_cast<unsigned>(PropertyAttribute::DontEnum),
            JSFunction::create(vm, globalObject, 0, "inspect"_s, jsPyObjectToString, ImplementationVisibility::Public));
        return true;
    }

    // Handle Symbol.iterator for Python iterables
    if (propertyName == vm.propertyNames->iteratorSymbol) {
        // Check if this Python object is iterable
        if (PyIter_Check(thisObject->m_pyObject) || PyObject_HasAttrString(thisObject->m_pyObject, "__iter__")) {
            slot.setValue(object, static_cast<unsigned>(PropertyAttribute::DontEnum),
                JSFunction::create(vm, globalObject, 0, "[Symbol.iterator]"_s, jsPyObjectIterator, ImplementationVisibility::Public));
            return true;
        }
    }

    // Handle length property for Python sequences (needed for Array.prototype methods)
    if (propertyName == vm.propertyNames->length) {
        if (PySequence_Check(thisObject->m_pyObject) && !PyUnicode_Check(thisObject->m_pyObject)) {
            Py_ssize_t len = PySequence_Size(thisObject->m_pyObject);
            if (len >= 0) {
                slot.setValue(object, static_cast<unsigned>(PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly), jsNumber(len));
                return true;
            }
            PyErr_Clear();
        }
    }

    // Convert property name to Python string
    auto* nameString = propertyName.publicName();
    if (!nameString) {
        return Base::getOwnPropertySlot(object, globalObject, propertyName, slot);
    }

    auto nameUTF8 = nameString->utf8();
    PyObject* pyName = PyUnicode_FromStringAndSize(nameUTF8.data(), nameUTF8.length());
    if (!pyName) {
        PyErr_Clear();
        return false;
    }

    // First try attribute access (for regular objects)
    PyObject* attr = PyObject_GetAttr(thisObject->m_pyObject, pyName);
    if (!attr) {
        PyErr_Clear();
        // If attribute access fails, try item access (for dicts/mappings)
        if (PyMapping_Check(thisObject->m_pyObject)) {
            attr = PyObject_GetItem(thisObject->m_pyObject, pyName);
            if (!attr) {
                PyErr_Clear();
            }
        }
    }
    Py_DECREF(pyName);

    if (!attr) {
        return false;
    }

    JSValue jsAttr = Python::toJS(globalObject, attr);
    Py_DECREF(attr);

    slot.setValue(object, static_cast<unsigned>(PropertyAttribute::None), jsAttr);
    return true;
}

bool JSPyObject::getOwnPropertySlotByIndex(JSObject* object, JSGlobalObject* globalObject, unsigned index, PropertySlot& slot)
{
    JSPyObject* thisObject = jsCast<JSPyObject*>(object);

    PyObject* item = PySequence_GetItem(thisObject->m_pyObject, static_cast<Py_ssize_t>(index));
    if (!item) {
        PyErr_Clear();
        return false;
    }

    JSValue jsItem = Python::toJS(globalObject, item);
    Py_DECREF(item);

    slot.setValue(object, static_cast<unsigned>(PropertyAttribute::None), jsItem);
    return true;
}

void JSPyObject::getOwnPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& propertyNames, DontEnumPropertiesMode mode)
{
    JSPyObject* thisObject = jsCast<JSPyObject*>(object);
    VM& vm = globalObject->vm();

    // Get dir() of the object
    PyObject* dir = PyObject_Dir(thisObject->m_pyObject);
    if (!dir) {
        PyErr_Clear();
        return;
    }

    Py_ssize_t len = PyList_Size(dir);
    for (Py_ssize_t i = 0; i < len; i++) {
        PyObject* name = PyList_GetItem(dir, i); // borrowed reference
        if (PyUnicode_Check(name)) {
            const char* nameStr = PyUnicode_AsUTF8(name);
            if (nameStr && nameStr[0] != '_') { // Skip private/dunder
                propertyNames.add(Identifier::fromString(vm, String::fromUTF8(nameStr)));
            }
        }
    }
    Py_DECREF(dir);
}

// Helper to convert JSValue to PyObject
static PyObject* jsValueToPyObject(JSGlobalObject* globalObject, JSValue value)
{
    if (value.isNull() || value.isUndefined()) {
        Py_INCREF(Py_None);
        return Py_None;
    }
    if (value.isBoolean()) {
        PyObject* result = value.asBoolean() ? Py_True : Py_False;
        Py_INCREF(result);
        return result;
    }
    if (value.isNumber()) {
        double num = value.asNumber();
        constexpr double maxSafeInt = 9007199254740992.0;
        if (std::floor(num) == num && num >= -maxSafeInt && num <= maxSafeInt) {
            return PyLong_FromLongLong(static_cast<long long>(num));
        }
        return PyFloat_FromDouble(num);
    }
    if (value.isString()) {
        auto str = value.toWTFString(globalObject);
        auto utf8 = str.utf8();
        return PyUnicode_FromStringAndSize(utf8.data(), utf8.length());
    }
    if (auto* pyVal = jsDynamicCast<JSPyObject*>(value)) {
        PyObject* obj = pyVal->pyObject();
        Py_INCREF(obj);
        return obj;
    }
    // For other JS objects, return None for now
    Py_INCREF(Py_None);
    return Py_None;
}

bool JSPyObject::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot)
{
    JSPyObject* thisObject = jsCast<JSPyObject*>(cell);

    auto* nameString = propertyName.publicName();
    if (!nameString) {
        return false;
    }

    auto nameUTF8 = nameString->utf8();
    PyObject* pyName = PyUnicode_FromStringAndSize(nameUTF8.data(), nameUTF8.length());
    if (!pyName) {
        PyErr_Clear();
        return false;
    }

    PyObject* pyValue = jsValueToPyObject(globalObject, value);
    if (!pyValue) {
        Py_DECREF(pyName);
        PyErr_Clear();
        return false;
    }

    int result = -1;

    // For dicts/mappings, use item assignment
    if (PyDict_Check(thisObject->m_pyObject)) {
        result = PyDict_SetItem(thisObject->m_pyObject, pyName, pyValue);
    } else if (PyMapping_Check(thisObject->m_pyObject)) {
        result = PyObject_SetItem(thisObject->m_pyObject, pyName, pyValue);
    } else {
        // For other objects, try attribute assignment
        result = PyObject_SetAttr(thisObject->m_pyObject, pyName, pyValue);
    }

    Py_DECREF(pyName);
    Py_DECREF(pyValue);

    if (result < 0) {
        PyErr_Clear();
        return false;
    }

    return true;
}

bool JSPyObject::putByIndex(JSCell* cell, JSGlobalObject* globalObject, unsigned index, JSValue value, bool)
{
    JSPyObject* thisObject = jsCast<JSPyObject*>(cell);

    if (!PySequence_Check(thisObject->m_pyObject)) {
        return false;
    }

    PyObject* pyValue = jsValueToPyObject(globalObject, value);
    if (!pyValue) {
        PyErr_Clear();
        return false;
    }

    // Get current length
    Py_ssize_t length = PySequence_Size(thisObject->m_pyObject);
    if (length < 0) {
        PyErr_Clear();
        Py_DECREF(pyValue);
        return false;
    }

    int result;
    if (static_cast<Py_ssize_t>(index) >= length) {
        // Index is beyond current length - we need to extend the list
        if (PyList_Check(thisObject->m_pyObject)) {
            // For lists, extend with None values up to the index, then set
            PyObject* list = thisObject->m_pyObject;
            for (Py_ssize_t i = length; i < static_cast<Py_ssize_t>(index); i++) {
                if (PyList_Append(list, Py_None) < 0) {
                    PyErr_Clear();
                    Py_DECREF(pyValue);
                    return false;
                }
            }
            result = PyList_Append(list, pyValue);
        } else {
            // For other sequences, try insert or set item
            result = PySequence_SetItem(thisObject->m_pyObject, static_cast<Py_ssize_t>(index), pyValue);
        }
    } else {
        result = PySequence_SetItem(thisObject->m_pyObject, static_cast<Py_ssize_t>(index), pyValue);
    }

    Py_DECREF(pyValue);

    if (result < 0) {
        PyErr_Clear();
        return false;
    }

    return true;
}

// toString - returns Python's str() representation
JSC_DEFINE_HOST_FUNCTION(jsPyObjectToString, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSPyObject* thisObject = jsDynamicCast<JSPyObject*>(thisValue);
    if (!thisObject) {
        return JSValue::encode(jsString(vm, String("[object PythonValue]"_s)));
    }

    PyObject* str = PyObject_Str(thisObject->pyObject());
    if (!str) {
        PyErr_Clear();
        return JSValue::encode(jsString(vm, String("[object PythonValue]"_s)));
    }

    const char* utf8 = PyUnicode_AsUTF8(str);
    if (!utf8) {
        Py_DECREF(str);
        PyErr_Clear();
        return JSValue::encode(jsString(vm, String("[object PythonValue]"_s)));
    }

    JSValue result = jsString(vm, WTF::String::fromUTF8(utf8));
    Py_DECREF(str);
    return JSValue::encode(result);
}

// Iterator next - called from the JS iterator's next() method
JSC_DEFINE_HOST_FUNCTION(jsPyIteratorNext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Get the Python iterator from the thisValue (which should be the iterator wrapper object)
    JSValue thisValue = callFrame->thisValue();
    JSObject* thisObject = thisValue.toObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Get the stored Python iterator
    JSValue pyIterValue = thisObject->getDirect(vm, Identifier::fromString(vm, "_pyIter"_s));
    if (!pyIterValue) {
        return JSValue::encode(constructEmptyObject(globalObject));
    }

    JSPyObject* pyIter = jsDynamicCast<JSPyObject*>(pyIterValue);
    if (!pyIter) {
        return JSValue::encode(constructEmptyObject(globalObject));
    }

    // Call Python's next() on the iterator
    PyObject* nextItem = PyIter_Next(pyIter->pyObject());

    // Create the result object { value, done }
    JSObject* result = constructEmptyObject(globalObject);

    if (nextItem) {
        // Got an item
        result->putDirect(vm, Identifier::fromString(vm, "value"_s), Python::toJS(globalObject, nextItem));
        result->putDirect(vm, Identifier::fromString(vm, "done"_s), jsBoolean(false));
        Py_DECREF(nextItem);
    } else {
        // Check if it's StopIteration or an error
        if (PyErr_Occurred()) {
            if (PyErr_ExceptionMatches(PyExc_StopIteration)) {
                PyErr_Clear();
            } else {
                // Real error - propagate it
                PyErr_Print();
                PyErr_Clear();
                throwTypeError(globalObject, scope, "Python iterator error"_s);
                return {};
            }
        }
        // Iterator exhausted
        result->putDirect(vm, Identifier::fromString(vm, "value"_s), jsUndefined());
        result->putDirect(vm, Identifier::fromString(vm, "done"_s), jsBoolean(true));
    }

    return JSValue::encode(result);
}

// Symbol.iterator - returns a JS iterator that wraps Python iteration
JSC_DEFINE_HOST_FUNCTION(jsPyObjectIterator, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    JSPyObject* thisObject = jsDynamicCast<JSPyObject*>(thisValue);
    if (!thisObject) {
        throwTypeError(globalObject, scope, "Not a Python object"_s);
        return {};
    }

    // Get a Python iterator for this object
    PyObject* pyIter = PyObject_GetIter(thisObject->pyObject());
    if (!pyIter) {
        PyErr_Clear();
        throwTypeError(globalObject, scope, "Python object is not iterable"_s);
        return {};
    }

    // Create a JS iterator object
    JSObject* jsIter = constructEmptyObject(globalObject);

    // Store the Python iterator (as JSPyObject) on the JS iterator object
    auto* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    Structure* structure = zigGlobalObject->m_JSPyObjectStructure.get();
    if (!structure) {
        structure = JSPyObject::createStructure(vm, globalObject, globalObject->objectPrototype());
        zigGlobalObject->m_JSPyObjectStructure.set(vm, zigGlobalObject, structure);
    }
    JSPyObject* wrappedIter = JSPyObject::create(vm, globalObject, structure, pyIter);
    Py_DECREF(pyIter); // JSPyObject takes ownership

    jsIter->putDirect(vm, Identifier::fromString(vm, "_pyIter"_s), wrappedIter);

    // Add the next() method
    jsIter->putDirect(vm, Identifier::fromString(vm, "next"_s),
        JSFunction::create(vm, globalObject, 0, "next"_s, jsPyIteratorNext, ImplementationVisibility::Public));

    return JSValue::encode(jsIter);
}

// Helper to check if a JSValue is a plain object (not array, not wrapped Python object)
static bool isPlainJSObject(JSGlobalObject* globalObject, JSValue value)
{
    if (!value.isObject())
        return false;
    JSObject* obj = value.getObject();
    // Not a plain object if it's a JSPyObject (wrapped Python object)
    if (jsDynamicCast<JSPyObject*>(obj))
        return false;
    // Not a plain object if it's an array
    if (isJSArray(obj))
        return false;
    // Not a plain object if it's a function
    if (obj->isCallable())
        return false;
    // Check if it's a plain Object (not a special type like Date, Map, etc.)
    // We consider it kwargs-eligible if its prototype is Object.prototype or null
    JSValue proto = obj->getPrototype(globalObject);
    return proto.isNull() || proto == globalObject->objectPrototype();
}

// Get the expected positional argument count for a Python callable
// Returns -1 if we can't determine (e.g., built-in functions)
static int getExpectedArgCount(PyObject* callable)
{
    PyObject* codeObj = nullptr;

    // For regular functions, get __code__
    if (PyFunction_Check(callable)) {
        codeObj = PyFunction_GET_CODE(callable);
    }
    // For methods, get the underlying function's __code__
    else if (PyMethod_Check(callable)) {
        PyObject* func = PyMethod_GET_FUNCTION(callable);
        if (PyFunction_Check(func)) {
            codeObj = PyFunction_GET_CODE(func);
        }
    }
    // Try getting __code__ attribute for other callables (like lambdas assigned to variables)
    else if (PyObject_HasAttrString(callable, "__code__")) {
        codeObj = PyObject_GetAttrString(callable, "__code__");
        if (codeObj) {
            PyObject* argCountObj = PyObject_GetAttrString(codeObj, "co_argcount");
            Py_DECREF(codeObj);
            if (argCountObj) {
                int count = static_cast<int>(PyLong_AsLong(argCountObj));
                Py_DECREF(argCountObj);
                return count;
            }
        }
        PyErr_Clear();
        return -1;
    }

    if (!codeObj) {
        return -1;
    }

    // Get co_argcount from the code object
    PyCodeObject* code = reinterpret_cast<PyCodeObject*>(codeObj);
    return code->co_argcount;
}

// Call Python function from JS
JSC_DEFINE_HOST_FUNCTION(jsPyObjectCall, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSPyObject* thisObject = jsDynamicCast<JSPyObject*>(callFrame->jsCallee());
    if (!thisObject) {
        throwTypeError(globalObject, scope, "Not a Python callable"_s);
        return {};
    }

    PyObject* pyFunc = thisObject->pyObject();
    if (!PyCallable_Check(pyFunc)) {
        throwTypeError(globalObject, scope, "Python object is not callable"_s);
        return {};
    }

    // Convert all arguments as positional args
    // TODO: Support kwargs via a special marker like $kwargs from "bun:python"
    size_t argCount = callFrame->argumentCount();

    // Check if the Python function expects fewer arguments than provided
    // If so, trim the argument list to match (allows flexible callback signatures)
    int expectedArgs = getExpectedArgCount(pyFunc);
    if (expectedArgs >= 0 && static_cast<size_t>(expectedArgs) < argCount) {
        argCount = static_cast<size_t>(expectedArgs);
    }
    PyObject* kwargs = nullptr;

    // Convert JS arguments to Python tuple
    PyObject* args = PyTuple_New(static_cast<Py_ssize_t>(argCount));
    if (!args) {
        Py_XDECREF(kwargs);
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    for (size_t i = 0; i < argCount; i++) {
        JSValue jsArg = callFrame->uncheckedArgument(i);
        PyObject* pyArg = nullptr;

        // Check if it's already a wrapped Python object first
        if (auto* pyVal = jsDynamicCast<JSPyObject*>(jsArg)) {
            // Unwrap JSPyObject back to PyObject
            pyArg = pyVal->pyObject();
            Py_INCREF(pyArg);
        } else {
            // Convert JS value to Python using the standard conversion
            // This handles primitives, arrays (as list), and objects (as dict)
            pyArg = Python::fromJS(globalObject, jsArg);
        }

        if (!pyArg) {
            Py_DECREF(args);
            Py_XDECREF(kwargs);
            throwTypeError(globalObject, scope, "Failed to convert argument to Python"_s);
            return {};
        }
        PyTuple_SET_ITEM(args, i, pyArg); // steals reference
    }

    // Call the Python function with args and optional kwargs
    PyObject* result = PyObject_Call(pyFunc, args, kwargs);
    Py_DECREF(args);
    Py_XDECREF(kwargs);

    if (!result) {
        // Get Python exception info
        PyObject *type, *value, *traceback;
        PyErr_Fetch(&type, &value, &traceback);
        PyErr_NormalizeException(&type, &value, &traceback);

        WTF::String errorMessage = "Python error"_s;
        if (value) {
            PyObject* str = PyObject_Str(value);
            if (str) {
                const char* errStr = PyUnicode_AsUTF8(str);
                if (errStr) {
                    errorMessage = WTF::String::fromUTF8(errStr);
                }
                Py_DECREF(str);
            }
        }

        Py_XDECREF(type);
        Py_XDECREF(value);
        Py_XDECREF(traceback);

        throwTypeError(globalObject, scope, errorMessage);
        return {};
    }

    JSValue jsResult = Python::toJS(globalObject, result);
    Py_DECREF(result);

    return JSValue::encode(jsResult);
}

CallData JSPyObject::getCallData(JSCell* cell)
{
    JSPyObject* thisObject = jsCast<JSPyObject*>(cell);

    CallData callData;
    // Only allow direct calls for non-type callables (functions, lambdas, etc.)
    // Python types (classes) should require `new`, like JS classes
    if (thisObject->isCallable() && !PyType_Check(thisObject->m_pyObject)) {
        callData.type = CallData::Type::Native;
        callData.native.function = jsPyObjectCall;
    }
    return callData;
}

// For Python, constructing and calling are the same thing
// This allows `new Counter()` to work for Python classes
CallData JSPyObject::getConstructData(JSCell* cell)
{
    JSPyObject* thisObject = jsCast<JSPyObject*>(cell);

    CallData constructData;
    if (thisObject->isCallable()) {
        constructData.type = CallData::Type::Native;
        constructData.native.function = jsPyObjectCall;
    }
    return constructData;
}

} // namespace Bun
