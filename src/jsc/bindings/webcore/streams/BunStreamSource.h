// BunStreamSource.h — JSNativeStreamSourceAdapter, the C++ port of the old
// NativeReadableStreamSource JS class. Its .cpp also owns materializeNativeSource and the
// SourceKind::Native pull/cancel/start algorithm arms.
//
// Internal cell: no prototype, no constructor, never exposed to JS.
#pragma once

#include "root.h"
#include "StreamsForward.h"

#include "JSReadableStreamDefaultController.h"
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>

namespace WebCore {

class JSNativeStreamSourceAdapter final : public JSC::JSInternalFieldObjectImpl<5> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<5>;
    static constexpr unsigned StructureFlags = Base::StructureFlags;
    static constexpr JSC::DestructionMode needsDestruction = JSC::DoesNotNeedDestruction;

    enum class Field : uint32_t {
        // JS{Blob,File,Bytes}InternalReadableStreamSource; cleared on every terminal path.
        Handle = 0,
        // `$data`: the unfilled tail Uint8Array reused across pulls.
        PendingView,
        // `#closer`: a per-instance length-1 JSArray the native pull writes EOF into (#29787).
        Closer,
        // handle.start()/drain() result, enqueued by the Native startAlgorithm then cleared.
        DrainValue,
        // Visited (roots the consumer graph while the adapter is a queued reaction
        // context); cleared on every terminal path.
        Controller,
    };

    static std::array<JSC::JSValue, numberOfInternalFields> initialValues()
    {
        return { { JSC::jsUndefined(), JSC::jsUndefined(), JSC::jsUndefined(), JSC::jsUndefined(), JSC::jsUndefined() } };
    }

    static JSNativeStreamSourceAdapter* create(JSC::VM&, JSC::Structure*);
    static JSC::Structure* createStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype);

    static size_t allocationSize(Checked<size_t> inlineCapacity)
    {
        ASSERT_UNUSED(inlineCapacity, inlineCapacity == 0U);
        return sizeof(JSNativeStreamSourceAdapter);
    }

    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;

    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return subspaceForImpl(vm);
    }
    static JSC::GCClient::IsoSubspace* subspaceForImpl(JSC::VM&);

    const JSC::WriteBarrier<JSC::Unknown>& internalField(Field field) const { return Base::internalField(static_cast<uint32_t>(field)); }
    JSC::WriteBarrier<JSC::Unknown>& internalField(Field field) { return Base::internalField(static_cast<uint32_t>(field)); }

    JSC::JSObject* handle() const { return internalField(Field::Handle).get().getObject(); }
    JSC::JSObject* pendingView() const { return internalField(Field::PendingView).get().getObject(); }
    JSC::JSObject* closer() const { return internalField(Field::Closer).get().getObject(); }
    JSC::JSValue drainValue() const { return internalField(Field::DrainValue).get(); }
    JSReadableStreamDefaultController* controller() const { return dynamicDowncast<JSReadableStreamDefaultController>(internalField(Field::Controller).get()); }

    void setHandle(JSC::VM& vm, JSC::JSValue v) { internalField(Field::Handle).set(vm, this, v); }
    void setPendingView(JSC::VM& vm, JSC::JSValue v) { internalField(Field::PendingView).set(vm, this, v); }
    void setCloser(JSC::VM& vm, JSC::JSValue v) { internalField(Field::Closer).set(vm, this, v); }
    void setDrainValue(JSC::VM& vm, JSC::JSValue v) { internalField(Field::DrainValue).set(vm, this, v); }
    void setController(JSC::VM& vm, JSReadableStreamDefaultController* c) { internalField(Field::Controller).set(vm, this, c); }

    void clearHandle(JSC::VM& vm) { internalField(Field::Handle).set(vm, this, JSC::jsUndefined()); }
    void clearPendingView(JSC::VM& vm) { internalField(Field::PendingView).set(vm, this, JSC::jsUndefined()); }
    void clearDrainValue(JSC::VM& vm) { internalField(Field::DrainValue).set(vm, this, JSC::jsUndefined()); }
    void clearController(JSC::VM& vm) { internalField(Field::Controller).set(vm, this, JSC::jsUndefined()); }

    // adaptive chunk size (256 KiB default, doubled once up to 2 MiB).
    size_t m_chunkSize { 0 };
    // #hasResized — the one-shot chunk-size adaptation already happened.
    bool m_hasResized : 1 { false };
    // #closed
    bool m_closed : 1 { false };
    // Body.textStream(): each pulled byte span is UTF-8-decoded before enqueue.
    bool m_textMode : 1 { false };
    Bun::WebStreams::StreamingUTF8DecodeState m_textState;

private:
    JSNativeStreamSourceAdapter(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&);
};

} // namespace WebCore
