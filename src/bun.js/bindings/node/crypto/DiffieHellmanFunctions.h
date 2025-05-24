#pragma once

#include "root.h"
#include "ErrorCode.h"
#include "NodeValidator.h"
#include "JSBufferEncodingType.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include "JSBufferEncodingType.h"
#include "ncrypto.h"
#include "CryptoUtil.h"
#include "JSBuffer.h"

namespace Bun {

// Template implementations for Diffie-Hellman functions that are shared between
// JSDiffieHellman and JSDiffieHellmanGroup

template<typename DiffieHellmanType>
JSC::EncodedJSValue jsDiffieHellmanProtoFuncGenerateKeysTemplate(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = JSC::jsDynamicCast<DiffieHellmanType*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        throwThisTypeError(*globalObject, scope, DiffieHellmanType::info()->className, "generateKeys"_s);
        return {};
    }

    auto& dh = thisObject->getImpl();
    auto keys = dh.generateKeys();
    if (!keys) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Key generation failed"_s);
        return {};
    }

    auto encodingType = getEncodingDefaultBuffer(globalObject, scope, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});

    return StringBytes::encode(globalObject, scope, keys.span(), encodingType);
}

template<typename DiffieHellmanType>
JSC::EncodedJSValue jsDiffieHellmanProtoFuncComputeSecretTemplate(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = JSC::jsDynamicCast<DiffieHellmanType*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        throwThisTypeError(*globalObject, scope, DiffieHellmanType::info()->className, "computeSecret"_s);
        return {};
    }

    // Get the arguments
    JSC::JSValue keyArg = callFrame->argument(0);
    JSC::JSValue inputEncodingArg = callFrame->argument(1);
    JSC::JSValue outputEncodingArg = callFrame->argument(2);

    // Process the public key input
    auto* keyBuffer = Bun::getArrayBufferOrView(globalObject, scope, keyArg, "key"_s, inputEncodingArg);
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(keyBuffer);

    auto span = keyBuffer->span();

    // Check for unusually large buffer sizes
    if (span.size() > INT32_MAX) {
        throwError(globalObject, scope, ErrorCode::ERR_OUT_OF_RANGE, "Public key is too big"_s);
        return {};
    }

    // Check for empty buffer
    if (span.size() == 0) {
        throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "Public key cannot be empty"_s);
        return {};
    }

    ncrypto::BignumPointer publicKey(span.data(), span.size());
    if (!publicKey) {
        throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "Invalid public key"_s);
        return {};
    }

    auto& dh = thisObject->getImpl();

    // Check the public key against our DH parameters
    auto checkResult = dh.checkPublicKey(publicKey);
    if (checkResult != ncrypto::DHPointer::CheckPublicKeyResult::NONE) {
        switch (checkResult) {
        // case ncrypto::DHPointer::CheckPublicKeyResult::TOO_SMALL:
        //     throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_INVALID_KEYLEN, "Supplied key is too small"_s);
        //     return {};
        // case ncrypto::DHPointer::CheckPublicKeyResult::TOO_LARGE:
        //     throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_INVALID_KEYLEN, "Supplied key is too large"_s);
        //     return {};
        case ncrypto::DHPointer::CheckPublicKeyResult::INVALID:
            throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_INVALID_KEYTYPE, "Invalid public key for this key exchange"_s);
            return {};
        case ncrypto::DHPointer::CheckPublicKeyResult::CHECK_FAILED:
        default:
            throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "DH check public key failed"_s);
            return {};
        }
    }

    // Compute the shared secret
    auto secret = dh.computeSecret(publicKey);
    if (!secret) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to compute shared secret"_s);
        return {};
    }

    BufferEncodingType outputEncodingType = getEncodingDefaultBuffer(globalObject, scope, outputEncodingArg);
    RETURN_IF_EXCEPTION(scope, {});

    // If output encoding is specified and not "buffer", return a string
    return StringBytes::encode(globalObject, scope, secret.span(), outputEncodingType);
}

template<typename DiffieHellmanType>
JSC::EncodedJSValue jsDiffieHellmanProtoFuncGetPrimeTemplate(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = JSC::jsDynamicCast<DiffieHellmanType*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        throwThisTypeError(*globalObject, scope, DiffieHellmanType::info()->className, "getPrime"_s);
        return {};
    }

    auto& dh = thisObject->getImpl();
    auto prime = dh.getPrime();
    if (!prime) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_INVALID_STATE, "p is null"_s);
        return {};
    }

    // Handle optional encoding parameter
    BufferEncodingType encodingType = getEncodingDefaultBuffer(globalObject, scope, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});

    return StringBytes::encode(globalObject, scope, prime.span(), encodingType);
}

