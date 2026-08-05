#include "NodeURL.h"
#include "wtf/URLParser.h"
#include <unicode/uidna.h>

namespace Bun {

// RFC 3492 Punycode encoder without ICU's ENCODE_MAX_CODE_UNITS (=1000) cap.
// Used as a fallback when a single label is too long for u_strToPunycode.
// Appends the encoding of `label` (UTF-16) to `out`, not including the "xn--" prefix.
static bool punycodeEncodeLabel(std::span<const char16_t> label, Vector<char16_t>& out)
{
    constexpr char32_t base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
    constexpr char32_t initialBias = 72, initialN = 0x80;
    auto adapt = [](char32_t delta, char32_t numPoints, bool firstTime) {
        delta = firstTime ? delta / damp : delta / 2;
        delta += delta / numPoints;
        char32_t k = 0;
        while (delta > ((base - tMin) * tMax) / 2) {
            delta /= base - tMin;
            k += base;
        }
        return k + (base - tMin + 1) * delta / (delta + skew);
    };
    auto encodeDigit = [](char32_t d) -> char16_t {
        return static_cast<char16_t>(d + (d < 26 ? 'a' : ('0' - 26)));
    };

    Vector<char32_t, 256> codePoints;
    codePoints.reserveCapacity(label.size());
    for (size_t i = 0; i < label.size(); ++i) {
        char16_t c = label[i];
        if (U16_IS_LEAD(c) && i + 1 < label.size() && U16_IS_TRAIL(label[i + 1])) {
            codePoints.append(U16_GET_SUPPLEMENTARY(c, label[i + 1]));
            ++i;
        } else if (U16_IS_SURROGATE(c)) {
            return false;
        } else
            codePoints.append(c);
    }

    char32_t n = initialN, bias = initialBias;
    size_t handled = 0;
    for (auto cp : codePoints) {
        if (cp < 0x80) {
            out.append(static_cast<char16_t>(cp));
            ++handled;
        }
    }
    size_t basic = handled;
    if (basic)
        out.append('-');

    WTF::CheckedUint32 delta = 0;
    while (handled < codePoints.size()) {
        char32_t m = std::numeric_limits<char32_t>::max();
        for (auto cp : codePoints) {
            if (cp >= n && cp < m)
                m = cp;
        }
        delta += WTF::CheckedUint32(m - n) * WTF::CheckedUint32(static_cast<uint32_t>(handled + 1));
        if (delta.hasOverflowed())
            return false;
        n = m;
        for (auto cp : codePoints) {
            if (cp < n) {
                delta += 1;
                if (delta.hasOverflowed())
                    return false;
            } else if (cp == n) {
                char32_t q = delta.value();
                for (char32_t k = base;; k += base) {
                    char32_t t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
                    if (q < t)
                        break;
                    out.append(encodeDigit(t + (q - t) % (base - t)));
                    q = (q - t) / (base - t);
                }
                out.append(encodeDigit(q));
                bias = adapt(delta.value(), static_cast<char32_t>(handled + 1), handled == basic);
                delta = 0;
                ++handled;
            }
        }
        delta += 1;
        ++n;
    }
    return true;
}

// Fallback for uidna_nameToASCII when a label exceeds ICU's ENCODE_MAX_CODE_UNITS:
// run UTS #46 ToUnicode (which does mapping/NFC/validation but no Punycode encode
// for non-ACE labels) then Punycode-encode each non-ASCII label ourselves.
static bool nameToASCIIFallback(const UIDNA& transcoder, const char16_t* src, int32_t srcLength, Vector<char16_t>& ascii, UIDNAInfo& processingDetails)
{
    Vector<char16_t> unicode;
    UIDNAInfo unicodeInfo = UIDNA_INFO_INITIALIZER;
    UErrorCode error = U_ZERO_ERROR;
    int32_t len = uidna_nameToUnicode(&transcoder, src, srcLength, nullptr, 0, &unicodeInfo, &error);
    if (error != U_BUFFER_OVERFLOW_ERROR || len <= 0)
        return false;
    if (!unicode.tryGrow(static_cast<size_t>(len)))
        return false;
    error = U_ZERO_ERROR;
    unicodeInfo = UIDNA_INFO_INITIALIZER;
    len = uidna_nameToUnicode(&transcoder, src, srcLength, unicode.mutableSpan().data(), static_cast<int32_t>(unicode.size()), &unicodeInfo, &error);
    if (U_FAILURE(error))
        return false;
    unicode.shrink(static_cast<size_t>(len));
    processingDetails.errors = unicodeInfo.errors;
    if (unicodeInfo.errors & ~WTF::URLParser::allowedNameToASCIIErrors)
        return false;

    ascii.reserveCapacity(unicode.size() + 16);
    size_t labelStart = 0;
    auto emitLabel = [&](size_t start, size_t end) -> bool {
        auto label = unicode.subspan(start, end - start);
        bool allAscii = true;
        for (auto c : label) {
            if (c >= 0x80) {
                allAscii = false;
                break;
            }
        }
        if (allAscii) {
            ascii.append(label);
            if (label.size() > 63)
                processingDetails.errors |= UIDNA_ERROR_LABEL_TOO_LONG;
            return true;
        }
        size_t before = ascii.size();
        ascii.append('x');
        ascii.append('n');
        ascii.append('-');
        ascii.append('-');
        if (!punycodeEncodeLabel(label, ascii))
            return false;
        if (ascii.size() - before > 63)
            processingDetails.errors |= UIDNA_ERROR_LABEL_TOO_LONG;
        return true;
    };
    for (size_t i = 0; i < unicode.size(); ++i) {
        if (unicode[i] == '.') {
            if (!emitLabel(labelStart, i))
                return false;
            ascii.append('.');
            labelStart = i + 1;
        }
    }
    if (!emitLabel(labelStart, unicode.size()))
        return false;
    if (ascii.size() > 253 && (ascii.size() > 254 || ascii.last() != '.'))
        processingDetails.errors |= UIDNA_ERROR_DOMAIN_NAME_TOO_LONG;
    return true;
}

static bool domainNameToASCII(StringView domain, Vector<char16_t>& ascii, UIDNAInfo& processingDetails)
{
    auto source = domain.upconvertedCharacters();
    const auto& transcoder = WTF::URLParser::internationalDomainNameTranscoder();
    UErrorCode error = U_ZERO_ERROR;
    processingDetails = UIDNA_INFO_INITIALIZER;
    std::array<char16_t, WTF::URLParser::hostnameBufferLength> buffer;
    int32_t len = uidna_nameToASCII(&transcoder, source, domain.length(), buffer.data(), buffer.size(), &processingDetails, &error);
    if (error == U_BUFFER_OVERFLOW_ERROR && len > 0) {
        if (!ascii.tryGrow(static_cast<size_t>(len)))
            return false;
        error = U_ZERO_ERROR;
        processingDetails = UIDNA_INFO_INITIALIZER;
        len = uidna_nameToASCII(&transcoder, source, domain.length(), ascii.mutableSpan().data(), static_cast<int32_t>(ascii.size()), &processingDetails, &error);
        if (U_SUCCESS(error) && len > 0) {
            ascii.shrink(static_cast<size_t>(len));
            return true;
        }
        ascii.clear();
    }
    if (error == U_INPUT_TOO_LONG_ERROR)
        return nameToASCIIFallback(transcoder, source, domain.length(), ascii, processingDetails);
    if (!U_SUCCESS(error) || len <= 0)
        return false;
    ascii.append(std::span { buffer }.first(static_cast<size_t>(len)));
    return true;
}

static bool domainNameToUnicode(StringView domain, Vector<char16_t>& out, UIDNAInfo& processingDetails)
{
    auto source = domain.upconvertedCharacters();
    const auto& transcoder = WTF::URLParser::internationalDomainNameTranscoder();
    UErrorCode error = U_ZERO_ERROR;
    processingDetails = UIDNA_INFO_INITIALIZER;
    std::array<char16_t, WTF::URLParser::hostnameBufferLength> buffer;
    int32_t len = uidna_nameToUnicode(&transcoder, source, domain.length(), buffer.data(), buffer.size(), &processingDetails, &error);
    if (error == U_BUFFER_OVERFLOW_ERROR && len > 0) {
        if (!out.tryGrow(static_cast<size_t>(len)))
            return false;
        error = U_ZERO_ERROR;
        processingDetails = UIDNA_INFO_INITIALIZER;
        len = uidna_nameToUnicode(&transcoder, source, domain.length(), out.mutableSpan().data(), static_cast<int32_t>(out.size()), &processingDetails, &error);
        if (U_SUCCESS(error) && len > 0) {
            out.shrink(static_cast<size_t>(len));
            return true;
        }
        out.clear();
        return false;
    }
    if (!U_SUCCESS(error) || len <= 0)
        return false;
    out.append(std::span { buffer }.first(static_cast<size_t>(len)));
    return true;
}

JSC_DEFINE_HOST_FUNCTION(jsDomainToASCII, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "domainToASCII needs 1 argument"_s);
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

