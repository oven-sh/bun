#include "config.h"
#include "ZigGlobalObject.h"
#include "ncrypto.h"

namespace Bun {

JSC::JSValue createNodeTLSBinding(Zig::GlobalObject*);
void configureNodeTLS(JSC::VM& vm, Zig::GlobalObject* globalObject);

class NodeTLSSecureContextPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    DECLARE_INFO;

    static NodeTLSSecureContextPrototype* create(VM& vm, Structure* structure)
    {
        auto* prototype = new (NotNull, allocateCell<NodeTLSSecureContextPrototype>(vm)) NodeTLSSecureContextPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
    }

private:
    NodeTLSSecureContextPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(VM& vm);
};

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeTLSSecureContextPrototype, NodeTLSSecureContextPrototype::Base);

class NodeTLSSecureContextConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    DECLARE_EXPORT_INFO;

    static NodeTLSSecureContextConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, Base::StructureFlags), info());
    }

private:
    NodeTLSSecureContextConstructor(JSC::VM& vm, JSC::Structure* structure);

    void finishCreation(JSC::VM&, JSC::JSObject* prototype);
};

class NodeTLSSecureContext final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    static NodeTLSSecureContext* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, ArgList args);

    template<typename, JSC::SubspaceAccess Mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (Mode == JSC::SubspaceAccess::Concurrently) {
            return nullptr;
        } else {
            return WebCore::subspaceForImpl<NodeTLSSecureContext, WebCore::UseCustomHeapCellType::No>(
                vm,
                [](auto& spaces) { return spaces.m_clientSubspaceForNodeTLSSecureContext.get(); },
                [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeTLSSecureContext = std::forward<decltype(space)>(space); },
                [](auto& spaces) { return spaces.m_subspaceForNodeTLSSecureContext.get(); },
                [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeTLSSecureContext = std::forward<decltype(space)>(space); });
        }
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSObject* createPrototype(VM& vm, JSGlobalObject* globalObject)
    {
        return NodeTLSSecureContextPrototype::create(vm, NodeTLSSecureContextPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
    }

    static void destroy(JSC::JSCell* cell)
    {
        static_cast<NodeTLSSecureContext*>(cell)->NodeTLSSecureContext::~NodeTLSSecureContext();
    }

    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    SSL_CTX* context() { return m_context.get(); }
    void context(SSL_CTX* ctx) { m_context = { ctx, SSL_CTX_free }; }

    void setCACert(const ncrypto::BIOPointer& bio);
    void setRootCerts();

private:
    std::unique_ptr<SSL_CTX, decltype(&SSL_CTX_free)> m_context { nullptr, nullptr };
    mutable std::unique_ptr<X509_STORE, decltype(&X509_STORE_free)> m_certStore { nullptr, nullptr };
    unsigned char m_ticketKeyName[16] {};
    unsigned char m_ticketKeyAES[16] {};
    unsigned char m_ticketKeyHMAC[16] {};

    NodeTLSSecureContext(JSC::VM& vm, JSC::Structure* structure);

    ~NodeTLSSecureContext();

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(info()));
    }

    void setX509StoreFlag(unsigned long flags);
    X509_STORE* getCertStore() const;

    static int ticketCompatibilityCallback(SSL* ssl, unsigned char* name, unsigned char* iv, EVP_CIPHER_CTX* ectx, HMAC_CTX* hctx, int enc);

    friend EncodedJSValue secureContextInit(JSGlobalObject* globalObject, CallFrame* callFrame);
};

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeTLSSecureContextConstructor, NodeTLSSecureContextConstructor::Base);

}
