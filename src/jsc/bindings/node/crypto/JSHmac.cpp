#include "JSHmac.h"
#include "JSHmacPrototype.h"
#include "JSHmacConstructor.h"
#include "LazyTransform.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <openssl/evp.h>

namespace Bun {

const ClassInfo JSHmac::s_info = { "Hmac"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSHmac) };

JSHmac::JSHmac(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

void JSHmac::destroy(JSC::JSCell* cell)
{
    static_cast<JSHmac*>(cell)->~JSHmac();
}

JSHmac::~JSHmac()
{
}

void JSHmac::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
}

template<typename Visitor>
void JSHmac::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSHmac* thisObject = uncheckedDowncast<JSHmac>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.reportExtraMemoryVisited(thisObject->m_sizeForGC);
}

DEFINE_VISIT_CHILDREN(JSHmac);

template<typename, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSHmac::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;

    return WebCore::subspaceForImpl<JSHmac, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSHmac, m_subspaceForJSHmac));
}

JSHmac* JSHmac::create(JSC::VM& vm, JSC::Structure* structure)
{
    JSHmac* instance = new (NotNull, JSC::allocateCell<JSHmac>(vm)) JSHmac(vm, structure);
    instance->finishCreation(vm);
    return instance;
}

void JSHmac::init(JSC::JSGlobalObject* globalObject, ThrowScope& scope, const StringView& algorithm, std::span<const uint8_t> keyData)
{
    // Get the digest algorithm from the algorithm name
    const EVP_MD* md = ncrypto::getDigestByName(algorithm);
    if (!md) {
        Bun::ERR::CRYPTO_INVALID_DIGEST(scope, globalObject, algorithm);
        return;
    }

    // Create the HMAC context
    m_ctx = ncrypto::HMACCtxPointer::New();

    // Initialize HMAC with the key and algorithm
    ncrypto::Buffer<const void> keyBuffer {
        .data = keyData.data(),
        .len = keyData.size(),
    };

    if (!m_ctx.init(keyBuffer, md)) {
        m_ctx.reset();
        throwCryptoError(globalObject, scope, ERR_get_error(), "Failed to initialize HMAC context"_s);
        return;
    }

    m_sizeForGC = sizeof(HMAC_CTX);
    globalObject->vm().heap.reportExtraMemoryAllocated(this, m_sizeForGC);
}

bool JSHmac::update(std::span<const uint8_t> input)
{
    // Update the HMAC with the data
    ncrypto::Buffer<const void> buffer {
        .data = input.data(),
        .len = input.size(),
    };

    return m_ctx.update(buffer);
}

void setupJSHmacClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    // class Hmac extends Transform (internal/streams/transform); see LazyTransform.h for the lazy part.
    JSObject* transform = transformConstructor(init.global);
    RELEASE_ASSERT(transform);
    JSValue transformPrototype = transform->getDirect(init.vm, init.vm.propertyNames->prototype);
    RELEASE_ASSERT(transformPrototype && transformPrototype.isObject());

    auto* prototypeStructure = JSHmacPrototype::createStructure(init.vm, init.global, transformPrototype);
    auto* prototype = JSHmacPrototype::create(init.vm, init.global, prototypeStructure);

    auto* constructorStructure = JSHmacConstructor::createStructure(init.vm, init.global, transform);
    auto* constructor = JSHmacConstructor::create(init.vm, constructorStructure, prototype);

    auto* structure = JSHmac::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun
