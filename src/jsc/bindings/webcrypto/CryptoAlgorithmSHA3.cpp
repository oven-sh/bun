/*
 * Copyright (C) 2024 Apple Inc. All rights reserved.
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

#include "config.h"
#include "CryptoAlgorithmSHA3.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoDigest.h"

namespace WebCore {

#define DEFINE_SHA3(ClassName, DigestAlgo)                                           \
    Ref<CryptoAlgorithm> ClassName::create() { return adoptRef(*new ClassName); }    \
    CryptoAlgorithmIdentifier ClassName::identifier() const { return s_identifier; } \
    void ClassName::digest(Vector<uint8_t>&& message, VectorCallback&& callback,     \
        ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context,      \
        WorkQueue& workQueue)                                                        \
    {                                                                                \
        dispatchDigest(workQueue, context, WTF::move(callback),                      \
            WTF::move(exceptionCallback), WTF::move(message), DigestAlgo);           \
    }

DEFINE_SHA3(CryptoAlgorithmSHA3_256, PAL::CryptoDigest::Algorithm::SHA3_256)
DEFINE_SHA3(CryptoAlgorithmSHA3_384, PAL::CryptoDigest::Algorithm::SHA3_384)
DEFINE_SHA3(CryptoAlgorithmSHA3_512, PAL::CryptoDigest::Algorithm::SHA3_512)

#undef DEFINE_SHA3

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
