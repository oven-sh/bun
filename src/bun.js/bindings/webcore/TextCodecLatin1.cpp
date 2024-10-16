/*
 * Copyright (C) 2004-2017 Apple Inc. All rights reserved.
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
#include "TextCodecLatin1.h"

#include "TextCodecASCIIFastPath.h"
#include <array>
#include <wtf/text/CString.h>
#include <wtf/text/WTFString.h>

namespace PAL {

static const UChar latin1ConversionTable[256] = {
    0x0000, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007, // 00-07
    0x0008, 0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x000E, 0x000F, // 08-0F
    0x0010, 0x0011, 0x0012, 0x0013, 0x0014, 0x0015, 0x0016, 0x0017, // 10-17
    0x0018, 0x0019, 0x001A, 0x001B, 0x001C, 0x001D, 0x001E, 0x001F, // 18-1F
    0x0020, 0x0021, 0x0022, 0x0023, 0x0024, 0x0025, 0x0026, 0x0027, // 20-27
    0x0028, 0x0029, 0x002A, 0x002B, 0x002C, 0x002D, 0x002E, 0x002F, // 28-2F
    0x0030, 0x0031, 0x0032, 0x0033, 0x0034, 0x0035, 0x0036, 0x0037, // 30-37
    0x0038, 0x0039, 0x003A, 0x003B, 0x003C, 0x003D, 0x003E, 0x003F, // 38-3F
    0x0040, 0x0041, 0x0042, 0x0043, 0x0044, 0x0045, 0x0046, 0x0047, // 40-47
    0x0048, 0x0049, 0x004A, 0x004B, 0x004C, 0x004D, 0x004E, 0x004F, // 48-4F
    0x0050, 0x0051, 0x0052, 0x0053, 0x0054, 0x0055, 0x0056, 0x0057, // 50-57
    0x0058, 0x0059, 0x005A, 0x005B, 0x005C, 0x005D, 0x005E, 0x005F, // 58-5F
    0x0060, 0x0061, 0x0062, 0x0063, 0x0064, 0x0065, 0x0066, 0x0067, // 60-67
    0x0068, 0x0069, 0x006A, 0x006B, 0x006C, 0x006D, 0x006E, 0x006F, // 68-6F
    0x0070, 0x0071, 0x0072, 0x0073, 0x0074, 0x0075, 0x0076, 0x0077, // 70-77
    0x0078, 0x0079, 0x007A, 0x007B, 0x007C, 0x007D, 0x007E, 0x007F, // 78-7F
    0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, // 80-87
    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F, // 88-8F
    0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, // 90-97
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178, // 98-9F
    0x00A0, 0x00A1, 0x00A2, 0x00A3, 0x00A4, 0x00A5, 0x00A6, 0x00A7, // A0-A7
    0x00A8, 0x00A9, 0x00AA, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x00AF, // A8-AF
    0x00B0, 0x00B1, 0x00B2, 0x00B3, 0x00B4, 0x00B5, 0x00B6, 0x00B7, // B0-B7
    0x00B8, 0x00B9, 0x00BA, 0x00BB, 0x00BC, 0x00BD, 0x00BE, 0x00BF, // B8-BF
    0x00C0, 0x00C1, 0x00C2, 0x00C3, 0x00C4, 0x00C5, 0x00C6, 0x00C7, // C0-C7
    0x00C8, 0x00C9, 0x00CA, 0x00CB, 0x00CC, 0x00CD, 0x00CE, 0x00CF, // C8-CF
    0x00D0, 0x00D1, 0x00D2, 0x00D3, 0x00D4, 0x00D5, 0x00D6, 0x00D7, // D0-D7
    0x00D8, 0x00D9, 0x00DA, 0x00DB, 0x00DC, 0x00DD, 0x00DE, 0x00DF, // D8-DF
    0x00E0, 0x00E1, 0x00E2, 0x00E3, 0x00E4, 0x00E5, 0x00E6, 0x00E7, // E0-E7
    0x00E8, 0x00E9, 0x00EA, 0x00EB, 0x00EC, 0x00ED, 0x00EE, 0x00EF, // E8-EF
    0x00F0, 0x00F1, 0x00F2, 0x00F3, 0x00F4, 0x00F5, 0x00F6, 0x00F7, // F0-F7
    0x00F8, 0x00F9, 0x00FA, 0x00FB, 0x00FC, 0x00FD, 0x00FE, 0x00FF // F8-FF
};

void TextCodecLatin1::registerEncodingNames(EncodingNameRegistrar registrar)
{
    // From https://encoding.spec.whatwg.org.
    registrar("windows-1252"_s, "windows-1252"_s);
    registrar("ansi_x3.4-1968"_s, "windows-1252"_s);
    registrar("ascii"_s, "windows-1252"_s);
    registrar("cp1252"_s, "windows-1252"_s);
    registrar("cp819"_s, "windows-1252"_s);
    registrar("csisolatin1"_s, "windows-1252"_s);
    registrar("ibm819"_s, "windows-1252"_s);
    registrar("iso-8859-1"_s, "windows-1252"_s);
    registrar("iso-ir-100"_s, "windows-1252"_s);
    registrar("iso8859-1"_s, "windows-1252"_s);
    registrar("iso88591"_s, "windows-1252"_s);
    registrar("iso_8859-1"_s, "windows-1252"_s);
    registrar("iso_8859-1:1987"_s, "windows-1252"_s);
    registrar("l1"_s, "windows-1252"_s);
    registrar("latin1"_s, "windows-1252"_s);
    registrar("us-ascii"_s, "windows-1252"_s);
    registrar("x-cp1252"_s, "windows-1252"_s);
}

void TextCodecLatin1::registerCodecs(TextCodecRegistrar registrar)
{
    registrar("windows-1252"_s, [] {
        return makeUnique<TextCodecLatin1>();
    });
}

String TextCodecLatin1::decode(std::span<const uint8_t> bytes, bool, bool, bool& sawException)
{
    LChar* characters;
    if (bytes.empty())
        return emptyString();
    if (UNLIKELY(bytes.size() > std::numeric_limits<unsigned>::max())) {
        ASSERT_NOT_REACHED();
        sawException = true;
        return emptyString();
    }
    String result = String::createUninitialized(bytes.size(), characters);

    const uint8_t* source = bytes.data();
    const uint8_t* end = bytes.data() + bytes.size();
    const uint8_t* alignedEnd = WTF::alignToMachineWord(end);
    LChar* destination = characters;

    while (source < end) {
        if (isASCII(*source)) {
            // Fast path for ASCII. Most Latin-1 text will be ASCII.
            if (WTF::isAlignedToMachineWord(source)) {
                while (source < alignedEnd) {
                    auto chunk = *reinterpret_cast_ptr<const WTF::MachineWord*>(source);

                    if (!WTF::containsOnlyASCII<LChar>(chunk))
                        goto useLookupTable;

                    copyASCIIMachineWord(destination, source);
                    source += sizeof(WTF::MachineWord);
                    destination += sizeof(WTF::MachineWord);
                }

                if (source == end)
                    break;

                // *source may not be ASCII anymore if source moves inside the loop of the fast code path
                if (!isASCII(*source))
                    goto useLookupTable;
            }
            *destination = *source;
        } else {
useLookupTable:
            if (!isLatin1(latin1ConversionTable[*source]))
                goto upConvertTo16Bit;

            *destination = latin1ConversionTable[*source];
        }

        ++source;
        ++destination;
    }

    return result;
    
upConvertTo16Bit:
    UChar* characters16;
    String result16 = String::createUninitialized(bytes.size(), characters16);

    UChar* destination16 = characters16;

    // Zero extend and copy already processed 8 bit data
    LChar* ptr8 = characters;
    LChar* endPtr8 = destination;

    while (ptr8 < endPtr8)
        *destination16++ = *ptr8++;

    // Handle the character that triggered the 16 bit path
    *destination16 = latin1ConversionTable[*source];
    ++source;
    ++destination16;

    while (source < end) {
        if (isASCII(*source)) {
            // Fast path for ASCII. Most Latin-1 text will be ASCII.
            if (WTF::isAlignedToMachineWord(source)) {
                while (source < alignedEnd) {
                    auto chunk = *reinterpret_cast_ptr<const WTF::MachineWord*>(source);
                    
                    if (!WTF::containsOnlyASCII<LChar>(chunk))
                        goto useLookupTable16;
                    
                    copyASCIIMachineWord(destination16, source);
                    source += sizeof(WTF::MachineWord);
                    destination16 += sizeof(WTF::MachineWord);
                }
                
                if (source == end)
                    break;

                // *source may not be ASCII anymore if source moves inside the loop of the fast code path
                if (!isASCII(*source))
                    goto useLookupTable16;
            }
            *destination16 = *source;
        } else {
useLookupTable16:
            *destination16 = latin1ConversionTable[*source];
        }
        
        ++source;
        ++destination16;
    }
    
    return result16;
}

static Vector<uint8_t> encodeComplexWindowsLatin1(StringView string, UnencodableHandling handling)
{
    Vector<uint8_t> result;

    for (auto character : string.codePoints()) {
        uint8_t b = character;
        // Do an efficient check to detect characters other than 00-7F and A0-FF.
        if (b != character || (character & 0xE0) == 0x80) {
            // Look for a way to encode this with Windows Latin-1.
            for (b = 0x80; b < 0xA0; ++b) {
                if (latin1ConversionTable[b] == character)
                    goto gotByte;
            }
            // No way to encode this character with Windows Latin-1.
            UnencodableReplacementArray replacement;
            int replacementLength = TextCodec::getUnencodableReplacement(character, handling, replacement);
            result.append(std::span(replacement.data(), replacementLength));
            continue;
        }
    gotByte:
        result.append(b);
    }

    return result;
}

Vector<uint8_t> TextCodecLatin1::encode(StringView string, UnencodableHandling handling) const
{
    {
        Vector<uint8_t> result(string.length());
        auto* bytes = result.data();

        // Convert and simultaneously do a check to see if it's all ASCII.
        UChar ored = 0;
        for (auto character : string.codeUnits()) {
            *bytes++ = character;
            ored |= character;
        }

        if (!(ored & 0xFF80))
            return result;
    }

    // If it wasn't all ASCII, call the function that handles more-complex cases.
    return encodeComplexWindowsLatin1(string, handling);
}

} // namespace PAL
