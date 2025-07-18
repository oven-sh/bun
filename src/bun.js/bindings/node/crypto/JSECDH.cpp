#include "JSECDH.h"
#include "JSECDHPrototype.h"
#include "JSECDHConstructor.h"
#include "DOMIsoSubspaces.h"
#include "ZigGlobalObject.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/LazyClassStructure.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/ObjectPrototype.h>
#include <JavaScriptCore/FunctionPrototype.h>
#include "BufferEncodingType.h"
#include "CryptoUtil.h"

namespace Bun {

const JSC::ClassInfo JSECDH::s_info = { "ECDH"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSECDH) };

void JSECDH::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
}

template<typename Visitor>
void JSECDH::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSECDH* thisObject = jsCast<JSECDH*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}

point_conversion_form_t JSECDH::getFormat(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue formatValue)
{
    if (formatValue.pureToBoolean() != TriState::False) {
        WTF::String formatString = formatValue.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        if (formatString == "compressed"_s) {
            return POINT_CONVERSION_COMPRESSED;
        }

        if (formatString == "hybrid"_s) {
            return POINT_CONVERSION_HYBRID;
        }

        if (formatString != "uncompressed"_s) {
            Bun::ERR::CRYPTO_ECDH_INVALID_FORMAT(scope, globalObject, formatString);
        }
    }
    return POINT_CONVERSION_UNCOMPRESSED;
}

EncodedJSValue JSECDH::getPublicKey(JSGlobalObject* globalObject, ThrowScope& scope, JSValue encodingValue, JSValue formatValue)
{
    point_conversion_form_t form = JSECDH::getFormat(globalObject, scope, formatValue);
    RETURN_IF_EXCEPTION(scope, {});

    // Get the group and public key
    const auto group = m_key.getGroup();
    const auto pubKey = m_key.getPublicKey();
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
    BufferEncodingType encodingType = getEncodingDefaultBuffer(globalObject, scope, encodingValue);
    RETURN_IF_EXCEPTION(scope, {});

    // Create a span from the result data for encoding
    std::span<const uint8_t> resultSpan(static_cast<const uint8_t*>(result->data()), bufLen);

    // Return the encoded result
    RELEASE_AND_RETURN(scope, StringBytes::encode(globalObject, scope, resultSpan, encodingType));
}

DEFINE_VISIT_CHILDREN(JSECDH);

void setupECDHClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSECDHPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSECDHPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSECDHConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSECDHConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSECDH::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
