#pragma once

#include "root.h"
#include "BunClientData.h"
#include <JavaScriptCore/JSDestructibleObject.h>
#include "ncrypto.h"
#include "CryptoUtil.h"
#include "JSBuffer.h"
#include "JSDOMConvertEnumeration.h"

namespace Bun {

// node:crypto `Hmac`: the object returned by createHmac(). Its prototype chain is
// Hmac.prototype -> Transform.prototype (JS) -> ...; the Transform half is constructed lazily
// (LazyTransform.h) and the HMAC context lives directly on this cell.
class JSHmac final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSHmac* create(JSC::VM& vm, JSC::Structure* structure);
    static void destroy(JSC::JSCell* cell);

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return Bun::createClassStructure(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    JSHmac(JSC::VM& vm, JSC::Structure* structure);
    ~JSHmac();

    void finishCreation(JSC::VM& vm);
    void init(JSC::JSGlobalObject* globalObject, ThrowScope& scope, const StringView& algorithm, std::span<const uint8_t> keyData);
    bool update(std::span<const uint8_t> input);

    ncrypto::HMACCtxPointer m_ctx;
    bool m_finalized { false };
    size_t m_sizeForGC { 0 };
};

void setupJSHmacClassStructure(JSC::LazyClassStructure::Initializer&);

} // namespace Bun
