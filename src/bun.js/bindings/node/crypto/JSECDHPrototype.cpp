#include "JSECDHPrototype.h"
#include "JSECDH.h"
#include "ErrorCode.h"

#include "NodeValidator.h"
#include "JSBufferEncodingType.h"
#include "CryptoUtil.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/ThrowScope.h>

namespace Bun {

// Declare host function prototypes
JSC_DECLARE_HOST_FUNCTION(jsECDHProtoFuncComputeSecret);
JSC_DECLARE_HOST_FUNCTION(jsECDHProtoFuncGetPublicKey);
JSC_DECLARE_HOST_FUNCTION(jsECDHProtoFuncGetPrivateKey);
JSC_DECLARE_HOST_FUNCTION(jsECDHProtoFuncSetPublicKey);
JSC_DECLARE_HOST_FUNCTION(jsECDHProtoFuncSetPrivateKey);
JSC_DECLARE_HOST_FUNCTION(jsECDHProtoFuncGenerateKeys);

const JSC::ClassInfo JSECDHPrototype::s_info = { "ECDH"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSECDHPrototype) };

static const JSC::HashTableValue JSECDHPrototypeTableValues[] = {
    { "getPublicKey"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsECDHProtoFuncGetPublicKey, 2 } },
    { "getPrivateKey"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsECDHProtoFuncGetPrivateKey, 1 } },
    { "setPublicKey"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsECDHProtoFuncSetPublicKey, 2 } },
    { "setPrivateKey"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsECDHProtoFuncSetPrivateKey, 2 } },
    { "generateKeys"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsECDHProtoFuncGenerateKeys, 0 } },
    { "computeSecret"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), JSC::NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsECDHProtoFuncComputeSecret, 3 } },
};

void JSECDHPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSECDHPrototype::info(), JSECDHPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSC_DEFINE_HOST_FUNCTION(jsECDHProtoFuncGenerateKeys, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* ecdh = jsDynamicCast<JSECDH*>(callFrame->thisValue());
    if (!ecdh) {
        throwThisTypeError(*globalObject, scope, "ECDH"_s, "generateKeys"_s);
        return {};
    }

    // Get a copy of the key we can modify
    if (!ecdh->m_key.generate()) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to generate ECDH key pair"_s);
        return {};
    }

    JSValue encodingValue = callFrame->argument(0);
    JSValue formatValue = callFrame->argument(1);

    return ecdh->getPublicKey(globalObject, scope, encodingValue, formatValue);
}

