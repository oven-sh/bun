/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "TextEncoder.h"

#include <JavaScriptCore/GenericTypedArrayViewInlines.h>
#include <JavaScriptCore/JSCInlines.h>

namespace WebCore {

String TextEncoder::encoding() const
{
    return "utf-8"_s;
}

RefPtr<Uint8Array> TextEncoder::encode(String&& input) const
{
    // THIS CODE SHOULD NEVER BE REACHED IN BUN
    RELEASE_ASSERT(1);
    return nullptr;
}

auto TextEncoder::encodeInto(String&& input, Ref<Uint8Array>&& array) -> EncodeIntoResult
{
    // THIS CODE SHOULD NEVER BE REACHED IN BUN
    RELEASE_ASSERT(1);

    auto* destinationBytes = static_cast<uint8_t*>(array->baseAddress());
    auto capacity = array->byteLength();

    uint64_t read = 0;
    uint64_t written = 0;

    for (auto token : StringView(input).codePoints()) {
        if (written >= capacity) {
            ASSERT(written == capacity);
            break;
        }
        UBool sawError = false;
        U8_APPEND(destinationBytes, written, capacity, token, sawError);
        if (sawError)
            break;
        if (U_IS_BMP(token))
            read++;
        else
            read += 2;
    }

    return { read, written };
}

}
