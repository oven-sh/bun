#pragma once
#include "root.h"
#include "JSDOMWrapper.h"
#include "TelemetryABI.h"
#include <JavaScriptCore/JSInternalFieldObjectImpl.h>

namespace Bun {
using namespace JSC;

// A span. Identity and timing are plain members; everything JS builtins touch
// is an internal field so `setAttribute` & co. are a couple of
// @getInternalField/@putInternalField ops with no native call
// (src/js/builtins/TelemetrySpan.ts mirrors Field and State as const enums).
//
// Two flavours share the class (one named constructor each):
//  - JS-owned (createOwned: tracer.startSpan, Bun.otel.span, context carriers):
//    everything lives in the fields and is handed to Rust once, at end().
//  - native-owned (createNative: Bun.serve request spans, …): `m_native` is a
//    live bun_telemetry::pool handle; name/attributes/events live in that
//    slot, JS mutators forward to it and the owning integration ends it.
class JSTelemetrySpan final : public JSC::JSInternalFieldObjectImpl<12> {
public:
    using Base = JSC::JSInternalFieldObjectImpl<12>;
    // A type byte of its own in the embedder range (JSDOMWrapper.h), so the
    // builtins' `$isTelemetrySpan` brand check before `@getInternalField` is
    // one exact type compare.
    static constexpr JSC::JSType Type = static_cast<JSC::JSType>(WebCore::JSTelemetrySpanType);

    enum class Field : unsigned {
        // int32 of State bits
        State = 0,
        // null | JSArray [key0, value0, key1, value1, …]; keys are unique strings
        Attributes = 1,
        // JSString (JS-owned) | null (native-owned: the slot has it)
        Name = 2,
        // null | JSArray [name, time (TimeInput | epoch ms), flatAttributes | null, …]
        Events = 3,
        // null | JSArray [traceIdHex, spanIdHex, traceFlags, flatAttributes | null, traceState, …] (stride 5)
        Links = 4,
        // int32 @opentelemetry/api SpanStatusCode (UNSET 0, OK 1, ERROR 2)
        StatusCode = 5,
        // null | JSString
        StatusMessage = 6,
        // null | resolved JSString: W3C `tracestate` header inherited from the parent
        TraceState = 7,
        // null | resolved JSString: W3C `baggage` header inherited from the parent
        Baggage = 8,
        // async-context slot value displaced by enter(); empty when not entered
        Restore = 9,
        // cached spanContext() object; empty until asked for
        Context = 10,
        // null | JSMap key → index into Attributes, once Attributes is long (kAttributeIndexFrom)
        AttributeIndex = 11,
    };
    static_assert(static_cast<unsigned>(Field::AttributeIndex) + 1 == numberOfInternalFields);

    enum State : int32_t {
        Recording = 1,
        Ended = 2,
        Native = 4,
    };

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm);
    static Structure* createStructure(VM&, JSGlobalObject*);
    DECLARE_EXPORT_INFO;
    DECLARE_VISIT_CHILDREN;

    // `kind` is the @opentelemetry/api SpanKind. `name` is required (may be the empty string).
    static JSTelemetrySpan* createOwned(VM&, Zig::GlobalObject*, const TelemetrySpanStub&, uint16_t scope, uint8_t kind, JSString* name);
    // `handle` must be live (non-zero); Field::Name stays null (the slot has the name).
    static JSTelemetrySpan* createNative(VM&, Zig::GlobalObject*, const TelemetrySpanStub&, uint16_t scope, uint8_t kind, TelemetryNativeHandle);

    WriteBarrier<Unknown>& field(Field f) { return internalField(static_cast<unsigned>(f)); }
    JSValue get(Field f) const { return internalField(static_cast<unsigned>(f)).get(); }
    // Fields that hold `null | JSString`.
    JSString* string(Field f) const
    {
        JSValue v = get(f);
        return v.isString() ? asString(v) : nullptr;
    }
    int32_t state() const { return get(Field::State).asInt32(); }
    void setState(int32_t s) { field(Field::State).setWithoutWriteBarrier(jsNumber(s)); }
    bool isRecording() const { return state() & Recording; }
    bool ended() const { return state() & Ended; }
    // This span's own stub, for use as a parent: null for a pooled (request)
    // span that has ended — its slot and ids may be reused at any moment.
    const TelemetrySpanStub* stubAsParent() const { return m_native && ended() ? nullptr : &m_stub; }

    TelemetrySpanStub m_stub;
    TelemetryNativeHandle m_native {};
    uint16_t m_scope { 0 };
    uint8_t m_kind { 0 };

private:
    JSTelemetrySpan(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(VM&, const TelemetrySpanStub&, uint16_t scope, uint8_t kind, JSString* nameOrNull, TelemetryNativeHandle);
};

inline JSTelemetrySpan* toTelemetrySpan(JSValue v)
{
    if (!v || !v.isCell() || v.asCell()->type() != JSTelemetrySpan::Type)
        return nullptr;
    return uncheckedDowncast<JSTelemetrySpan>(v.asCell());
}

JSC::JSObject* createTelemetrySpanPrototype(VM&, Zig::GlobalObject*);

// Private globals for src/js/builtins/TelemetrySpan.ts (native-owned span mutators).
JSC_DECLARE_HOST_FUNCTION(jsIsTelemetrySpan);
JSC_DECLARE_HOST_FUNCTION(jsTelemetrySpanEndPrivate);
JSC_DECLARE_HOST_FUNCTION(jsTelemetrySpanFailNoJSPrivate);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryReportUnhandledPrivate);
JSC_DECLARE_HOST_FUNCTION(jsTelemetrySetAttribute);
JSC_DECLARE_HOST_FUNCTION(jsTelemetrySetAttributes);
JSC_DECLARE_HOST_FUNCTION(jsTelemetrySetName);
JSC_DECLARE_HOST_FUNCTION(jsTelemetrySetStatus);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryAddEvent);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryAddLink);

} // namespace Bun
