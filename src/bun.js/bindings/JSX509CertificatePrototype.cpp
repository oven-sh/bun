

#include "root.h"

#include "JSDOMExceptionHandling.h"
#include "ZigGlobalObject.h"
#include "ncrypto.h"
#include "JSX509Certificate.h"
#include "JSX509CertificatePrototype.h"
#include "ErrorCode.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "BunString.h"
#include "webcrypto/JSCryptoKey.h"
#include "webcrypto/CryptoKeyEC.h"
#include "webcrypto/CryptoKeyRSA.h"
#include "webcrypto/CryptoKeyOKP.h"
#include "webcrypto/CryptoKeyAES.h"
#include "wtf/DateMath.h"
#include "AsymmetricKeyValue.h"
#include <JavaScriptCore/DateInstance.h>
#include "JSKeyObject.h"

namespace Bun {

using namespace JSC;

static JSC_DECLARE_HOST_FUNCTION(jsX509CertificateProtoFuncCheckEmail);
static JSC_DECLARE_HOST_FUNCTION(jsX509CertificateProtoFuncCheckHost);
static JSC_DECLARE_HOST_FUNCTION(jsX509CertificateProtoFuncCheckIP);
static JSC_DECLARE_HOST_FUNCTION(jsX509CertificateProtoFuncCheckIssued);
static JSC_DECLARE_HOST_FUNCTION(jsX509CertificateProtoFuncCheckPrivateKey);
static JSC_DECLARE_HOST_FUNCTION(jsX509CertificateProtoFuncToJSON);
static JSC_DECLARE_HOST_FUNCTION(jsX509CertificateProtoFuncToLegacyObject);
static JSC_DECLARE_HOST_FUNCTION(jsX509CertificateProtoFuncToString);
static JSC_DECLARE_HOST_FUNCTION(jsX509CertificateProtoFuncVerify);

static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_ca);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_fingerprint);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_fingerprint256);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_fingerprint512);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_subject);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_subjectAltName);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_infoAccess);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_keyUsage);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_issuer);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_issuerCertificate);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_publicKey);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_raw);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_serialNumber);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_validFrom);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_validTo);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_validFromDate);
static JSC_DECLARE_CUSTOM_GETTER(jsX509CertificateGetter_validToDate);

static const HashTableValue JSX509CertificatePrototypeTableValues[] = {
    { "ca"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_ca, 0 } },
    { "checkEmail"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsX509CertificateProtoFuncCheckEmail, 2 } },
    { "checkHost"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsX509CertificateProtoFuncCheckHost, 2 } },
    { "checkIP"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsX509CertificateProtoFuncCheckIP, 1 } },
    { "checkIssued"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsX509CertificateProtoFuncCheckIssued, 1 } },
    { "checkPrivateKey"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsX509CertificateProtoFuncCheckPrivateKey, 1 } },
    { "fingerprint"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_fingerprint, 0 } },
    { "fingerprint256"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_fingerprint256, 0 } },
    { "fingerprint512"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_fingerprint512, 0 } },
    { "infoAccess"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_infoAccess, 0 } },
    { "issuer"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_issuer, 0 } },
    { "issuerCertificate"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_issuerCertificate, 0 } },
    { "keyUsage"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_keyUsage, 0 } },
    { "publicKey"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_publicKey, 0 } },
    { "raw"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_raw, 0 } },
    { "serialNumber"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_serialNumber, 0 } },
    { "subject"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_subject, 0 } },
    { "subjectAltName"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_subjectAltName, 0 } },
    { "toJSON"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsX509CertificateProtoFuncToJSON, 0 } },
    { "toLegacyObject"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsX509CertificateProtoFuncToLegacyObject, 0 } },
    { "toString"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsX509CertificateProtoFuncToString, 0 } },
    { "validFrom"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_validFrom, 0 } },
    { "validFromDate"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessorOrValue), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_validFromDate, 0 } },
    { "validTo"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_validTo, 0 } },
    { "validToDate"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessorOrValue), NoIntrinsic, { HashTableValue::GetterSetterType, jsX509CertificateGetter_validToDate, 0 } },
    { "verify"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsX509CertificateProtoFuncVerify, 1 } },
};

const ClassInfo JSX509CertificatePrototype::s_info = { "X509Certificate"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSX509CertificatePrototype) };

void JSX509CertificatePrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSX509Certificate::info(), JSX509CertificatePrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSC_DEFINE_HOST_FUNCTION(jsX509CertificateProtoFuncToString, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "toString"_s);
        return {};
    }

    // Convert the certificate to PEM format and return it
    String pemString = thisObject->toPEMString();
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsString(vm, pemString));
}

