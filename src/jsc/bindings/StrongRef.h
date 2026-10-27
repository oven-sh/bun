#pragma once
#include <JavaScriptCore/JSCJSValue.h>

namespace Bun {
// One occupied slot in a StrongRootBlock; see StrongRef.cpp.
struct StrongRefImpl;
}

extern "C" void Bun__StrongRef__delete(Bun::StrongRefImpl* _Nonnull ref);
extern "C" Bun::StrongRefImpl* Bun__StrongRef__new(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue);
extern "C" void Bun__StrongRef__set(Bun::StrongRefImpl* _Nonnull ref, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue);
