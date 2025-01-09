/*
 * Copyright (C) 2004-2017 Apple Inc. All rights reserved.
 * Copyright (C) 2006 Alexey Proskuryakov <ap@nypop.com>
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "TextCodecICU.h"
#include "ZigGlobalObject.h"
#include "TextEncoding.h"
#include "TextEncodingRegistry.h"
// #include "ThreadGlobalData.h"
#include <array>
#include <unicode-ucnv_cb.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/Threading.h>
#include <wtf/text/CString.h>
#include "ParsingUtilities-removeAfterWebKitUpgrade.h"
#include <wtf/text/StringBuilder.h>
#include <wtf/unicode/CharacterNames.h>
#include <wtf/unicode/icu/ICUHelpers.h>
#include "ScriptExecutionContext.h"

namespace PAL {

WTF_MAKE_TZONE_ALLOCATED_IMPL(TextCodecICU);

const size_t ConversionBufferSize = 16384;

static ICUConverterWrapper& cachedConverterICU()
{
    return defaultGlobalObject()->scriptExecutionContext()->cachedConverterICU();
}

#define DECLARE_ALIASES(encoding, ...) \
    static constexpr ASCIILiteral encoding##_aliases[] { __VA_ARGS__ }

// From https://encoding.spec.whatwg.org. Plus a few extra aliases that macOS had historically from TEC.
DECLARE_ALIASES(ISO_8859_2, "csisolatin2"_s, "iso-ir-101"_s, "iso8859-2"_s, "iso88592"_s, "iso_8859-2"_s, "iso_8859-2:1987"_s, "l2"_s, "latin2"_s);
DECLARE_ALIASES(ISO_8859_4, "csisolatin4"_s, "iso-ir-110"_s, "iso8859-4"_s, "iso88594"_s, "iso_8859-4"_s, "iso_8859-4:1988"_s, "l4"_s, "latin4"_s);
DECLARE_ALIASES(ISO_8859_5, "csisolatincyrillic"_s, "cyrillic"_s, "iso-ir-144"_s, "iso8859-5"_s, "iso88595"_s, "iso_8859-5"_s, "iso_8859-5:1988"_s);
DECLARE_ALIASES(ISO_8859_10, "csisolatin6"_s, "iso-ir-157"_s, "iso8859-10"_s, "iso885910"_s, "l6"_s, "latin6"_s, "iso8859101992"_s, "isoir157"_s);
DECLARE_ALIASES(ISO_8859_13, "iso8859-13"_s, "iso885913"_s);
DECLARE_ALIASES(ISO_8859_14, "iso8859-14"_s, "iso885914"_s, "isoceltic"_s, "iso8859141998"_s, "isoir199"_s, "latin8"_s, "l8"_s);
DECLARE_ALIASES(ISO_8859_15, "csisolatin9"_s, "iso8859-15"_s, "iso885915"_s, "iso_8859-15"_s, "l9"_s);
DECLARE_ALIASES(ISO_8859_16, "isoir226"_s, "iso8859162001"_s, "l10"_s, "latin10"_s);
DECLARE_ALIASES(KOI8_R, "cskoi8r"_s, "koi"_s, "koi8"_s, "koi8_r"_s);
DECLARE_ALIASES(macintosh, "csmacintosh"_s, "mac"_s, "x-mac-roman"_s, "macroman"_s, "x-macroman"_s);
DECLARE_ALIASES(windows_1250, "cp1250"_s, "x-cp1250"_s, "winlatin2"_s);
DECLARE_ALIASES(windows_1251, "cp1251"_s, "wincyrillic"_s, "x-cp1251"_s);
DECLARE_ALIASES(windows_1254, "winturkish"_s, "cp1254"_s, "csisolatin5"_s, "iso-8859-9"_s, "iso-ir-148"_s, "iso8859-9"_s, "iso88599"_s, "iso_8859-9"_s, "iso_8859-9:1989"_s, "l5"_s, "latin5"_s, "x-cp1254"_s);
DECLARE_ALIASES(windows_1256, "winarabic"_s, "cp1256"_s, "x-cp1256"_s);
DECLARE_ALIASES(windows_1258, "winvietnamese"_s, "cp1258"_s, "x-cp1258"_s);
DECLARE_ALIASES(x_mac_cyrillic, "maccyrillic"_s, "x-mac-ukrainian"_s, "windows-10007"_s, "mac-cyrillic"_s, "maccy"_s, "x-MacCyrillic"_s, "x-MacUkraine"_s);
// Encodings below are not in the standard.
DECLARE_ALIASES(x_mac_greek, "windows-10006"_s, "macgr"_s, "x-MacGreek"_s);
DECLARE_ALIASES(x_mac_centraleurroman, "windows-10029"_s, "x-mac-ce"_s, "macce"_s, "maccentraleurope"_s, "x-MacCentralEurope"_s);
DECLARE_ALIASES(x_mac_turkish, "windows-10081"_s, "mactr"_s, "x-MacTurkish"_s);

#define DECLARE_ENCODING_NAME(encoding, alias_array)  \
    {                                                 \
        encoding, std::span { alias_array##_aliases } \
    }

#define DECLARE_ENCODING_NAME_NO_ALIASES(encoding) \
    {                                              \
        encoding, {}                               \
    }

static const struct EncodingName {
    ASCIILiteral name;
    std::span<const ASCIILiteral> aliases;
} encodingNames[] = {
    DECLARE_ENCODING_NAME("ISO-8859-2"_s, ISO_8859_2),
    DECLARE_ENCODING_NAME("ISO-8859-4"_s, ISO_8859_4),
    DECLARE_ENCODING_NAME("ISO-8859-5"_s, ISO_8859_5),
    DECLARE_ENCODING_NAME("ISO-8859-10"_s, ISO_8859_10),
    DECLARE_ENCODING_NAME("ISO-8859-13"_s, ISO_8859_13),
    DECLARE_ENCODING_NAME("ISO-8859-14"_s, ISO_8859_14),
    DECLARE_ENCODING_NAME("ISO-8859-15"_s, ISO_8859_15),
    DECLARE_ENCODING_NAME("ISO-8859-16"_s, ISO_8859_16),
    DECLARE_ENCODING_NAME("KOI8-R"_s, KOI8_R),
    DECLARE_ENCODING_NAME("macintosh"_s, macintosh),
    DECLARE_ENCODING_NAME("windows-1250"_s, windows_1250),
    DECLARE_ENCODING_NAME("windows-1251"_s, windows_1251),
    DECLARE_ENCODING_NAME("windows-1254"_s, windows_1254),
    DECLARE_ENCODING_NAME("windows-1256"_s, windows_1256),
    DECLARE_ENCODING_NAME("windows-1258"_s, windows_1258),
    DECLARE_ENCODING_NAME("x-mac-cyrillic"_s, x_mac_cyrillic),
    // Encodings below are not in the standard.
    DECLARE_ENCODING_NAME("x-mac-greek"_s, x_mac_greek),
    DECLARE_ENCODING_NAME("x-mac-centraleurroman"_s, x_mac_centraleurroman),
    DECLARE_ENCODING_NAME("x-mac-turkish"_s, x_mac_turkish),
    DECLARE_ENCODING_NAME_NO_ALIASES("EUC-TW"_s),
};

void TextCodecICU::registerEncodingNames(EncodingNameRegistrar registrar)
{
    for (auto& encodingName : encodingNames) {
        registrar(encodingName.name, encodingName.name);
        for (auto& alias : encodingName.aliases)
            registrar(alias, encodingName.name);
    }
}

void TextCodecICU::registerCodecs(TextCodecRegistrar registrar)
{
    for (auto& encodingName : encodingNames) {
        ASCIILiteral name = encodingName.name;

        UErrorCode error = U_ZERO_ERROR;
        const char* canonicalConverterName = ucnv_getCanonicalName(name, "IANA", &error);
        ASSERT(U_SUCCESS(error));
        if (!canonicalConverterName) {
            auto converter = ICUConverterPtr { ucnv_open(name, &error) };
            ASSERT(U_SUCCESS(error));
            canonicalConverterName = ucnv_getName(converter.get(), &error);
            ASSERT(U_SUCCESS(error));
            if (!canonicalConverterName) {
                ASSERT_NOT_REACHED();
                continue;
            }
        }
        registrar(name, [name, canonicalConverterName] {
            // ucnv_getCanonicalName() returns a static string owned by libicu so the call to
            // ASCIILiteral::fromLiteralUnsafe() should be safe.
            return makeUnique<TextCodecICU>(name, ASCIILiteral::fromLiteralUnsafe(canonicalConverterName));
        });
    }
}

TextCodecICU::TextCodecICU(ASCIILiteral encoding, ASCIILiteral canonicalConverterName)
    : m_encodingName(encoding)
    , m_canonicalConverterName(canonicalConverterName)
{
    ASSERT(!m_canonicalConverterName.isNull());
}

TextCodecICU::~TextCodecICU()
{
    if (m_converter) {
        ucnv_reset(m_converter.get());
        cachedConverterICU().converter = WTFMove(m_converter);
    }
}

void TextCodecICU::createICUConverter() const
{
    ASSERT(!m_converter);

    auto& cachedConverter = cachedConverterICU().converter;
    if (cachedConverter) {
        UErrorCode error = U_ZERO_ERROR;
        const char* cachedConverterName = ucnv_getName(cachedConverter.get(), &error);
        if (U_SUCCESS(error) && !strcmp(m_canonicalConverterName, cachedConverterName)) {
            m_converter = WTFMove(cachedConverter);
            return;
        }
    }

    UErrorCode error = U_ZERO_ERROR;
    m_converter = ICUConverterPtr { ucnv_open(m_canonicalConverterName, &error) };
    if (m_converter)
        ucnv_setFallback(m_converter.get(), true);
}

int TextCodecICU::decodeToBuffer(std::span<UChar> targetSpan, std::span<const uint8_t>& sourceSpan, int32_t* offsets, bool flush, UErrorCode& error)
{
    UChar* targetStart = targetSpan.data();
    error = U_ZERO_ERROR;
    auto* source = byteCast<char>(sourceSpan.data());
    auto* sourceLimit = byteCast<char>(std::to_address(sourceSpan.end()));
    auto* target = targetSpan.data();
    auto* targetLimit = std::to_address(targetSpan.end());
    ucnv_toUnicode(m_converter.get(), &target, targetLimit, &source, sourceLimit, offsets, flush, &error);
    skip(sourceSpan, byteCast<uint8_t>(source) - sourceSpan.data());
    return target - targetStart;
}

class ErrorCallbackSetter {
public:
    ErrorCallbackSetter(UConverter& converter, bool stopOnError)
        : m_converter(converter)
        , m_shouldStopOnEncodingErrors(stopOnError)
    {
        if (m_shouldStopOnEncodingErrors) {
            UErrorCode err = U_ZERO_ERROR;
            ucnv_setToUCallBack(&m_converter, UCNV_TO_U_CALLBACK_SUBSTITUTE, UCNV_SUB_STOP_ON_ILLEGAL, &m_savedAction, &m_savedContext, &err);
            ASSERT(U_SUCCESS(err));
        }
    }
    ~ErrorCallbackSetter()
    {
        if (m_shouldStopOnEncodingErrors) {
            UErrorCode err = U_ZERO_ERROR;
            const void* oldContext;
            UConverterToUCallback oldAction;
            ucnv_setToUCallBack(&m_converter, m_savedAction, m_savedContext, &oldAction, &oldContext, &err);
            ASSERT(oldAction == UCNV_TO_U_CALLBACK_SUBSTITUTE);
            ASSERT(!strcmp(static_cast<const char*>(oldContext), UCNV_SUB_STOP_ON_ILLEGAL));
            ASSERT(U_SUCCESS(err));
        }
    }

private:
    UConverter& m_converter;
    bool m_shouldStopOnEncodingErrors;
    const void* m_savedContext { nullptr };
    UConverterToUCallback m_savedAction { nullptr };
};

String TextCodecICU::decode(std::span<const uint8_t> source, bool flush, bool stopOnError, bool& sawError)
{
    // Get a converter for the passed-in encoding.
    if (!m_converter) {
        createICUConverter();
        if (!m_converter) {
            LOG_ERROR("error creating ICU encoder even though encoding was in table");
            sawError = true;
            return {};
        }
    }

    ErrorCallbackSetter callbackSetter(*m_converter, stopOnError);

    StringBuilder result;

    std::array<UChar, ConversionBufferSize> buffer;
    auto target = std::span { buffer };
    int32_t* offsets = nullptr;
    UErrorCode err = U_ZERO_ERROR;

    do {
        size_t ucharsDecoded = decodeToBuffer(target, source, offsets, flush, err);
        result.append(target.first(ucharsDecoded));
    } while (needsToGrowToProduceBuffer(err));

    if (U_FAILURE(err)) {
        // flush the converter so it can be reused, and not be bothered by this error.
        do {
            decodeToBuffer(target, source, offsets, true, err);
        } while (!source.empty());
        sawError = true;
    }

    String resultString = result.toString();

    return resultString;
}

// Invalid character handler when writing escaped entities for unrepresentable
// characters. See the declaration of TextCodec::encode for more.
static void urlEscapedEntityCallback(const void* context, UConverterFromUnicodeArgs* fromUArgs, const UChar* codeUnits, int32_t length,
    UChar32 codePoint, UConverterCallbackReason reason, UErrorCode* error)
{
    if (reason == UCNV_UNASSIGNED) {
        *error = U_ZERO_ERROR;
        UnencodableReplacementArray entity;
        auto span = TextCodec::getUnencodableReplacement(codePoint, UnencodableHandling::URLEncodedEntities, entity);
        ucnv_cbFromUWriteBytes(fromUArgs, span.data(), span.size(), 0, error);
    } else
        UCNV_FROM_U_CALLBACK_ESCAPE(context, fromUArgs, codeUnits, length, codePoint, reason, error);
}

Vector<uint8_t> TextCodecICU::encode(StringView string, UnencodableHandling handling) const
{
    if (string.isEmpty())
        return {};

    if (!m_converter) {
        createICUConverter();
        if (!m_converter)
            return {};
    }

    // FIXME: We should see if there is "force ASCII range" mode in ICU;
    // until then, we change the backslash into a yen sign.
    // Encoding will change the yen sign back into a backslash.
    String copy;
    if (shouldShowBackslashAsCurrencySymbolIn(m_encodingName)) {
        copy = makeStringByReplacingAll(string, '\\', yenSign);
        string = copy;
    }

    UErrorCode error;
    switch (handling) {
    case UnencodableHandling::Entities:
        error = U_ZERO_ERROR;
        ucnv_setFromUCallBack(m_converter.get(), UCNV_FROM_U_CALLBACK_ESCAPE, UCNV_ESCAPE_XML_DEC, 0, 0, &error);
        if (U_FAILURE(error))
            return {};
        break;
    case UnencodableHandling::URLEncodedEntities:
        error = U_ZERO_ERROR;
        ucnv_setFromUCallBack(m_converter.get(), urlEscapedEntityCallback, 0, 0, 0, &error);
        if (U_FAILURE(error))
            return {};
        break;
    }

    auto upconvertedCharacters = string.upconvertedCharacters();
    auto source = upconvertedCharacters.span().data();
    auto* sourceLimit = std::to_address(upconvertedCharacters.span().end());

    Vector<uint8_t> result;
    do {
        std::array<char, ConversionBufferSize> buffer;
        char* target = buffer.data();
        char* targetLimit = std::to_address(std::span { buffer }.end());
        error = U_ZERO_ERROR;
        ucnv_fromUnicode(m_converter.get(), &target, targetLimit, &source, sourceLimit, 0, true, &error);
        result.append(byteCast<uint8_t>(std::span(buffer)).first(target - buffer.data()));
    } while (needsToGrowToProduceBuffer(error));
    return result;
}

} // namespace PAL
