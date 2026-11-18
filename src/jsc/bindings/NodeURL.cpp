#include "NodeURL.h"
#include "ErrorCode.h"
#include "VectorSizeLimit.h"
#include "wtf/URL.h"

namespace Bun {

// idnaToASCII for the certificate check in src/boringssl/lib.rs, on any thread. Not domainToASCII, which cuts the name at '/'. Dead when the name does not convert.
extern "C" BunString Bun__idnaToASCII(const BunString* domain)
{
    auto ascii = WTF::nameToASCII(domain->toWTFString(), WTF::OnNameError::Fail);
    if (ascii.isNull())
        return { BunStringTag::Dead };
    return Bun::toStringRef(ascii).leak();
}

JSC_DEFINE_HOST_FUNCTION(jsDomainToASCII, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1)
        return Bun::ERR::MISSING_ARGS(scope, globalObject, "The \"domain\" argument must be specified"_s);

    // Node stringifies the argument (`${domain}`), so undefined parses as
    // the domain "undefined".
    auto domain = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto host = WTF::domainToASCII(domain);
    if (host.isNull())
        return JSC::JSValue::encode(jsEmptyString(vm));
    return JSC::JSValue::encode(JSC::jsString(vm, host));
}

JSC_DEFINE_HOST_FUNCTION(jsDomainToUnicode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1)
        return Bun::ERR::MISSING_ARGS(scope, globalObject, "The \"domain\" argument must be specified"_s);

    auto domain = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto unicode = WTF::domainToUnicode(domain);
    if (unicode.length() > maxVectorSize<char16_t>()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    if (unicode.isNull())
        return JSC::JSValue::encode(jsEmptyString(vm));
    return JSC::JSValue::encode(JSC::jsString(vm, unicode));
}

// Standalone UTS #46 domain-to-ascii (Node's encoding_binding toASCII, i.e.
// ada::idna::to_ascii): returns "" on failure. url.parse's IDNA step — unlike
// domainToASCII, no host parsing (no IPv4 canonicalization, ':' allowed, ...).
JSC_DEFINE_HOST_FUNCTION(jsIDNAToASCII, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto input = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto result = WTF::nameToASCII(input, WTF::OnNameError::Fail);
    if (result.isNull())
        return JSC::JSValue::encode(jsEmptyString(vm));
    return JSC::JSValue::encode(JSC::jsString(vm, result));
}

// internalBinding('icu') shims for the vendored node test suite; the JS shim
// (internal/test/binding) adds hasConverter on top of this object.
JSC_DEFINE_HOST_FUNCTION(jsIcuToASCII, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto input = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    bool lenient = callFrame->argument(1).toBoolean(globalObject);

    auto result = WTF::nameToASCII(input, lenient ? WTF::OnNameError::Ignore : WTF::OnNameError::Fail);
    if (result.isNull()) {
        throwException(globalObject, scope, createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, "Cannot convert name to ASCII"_s));
        return {};
    }
    return JSC::JSValue::encode(JSC::jsString(vm, result));
}

JSC_DEFINE_HOST_FUNCTION(jsIcuToUnicode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto input = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto result = WTF::nameToUnicode(input);
    if (result.isNull()) {
        throwException(globalObject, scope, createError(globalObject, ErrorCode::ERR_INVALID_ARG_VALUE, "Cannot convert name to Unicode"_s));
        return {};
    }
    return JSC::JSValue::encode(JSC::jsString(vm, result));
}

JSC::JSValue createNodeURLBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto binding = constructEmptyArray(globalObject, nullptr, 3);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(binding);
    auto domainToAsciiFunction = JSC::JSFunction::create(vm, globalObject, 1, "domainToAscii"_s, jsDomainToASCII, ImplementationVisibility::Public);
    ASSERT(domainToAsciiFunction);
    auto domainToUnicodeFunction = JSC::JSFunction::create(vm, globalObject, 1, "domainToUnicode"_s, jsDomainToUnicode, ImplementationVisibility::Public);
    ASSERT(domainToUnicodeFunction);
    auto idnaToASCIIFunction = JSC::JSFunction::create(vm, globalObject, 1, "idnaToASCII"_s, jsIDNAToASCII, ImplementationVisibility::Public);
    ASSERT(idnaToASCIIFunction);
    binding->putByIndexInline(
        globalObject,
        (unsigned)0,
        domainToAsciiFunction,
        false);
    RETURN_IF_EXCEPTION(scope, {});
    binding->putByIndexInline(
        globalObject,
        (unsigned)1,
        domainToUnicodeFunction,
        false);
    RETURN_IF_EXCEPTION(scope, {});
    binding->putByIndexInline(
        globalObject,
        (unsigned)2,
        idnaToASCIIFunction,
        false);
    RETURN_IF_EXCEPTION(scope, {});
    return binding;
}

JSC::JSValue createNodeICUBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto* binding = JSC::constructEmptyObject(globalObject);
    binding->putDirect(vm, JSC::Identifier::fromString(vm, "toASCII"_s),
        JSC::JSFunction::create(vm, globalObject, 2, "toASCII"_s, jsIcuToASCII, ImplementationVisibility::Public), 0);
    binding->putDirect(vm, JSC::Identifier::fromString(vm, "toUnicode"_s),
        JSC::JSFunction::create(vm, globalObject, 1, "toUnicode"_s, jsIcuToUnicode, ImplementationVisibility::Public), 0);
    return binding;
}

} // namespace Bun
