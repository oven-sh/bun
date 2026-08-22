#include "JSHash.h"
#include "JSHashPrototype.h"
#include "JSHashConstructor.h"
#include "LazyTransform.h"
#include "NodeValidator.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <openssl/evp.h>

namespace Bun {

const ClassInfo JSHash::s_info = { "Hash"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHash) };

JSHash::JSHash(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

void JSHash::destroy(JSC::JSCell* cell)
{
    static_cast<JSHash*>(cell)->~JSHash();
}

JSHash::~JSHash()
{
    if (m_zigHasher) {
        ExternZigHash::destroy(m_zigHasher);
    }
}

void JSHash::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
}

template<typename Visitor>
void JSHash::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSHash* thisObject = uncheckedDowncast<JSHash>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.reportExtraMemoryVisited(thisObject->m_sizeForGC);
}

DEFINE_VISIT_CHILDREN(JSHash);

template<typename, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSHash::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;

    return WebCore::subspaceForImpl<JSHash, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSHash, m_subspaceForJSHash));
}

JSHash* JSHash::create(JSC::VM& vm, JSC::Structure* structure)
{
    JSHash* instance = new (NotNull, JSC::allocateCell<JSHash>(vm)) JSHash(vm, structure);
    instance->finishCreation(vm);
    return instance;
}

bool JSHash::init(JSC::JSGlobalObject* globalObject, ThrowScope& scope, const EVP_MD* md, std::optional<uint32_t> xofLen)
{
    m_ctx = ncrypto::EVPMDCtxPointer::New();
    if (!m_ctx.digestInit(md)) {
        m_ctx.reset();
        return false;
    }

    m_mdLen = m_ctx.getDigestSize();

    if (xofLen.has_value() && xofLen.value() != m_mdLen) {
        // This is a little hack to cause createHash to fail when an incorrect
        // hashSize option was passed for a non-XOF hash function.
        // https://github.com/nodejs/node/blob/2a6f90813f4802def79f2df1bfe20e95df279abf/src/crypto/crypto_hash.cc#L346
        if (!m_ctx.hasXofFlag()) {
            EVPerr(EVP_F_EVP_DIGESTFINALXOF, EVP_R_NOT_XOF_OR_INVALID_LENGTH);
            m_ctx.reset();
            return false;
        }
        m_mdLen = xofLen.value();
    }

    m_sizeForGC = sizeof(EVP_MD_CTX) + m_mdLen;
    globalObject->vm().heap.reportExtraMemoryAllocated(this, m_sizeForGC);

    return true;
}

bool JSHash::initZig(JSGlobalObject* globalObject, ThrowScope& scope, ExternZigHash::Hasher* hasher, std::optional<uint32_t> xofLen)
{
    m_zigHasher = hasher;
    m_mdLen = ExternZigHash::getDigestSize(hasher);

    if (m_mdLen == 0) {
        return false;
    }

    if (xofLen.has_value() && xofLen.value() != m_mdLen) {
        if (!ExternZigHash::isXof(hasher)) {
            EVPerr(EVP_F_EVP_DIGESTFINALXOF, EVP_R_NOT_XOF_OR_INVALID_LENGTH);
            return false;
        }
        m_mdLen = xofLen.value();
    }

    m_sizeForGC = m_mdLen;
    globalObject->vm().heap.reportExtraMemoryAllocated(this, m_sizeForGC);

    return true;
}

bool JSHash::update(std::span<const uint8_t> input)
{
    if (m_ctx) {
        ncrypto::Buffer<const void> buffer {
            .data = input.data(),
            .len = input.size(),
        };

        return m_ctx.digestUpdate(buffer);
    }

    if (m_zigHasher) {
        return ExternZigHash::update(m_zigHasher, input);
    }

    return false;
}

JSHash* createHash(JSGlobalObject* globalObject, Structure* structure, const EVP_MD* md, std::unique_ptr<ExternZigHash::Hasher, decltype(&ExternZigHash::destroy)> zigHasher, JSHash* original, JSValue optionsValue)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (md == nullptr && zigHasher == nullptr) [[unlikely]] {
        throwCryptoError(globalObject, scope, ERR_get_error(), "Digest method not supported"_s);
        return nullptr;
    }

    std::optional<unsigned int> xofLen = std::nullopt;
    if (optionsValue.isObject()) {
        JSValue outputLengthValue = optionsValue.get(globalObject, Identifier::fromString(vm, "outputLength"_s));
        RETURN_IF_EXCEPTION(scope, nullptr);

        if (!outputLengthValue.isUndefined()) {
            Bun::V::validateUint32(scope, globalObject, outputLengthValue, "options.outputLength"_s, jsUndefined());
            RETURN_IF_EXCEPTION(scope, nullptr);
            xofLen = outputLengthValue.toUInt32(globalObject);
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
    }

    JSHash* hash = JSHash::create(vm, structure);

    if (zigHasher) {
        if (!hash->initZig(globalObject, scope, zigHasher.release(), xofLen)) {
            throwCryptoError(globalObject, scope, ERR_get_error(), "Digest method not supported"_s);
            return nullptr;
        }
    } else {
        if (!hash->init(globalObject, scope, md, xofLen)) {
            throwCryptoError(globalObject, scope, ERR_get_error(), "Digest method not supported"_s);
            return nullptr;
        }
        if (original != nullptr && !original->m_ctx.copyTo(hash->m_ctx)) {
            throwCryptoError(globalObject, scope, ERR_get_error(), "Digest copy error"_s);
            return nullptr;
        }
    }

    // Transform is constructed lazily (see LazyTransform.h); it reads `this._options` then.
    if (!optionsValue.isUndefined())
        hash->putDirect(vm, Identifier::fromString(vm, "_options"_s), optionsValue);

    return hash;
}

void setupJSHashClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    // class Hash extends Transform (internal/streams/transform); see LazyTransform.h for the lazy part.
    JSObject* transform = transformConstructor(init.global);
    RELEASE_ASSERT(transform);
    JSValue transformPrototype = transform->getDirect(init.vm, init.vm.propertyNames->prototype);
    RELEASE_ASSERT(transformPrototype && transformPrototype.isObject());

    auto* prototypeStructure = JSHashPrototype::createStructure(init.vm, init.global, transformPrototype);
    auto* prototype = JSHashPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSHashConstructor::createStructure(init.vm, init.global, transform);
    auto* constructor = JSHashConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSHash::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
