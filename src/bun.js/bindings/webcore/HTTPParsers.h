/*
 * Copyright (C) 2006 Alexey Proskuryakov (ap@webkit.org)
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

#pragma once

#include <wtf/text/StringImpl.h>
#include <wtf/HashSet.h>
#include <wtf/WallTime.h>
#include <wtf/text/StringHash.h>

namespace WebCore {

typedef HashSet<String, ASCIICaseInsensitiveHash> HTTPHeaderSet;

enum class HTTPHeaderName : uint8_t;

enum class XSSProtectionDisposition {
    Invalid,
    Disabled,
    Enabled,
    BlockEnabled,
};

enum class ContentTypeOptionsDisposition : bool {
    None,
    Nosniff
};

enum class XFrameOptionsDisposition : uint8_t {
    None,
    Deny,
    SameOrigin,
    AllowAll,
    Invalid,
    Conflict
};

enum class CrossOriginResourcePolicy : uint8_t {
    None,
    CrossOrigin,
    SameOrigin,
    SameSite,
    Invalid
};

enum class RangeAllowWhitespace : bool { No,
    Yes };

bool isValidReasonPhrase(const String&);
bool isValidHTTPHeaderValue(const String&);
bool isValidAcceptHeaderValue(const String&);
bool isValidLanguageHeaderValue(const String&);
#if USE(GLIB)
WEBCORE_EXPORT bool isValidUserAgentHeaderValue(const String&);
#endif
bool isValidHTTPToken(const StringView);
std::optional<WallTime> parseHTTPDate(const String&);
StringView filenameFromHTTPContentDisposition(StringView);
WEBCORE_EXPORT String extractMIMETypeFromMediaType(const String&);
StringView extractCharsetFromMediaType(const String&);
XSSProtectionDisposition parseXSSProtectionHeader(const String& header, String& failureReason, unsigned& failurePosition, String& reportURL);
AtomString extractReasonPhraseFromHTTPStatusLine(const String&);
WEBCORE_EXPORT XFrameOptionsDisposition parseXFrameOptionsHeader(StringView);
std::optional<std::pair<StringView, HashMap<String, String>>> parseStructuredFieldValue(StringView header);

// -1 could be set to one of the return parameters to indicate the value is not specified.
WEBCORE_EXPORT bool parseRange(const String&, long long& rangeOffset, long long& rangeEnd, long long& rangeSuffixLength);

ContentTypeOptionsDisposition parseContentTypeOptionsHeader(StringView header);

// Parsing Complete HTTP Messages.
size_t parseHTTPHeader(const uint8_t* data, size_t length, String& failureReason, StringView& nameStr, String& valueStr, bool strict = true);
size_t parseHTTPRequestBody(const uint8_t* data, size_t length, Vector<uint8_t>& body);

// HTTP Header routine as per https://fetch.spec.whatwg.org/#terminology-headers
bool isForbiddenHeaderName(const StringView);
bool isNoCORSSafelistedRequestHeaderName(const StringView);
bool isPriviledgedNoCORSRequestHeaderName(const StringView);
bool isForbiddenResponseHeaderName(const StringView);
bool isForbiddenMethod(const StringView);
bool isSimpleHeader(const StringView name, const StringView value);
// bool isCrossOriginSafeHeader(HTTPHeaderName, const HTTPHeaderSet&);
// bool isCrossOriginSafeHeader(const String&, const HTTPHeaderSet&);
bool isCrossOriginSafeRequestHeader(HTTPHeaderName, const StringView);

String normalizeHTTPMethod(const String&);
bool isSafeMethod(const String&);

WEBCORE_EXPORT CrossOriginResourcePolicy parseCrossOriginResourcePolicyHeader(StringView);

// -1 could be set to one of the return parameters to indicate the value is not specified.
WEBCORE_EXPORT bool parseRange(StringView, RangeAllowWhitespace, long long& rangeStart, long long& rangeEnd);

inline bool isHTTPSpace(UChar character)
{
    return character <= ' ' && (character == ' ' || character == '\n' || character == '\t' || character == '\r');
}

// template<class HashType>
// bool addToAccessControlAllowList(const String& string, unsigned start, unsigned end, HashSet<String, HashType>& set)
// {
//     StringImpl* stringImpl = string.impl();
//     if (!stringImpl)
//         return true;

//     // Skip white space from start.
//     while (start <= end && isJSONOrHTTPWhitespace((*stringImpl)[start]))
//         ++start;

//     // only white space
//     if (start > end)
//         return true;

//     // Skip white space from end.
//     while (end && isJSONOrHTTPWhitespace((*stringImpl)[end]))
//         --end;

//     auto token = string.substring(start, end - start + 1);
//     if (!isValidHTTPToken(token))
//         return false;

//     set.add(WTFMove(token));
//     return true;
// }

// template<class HashType = DefaultHash<String>>
// std::optional<HashSet<String, HashType>> parseAccessControlAllowList(const String& string)
// {
//     HashSet<String, HashType> set;
//     unsigned start = 0;
//     size_t end;
//     while ((end = string.find(',', start)) != notFound) {
//         if (start != end) {
//             if (!addToAccessControlAllowList(string, start, end - 1, set))
//                 return {};
//         }
//         start = end + 1;
//     }
//     if (start != string.length()) {
//         if (!addToAccessControlAllowList(string, start, string.length() - 1, set))
//             return {};
//     }
//     return set;
// }

}
