#include "NodeURL.h"
#include "ErrorCode.h"
#include "wtf/URL.h"
#include "wtf/URLParser.h"
#include <unicode/uidna.h>

namespace Bun {

// The UTS #46 instances Node used: CheckHyphens and VerifyDnsLength are
// handled by filtering the corresponding errors after the fact.
static UIDNA* toASCIIIDNA()
{
    static UIDNA* instance = [] {
        UErrorCode status = U_ZERO_ERROR;
        UIDNA* idna = uidna_openUTS46(UIDNA_CHECK_BIDI | UIDNA_CHECK_CONTEXTJ | UIDNA_NONTRANSITIONAL_TO_ASCII, &status);
        RELEASE_ASSERT(U_SUCCESS(status));
        return idna;
    }();
    return instance;
}

static UIDNA* toUnicodeIDNA()
{
    static UIDNA* instance = [] {
        UErrorCode status = U_ZERO_ERROR;
        UIDNA* idna = uidna_openUTS46(UIDNA_NONTRANSITIONAL_TO_UNICODE, &status);
        RELEASE_ASSERT(U_SUCCESS(status));
        return idna;
    }();
    return instance;
}

enum class IDNAMode : uint8_t {
    Default,
    Lenient,
};

// Runs a uidna_nameTo* conversion with the U_BUFFER_OVERFLOW_ERROR retry
// protocol; on completion `status`/`info` hold the final results.
using UIDNAFunction = int32_t (*)(const UIDNA*, const char16_t*, int32_t, char16_t*, int32_t, UIDNAInfo*, UErrorCode*);

static String runUIDNA(UIDNAFunction convert, const UIDNA* idna, const String& input, UErrorCode& status, UIDNAInfo& info)
{
    String domain = input;
    if (domain.is8Bit())
        domain.convertTo16Bit();
    const auto span = domain.span16();

    Vector<char16_t, 256> buffer(256);
    int32_t length = convert(idna, span.data(), span.size(), buffer.begin(), buffer.size(), &info, &status);
    if (status == U_BUFFER_OVERFLOW_ERROR) {
        status = U_ZERO_ERROR;
        info = UIDNA_INFO_INITIALIZER;
        buffer.grow(length);
        length = convert(idna, span.data(), span.size(), buffer.begin(), buffer.size(), &info, &status);
    }
    if (U_FAILURE(status))
        return {};
    return String(std::span { buffer.begin(), static_cast<size_t>(length) });
}

// Port of Node's icu-based ToASCII (removed in nodejs/node#55156):
// https://github.com/nodejs/node/blob/9f5000e0f2a2^/src/node_i18n.cc — filter
// the CheckHyphens/VerifyDnsLength error classes, fail otherwise unless lenient.
static String icuToASCII(const String& input, IDNAMode mode)
{
    // Fast path: an all-ASCII domain with no punycode labels only needs
    // lowercasing (hyphen and label-length errors are filtered anyway).
    if (input.containsOnlyASCII()) {
        auto lowered = input.convertToASCIILowercase();
        if (!lowered.contains("xn--"_s))
            return lowered;
    }

    UErrorCode status = U_ZERO_ERROR;
    UIDNAInfo info = UIDNA_INFO_INITIALIZER;
    auto result = runUIDNA(uidna_nameToASCII, toASCIIIDNA(), input, status, info);

    // CheckHyphens = false
    info.errors &= ~UIDNA_ERROR_HYPHEN_3_4;
    info.errors &= ~UIDNA_ERROR_LEADING_HYPHEN;
    info.errors &= ~UIDNA_ERROR_TRAILING_HYPHEN;
    // VerifyDnsLength = false
    info.errors &= ~UIDNA_ERROR_EMPTY_LABEL;
    info.errors &= ~UIDNA_ERROR_LABEL_TOO_LONG;
    info.errors &= ~UIDNA_ERROR_DOMAIN_NAME_TOO_LONG;

    if (result.isNull() || (mode != IDNAMode::Lenient && info.errors != 0))
        return {};
    return result;
}

// Port of Node's icu-based ToUnicode (removed in nodejs/node#55156): UTS #46
// ToUnicode always produces output, so info.errors is deliberately ignored.
static String icuToUnicode(const String& input)
{
    UErrorCode status = U_ZERO_ERROR;
    UIDNAInfo info = UIDNA_INFO_INITIALIZER;
    return runUIDNA(uidna_nameToUnicode, toUnicodeIDNA(), input, status, info);
}

// WebKit's host parser fast-paths all-ASCII hosts without decoding xn--
// labels; ada (Node) decodes and validates them. Used to reject hosts whose
// punycode labels fail UTS #46.
bool hasValidPunycodeHost(WTF::StringView host)
{
    if (!host.contains("xn--"_s))
        return true;
    return !icuToASCII(host.toString(), IDNAMode::Default).isNull();
}

// Mirrors Node's url.domainToASCII/domainToUnicode, which run the input
// through a WHATWG URL host parse (ada's url.set_hostname on a "ws://x"
// base). Returns a null String when host parsing fails.
static String parseDomainAsHost(const String& domain)
{
    // The hostname setter's basic-URL parse stops at the first path, query,
    // fragment, or backslash (special scheme) terminator.
    StringView view { domain };
    size_t end = view.length();
    for (size_t i = 0; i < view.length(); i++) {
        char16_t c = view[i];
        if (c == '/' || c == '?' || c == '#' || c == '\\') {
            end = i;
            break;
        }
    }
    String host = domain.left(end);
    if (host.isEmpty())
        return {};

    if (host.startsWith('[')) {
        // A bracketed host must be nothing but the IPv6 literal; anything
        // after ']' (including a port) fails the hostname setter.
        if (!host.endsWith(']'))
            return {};
    } else {
        // Outside brackets, ':' (hostname setters reject ports) and '@'
        // (would otherwise parse as userinfo) fail host parsing.
        if (host.contains(':') || host.contains('@'))
            return {};
    }

    WTF::URL url(makeString("ws://"_s, host, "/"_s));
    if (!url.isValid())
        return {};

    String parsedHost = url.host().toString();
    if (!hasValidPunycodeHost(parsedHost))
        return {};
    return parsedHost;
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

    auto host = parseDomainAsHost(domain);
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

    // Node: validate through the host parse first, then run ToUnicode on the
    // resulting ASCII host.
    auto host = parseDomainAsHost(domain);
    if (host.isNull())
        return JSC::JSValue::encode(jsEmptyString(vm));

    auto unicode = icuToUnicode(host);
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

    auto result = icuToASCII(input, IDNAMode::Default);
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

    auto result = icuToASCII(input, lenient ? IDNAMode::Lenient : IDNAMode::Default);
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

    auto result = icuToUnicode(input);
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
    binding->putByIndexInline(
        globalObject,
        (unsigned)1,
        domainToUnicodeFunction,
        false);
    binding->putByIndexInline(
        globalObject,
        (unsigned)2,
        idnaToASCIIFunction,
        false);
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