// function getFlags(options = kEmptyObject) {
//   validateObject(options, 'options');
//   const {
//     subject = 'default',  // Can be 'default', 'always', or 'never'
//     wildcards = true,
//     partialWildcards = true,
//     multiLabelWildcards = false,
//     singleLabelSubdomains = false,
//   } = { ...options };
//   let flags = 0;
//   validateString(subject, 'options.subject');
//   validateBoolean(wildcards, 'options.wildcards');
//   validateBoolean(partialWildcards, 'options.partialWildcards');
//   validateBoolean(multiLabelWildcards, 'options.multiLabelWildcards');
//   validateBoolean(singleLabelSubdomains, 'options.singleLabelSubdomains');
//   switch (subject) {
//     case 'default': /* Matches OpenSSL's default, no flags. */ break;
//     case 'always': flags |= X509_CHECK_FLAG_ALWAYS_CHECK_SUBJECT; break;
//     case 'never': flags |= X509_CHECK_FLAG_NEVER_CHECK_SUBJECT; break;
//     default:
//       throw new ERR_INVALID_ARG_VALUE('options.subject', subject);
//   }
//   if (!wildcards) flags |= X509_CHECK_FLAG_NO_WILDCARDS;
//   if (!partialWildcards) flags |= X509_CHECK_FLAG_NO_PARTIAL_WILDCARDS;
//   if (multiLabelWildcards) flags |= X509_CHECK_FLAG_MULTI_LABEL_WILDCARDS;
//   if (singleLabelSubdomains) flags |= X509_CHECK_FLAG_SINGLE_LABEL_SUBDOMAINS;
//   return flags;
// }
static uint32_t getFlags(JSC::VM& vm, JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSValue options)
{
    if (options.isUndefined())
        return 0;

    JSObject* object = options.getObject();
    RETURN_IF_EXCEPTION(scope, {});
    if (!object) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "options must be an object"_s);
        return 0;
    }

    JSValue subject = object->get(globalObject, Identifier::fromString(vm, String("subject"_s)));
    RETURN_IF_EXCEPTION(scope, {});

    JSValue wildcards = object->get(globalObject, Identifier::fromString(vm, String("wildcards"_s)));
    RETURN_IF_EXCEPTION(scope, {});

    JSValue partialWildcards = object->get(globalObject, Identifier::fromString(vm, String("partialWildcards"_s)));
    RETURN_IF_EXCEPTION(scope, {});

    JSValue multiLabelWildcards = object->get(globalObject, Identifier::fromString(vm, String("multiLabelWildcards"_s)));
    RETURN_IF_EXCEPTION(scope, {});

    JSValue singleLabelSubdomains = object->get(globalObject, Identifier::fromString(vm, String("singleLabelSubdomains"_s)));
    RETURN_IF_EXCEPTION(scope, {});

    uint32_t flags = 0;
    bool any = false;

    if (!subject.isUndefined()) {
        any = true;
        if (!subject.isString()) {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "subject must be a string"_s);
            return 0;
        }

        auto subjectString = subject.toString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto view = subjectString->view(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (view == "always"_s) {
            flags |= X509_CHECK_FLAG_ALWAYS_CHECK_SUBJECT;
        } else if (view == "never"_s) {
            flags |= X509_CHECK_FLAG_NEVER_CHECK_SUBJECT;
        } else if (view == "default"_s) {
            // Matches OpenSSL's default, no flags.
        } else {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, "subject must be 'always' or 'never'"_s);
            return 0;
        }
    }

    if (!wildcards.isUndefined()) {
        any = true;
        if (!wildcards.isBoolean()) {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "wildcards must be a boolean"_s);
            return 0;
        }

        if (!wildcards.asBoolean())
            flags |= X509_CHECK_FLAG_NO_WILDCARDS;
    }

    if (!partialWildcards.isUndefined()) {
        any = true;
        if (!partialWildcards.isBoolean()) {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "partialWildcards must be a boolean"_s);
            return 0;
        }

        if (!partialWildcards.asBoolean())
            flags |= X509_CHECK_FLAG_NO_PARTIAL_WILDCARDS;
    }

    if (!multiLabelWildcards.isUndefined()) {
        any = true;
        if (!multiLabelWildcards.isBoolean()) {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "multiLabelWildcards must be a boolean"_s);
            return 0;
        }

        if (multiLabelWildcards.asBoolean())
            flags |= X509_CHECK_FLAG_MULTI_LABEL_WILDCARDS;
    }

    if (!singleLabelSubdomains.isUndefined()) {
        any = true;
        if (!singleLabelSubdomains.isBoolean()) {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "singleLabelSubdomains must be a boolean"_s);
            return 0;
        }
        if (singleLabelSubdomains.asBoolean())
            flags |= X509_CHECK_FLAG_SINGLE_LABEL_SUBDOMAINS;
    }

    if (!any) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "options must have at least one property"_s);
        return 0;
    }

    return flags;
}

