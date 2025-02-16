#pragma once

#include "V8Data.h"
#include "V8Name.h"

namespace v8 {

enum class PropertyAttribute {
    None = 0,
    // not writable
    ReadOnly = 1 << 0,
    // not enumerable
    DontEnum = 1 << 1,
    // not configurable
    DontDelete = 1 << 2,
};

// matches V8 class hierarchy
class Template : public Data {
public:
    static JSC_HOST_CALL_ATTRIBUTES JSC::EncodedJSValue DummyCallback(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);

    // Set a property on objects created by this template
    BUN_EXPORT void Set(Local<Name> name, Local<Data> value, PropertyAttribute attribute = PropertyAttribute::None);
};

} // namespace v8
