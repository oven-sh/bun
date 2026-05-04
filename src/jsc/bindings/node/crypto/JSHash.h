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

JSC_DECLARE_HOST_FUNCTION(callHash);
JSC_DECLARE_HOST_FUNCTION(constructHash);

class JSHash final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSHash* create(JSC::VM& vm, JSC::Structure* structure);

    DECLARE_INFO;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
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

    Vector<uint8_t, EVP_MAX_MD_SIZE> m_digestBuffer;

    ExternZigHash::Hasher* m_zigHasher { nullptr };
};

class JSHashPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSHashPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSHashPrototype* prototype = new (NotNull, JSC::allocateCell<JSHashPrototype>(vm)) JSHashPrototype(vm, structure);
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
    JSHashPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm);
};

class JSHashConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSHashConstructor* create(JSC::VM& vm, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSHashConstructor* constructor = new (NotNull, JSC::allocateCell<JSHashConstructor>(vm)) JSHashConstructor(vm, structure);
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
    JSHashConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, callHash, constructHash)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSObject* prototype)
    {
        Base::finishCreation(vm, 2, "Hash"_s, PropertyAdditionMode::WithStructureTransition);
    }
};

JSC_DECLARE_HOST_FUNCTION(jsHashProtoFuncUpdate);
JSC_DECLARE_HOST_FUNCTION(jsHashProtoFuncDigest);

void setupJSHashClassStructure(JSC::LazyClassStructure::Initializer& init);

} // namespace Bun
