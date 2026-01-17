#include "root.h"

#include "JavaScriptCore/ArrayAllocationProfile.h"
#include "JavaScriptCore/JSArray.h"

#include "ncrypto.h"
#include "openssl/x509.h"
#include "JavaScriptCore/InternalFunction.h"
#include "ErrorCode.h"
#include "JSX509Certificate.h"
#include "JSX509CertificatePrototype.h"
#include "ZigGlobalObject.h"
#include "wtf/Assertions.h"
#include "wtf/SharedTask.h"
#include "wtf/text/ASCIILiteral.h"

#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ObjectConstructor.h>

#include <JavaScriptCore/LazyPropertyInlines.h>
#include "openssl/evp.h"
#include "JavaScriptCore/ObjectPrototype.h"
#include "BunString.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include "JSBuffer.h"
#include "wtf/text/ExternalStringImpl.h"
#include <wtf/SIMDUTF.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include "CryptoUtil.h"
#include "JSPublicKeyObject.h"

namespace Bun {

using namespace JSC;

Ref<WTF::ExternalStringImpl> toExternalStringImpl(ncrypto::BIOPointer& bio, std::span<const char> span)
{
    return WTF::ExternalStringImpl::create({ reinterpret_cast<const Latin1Character*>(span.data()), span.size() }, bio.release(), [](void* context, void* ptr, unsigned len) {
        ncrypto::BIOPointer deleter = ncrypto::BIOPointer(static_cast<BIO*>(context));
    });
}

WTF::String toWTFString(ncrypto::BIOPointer& bio)
{
    BUF_MEM* bptr;
    BIO_get_mem_ptr(bio.get(), &bptr);
    std::span<const char> span(bptr->data, bptr->length);
    if (simdutf::validate_ascii(span.data(), span.size())) {
        return toExternalStringImpl(bio, span);
    }
    return WTF::String::fromUTF8({ reinterpret_cast<const Latin1Character*>(bptr->data), bptr->length });
}

static JSC_DECLARE_HOST_FUNCTION(x509CertificateConstructorCall);
static JSC_DECLARE_HOST_FUNCTION(x509CertificateConstructorConstruct);

class JSX509CertificateConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSX509CertificateConstructor* create(JSC::VM&, JSC::JSGlobalObject*, JSC::Structure*, JSC::JSObject* prototype);

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return &vm.internalFunctionSpace();
    }

    DECLARE_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

private:
    JSX509CertificateConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, x509CertificateConstructorCall, x509CertificateConstructorConstruct)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* prototype);
};

const ClassInfo JSX509CertificateConstructor::s_info = { "X509Certificate"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSX509CertificateConstructor) };

JSX509CertificateConstructor* JSX509CertificateConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
{
    JSX509CertificateConstructor* constructor = new (NotNull, allocateCell<JSX509CertificateConstructor>(vm)) JSX509CertificateConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

void JSX509CertificateConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSObject* prototype)
{
    Base::finishCreation(vm, 1, "X509Certificate"_s, PropertyAdditionMode::WithStructureTransition);
}
static JSValue createX509Certificate(JSC::VM& vm, JSGlobalObject* globalObject, Structure* structure, JSValue arg)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    Bun::UTF8View view;
    std::span<const uint8_t> data;

    if (arg.isString()) {
        view = arg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        data = std::span(reinterpret_cast<const uint8_t*>(view.span().data()), view.span().size());
    } else if (auto* typedArray = jsDynamicCast<JSArrayBufferView*>(arg)) {
        if (typedArray->isDetached()) [[unlikely]] {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "TypedArray is detached"_s);
            return {};
        }
        data = typedArray->span();
    } else if (auto* buffer = jsDynamicCast<JSArrayBuffer*>(arg)) {
        auto* impl = buffer->impl();
        if (!impl) [[unlikely]] {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "Buffer is detached"_s);
            return {};
        }
        data = impl->span();
    } else {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "X509Certificate constructor argument must be a Buffer, TypedArray, or string"_s);
        return {};
    }

    JSX509Certificate* certificate = JSX509Certificate::create(vm, structure, globalObject, data);
    RETURN_IF_EXCEPTION(scope, {});
    return certificate;
}

JSC_DEFINE_HOST_FUNCTION(x509CertificateConstructorCall, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Bun::throwError(globalObject, scope, ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "X509Certificate constructor cannot be invoked without 'new'"_s);
    return {};
}

JSC_DEFINE_HOST_FUNCTION(x509CertificateConstructorConstruct, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!callFrame->argumentCount()) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_MISSING_ARGS, "X509Certificate constructor requires at least one argument"_s);
        return {};
    }

    JSValue arg = callFrame->uncheckedArgument(0);
    if (!arg.isCell()) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "X509Certificate constructor argument must be a Buffer, TypedArray, or string"_s);
        return {};
    }

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    Structure* structure = zigGlobalObject->m_JSX509CertificateClassStructure.get(zigGlobalObject);
    JSValue newTarget = callFrame->newTarget();
    if (zigGlobalObject->m_JSX509CertificateClassStructure.constructor(zigGlobalObject) != newTarget) [[unlikely]] {
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor Script cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(globalObject, newTarget.getObject(), functionGlobalObject->NodeVMScriptStructure());
        RETURN_IF_EXCEPTION(scope, {});
    }

    RELEASE_AND_RETURN(scope, JSValue::encode(createX509Certificate(vm, globalObject, structure, arg)));
}

