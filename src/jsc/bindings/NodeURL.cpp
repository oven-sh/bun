#include "NodeURL.h"
#include <wtf/URL.h>
#include <wtf/URLParser.h>
#include <unicode/uidna.h>

namespace Bun {

enum class IDNAMode : bool { ToASCII,
    ToUnicode };

// node defines url.domainToASCII and url.domainToUnicode in terms of the WHATWG
// host parser: set the input as the host of "ws://x" and report any failure as
// "". URL::setHost runs that parser, which already percent-decodes, rejects
// forbidden domain code points, and canonicalizes IPv4. It takes a fast path
// for all-ASCII hosts that skips UTS #46, so run the real nameTo{ASCII,Unicode}
// on the parsed host to also reject invalid Punycode in xn-- labels (and, for
// ToUnicode, produce the decoded form). A null return means the input is not a
// valid domain.
static WTF::String processDomain(const WTF::String& domain, IDNAMode mode)
{
    WTF::URL url { "ws://x"_str };
    if (!url.setHost(domain))
        return {};

    WTF::String host = url.host().toString();
    // IPv6 literals are not domains. The URL parser only applies IDNA up to
    // hostnameBufferLength, so longer hosts pass through unvalidated there too.
    if (host.startsWith('[') || host.length() > WTF::URLParser::hostnameBufferLength)
        return host;

    if (host.is8Bit())
        host.convertTo16Bit();
    const auto span = host.span16();

    char16_t buffer[WTF::URLParser::hostnameBufferLength];
    UErrorCode error = U_ZERO_ERROR;
    UIDNAInfo processingDetails = UIDNA_INFO_INITIALIZER;
    auto* encoder = &WTF::URLParser::internationalDomainNameTranscoder();
    int32_t numCharactersConverted = mode == IDNAMode::ToASCII
        ? uidna_nameToASCII(encoder, span.data(), span.size(), buffer, WTF::URLParser::hostnameBufferLength, &processingDetails, &error)
        : uidna_nameToUnicode(encoder, span.data(), span.size(), buffer, WTF::URLParser::hostnameBufferLength, &processingDetails, &error);

    if (!U_SUCCESS(error) || (processingDetails.errors & ~WTF::URLParser::allowedNameToASCIIErrors) || numCharactersConverted <= 0)
        return {};
    return WTF::String(std::span { buffer, static_cast<size_t>(numCharactersConverted) });
}

static JSC::EncodedJSValue domainTo(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, IDNAMode mode, ASCIILiteral missingArgumentMessage)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, missingArgumentMessage);
        return {};
    }

    auto arg0 = callFrame->argument(0);
    if (arg0.isUndefined())
        return JSC::JSValue::encode(jsUndefined());
    if (arg0.isNull())
        return JSC::JSValue::encode(jsNull());
    if (!arg0.isString()) {
        throwTypeError(globalObject, scope, "the \"domain\" argument must be a string"_s);
        return {};
    }

    auto domain = arg0.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    auto result = processDomain(domain, mode);
    if (result.isNull())
        return JSC::JSValue::encode(jsEmptyString(vm));
    return JSC::JSValue::encode(JSC::jsString(vm, WTF::move(result)));
}

JSC_DEFINE_HOST_FUNCTION(jsDomainToASCII, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return domainTo(globalObject, callFrame, IDNAMode::ToASCII, "domainToASCII needs 1 argument"_s);
}

JSC_DEFINE_HOST_FUNCTION(jsDomainToUnicode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return domainTo(globalObject, callFrame, IDNAMode::ToUnicode, "domainToUnicode needs 1 argument"_s);
}

JSC::JSValue createNodeURLBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto binding = constructEmptyArray(globalObject, nullptr, 2);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(binding);
    auto domainToAsciiFunction = JSC::JSFunction::create(vm, globalObject, 1, "domainToAscii"_s, jsDomainToASCII, ImplementationVisibility::Public);
    ASSERT(domainToAsciiFunction);
    auto domainToUnicodeFunction = JSC::JSFunction::create(vm, globalObject, 1, "domainToUnicode"_s, jsDomainToUnicode, ImplementationVisibility::Public);
    ASSERT(domainToUnicodeFunction);
    binding->putByIndexInline(
        globalObject,
        (unsigned)0,
        domainToAsciiFunction,
        false);
    binding->putByIndexInline(
        globalObject,
        (unsigned)1,
        domainToUnicodeFunction,
        false);
    return binding;
}

} // namespace Bun