    Vector<char16_t> hostnameBuffer;
    UIDNAInfo processingDetails = UIDNA_INFO_INITIALIZER;
    if (domainNameToASCII(domain, hostnameBuffer, processingDetails)
        && !(processingDetails.errors & ~WTF::URLParser::allowedNameToASCIIErrors) && !hostnameBuffer.isEmpty()) {
        Vector<Latin1Character> ascii;
        ascii.reserveInitialCapacity(hostnameBuffer.size());
        for (auto c : hostnameBuffer)
            ascii.append(static_cast<Latin1Character>(c));
        return JSC::JSValue::encode(JSC::jsString(vm, WTF::String(ascii.span())));
    }
    return JSC::JSValue::encode(jsEmptyString(vm));
}

JSC_DEFINE_HOST_FUNCTION(jsDomainToUnicode, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1) {
        throwTypeError(globalObject, scope, "domainToUnicode needs 1 argument"_s);
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

    constexpr static int allowedNameToUnicodeErrors = UIDNA_ERROR_EMPTY_LABEL | UIDNA_ERROR_LABEL_TOO_LONG | UIDNA_ERROR_DOMAIN_NAME_TOO_LONG | UIDNA_ERROR_LEADING_HYPHEN | UIDNA_ERROR_TRAILING_HYPHEN | UIDNA_ERROR_HYPHEN_3_4;

    Vector<char16_t> hostnameBuffer;
    UIDNAInfo processingDetails = UIDNA_INFO_INITIALIZER;
    if (domainNameToUnicode(domain, hostnameBuffer, processingDetails)
        && !(processingDetails.errors & ~allowedNameToUnicodeErrors) && !hostnameBuffer.isEmpty()) {
        return JSC::JSValue::encode(JSC::jsString(vm, WTF::String(hostnameBuffer.span())));
    }
    return JSC::JSValue::encode(jsEmptyString(vm));
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