const ClassInfo JSX509Certificate::s_info = { "X509Certificate"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSX509Certificate) };

void JSX509Certificate::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    m_fingerprint.initLater([](const JSC::LazyProperty<JSX509Certificate, JSString>::Initializer& init) {
        init.set(init.owner->computeFingerprint(init.owner->view(), init.owner->globalObject()));
    });
    m_subject.initLater([](const JSC::LazyProperty<JSX509Certificate, JSString>::Initializer& init) {
        auto scope = DECLARE_THROW_SCOPE(init.vm);
        auto value = init.owner->computeSubject(init.owner->view(), init.owner->globalObject(), false);
        if (scope.exception()) [[unlikely]] {
            (void)scope.tryClearException();
            return init.set(jsEmptyString(init.vm));
        }
        if (!value.isString()) {
            init.set(jsEmptyString(init.owner->vm()));
            return;
        }

        init.set(value.toString(init.owner->globalObject()));
    });
    m_issuer.initLater([](const JSC::LazyProperty<JSX509Certificate, JSString>::Initializer& init) {
        auto scope = DECLARE_THROW_SCOPE(init.vm);
        JSValue value = init.owner->computeIssuer(init.owner->view(), init.owner->globalObject(), false);
        if (scope.exception()) [[unlikely]] {
            (void)scope.tryClearException();
            return init.set(jsEmptyString(init.vm));
        }
        if (value.isString()) {
            init.set(value.toString(init.owner->globalObject()));
        } else {
            init.property.setMayBeNull(init.owner->vm(), init.owner, nullptr);
        }
    });
    m_validFrom.initLater([](const JSC::LazyProperty<JSX509Certificate, JSString>::Initializer& init) {
        init.set(init.owner->computeValidFrom(init.owner->view(), init.owner->globalObject()));
    });
    m_validTo.initLater([](const JSC::LazyProperty<JSX509Certificate, JSString>::Initializer& init) {
        init.set(init.owner->computeValidTo(init.owner->view(), init.owner->globalObject()));
    });
    m_serialNumber.initLater([](const JSC::LazyProperty<JSX509Certificate, JSString>::Initializer& init) {
        init.set(init.owner->computeSerialNumber(init.owner->view(), init.owner->globalObject()));
    });
    m_fingerprint256.initLater([](const JSC::LazyProperty<JSX509Certificate, JSString>::Initializer& init) {
        init.set(init.owner->computeFingerprint256(init.owner->view(), init.owner->globalObject()));
    });
    m_fingerprint512.initLater([](const JSC::LazyProperty<JSX509Certificate, JSString>::Initializer& init) {
        init.set(init.owner->computeFingerprint512(init.owner->view(), init.owner->globalObject()));
    });
    m_raw.initLater([](const JSC::LazyProperty<JSX509Certificate, JSUint8Array>::Initializer& init) {
        init.property.setMayBeNull(init.owner->vm(), init.owner, init.owner->computeRaw(init.owner->view(), init.owner->globalObject()));
    });

    m_infoAccess.initLater([](const JSC::LazyProperty<JSX509Certificate, JSString>::Initializer& init) {
        JSValue value = init.owner->computeInfoAccess(init.owner->view(), init.owner->globalObject(), false);
        if (value.isString()) {
            init.set(value.toString(init.owner->globalObject()));
        } else {
            init.property.setMayBeNull(init.owner->vm(), init.owner, nullptr);
        }
    });
    m_subjectAltName.initLater([](const JSC::LazyProperty<JSX509Certificate, JSString>::Initializer& init) {
        init.property.setMayBeNull(init.owner->vm(), init.owner, init.owner->computeSubjectAltName(init.owner->view(), init.owner->globalObject()));
    });

    m_publicKey.initLater([](const JSC::LazyProperty<JSX509Certificate, JSCell>::Initializer& init) {
        JSValue value = init.owner->computePublicKey(init.owner->view(), init.owner->globalObject());
        init.property.setMayBeNull(init.owner->vm(), init.owner, !value.isEmpty() && value.isCell() ? value.asCell() : nullptr);
    });
}

JSX509Certificate* JSX509Certificate::create(VM& vm, Structure* structure)
{
    JSX509Certificate* ptr = new (NotNull, allocateCell<JSX509Certificate>(vm)) JSX509Certificate(vm, structure);
    ptr->finishCreation(vm);
    return ptr;
}

JSX509Certificate* JSX509Certificate::create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject, std::span<const uint8_t> der)
{
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Initialize the X509 certificate from the provided data
    auto result = ncrypto::X509Pointer::Parse(ncrypto::Buffer<const unsigned char> { reinterpret_cast<const unsigned char*>(der.data()), der.size() });
    if (!result) {
        Bun::throwBoringSSLError(globalObject, scope, result.error.value_or(0));
        return nullptr;
    }

    return create(vm, structure, globalObject, WTF::move(result.value));
}

