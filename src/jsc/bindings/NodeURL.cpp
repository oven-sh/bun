#include "NodeURL.h"
#include "ASCIIHostPunycodeCheck.h"
#include "ErrorCode.h"
#include "wtf/URL.h"
#include "wtf/URLParser.h"
#include "wtf/text/StringBuilder.h"
#include <unicode/uidna.h>

namespace Bun {

// The host parser's error filter: CheckHyphens and VerifyDnsLength are off.
static bool hasIDNAError(const UIDNAInfo& info)
{
    return info.errors & ~WTF::URLParser::allowedNameToASCIIErrors;
}

enum class IDNAMode : uint8_t {
    Default,
    Lenient,
};

// Runs a uidna_*To* conversion on the host parser's UTS #46 instance. The returned span points into `buffer`.
using UIDNAFunction = int32_t (*)(const UIDNA*, const char16_t*, int32_t, char16_t*, int32_t, UIDNAInfo*, UErrorCode*);
using UIDNABuffer = Vector<char16_t, 256>;

static std::optional<std::span<const char16_t>> runUIDNA(UIDNAFunction convert, std::span<const char16_t> input, UIDNABuffer& buffer, UIDNAInfo& info)
{
    const UIDNA* idna = &WTF::URLParser::internationalDomainNameTranscoder();
    UErrorCode status = U_ZERO_ERROR;
    buffer.grow(buffer.capacity());
    int32_t length = convert(idna, input.data(), input.size(), buffer.begin(), buffer.size(), &info, &status);
    if (status == U_BUFFER_OVERFLOW_ERROR) {
        status = U_ZERO_ERROR;
        info = UIDNA_INFO_INITIALIZER;
        buffer.grow(length);
        length = convert(idna, input.data(), input.size(), buffer.begin(), buffer.size(), &info, &status);
    }
    if (U_FAILURE(status))
        return std::nullopt;
    return buffer.span().first(length);
}

static String runUIDNA(UIDNAFunction convert, const String& input, UIDNAInfo& info)
{
    String domain = input;
    if (domain.is8Bit())
        domain.convertTo16Bit();

    UIDNABuffer buffer;
    auto output = runUIDNA(convert, domain.span16(), buffer, info);
    if (!output)
        return {};
    return String(*output);
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

    UIDNAInfo info = UIDNA_INFO_INITIALIZER;
    auto result = runUIDNA(uidna_nameToASCII, input, info);
    if (result.isNull() || (mode != IDNAMode::Lenient && hasIDNAError(info)))
        return {};
    return result;
}

// Port of Node's icu-based ToUnicode (removed in nodejs/node#55156): UTS #46
// ToUnicode always produces output, so info.errors is deliberately ignored.
static String icuToUnicode(const String& input)
{
    UIDNAInfo info = UIDNA_INFO_INITIALIZER;
    return runUIDNA(uidna_nameToUnicode, input, info);
}

static bool hasACEPrefix(std::span<const char16_t> label)
{
    return label.size() >= 4 && label[0] == 'x' && label[1] == 'n' && label[2] == '-' && label[3] == '-';
}

// Per-label ToUnicode of a parsed host: uidna_nameToUnicode moves the rest of the name for each decoded label.
static String icuParsedHostToUnicode(const String& host)
{
    if (!host.contains("xn--"_s))
        return host;

    String domain = host;
    if (domain.is8Bit())
        domain.convertTo16Bit();
    const auto span = domain.span16();

    StringBuilder result { OverflowPolicy::RecordOverflow };
    result.reserveCapacity(span.size());
    UIDNABuffer buffer;
    size_t labelStart = 0;
    while (true) {
        size_t labelEnd = labelStart;
        while (labelEnd < span.size() && span[labelEnd] != '.')
            labelEnd++;
        auto label = span.subspan(labelStart, labelEnd - labelStart);

        if (hasACEPrefix(label)) {
            UIDNAInfo info = UIDNA_INFO_INITIALIZER;
            auto unicode = runUIDNA(uidna_labelToUnicode, label, buffer, info);
            if (!unicode)
                return {};
            // ada::idna::to_unicode keeps a label that fails UTS #46. ICU before 76 accepts a decoded "xn--" prefix.
            result.append(hasIDNAError(info) || hasACEPrefix(*unicode) ? label : *unicode);
        } else {
            result.append(label);
        }

        if (labelEnd == span.size())
            break;
        result.append('.');
        labelStart = labelEnd + 1;
    }
    // The decoded labels can add up to more than String::MaxLength.
    if (result.hasOverflowed()) [[unlikely]]
        return {};
    return result.toString();
}

// WebKit's host parser fast-paths all-ASCII hosts without decoding xn--
// labels; ada (Node) decodes and validates them. Used to reject hosts whose
// punycode labels fail UTS #46.
bool hasValidPunycodeHost(WTF::StringView host)
{
    if (!host.contains("xn--"_s))
        return true;
    if (host.containsOnlyASCII()) {
        auto verdict = host.is8Bit() ? checkASCIIHostPunycode(host.span8().data(), host.length()) : checkASCIIHostPunycode(host.span16().data(), host.length());
        if (verdict != ASCIIHostPunycodeVerdict::NeedsFullCheck)
            return verdict == ASCIIHostPunycodeVerdict::Valid;
    }
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

// idnaToASCII for the certificate check in src/boringssl/lib.rs, on any thread. Not parseDomainAsHost, which cuts the name at '/'. Dead when the name does not convert.
extern "C" BunString Bun__idnaToASCII(const BunString* domain)
{
    auto ascii = icuToASCII(domain->toWTFString(), IDNAMode::Default);
    if (ascii.isNull())
        return { BunStringTag::Dead };
    return Bun::toStringRef(ascii);
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

    auto unicode = icuParsedHostToUnicode(host);
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
