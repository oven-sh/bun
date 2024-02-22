// GENERATED FILE
#pragma once

namespace Zig {

/* -- BEGIN DOMCall DEFINITIONS -- */

static void DOMCall__FFI__ptr__put(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    JSC::JSObject* thisObject = JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(value));
    static const JSC::DOMJIT::Signature DOMJIT_ptr_signature(
        FFI__ptr__fastpath,
        thisObject->classInfo(),
        JSC::DOMJIT::Effect::forPure(),
        JSC::SpecHeapTop,
        JSC::SpecUint8Array);
    JSFunction* function = JSFunction::create(
        globalObject->vm(),
        globalObject,
        1,
        String("ptr"_s),
        FFI__ptr__slowpath, ImplementationVisibility::Public, NoIntrinsic, FFI__ptr__slowpath,
        &DOMJIT_ptr_signature);
    thisObject->putDirect(
        globalObject->vm(),
        Identifier::fromString(globalObject->vm(), "ptr"_s),
        function,
        0);
}

/* -- END DOMCall DEFINITIONS-- */

} // namespace Zig
