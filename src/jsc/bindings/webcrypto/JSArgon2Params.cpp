#include "config.h"

#if ENABLE(WEB_CRYPTO)

#include "JSArgon2Params.h"

#include "JSDOMConvertBufferSource.h"
#include "JSDOMConvertNumbers.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMConvertUnion.h"
#include <JavaScriptCore/JSCInlines.h>

namespace WebCore {
using namespace JSC;

// Conversion only; the OperationError rules live in CryptoAlgorithmArgon2::validateDeriveBits.
template<> CryptoAlgorithmArgon2Params convertDictionary<CryptoAlgorithmArgon2Params>(JSGlobalObject& lexicalGlobalObject, JSValue value)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    bool isNullOrUndefined = value.isUndefinedOrNull();
    auto* object = isNullOrUndefined ? nullptr : value.getObject();
    if (!isNullOrUndefined && !object) [[unlikely]] {
        throwTypeError(&lexicalGlobalObject, throwScope);
        return {};
    }
    CryptoAlgorithmArgon2Params result;
    auto getMember = [&](ASCIILiteral name) -> JSValue {
        if (isNullOrUndefined)
            return jsUndefined();
        return object->get(&lexicalGlobalObject, Identifier::fromString(vm, name));
    };

    JSValue nameValue;
    if (isNullOrUndefined)
        nameValue = jsUndefined();
    else {
        nameValue = object->get(&lexicalGlobalObject, vm.propertyNames->name);
        RETURN_IF_EXCEPTION(throwScope, {});
    }
    if (!nameValue.isUndefined()) {
        result.name = convert<IDLDOMString>(lexicalGlobalObject, nameValue);
        RETURN_IF_EXCEPTION(throwScope, {});
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "name"_s, "Argon2Params"_s, "DOMString"_s);
        return {};
    }

    JSValue associatedDataValue = getMember("associatedData"_s);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (!associatedDataValue.isUndefined()) {
        result.associatedData = convert<IDLUnion<IDLArrayBufferView, IDLArrayBuffer>>(lexicalGlobalObject, associatedDataValue);
        RETURN_IF_EXCEPTION(throwScope, {});
    }

    JSValue memoryValue = getMember("memory"_s);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (!memoryValue.isUndefined()) {
        result.memory = convert<IDLEnforceRangeAdaptor<IDLUnsignedLong>>(lexicalGlobalObject, memoryValue);
        RETURN_IF_EXCEPTION(throwScope, {});
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "memory"_s, "Argon2Params"_s, "unsigned long"_s);
        return {};
    }

    JSValue nonceValue = getMember("nonce"_s);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (!nonceValue.isUndefined()) {
        result.nonce = convert<IDLUnion<IDLArrayBufferView, IDLArrayBuffer>>(lexicalGlobalObject, nonceValue);
        RETURN_IF_EXCEPTION(throwScope, {});
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "nonce"_s, "Argon2Params"_s, "(ArrayBufferView or ArrayBuffer)"_s);
        return {};
    }

    JSValue parallelismValue = getMember("parallelism"_s);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (!parallelismValue.isUndefined()) {
        result.parallelism = convert<IDLEnforceRangeAdaptor<IDLUnsignedLong>>(lexicalGlobalObject, parallelismValue);
        RETURN_IF_EXCEPTION(throwScope, {});
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "parallelism"_s, "Argon2Params"_s, "unsigned long"_s);
        return {};
    }

    JSValue passesValue = getMember("passes"_s);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (!passesValue.isUndefined()) {
        result.passes = convert<IDLEnforceRangeAdaptor<IDLUnsignedLong>>(lexicalGlobalObject, passesValue);
        RETURN_IF_EXCEPTION(throwScope, {});
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "passes"_s, "Argon2Params"_s, "unsigned long"_s);
        return {};
    }

    JSValue secretValueValue = getMember("secretValue"_s);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (!secretValueValue.isUndefined()) {
        result.secretValue = convert<IDLUnion<IDLArrayBufferView, IDLArrayBuffer>>(lexicalGlobalObject, secretValueValue);
        RETURN_IF_EXCEPTION(throwScope, {});
    }

    JSValue versionValue = getMember("version"_s);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (!versionValue.isUndefined()) {
        result.version = convert<IDLEnforceRangeAdaptor<IDLOctet>>(lexicalGlobalObject, versionValue);
        RETURN_IF_EXCEPTION(throwScope, {});
    }

    return result;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