JSC_DEFINE_HOST_FUNCTION(jsX509CertificateProtoFuncCheckEmail, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "checkEmail"_s);
        return {};
    }

    JSValue arg0 = callFrame->argument(0);
    if (!arg0.isUndefined()) {
        if (!arg0.isString()) {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "email must be a string"_s);
            return {};
        }
    }

    auto emailString = arg0.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto view = emailString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    uint32_t flags = getFlags(vm, globalObject, scope, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});

    Bun::UTF8View emailView(view);

    auto check = thisObject->checkEmail(globalObject, emailView.span(), flags);
    RETURN_IF_EXCEPTION(scope, {});
    if (!check) return JSValue::encode(jsUndefined());
    return JSValue::encode(emailString);
}

JSC_DEFINE_HOST_FUNCTION(jsX509CertificateProtoFuncCheckHost, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "checkHost"_s);
        return {};
    }

    JSValue arg0 = callFrame->argument(0);
    if (!arg0.isUndefined()) {
        if (!arg0.isString()) {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "host must be a string"_s);
            return {};
        }
    }

    uint32_t flags = getFlags(vm, globalObject, scope, callFrame->argument(1));
    RETURN_IF_EXCEPTION(scope, {});

    auto hostString = arg0.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto view = hostString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    Bun::UTF8View hostView(view);

    auto check = thisObject->checkHost(globalObject, hostView.span(), flags);
    RETURN_IF_EXCEPTION(scope, {});
    if (!check) return JSValue::encode(jsUndefined());
    return JSValue::encode(hostString);
}

JSC_DEFINE_HOST_FUNCTION(jsX509CertificateProtoFuncCheckIP, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "checkIP"_s);
        return {};
    }

    JSValue arg0 = callFrame->argument(0);
    if (!arg0.isUndefined()) {
        if (!arg0.isString()) {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "ip must be a string"_s);
            return {};
        }
    }

    auto ipString = arg0.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto view = ipString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    WTF::CString ip = view->utf8();

    // ignore flags
    // uint32_t flags = getFlags(vm, globalObject, scope, callFrame->argument(1));
    // RETURN_IF_EXCEPTION(scope, {});

    auto check = thisObject->checkIP(globalObject, ip.data());
    RETURN_IF_EXCEPTION(scope, {});
    if (!check) return JSValue::encode(jsUndefined());
    return JSValue::encode(ipString);
}

JSC_DEFINE_HOST_FUNCTION(jsX509CertificateProtoFuncCheckIssued, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]]
        return throwVMError(globalObject, scope, createError(globalObject, ErrorCode::ERR_INVALID_THIS, "checkIssued called on incompatible receiver"_s));

    JSX509Certificate* issuer = jsDynamicCast<JSX509Certificate*>(callFrame->argument(0));
    if (!issuer) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "issuer must be a JSX509Certificate"_s);
        return {};
    }

    auto check = thisObject->checkIssued(globalObject, issuer);
    RETURN_IF_EXCEPTION(scope, {});
    if (!check) return JSValue::encode(jsUndefined());
    return JSValue::encode(issuer);
}

JSC_DEFINE_HOST_FUNCTION(jsX509CertificateProtoFuncCheckPrivateKey, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]]
        return throwVMError(globalObject, scope, createError(globalObject, ErrorCode::ERR_INVALID_THIS, "checkPrivateKey called on incompatible receiver"_s));

    JSValue pkeyValue = callFrame->argument(0);

    JSKeyObject* keyObject = jsDynamicCast<JSKeyObject*>(pkeyValue);
    if (!keyObject) {
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "pkey"_s, "KeyObject"_s, pkeyValue);
    }

    auto& handle = keyObject->handle();
    if (handle.type() != CryptoKeyType::Private) {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "pkey"_s, pkeyValue);
    }

    return JSValue::encode(jsBoolean(thisObject->checkPrivateKey(handle)));
}

JSC_DEFINE_HOST_FUNCTION(jsX509CertificateProtoFuncToJSON, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]]
        return throwVMError(globalObject, scope, createError(globalObject, ErrorCode::ERR_INVALID_THIS, "toJSON called on incompatible receiver"_s));

    // There's no standardized JSON encoding for X509 certs so we
    // fallback to providing the PEM encoding as a string.
    return JSValue::encode(jsString(vm, thisObject->toPEMString()));
}

JSC_DEFINE_HOST_FUNCTION(jsX509CertificateProtoFuncToLegacyObject, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "toLegacyObject"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->toLegacyObject(globalObject)));
}

