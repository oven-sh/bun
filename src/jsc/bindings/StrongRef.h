#pragma once
#include <JavaScriptCore/JSCJSValue.h>
#include <memory>

// The handle behind bun_jsc::Strong (Strong.rs): a slot in the VM's
// JSC::StrongSet, which Rust reads and writes directly.
extern "C" void Bun__StrongRef__delete(JSC::JSValue* _Nonnull slot);
extern "C" JSC::JSValue* Bun__StrongRef__new(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue);

namespace Bun {

struct StrongRefDeleter {
    void operator()(JSC::JSValue* _Nonnull slot)
    {
        Bun__StrongRef__delete(slot);
    }
};

using StrongRef = std::unique_ptr<JSC::JSValue, StrongRefDeleter>;

}
