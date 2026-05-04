#pragma once

#include "V8Data.h"

namespace v8 {

// matches V8 class hierarchy
class Template : public Data {
public:
    static JSC_HOST_CALL_ATTRIBUTES JSC::EncodedJSValue DummyCallback(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);
};

} // namespace v8