JSX509Certificate* JSX509Certificate::create(JSC::VM& vm, JSC::Structure* structure, JSC::JSGlobalObject* globalObject, ncrypto::X509Pointer&& cert)
{
    auto* certificate = create(vm, structure);
    certificate->m_x509 = WTF::move(cert);
    size_t size = i2d_X509(certificate->m_x509.get(), nullptr);
    certificate->m_extraMemorySizeForGC = size;
    vm.heap.reportExtraMemoryAllocated(certificate, size);
    return certificate;
}

String JSX509Certificate::toPEMString() const
{
    auto bio = view().toPEM();
    if (!bio) {
        return String();
    }

    return toWTFString(bio);
}

void JSX509Certificate::destroy(JSCell* cell)
{
    static_cast<JSX509Certificate*>(cell)->~JSX509Certificate();
}

JSX509Certificate::~JSX509Certificate()
{
}

template<typename Visitor>
void JSX509Certificate::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSX509Certificate* thisObject = jsCast<JSX509Certificate*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    thisObject->m_subject.visit(visitor);
    thisObject->m_issuer.visit(visitor);
    thisObject->m_validFrom.visit(visitor);
    thisObject->m_validTo.visit(visitor);
    thisObject->m_serialNumber.visit(visitor);
    thisObject->m_fingerprint.visit(visitor);
    thisObject->m_fingerprint256.visit(visitor);
    thisObject->m_fingerprint512.visit(visitor);
    thisObject->m_raw.visit(visitor);
    thisObject->m_infoAccess.visit(visitor);
    thisObject->m_subjectAltName.visit(visitor);
    thisObject->m_publicKey.visit(visitor);
    visitor.reportExtraMemoryVisited(thisObject->m_extraMemorySizeForGC);
}

DEFINE_VISIT_CHILDREN(JSX509Certificate);

size_t JSX509Certificate::estimatedSize(JSCell* cell, VM& vm)
{
    JSX509Certificate* thisObject = jsCast<JSX509Certificate*>(cell);
    size_t size = i2d_X509(thisObject->m_x509.get(), nullptr);
    return Base::estimatedSize(cell, vm) + size;
}

void JSX509Certificate::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    Base::analyzeHeap(cell, analyzer);
}

JSC::Structure* JSX509Certificate::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
}

// Convert an X509_NAME* into a JavaScript object.
// Each entry of the name is converted into a property of the object.
// The property value may be a single string or an array of strings.
template<X509_NAME* get_name(const X509*)>
static JSObject* GetX509NameObject(JSGlobalObject* globalObject, const X509* cert)
{
    X509_NAME* name = get_name(cert);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!name)
        return nullptr;

    int cnt = X509_NAME_entry_count(name);
    if (cnt < 0)
        return nullptr;

    // Create object with null prototype to match Node.js behavior
    JSObject* result = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    RETURN_IF_EXCEPTION(scope, nullptr);

    for (int i = 0; i < cnt; i++) {
        X509_NAME_ENTRY* entry = X509_NAME_get_entry(name, i);
        if (!entry)
            continue;

        ASN1_OBJECT* obj = X509_NAME_ENTRY_get_object(entry);
        ASN1_STRING* str = X509_NAME_ENTRY_get_data(entry);
        if (!obj || !str)
            continue;

        // Convert the ASN1_OBJECT to a string key
        String key;
        int nid = OBJ_obj2nid(obj);
        if (nid != NID_undef) {
            const char* sn = OBJ_nid2sn(nid);
            if (sn)
                key = String::fromUTF8(sn);
        }
        if (key.isEmpty()) {
            char buf[80];
            if (OBJ_obj2txt(buf, sizeof(buf), obj, 1) >= 0)
                key = String::fromUTF8(buf);
        }
        if (key.isEmpty())
            continue;

        // Convert the ASN1_STRING to a string value
        unsigned char* value_str = nullptr;
        int value_str_size = ASN1_STRING_to_UTF8(&value_str, str);
        if (value_str_size < 0)
            continue;

        ncrypto::DataPointer free_value_str(value_str, value_str_size);
        JSValue jsvalue = jsString(vm, String::fromUTF8(std::span(reinterpret_cast<const char*>(value_str), value_str_size)));
        RETURN_IF_EXCEPTION(scope, nullptr);

        // Check if this key already exists
        JSValue existing = result->getIfPropertyExists(globalObject, Identifier::fromString(vm, key));
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (existing) {
            JSArray* array = jsDynamicCast<JSArray*>(existing);
            if (!array) {
                array = JSArray::tryCreate(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), 2);
                if (!array) {
                    throwOutOfMemoryError(globalObject, scope);
                    return nullptr;
                }
                array->putDirectIndex(globalObject, 0, existing);
                array->putDirectIndex(globalObject, 1, jsvalue);
                result->putDirect(vm, Identifier::fromString(vm, key), array, 0);
            } else {
                array->putDirectIndex(globalObject, array->length(), jsvalue);
            }
        } else {
            // First occurrence of this key
            result->putDirect(vm, Identifier::fromString(vm, key), jsvalue);
        }
        RETURN_IF_EXCEPTION(scope, nullptr);
    }

    return result;
}

