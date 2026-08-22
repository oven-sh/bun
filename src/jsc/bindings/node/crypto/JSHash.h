#pragma once

#include "root.h"
#include "BunClientData.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include "ncrypto.h"
#include "CryptoUtil.h"
#include "JSBuffer.h"
#include "JSDOMConvertEnumeration.h"

namespace Bun {

// node:crypto `Hash`: the object returned by createHash(). Its prototype chain is
// Hash.prototype -> Transform.prototype (JS) -> ...; the Transform half is constructed lazily
// (LazyTransform.h) and the digest state lives directly on this cell.
class JSHash final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSHash* create(JSC::VM& vm, JSC::Structure* structure);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static void destroy(JSC::JSCell* cell);

    JSHash(JSC::VM& vm, JSC::Structure* structure);
    ~JSHash();

    void finishCreation(JSC::VM& vm);
    bool init(JSC::JSGlobalObject* globalObject, ThrowScope& scope, const EVP_MD* md, std::optional<uint32_t> xofLen);
    bool initZig(JSGlobalObject* globalObject, ThrowScope& scope, ExternZigHash::Hasher* hasher, std::optional<uint32_t> xofLen);
    bool update(std::span<const uint8_t> input);

    ncrypto::EVPMDCtxPointer m_ctx;
    unsigned int m_mdLen { 0 };
    ByteSource m_digest;
    bool m_finalized { false };

    ExternZigHash::Hasher* m_zigHasher { nullptr };
    size_t m_sizeForGC { 0 };
};

// Shared by the constructor and Hash.prototype.copy(): create a Hash in `structure` for
// `md`/`zigHasher` (cloning `original` when given) with options.outputLength applied. Throws on failure.
JSHash* createHash(JSC::JSGlobalObject*, JSC::Structure*, const EVP_MD* md, std::unique_ptr<ExternZigHash::Hasher, decltype(&ExternZigHash::destroy)> zigHasher, JSHash* original, JSC::JSValue options);

void setupJSHashClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
