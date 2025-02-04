#include "NodeCrypto.h"
#include "KeyObject.h"
#include "ErrorCode.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSCJSValue.h"
#include "JavaScriptCore/JSCast.h"
#include "ZigGlobalObject.h"
#include "webcrypto/JSCryptoKey.h"
#include "webcrypto/JSSubtleCrypto.h"
#include "webcrypto/CryptoKeyOKP.h"
#include "webcrypto/CryptoKeyEC.h"
#include "webcrypto/CryptoKeyRSA.h"
#include "webcrypto/CryptoKeyAES.h"
#include "webcrypto/CryptoKeyHMAC.h"
#include "webcrypto/CryptoKeyRaw.h"
#include "webcrypto/CryptoKeyUsage.h"
#include "webcrypto/JsonWebKey.h"
#include "webcrypto/JSJsonWebKey.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "headers-handwritten.h"
#include <openssl/evp.h>
#include <openssl/mem.h>
#include <openssl/x509.h>
#include <openssl/pem.h>
#include <openssl/curve25519.h>
#include "JSBuffer.h"
#include "CryptoAlgorithmHMAC.h"
#include "CryptoAlgorithmEd25519.h"
#include "CryptoAlgorithmRSA_OAEP.h"
#include "CryptoAlgorithmRSA_PSS.h"
#include "CryptoAlgorithmRSASSA_PKCS1_v1_5.h"
#include "CryptoAlgorithmECDSA.h"
#include "CryptoAlgorithmEcdsaParams.h"
#include "CryptoAlgorithmRsaOaepParams.h"
#include "CryptoAlgorithmRsaPssParams.h"
#include "CryptoAlgorithmRegistry.h"
#include "wtf/ForbidHeapAllocation.h"
#include "wtf/Noncopyable.h"
#include "ncrypto.h"
#include "AsymmetricKeyValue.h"
#include "NodeValidator.h"

using namespace JSC;
using namespace Bun;

