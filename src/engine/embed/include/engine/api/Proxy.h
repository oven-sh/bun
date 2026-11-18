#pragma once

#include "engine/api/GlobalObject.h"

namespace JSC {

class ProxyObject final : public JSInternalFieldObjectImpl<2> {
public:
    ENGINE_DECLARE_CLASS(ProxyObject)

    enum class Field : uint32_t {
        Target = Engine::Layout::proxyTargetField,
        Handler = Engine::Layout::proxyHandlerField,
    };

    static ProxyObject* create(JSGlobalObject* globalObject, JSValue target, JSValue handler) { return Engine::proxy_create(globalObject, target, handler); }

    const WriteBarrier<Unknown>& internalField(Field field) const { return JSInternalFieldObjectImpl::internalField(static_cast<uint32_t>(field)); }
    JSObject* target() const { return asObject(internalField(Field::Target).get()); }
    JSValue handler() const { return internalField(Field::Handler).get(); }
    bool isRevoked() const { return handler().isNull(); }
};
ENGINE_CLASS_HAS_TYPE(ProxyObject, ProxyObjectType);

} // namespace JSC
