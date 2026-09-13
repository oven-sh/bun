// BunStreamConsumers.h — the host functions JavaScript reaches via
// `$newCppFunction("BunStreamConsumers.cpp", "<symbol>", n)` and via BunObject / the
// ReadableStream prototype. The js2native generator resolves the symbol inside a
// `using namespace WebCore;` block keyed on that file name, so these MUST be declared in
// `namespace WebCore` and DEFINED (JSC_DEFINE_HOST_FUNCTION) in BunStreamConsumers.cpp.
#pragma once

#include "root.h"

namespace WebCore {

// All userJS: yes — BunStreamConsumers.cpp
JSC_DECLARE_HOST_FUNCTION(jsFunctionReadableStreamToText);
JSC_DECLARE_HOST_FUNCTION(jsFunctionReadableStreamToArray);
JSC_DECLARE_HOST_FUNCTION(jsFunctionReadableStreamToArrayBuffer);
JSC_DECLARE_HOST_FUNCTION(jsFunctionReadableStreamToBytes);
JSC_DECLARE_HOST_FUNCTION(jsFunctionReadableStreamToJSON);
JSC_DECLARE_HOST_FUNCTION(jsFunctionReadableStreamToBlob);
JSC_DECLARE_HOST_FUNCTION(jsFunctionReadableStreamToFormData);
// If arg0 hasPendingNativeSource(): {m_transferred = true, m_disturbed = true}, returns the handle;
// else undefined. userJS: no. Referenced by src/js/internal/streams/native-readable.ts via $newCppFunction.
JSC_DECLARE_HOST_FUNCTION(jsFunctionTransferToNativeReadableStream);

} // namespace WebCore
