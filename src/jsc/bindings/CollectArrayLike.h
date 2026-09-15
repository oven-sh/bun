#pragma once

#include "root.h"

#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSObjectInlines.h>

namespace Bun {

// Reads every element of `arrayLike` into `out` before the caller reads any byte
// length or raw pointer, so a getter or proxy trap cannot invalidate an element
// that was already measured. `accept` rejects an element by returning false. A
// type check belongs there, so a list that lies about its length (a Proxy `length`
// trap, a sparse array) fails at its first bad element, not after O(length) reads.
template<typename Accept>
void collectArrayLike(JSC::JSGlobalObject* globalObject, JSC::JSObject* arrayLike, JSC::MarkedArgumentBuffer& out, const Accept& accept)
{
    // A sparse array's length says nothing about its element count, so only pre-size for dense storage.
    if (auto* array = dynamicDowncast<JSC::JSArray>(arrayLike); array && !JSC::hasAnyArrayStorage(array->indexingType())) [[likely]] {
        out.ensureCapacity(array->length());
        if (out.hasOverflowed()) [[unlikely]]
            return;
    }

    JSC::forEachInArrayLike(globalObject, arrayLike, [&](JSC::JSValue element) -> bool {
        if (!accept(element))
            return false;
        out.append(element);
        return !out.hasOverflowed();
    });
}

} // namespace Bun
