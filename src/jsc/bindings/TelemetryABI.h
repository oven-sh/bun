// C++ mirror of the #[repr(C)] types shared with src/runtime/telemetry/span.rs
// (and bun_telemetry::SpanStub). Both sides assert size and every field
// offset; change one, change the other.
#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include <cstddef>
#include <cstring>

namespace JSC {
class JSGlobalObject;
}
namespace Zig {
class GlobalObject;
}

namespace Bun {

// bun_telemetry::SpanStub — identity + start time of a span.
struct TelemetrySpanStub {
    uint8_t traceId[16];
    uint8_t spanId[8];
    uint8_t flags;
    uint8_t parentSpanId[8];
    uint64_t startNs;

    // Complete list; owned by bun_telemetry::span::Flags.
    static constexpr uint8_t W3CMask = 0x0f;
    static constexpr uint8_t Sampled = 0x01;
    static constexpr uint8_t Remote = 0x10;
    static constexpr uint8_t ParentRemote = 0x20;
    static constexpr uint8_t NonRecording = 0x40;
    // The api's SUPPRESS_TRACING context: no span (root or child) starts under it.
    static constexpr uint8_t Suppressed = 0x80;
    bool isRecording() const { return startNs != 0 && (flags & (Sampled | NonRecording)) == Sampled; }
    // Mirrors Rust TraceId::is_valid / SpanId::is_valid: all-zero ids are invalid (W3C).
    bool hasTraceId() const { return !isAllZero(traceId); }
    bool hasParent() const { return !isAllZero(parentSpanId); }

private:
    template<size_t N> static bool isAllZero(const uint8_t (&id)[N])
    {
        static constexpr uint8_t zero[N] = {};
        return !memcmp(id, zero, N);
    }
};
static_assert(sizeof(TelemetrySpanStub) == 48);
static_assert(offsetof(TelemetrySpanStub, traceId) == 0);
static_assert(offsetof(TelemetrySpanStub, spanId) == 16);
static_assert(offsetof(TelemetrySpanStub, flags) == 24);
static_assert(offsetof(TelemetrySpanStub, parentSpanId) == 25);
static_assert(offsetof(TelemetrySpanStub, startNs) == 40);

// bun_telemetry::propagation::TRACEPARENT_LEN
static constexpr size_t kTraceparentLength = 55;

// Which W3C propagators are on (OTEL_PROPAGATORS). Mirrors span.rs `Propagators`.
struct TelemetryPropagators {
    bool traceContext;
    bool baggage;
};
static_assert(sizeof(TelemetryPropagators) == 2);

// What the active @opentelemetry/api Context says about baggage
// (TelemetryContext.cpp). Mirrors span.rs `BaggageOverride`.
enum class TelemetryBaggageOverride : uint8_t {
    Inherit = 0, // the Context says nothing: use what the span inherited from the request
    Masked = 1, // the Context deleted/emptied its Baggage: send none
    Header = 2, // the Context carries Baggage: *outHeader holds its W3C header (+1 ref)
};

enum class TelemetryAttrKind : uint8_t {
    String = 0,
    Bool = 1,
    Int = 2,
    Double = 3,
    Array = 4,
};

// `items[start .. start + length]` of a TelemetryAttrPool (`arrayItems` when
// used as an attribute value, `items` everywhere else).
struct TelemetryAttrSlice {
    uint32_t start;
    uint32_t length;
};
static_assert(sizeof(TelemetryAttrSlice) == 8);

// One attribute. Strings are borrowed (not ref'd) from JSStrings the span
// keeps alive; nothing may run JS or drop those cells while a ref exists.
struct TelemetryAttrRef {
    // Not `= default`: Vector::grow must not zero-fill.
    TelemetryAttrRef() {}
    BunString key;
    TelemetryAttrKind kind;
    union {
        BunString string;
        int64_t integer; // also Bool (0/1)
        double number;
        TelemetryAttrSlice array;
    } value;
};
static_assert(sizeof(BunString) == 24);
static_assert(sizeof(TelemetryAttrRef) == 56);
static_assert(offsetof(TelemetryAttrRef, key) == 0);
static_assert(offsetof(TelemetryAttrRef, kind) == 24);
static_assert(offsetof(TelemetryAttrRef, value) == 32);

struct TelemetryAttrPool {
    const TelemetryAttrRef* items;
    const TelemetryAttrRef* arrayItems;
    uint32_t nItems;
    uint32_t nArrayItems;
};
static_assert(sizeof(TelemetryAttrPool) == 24);
static_assert(offsetof(TelemetryAttrPool, items) == 0);
static_assert(offsetof(TelemetryAttrPool, arrayItems) == 8);
static_assert(offsetof(TelemetryAttrPool, nItems) == 16);
static_assert(offsetof(TelemetryAttrPool, nArrayItems) == 20);

struct TelemetryEventRef {
    BunString name;
    // 0 = not given.
    uint64_t timeNs;
    TelemetryAttrSlice attrs;
};
static_assert(sizeof(TelemetryEventRef) == 40);
static_assert(offsetof(TelemetryEventRef, name) == 0);
static_assert(offsetof(TelemetryEventRef, timeNs) == 24);
static_assert(offsetof(TelemetryEventRef, attrs) == 32);

struct TelemetryLinkRef {
    BunString traceId; // hex
    BunString spanId; // hex
    BunString traceState; // W3C header form, may be Empty
    TelemetryAttrSlice attrs;
    uint8_t traceFlags;
};
static_assert(sizeof(TelemetryLinkRef) == 88);
static_assert(offsetof(TelemetryLinkRef, traceId) == 0);
static_assert(offsetof(TelemetryLinkRef, spanId) == 24);
static_assert(offsetof(TelemetryLinkRef, traceState) == 48);
static_assert(offsetof(TelemetryLinkRef, attrs) == 72);
static_assert(offsetof(TelemetryLinkRef, traceFlags) == 80);

// Everything a JS-owned span has gathered, handed to Rust once at end().
struct TelemetryEndDesc {
    const TelemetrySpanStub* stub;
    // 0 = now.
    uint64_t endNs;
    BunString name;
    BunString statusMessage;
    BunString traceState;
    TelemetryAttrPool pool;
    TelemetryAttrSlice attrs;
    const TelemetryEventRef* events;
    const TelemetryLinkRef* links;
    uint32_t nEvents;
    uint32_t nLinks;
    // Attributes not passed because they exceeded kTelemetryMaxGather.
    uint32_t droppedAttrs;
    uint16_t scope;
    // @opentelemetry/api SpanKind (INTERNAL = 0 … CONSUMER = 4).
    uint8_t kind;
    // @opentelemetry/api SpanStatusCode (UNSET = 0, OK = 1, ERROR = 2).
    uint8_t status;
};
static_assert(sizeof(TelemetryEndDesc) == 152);
static_assert(offsetof(TelemetryEndDesc, stub) == 0);
static_assert(offsetof(TelemetryEndDesc, endNs) == 8);
static_assert(offsetof(TelemetryEndDesc, name) == 16);
static_assert(offsetof(TelemetryEndDesc, statusMessage) == 40);
static_assert(offsetof(TelemetryEndDesc, traceState) == 64);
static_assert(offsetof(TelemetryEndDesc, pool) == 88);
static_assert(offsetof(TelemetryEndDesc, attrs) == 112);
static_assert(offsetof(TelemetryEndDesc, events) == 120);
static_assert(offsetof(TelemetryEndDesc, links) == 128);
static_assert(offsetof(TelemetryEndDesc, nEvents) == 136);
static_assert(offsetof(TelemetryEndDesc, nLinks) == 140);
static_assert(offsetof(TelemetryEndDesc, droppedAttrs) == 144);
static_assert(offsetof(TelemetryEndDesc, scope) == 148);
static_assert(offsetof(TelemetryEndDesc, kind) == 150);
static_assert(offsetof(TelemetryEndDesc, status) == 151);

// Loose per-list cap on what C++ gathers; the configured limits (always
// smaller) are applied in Rust.
static constexpr unsigned kTelemetryMaxGather = 4096;

} // namespace Bun

