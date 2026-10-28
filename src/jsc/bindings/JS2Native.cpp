#include "root.h"
#include "JS2Native.h"

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSGlobalObject.h>

#include "ZigGlobalObject.h"

#include "GeneratedJS2Native.h"
#include "wtf/Assertions.h"

namespace Bun {
namespace JS2Native {

JSC::JSValue nativeBinding(JSC::JSGlobalObject* globalObject, uint32_t index)
{
    RELEASE_ASSERT(
        index < JS2NATIVE_COUNT,
        "In call to $lazy, got invalid id '%u'. This is a bug in Bun's JS2Native code generator.",
        index);
    return JS2NativeGenerated::callJS2Native(index, uncheckedDowncast<Zig::GlobalObject>(globalObject));
}

// This is the implementation of the generated $lazy
JSC_DEFINE_HOST_FUNCTION(jsDollarLazy, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::JSValue target = callFrame->uncheckedArgument(0);

#if ASSERT_ENABLED
    ASSERT_WITH_MESSAGE(target.isInt32(), "In call to $lazy: expected Int32, got %s", target.toWTFString(lexicalGlobalObject).utf8().legacyCStringPointer());
#endif

    return JSValue::encode(nativeBinding(lexicalGlobalObject, target.asInt32()));
}

} // namespace JS2Native
} // namespace Bun