JSC_DEFINE_HOST_FUNCTION(jsECDHProtoFuncComputeSecret, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* ecdh = jsDynamicCast<JSECDH*>(callFrame->thisValue());
    if (!ecdh) {
        throwThisTypeError(*globalObject, scope, "ECDH"_s, "computeSecret"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        throwError(globalObject, scope, ErrorCode::ERR_MISSING_ARGS, "ECDH.prototype.computeSecret requires a key argument"_s);
        return {};
    }

    JSC::JSValue keyValue = callFrame->argument(0);
    JSC::JSValue inputEncodingValue = callFrame->argument(1);
    JSC::JSValue outputEncodingValue = callFrame->argument(2);

    // Get the arguments - use the input encoding if provided
    auto* keyBuffer = Bun::getArrayBufferOrView(globalObject, scope, keyValue, "key"_s, inputEncodingValue);
    RETURN_IF_EXCEPTION(scope, {});

    if (!keyBuffer) {
        throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "Key argument must be an ArrayBuffer or ArrayBufferView"_s);
        return {};
    }

    // Validate that we have a valid key pair
    ncrypto::MarkPopErrorOnReturn markPopErrorOnReturn;
    if (!ecdh->m_key.checkKey()) {
        return Bun::ERR::CRYPTO_INVALID_KEYPAIR(scope, globalObject);
    }

    // Create an EC_POINT from the buffer
    auto pubPoint = ncrypto::ECPointPointer::New(ecdh->m_group);
    if (!pubPoint) {
        return Bun::ERR::CRYPTO_ECDH_INVALID_PUBLIC_KEY(scope, globalObject);
    }

    // Set the point from the buffer
    auto keySpan = keyBuffer->span();
    ncrypto::Buffer<const unsigned char> buffer {
        .data = static_cast<const unsigned char*>(keySpan.data()),
        .len = keySpan.size()
    };

    if (!pubPoint.setFromBuffer(buffer, ecdh->m_group)) {
        return Bun::ERR::CRYPTO_ECDH_INVALID_PUBLIC_KEY(scope, globalObject);
    }

    // Compute the field size
    int fieldSize = EC_GROUP_get_degree(ecdh->m_group);
    size_t outLen = (fieldSize + 7) / 8;

    WTF::Vector<uint8_t> secret;
    if (!secret.tryGrow(outLen)) {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    // Compute the shared secret
    if (!ECDH_compute_key(secret.begin(), secret.size(), pubPoint, ecdh->m_key.get(), nullptr)) {
        return Bun::ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Failed to compute ECDH key"_s);
    }

    // Handle output encoding if provided
    BufferEncodingType outputEncodingType = Bun::getEncodingDefaultBuffer(globalObject, scope, outputEncodingValue);
    RETURN_IF_EXCEPTION(scope, {});

    // Return the encoded result
    return StringBytes::encode(globalObject, scope, secret.span(), outputEncodingType);
}

JSC_DEFINE_HOST_FUNCTION(jsECDHProtoFuncGetPublicKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* ecdh = jsDynamicCast<JSECDH*>(callFrame->thisValue());
    if (!ecdh) {
        throwThisTypeError(*globalObject, scope, "ECDH"_s, "getPublicKey"_s);
        return {};
    }

    // Get encoding parameter - first argument could be encoding or format
    JSC::JSValue encodingValue = callFrame->argument(0);
    JSC::JSValue formatValue = callFrame->argument(1);

    // Get the format parameter (default to uncompressed format if not provided)
    return ecdh->getPublicKey(globalObject, scope, encodingValue, formatValue);
}

JSC_DEFINE_HOST_FUNCTION(jsECDHProtoFuncGetPrivateKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* ecdh = jsDynamicCast<JSECDH*>(callFrame->thisValue());
    if (!ecdh) {
        throwThisTypeError(*globalObject, scope, "ECDH"_s, "getPrivateKey"_s);
        return {};
    }

    // Get the private key as a BIGNUM
    const BIGNUM* privKey = ecdh->m_key.getPrivateKey();
    if (!privKey) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_INVALID_STATE, "Failed to get ECDH private key"_s);
        return {};
    }

    // Calculate the byte length of the private key
    size_t byteLength = ncrypto::BignumPointer::GetByteCount(privKey);

    // Create a buffer to hold the private key
    auto result = JSC::ArrayBuffer::tryCreate(byteLength, 1);
    if (!result) {
        throwError(globalObject, scope, ErrorCode::ERR_MEMORY_ALLOCATION_FAILED, "Failed to allocate buffer for private key"_s);
        return {};
    }

    // Encode the BIGNUM into the buffer
    if (ncrypto::BignumPointer::EncodePaddedInto(privKey,
            static_cast<unsigned char*>(result->data()),
            byteLength)
        != byteLength) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to encode private key"_s);
        return {};
    }

    // Handle encoding parameter if provided
    BufferEncodingType encodingType = Bun::getEncodingDefaultBuffer(globalObject, scope, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});

    // Create a span from the result data for encoding
    std::span<const uint8_t> resultSpan(static_cast<const uint8_t*>(result->data()), byteLength);

    // Return the encoded result
    return StringBytes::encode(globalObject, scope, resultSpan, encodingType);
}

