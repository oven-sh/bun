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
#include "OpenSSLUtilities.h"
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

ExceptionOr<void> CryptoAlgorithmHKDF::validateDeriveBits(const CryptoAlgorithmHkdfParams& parameters, std::optional<size_t> length)
{
    if (!length)
        return Exception { OperationError, "length cannot be null"_s };
    if (*length % 8)
        return Exception { OperationError, "length must be a multiple of 8"_s };
    // RFC 5869 section 2.3: the output is at most 255 blocks of the hash.
    if (auto* digest = digestAlgorithm(parameters.hashIdentifier); digest && *length / 8 > 255 * EVP_MD_size(digest))
        return Exception { OperationError, "length exceeds the maximum derived bit length"_s };

    // Node caps info at 1024 bytes (OpenSSL 3.x EVP_PKEY_CTX_add1_hkdf_info);
    // BoringSSL imposes no such limit, so match Node explicitly.
    constexpr size_t maximumInfoLength = 1024;
    if (parameters.info.length() > maximumInfoLength)
        return Exception { OperationError, "algorithm.info must be at most 1024 bytes"_s };
    return {};
}

void CryptoAlgorithmHKDF::deriveBits(const CryptoAlgorithmParameters& parameters, Ref<CryptoKey>&& baseKey, std::optional<size_t> length, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    auto& hkdfParameters = downcast<CryptoAlgorithmHkdfParams>(parameters);
    if (auto result = validateDeriveBits(hkdfParameters, length); result.hasException()) {
        exceptionCallback(result.exception().code(), result.exception().message());
        return;
    }

    dispatchOperationInWorkQueue(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback),
        [parameters = crossThreadCopy(hkdfParameters), baseKey = WTF::move(baseKey), length = *length] {
            return platformDeriveBits(parameters, downcast<CryptoKeyRaw>(baseKey.get()), length);
        });
}

void CryptoAlgorithmHKDF::importKey(CryptoKeyFormat format, KeyData&& data, const CryptoAlgorithmParameters& parameters, bool extractable, CryptoKeyUsageBitmap usages, KeyCallback&& callback, ExceptionCallback&& exceptionCallback)
{
    if (format != CryptoKeyFormat::Raw) {
        exceptionCallback(NotSupportedError, ""_s);
        return;
    }
    if (usages & (CryptoKeyUsageEncrypt | CryptoKeyUsageDecrypt | CryptoKeyUsageSign | CryptoKeyUsageVerify | CryptoKeyUsageWrapKey | CryptoKeyUsageUnwrapKey | CryptoKeyUsageKemMask)) {
        exceptionCallback(SyntaxError, "Unsupported key usage for a HKDF key"_s);
        return;
    }
    if (extractable) {
        exceptionCallback(SyntaxError, "HKDF keys are not extractable"_s);
        return;
    }

    callback(CryptoKeyRaw::create(parameters.identifier, WTF::move(std::get<Vector<uint8_t>>(data)), usages));
}

ExceptionOr<std::optional<size_t>> CryptoAlgorithmHKDF::getKeyLength(const CryptoAlgorithmParameters&)
{
    return std::optional<size_t>();
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
