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
#include "CryptoAlgorithmHKDF.h"

#if ENABLE(WEB_CRYPTO)

#include "CryptoAlgorithmHkdfParams.h"
#include "CryptoKeyRaw.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <wtf/CrossThreadCopier.h>

namespace WebCore {

Ref<CryptoAlgorithm> CryptoAlgorithmHKDF::create()
{
    return adoptRef(*new CryptoAlgorithmHKDF);
}

CryptoAlgorithmIdentifier CryptoAlgorithmHKDF::identifier() const
{
    return s_identifier;
}

void CryptoAlgorithmHKDF::deriveBits(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& baseKey, size_t length, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    if (!length || length % 8) {
        exceptionCallback(OperationError);
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTFMove(callback), WTFMove(exceptionCallback),
        [parameters = crossThreadCopy(downcast<CryptoAlgorithmHkdfParams>(parameters)), baseKey = WTFMove(baseKey), length] {
            return platformDeriveBits(parameters, downcast<CryptoKeyRaw>(baseKey.get()), length);
        });
}

void CryptoAlgorithmHKDF::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    if (format != CryptoKeyFormat::Raw) {
        exceptionCallback(NotSupportedError);
        return;
    }
    if (usages & (CryptoKeyUsageEncrypt | CryptoKeyUsageDecrypt | CryptoKeyUsageSign | CryptoKeyUsageVerify | CryptoKeyUsageWrapKey | CryptoKeyUsageUnwrapKey)) {
        exceptionCallback(SyntaxError);
        return;
    }
    if (extractable) {
        exceptionCallback(SyntaxError);
        return;
    }

    callback(CryptoKeyRaw::create(parameters.identifier, WTFMove(std::get<Vector<uint8_t>>(data)), usages));
}

ExceptionOr<size_t> CryptoAlgorithmHKDF::getKeyLength(const CryptoAlgorithmParameters&)
{
    return 0;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
