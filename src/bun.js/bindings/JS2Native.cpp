#include "root.h"
#include "JS2Native.h"

#include <JavaScriptCore/BuiltinUtils.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSGlobalObject.h>

#include "ZigGlobalObject.h"

#include "GeneratedJS2Native.h"
#include "wtf/Assertions.h"

extern "C" JSC::EncodedJSValue ByteBlob__JSReadableStreamSource__load(JSC::JSGlobalObject* global);
extern "C" JSC::EncodedJSValue FileReader__JSReadableStreamSource__load(JSC::JSGlobalObject* global);
extern "C" JSC::EncodedJSValue ByteStream__JSReadableStreamSource__load(JSC::JSGlobalObject* global);

namespace Bun {
namespace JS2Native {

// This is the implementation of the generated $lazy
JSC_DEFINE_HOST_FUNCTION(jsDollarLazy, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    JSC::JSValue target = callFrame->uncheckedArgument(0);

#if BUN_DEBUG
    ASSERT_WITH_MESSAGE(target.isInt32(), "In call to $lazy: expected Int32, got %s", target.toWTFString(lexicalGlobalObject).utf8().data());
#endif

    int id = target.asInt32();
    RELEASE_ASSERT(
        id <= JS2NATIVE_COUNT && id >= 0,
        "In call to $lazy, got invalid id '%d'. This is a bug in Bun's JS2Native code generator.",
        id);
    Zig::GlobalObject* ptr = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    return JSValue::encode(JS2NativeGenerated::callJS2Native(id, ptr));
}

} // namespace JS2Native
} // namespace Bun
