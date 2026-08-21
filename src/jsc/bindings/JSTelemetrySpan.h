#pragma once
#include "root.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>

namespace Zig {
class GlobalObject;
}

namespace Bun {
using namespace JSC;

// Mirrors bun_telemetry::SpanStub (#[repr(C)]).
struct SpanStub {
    uint8_t traceId[16];
    uint8_t spanId[8];
    uint8_t flags;
    uint8_t parentSpanId[8];
    uint64_t startNs;

    static constexpr uint8_t Sampled = 0x01;
    static constexpr uint8_t Remote = 0x10;
    static constexpr uint8_t NonRecording = 0x40;
    bool isRecording() const { return startNs != 0 && (flags & (Sampled | NonRecording)) == Sampled; }
};
static_assert(sizeof(SpanStub) == 48);

// A span. Identity and timing are plain members; everything JS builtins touch
// on the hot path is an internal field so `setAttribute` & co. are a couple of
// @getInternalField/@putInternalField ops with no native call.
//
// Two flavours share the class:
//  - JS-owned (tracer.startSpan): name/attributes live in the fields and are
//    encoded once, natively, at end().
//  - native-owned (Bun.serve request spans, …): `m_native` is a
//    bun_telemetry::pool handle; the slot holds name/attributes and the owning
//    integration ends it. JS mutators forward to the slot.
class JSTelemetrySpan final : public JSC::JSInternalFieldObjectImpl<6> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<6>;
    static constexpr JSC::JSType Type = static_cast<JSC::JSType>(JSC::BunTelemetrySpanType);

    enum class Field : uint32_t {
        // int32: bit0 recording, bit1 ended, bit2 native-owned, bits 8.. dropped attribute count
        State = 0,
        // null | JSArray [key0, value0, key1, value1, ...]
        Attributes,
        // JSString (JS-owned) | null (native-owned; name is in the slot)
        Name,
        // null | { events, links, status, statusMessage, traceState, baggage }
        Extra,
        // async-context slot value displaced by enter(); empty when not entered
        Restore,
        // cached spanContext() object
        Context,
    };
    static constexpr unsigned numberOfInternalFields = 6;
    static constexpr int32_t StateRecording = 1;
    static constexpr int32_t StateEnded = 2;
    static constexpr int32_t StateNative = 4;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static Structure* createStructure(VM&, JSGlobalObject*);
    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    static JSTelemetrySpan* create(VM&, Zig::GlobalObject*, const SpanStub&, uint16_t scope, uint8_t kind, JSValue name, uint64_t nativeHandle);

    WriteBarrier<Unknown>& field(Field f) { return internalField(static_cast<unsigned>(f)); }
    JSValue get(Field f) const { return internalField(static_cast<unsigned>(f)).get(); }
    int32_t state() const { return get(Field::State).asInt32(); }
    void setState(VM& vm, int32_t s) { field(Field::State).setWithoutWriteBarrier(jsNumber(s)); }
    bool isRecording() const { return state() & StateRecording; }
    bool ended() const { return state() & StateEnded; }
    bool isNativeOwned() const { return m_native != 0; }

    SpanStub m_stub;
    uint64_t m_native { 0 };
    uint64_t m_endNs { 0 };
    uint16_t m_scope { 0 };
    uint8_t m_kind { 0 };

private:
    JSTelemetrySpan(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(VM&, const SpanStub&, uint16_t scope, uint8_t kind, JSValue name, uint64_t nativeHandle);
};

JSTelemetrySpan* toTelemetrySpan(JSValue);

JSC::JSObject* createTelemetrySpanPrototype(VM&, Zig::GlobalObject*);

} // namespace Bun
