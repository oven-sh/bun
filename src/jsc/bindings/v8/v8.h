#pragma once

#include "ZigGlobalObject.h"

#define V8_UNIMPLEMENTED()                                                                                          \
    do {                                                                                                            \
        const auto str = WTF::makeString(                                                                           \
            "You're using a module which calls a V8 function \""_s,                                                 \
            WTF::ASCIILiteral::fromLiteralUnsafe(__PRETTY_FUNCTION__),                                              \
            "\" that Bun does not yet implement. Track progress at https://github.com/oven-sh/bun/issues/4290."_s); \
        auto utf8 = str.utf8();                                                                                     \
        auto bytes = byteCast<char>(utf8.span());                                                                   \
        Bun__panic(bytes.data(), bytes.size());                                                                     \
    } while (0)

// Use only for types and functions that are exposed in the public V8 API
namespace v8 {

// Use for types added to Bun to support V8 APIs that aren't used in the actual V8 API
namespace shim {

// An entry of the V8 API that fails calls this before it returns to the addon.
// - JavaScript is below the addon: returns false. The exception stays on the VM for that caller.
// - None is below (a libuv callback): no frame takes the exception, and it would fail the addon's next calls. Bun
//   clears it, reports it as uncaught and returns true. It also takes the VM's stop, which that report requests in a
//   Worker that has no listener.
// V8 clears every exception at that point. It reports the ones that a function call raised, to the TryCatch of its
// caller if there is one (Node has one around a Node-API finalizer):
// https://github.com/nodejs/node/blob/v26.3.0/deps/v8/src/api/api-inl.h#L168-L178
// https://github.com/nodejs/node/blob/v26.3.0/deps/v8/src/execution/execution.cc#L471-L477
// Bun reports every exception, inside the call: it drops no error, and it has no v8::TryCatch.
// It takes no argument, so that an entry keeps nothing alive for its failure branch.
bool reportUncaughtException();

}

} // namespace v8

// RETURN_IF_EXCEPTION for an entry of the V8 API. test/internal/source-lints/v8-entry-exits.test.ts rejects the plain
// one. Not under a NapiUngatedScope, where the report may not run JavaScript: see shim::constructUngated.
#define V8_RETURN_IF_EXCEPTION(scope__, value__) \
    RETURN_IF_EXCEPTION(scope__, (v8::shim::reportUncaughtException(), value__))
