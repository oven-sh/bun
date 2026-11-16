#pragma once

#include "root.h"

namespace Bun {

// Properties of the DOM of `bun:desktop` that cost no function until they are used.

// (object, names, load): data properties. The first read of one stores `load(name)` in it.
bool isUsedByLazyProperties(JSC::VM&, JSC::PropertyName);
void replaceLazyProperty(JSC::VM&, JSC::JSObject*, JSC::PropertyName, JSC::JSValue, unsigned attributes);

// Without it, each change makes a structure.
class ChangesInPlace {
public:
    ChangesInPlace(JSC::VM& vm, JSC::JSObject* object)
        : m_vm(vm)
        , m_object(object)
    {
        object->convertToUncacheableDictionary(vm);
    }

    ~ChangesInPlace()
    {
        m_object->flattenDictionaryObject(m_vm);
        m_object->structure()->setHasBeenFlattenedBefore(false);
    }

private:
    JSC::VM& m_vm;
    JSC::JSObject* m_object;
};

JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopDefineLazyValues);
// (family, get, set): what the accessors of a family call, as `get(receiver, name)` and `set(receiver, name, value)`.
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopSetAccessorFamily);
// (object, names, family, isEnumerable)
JSC_DECLARE_HOST_FUNCTION(jsFunctionDesktopDefineAccessors);

} // namespace Bun
