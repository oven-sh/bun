/*
 * Copyright (C) 2008 Google Inc. All rights reserved.
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

#pragma once

#include <wtf/Forward.h>
#include <wtf/Markable.h>
#include <wtf/text/StringHash.h>

namespace WebCore {

using SharedStringHash = uint32_t;

// This is a hash value, but it can be used as a key in HashMap. So, we need to avoid producing deleted-value in HashMap, which is -1.
struct SharedStringHashHash {
    static unsigned hash(SharedStringHash key) { return static_cast<unsigned>(key); }
    static bool equal(SharedStringHash a, SharedStringHash b) { return a == b; }
    static const bool safeToCompareToEmptyOrDeleted = true;
    static constexpr SharedStringHash deletedValue = std::numeric_limits<SharedStringHash>::max();
};

// Returns the hash of the string that will be used for visited link coloring.
WEBCORE_EXPORT SharedStringHash LEGACY_NODELETE computeSharedStringHash(const String& url);
WEBCORE_EXPORT SharedStringHash computeSharedStringHash(std::span<const char16_t> url);

// Resolves the potentially relative URL "attributeURL" relative to the given
// base URL, and returns the hash of the string that will be used for visited
// link coloring. It will return the special value of 0 if attributeURL does not
// look like a relative URL.
SharedStringHash computeVisitedLinkHash(const URL& base, const AtomString& attributeURL);

} // namespace WebCore
