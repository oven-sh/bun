#include "root.h"
#include <JavaScriptCore/JSCell.h>
#include <JavaScriptCore/JSInternalFieldObjectImplInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include "ZigGlobalObject.h"
#include <JavaScriptCore/Structure.h>
#include "ZigGeneratedClasses.h"
#include "JSWebSocketServerContext.h"

namespace Bun {
using namespace JSC;
using namespace WebCore;

/**
  JSWebSocketServerContext holds all the callbacks used by WebSocket handlers in Bun.serve()

  Instead of manually managing protect()/unprotect() calls, we use JSInternalFieldObjectImpl
  to make the callbacks GC-managed. The GC will automatically track these references.

  Internal fields (GC-tracked):
  0: onOpen
  1: onMessage
  2: onClose
  3: onDrain
  4: onError
  5: onPing
  6: onPong
  7: server (the server instance)

  C++ members (not GC-tracked):
  - app (uWS app pointer)
  - vm (VirtualMachine pointer)
  - flags (ssl, publish_to_self)
  - active_connections (connection counter)
 */
class JSWebSocketServerContext final : public JSC::JSInternalFieldObjectImpl<8> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<8>;

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static constexpr uint8_t onOpenFieldIndex = 0;
    static constexpr uint8_t onMessageFieldIndex = 1;
    static constexpr uint8_t onCloseFieldIndex = 2;
    static constexpr uint8_t onDrainFieldIndex = 3;
    static constexpr uint8_t onErrorFieldIndex = 4;
    static constexpr uint8_t onPingFieldIndex = 5;
    static constexpr uint8_t onPongFieldIndex = 6;
    static constexpr uint8_t serverFieldIndex = 7;

    struct Flags {
        bool ssl = false;
        bool publish_to_self = false;
    };

    void* app = nullptr;
    void* vm = nullptr;
    Flags flags = {};
    size_t active_connections = 0;

    static JSWebSocketServerContext* create(
        JSC::VM& vm,
        JSC::Structure* structure)
    {
        auto* context = new (NotNull, JSC::allocateCell<JSWebSocketServerContext>(vm)) JSWebSocketServerContext(vm, structure);
        context->finishCreation(vm);
        return context;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return JSC::Structure::create(vm, globalObject, globalObject->nullPrototype(), JSC::TypeInfo(JSC::InternalFieldTupleType, StructureFlags), info());
    }

    static void destroy(JSCell* cell)
    {
        static_cast<JSWebSocketServerContext*>(cell)->~JSWebSocketServerContext();
    }

    ~JSWebSocketServerContext() = default;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSWebSocketServerContext, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForJSWebSocketServerContext.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForJSWebSocketServerContext = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForJSWebSocketServerContext.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForJSWebSocketServerContext = std::forward<decltype(space)>(space); });
    }

    DECLARE_INFO;

    // Getters for each callback
    JSValue onOpen() const { return Base::internalField(onOpenFieldIndex).get(); }
    JSValue onMessage() const { return Base::internalField(onMessageFieldIndex).get(); }
    JSValue onClose() const { return Base::internalField(onCloseFieldIndex).get(); }
    JSValue onDrain() const { return Base::internalField(onDrainFieldIndex).get(); }
    JSValue onError() const { return Base::internalField(onErrorFieldIndex).get(); }
    JSValue onPing() const { return Base::internalField(onPingFieldIndex).get(); }
    JSValue onPong() const { return Base::internalField(onPongFieldIndex).get(); }
    JSValue server() const { return Base::internalField(serverFieldIndex).get(); }

    // Setters for each callback
    void setOnOpen(JSC::VM& vm, JSValue value) { Base::internalField(onOpenFieldIndex).set(vm, this, value); }
    void setOnMessage(JSC::VM& vm, JSValue value) { Base::internalField(onMessageFieldIndex).set(vm, this, value); }
    void setOnClose(JSC::VM& vm, JSValue value) { Base::internalField(onCloseFieldIndex).set(vm, this, value); }
    void setOnDrain(JSC::VM& vm, JSValue value) { Base::internalField(onDrainFieldIndex).set(vm, this, value); }
    void setOnError(JSC::VM& vm, JSValue value) { Base::internalField(onErrorFieldIndex).set(vm, this, value); }
    void setOnPing(JSC::VM& vm, JSValue value) { Base::internalField(onPingFieldIndex).set(vm, this, value); }
    void setOnPong(JSC::VM& vm, JSValue value) { Base::internalField(onPongFieldIndex).set(vm, this, value); }
    void setServer(JSC::VM& vm, JSValue value) { Base::internalField(serverFieldIndex).set(vm, this, value); }

    // Getters/setters for C++ members
    void* getApp() const { return app; }
    void setApp(void* value) { app = value; }
    void* getVM() const { return vm; }
    void setVM(void* value) { vm = value; }
    Flags getFlags() const { return flags; }
    void setFlags(Flags value) { flags = value; }
    size_t getActiveConnections() const { return active_connections; }
    void setActiveConnections(size_t value) { active_connections = value; }
    void incrementActiveConnections() { active_connections++; }
    void decrementActiveConnections() { if (active_connections > 0) active_connections--; }

private:
    JSWebSocketServerContext(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        // Initialize all fields to undefined
        for (unsigned i = 0; i < Base::numberOfInternalFields; i++) {
            Base::internalField(i).set(vm, this, jsUndefined());
        }
    }
};

const JSC::ClassInfo JSWebSocketServerContext::s_info = { "JSWebSocketServerContext"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWebSocketServerContext) };

extern "C" JSC::EncodedJSValue Bun__JSWebSocketServerContext__create(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto* structure = globalObject->m_JSWebSocketServerContextStructure.get(globalObject);
    auto* context = JSWebSocketServerContext::create(vm, structure);
    return JSValue::encode(context);
}

