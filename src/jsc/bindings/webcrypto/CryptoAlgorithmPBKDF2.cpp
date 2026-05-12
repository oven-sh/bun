/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
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
#include "CryptoAlgorithmPBKDF2.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmPbkdf2Params.h"
#include "CryptoKeyRaw.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <wtf/CrossThreadCopier.h>

namespace WebCore {

Ref<CryptoAlgorithm> CryptoAlgorithmPBKDF2::create()
{
    return adoptRef(*new CryptoAlgorithmPBKDF2);
}

CryptoAlgorithmIdentifier CryptoAlgorithmPBKDF2::identifier() const
{
    return s_identifier;
}

void CryptoAlgorithmPBKDF2::deriveBits(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& baseKey, size_t length, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    if (!length || length % 8) {
        exceptionCallback(OperationError, ""_s);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback),
        [parameters = crossThreadCopy(downcast<CryptoAlgorithmPbkdf2Params>(parameters)), baseKey = WTF::move(baseKey), length] {
            return platformDeriveBits(parameters, downcast<CryptoKeyRaw>(baseKey.get()), length);
        });
}

void CryptoAlgorithmPBKDF2::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    if (format != CryptoKeyFormat::Raw) {
        exceptionCallback(NotSupportedError, ""_s);
        return;
    }
    if (usages & (CryptoKeyUsageEncrypt | CryptoKeyUsageDecrypt | CryptoKeyUsageSign | CryptoKeyUsageVerify | CryptoKeyUsageWrapKey | CryptoKeyUsageUnwrapKey)) {
        exceptionCallback(SyntaxError, ""_s);
        return;
    }
    if (extractable) {
        exceptionCallback(SyntaxError, ""_s);
        return;
    }

    callback(CryptoKeyRaw::create(parameters.identifier, WTF::move(std::get<Vector<uint8_t>>(data)), usages));
}

ExceptionOr<size_t> CryptoAlgorithmPBKDF2::getKeyLength(const CryptoAlgorithmParameters&)
{
    return 0;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
