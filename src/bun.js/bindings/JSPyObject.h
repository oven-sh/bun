#pragma once

#include "root.h"
#include <Python.h>

namespace Bun {
using namespace JSC;

// JSPyObject wraps a PyObject* and proxies property access, calls, etc. to Python.
// When created, it increments the Python refcount; when finalized by GC, it decrements it.
class JSPyObject : public JSC::JSDestructibleObject {
    using Base = JSC::JSDestructibleObject;

public:
    JSPyObject(JSC::VM& vm, JSC::Structure* structure, PyObject* pyObject)
        : Base(vm, structure)
        , m_pyObject(pyObject)
    {
        // Prevent Python from freeing this object while we hold it
        Py_INCREF(m_pyObject);
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    static constexpr unsigned StructureFlags = Base::StructureFlags | OverridesGetOwnPropertySlot | OverridesGetOwnPropertyNames | OverridesPut | OverridesGetCallData | InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }

    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype,
            JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSPyObject* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, PyObject* pyObject)
    {
        JSPyObject* value = new (NotNull, JSC::allocateCell<JSPyObject>(vm)) JSPyObject(vm, structure, pyObject);
        value->finishCreation(vm);
        return value;
    }

    void finishCreation(JSC::VM& vm);

    static void destroy(JSCell* thisObject)
    {
        JSPyObject* value = static_cast<JSPyObject*>(thisObject);
        // Release Python reference
        Py_DECREF(value->m_pyObject);
        value->~JSPyObject();
    }

    // Property access - proxy to Python's __getattr__
    static bool getOwnPropertySlot(JSObject*, JSGlobalObject*, PropertyName, PropertySlot&);
    static bool getOwnPropertySlotByIndex(JSObject*, JSGlobalObject*, unsigned, PropertySlot&);
    static void getOwnPropertyNames(JSObject*, JSGlobalObject*, PropertyNameArrayBuilder&, DontEnumPropertiesMode);

    // Property set - proxy to Python's __setattr__
    static bool put(JSCell*, JSGlobalObject*, PropertyName, JSValue, PutPropertySlot&);
    static bool putByIndex(JSCell*, JSGlobalObject*, unsigned, JSValue, bool);

    // If callable, proxy to Python's __call__
    static CallData getCallData(JSCell*);

    // If callable, also make constructible (for Python classes)
    static CallData getConstructData(JSCell*);

    // Get the wrapped PyObject
    PyObject* pyObject() const { return m_pyObject; }

    // Helper to check if Python object is callable
    bool isCallable() const { return PyCallable_Check(m_pyObject); }

private:
    PyObject* m_pyObject;
};

} // namespace Bun
