#pragma once

#include "root.h"
#include "BufferEncodingType.h"

namespace WebCore {
using namespace JSC;

class JSStringDecoder : public JSC::JSNonFinalObject {
    using Base = JSC::JSNonFinalObject;

public:
    JSStringDecoder(JSC::VM& vm, JSC::Structure* structure, BufferEncodingType encoding)
        : Base(vm, structure), m_lastNeed(0), m_lastTotal(0), m_encoding(encoding)
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
    static void destroy(JSCell*) {}

    JSC::JSValue write(JSC::VM&, JSC::JSGlobalObject*, JSC::JSUint8Array*);
    JSC::JSValue end(JSC::VM&, JSC::JSGlobalObject*, JSC::JSUint8Array*);

private:
    JSC::JSValue fillLast(JSC::VM&, JSC::JSGlobalObject*, JSC::JSUint8Array*);
    JSC::JSValue text(JSC::VM&, JSC::JSGlobalObject*, JSC::JSUint8Array*, uint32_t);
    uint8_t utf8CheckIncomplete(JSC::JSUint8Array*, uint32_t);

    uint8_t m_lastNeed;
    uint8_t m_lastTotal;
    uint8_t m_lastChar[4];
    BufferEncodingType m_encoding;
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

EncodedJSValue constructJSStringDecoder(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame);

}
