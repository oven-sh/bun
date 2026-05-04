/*
 * Copyright (C) 2013 Apple Inc. All rights reserved.
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
#include "CryptoAlgorithm.h"

#if ENABLE(WEB_CRYPTO)

#include "ScriptExecutionContext.h"

namespace WebCore {

void CryptoAlgorithm::encrypt(const CryptoAlgorithmParameters&, Ref<CryptoKey>&&, Vector<uint8_t>&&, VectorCallback&&, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&, WorkQueue&)
{
    exceptionCallback(NotSupportedError, ""_s);
}

void CryptoAlgorithm::decrypt(const CryptoAlgorithmParameters&, Ref<CryptoKey>&&, Vector<uint8_t>&&, VectorCallback&&, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&, WorkQueue&)
{
    exceptionCallback(NotSupportedError, ""_s);
}

void CryptoAlgorithm::sign(const CryptoAlgorithmParameters&, Ref<CryptoKey>&&, Vector<uint8_t>&&, VectorCallback&&, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&, WorkQueue&)
{
    exceptionCallback(NotSupportedError, ""_s);
}

void CryptoAlgorithm::verify(const CryptoAlgorithmParameters&, Ref<CryptoKey>&&, Vector<uint8_t>&&, Vector<uint8_t>&&, BoolCallback&&, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&, WorkQueue&)
{
    exceptionCallback(NotSupportedError, ""_s);
}

void CryptoAlgorithm::digest(Vector<uint8_t>&&, VectorCallback&&, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&, WorkQueue&)
{
    exceptionCallback(NotSupportedError, ""_s);
}

void CryptoAlgorithm::generateKey(const CryptoAlgorithmParameters&, bool, CryptoKeyUsageBitmap, KeyOrKeyPairCallback&&, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&)
{
    exceptionCallback(NotSupportedError, ""_s);
}

void CryptoAlgorithm::deriveBits(const CryptoAlgorithmParameters&, Ref<CryptoKey>&&, size_t, VectorCallback&&, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&, WorkQueue&)
{
    exceptionCallback(NotSupportedError, ""_s);
}

void CryptoAlgorithm::importKey(CryptoKeyFormat, KeyData&&, const CryptoAlgorithmParameters&, bool, CryptoKeyUsageBitmap, KeyCallback&&, ExceptionCallback&& exceptionCallback)
{
    exceptionCallback(NotSupportedError, ""_s);
}

void CryptoAlgorithm::exportKey(CryptoKeyFormat, Ref<CryptoKey>&&, KeyDataCallback&&, ExceptionCallback&& exceptionCallback)
{
    exceptionCallback(NotSupportedError, ""_s);
}

void CryptoAlgorithm::wrapKey(Ref<CryptoKey>&&, Vector<uint8_t>&&, VectorCallback&&, ExceptionCallback&& exceptionCallback)
{
    exceptionCallback(NotSupportedError, ""_s);
}

void CryptoAlgorithm::unwrapKey(Ref<CryptoKey>&&, Vector<uint8_t>&&, VectorCallback&&, ExceptionCallback&& exceptionCallback)
{
    exceptionCallback(NotSupportedError, ""_s);
}

ExceptionOr<size_t> CryptoAlgorithm::getKeyLength(const CryptoAlgorithmParameters&)
{
    return Exception { NotSupportedError };
}

template<typename ResultCallbackType, typename OperationType>
static void dispatchAlgorithmOperation(WorkQueue& workQueue, ScriptExecutionContext& context, ResultCallbackType&& callback, CryptoAlgorithm::ExceptionCallback&& exceptionCallback, OperationType&& operation)
{
    workQueue.dispatch(context.globalObject(),
        [operation = WTF::move(operation), callback = WTF::move(callback), exceptionCallback = WTF::move(exceptionCallback), contextIdentifier = context.identifier()]() mutable {
            auto result = operation();
            ScriptExecutionContext::postTaskTo(contextIdentifier, [result = crossThreadCopy(WTF::move(result)), callback = WTF::move(callback), exceptionCallback = WTF::move(exceptionCallback)](auto& context) mutable {
                if (result.hasException()) {
                    exceptionCallback(result.releaseException().code(), ""_s);
                    return;
                }
                callback(result.releaseReturnValue());
            });
        });
}

void CryptoAlgorithm::dispatchOperationInWorkQueue(WorkQueue& workQueue, ScriptExecutionContext& context, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, Function<ExceptionOr<Vector<uint8_t>>()>&& operation)
{
    dispatchAlgorithmOperation(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback), WTF::move(operation));
}

void CryptoAlgorithm::dispatchOperationInWorkQueue(WorkQueue& workQueue, ScriptExecutionContext& context, BoolCallback&& callback, ExceptionCallback&& exceptionCallback, Function<ExceptionOr<bool>()>&& operation)
{
    dispatchAlgorithmOperation(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback), WTF::move(operation));
}

}

#endif
