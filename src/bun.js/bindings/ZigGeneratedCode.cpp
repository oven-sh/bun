#include "root.h"
#include "headers.h"

#include <JavaScriptCore/DOMJITAbstractHeap.h>
#include "DOMJITIDLConvert.h"
#include "DOMJITIDLType.h"
#include "DOMJITIDLTypeFilter.h"
#include "DOMJITHelpers.h"
#include <JavaScriptCore/DFGAbstractHeap.h>

#include "JSDOMConvertBufferSource.h"

using namespace JSC;
using namespace WebCore;

/* -- BEGIN DOMCall DEFINITIONS -- */

JSC_DEFINE_HOST_FUNCTION(FFI__ptr__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return FFI__ptr__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void FFI__ptr__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        1,
        String("ptr"_s),
        FFI__ptr__slowpathWrapper,
        ImplementationVisibility::Public,
        NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "ptr"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__u8__slowpathWrapper);

JSC_DEFINE_HOST_FUNCTION(Reader__u8__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__u8__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__u8__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("u8"_s),
        Reader__u8__slowpathWrapper,
        ImplementationVisibility::Public,
        NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "u8"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__u16__slowpathWrapper);
JSC_DEFINE_HOST_FUNCTION(Reader__u16__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__u16__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__u16__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("u16"_s),
        Reader__u16__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "u16"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__u32__slowpathWrapper);
JSC_DEFINE_HOST_FUNCTION(Reader__u32__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__u32__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__u32__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("u32"_s),
        Reader__u32__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "u32"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__ptr__slowpathWrapper);
JSC_DEFINE_HOST_FUNCTION(Reader__ptr__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__ptr__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__ptr__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("ptr"_s),
        Reader__ptr__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "ptr"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__i8__slowpathWrapper);
JSC_DEFINE_HOST_FUNCTION(Reader__i8__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__i8__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__i8__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("i8"_s),
        Reader__i8__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "i8"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__i16__slowpathWrapper);
JSC_DEFINE_HOST_FUNCTION(Reader__i16__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__i16__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__i16__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("i16"_s),
        Reader__i16__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "i16"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__i32__slowpathWrapper);
JSC_DEFINE_HOST_FUNCTION(Reader__i32__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__i32__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__i32__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("i32"_s),
        Reader__i32__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "i32"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__i64__slowpathWrapper);
JSC_DEFINE_HOST_FUNCTION(Reader__i64__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__i64__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__i64__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("i64"_s),
        Reader__i64__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "i64"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__u64__slowpathWrapper);
JSC_DEFINE_HOST_FUNCTION(Reader__u64__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__u64__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__u64__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("u64"_s),
        Reader__u64__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "u64"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__intptr__slowpathWrapper);
JSC_DEFINE_HOST_FUNCTION(Reader__intptr__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__intptr__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__intptr__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("intptr"_s),
        Reader__intptr__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "intptr"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__f32__slowpathWrapper);
JSC_DEFINE_HOST_FUNCTION(Reader__f32__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__f32__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__f32__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("f32"_s),
        Reader__f32__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "f32"_s),
        function);
}

BUN_DECLARE_HOST_FUNCTION(Reader__f64__slowpathWrapper);
JSC_DEFINE_HOST_FUNCTION(Reader__f64__slowpathWrapper, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* frame))
{
    return Reader__f64__slowpath(globalObject, JSValue::encode(frame->thisValue()), reinterpret_cast<JSC::EncodedJSValue*>(frame->addressOfArgumentsStart()), frame->argumentCount());
}

extern "C" void Reader__f64__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        2,
        String("f64"_s),
        Reader__f64__slowpathWrapper, ImplementationVisibility::Public, NoIntrinsic);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "f64"_s),
        function);
}

/* -- END DOMCall DEFINITIONS-- */