namespace WebCore {

JSC_DEFINE_HOST_FUNCTION(jsStatelessDH, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 2) {
        return Bun::ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "diffieHellman"_s, jsUndefined(), "requires 2 arguments"_s);
    }

    auto* privateKeyObj = JSC::jsDynamicCast<JSCryptoKey*>(callFrame->argument(0));
    auto* publicKeyObj = JSC::jsDynamicCast<JSCryptoKey*>(callFrame->argument(1));

    if (!privateKeyObj || !publicKeyObj) {
        return Bun::ERR::INVALID_ARG_TYPE(scope, lexicalGlobalObject, "diffieHellman"_s, "CryptoKey"_s, !privateKeyObj ? callFrame->argument(0) : callFrame->argument(1));
    }

    auto& privateKey = privateKeyObj->wrapped();
    auto& publicKey = publicKeyObj->wrapped();

    // Create AsymmetricKeyValue objects to access the EVP_PKEY pointers
    WebCore::AsymmetricKeyValue ourKeyValue(privateKey);
    WebCore::AsymmetricKeyValue theirKeyValue(publicKey);

    // Get the EVP_PKEY from both keys
    EVP_PKEY* ourKey = ourKeyValue.key;
    EVP_PKEY* theirKey = theirKeyValue.key;

    if (!ourKey || !theirKey) {
        return Bun::ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "key"_s, jsUndefined(), "is invalid"_s);
    }

    // Create EVPKeyPointers to wrap the keys
    ncrypto::EVPKeyPointer ourKeyPtr(ourKey);
    ncrypto::EVPKeyPointer theirKeyPtr(theirKey);

    // Use DHPointer::stateless to compute the shared secret
    auto secret = ncrypto::DHPointer::stateless(ourKeyPtr, theirKeyPtr).release();

    // These are owned by AsymmetricKeyValue, not by EVPKeyPointer.
    ourKeyPtr.release();
    theirKeyPtr.release();

    auto buffer = ArrayBuffer::createFromBytes({ reinterpret_cast<const uint8_t*>(secret.data), secret.len }, createSharedTask<void(void*)>([](void* p) {
        OPENSSL_free(p);
    }));
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto* result = JSC::JSUint8Array::create(lexicalGlobalObject, globalObject->JSBufferSubclassStructure(), WTFMove(buffer), 0, secret.len);
    RETURN_IF_EXCEPTION(scope, {});
    if (!result) {
        return Bun::ERR::INVALID_ARG_VALUE(scope, lexicalGlobalObject, "diffieHellman"_s, jsUndefined(), "failed to allocate result buffer"_s);
    }

    return JSC::JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsECDHConvertKey, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ncrypto::ClearErrorOnReturn clearErrorOnReturn;

    if (callFrame->argumentCount() < 3)
        return throwVMError(lexicalGlobalObject, scope, "ECDH.convertKey requires 3 arguments"_s);

    auto keyBuffer = KeyObject__GetBuffer(callFrame->argument(0));
    if (keyBuffer.hasException())
        return JSValue::encode(jsUndefined());

    if (keyBuffer.returnValue().isEmpty())
        return JSValue::encode(JSC::jsEmptyString(vm));

    auto curveName = callFrame->argument(1).toWTFString(lexicalGlobalObject);
    if (scope.exception())
        return encodedJSValue();

    int nid = OBJ_sn2nid(curveName.utf8().data());
    if (nid == NID_undef)
        return Bun::ERR::CRYPTO_INVALID_CURVE(scope, lexicalGlobalObject);

    auto group = ncrypto::ECGroupPointer::NewByCurveName(nid);
    if (!group)
        return throwVMError(lexicalGlobalObject, scope, "Failed to get EC_GROUP"_s);

    auto point = ncrypto::ECPointPointer::New(group);
    if (!point)
        return throwVMError(lexicalGlobalObject, scope, "Failed to create EC_POINT"_s);

    const unsigned char* key_data = keyBuffer.returnValue().data();
    size_t key_length = keyBuffer.returnValue().size();

    if (!EC_POINT_oct2point(group, point, key_data, key_length, nullptr))
        return throwVMError(lexicalGlobalObject, scope, "Failed to convert Buffer to EC_POINT"_s);

    uint32_t form = callFrame->argument(2).toUInt32(lexicalGlobalObject);
    if (scope.exception())
        return encodedJSValue();

    size_t size = EC_POINT_point2oct(group, point, static_cast<point_conversion_form_t>(form), nullptr, 0, nullptr);
    if (size == 0)
        return throwVMError(lexicalGlobalObject, scope, "Failed to calculate buffer size"_s);

    auto buf = ArrayBuffer::createUninitialized(size, 1);
    if (!EC_POINT_point2oct(group, point, static_cast<point_conversion_form_t>(form), reinterpret_cast<uint8_t*>(buf->data()), size, nullptr))
        return throwVMError(lexicalGlobalObject, scope, "Failed to convert EC_POINT to Buffer"_s);

    auto* result = JSC::JSUint8Array::create(lexicalGlobalObject, reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject)->JSBufferSubclassStructure(), WTFMove(buf), 0, size);

    if (!result)
        return throwVMError(lexicalGlobalObject, scope, "Failed to allocate result buffer"_s);

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsGetCurves, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    const size_t numCurves = EC_get_builtin_curves(nullptr, 0);
    Vector<EC_builtin_curve> curves(numCurves);
    EC_get_builtin_curves(curves.data(), numCurves);

    JSArray* result = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, numCurves);
    RETURN_IF_EXCEPTION(scope, {});

    for (size_t i = 0; i < numCurves; i++) {
        const char* curveName = OBJ_nid2sn(curves[i].nid);
        auto curveWTFStr = WTF::String::fromUTF8(curveName);
        JSString* curveStr = JSC::jsString(vm, curveWTFStr);
        result->putDirectIndex(lexicalGlobalObject, i, curveStr);
        RETURN_IF_EXCEPTION(scope, {});
    }

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsGetCiphers, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ncrypto::MarkPopErrorOnReturn mark_pop_error_on_return;

    // Create an array to store cipher names
    JSC::JSArray* result = JSC::constructEmptyArray(lexicalGlobalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, {});

    struct CipherPushContext {
        JSC::JSGlobalObject* globalObject;
        JSC::JSArray* array;
        int index;
        JSC::VM& vm;
        bool hasException;
    };

    CipherPushContext ctx = {
        lexicalGlobalObject,
        result,
        0,
        vm,
        false
    };

    auto callback = [](const EVP_CIPHER* cipher, const char* name, const char* /*unused*/, void* arg) {
        auto* ctx = static_cast<CipherPushContext*>(arg);
        if (ctx->hasException)
            return;

        auto cipherStr = JSC::jsString(ctx->vm, String::fromUTF8(name));
        if (!ctx->array->putDirectIndex(ctx->globalObject, ctx->index++, cipherStr))
            ctx->hasException = true;
    };

    EVP_CIPHER_do_all_sorted(callback, &ctx);

    if (ctx.hasException)
        return JSValue::encode({});

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(jsCertVerifySpkac, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto input = KeyObject__GetBuffer(callFrame->argument(0));
    if (input.hasException()) {
        return JSValue::encode(jsUndefined());
    }

    auto buffer = input.returnValue();
    if (buffer.size() > std::numeric_limits<int32_t>().max()) {
        return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "spkac"_s, 0, std::numeric_limits<int32_t>().max(), jsNumber(buffer.size()));
    }

    bool result = ncrypto::VerifySpkac(reinterpret_cast<const char*>(buffer.data()), buffer.size());
    return JSValue::encode(JSC::jsBoolean(result));
}

