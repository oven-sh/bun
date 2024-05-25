#include "NodeURL.h"
#include "wtf/URLParser.h"
#include <unicode/uidna.h>

namespace Bun {

JSC_DEFINE_HOST_FUNCTION(jsDomainToASCII, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "domainToASCII needs 1 argument"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto arg0 = callFrame->argument(0);
    if (arg0.isUndefined())
        return JSC::JSValue::encode(jsUndefined());
    if (arg0.isNull())
        return JSC::JSValue::encode(jsNull());
    if (!arg0.isString()) {
        throwTypeError(globalObject, scope, "the \"domain\" argument must be a string"_s);
        return JSC::JSValue::encode(jsUndefined());
    }

    auto domain = arg0.toWTFString(globalObject);
    if (domain.isNull())
        return JSC::JSValue::encode(jsUndefined());

    // https://url.spec.whatwg.org/#forbidden-host-code-point
    if (
        domain.contains(0x0000) || // U+0000 NULL
        domain.contains(0x0009) || // U+0009 TAB
        domain.contains(0x000A) || // U+000A LF
        domain.contains(0x000D) || // U+000D CR
        domain.contains(0x0020) || // U+0020 SPACE
        domain.contains(0x0023) || // U+0023 (#)
        domain.contains(0x002F) || // U+002F (/)
        domain.contains(0x003A) || // U+003A (:)
        domain.contains(0x003C) || // U+003C (<)
        domain.contains(0x003E) || // U+003E (>)
        domain.contains(0x003F) || // U+003F (?)
        domain.contains(0x0040) || // U+0040 (@)
        domain.contains(0x005B) || // U+005B ([)
        domain.contains(0x005C) || // U+005C (\)
        domain.contains(0x005D) || // U+005D (])
        domain.contains(0x005E) || // U+005E (^)
        domain.contains(0x007C) // // U+007C (|).
    )
        return JSC::JSValue::encode(jsEmptyString(vm));

    if (domain.containsOnlyASCII())
        return JSC::JSValue::encode(arg0);
    if (domain.is8Bit())
        domain.convertTo16Bit();

    constexpr static int allowedNameToASCIIErrors = UIDNA_ERROR_EMPTY_LABEL | UIDNA_ERROR_LABEL_TOO_LONG | UIDNA_ERROR_DOMAIN_NAME_TOO_LONG | UIDNA_ERROR_LEADING_HYPHEN | UIDNA_ERROR_TRAILING_HYPHEN | UIDNA_ERROR_HYPHEN_3_4;
    constexpr static size_t hostnameBufferLength = 2048;

    auto encoder = &WTF::URLParser::internationalDomainNameTranscoder();
    UChar hostnameBuffer[hostnameBufferLength];
    UErrorCode error = U_ZERO_ERROR;
    UIDNAInfo processingDetails = UIDNA_INFO_INITIALIZER;
    const auto span = domain.span16();
    int32_t numCharactersConverted = uidna_nameToASCII(encoder, span.data(), span.size(), hostnameBuffer, hostnameBufferLength, &processingDetails, &error);

    if (U_SUCCESS(error) && !(processingDetails.errors & ~allowedNameToASCIIErrors) && numCharactersConverted) {
        return JSC::JSValue::encode(JSC::jsString(vm, WTF::String(std::span { hostnameBuffer, static_cast<unsigned int>(numCharactersConverted) })));
    }
    throwTypeError(globalObject, scope, "domainToASCII failed"_s);
    return JSC::JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsDomainToUnicode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "domainToUnicode needs 1 argument"_s);
        return JSC::JSValue::encode(JSC::JSValue {});
    }

    auto arg0 = callFrame->argument(0);
    if (arg0.isUndefined())
        return JSC::JSValue::encode(jsUndefined());
    if (arg0.isNull())
        return JSC::JSValue::encode(jsNull());
    if (!arg0.isString()) {
        throwTypeError(globalObject, scope, "the \"domain\" argument must be a string"_s);
        return JSC::JSValue::encode(jsUndefined());
    }

    auto domain = arg0.toWTFString(globalObject);
    if (domain.isNull())
        return JSC::JSValue::encode(jsUndefined());

    // https://url.spec.whatwg.org/#forbidden-host-code-point
    if (
        domain.contains(0x0000) || // U+0000 NULL
        domain.contains(0x0009) || // U+0009 TAB
        domain.contains(0x000A) || // U+000A LF
        domain.contains(0x000D) || // U+000D CR
        domain.contains(0x0020) || // U+0020 SPACE
        domain.contains(0x0023) || // U+0023 (#)
        domain.contains(0x002F) || // U+002F (/)
        domain.contains(0x003A) || // U+003A (:)
        domain.contains(0x003C) || // U+003C (<)
        domain.contains(0x003E) || // U+003E (>)
        domain.contains(0x003F) || // U+003F (?)
        domain.contains(0x0040) || // U+0040 (@)
        domain.contains(0x005B) || // U+005B ([)
        domain.contains(0x005C) || // U+005C (\)
        domain.contains(0x005D) || // U+005D (])
        domain.contains(0x005E) || // U+005E (^)
        domain.contains(0x007C) // // U+007C (|).
    )
        return JSC::JSValue::encode(jsEmptyString(vm));

    if (!domain.is8Bit())
        // this function is only for undoing punycode so its okay if utf-16 text makes it out unchanged.
        return JSC::JSValue::encode(arg0);

    domain.convertTo16Bit();

    constexpr static int allowedNameToUnicodeErrors = UIDNA_ERROR_EMPTY_LABEL | UIDNA_ERROR_LABEL_TOO_LONG | UIDNA_ERROR_DOMAIN_NAME_TOO_LONG | UIDNA_ERROR_LEADING_HYPHEN | UIDNA_ERROR_TRAILING_HYPHEN | UIDNA_ERROR_HYPHEN_3_4;
    constexpr static int hostnameBufferLength = 2048;

    auto encoder = &WTF::URLParser::internationalDomainNameTranscoder();
    UChar hostnameBuffer[hostnameBufferLength];
    UErrorCode error = U_ZERO_ERROR;
    UIDNAInfo processingDetails = UIDNA_INFO_INITIALIZER;

    const auto span = domain.span16();

    int32_t numCharactersConverted = uidna_nameToUnicode(encoder, span.data(), span.size(), hostnameBuffer, hostnameBufferLength, &processingDetails, &error);

    if (U_SUCCESS(error) && !(processingDetails.errors & ~allowedNameToUnicodeErrors) && numCharactersConverted) {
        return JSC::JSValue::encode(JSC::jsString(vm, WTF::String(std::span { hostnameBuffer, static_cast<unsigned int>(numCharactersConverted) })));
    }
    throwTypeError(globalObject, scope, "domainToUnicode failed"_s);
    return JSC::JSValue::encode(jsUndefined());
}

JSC::JSValue createNodeURLBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto binding = constructEmptyArray(globalObject, nullptr, 2);
    binding->putByIndexInline(
        globalObject,
        (unsigned)0,
        JSC::JSFunction::create(vm, globalObject, 1, "domainToAscii"_s, jsDomainToASCII, ImplementationVisibility::Public),
        false);
    binding->putByIndexInline(
        globalObject,
        (unsigned)1,
        JSC::JSFunction::create(vm, globalObject, 1, "domainToUnicode"_s, jsDomainToUnicode, ImplementationVisibility::Public),
        false);
    return binding;
}

} // namespace Bun
