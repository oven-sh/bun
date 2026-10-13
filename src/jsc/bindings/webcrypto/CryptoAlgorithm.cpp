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

#include "CryptoDigest.h"
#include "ScriptExecutionContext.h"
#include <openssl/err.h>

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

void CryptoAlgorithm::deriveBits(const CryptoAlgorithmParameters&, Ref<CryptoKey>&&, std::optional<size_t>, VectorCallback&&, ExceptionCallback&& exceptionCallback, ScriptExecutionContext&, WorkQueue&)
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

void CryptoAlgorithm::encapsulate(Ref<CryptoKey>&&, VectorPairCallback&&, ExceptionCallback&& exceptionCallback)
{
    exceptionCallback(NotSupportedError, ""_s);
}

void CryptoAlgorithm::decapsulate(Ref<CryptoKey>&&, Vector<uint8_t>&&, VectorCallback&&, ExceptionCallback&& exceptionCallback)
{
    exceptionCallback(NotSupportedError, ""_s);
}

ExceptionOr<std::optional<size_t>> CryptoAlgorithm::getKeyLength(const CryptoAlgorithmParameters&)
{
    return Exception { NotSupportedError };
}

std::optional<Vector<uint8_t>> CryptoAlgorithm::extractDerivedBits(std::optional<size_t> length, Vector<uint8_t>&& secret)
{
    if (!length)
        return WTF::move(secret);
    auto lengthInBytes = (*length + 7) / 8;
    if (lengthInBytes > secret.size())
        return std::nullopt;
    secret.shrink(lengthInBytes);
    if (auto remainder = *length % 8)
        secret.last() &= static_cast<uint8_t>(0xFF << (8 - remainder));
    return WTF::move(secret);
}

template<typename ResultCallbackType, typename OperationType>
static void dispatchAlgorithmOperation(WorkQueue& workQueue, ScriptExecutionContext& context, ResultCallbackType&& callback, CryptoAlgorithm::ExceptionCallback&& exceptionCallback, OperationType&& operation)
{
    workQueue.dispatch(context.globalObject(),
        [operation = WTF::move(operation), callback = WTF::move(callback), exceptionCallback = WTF::move(exceptionCallback), contextIdentifier = context.identifier(), loopKind = context.currentLoopKind()]() mutable {
            auto result = operation();
            ScriptExecutionContext::postTaskTo(contextIdentifier, loopKind, [result = crossThreadCopy(WTF::move(result)), callback = WTF::move(callback), exceptionCallback = WTF::move(exceptionCallback)](auto& context) mutable {
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

static size_t maxInputSizeForInlineOperation(CryptoAlgorithmIdentifier hashOrCipher)
{
    switch (hashOrCipher) {
    case CryptoAlgorithmIdentifier::SHA_1:
    case CryptoAlgorithmIdentifier::SHA_224:
    case CryptoAlgorithmIdentifier::SHA_256:
    case CryptoAlgorithmIdentifier::AES_CTR:
    case CryptoAlgorithmIdentifier::AES_CBC:
    case CryptoAlgorithmIdentifier::AES_GCM:
    case CryptoAlgorithmIdentifier::ChaCha20_Poly1305:
        return 1024;
    case CryptoAlgorithmIdentifier::SHA_384:
    case CryptoAlgorithmIdentifier::SHA_512:
        return 256;
    // AES-CFB-8 encrypts a whole block for every byte.
    case CryptoAlgorithmIdentifier::AES_CFB:
    case CryptoAlgorithmIdentifier::SHA3_256:
    case CryptoAlgorithmIdentifier::SHA3_384:
    case CryptoAlgorithmIdentifier::SHA3_512:
        return 64;
    default:
        return 0;
    }
}

// A macro's loop turns only while the macro is waited for, so what it started is posted the way the work queue posts it.
static void postFromEventLoop(ScriptExecutionContext& context, Function<void(ScriptExecutionContext&)>&& task)
{
    if (auto loopKind = context.currentLoopKind(); loopKind != BunLoopKind::Regular)
        ScriptExecutionContext::postTaskTo(context.identifier(), loopKind, WTF::move(task));
    else
        context.postTaskAfterYield(WTF::move(task));
}

template<typename ResultCallbackType, typename OperationType>
static void runOrDispatchAlgorithmOperation(CryptoAlgorithmIdentifier hashOrCipher, size_t inputSize, WorkQueue& workQueue, ScriptExecutionContext& context, ResultCallbackType&& callback, CryptoAlgorithm::ExceptionCallback&& exceptionCallback, OperationType&& operation)
{
    if (inputSize > maxInputSizeForInlineOperation(hashOrCipher)) {
        dispatchAlgorithmOperation(workQueue, context, WTF::move(callback), WTF::move(exceptionCallback), WTF::move(operation));
        return;
    }
    auto result = operation();
    // A failed operation leaves its reason on the BoringSSL error queue of the thread it ran on, which is now the caller's.
    if (result.hasException())
        ERR_clear_error();
    postFromEventLoop(context, [result = WTF::move(result), callback = WTF::move(callback), exceptionCallback = WTF::move(exceptionCallback)](auto&) mutable {
        if (result.hasException()) {
            exceptionCallback(result.releaseException().code(), ""_s);
            return;
        }
        callback(result.releaseReturnValue());
    });
}

void CryptoAlgorithm::dispatchOperation(CryptoAlgorithmIdentifier hashOrCipher, size_t inputSize, WorkQueue& workQueue, ScriptExecutionContext& context, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, Function<ExceptionOr<Vector<uint8_t>>()>&& operation)
{
    runOrDispatchAlgorithmOperation(hashOrCipher, inputSize, workQueue, context, WTF::move(callback), WTF::move(exceptionCallback), WTF::move(operation));
}

void CryptoAlgorithm::dispatchOperation(CryptoAlgorithmIdentifier hashOrCipher, size_t inputSize, WorkQueue& workQueue, ScriptExecutionContext& context, BoolCallback&& callback, ExceptionCallback&& exceptionCallback, Function<ExceptionOr<bool>()>&& operation)
{
    runOrDispatchAlgorithmOperation(hashOrCipher, inputSize, workQueue, context, WTF::move(callback), WTF::move(exceptionCallback), WTF::move(operation));
}

void CryptoAlgorithm::dispatchDigest(CryptoAlgorithmIdentifier hash, std::unique_ptr<PAL::CryptoDigest>&& digest, Vector<uint8_t>&& message, VectorCallback&& callback, ExceptionCallback&& exceptionCallback, ScriptExecutionContext& context, WorkQueue& workQueue)
{
    if (!digest) {
        exceptionCallback(OperationError, ""_s);
        return;
    }
    if (message.size() <= maxInputSizeForInlineOperation(hash)) {
        digest->addBytes(message.begin(), message.size());
        postFromEventLoop(context, [callback = WTF::move(callback), result = digest->computeHash()](auto&) {
            callback(result);
        });
        return;
    }
    workQueue.dispatch(context.globalObject(), [digest = WTF::move(digest), message = WTF::move(message), callback = WTF::move(callback), contextIdentifier = context.identifier(), loopKind = context.currentLoopKind()]() mutable {
        digest->addBytes(message.begin(), message.size());
        auto result = digest->computeHash();
        ScriptExecutionContext::postTaskTo(contextIdentifier, loopKind, [callback = WTF::move(callback), result = WTF::move(result)](auto&) {
            callback(result);
        });
    });
}

}

#endif