JSC_DEFINE_HOST_FUNCTION(jsECDHProtoFuncSetPublicKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* ecdh = jsDynamicCast<JSECDH*>(callFrame->thisValue());
    if (!ecdh) {
        throwThisTypeError(*globalObject, scope, "ECDH"_s, "setPublicKey"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        throwError(globalObject, scope, ErrorCode::ERR_MISSING_ARGS, "ECDH.prototype.setPublicKey requires a key argument"_s);
        return {};
    }

    JSC::JSValue keyValue = callFrame->argument(0);
    JSC::JSValue encodingValue = callFrame->argument(1);

    // Convert the input to a buffer with encoding if provided
    auto* bufferValue = Bun::getArrayBufferOrView(globalObject, scope, keyValue, "key"_s, encodingValue);
    RETURN_IF_EXCEPTION(scope, {});

    if (!bufferValue) {
        throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "Failed to convert key to buffer"_s);
        return {};
    }

    ncrypto::MarkPopErrorOnReturn markPopErrorOnReturn;

    // Create an EC_POINT from the buffer
    auto pubPoint = ncrypto::ECPointPointer::New(ecdh->m_group);
    if (!pubPoint) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to allocate EC_POINT for public key"_s);
        return {};
    }

    // Set the point from the buffer
    auto keySpan = bufferValue->span();
    ncrypto::Buffer<const unsigned char> buffer {
        .data = static_cast<const unsigned char*>(keySpan.data()),
        .len = keySpan.size()
    };

    if (!pubPoint.setFromBuffer(buffer, ecdh->m_group)) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to set EC_POINT from buffer"_s);
        return {};
    }

    // Set the public key
    if (!ecdh->m_key.setPublicKey(pubPoint)) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to set EC_POINT as the public key"_s);
        return {};
    }

    // Return this for chaining
    return JSValue::encode(callFrame->thisValue());
}

JSC_DEFINE_HOST_FUNCTION(jsECDHProtoFuncSetPrivateKey, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* ecdh = jsDynamicCast<JSECDH*>(callFrame->thisValue());
    if (!ecdh) {
        throwThisTypeError(*globalObject, scope, "ECDH"_s, "setPrivateKey"_s);
        return {};
    }

    if (callFrame->argumentCount() < 1) {
        throwError(globalObject, scope, ErrorCode::ERR_MISSING_ARGS, "ECDH.prototype.setPrivateKey requires a key argument"_s);
        return {};
    }

    JSC::JSValue keyValue = callFrame->argument(0);
    JSC::JSValue encodingValue = callFrame->argument(1);

    // Convert the input to a buffer with encoding if provided
    auto* bufferValue = Bun::getArrayBufferOrView(globalObject, scope, keyValue, "key"_s, encodingValue);
    RETURN_IF_EXCEPTION(scope, {});

    if (!bufferValue) {
        throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "Failed to convert key to buffer"_s);
        return {};
    }

    // Create a BN from the buffer
    auto keySpan = bufferValue->span();
    ncrypto::BignumPointer privateKey(static_cast<const unsigned char*>(keySpan.data()), keySpan.size());
    if (!privateKey) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to convert buffer to BIGNUM for private key"_s);
        return {};
    }

    // Validate the key is valid for the curve
    if (!isKeyValidForCurve(ecdh->m_group, privateKey)) {
        return Bun::ERR::CRYPTO_INVALID_KEYTYPE(scope, globalObject, "Private key is not valid for specified curve"_s);
    }

    // Clone the existing key
    auto newKey = ecdh->m_key.clone();
    if (!newKey) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to clone EC key"_s);
        return {};
    }

    // Set the private key
    if (!newKey.setPrivateKey(privateKey)) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to set private key"_s);
        return {};
    }

    // Generate the public key from the private key
    const BIGNUM* privKey = newKey.getPrivateKey();
    if (!privKey) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_INVALID_STATE, "Failed to get private key"_s);
        return {};
    }

    // Create a new EC_POINT for the public key
    auto pubPoint = ncrypto::ECPointPointer::New(ecdh->m_group);
    if (!pubPoint) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to allocate EC_POINT for public key"_s);
        return {};
    }

    // Compute the public key point from the private key
    if (!pubPoint.mul(ecdh->m_group, privKey)) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to compute public key from private key"_s);
        return {};
    }

    // Set the public key
    if (!newKey.setPublicKey(pubPoint)) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to set public key"_s);
        return {};
    }

    // Replace the old key with the new one
    ecdh->m_key = WTFMove(newKey);
    ecdh->m_group = ecdh->m_key.getGroup();

    // Return this for chaining
    return JSValue::encode(callFrame->thisValue());
}

} // namespace Bun
