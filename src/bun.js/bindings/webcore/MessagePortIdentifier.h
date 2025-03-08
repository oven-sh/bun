/*
 * Copyright (C) 2018 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "PortIdentifier.h"
#include "ProcessIdentifier.h"
#include <wtf/Hasher.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

struct MessagePortIdentifier {
    ProcessIdentifier processIdentifier;
    PortIdentifier portIdentifier;

    friend bool operator==(const MessagePortIdentifier&, const MessagePortIdentifier&) = default;

#if !LOG_DISABLED
    String logString() const;
#endif
};

inline void add(Hasher& hasher, const MessagePortIdentifier& identifier)
{
    add(hasher, identifier.processIdentifier, identifier.portIdentifier);
}

#if !LOG_DISABLED

inline String MessagePortIdentifier::logString() const
{
    return makeString(processIdentifier.toUInt64(), '-', portIdentifier.toUInt64());
}

#endif

} // namespace WebCore

namespace WTF {

struct MessagePortIdentifierHash {
    static unsigned hash(const WebCore::MessagePortIdentifier& key) { return computeHash(key); }
    static bool equal(const WebCore::MessagePortIdentifier& a, const WebCore::MessagePortIdentifier& b) { return a == b; }
    static const bool safeToCompareToEmptyOrDeleted = true;
};

template<> struct HashTraits<WebCore::MessagePortIdentifier> : GenericHashTraits<WebCore::MessagePortIdentifier> {
    static WebCore::MessagePortIdentifier emptyValue() { return { HashTraits<WebCore::ProcessIdentifier>::emptyValue(), HashTraits<WebCore::PortIdentifier>::emptyValue() }; }

    static void constructDeletedValue(WebCore::MessagePortIdentifier& slot) { new (NotNull, &slot.processIdentifier) WebCore::ProcessIdentifier(WTF::HashTableDeletedValue); }

    static bool isDeletedValue(const WebCore::MessagePortIdentifier& slot) { return slot.processIdentifier.isHashTableDeletedValue(); }
};

template<> struct DefaultHash<WebCore::MessagePortIdentifier> : MessagePortIdentifierHash {
};

} // namespace WTF