extern "C" void Bun__JSWebSocketServerContext__setOnOpen(JSWebSocketServerContext* context, Zig::GlobalObject* globalObject, JSC::EncodedJSValue value)
{
    context->setOnOpen(globalObject->vm(), JSValue::decode(value));
}

extern "C" void Bun__JSWebSocketServerContext__setOnMessage(JSWebSocketServerContext* context, Zig::GlobalObject* globalObject, JSC::EncodedJSValue value)
{
    context->setOnMessage(globalObject->vm(), JSValue::decode(value));
}

extern "C" void Bun__JSWebSocketServerContext__setOnClose(JSWebSocketServerContext* context, Zig::GlobalObject* globalObject, JSC::EncodedJSValue value)
{
    context->setOnClose(globalObject->vm(), JSValue::decode(value));
}

extern "C" void Bun__JSWebSocketServerContext__setOnDrain(JSWebSocketServerContext* context, Zig::GlobalObject* globalObject, JSC::EncodedJSValue value)
{
    context->setOnDrain(globalObject->vm(), JSValue::decode(value));
}

extern "C" void Bun__JSWebSocketServerContext__setOnError(JSWebSocketServerContext* context, Zig::GlobalObject* globalObject, JSC::EncodedJSValue value)
{
    context->setOnError(globalObject->vm(), JSValue::decode(value));
}

extern "C" void Bun__JSWebSocketServerContext__setOnPing(JSWebSocketServerContext* context, Zig::GlobalObject* globalObject, JSC::EncodedJSValue value)
{
    context->setOnPing(globalObject->vm(), JSValue::decode(value));
}

extern "C" void Bun__JSWebSocketServerContext__setOnPong(JSWebSocketServerContext* context, Zig::GlobalObject* globalObject, JSC::EncodedJSValue value)
{
    context->setOnPong(globalObject->vm(), JSValue::decode(value));
}

extern "C" void Bun__JSWebSocketServerContext__setServer(JSWebSocketServerContext* context, Zig::GlobalObject* globalObject, JSC::EncodedJSValue value)
{
    context->setServer(globalObject->vm(), JSValue::decode(value));
}

extern "C" JSC::EncodedJSValue Bun__JSWebSocketServerContext__getOnOpen(JSWebSocketServerContext* context)
{
    return JSValue::encode(context->onOpen());
}

extern "C" JSC::EncodedJSValue Bun__JSWebSocketServerContext__getOnMessage(JSWebSocketServerContext* context)
{
    return JSValue::encode(context->onMessage());
}

extern "C" JSC::EncodedJSValue Bun__JSWebSocketServerContext__getOnClose(JSWebSocketServerContext* context)
{
    return JSValue::encode(context->onClose());
}

extern "C" JSC::EncodedJSValue Bun__JSWebSocketServerContext__getOnDrain(JSWebSocketServerContext* context)
{
    return JSValue::encode(context->onDrain());
}

extern "C" JSC::EncodedJSValue Bun__JSWebSocketServerContext__getOnError(JSWebSocketServerContext* context)
{
    return JSValue::encode(context->onError());
}

extern "C" JSC::EncodedJSValue Bun__JSWebSocketServerContext__getOnPing(JSWebSocketServerContext* context)
{
    return JSValue::encode(context->onPing());
}

extern "C" JSC::EncodedJSValue Bun__JSWebSocketServerContext__getOnPong(JSWebSocketServerContext* context)
{
    return JSValue::encode(context->onPong());
}

extern "C" JSC::EncodedJSValue Bun__JSWebSocketServerContext__getServer(JSWebSocketServerContext* context)
{
    return JSValue::encode(context->server());
}

extern "C" void Bun__JSWebSocketServerContext__setApp(JSWebSocketServerContext* context, void* app)
{
    context->setApp(app);
}

extern "C" void* Bun__JSWebSocketServerContext__getApp(JSWebSocketServerContext* context)
{
    return context->getApp();
}

extern "C" void Bun__JSWebSocketServerContext__setVM(JSWebSocketServerContext* context, void* vm)
{
    context->setVM(vm);
}

extern "C" void* Bun__JSWebSocketServerContext__getVM(JSWebSocketServerContext* context)
{
    return context->getVM();
}

extern "C" void Bun__JSWebSocketServerContext__setSSL(JSWebSocketServerContext* context, bool ssl)
{
    auto flags = context->getFlags();
    flags.ssl = ssl;
    context->setFlags(flags);
}

extern "C" bool Bun__JSWebSocketServerContext__getSSL(JSWebSocketServerContext* context)
{
    return context->getFlags().ssl;
}

extern "C" void Bun__JSWebSocketServerContext__setPublishToSelf(JSWebSocketServerContext* context, bool publish_to_self)
{
    auto flags = context->getFlags();
    flags.publish_to_self = publish_to_self;
    context->setFlags(flags);
}

extern "C" bool Bun__JSWebSocketServerContext__getPublishToSelf(JSWebSocketServerContext* context)
{
    return context->getFlags().publish_to_self;
}

extern "C" size_t Bun__JSWebSocketServerContext__getActiveConnections(JSWebSocketServerContext* context)
{
    return context->getActiveConnections();
}

extern "C" void Bun__JSWebSocketServerContext__incrementActiveConnections(JSWebSocketServerContext* context)
{
    context->incrementActiveConnections();
}

extern "C" void Bun__JSWebSocketServerContext__decrementActiveConnections(JSWebSocketServerContext* context)
{
    context->decrementActiveConnections();
}

Structure* createJSWebSocketServerContextStructure(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    return JSWebSocketServerContext::createStructure(vm, globalObject);
}

} // namespace Bun
