#pragma once

#include "root.h"

#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSObjectInlines.h>

namespace Bun {

// Returns the elements of `arrayLike` once no read of them can run user code any more, so the caller can take byte
// lengths and raw pointers from them. `accept(element, index)` returns false to reject an element and stop. A hole-free
// contiguous JSArray runs no user code on read, so it is returned in place: the span points into its butterfly and is
// valid until the next call that can run JS. Every other shape is read once into `storage`.
// The caller checks for an exception first, then for `storage.hasOverflowed()`.
template<typename Accept>
std::span<const JSC::EncodedJSValue> collectArrayLike(JSC::JSGlobalObject* globalObject, JSC::JSObject* arrayLike, JSC::MarkedArgumentBuffer& storage, const Accept& accept)
{
    if (auto* array = dynamicDowncast<JSC::JSArray>(arrayLike); array && JSC::hasContiguous(array->indexingType())) [[likely]] {
        auto* butterfly = array->butterfly();
        std::span elements { reinterpret_cast<const JSC::EncodedJSValue*>(butterfly->contiguous().data()), butterfly->publicLength() };
        size_t index = 0;
        for (; index < elements.size(); index++) {
            JSC::JSValue element = JSC::JSValue::decode(elements[index]);
            // A hole reads through the prototype chain.
            if (!element) [[unlikely]]
                break;
            if (!accept(element, index)) [[unlikely]]
                return {};
        }
        if (index == elements.size()) [[likely]]
            return elements;
    }

    JSC::forEachInArrayLike(globalObject, arrayLike, [&](JSC::JSValue element) -> bool {
        if (!accept(element, storage.size()))
            return false;
        storage.append(element);
        return !storage.hasOverflowed();
    });
    return { JSC::ArgList(storage).data(), storage.size() };
}

} // namespace Bun