static JSValue undefinedIfEmpty(JSString* value)
{
    if (!value || value->length() == 0)
        return jsUndefined();
    return value;
}

static JSValue undefinedIfEmpty(JSUint8Array* value)
{
    if (!value || value->length() == 0)
        return jsUndefined();
    return value;
}

JSC_DEFINE_HOST_FUNCTION(jsX509CertificateProtoFuncVerify, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(callFrame->thisValue());
    if (!thisObject) [[unlikely]] {
        throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "verify"_s);
        return {};
    }

    JSValue pkeyValue = callFrame->argument(0);

    JSKeyObject* keyObject = jsDynamicCast<JSKeyObject*>(pkeyValue);
    if (!keyObject) {
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "pkey"_s, "KeyObject"_s, pkeyValue);
    }

    const auto& handle = keyObject->handle();
    if (handle.type() != CryptoKeyType::Public) {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "pkey"_s, pkeyValue);
    }

    return JSValue::encode(jsBoolean(thisObject->verify(handle)));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_ca, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "ca"_s);
        return {};
    }

    return JSValue::encode(jsBoolean(thisObject->view().isCA()));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_fingerprint, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "fingerprint"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->fingerprint()));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_fingerprint256, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "fingerprint256"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->fingerprint256()));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_fingerprint512, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "fingerprint512"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->fingerprint512()));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_subject, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "subject"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(undefinedIfEmpty(thisObject->subject())));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_subjectAltName, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "subjectAltName"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(undefinedIfEmpty(thisObject->subjectAltName())));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_infoAccess, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "infoAccess"_s);
        return {};
    }

    auto bio = thisObject->view().getInfoAccess();
    if (!bio)
        return JSValue::encode(jsUndefined());

    BUF_MEM* bptr = bio;
    return JSValue::encode(undefinedIfEmpty(jsString(vm, String::fromUTF8(std::span(bptr->data, bptr->length)))));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_keyUsage, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "keyUsage"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->getKeyUsage(globalObject)));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_issuer, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "issuer"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(undefinedIfEmpty(thisObject->issuer())));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_issuerCertificate, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "issuerCertificate"_s);
        return {};
    }

    auto issuerCert = thisObject->view().getIssuer();
    if (!issuerCert)
        return JSValue::encode(jsUndefined());

    auto bio = issuerCert.get();

    BUF_MEM* bptr = nullptr;
    BIO_get_mem_ptr(bio, &bptr);
    std::span<const uint8_t> span(reinterpret_cast<const uint8_t*>(bptr->data), bptr->length);
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    auto* structure = zigGlobalObject->m_JSX509CertificateClassStructure.get(zigGlobalObject);
    auto jsIssuerCert = JSX509Certificate::create(vm, structure, globalObject, span);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsIssuerCert);
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_publicKey, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "publicKey"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(thisObject->publicKey()));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_raw, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "raw"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(undefinedIfEmpty(thisObject->raw())));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_serialNumber, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "serialNumber"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(undefinedIfEmpty(thisObject->serialNumber())));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_validFrom, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "validFrom"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(undefinedIfEmpty(thisObject->validFrom())));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_validTo, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "validTo"_s);
        return {};
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(undefinedIfEmpty(thisObject->validTo())));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_validToDate, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "validToDate"_s);
        return {};
    }

    auto* validToDate = thisObject->validTo();
    RETURN_IF_EXCEPTION(scope, {});
    auto view = validToDate->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    Bun::UTF8View validToDateView = Bun::UTF8View(view);
    if (view->isEmpty())
        return JSValue::encode(jsUndefined());
    std::span<const Latin1Character> span = { reinterpret_cast<const Latin1Character*>(validToDateView.span().data()), validToDateView.span().size() };
    double date = WTF::parseDate(span);
    return JSValue::encode(JSC::DateInstance::create(vm, globalObject->dateStructure(), date));
}

JSC_DEFINE_CUSTOM_GETTER(jsX509CertificateGetter_validFromDate, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSX509Certificate* thisObject = jsDynamicCast<JSX509Certificate*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        Bun::throwThisTypeError(*globalObject, scope, "X509Certificate"_s, "validFromDate"_s);
        return {};
    }

    auto* validFromDate = thisObject->validFrom();
    RETURN_IF_EXCEPTION(scope, {});
    auto view = validFromDate->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    Bun::UTF8View validFromDateView = Bun::UTF8View(view);
    if (view->isEmpty())
        return JSValue::encode(jsUndefined());
    std::span<const Latin1Character> span = { reinterpret_cast<const Latin1Character*>(validFromDateView.span().data()), validFromDateView.span().size() };
    double date = WTF::parseDate(span);
    return JSValue::encode(JSC::DateInstance::create(vm, globalObject->dateStructure(), date));
}
} // namespace Bun
