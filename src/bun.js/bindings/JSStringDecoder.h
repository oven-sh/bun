#pragma once

#include "root.h"
#include "BufferEncodingType.h"

namespace WebCore {
using namespace JSC;

class JSStringDecoder : public JSC::JSDestructibleObject {
    using Base = JSC::JSDestructibleObject;

public:
    JSStringDecoder(JSC::VM& vm, JSC::Structure* structure, BufferEncodingType encoding)
        : Base(vm, structure)
        , m_lastNeed(0)
        , m_lastTotal(0)
        , m_encoding(encoding)
    {
    }

    DECLARE_INFO;

    static constexpr unsigned StructureFlags = Base::StructureFlags;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }

    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM& vm);

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject,
        JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype,
            JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSStringDecoder* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, BufferEncodingType encoding)
    {
        JSStringDecoder* accessor = new (NotNull, JSC::allocateCell<JSStringDecoder>(vm)) JSStringDecoder(vm, structure, encoding);
        accessor->finishCreation(vm, globalObject);
        return accessor;
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject);
    static void destroy(JSCell* thisObject)
    {
        static_cast<JSStringDecoder*>(thisObject)->~JSStringDecoder();
    }

    JSC::JSValue write(JSC::VM&, JSC::JSGlobalObject*, uint8_t*, uint32_t);
    JSC::JSValue end(JSC::VM&, JSC::JSGlobalObject*, uint8_t*, uint32_t);

    uint8_t m_lastNeed = 0;
    uint8_t m_lastTotal = 0;
    uint8_t m_lastChar[4] = { 0, 0, 0, 0 };
    BufferEncodingType m_encoding = BufferEncodingType::utf8;

private:
    JSC::JSValue fillLast(JSC::VM&, JSC::JSGlobalObject*, uint8_t*, uint32_t);
    JSC::JSValue text(JSC::VM&, JSC::JSGlobalObject*, uint8_t*, uint32_t, uint32_t);
    uint8_t utf8CheckIncomplete(uint8_t*, uint32_t, uint32_t);
};

class JSStringDecoderPrototype : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSStringDecoderPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSStringDecoderPrototype* ptr = new (NotNull, JSC::allocateCell<JSStringDecoderPrototype>(vm)) JSStringDecoderPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSStringDecoderPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSStringDecoderPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

class JSStringDecoderConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static JSStringDecoderConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSStringDecoderPrototype* prototype);

    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr bool needsDestruction = false;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    void initializeProperties(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSStringDecoderPrototype* prototype);

    // Must be defined for each specialization class.
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
    DECLARE_EXPORT_INFO;

private:
    JSStringDecoderConstructor(JSC::VM& vm, JSC::Structure* structure, JSC::NativeFunction nativeFunction)
        : Base(vm, structure, nativeFunction, nativeFunction)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject* globalObject, JSStringDecoderPrototype* prototype);
};

}