JSValue JSX509Certificate::computeSubject(ncrypto::X509View view, JSGlobalObject* globalObject, bool legacy)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* cert = view.get();
    if (!cert)
        return jsUndefined();

    if (!legacy) {
        auto bio = view.getSubject();
        if (!bio) {
            throwCryptoOperationFailed(globalObject, scope);
            return {};
        }
        return jsString(vm, toWTFString(bio));
    }

    // For legacy mode, convert to object format
    X509_NAME* name = X509_get_subject_name(cert);
    if (!name)
        return jsUndefined();

    JSObject* obj = GetX509NameObject<X509_get_subject_name>(globalObject, cert);
    RETURN_IF_EXCEPTION(scope, {});
    if (!obj)
        return jsUndefined();

    return obj;
}

JSValue JSX509Certificate::computeIssuer(ncrypto::X509View view, JSGlobalObject* globalObject, bool legacy)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto bio = view.getIssuer();
    if (!bio) {
        throwCryptoOperationFailed(globalObject, scope);
        return {};
    }

    if (!legacy) {
        return jsString(vm, toWTFString(bio));
    }

    RELEASE_AND_RETURN(scope, GetX509NameObject<X509_get_issuer_name>(globalObject, view.get()));
}

JSString* JSX509Certificate::computeValidFrom(ncrypto::X509View view, JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto bio = view.getValidFrom();
    if (!bio) {
        throwCryptoOperationFailed(globalObject, scope);
        return jsEmptyString(vm);
    }

    return jsString(vm, toWTFString(bio));
}

JSString* JSX509Certificate::computeValidTo(ncrypto::X509View view, JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto bio = view.getValidTo();
    if (!bio) {
        throwCryptoOperationFailed(globalObject, scope);
        return jsEmptyString(vm);
    }

    return jsString(vm, toWTFString(bio));
}

JSString* JSX509Certificate::computeSerialNumber(ncrypto::X509View view, JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto serial = view.getSerialNumber();
    if (!serial) {
        throwCryptoOperationFailed(globalObject, scope);
        return jsEmptyString(vm);
    }

    return jsString(vm, String::fromUTF8(std::span(static_cast<const char*>(serial.get()), serial.size())));
}

JSString* JSX509Certificate::computeFingerprint(ncrypto::X509View view, JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto fingerprint = view.getFingerprint(EVP_sha1());
    if (!fingerprint) {
        throwCryptoOperationFailed(globalObject, scope);
        return jsEmptyString(vm);
    }

    return jsString(vm, fingerprint.value());
}

JSString* JSX509Certificate::computeFingerprint256(ncrypto::X509View view, JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto fingerprint = view.getFingerprint(EVP_sha256());
    if (!fingerprint) {
        throwCryptoOperationFailed(globalObject, scope);
        return jsEmptyString(vm);
    }

    return jsString(vm, fingerprint.value());
}

JSString* JSX509Certificate::computeFingerprint512(ncrypto::X509View view, JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto fingerprint = view.getFingerprint(EVP_sha512());
    if (!fingerprint) {
        throwCryptoOperationFailed(globalObject, scope);
        return jsEmptyString(vm);
    }

    return jsString(vm, fingerprint.value());
}

JSUint8Array* JSX509Certificate::computeRaw(ncrypto::X509View view, JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto bio = view.toDER();
    if (!bio) {
        throwCryptoOperationFailed(globalObject, scope);
        return nullptr;
    }

    auto bio_ptr = bio.release();
    BUF_MEM* bptr = nullptr;
    BIO_get_mem_ptr(bio_ptr, &bptr);

    Ref<JSC::ArrayBuffer> buffer = JSC::ArrayBuffer::createFromBytes(std::span(reinterpret_cast<uint8_t*>(bptr->data), bptr->length), createSharedTask<void(void*)>([](void* data) {
        ncrypto::BIOPointer free_me(static_cast<BIO*>(data));
    }));
    RELEASE_AND_RETURN(scope, Bun::createBuffer(globalObject, WTF::move(buffer)));
}

bool JSX509Certificate::computeIsCA(ncrypto::X509View view, JSGlobalObject* globalObject)
{
    return view.isCA();
}

static bool handleMatchResult(JSGlobalObject* globalObject, ASCIILiteral errorMessage, JSC::ThrowScope& scope, ncrypto::X509View::CheckMatch result)
{
    switch (result) {
    case ncrypto::X509View::CheckMatch::INVALID_NAME:
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_VALUE, errorMessage);
        return false;
    case ncrypto::X509View::CheckMatch::NO_MATCH:
        return false;
    case ncrypto::X509View::CheckMatch::MATCH:
        return true;
    default: {
        throwCryptoOperationFailed(globalObject, scope);
        return false;
    }
    }
}

bool JSX509Certificate::checkHost(JSGlobalObject* globalObject, std::span<const char> name, uint32_t flags)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto result = view().checkHost(name, flags);
    return handleMatchResult(globalObject, "Invalid name"_s, scope, result);
}

