/*
 * Copyright (C) 2006 Alexey Proskuryakov (ap@webkit.org)
 * Copyright (C) 2006-2017 Apple Inc. All rights reserved.
 * Copyright (C) 2009 Torch Mobile Inc. http://www.torchmobile.com/
 * Copyright (C) 2009 Google Inc. All rights reserved.
 * Copyright (C) 2011 Apple Inc. All Rights Reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
#include "config.h"
#include "HTTPParsers.h"

#include "HTTPHeaderField.h"

namespace WebCore {

// See https://fetch.spec.whatwg.org/#concept-header
bool isValidHTTPHeaderValue(const StringView& value)
{
    auto length = value.length();
    if (length == 0) return true;
    char16_t c = value[0];
    if (isTabOrSpace(c))
        return false;
    c = value[length - 1];
    if (isTabOrSpace(c))
        return false;
    if (value.is8Bit()) {
        const Latin1Character* begin = value.span8().data();
        const Latin1Character* end = begin + value.length();
        for (const Latin1Character* p = begin; p != end; ++p) {
            if (*p <= 13) [[unlikely]] {
                Latin1Character c = *p;
                if (c == 0x00 || c == 0x0A || c == 0x0D)
                    return false;
            }
        }
    } else {
        // Match the 8-bit branch: header values are byte sequences, so any
        // char that fits in a byte (0x80-0xFF included, per obs-text) is
        // valid regardless of the string's internal representation. A 16-bit
        // string here usually comes from normalize()/JSON parsing of network
        // responses, not from characters outside latin-1.
        for (unsigned i = 0; i < value.length(); ++i) {
            c = value[i];
            if (c == 0x00 || c == 0x0A || c == 0x0D || c > 0xFF)
                return false;
        }
    }

    return true;
}

// See RFC 7230, Section 3.2.6.
bool isValidHTTPToken(const StringView& value)
{
    if (value.isEmpty())
        return false;

    if (value.is8Bit()) {
        const Latin1Character* characters = value.span8().data();
        const Latin1Character* end = characters + value.length();
        while (characters < end) {
            if (!RFC7230::isTokenCharacter(*characters++))
                return false;
        }
        return true;
    }

    for (char16_t c : value.codeUnits()) {
        if (!RFC7230::isTokenCharacter(c))
            return false;
    }
    return true;
}

extern "C" int Bun__writeHTTPDate(char* buffer, size_t length, uint64_t timestampMs)
{
    if (timestampMs == 0) {
        return 0;
    }

    time_t timestamp = timestampMs / 1000;
    struct tm tstruct = {};
#ifdef _WIN32
    gmtime_s(&tstruct, &timestamp);
#else
    gmtime_r(&timestamp, &tstruct);
#endif
    static const char wday_name[][4] = {
        "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"
    };
    static const char mon_name[][4] = {
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    };
    return snprintf(buffer, length, "%.3s, %.2u %.3s %.4u %.2u:%.2u:%.2u GMT",
        wday_name[tstruct.tm_wday],
        tstruct.tm_mday % 99,
        mon_name[tstruct.tm_mon],
        (1900 + tstruct.tm_year) % 9999,
        tstruct.tm_hour % 99,
        tstruct.tm_min % 99,
        tstruct.tm_sec % 99);
}

}
