#include "config.h"

#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayConstructor.h"
#include "libusockets.h"

#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

BUN_DECLARE_HOST_FUNCTION(Bun__canonicalizeIP);

JSC::JSValue createNodeTLSBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto* obj = constructEmptyObject(globalObject);

    struct us_cert_string_t* out;
    auto size = us_raw_root_certs(&out);
    if (size < 0) {
        return jsUndefined();
    }
    auto rootCertificates = JSC::JSArray::create(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(JSC::ArrayWithContiguous), size);
    for (auto i = 0; i < size; i++) {
        auto raw = out[i];
        auto str = WTF::String::fromUTF8(std::span { raw.str, raw.len });
        rootCertificates->putDirectIndex(globalObject, i, JSC::jsString(vm, str));
    }
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "rootCertificates"_s)), rootCertificates, 0);

    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "canonicalizeIP"_s)), JSC::JSFunction::create(vm, globalObject, 1, "canonicalizeIP"_s, Bun__canonicalizeIP, ImplementationVisibility::Public, NoIntrinsic), 0);
    return obj;
}

} // namespace Bun