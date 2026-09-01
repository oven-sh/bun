#pragma once

#include "root.h"

#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSObjectInlines.h>

namespace Bun {

// Reads every element of an array-like object into `out`, in index order, so
// that all user code an indexed read can run (getters, proxy traps) finishes
// before the caller reads byte lengths or takes raw pointers. A getter at
// index N can otherwise detach or resize the buffer at index M < N after
// M's length was measured.
//
// `accept(element)` runs on each element before it is appended. It returns
// false to stop the loop, which the caller uses to reject an element of the
// wrong type right away: a later getter cannot change an element's type,
// only detach or resize it. Without that early exit, a list whose reported
// length is far larger than its contents (a Proxy with a lying `length` trap,
// a sparse array) would cost O(length) [[Get]] calls before the caller could
// reject it.
//
// The caller checks for an exception first, then for `out.hasOverflowed()`.
template<typename Accept>
void collectArrayLike(JSC::JSGlobalObject* globalObject, JSC::JSObject* arrayLike, JSC::MarkedArgumentBuffer& out, const Accept& accept)
{
    // Only a densely stored JSArray has a length that matches its element
    // count. A sparse array can report a length of 2^32 - 1 with two elements
    // in it, and pre-sizing to that fails before the loop can reject it.
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