bool JSX509Certificate::checkEmail(JSGlobalObject* globalObject, std::span<const char> email, uint32_t flags)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto result = view().checkEmail(email, flags);
    return handleMatchResult(globalObject, "Invalid email"_s, scope, result);
}

bool JSX509Certificate::checkIP(JSGlobalObject* globalObject, const char* ip)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto result = view().checkIp(ip, 0);
    return handleMatchResult(globalObject, "Invalid IP address"_s, scope, result);
}

bool JSX509Certificate::checkIssued(JSGlobalObject* globalObject, JSX509Certificate* issuer)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!issuer)
        return false;

    return view().isIssuedBy(issuer->view());
}

JSString* JSX509Certificate::subject()
{
    return m_subject.get(this);
}
JSString* JSX509Certificate::issuer()
{
    return m_issuer.get(this);
}
JSString* JSX509Certificate::validFrom()
{
    return m_validFrom.get(this);
}
JSString* JSX509Certificate::validTo()
{
    return m_validTo.get(this);
}
JSString* JSX509Certificate::serialNumber()
{
    return m_serialNumber.get(this);
}
JSString* JSX509Certificate::fingerprint()
{
    return m_fingerprint.get(this);
}
JSString* JSX509Certificate::fingerprint256()
{
    return m_fingerprint256.get(this);
}
JSString* JSX509Certificate::fingerprint512()
{
    return m_fingerprint512.get(this);
}
JSUint8Array* JSX509Certificate::raw()
{
    return m_raw.get(this);
}
JSString* JSX509Certificate::infoAccess()
{
    return m_infoAccess.get(this);
}
JSString* JSX509Certificate::subjectAltName()
{
    return m_subjectAltName.get(this);
}

JSValue JSX509Certificate::publicKey()
{
    return m_publicKey.get(this);
}

bool JSX509Certificate::checkPrivateKey(const KeyObject& keyObject)
{
    const auto& key = keyObject.asymmetricKey();
    return view().checkPrivateKey(key);
}

bool JSX509Certificate::verify(const KeyObject& keyObject)
{
    const auto& key = keyObject.asymmetricKey();
    return view().checkPublicKey(key);
}

