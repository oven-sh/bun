#pragma once

#include "root.h"
#include "BunClientData.h"
#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/ArrayBufferView.h>
#include <JavaScriptCore/JSDestructibleObject.h>
#include "ncrypto.h"
#include "CryptoUtil.h"
#include "JSBuffer.h"
#include "JSDOMConvertEnumeration.h"
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>

namespace Bun {

JSC_DECLARE_HOST_FUNCTION(callHmac);
JSC_DECLARE_HOST_FUNCTION(constructHmac);

class JSHmac final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSHmac* create(JSC::VM& vm, JSC::Structure* structure);
    static void destroy(JSC::JSCell* cell);

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    JSHmac(JSC::VM& vm, JSC::Structure* structure);
    ~JSHmac();

    void finishCreation(JSC::VM& vm);
    void init(JSC::JSGlobalObject* globalObject, ThrowScope& scope, const StringView& algorithm, std::span<const uint8_t> keyData);
    bool update(std::span<const uint8_t> input);

    ncrypto::HMACCtxPointer m_ctx;
    bool m_finalized { false };
};

class JSHmacPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSHmacPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSHmacPrototype* prototype = new (NotNull, JSC::allocateCell<JSHmacPrototype>(vm)) JSHmacPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

private:
    JSHmacPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm);
};

class JSHmacConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSHmacConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSHmacConstructor* constructor = new (NotNull, JSC::allocateCell<JSHmacConstructor>(vm)) JSHmacConstructor(vm, structure);
        constructor->finishCreation(vm, prototype);
        return constructor;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype);

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return &vm.internalFunctionSpace();
    }

private:
    JSHmacConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, callHmac, constructHmac)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
    {
        Base::finishCreation(vm, 2, "Hmac"_s, PropertyAdditionMode::WithStructureTransition);
    }
};

JSC_DECLARE_HOST_FUNCTION(jsHmacProtoFuncUpdate);
JSC_DECLARE_HOST_FUNCTION(jsHmacProtoFuncDigest);

void setupJSHmacClassStructure(JSC::LazyClassStructure::Initializer& init);

} // namespace Bun