// ─── implemented in src/runtime/telemetry/span.rs ───

extern "C" {
// bun_telemetry::Instrument::Sqlite.bit()
extern const uint32_t Bun__Telemetry__SQLITE_MASK;
// bun_telemetry::ENABLED (a Rust AtomicU32): read with __atomic_load_n(&Bun__Telemetry__enabled, __ATOMIC_RELAXED).
extern uint32_t Bun__Telemetry__enabled;

void Bun__Telemetry__stubStart(JSC::JSGlobalObject*, Bun::TelemetrySpanStub* out, const Bun::TelemetrySpanStub* parent, uint64_t startNs);
// Non-recording carrier for hex ids: true when both parse; otherwise (false)
// *out is the all-invalid carrier. Always writes *out. `traceId`/`spanId` may be null.
bool Bun__Telemetry__carrierStub(Bun::TelemetrySpanStub* out, const BunString* traceId, const BunString* spanId, uint8_t traceFlags, bool remote);
// The carrier `context.with(suppressTracing(ctx), …)` activates: no span (root or child) starts under it.
void Bun__Telemetry__suppressedStub(Bun::TelemetrySpanStub* out);
// W3C traceparent (bun_telemetry::propagation).
void Bun__Telemetry__formatTraceparent(const Bun::TelemetrySpanStub*, uint8_t (*out)[Bun::kTraceparentLength]);
bool Bun__Telemetry__parseTraceparent(const BunString* header, Bun::TelemetrySpanStub* out);
// Lowercase hex of `bytes[0..n]` into `out[0..2n]` (bun_core::fmt).
void Bun__Telemetry__hexLower(const uint8_t* bytes, size_t n, uint8_t* out);
uint64_t Bun__Telemetry__nowNs();
uint16_t Bun__Telemetry__userScope();
Bun::TelemetryPropagators Bun__Telemetry__propagators();
void Bun__Telemetry__encodeSpan(JSC::JSGlobalObject*, const Bun::TelemetryEndDesc*);

// Native-owned (pooled) spans; `handle` is a bun_telemetry::pool::NativeSpan.
bool Bun__Telemetry__nativeIsLive(JSC::JSGlobalObject*, uint64_t handle);
bool Bun__Telemetry__nativeEnd(JSC::JSGlobalObject*, uint64_t handle, uint64_t endNs);
bool Bun__Telemetry__nativeSetAttributes(JSC::JSGlobalObject*, uint64_t handle, const Bun::TelemetryAttrPool*);
void Bun__Telemetry__nativeSetName(JSC::JSGlobalObject*, uint64_t handle, const BunString*);
void Bun__Telemetry__nativeSetStatus(JSC::JSGlobalObject*, uint64_t handle, uint8_t code, const BunString* message);
void Bun__Telemetry__nativeAddEvent(JSC::JSGlobalObject*, uint64_t handle, const Bun::TelemetryEventRef*, const Bun::TelemetryAttrPool*);
void Bun__Telemetry__nativeAddLink(JSC::JSGlobalObject*, uint64_t handle, const Bun::TelemetryLinkRef*, const Bun::TelemetryAttrPool*);
// Owned (+1) copies; empty when the slot is gone or the value is empty.
BunString Bun__Telemetry__nativeName(JSC::JSGlobalObject*, uint64_t handle);
// False (and both outputs Empty) when the span carries neither.
bool Bun__Telemetry__nativePropagation(JSC::JSGlobalObject*, uint64_t handle, BunString* traceState, BunString* baggage);
// Identity of a live pooled span; false (and *out untouched) once it has ended.
bool Bun__Telemetry__poolStub(JSC::JSGlobalObject*, uint64_t handle, Bun::TelemetrySpanStub* out);
JSC::EncodedJSValue Bun__Telemetry__poolMaterialize(Zig::GlobalObject*, uint64_t handle);
}