// This one doesn't depend on a JSX509Certificate object
JSC::JSObject* JSX509Certificate::toLegacyObject(ncrypto::X509View view, JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* cert = view.get();

    if (!cert)
        return nullptr;

    JSC::JSObject* object = constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Helper function to convert JSValue to undefined if empty/null
    auto valueOrUndefined = [&](JSValue value) -> JSValue {
        if (value.isEmpty() || value.isNull() || (value.isString() && value.toString(globalObject)->length() == 0))
            return jsUndefined();
        return value;
    };

    // Set subject
    object->putDirect(vm, Identifier::fromString(vm, "subject"_s), valueOrUndefined(computeSubject(view, globalObject, true)));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set issuer
    object->putDirect(vm, Identifier::fromString(vm, "issuer"_s), valueOrUndefined(computeIssuer(view, globalObject, true)));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set subjectaltname
    object->putDirect(vm, Identifier::fromString(vm, "subjectaltname"_s), valueOrUndefined(computeSubjectAltName(view, globalObject)));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set infoAccess
    object->putDirect(vm, Identifier::fromString(vm, "infoAccess"_s), valueOrUndefined(computeInfoAccess(view, globalObject, true)));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set modulus and exponent for RSA keys
    EVP_PKEY* pkey = X509_get0_pubkey(cert);
    if (pkey) {
        switch (EVP_PKEY_base_id(pkey)) {
        case EVP_PKEY_RSA: {
            const RSA* rsa = EVP_PKEY_get0_RSA(pkey);
            if (rsa) {
                const BIGNUM* n;
                const BIGNUM* e;
                RSA_get0_key(rsa, &n, &e, nullptr);

                // Convert modulus to string
                auto bio = ncrypto::BIOPointer::New(n);
                if (bio) {
                    object->putDirect(vm, Identifier::fromString(vm, "modulus"_s), jsString(vm, toWTFString(bio)));
                    RETURN_IF_EXCEPTION(scope, nullptr);
                }

                // Convert exponent to string
                uint64_t exponent_word = static_cast<uint64_t>(ncrypto::BignumPointer::GetWord(e));
                auto bio_e = ncrypto::BIOPointer::NewMem();
                if (bio_e) {
                    BIO_printf(bio_e.get(), "0x%" PRIx64, exponent_word);
                    object->putDirect(vm, Identifier::fromString(vm, "exponent"_s), jsString(vm, toWTFString(bio_e)));
                    RETURN_IF_EXCEPTION(scope, nullptr);
                }

                // Set bits
                object->putDirect(vm, Identifier::fromString(vm, "bits"_s), jsNumber(ncrypto::BignumPointer::GetBitCount(n)));
                RETURN_IF_EXCEPTION(scope, nullptr);

                // Set pubkey
                int size = i2d_RSA_PUBKEY(rsa, nullptr);
                if (size > 0) {
                    auto* buffer = Bun::createUninitializedBuffer(globalObject, static_cast<size_t>(size));
                    RETURN_IF_EXCEPTION(scope, nullptr);
                    uint8_t* data = buffer->typedVector();
                    i2d_RSA_PUBKEY(rsa, &data);
                    object->putDirect(vm, Identifier::fromString(vm, "pubkey"_s), buffer);
                }
            }
            break;
        }
        case EVP_PKEY_EC: {
            const EC_KEY* ec = EVP_PKEY_get0_EC_KEY(pkey);
            if (ec) {
                const EC_GROUP* group = EC_KEY_get0_group(ec);
                if (group) {
                    // Set bits
                    int bits = EC_GROUP_order_bits(group);
                    if (bits > 0) {
                        object->putDirect(vm, Identifier::fromString(vm, "bits"_s), jsNumber(bits));
                        RETURN_IF_EXCEPTION(scope, nullptr);
                    }

                    // Add pubkey field for EC keys
                    const EC_POINT* point = EC_KEY_get0_public_key(ec);
                    if (point) {
                        point_conversion_form_t form = EC_KEY_get_conv_form(ec);
                        size_t size = EC_POINT_point2oct(group, point, form, nullptr, 0, nullptr);
                        if (size > 0) {
                            auto* buffer = Bun::createUninitializedBuffer(globalObject, size);
                            RETURN_IF_EXCEPTION(scope, nullptr);
                            uint8_t* data = buffer->typedVector();
                            size_t result_size = EC_POINT_point2oct(group, point, form, data, size, nullptr);
                            if (result_size == size) {
                                object->putDirect(vm, Identifier::fromString(vm, "pubkey"_s), buffer);
                            }
                        }
                    }

                    // Set curve info
                    int nid = EC_GROUP_get_curve_name(group);
                    if (nid != 0) {
                        const char* sn = OBJ_nid2sn(nid);
                        if (sn) {
                            object->putDirect(vm, Identifier::fromString(vm, "asn1Curve"_s), jsString(vm, String::fromUTF8(sn)));
                            RETURN_IF_EXCEPTION(scope, nullptr);
                        }

                        const char* nist = EC_curve_nid2nist(nid);
                        if (nist) {
                            object->putDirect(vm, Identifier::fromString(vm, "nistCurve"_s), jsString(vm, String::fromUTF8(nist)));
                            RETURN_IF_EXCEPTION(scope, nullptr);
                        }
                    }
                }
            }
            break;
        }
        }
    }

    // Set validFrom
    object->putDirect(vm, Identifier::fromString(vm, "valid_from"_s), valueOrUndefined(computeValidFrom(view, globalObject)));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set validTo
    object->putDirect(vm, Identifier::fromString(vm, "valid_to"_s), valueOrUndefined(computeValidTo(view, globalObject)));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set fingerprints
    object->putDirect(vm, Identifier::fromString(vm, "fingerprint"_s), valueOrUndefined(computeFingerprint(view, globalObject)));
    RETURN_IF_EXCEPTION(scope, nullptr);

    object->putDirect(vm, Identifier::fromString(vm, "fingerprint256"_s), valueOrUndefined(computeFingerprint256(view, globalObject)));
    RETURN_IF_EXCEPTION(scope, nullptr);

    object->putDirect(vm, Identifier::fromString(vm, "fingerprint512"_s), valueOrUndefined(computeFingerprint512(view, globalObject)));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set keyUsage
    object->putDirect(vm, Identifier::fromString(vm, "ext_key_usage"_s), getKeyUsage(view, globalObject));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set serialNumber
    object->putDirect(vm, Identifier::fromString(vm, "serialNumber"_s), valueOrUndefined(computeSerialNumber(view, globalObject)));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set raw
    object->putDirect(vm, Identifier::fromString(vm, "raw"_s), computeRaw(view, globalObject));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set CA flag
    object->putDirect(vm, Identifier::fromString(vm, "ca"_s), jsBoolean(computeIsCA(view, globalObject)));
    RETURN_IF_EXCEPTION(scope, nullptr);

    return object;
}

