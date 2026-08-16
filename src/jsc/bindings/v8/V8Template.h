#pragma once

#include "V8Data.h"
#include "V8Local.h"
#include "V8Object.h"
#include "V8PropertyCallbackInfo.h"

namespace v8 {

class Name;
class Value;

enum class SideEffectType {
    kHasSideEffect,
    kHasNoSideEffect,
    kHasSideEffectToReceiver,
};

// matches V8 class hierarchy
class Template : public Data {
public:
    static JSC_HOST_CALL_ATTRIBUTES JSC::EncodedJSValue DummyCallback(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame);

    BUN_EXPORT void Set(Local<Name> name, Local<Data> value, PropertyAttribute attributes = None);

    BUN_EXPORT void SetNativeDataProperty(
        Local<Name> name,
        AccessorNameGetterCallback getter,
        AccessorNameSetterCallback setter = nullptr,
        Local<Value> data = Local<Value>(),
        PropertyAttribute attribute = None,
        SideEffectType getter_side_effect_type = SideEffectType::kHasSideEffect,
        SideEffectType setter_side_effect_type = SideEffectType::kHasSideEffect);
};

} // namespace v8