JSC_DEFINE_HOST_FUNCTION(jsCertExportPublicKey, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto input = KeyObject__GetBuffer(callFrame->argument(0));
    if (input.hasException()) {
        return JSValue::encode(jsEmptyString(vm));
    }

    auto buffer = input.returnValue();
    if (buffer.size() > std::numeric_limits<int32_t>().max()) {
        return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "spkac"_s, 0, std::numeric_limits<int32_t>().max(), jsNumber(buffer.size()));
    }

    auto bio = ncrypto::ExportPublicKey(reinterpret_cast<const char*>(buffer.data()), buffer.size());
    if (!bio) {
        return JSValue::encode(jsEmptyString(vm));
    }

    char* data = nullptr;
    long len = BIO_get_mem_data(bio.get(), &data);
    if (len <= 0 || data == nullptr) {
        return JSValue::encode(jsEmptyString(vm));
    }

    return JSValue::encode(jsString(vm, String::fromUTF8({ data, static_cast<size_t>(len) })));
}

JSC_DEFINE_HOST_FUNCTION(jsCertExportChallenge, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto input = KeyObject__GetBuffer(callFrame->argument(0));
    if (input.hasException()) {
        return JSValue::encode(jsEmptyString(vm));
    }

    auto buffer = input.returnValue();
    if (buffer.size() > std::numeric_limits<int32_t>().max()) {
        return Bun::ERR::OUT_OF_RANGE(scope, lexicalGlobalObject, "spkac"_s, 0, std::numeric_limits<int32_t>().max(), jsNumber(buffer.size()));
    }

    auto cert = ncrypto::ExportChallenge(reinterpret_cast<const char*>(buffer.data()), buffer.size());
    if (!cert.data || cert.len == 0) {
        return JSValue::encode(jsEmptyString(vm));
    }

    auto result = JSC::ArrayBuffer::tryCreate({ reinterpret_cast<const uint8_t*>(cert.data), cert.len });
    if (!result) {
        return JSValue::encode(jsEmptyString(vm));
    }

    auto* bufferResult = JSC::JSUint8Array::create(lexicalGlobalObject, reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject)->JSBufferSubclassStructure(), WTFMove(result), 0, cert.len);

    return JSValue::encode(bufferResult);
}