template<typename DiffieHellmanType>
JSC::EncodedJSValue jsDiffieHellmanProtoFuncGetGeneratorTemplate(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = JSC::jsDynamicCast<DiffieHellmanType*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        throwThisTypeError(*globalObject, scope, DiffieHellmanType::info()->className, "getGenerator"_s);
        return {};
    }

    auto& dh = thisObject->getImpl();
    auto gen = dh.getGenerator();
    if (!gen) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_INVALID_STATE, "g is null"_s);
        return {};
    }

    // Handle optional encoding parameter
    BufferEncodingType encodingType = getEncodingDefaultBuffer(globalObject, scope, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});

    return StringBytes::encode(globalObject, scope, gen.span(), encodingType);
}

template<typename DiffieHellmanType>
JSC::EncodedJSValue jsDiffieHellmanProtoFuncGetPublicKeyTemplate(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = JSC::jsDynamicCast<DiffieHellmanType*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        throwThisTypeError(*globalObject, scope, DiffieHellmanType::info()->className, "getPublicKey"_s);
        return {};
    }

    auto& dh = thisObject->getImpl();
    auto key = dh.getPublicKey();
    if (!key) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_INVALID_STATE, "No public key - did you forget to generate one?"_s);
        return {};
    }

    // Handle optional encoding parameter
    BufferEncodingType encodingType = getEncodingDefaultBuffer(globalObject, scope, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});

    return StringBytes::encode(globalObject, scope, key.span(), encodingType);
}

template<typename DiffieHellmanType>
JSC::EncodedJSValue jsDiffieHellmanProtoFuncGetPrivateKeyTemplate(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = JSC::jsDynamicCast<DiffieHellmanType*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        throwThisTypeError(*globalObject, scope, DiffieHellmanType::info()->className, "getPrivateKey"_s);
        return {};
    }

    auto& dh = thisObject->getImpl();
    auto key = dh.getPrivateKey();
    if (!key) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_INVALID_STATE, "No private key - did you forget to generate one?"_s);
        return {};
    }

    auto encoding = getEncodingDefaultBuffer(globalObject, scope, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});

    return StringBytes::encode(globalObject, scope, key.span(), encoding);
}

template<typename DiffieHellmanType>
JSC::EncodedJSValue jsDiffieHellmanProtoFuncSetPublicKeyTemplate(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = JSC::jsDynamicCast<DiffieHellmanType*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        throwThisTypeError(*globalObject, scope, DiffieHellmanType::info()->className, "setPublicKey"_s);
        return {};
    }

    JSC::JSValue keyArg = callFrame->argument(0);

    // Process the public key input
    auto* keyBuffer = Bun::getArrayBufferOrView(globalObject, scope, keyArg, "key"_s, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(keyBuffer);

    auto span = keyBuffer->span();

    ncrypto::BignumPointer key(span.data(), span.size());
    if (!key) {
        throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "Invalid public key"_s);
        return {};
    }

    auto& dh = thisObject->getImpl();

    if (!dh.setPublicKey(WTFMove(key))) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to set public key"_s);
        return {};
    }

    return JSC::JSValue::encode(callFrame->thisValue());
}

template<typename DiffieHellmanType>
JSC::EncodedJSValue jsDiffieHellmanProtoFuncSetPrivateKeyTemplate(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = JSC::jsDynamicCast<DiffieHellmanType*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        throwThisTypeError(*globalObject, scope, DiffieHellmanType::info()->className, "setPrivateKey"_s);
        return {};
    }

    JSC::JSValue keyArg = callFrame->argument(0);

    auto* keyBuffer = Bun::getArrayBufferOrView(globalObject, scope, keyArg, "key"_s, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});
    ASSERT(keyBuffer);

    auto span = keyBuffer->span();
    ncrypto::BignumPointer key(span.data(), span.size());
    if (!key) {
        throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "Invalid private key"_s);
        return {};
    }

    auto& dh = thisObject->getImpl();

    if (!dh.setPrivateKey(WTFMove(key))) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to set private key"_s);
        return {};
    }

    return JSC::JSValue::encode(callFrame->thisValue());
}

} // namespace Bun
