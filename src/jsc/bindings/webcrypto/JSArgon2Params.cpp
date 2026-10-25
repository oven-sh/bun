#include "config.h"

#if ENABLE(WEB_CRYPTO)

#include "JSArgon2Params.h"

#include "CryptoAlgorithmArgon2.h"
#include "JSDOMConvertBufferSource.h"
#include "JSDOMConvertNumbers.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMConvertUnion.h"
#include "JSDOMExceptionHandling.h"
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/text/MakeString.h>

namespace WebCore {
using namespace JSC;

// Node's converters.Argon2Params (lib/internal/crypto/webidl.js). Members are
// read in WebIDL order (name, then the rest sorted by name) and each member's
// OperationError validator runs right after that member converts, so a
// dictionary with two bad members reports the same one node reports. The
// memory rule reads the raw `parallelism` value, as node's validator does.
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
    auto reject = [&](ASCIILiteral message) {
        propagateException(lexicalGlobalObject, throwScope, Exception { OperationError, message });
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
        JSValue rawParallelismValue = getMember("parallelism"_s);
        RETURN_IF_EXCEPTION(throwScope, {});
        double rawParallelism = rawParallelismValue.toNumber(&lexicalGlobalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!CryptoAlgorithmArgon2::memoryIsValid(result.memory, rawParallelism)) {
            reject("memory must be at least 8 times the degree of parallelism"_s);
            return {};
        }
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "memory"_s, "Argon2Params"_s, "unsigned long"_s);
        return {};
    }

    JSValue nonceValue = getMember("nonce"_s);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (!nonceValue.isUndefined()) {
        result.nonce = convert<IDLUnion<IDLArrayBufferView, IDLArrayBuffer>>(lexicalGlobalObject, nonceValue);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!CryptoAlgorithmArgon2::nonceIsValid(result.nonce.length())) {
            reject("nonce must be at least 8 bytes"_s);
            return {};
        }
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "nonce"_s, "Argon2Params"_s, "(ArrayBufferView or ArrayBuffer)"_s);
        return {};
    }

    JSValue parallelismValue = getMember("parallelism"_s);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (!parallelismValue.isUndefined()) {
        result.parallelism = convert<IDLEnforceRangeAdaptor<IDLUnsignedLong>>(lexicalGlobalObject, parallelismValue);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!CryptoAlgorithmArgon2::parallelismIsValid(result.parallelism)) {
            reject("parallelism must be > 0 and <= 16777215"_s);
            return {};
        }
    } else {
        throwRequiredMemberTypeError(lexicalGlobalObject, throwScope, "parallelism"_s, "Argon2Params"_s, "unsigned long"_s);
        return {};
    }

    JSValue passesValue = getMember("passes"_s);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (!passesValue.isUndefined()) {
        result.passes = convert<IDLEnforceRangeAdaptor<IDLUnsignedLong>>(lexicalGlobalObject, passesValue);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!CryptoAlgorithmArgon2::passesIsValid(result.passes)) {
            reject("passes must be > 0"_s);
            return {};
        }
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
        if (!CryptoAlgorithmArgon2::versionIsValid(result.version)) {
            propagateException(lexicalGlobalObject, throwScope, Exception { OperationError, makeString(static_cast<unsigned>(result.version), " is not a valid Argon2 version"_s) });
            return {};
        }
    }

    return result;
}

} // namespace WebCore

#endif // ENABLE(WEB_CRYPTO)
