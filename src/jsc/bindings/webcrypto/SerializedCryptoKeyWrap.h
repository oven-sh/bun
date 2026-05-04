/*
 * Copyright (C) 2014 Apple Inc. All rights reserved.
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

#include <wtf/Forward.h>
#include <wtf/text/WTFString.h>

#if ENABLE(WEB_CRYPTO)

namespace WebCore {

// The purpose of the following APIs is to protect serialized CryptoKey data in IndexedDB or
// any other local storage that go through the structured clone algorithm. However, a side effect
// of this extra layer of protection is redundant communications between mainThread(document) and
// workerThreads. Please refer to WorkerGlobalScope for detailed explanation. P.S. This extra layer
// of protection is not required by the spec as of 11 December 2014:
// https://www.w3.org/TR/WebCryptoAPI/#security-developers

WEBCORE_EXPORT std::optional<Vector<uint8_t>> defaultWebCryptoMasterKey();
WEBCORE_EXPORT bool deleteDefaultWebCryptoMasterKey();

WEBCORE_EXPORT bool wrapSerializedCryptoKey(const Vector<uint8_t>& masterKey, const Vector<uint8_t>& key, Vector<uint8_t>& result);
WEBCORE_EXPORT bool unwrapSerializedCryptoKey(const Vector<uint8_t>& masterKey, const Vector<uint8_t>& wrappedKey, Vector<uint8_t>& key);

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
