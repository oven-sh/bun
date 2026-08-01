#pragma once
#include <JavaScriptCore/JSCJSValue.h>
#include <memory>

namespace Bun {
// One occupied slot in a StrongRootBlock; see StrongRef.cpp.
struct StrongRefImpl;
}

extern "C" void Bun__StrongRef__delete(Bun::StrongRefImpl* _Nonnull ref);
extern "C" Bun::StrongRefImpl* Bun__StrongRef__new(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue);
extern "C" JSC::EncodedJSValue Bun__StrongRef__get(Bun::StrongRefImpl* _Nonnull ref);
extern "C" void Bun__StrongRef__set(Bun::StrongRefImpl* _Nonnull ref, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue);
extern "C" void Bun__StrongRef__clear(Bun::StrongRefImpl* _Nonnull ref);

namespace Bun {

struct StrongRefDeleter {
    void operator()(StrongRefImpl* _Nonnull ref)
    {
        Bun__StrongRef__delete(ref);
    }
};

using StrongRef = std::unique_ptr<StrongRefImpl, StrongRefDeleter>;

}
