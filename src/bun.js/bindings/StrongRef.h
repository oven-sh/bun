#pragma once
#include <JavaScriptCore/JSCJSValue.h>
#include <memory>

extern "C" void Bun__StrongRef__delete(JSC::JSValue* _Nonnull handleSlot);
extern "C" JSC::JSValue* Bun__StrongRef__new(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue);
extern "C" void Bun__StrongRef__set(JSC::JSValue* _Nonnull handleSlot, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue);
extern "C" void Bun__StrongRef__clear(JSC::JSValue* _Nonnull handleSlot);

namespace Bun {

struct StrongRefDeleter {
    // `std::unique_ptr` will never call this with a null pointer.
    void operator()(JSC::JSValue* _Nonnull handleSlot)
    {
        Bun__StrongRef__delete(handleSlot);
    }
};

using StrongRef = std::unique_ptr<JSC::JSValue, StrongRefDeleter>;

}
