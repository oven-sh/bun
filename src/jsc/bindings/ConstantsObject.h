#pragma once

#include "root.h"
#include <JavaScriptCore/Lookup.h>
#include <span>

namespace Bun {

// Rows of a constants table. A table is a `static constexpr JSC::HashTableValue
// rows[]`, so each row can sit behind the #ifdef that decides whether the
// platform has that constant, and createConstantsObject() turns it into an
// ordinary object on first use.
constexpr JSC::HashTableValue constantInteger(ASCIILiteral name, long long value)
{
    return { name, static_cast<unsigned>(JSC::PropertyAttribute::ConstantInteger), JSC::NoIntrinsic, { JSC::HashTableValue::ConstantType, value } };
}

// The callback runs once, while the object is built; it receives that object.
constexpr JSC::HashTableValue propertyCallback(ASCIILiteral name, JSC::LazyPropertyCallback callback)
{
    return { name, static_cast<unsigned>(JSC::PropertyAttribute::PropertyCallback), JSC::NoIntrinsic, { JSC::HashTableValue::LazyPropertyType, callback } };
}

constexpr JSC::HashTableValue nativeFunction(ASCIILiteral name, JSC::NativeFunction::Ptr function, intptr_t length)
{
    return { name, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, function, length } };
}

constexpr bool sameName(ASCIILiteral a, ASCIILiteral b)
{
    if (a.length() != b.length())
        return false;
    for (size_t i = 0; i < a.length(); i++) {
        if (a[i] != b[i])
            return false;
    }
    return true;
}

// The putDirect loops these tables replace let a second row with the same name
// overwrite the first without anyone noticing.
template<size_t rowCount>
constexpr bool hasDuplicateName(const JSC::HashTableValue (&rows)[rowCount])
{
    for (size_t i = 0; i < rowCount; i++) {
        for (size_t j = i + 1; j < rowCount; j++) {
            if (sameName(rows[i].m_key, rows[j].m_key))
                return true;
        }
    }
    return false;
}

// A plain object with the rows as its properties, in table order.
JSC::JSObject* createConstantsObject(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype, std::span<const JSC::HashTableValue> rows);

template<const auto& rows>
JSC::JSObject* createConstantsObject(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype = JSC::jsNull())
{
    static_assert(!hasDuplicateName(rows), "a constants table lists the same name twice");
    return createConstantsObject(vm, globalObject, prototype, rows);
}

// For a PropertyCallback row (or .lut.h entry) on the parent object: the child
// object is built from `rows` when the parent property is first read.
template<const auto& rows>
JSC::JSValue constantsObjectCallback(JSC::VM& vm, JSC::JSObject* owner)
{
    return createConstantsObject<rows>(vm, owner->globalObject());
}

} // namespace Bun
