#pragma once

#include "root.h"

#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSObjectInlines.h>

namespace Bun {

// Reads every element of an array-like into `out` before the caller reads any
// byte length or raw pointer, so a getter or proxy trap cannot detach or resize
// an element after it was measured. `accept(element)` runs before each append
// and returns false to stop. A type check belongs there, not after the loop: a
// later getter cannot change an element's type, and a list that lies about its
// length (a Proxy `length` trap, a sparse array) then fails at its first bad
// element instead of after O(length) [[Get]] calls.
//
// The caller checks for an exception first, then for `out.hasOverflowed()`.
template<typename Accept>
void collectArrayLike(JSC::JSGlobalObject* globalObject, JSC::JSObject* arrayLike, JSC::MarkedArgumentBuffer& out, const Accept& accept)
{
    // A sparse array's length says nothing about its element count, so only
    // pre-size for dense storage.
    if (auto* array = dynamicDowncast<JSC::JSArray>(arrayLike); array && !JSC::hasAnyArrayStorage(array->indexingType())) [[likely]] {
        out.ensureCapacity(array->length());
        if (out.hasOverflowed()) [[unlikely]]
            return;
    }

    JSC::forEachInArrayLike(globalObject, arrayLike, [&](JSC::JSValue element) -> bool {
        if (!accept(element))
            return false;
        out.append(element);
        return true;
    });
}

} // namespace Bun