// This one DOES depend on a JSX509Certificate object
// This implementation re-uses the cached values from the JSX509Certificate object getters
// saving memory.
JSC::JSObject* JSX509Certificate::toLegacyObject(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* cert = view().get();

    if (!cert)
        return nullptr;

    JSC::JSObject* object = constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Helper function to convert JSValue to undefined if empty/null
    auto valueOrUndefined = [&](JSValue value) -> JSValue {
        if (value.isEmpty() || value.isNull() || (value.isString() && value.toString(globalObject)->length() == 0))
            return jsUndefined();
        return value;
    };

    // Set subject
    object->putDirect(vm, Identifier::fromString(vm, "subject"_s), valueOrUndefined(computeSubject(view(), globalObject, true)));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set issuer
    object->putDirect(vm, Identifier::fromString(vm, "issuer"_s), valueOrUndefined(computeIssuer(view(), globalObject, true)));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set subjectaltname
    object->putDirect(vm, Identifier::fromString(vm, "subjectaltname"_s), valueOrUndefined(subjectAltName()));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set infoAccess
    object->putDirect(vm, Identifier::fromString(vm, "infoAccess"_s), valueOrUndefined(computeInfoAccess(view(), globalObject, true)));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set modulus and exponent for RSA keys
    EVP_PKEY* pkey = X509_get0_pubkey(cert);
    if (pkey) {
        switch (EVP_PKEY_base_id(pkey)) {
        case EVP_PKEY_RSA: {
            const RSA* rsa = EVP_PKEY_get0_RSA(pkey);
            if (rsa) {
                const BIGNUM* n;
                const BIGNUM* e;
                RSA_get0_key(rsa, &n, &e, nullptr);

                // Convert modulus to string
                auto bio = ncrypto::BIOPointer::New(n);
                if (bio) {
                    object->putDirect(vm, Identifier::fromString(vm, "modulus"_s), jsString(vm, toWTFString(bio)));
                    RETURN_IF_EXCEPTION(scope, nullptr);
                }

                // Convert exponent to string
                uint64_t exponent_word = static_cast<uint64_t>(ncrypto::BignumPointer::GetWord(e));
                auto bio_e = ncrypto::BIOPointer::NewMem();
                if (bio_e) {
                    BIO_printf(bio_e.get(), "0x%" PRIx64, exponent_word);
                    object->putDirect(vm, Identifier::fromString(vm, "exponent"_s), jsString(vm, toWTFString(bio_e)));
                    RETURN_IF_EXCEPTION(scope, nullptr);
                }

                // Set bits
                object->putDirect(vm, Identifier::fromString(vm, "bits"_s), jsNumber(ncrypto::BignumPointer::GetBitCount(n)));
                RETURN_IF_EXCEPTION(scope, nullptr);

                // Set pubkey
                int size = i2d_RSA_PUBKEY(rsa, nullptr);
                if (size > 0) {
                    auto* buffer = Bun::createUninitializedBuffer(globalObject, static_cast<size_t>(size));
                    RETURN_IF_EXCEPTION(scope, nullptr);
                    uint8_t* data = buffer->typedVector();
                    i2d_RSA_PUBKEY(rsa, &data);
                    object->putDirect(vm, Identifier::fromString(vm, "pubkey"_s), buffer);
                }
            }
            break;
        }
        case EVP_PKEY_EC: {
            const EC_KEY* ec = EVP_PKEY_get0_EC_KEY(pkey);
            if (ec) {
                const EC_GROUP* group = EC_KEY_get0_group(ec);
                if (group) {
                    // Set bits
                    int bits = EC_GROUP_order_bits(group);
                    if (bits > 0) {
                        object->putDirect(vm, Identifier::fromString(vm, "bits"_s), jsNumber(bits));
                        RETURN_IF_EXCEPTION(scope, nullptr);
                    }

                    // Add pubkey field for EC keys
                    const EC_POINT* point = EC_KEY_get0_public_key(ec);
                    if (point) {
                        point_conversion_form_t form = EC_KEY_get_conv_form(ec);
                        size_t size = EC_POINT_point2oct(group, point, form, nullptr, 0, nullptr);
                        if (size > 0) {
                            auto* buffer = Bun::createUninitializedBuffer(globalObject, size);
                            RETURN_IF_EXCEPTION(scope, nullptr);
                            uint8_t* data = buffer->typedVector();
                            size_t result_size = EC_POINT_point2oct(group, point, form, data, size, nullptr);
                            if (result_size == size) {
                                object->putDirect(vm, Identifier::fromString(vm, "pubkey"_s), buffer);
                            }
                        }
                    }

                    // Set curve info
                    int nid = EC_GROUP_get_curve_name(group);
                    if (nid != 0) {
                        const char* sn = OBJ_nid2sn(nid);
                        if (sn) {
                            object->putDirect(vm, Identifier::fromString(vm, "asn1Curve"_s), jsString(vm, String::fromUTF8(sn)));
                            RETURN_IF_EXCEPTION(scope, nullptr);
                        }

                        const char* nist = EC_curve_nid2nist(nid);
                        if (nist) {
                            object->putDirect(vm, Identifier::fromString(vm, "nistCurve"_s), jsString(vm, String::fromUTF8(nist)));
                            RETURN_IF_EXCEPTION(scope, nullptr);
                        }
                    }
                }
            }
            break;
        }
        }
    }

    // Set validFrom
    object->putDirect(vm, Identifier::fromString(vm, "valid_from"_s), valueOrUndefined(validFrom()));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set validTo
    object->putDirect(vm, Identifier::fromString(vm, "valid_to"_s), valueOrUndefined(validTo()));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set fingerprints
    object->putDirect(vm, Identifier::fromString(vm, "fingerprint"_s), valueOrUndefined(fingerprint()));
    RETURN_IF_EXCEPTION(scope, nullptr);

    object->putDirect(vm, Identifier::fromString(vm, "fingerprint256"_s), valueOrUndefined(fingerprint256()));
    RETURN_IF_EXCEPTION(scope, nullptr);

    object->putDirect(vm, Identifier::fromString(vm, "fingerprint512"_s), valueOrUndefined(fingerprint512()));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set keyUsage
    object->putDirect(vm, Identifier::fromString(vm, "ext_key_usage"_s), getKeyUsage(globalObject));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set serialNumber
    object->putDirect(vm, Identifier::fromString(vm, "serialNumber"_s), valueOrUndefined(serialNumber()));
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set raw
    object->putDirect(vm, Identifier::fromString(vm, "raw"_s), raw());
    RETURN_IF_EXCEPTION(scope, nullptr);

    // Set CA flag
    object->putDirect(vm, Identifier::fromString(vm, "ca"_s), jsBoolean(computeIsCA(view(), globalObject)));
    RETURN_IF_EXCEPTION(scope, nullptr);

    return object;
}

