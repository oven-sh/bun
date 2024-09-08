#include "V8Template.h"

namespace v8 {

JSC::EncodedJSValue Template::DummyCallback(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    ASSERT_NOT_REACHED();
    return JSC::JSValue::encode(JSC::jsUndefined());
}

}
