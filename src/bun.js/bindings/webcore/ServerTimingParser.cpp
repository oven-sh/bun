/*
 * Copyright (C) 2017 Akamai Technologies Inc. All rights reserved.
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

#include "config.h"
#include "ServerTimingParser.h"

#include "HeaderFieldTokenizer.h"
#include "ServerTiming.h"

#include <wtf/text/CString.h>

namespace WebCore {

namespace ServerTimingParser {

Vector<ServerTiming> parseServerTiming(const String& headerValue)
{
    auto entries = Vector<ServerTiming>();
    if (headerValue.isNull())
        return entries;

    ASSERT(headerValue.is8Bit());

    HeaderFieldTokenizer tokenizer(headerValue);
    while (!tokenizer.isConsumed()) {
        String name = tokenizer.consumeToken();
        if (name.isNull())
            break;

        ServerTiming entry(WTFMove(name));

        while (tokenizer.consume(';')) {
            String parameterName = tokenizer.consumeToken();
            if (parameterName.isNull())
                break;

            String value = emptyString();
            if (tokenizer.consume('=')) {
                value = tokenizer.consumeTokenOrQuotedString();
                tokenizer.consumeBeforeAnyCharMatch({ ',', ';' });
            }
            entry.setParameter(parameterName, value);
        }

        entries.append(WTFMove(entry));

        if (!tokenizer.consume(','))
            break;
    }
    return entries;
}

} // namespace ServerTimingParser

} // namespace WebCore