JSC_DEFINE_HOST_FUNCTION(jsGetCipherInfo, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    ncrypto::MarkPopErrorOnReturn mark_pop_error_on_return;

    if (callFrame->argumentCount() < 2) {
        return JSValue::encode(jsUndefined());
    }

    if (!callFrame->argument(0).isObject()) {
        return JSValue::encode(jsUndefined());
    }

    JSObject* info = callFrame->argument(0).getObject();

    // Get cipher from name or nid
    ncrypto::Cipher cipher;
    if (callFrame->argument(1).isString()) {
        auto cipherName = callFrame->argument(1).toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        cipher = ncrypto::Cipher::FromName(cipherName.utf8().data());
    } else if (callFrame->argument(1).isInt32()) {
        int nid = callFrame->argument(1).asInt32();
        cipher = ncrypto::Cipher::FromNid(nid);
    }

    if (!cipher) {
        return JSValue::encode(jsUndefined());
    }

    int iv_length = cipher.getIvLength();
    int key_length = cipher.getKeyLength();
    int block_length = cipher.getBlockSize();

    // Test key and IV lengths if provided
    if (callFrame->argumentCount() >= 3 && (callFrame->argument(2).isInt32() || callFrame->argument(3).isInt32())) {
        auto ctx = ncrypto::CipherCtxPointer::New();
        if (!ctx.init(cipher, true)) {
            return JSValue::encode(jsUndefined());
        }

        if (callFrame->argument(2).isInt32()) {
            int check_len = callFrame->argument(2).asInt32();
            if (!ctx.setKeyLength(check_len)) {
                return JSValue::encode(jsUndefined());
            }
            key_length = check_len;
        }

        if (callFrame->argument(3).isInt32()) {
            int check_len = callFrame->argument(3).asInt32();
            switch (cipher.getMode()) {
            case EVP_CIPH_CCM_MODE:
                if (check_len < 7 || check_len > 13)
                    return JSValue::encode(jsUndefined());
                break;
            case EVP_CIPH_GCM_MODE:
            case EVP_CIPH_OCB_MODE:
                if (!ctx.setIvLength(check_len)) {
                    return JSValue::encode(jsUndefined());
                }
                break;
            default:
                if (check_len != iv_length)
                    return JSValue::encode(jsUndefined());
            }
            iv_length = check_len;
        }
    }

    // Set mode if available
    auto mode_label = cipher.getModeLabel();
    if (!mode_label.empty()) {
        info->putDirect(vm, PropertyName(Identifier::fromString(vm, "mode"_s)),
            jsString(vm, String::fromUTF8({ mode_label.data(), mode_label.length() })));
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Set name
    auto name = cipher.getName();
    info->putDirect(vm, vm.propertyNames->name,
        jsString(vm, String::fromUTF8({ name.data(), name.length() })));
    RETURN_IF_EXCEPTION(scope, {});

    // Set nid
    info->putDirect(vm, PropertyName(Identifier::fromString(vm, "nid"_s)),
        jsNumber(cipher.getNid()));
    RETURN_IF_EXCEPTION(scope, {});

    // Set blockSize for non-stream ciphers
    if (cipher.getMode() != EVP_CIPH_STREAM_CIPHER) {
        info->putDirect(vm, PropertyName(Identifier::fromString(vm, "blockSize"_s)),
            jsNumber(block_length));
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Set ivLength if cipher uses IV
    if (iv_length != 0) {
        info->putDirect(vm, PropertyName(Identifier::fromString(vm, "ivLength"_s)),
            jsNumber(iv_length));
        RETURN_IF_EXCEPTION(scope, {});
    }

    // Set keyLength
    info->putDirect(vm, PropertyName(Identifier::fromString(vm, "keyLength"_s)),
        jsNumber(key_length));
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(info);
}

JSValue createNodeCryptoBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    JSObject* obj = constructEmptyObject(globalObject);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "statelessDH"_s)),
        JSFunction::create(vm, globalObject, 2, "statelessDH"_s, jsStatelessDH, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "ecdhConvertKey"_s)),
        JSFunction::create(vm, globalObject, 3, "ecdhConvertKey"_s, jsECDHConvertKey, ImplementationVisibility::Public, NoIntrinsic), 0);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "certVerifySpkac"_s)),
        JSFunction::create(vm, globalObject, 1, "verifySpkac"_s, jsCertVerifySpkac, ImplementationVisibility::Public, NoIntrinsic), 1);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "certExportPublicKey"_s)),
        JSFunction::create(vm, globalObject, 1, "certExportPublicKey"_s, jsCertExportPublicKey, ImplementationVisibility::Public, NoIntrinsic), 1);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "certExportChallenge"_s)),
        JSFunction::create(vm, globalObject, 1, "certExportChallenge"_s, jsCertExportChallenge, ImplementationVisibility::Public, NoIntrinsic), 1);

    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "getCurves"_s)),
        JSFunction::create(vm, globalObject, 0, "getCurves"_s, jsGetCurves, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "getCiphers"_s)),
        JSFunction::create(vm, globalObject, 0, "getCiphers"_s, jsGetCiphers, ImplementationVisibility::Public, NoIntrinsic), 0);
    obj->putDirect(vm, PropertyName(Identifier::fromString(vm, "_getCipherInfo"_s)),
        JSFunction::create(vm, globalObject, 1, "_getCipherInfo"_s, jsGetCipherInfo, ImplementationVisibility::Public, NoIntrinsic), 4);

    return obj;
}

} // namespace WebCore
