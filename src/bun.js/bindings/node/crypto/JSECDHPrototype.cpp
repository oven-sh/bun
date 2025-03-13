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
    auto keyImpl = ecdh->key().clone();
    if (!keyImpl.generate()) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to generate ECDH key pair"_s);
        return {};
    }

    // Update the instance with the new key
    ecdh->setKey(WTFMove(keyImpl));

    return JSValue::encode(jsUndefined());
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
    {
        ncrypto::MarkPopErrorOnReturn markPopErrorOnReturn;
        if (!ecdh->key().checkKey()) {
            return Bun::ERR::CRYPTO_INVALID_KEYPAIR(scope, globalObject);
        }
    }

    // Get the group from our key
    const EC_GROUP* group = ecdh->key().getGroup();
    if (!group) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_INVALID_STATE, "Failed to get EC_GROUP from key"_s);
        return {};
    }

    // Create an EC_POINT from the buffer
    auto pubPoint = ncrypto::ECPointPointer::New(group);
    if (!pubPoint) {
        return Bun::ERR::CRYPTO_ECDH_INVALID_PUBLIC_KEY(scope, globalObject);
    }

    // Set the point from the buffer
    auto keySpan = keyBuffer->span();
    ncrypto::Buffer<const unsigned char> buffer {
        .data = static_cast<const unsigned char*>(keySpan.data()),
        .len = keySpan.size()
    };

    if (!pubPoint.setFromBuffer(buffer, group)) {
        return Bun::ERR::CRYPTO_ECDH_INVALID_PUBLIC_KEY(scope, globalObject);
    }

    // Compute the field size
    int fieldSize = EC_GROUP_get_degree(group);
    size_t outLen = (fieldSize + 7) / 8;

    // Allocate a buffer for the result
    auto result = JSC::ArrayBuffer::tryCreate(outLen, 1);
    if (!result) {
        throwError(globalObject, scope, ErrorCode::ERR_MEMORY_ALLOCATION_FAILED, "Failed to allocate buffer for ECDH secret"_s);
        return {};
    }

    // Compute the shared secret
    if (!ECDH_compute_key(result->data(), result->byteLength(), pubPoint, ecdh->key().get(), nullptr)) {
        return Bun::ERR::CRYPTO_OPERATION_FAILED(scope, globalObject, "Failed to compute ECDH key"_s);
    }

    // Handle output encoding if provided
    BufferEncodingType outputEncodingType = Bun::getEncodingDefaultBuffer(globalObject, scope, outputEncodingValue);
    RETURN_IF_EXCEPTION(scope, {});

    // Create a span from the result data for encoding
    std::span<const uint8_t> resultSpan(static_cast<const uint8_t*>(result->data()), outLen);

    // Return the encoded result
    return StringBytes::encode(globalObject, scope, resultSpan, outputEncodingType);
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
    JSC::JSValue encodingValue;
    JSC::JSValue formatValue;

    if (callFrame->argumentCount() >= 2) {
        // If there are at least 2 arguments, first is encoding, second is format
        encodingValue = callFrame->argument(0);
        formatValue = callFrame->argument(1);
    } else if (callFrame->argumentCount() == 1) {
        // If only one argument, check if it's a number (format) or string (encoding)
        JSC::JSValue arg = callFrame->argument(0);
        if (arg.isNumber()) {
            formatValue = arg;
        } else {
            encodingValue = arg;
        }
    }

    // Get the format parameter (default to uncompressed format if not provided)
    point_conversion_form_t form = POINT_CONVERSION_UNCOMPRESSED;
    if (formatValue.isUInt32()) {
        form = static_cast<point_conversion_form_t>(formatValue.asUInt32());
        // Validate the form is a valid conversion form
        if (form != POINT_CONVERSION_COMPRESSED && form != POINT_CONVERSION_UNCOMPRESSED && form != POINT_CONVERSION_HYBRID) {
            throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "Invalid point conversion format specified"_s);
            return {};
        }
    } else if (!formatValue.isUndefined() && !formatValue.isNull()) {
        throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "Format argument must be a valid point conversion format"_s);
        return {};
    }

    // Get the group and public key
    const auto group = ecdh->key().getGroup();
    const auto pubKey = ecdh->key().getPublicKey();
    if (!pubKey) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_INVALID_STATE, "Failed to get ECDH public key"_s);
        return {};
    }

    // Calculate the length needed for the result
    size_t bufLen = EC_POINT_point2oct(group, pubKey, form, nullptr, 0, nullptr);
    if (bufLen == 0) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to determine size for public key encoding"_s);
        return {};
    }

    // Create a buffer to hold the result
    auto result = JSC::ArrayBuffer::tryCreate(bufLen, 1);
    if (!result) {
        throwError(globalObject, scope, ErrorCode::ERR_MEMORY_ALLOCATION_FAILED, "Failed to allocate buffer for public key"_s);
        return {};
    }

    // Encode the point to the buffer
    if (EC_POINT_point2oct(group, pubKey, form, static_cast<unsigned char*>(result->data()), bufLen, nullptr) == 0) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to encode public key"_s);
        return {};
    }

    // Handle output encoding if provided
    BufferEncodingType encodingType = Bun::getEncodingDefaultBuffer(globalObject, scope, encodingValue);
    RETURN_IF_EXCEPTION(scope, {});

    // Create a span from the result data for encoding
    std::span<const uint8_t> resultSpan(static_cast<const uint8_t*>(result->data()), bufLen);

    // Return the encoded result
    return StringBytes::encode(globalObject, scope, resultSpan, encodingType);
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
    const BIGNUM* privKey = ecdh->key().getPrivateKey();
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

    // Get the group from our key
    const EC_GROUP* group = ecdh->key().getGroup();
    if (!group) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_INVALID_STATE, "Failed to get EC_GROUP from key"_s);
        return {};
    }

    // Convert the input to a buffer with encoding if provided
    auto* bufferValue = Bun::getArrayBufferOrView(globalObject, scope, keyValue, "key"_s, encodingValue);
    RETURN_IF_EXCEPTION(scope, {});

    if (!bufferValue) {
        throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "Failed to convert key to buffer"_s);
        return {};
    }

    // Create an EC_POINT from the buffer
    auto pubPoint = ncrypto::ECPointPointer::New(group);
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

    if (!pubPoint.setFromBuffer(buffer, group)) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to set EC_POINT from buffer"_s);
        return {};
    }

    // Clone the existing key, set the public key, then update the instance
    auto newKey = ecdh->key().clone();
    if (!newKey) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to clone EC key"_s);
        return {};
    }

    // Set the public key
    if (!newKey.setPublicKey(pubPoint)) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to set EC_POINT as the public key"_s);
        return {};
    }

    // Replace the old key with the new one
    ecdh->setKey(WTFMove(newKey));

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
    if (!isKeyValidForCurve(ecdh->key().getGroup(), privateKey)) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_INVALID_KEYTYPE, "Private key is not valid for the specified curve"_s);
        return {};
    }

    // Clone the existing key
    auto newKey = ecdh->key().clone();
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
    auto pubPoint = ncrypto::ECPointPointer::New(ecdh->key().getGroup());
    if (!pubPoint) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to allocate EC_POINT for public key"_s);
        return {};
    }

    // Compute the public key point from the private key
    if (!pubPoint.mul(ecdh->key().getGroup(), privKey)) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to compute public key from private key"_s);
        return {};
    }

    // Set the public key
    if (!newKey.setPublicKey(pubPoint)) {
        throwError(globalObject, scope, ErrorCode::ERR_CRYPTO_OPERATION_FAILED, "Failed to set public key"_s);
        return {};
    }

    // Replace the old key with the new one
    ecdh->setKey(WTFMove(newKey));

    // Return this for chaining
    return JSValue::encode(callFrame->thisValue());
}

} // namespace Bun
