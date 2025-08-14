/*
 * Copyright (C) 2008, 2009 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// config.h removed - not needed in Bun
#include "TextEncodingDetector.h"

#include "TextEncoding.h"
#include <unicode/ucnv.h>
#include <unicode/ucsdet.h>
#include <wtf/text/icu/UnicodeExtras.h>

namespace PAL {

bool detectTextEncoding(std::span<const uint8_t> data, ASCIILiteral hintEncodingName, TextEncoding* detectedEncoding)
{
    *detectedEncoding = TextEncoding();
    UErrorCode status = U_ZERO_ERROR;
    UCharsetDetector* detector = ucsdet_open(&status);
    if (U_FAILURE(status))
        return false;
    ucsdet_enableInputFilter(detector, true);
    ucsdet_setText(detector, byteCast<char>(data.data()), static_cast<int32_t>(data.size()), &status);
    if (U_FAILURE(status))
        return false;

    // FIXME: A few things we can do other than improving
    // the ICU detector itself.
    // 1. Use ucsdet_detectAll and pick the most likely one given
    // "the context" (parent-encoding, referrer encoding, etc).
    // 2. 'Emulate' Firefox/IE's non-Universal detectors (e.g.
    // Chinese, Japanese, Russian, Korean and Hebrew) by picking the
    // encoding with a highest confidence among the detector-specific
    // limited set of candidate encodings.
    // Below is a partial implementation of the first part of what's outlined
    // above.
    auto matches = ucsdet_detectAll_span(detector, &status);
    if (U_FAILURE(status)) {
        ucsdet_close(detector);
        return false;
    }

    const char* encoding = nullptr;
    if (!hintEncodingName.isNull()) {
        TextEncoding hintEncoding(hintEncodingName);
        // 10 is the minimum confidence value consistent with the codepoint
        // allocation in a given encoding. The size of a chunk passed to
        // us varies even for the same html file (apparently depending on
        // the network load). When we're given a rather short chunk, we
        // don't have a sufficiently reliable signal other than the fact that
        // the chunk is consistent with a set of encodings. So, instead of
        // setting an arbitrary threshold, we have to scan all the encodings
        // consistent with the data.
        const int32_t kThreshold = 10;
        for (auto* match : matches) {
            int32_t confidence = ucsdet_getConfidence(match, &status);
            if (U_FAILURE(status)) {
                status = U_ZERO_ERROR;
                continue;
            }
            if (confidence < kThreshold)
                break;
            const char* matchEncoding = ucsdet_getName(match, &status);
            if (U_FAILURE(status)) {
                status = U_ZERO_ERROR;
                continue;
            }
            if (TextEncoding(StringView::fromLatin1(matchEncoding)) == hintEncoding) {
                encoding = hintEncodingName;
                break;
            }
        }
    }
    // If no match is found so far, just pick the top match.
    // This can happen, say, when a parent frame in EUC-JP refers to
    // a child frame in Shift_JIS and both frames do NOT specify the encoding
    // making us resort to auto-detection (when it IS turned on).
    if (!encoding && !matches.empty())
        encoding = ucsdet_getName(matches[0], &status);
    if (U_SUCCESS(status)) {
        *detectedEncoding = TextEncoding(StringView::fromLatin1(encoding));
        ucsdet_close(detector);
        return true;
    }
    ucsdet_close(detector);
    return false;
}

}
