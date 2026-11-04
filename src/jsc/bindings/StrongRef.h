#pragma once
#include <JavaScriptCore/JSCJSValue.h>

namespace Bun {
// One occupied slot in a StrongRootBlock; see StrongRef.cpp.
struct StrongRefImpl;
}

extern "C" void Bun__StrongRef__delete(Bun::StrongRefImpl* _Nonnull ref);
extern "C" Bun::StrongRefImpl* Bun__StrongRef__new(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue);
extern "C" void Bun__StrongRef__set(Bun::StrongRefImpl* _Nonnull ref, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue);
// Bun__StrongRef__set() for a caller that has no global object. Allocates nothing, so a weak callback of a v8::Global can call it inside a collection.
void Bun__StrongRef__write(Bun::StrongRefImpl* _Nonnull ref, JSC::EncodedJSValue encodedValue);