JSValue JSX509Certificate::computePublicKey(ncrypto::X509View view, JSGlobalObject* lexicalGlobalObject)
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto result = view.getPublicKey();
    if (!result) {
        throwCryptoError(lexicalGlobalObject, scope, result.error.value_or(0));
        return {};
    }

    auto handle = KeyObject::create(CryptoKeyType::Public, WTF::move(result.value));
    return JSPublicKeyObject::create(vm, globalObject->m_JSPublicKeyObjectClassStructure.get(lexicalGlobalObject), lexicalGlobalObject, WTF::move(handle));
}

JSValue JSX509Certificate::computeInfoAccess(ncrypto::X509View view, JSGlobalObject* globalObject, bool legacy)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto bio = view.getInfoAccess();
    if (!bio) {
        return jsEmptyString(vm);
    }
    String info = toWTFString(bio);
    if (!legacy) {
        return jsString(vm, info);
    }

    // InfoAccess is always an array, even when a single element is present.
    JSObject* object = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());

    // Go through each newline
    unsigned substring_start = 0;
    while (substring_start < info.length()) {
        auto key_index = info.find(':', substring_start);

        if (key_index == notFound) {
            break;
        }
        auto line_end = info.find('\n', key_index);
        unsigned value_start = key_index + 1;
        String key = info.substringSharingImpl(substring_start, key_index - substring_start);
        String value = line_end == notFound ? info.substringSharingImpl(value_start) : info.substringSharingImpl(value_start, line_end - value_start);
        Identifier identifier = Identifier::fromString(vm, key);

        if (identifier.isNull()) {
            continue;
        }
        JSValue existingValue = object->getIfPropertyExists(globalObject, identifier);
        RETURN_IF_EXCEPTION(scope, {});
        if (existingValue) {
            JSArray* array = jsCast<JSArray*>(existingValue);
            array->push(globalObject, jsString(vm, value));
        } else {
            JSArray* array = constructEmptyArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), 1);
            RETURN_IF_EXCEPTION(scope, {});
            array->putDirectIndex(globalObject, 0, jsString(vm, value));
            object->putDirect(vm, identifier, array);
        }

        if (line_end == notFound) {
            break;
        }
        substring_start = line_end + 1;
    }

    return object;
}

JSString* JSX509Certificate::computeSubjectAltName(ncrypto::X509View view, JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto bio = view.getSubjectAltName();
    if (!bio) {
        return jsEmptyString(vm);
    }

    return jsString(vm, toWTFString(bio));
}

JSValue JSX509Certificate::getKeyUsage(ncrypto::X509View view, JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto keyUsage = view.getKeyUsage();
    if (!keyUsage) {
        return jsUndefined();
    }

    JSArray* array = JSArray::tryCreate(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), 0);
    if (!array) {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    int count = sk_ASN1_OBJECT_num(keyUsage.get());
    char buf[256];

    int j = 0;
    for (int i = 0; i < count; i++) {
        if (OBJ_obj2txt(buf, sizeof(buf), sk_ASN1_OBJECT_value(keyUsage.get(), i), 1) >= 0) {
            array->putDirectIndex(globalObject, j++, jsString(vm, String::fromUTF8(buf)));
        }
    }

    return array;
}

void setupX509CertificateClassStructure(LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSX509CertificatePrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSX509CertificatePrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSX509CertificateConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());

    auto* constructor = JSX509CertificateConstructor::create(init.vm, init.global, constructorStructure, prototype);

    auto* structure = JSX509Certificate::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

extern "C" EncodedJSValue Bun__X509__toJSLegacyEncoding(X509* cert, JSGlobalObject* globalObject)
{
    ncrypto::X509View view(cert);
    return JSValue::encode(JSX509Certificate::toLegacyObject(view, globalObject));
}
extern "C" EncodedJSValue Bun__X509__toJS(X509* cert, JSGlobalObject* globalObject)
{
    ncrypto::X509Pointer cert_ptr(cert);
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    return JSValue::encode(JSX509Certificate::create(zigGlobalObject->vm(), zigGlobalObject->m_JSX509CertificateClassStructure.get(zigGlobalObject), globalObject, WTF::move(cert_ptr)));
}

JSC_DEFINE_HOST_FUNCTION(jsIsX509Certificate, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    JSValue value = callFrame->argument(0);
    if (!value.isCell())
        return JSValue::encode(jsBoolean(false));
    return JSValue::encode(jsBoolean(value.asCell()->inherits(JSX509Certificate::info())));
}

} // namespace Bun
