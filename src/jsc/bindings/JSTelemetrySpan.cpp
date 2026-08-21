#include "root.h"

#include "JSTelemetrySpan.h"
#include "BunTelemetry.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include "WebCoreJSBuiltins.h"
#include "InternalModuleRegistry.h"
#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/DOMJITSignature.h>
#include <JavaScriptCore/DFGAbstractHeap.h>
#include <JavaScriptCore/FrameTracers.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSInternalFieldObjectImplInlines.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <wtf/text/StringView.h>

// ─── Rust ABI (src/runtime/telemetry/span.rs) ───

struct BunStrRef {
    const void* ptr;
    uint32_t len;
    uint8_t is16;
};
struct BunAttrRef {
    // Not `= default`: keeps Vector::grow from zero-filling new slots.
    BunAttrRef() { }
    const void* keyPtr;
    uint32_t keyLen;
    uint8_t keyIs16;
    uint8_t kind; // 0 str 1 bool 2 int 3 double 4 array
    union {
        struct {
            const void* ptr;
            uint32_t len;
            uint8_t is16;
        } str;
        double num;
        int64_t integer;
        struct {
            const BunAttrRef* items;
            uint32_t n;
        } array;
    } u;
    void setKey(BunStrRef k)
    {
        keyPtr = k.ptr;
        keyLen = k.len;
        keyIs16 = k.is16;
    }
};
static_assert(sizeof(BunAttrRef) == 32);
struct BunEventRef {
    BunStrRef name;
    uint64_t timeNs;
    const BunAttrRef* attrs;
    uint32_t nAttrs;
};
struct BunLinkRef {
    BunStrRef traceId;
    BunStrRef spanId;
    uint8_t flags;
    const BunAttrRef* attrs;
    uint32_t nAttrs;
};
struct BunEndDesc {
    const Bun::SpanStub* stub;
    uint16_t scope;
    uint8_t kind;
    uint8_t status;
    uint64_t endNs;
    BunStrRef name;
    BunStrRef statusMessage;
    BunStrRef traceState;
    const BunAttrRef* attrs;
    uint32_t nAttrs;
    uint32_t droppedAttrs;
    // `Span.attributes` entries already encoded (ASCII fast path), spliced before `attrs`.
    const uint8_t* encodedAttrs;
    uint32_t encodedAttrsLen;
    uint32_t nEncodedAttrs;
    const BunEventRef* events;
    uint32_t nEvents;
    const BunLinkRef* links;
    uint32_t nLinks;
};

extern "C" void Bun__Telemetry__stubStart(Bun::SpanStub* out, const Bun::SpanStub* parent, uint64_t startNs);
extern "C" void Bun__Telemetry__stubWrap(Bun::SpanStub* out, const uint8_t* traceId, const uint8_t* spanId, uint8_t w3cFlags, bool remote);
extern "C" uint64_t Bun__Telemetry__nowNs();
extern "C" uint16_t Bun__Telemetry__userScope();
extern "C" uint32_t Bun__Telemetry__attributeLimits(uint32_t* valueLengthLimit);
extern "C" uint32_t Bun__Telemetry__propagationFlags();
extern "C" void Bun__Telemetry__encodeSpan(const BunEndDesc*);
extern "C" bool Bun__Telemetry__nativeIsLive(uint64_t);
extern "C" bool Bun__Telemetry__nativeEnd(uint64_t, uint64_t endNs);
extern "C" void Bun__Telemetry__nativeSetAttribute(uint64_t, const BunAttrRef*);
extern "C" void Bun__Telemetry__nativeSetName(uint64_t, const BunStrRef*);
extern "C" void Bun__Telemetry__nativeSetStatus(uint64_t, uint8_t code, const BunStrRef*);
extern "C" void Bun__Telemetry__nativeAddEvent(uint64_t, const BunEventRef*);
extern "C" void Bun__Telemetry__nativeAddLink(uint64_t, const BunLinkRef*);
extern "C" size_t Bun__Telemetry__nativeName(uint64_t, uint8_t* out, size_t cap);
extern "C" size_t Bun__Telemetry__nativePropagation(uint64_t, uint8_t which, uint8_t* out, size_t cap);
extern "C" const Bun::SpanStub* Bun__Telemetry__activeSpanStub(Zig::GlobalObject*);
extern "C" uint64_t Bun__Telemetry__activeNativeHandle(Zig::GlobalObject*);
extern "C" JSC::EncodedJSValue Bun__Telemetry__startInstrumentSpan(Zig::GlobalObject*, uint32_t instrument, const BunStrRef* name, uint8_t kind);

namespace Bun {
using namespace JSC;

// ─── cell ───

const ClassInfo JSTelemetrySpan::s_info = { "Span"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTelemetrySpan) };

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSTelemetrySpan::subspaceFor(VM& vm)
{
    return WebCore::subspaceForImpl<JSTelemetrySpan, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSTelemetrySpan, m_subspaceForJSTelemetrySpan));
}

Structure* JSTelemetrySpan::createStructure(VM& vm, JSGlobalObject* globalObject)
{
    auto* zig = defaultGlobalObject(globalObject);
    return Structure::create(vm, globalObject, createTelemetrySpanPrototype(vm, zig), TypeInfo(Type, StructureFlags), info());
}

JSTelemetrySpan* JSTelemetrySpan::create(VM& vm, Zig::GlobalObject* globalObject, const SpanStub& stub, uint16_t scope, uint8_t kind, JSValue name, uint64_t nativeHandle)
{
    Structure* structure = globalObject->JSTelemetrySpanStructure();
    auto* cell = new (NotNull, allocateCell<JSTelemetrySpan>(vm)) JSTelemetrySpan(vm, structure);
    cell->finishCreation(vm, stub, scope, kind, name, nativeHandle);
    return cell;
}

void JSTelemetrySpan::finishCreation(VM& vm, const SpanStub& stub, uint16_t scope, uint8_t kind, JSValue name, uint64_t nativeHandle)
{
    Base::finishCreation(vm);
    m_stub = stub;
    m_native = nativeHandle;
    m_scope = scope;
    m_kind = kind;
    int32_t state = (stub.isRecording() ? StateRecording : 0) | (nativeHandle ? StateNative : 0);
    internalField(static_cast<unsigned>(Field::State)).setWithoutWriteBarrier(jsNumber(state));
    internalField(static_cast<unsigned>(Field::Attributes)).setWithoutWriteBarrier(jsNull());
    internalField(static_cast<unsigned>(Field::Name)).set(vm, this, name);
    internalField(static_cast<unsigned>(Field::Extra)).setWithoutWriteBarrier(jsNull());
    internalField(static_cast<unsigned>(Field::Restore)).setWithoutWriteBarrier(JSValue());
    internalField(static_cast<unsigned>(Field::Context)).setWithoutWriteBarrier(JSValue());
}

template<typename Visitor>
void JSTelemetrySpan::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSTelemetrySpan>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
}
DEFINE_VISIT_CHILDREN(JSTelemetrySpan);

JSTelemetrySpan* toTelemetrySpan(JSValue v)
{
    if (!v || !v.isCell() || v.asCell()->type() != JSTelemetrySpan::Type)
        return nullptr;
    return uncheckedDowncast<JSTelemetrySpan>(v.asCell());
}

// ─── helpers ───

static inline BunStrRef strRef(const StringImpl* s)
{
    if (!s || !s->length())
        return { nullptr, 0, 0 };
    if (s->is8Bit())
        return { s->span8().data(), s->length(), 0 };
    return { s->span16().data(), s->length(), 1 };
}

static inline BunStrRef strRef(const String& s)
{
    return strRef(s.impl());
}

// The resolved StringImpl of a JSString, owned by the (live) JSString.
static inline const StringImpl* implOf(JSGlobalObject* globalObject, JSString* str)
{
    if (const StringImpl* impl = str->tryGetValueImpl())
        return impl;
    return str->value(globalObject).data.impl();
}

static const char hexDigits[] = "0123456789abcdef";

static JSString* hexString(VM& vm, const uint8_t* bytes, size_t n)
{
    std::span<Latin1Character> buf;
    auto s = String::createUninitialized(n * 2, buf);
    for (size_t i = 0; i < n; ++i) {
        buf[i * 2] = hexDigits[bytes[i] >> 4];
        buf[i * 2 + 1] = hexDigits[bytes[i] & 15];
    }
    return jsString(vm, WTF::move(s));
}

static bool parseHex(StringView s, uint8_t* out, size_t n)
{
    if (s.length() != n * 2)
        return false;
    bool anySet = false;
    for (size_t i = 0; i < n; ++i) {
        auto hi = s[i * 2], lo = s[i * 2 + 1];
        auto val = [](UChar c) -> int { if (c >= '0' && c <= '9') return c - '0'; if (c >= 'a' && c <= 'f') return c - 'a' + 10; if (c >= 'A' && c <= 'F') return c - 'A' + 10; return -1; };
        int h = val(hi), l = val(lo);
        if (h < 0 || l < 0)
            return false;
        out[i] = static_cast<uint8_t>((h << 4) | l);
        anySet |= out[i] != 0;
    }
    return anySet;
}

// OTel-API `TimeInput` (epoch-ms number, Date, or [sec, ns]) → epoch ns; 0 = now / invalid.
static uint64_t timeInputToNs(JSGlobalObject* globalObject, JSValue v)
{
    if (v.isNumber()) {
        double ms = v.asNumber();
        return ms > 0 ? static_cast<uint64_t>(ms * 1e6) : 0;
    }
    if (!v.isCell())
        return 0;
    if (auto* date = dynamicDowncast<DateInstance>(v.asCell())) {
        double ms = date->internalNumber();
        return ms > 0 ? static_cast<uint64_t>(ms * 1e6) : 0;
    }
    if (auto* arr = dynamicDowncast<JSArray>(v.asCell())) {
        if (arr->length() >= 2) {
            JSValue s = arr->getIndexQuickly(0), n = arr->getIndexQuickly(1);
            if (s.isNumber() && n.isNumber())
                return static_cast<uint64_t>(s.asNumber()) * 1000000000ull + static_cast<uint64_t>(n.asNumber());
        }
    }
    (void)globalObject;
    return 0;
}

// Attribute gathering. Strings referenced by BunAttrRef must stay alive until
// the Rust call returns; `keep` owns resolved rope/number strings.
struct AttrScratch {
    Vector<BunAttrRef, 8> arrayItems;
    // Owned strings (BigInt → decimal) that BunAttrRefs point into.
    Vector<String, 2> keep;
};

static bool fillValue(JSGlobalObject* globalObject, AttrScratch& sc, BunAttrRef& out, JSValue v, bool allowArray)
{
    if (v.isString()) {
        const StringImpl* impl = implOf(globalObject, asString(v));
        out.kind = 0;
        out.u.str.ptr = impl->is8Bit() ? static_cast<const void*>(impl->span8().data()) : static_cast<const void*>(impl->span16().data());
        out.u.str.len = impl->length();
        out.u.str.is16 = !impl->is8Bit();
        return true;
    }
    if (v.isInt32()) {
        out.kind = 2;
        out.u.integer = v.asInt32();
        return true;
    }
    if (v.isNumber()) {
        double d = v.asNumber();
        if (std::isfinite(d) && std::trunc(d) == d && std::abs(d) < 9007199254740992.0) {
            out.kind = 2;
            out.u.integer = static_cast<int64_t>(d);
        } else {
            out.kind = 3;
            out.u.num = d;
        }
        return true;
    }
    if (v.isBoolean()) {
        out.kind = 1;
        out.u.integer = v.asBoolean();
        return true;
    }
    if (v.isBigInt()) {
#if USE(BIGINT32)
        if (v.isBigInt32()) {
            out.kind = 2;
            out.u.integer = v.bigInt32AsInt32();
            return true;
        }
#endif
        auto* big = v.asHeapBigInt();
        if (big->length() <= 1) {
            out.kind = 2;
            out.u.integer = JSBigInt::toBigInt64(big);
            return true;
        }
        sc.keep.append(big->toString(globalObject, 10));
        BunStrRef r = strRef(sc.keep.last());
        out.kind = 0;
        out.u.str.ptr = r.ptr;
        out.u.str.len = r.len;
        out.u.str.is16 = r.is16;
        return true;
    }
    if (allowArray && v.isCell()) {
        if (auto* arr = dynamicDowncast<JSArray>(v.asCell())) {
            unsigned n = std::min<unsigned>(arr->length(), 1024);
            size_t start = sc.arrayItems.size();
            // Reserve up front: `out.items` points into this vector.
            sc.arrayItems.grow(start + n);
            unsigned w = 0;
            for (unsigned i = 0; i < n; ++i) {
                JSValue item = arr->getIndex(globalObject, i);
                BunAttrRef ref;
                if (item && fillValue(globalObject, sc, ref, item, false))
                    sc.arrayItems[start + w++] = ref;
            }
            sc.arrayItems.shrink(start + w);
            out.kind = 4;
            // Index for now; patchArrays() turns it into a pointer once the
            // vector can no longer move.
            out.u.array.items = reinterpret_cast<const BunAttrRef*>(start);
            out.u.array.n = w;
            return true;
        }
    }
    return false;
}

static ALWAYS_INLINE bool equalSmall(const void* a, const void* b, size_t n)
{
    if (n <= 16) {
        auto* x = static_cast<const uint8_t*>(a);
        auto* y = static_cast<const uint8_t*>(b);
        for (size_t i = 0; i < n; ++i) {
            if (x[i] != y[i])
                return false;
        }
        return true;
    }
    return !memcmp(a, b, n);
}

// Gather [k0, v0, k1, v1, ...] with last-write-wins on duplicate keys.
static void gatherAttrs(JSGlobalObject* globalObject, AttrScratch& sc, JSArray* flat, Vector<BunAttrRef, 16>& out)
{
    unsigned n = flat->length() & ~1u;
    if (!n)
        return;
    IndexingType type = flat->indexingType() & IndexingShapeMask;
    bool contiguous = type == ContiguousShape || type == Int32Shape;
    for (unsigned i = 0; i < n; i += 2) {
        JSValue k, v;
        if (contiguous) [[likely]] {
            k = flat->butterfly()->contiguous().at(flat, i).get();
            v = flat->butterfly()->contiguous().at(flat, i + 1).get();
        } else {
            k = flat->getIndex(globalObject, i);
            v = flat->getIndex(globalObject, i + 1);
        }
        if (!k || !k.isString() || !v || v.isUndefinedOrNull())
            continue;
        const StringImpl* key = implOf(globalObject, asString(k));
        BunStrRef keyRef = strRef(key);
        // Later duplicate wins but keeps the key's original position (so the
        // attribute-count limit drops the right ones).
        BunAttrRef* slot = nullptr;
        for (auto& e : out) {
            if (e.keyLen != keyRef.len || e.keyIs16 != keyRef.is16)
                continue;
            if (e.keyPtr == keyRef.ptr || equalSmall(e.keyPtr, keyRef.ptr, keyRef.is16 ? keyRef.len * 2 : keyRef.len)) {
                slot = &e;
                break;
            }
        }
        bool appended = !slot;
        if (appended) {
            out.grow(out.size() + 1);
            slot = &out.last();
        }
        if (!fillValue(globalObject, sc, *slot, v, true)) {
            if (appended)
                out.shrink(out.size() - 1);
            continue;
        }
        slot->setKey(keyRef);
    }
}

// Small copies without a libc call: keys/values here are a handful of bytes.
static ALWAYS_INLINE void copySmall(uint8_t* dst, const uint8_t* src, size_t n)
{
    if (n <= 16) {
        if (n >= 8) {
            uint64_t a, b;
            memcpy(&a, src, 8);
            memcpy(&b, src + n - 8, 8);
            memcpy(dst, &a, 8);
            memcpy(dst + n - 8, &b, 8);
        } else if (n >= 4) {
            uint32_t a, b;
            memcpy(&a, src, 4);
            memcpy(&b, src + n - 4, 4);
            memcpy(dst, &a, 4);
            memcpy(dst + n - 4, &b, 4);
        } else if (n) {
            dst[0] = src[0];
            dst[n / 2] = src[n / 2];
            dst[n - 1] = src[n - 1];
        }
        return;
    }
    memcpy(dst, src, n);
}

static ALWAYS_INLINE bool isShortASCII(const StringImpl* s, unsigned max)
{
    if (!s->is8Bit() || s->length() > max)
        return false;
    // Keys/values are short; a byte loop beats dispatching to SIMD.
    Latin1Character bits = 0;
    for (auto c : s->span8())
        bits |= c;
    return !(bits & 0x80);
}

// OTLP protobuf field tags (opentelemetry/proto/trace/v1/trace.proto).
static constexpr uint8_t kTagSpanAttributes = (9 << 3) | 2;
static constexpr uint8_t kTagKvKey = (1 << 3) | 2;
static constexpr uint8_t kTagKvValue = (2 << 3) | 2;
static constexpr uint8_t kTagAvString = (1 << 3) | 2;
static constexpr uint8_t kTagAvBool = (2 << 3) | 0;
static constexpr uint8_t kTagAvInt = (3 << 3) | 0;
static constexpr uint8_t kTagAvDouble = (4 << 3) | 1;

// Encodes `key: value` as a `Span.attributes` KeyValue if everything fits in
// one-byte varints and needs no transcoding; returns false to take the
// general path. `out` must have 4 + 100 + 2 + 2 + 100 bytes of headroom.
static ALWAYS_INLINE bool encodeAttrFast(uint8_t*& out, const StringImpl* key, JSValue v)
{
    if (!isShortASCII(key, 96) || !key->length())
        return false;
    unsigned klen = key->length();
    uint8_t body[12];
    unsigned bodyLen;
    const StringImpl* sv = nullptr;
    if (v.isString()) {
        sv = asString(v)->tryGetValueImpl();
        if (!sv || !isShortASCII(sv, 96))
            return false;
        body[0] = kTagAvString;
        body[1] = static_cast<uint8_t>(sv->length());
        bodyLen = 2;
    } else if (v.isInt32() && v.asInt32() >= 0) {
        // varint of a non-negative int32: up to 5 bytes
        uint32_t x = static_cast<uint32_t>(v.asInt32());
        body[0] = kTagAvInt;
        bodyLen = 1;
        while (x > 0x7f) {
            body[bodyLen++] = static_cast<uint8_t>(x) | 0x80;
            x >>= 7;
        }
        body[bodyLen++] = static_cast<uint8_t>(x);
    } else if (v.isBoolean()) {
        body[0] = kTagAvBool;
        body[1] = v.asBoolean();
        bodyLen = 2;
    } else if (v.isDouble()) {
        double d = v.asDouble();
        if (std::isfinite(d) && std::trunc(d) == d && std::abs(d) < 9007199254740992.0)
            return false; // integral doubles are ints on the wire; general path
        body[0] = kTagAvDouble;
        memcpy(body + 1, &d, 8);
        bodyLen = 9;
    } else
        return false;
    unsigned avLen = bodyLen + (sv ? sv->length() : 0);
    unsigned kvLen = 2 + klen + 2 + avLen;
    if (kvLen > 0x7f)
        return false;
    uint8_t* p = out;
    p[0] = kTagSpanAttributes;
    p[1] = static_cast<uint8_t>(kvLen);
    p[2] = kTagKvKey;
    p[3] = static_cast<uint8_t>(klen);
    p += 4;
    copySmall(p, key->span8().data(), klen);
    p += klen;
    p[0] = kTagKvValue;
    p[1] = static_cast<uint8_t>(avLen);
    p += 2;
    memcpy(p, body, 12);
    p += bodyLen;
    if (sv) {
        copySmall(p, sv->span8().data(), sv->length());
        p += sv->length();
    }
    out = p;
    return true;
}

struct EncodedAttrs {
    Vector<uint8_t, 1024> bytes;
    unsigned count { 0 };
    // (key impl, offset, length) of each encoded entry, for last-write-wins.
    struct Entry {
        const StringImpl* key;
        uint32_t offset;
        uint32_t length;
    };
    Vector<Entry, 16> entries;
};

// Gather [k0, v0, k1, v1, ...]: ASCII/small entries are encoded directly into
// `enc`; anything else lands in `out` for the Rust encoder. `limit` is the
// attribute-count limit; returns the number dropped by it.
static unsigned gatherAttrsFast(JSGlobalObject* globalObject, AttrScratch& sc, JSArray* flat, EncodedAttrs& enc, Vector<BunAttrRef, 16>& out, unsigned limit)
{
    unsigned n = flat->length() & ~1u;
    if (!n)
        return 0;
    unsigned dropped = 0;
    IndexingType type = flat->indexingType() & IndexingShapeMask;
    bool contiguous = type == ContiguousShape || type == Int32Shape;
    enc.bytes.grow(std::min<size_t>(n / 2, limit) * 208 + 16);
    uint8_t* w = enc.bytes.begin();
    for (unsigned i = 0; i < n; i += 2) {
        JSValue k, v;
        if (contiguous) [[likely]] {
            k = flat->butterfly()->contiguous().at(flat, i).get();
            v = flat->butterfly()->contiguous().at(flat, i + 1).get();
        } else {
            k = flat->getIndex(globalObject, i);
            v = flat->getIndex(globalObject, i + 1);
        }
        if (!k || !k.isString() || !v || v.isUndefinedOrNull())
            continue;
        const StringImpl* key = implOf(globalObject, asString(k));
        // Duplicate key: drop the earlier encoding / ref (rare).
        for (unsigned j = 0; j < enc.entries.size(); ++j) {
            auto& e = enc.entries[j];
            if (e.key == key || (e.key->length() == key->length() && WTF::equal(e.key, key))) {
                size_t tail = (w - enc.bytes.begin()) - (e.offset + e.length);
                memmove(enc.bytes.begin() + e.offset, enc.bytes.begin() + e.offset + e.length, tail);
                w -= e.length;
                for (unsigned m = j + 1; m < enc.entries.size(); ++m)
                    enc.entries[m].offset -= e.length;
                enc.entries.removeAt(j);
                enc.count--;
                break;
            }
        }
        for (unsigned j = 0; j < out.size(); ++j) {
            auto& e = out[j];
            if (e.keyLen == key->length() && equalSmall(e.keyPtr, key->is8Bit() ? static_cast<const void*>(key->span8().data()) : static_cast<const void*>(key->span16().data()), key->is8Bit() ? key->length() : key->length() * 2)) {
                out.removeAt(j);
                break;
            }
        }
        if (enc.count + out.size() >= limit) {
            dropped++;
            continue;
        }
        uint8_t* before = w;
        if (encodeAttrFast(w, key, v)) [[likely]] {
            enc.entries.append({ key, static_cast<uint32_t>(before - enc.bytes.begin()), static_cast<uint32_t>(w - before) });
            enc.count++;
            continue;
        }
        out.grow(out.size() + 1);
        BunAttrRef* slot = &out.last();
        if (!fillValue(globalObject, sc, *slot, v, true)) {
            out.shrink(out.size() - 1);
            continue;
        }
        slot->setKey(strRef(key));
    }
    enc.bytes.shrink(w - enc.bytes.begin());
    return dropped;
}

static void patchArrays(AttrScratch& sc, Vector<BunAttrRef, 16>& attrs)
{
    for (auto& a : attrs) {
        if (a.kind == 4)
            a.u.array.items = sc.arrayItems.begin() + reinterpret_cast<size_t>(a.u.array.items);
    }
}

// ─── creation entry points ───

extern "C" JSC::EncodedJSValue Bun__TelemetrySpan__createNative(Zig::GlobalObject* globalObject, const SpanStub* stub, uint16_t scope, uint8_t kind, uint64_t native)
{
    return JSValue::encode(JSTelemetrySpan::create(globalObject->vm(), globalObject, *stub, scope, kind, jsNull(), native));
}

/// A pooled span with a materialized cell ended natively.
extern "C" void Bun__TelemetrySpan__nativeEnded(JSC::EncodedJSValue v)
{
    if (auto* span = toTelemetrySpan(JSValue::decode(v)))
        span->setState(span->vm(), (span->state() | JSTelemetrySpan::StateEnded) & ~JSTelemetrySpan::StateRecording);
}

extern "C" void* Bun__TelemetrySpan__fromJS(JSC::EncodedJSValue v)
{
    return toTelemetrySpan(JSValue::decode(v));
}

extern "C" const SpanStub* Bun__TelemetrySpan__stub(void* cell)
{
    return &static_cast<JSTelemetrySpan*>(cell)->m_stub;
}

extern "C" uint64_t Bun__TelemetrySpan__native(void* cell)
{
    return static_cast<JSTelemetrySpan*>(cell)->m_native;
}

/// `extra.t` (traceState) / `extra.b` (baggage) of a JS-owned span, or undefined.
extern "C" JSC::EncodedJSValue Bun__TelemetrySpan__extraString(Zig::GlobalObject* globalObject, JSC::EncodedJSValue cellValue, uint8_t which)
{
    auto* span = toTelemetrySpan(JSValue::decode(cellValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    JSValue extra = span->get(JSTelemetrySpan::Field::Extra);
    if (!extra.isObject())
        return JSValue::encode(jsUndefined());
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSValue v = extra.getObject()->getDirect(vm, Identifier::fromString(vm, which == 't' ? "t"_s : "b"_s));
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(v ? v : jsUndefined());
}

// Resolve the `parent` argument of startSpan to a stub pointer.
// undefined → active span; null → root; span → it; {traceId, spanId, traceFlags, isRemote?} → remote carrier.
static const SpanStub* resolveParent(Zig::GlobalObject* globalObject, JSValue parent, SpanStub& storage, JSTelemetrySpan*& parentCell)
{
    parentCell = nullptr;
    if (parent.isUndefined()) {
        JSValue active = JSValue::decode(Bun__Telemetry__activeSpanCell(globalObject));
        parentCell = toTelemetrySpan(active);
        return parentCell ? &parentCell->m_stub : nullptr;
    }
    if (parent.isNull())
        return nullptr;
    if (auto* cell = toTelemetrySpan(parent)) {
        parentCell = cell;
        return &cell->m_stub;
    }
    if (parent.isObject()) {
        auto& vm = globalObject->vm();
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        JSObject* o = parent.getObject();
        JSValue t = o->get(globalObject, Identifier::fromString(vm, "traceId"_s));
        JSValue s = scope.exception() ? JSValue() : o->get(globalObject, Identifier::fromString(vm, "spanId"_s));
        JSValue f = scope.exception() ? JSValue() : o->get(globalObject, Identifier::fromString(vm, "traceFlags"_s));
        JSValue r = scope.exception() ? JSValue() : o->get(globalObject, Identifier::fromString(vm, "isRemote"_s));
        if (scope.exception()) [[unlikely]] {
            (void)scope.tryClearException();
            return nullptr;
        }
        if (t.isString() && s.isString()) {
            uint8_t tid[16], sid[8];
            auto ts = asString(t)->value(globalObject);
            auto ss = asString(s)->value(globalObject);
            if (parseHex(StringView(ts), tid, 16) && parseHex(StringView(ss), sid, 8)) {
                Bun__Telemetry__stubWrap(&storage, tid, sid, f.isNumber() ? static_cast<uint8_t>(f.asNumber()) : 1, r.isBoolean() ? r.asBoolean() : true);
                return &storage;
            }
        }
    }
    return nullptr;
}

static void setPropagationExtra(VM&, Zig::GlobalObject*, JSTelemetrySpan* child, const String& ts, const String& bg);

// tracestate/baggage of a pooled parent → child's extra (rare: only when the
// incoming request carried them).
static void inheritNativePropagation(VM& vm, Zig::GlobalObject* globalObject, JSTelemetrySpan* child, uint64_t native)
{
    String ts, bg;
    Vector<uint8_t, 256> buf;
    for (uint8_t which : { 't', 'b' }) {
        buf.grow(512);
        size_t n = Bun__Telemetry__nativePropagation(native, which, buf.begin(), buf.size());
        if (n > buf.size()) {
            buf.grow(n);
            n = Bun__Telemetry__nativePropagation(native, which, buf.begin(), buf.size());
        }
        if (n)
            (which == 't' ? ts : bg) = String::fromUTF8(std::span(buf.begin(), n));
    }
    setPropagationExtra(vm, globalObject, child, ts, bg);
}

// If `parentCell` carries tracestate/baggage, copy them into the child's extra.
static void inheritPropagation(VM& vm, Zig::GlobalObject* globalObject, JSTelemetrySpan* child, JSTelemetrySpan* parentCell)
{
    if (!parentCell)
        return;
    JSValue t = JSValue::decode(Bun__TelemetrySpan__extraString(globalObject, JSValue::encode(parentCell), 't'));
    JSValue b = JSValue::decode(Bun__TelemetrySpan__extraString(globalObject, JSValue::encode(parentCell), 'b'));
    String ts, bg;
    if (parentCell->m_native)
        return inheritNativePropagation(vm, globalObject, child, parentCell->m_native);
    if (t.isString())
        ts = asString(t)->value(globalObject);
    if (b.isString())
        bg = asString(b)->value(globalObject);
    setPropagationExtra(vm, globalObject, child, ts, bg);
}

static void setPropagationExtra(VM& vm, Zig::GlobalObject* globalObject, JSTelemetrySpan* child, const String& ts, const String& bg)
{
    if (ts.isEmpty() && bg.isEmpty())
        return;
    JSObject* extra = constructEmptyObject(globalObject, globalObject->objectPrototype(), 6);
    extra->putDirect(vm, Identifier::fromString(vm, "e"_s), jsNull());
    extra->putDirect(vm, Identifier::fromString(vm, "l"_s), jsNull());
    extra->putDirect(vm, Identifier::fromString(vm, "s"_s), jsNumber(0));
    extra->putDirect(vm, Identifier::fromString(vm, "m"_s), jsEmptyString(vm));
    extra->putDirect(vm, Identifier::fromString(vm, "t"_s), ts.isEmpty() ? jsEmptyString(vm) : jsString(vm, ts));
    extra->putDirect(vm, Identifier::fromString(vm, "b"_s), bg.isEmpty() ? jsEmptyString(vm) : jsString(vm, bg));
    child->field(JSTelemetrySpan::Field::Extra).set(vm, child, extra);
}

// ─── JSTelemetryBinding: `createSpan(scopeKind, name)` fast path (CallDOM) ───
//
// scopeKind = scope << 3 | kind. Parent is the active span.

static ALWAYS_INLINE JSTelemetrySpan* createSpanFast(Zig::GlobalObject* globalObject, int32_t scopeKind, JSString* name)
{
    auto& vm = globalObject->vm();
    const SpanStub* parent = Bun__Telemetry__activeSpanStub(globalObject);
    SpanStub stub;
    Bun__Telemetry__stubStart(&stub, parent, 0);
    auto* span = JSTelemetrySpan::create(vm, globalObject, stub, static_cast<uint16_t>(scopeKind >> 3), static_cast<uint8_t>(scopeKind & 7), name, 0);
    if (parent) {
        if (uint64_t native = Bun__Telemetry__activeNativeHandle(globalObject))
            inheritNativePropagation(vm, globalObject, span, native);
        else if (JSTelemetrySpan* parentCell = toTelemetrySpan(JSValue::decode(Bun__Telemetry__activeSpanCell(globalObject)))) {
            if (parentCell->get(JSTelemetrySpan::Field::Extra).isObject())
                inheritPropagation(vm, globalObject, span, parentCell);
        }
    }
    return span;
}

JSC_DECLARE_HOST_FUNCTION(jsTelemetryBindingCreateSpan);
JSC_DECLARE_JIT_OPERATION(telemetryBindingCreateSpanWithoutTypeCheck, JSC::EncodedJSValue, (JSGlobalObject*, JSTelemetryBinding*, int32_t, JSString*));

JSC_DEFINE_HOST_FUNCTION(jsTelemetryBindingCreateSpan, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    int32_t scopeKind = callFrame->argument(0).isInt32() ? callFrame->argument(0).asInt32() : (Bun__Telemetry__userScope() << 3);
    JSString* name = callFrame->argument(1).toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(createSpanFast(globalObject, scopeKind, name));
}

JSC_DEFINE_JIT_OPERATION(telemetryBindingCreateSpanWithoutTypeCheck, JSC::EncodedJSValue, (JSGlobalObject * lexicalGlobalObject, JSTelemetryBinding*, int32_t scopeKind, JSString* name))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    IGNORE_WARNINGS_BEGIN("frame-address")
    CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    IGNORE_WARNINGS_END
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    return { JSValue::encode(createSpanFast(defaultGlobalObject(lexicalGlobalObject), scopeKind, name)) };
}

const ClassInfo JSTelemetryBinding::s_info = { "TelemetryBinding"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTelemetryBinding) };

static const JSC::DOMJIT::Signature signatureTelemetryBindingCreateSpan(
    telemetryBindingCreateSpanWithoutTypeCheck,
    JSTelemetryBinding::info(),
    JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    SpecObjectOther,
    SpecInt32Only,
    SpecString);

JSTelemetryBinding* JSTelemetryBinding::create(VM& vm, Zig::GlobalObject* globalObject)
{
    Structure* structure = Structure::create(vm, globalObject, globalObject->objectPrototype(), TypeInfo(ObjectType, StructureFlags), info());
    auto* binding = new (NotNull, allocateCell<JSTelemetryBinding>(vm)) JSTelemetryBinding(vm, structure);
    binding->finishCreation(vm);
    binding->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "createSpan"_s), 2, jsTelemetryBindingCreateSpan, ImplementationVisibility::Public, NoIntrinsic, &signatureTelemetryBindingCreateSpan, static_cast<unsigned>(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    return binding;
}

// ─── JSTelemetryTracer ───

static JSValue internalTelemetryHelper(Zig::GlobalObject* globalObject, ASCIILiteral name)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue moduleValue = globalObject->internalModuleRegistry()->requireId(globalObject, vm, Bun::InternalModuleRegistry::InternalTelemetry);
    RETURN_IF_EXCEPTION(scope, {});
    if (!moduleValue.isObject())
        return jsUndefined();
    RELEASE_AND_RETURN(scope, moduleValue.getObject()->get(globalObject, Identifier::fromString(vm, name)));
}

// api Context → [span | undefined, extras | undefined] via internal/telemetry.ts unpackContext.
static std::pair<JSValue, JSValue> unpackContext(Zig::GlobalObject* globalObject, JSValue context)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue fn = internalTelemetryHelper(globalObject, "unpackContext"_s);
    RETURN_IF_EXCEPTION(scope, {});
    if (!fn.isCallable())
        return {};
    MarkedArgumentBuffer args;
    args.append(context);
    JSValue pair = call(globalObject, fn, jsUndefined(), args, "unpackContext"_s);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue spanV = pair.get(globalObject, 0u);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue extrasV = pair.get(globalObject, 1u);
    RETURN_IF_EXCEPTION(scope, {});
    return { spanV, extrasV };
}

// A user-supplied span-like (ours, api Span with spanContext(), or a bare
// SpanContext) → a value resolveParent understands.
static JSValue toParentValue(Zig::GlobalObject* globalObject, JSValue v)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (v.isUndefinedOrNull() || toTelemetrySpan(v))
        return v;
    if (!v.isObject())
        return jsNull();
    JSValue sc = v.getObject()->get(globalObject, Identifier::fromString(vm, "spanContext"_s));
    RETURN_IF_EXCEPTION(scope, {});
    if (sc.isCallable()) {
        MarkedArgumentBuffer noArgs;
        JSValue ctx = call(globalObject, sc, v, noArgs, "spanContext"_s);
        RETURN_IF_EXCEPTION(scope, {});
        return ctx;
    }
    return v;
}

static JSTelemetrySpan* tracerStartSpan(Zig::GlobalObject* globalObject, JSTelemetryTracer* tracer, JSValue nameV, JSValue options, JSValue context, JSValue* extrasOut)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSString* name = nameV.isString() ? asString(nameV) : nameV.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (options.isUndefinedOrNull() && context.isUndefined())
        return createSpanFast(globalObject, tracer->m_scope << 3, name);

    JSObject* opts = options.isObject() ? options.getObject() : nullptr;
    auto opt = [&](ASCIILiteral n) -> JSValue {
        if (!opts)
            return jsUndefined();
        JSValue v = opts->get(globalObject, Identifier::fromString(vm, n));
        return scope.exception() ? jsUndefined() : v;
    };
    // parent: undefined → active, null → root
    JSValue parent = jsUndefined();
    JSValue root = opt("root"_s);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (root.toBoolean(globalObject)) {
        parent = jsNull();
    } else if (!context.isUndefined()) {
        auto [spanV, extrasV] = unpackContext(globalObject, context);
        RETURN_IF_EXCEPTION(scope, nullptr);
        parent = spanV.isUndefinedOrNull() ? jsNull() : spanV;
        if (extrasOut)
            *extrasOut = extrasV;
    } else {
        JSValue p = opt("parent"_s);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (!p.isUndefined()) {
            parent = toParentValue(globalObject, p);
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
    }
    JSValue kindV = opt("kind"_s);
    uint8_t kind = kindV.isInt32() && kindV.asInt32() >= 0 && kindV.asInt32() <= 4 ? static_cast<uint8_t>(kindV.asInt32()) : 0;
    uint64_t startNs = timeInputToNs(globalObject, opt("startTime"_s));
    RETURN_IF_EXCEPTION(scope, nullptr);

    SpanStub storage;
    JSTelemetrySpan* parentCell;
    const SpanStub* parentStub = resolveParent(globalObject, parent, storage, parentCell);
    RETURN_IF_EXCEPTION(scope, nullptr);
    SpanStub stub;
    Bun__Telemetry__stubStart(&stub, parentStub, startNs);
    auto* span = JSTelemetrySpan::create(vm, globalObject, stub, tracer->m_scope, kind, name, 0);
    inheritPropagation(vm, globalObject, span, parentCell);

    JSValue attributes = opt("attributes"_s);
    if (attributes.isObject()) {
        JSValue fn = span->JSObject::get(globalObject, Identifier::fromString(vm, "setAttributes"_s));
        RETURN_IF_EXCEPTION(scope, nullptr);
        MarkedArgumentBuffer args;
        args.append(attributes);
        call(globalObject, fn, span, args, "setAttributes"_s);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    JSValue links = opt("links"_s);
    if (links.isObject()) {
        JSValue fn = span->JSObject::get(globalObject, Identifier::fromString(vm, "addLinks"_s));
        RETURN_IF_EXCEPTION(scope, nullptr);
        MarkedArgumentBuffer args;
        args.append(links);
        call(globalObject, fn, span, args, "addLinks"_s);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    return span;
}

JSC_DECLARE_HOST_FUNCTION(jsTelemetryTracerStartSpan);
JSC_DECLARE_HOST_FUNCTION(jsTelemetryTracerStartActiveSpan);
JSC_DECLARE_JIT_OPERATION(telemetryTracerStartSpanWithoutTypeCheck, JSC::EncodedJSValue, (JSGlobalObject*, JSTelemetryTracer*, JSString*));

// startSpan(name, options?, context?)
JSC_DEFINE_HOST_FUNCTION(jsTelemetryTracerStartSpan, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* tracer = dynamicDowncast<JSTelemetryTracer>(callFrame->thisValue());
    if (!tracer) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "not a Tracer"_s);
    auto* span = tracerStartSpan(globalObject, tracer, callFrame->argument(0), callFrame->argument(1), callFrame->argument(2), nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(span);
}

JSC_DEFINE_JIT_OPERATION(telemetryTracerStartSpanWithoutTypeCheck, JSC::EncodedJSValue, (JSGlobalObject * lexicalGlobalObject, JSTelemetryTracer* tracer, JSString* name))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    IGNORE_WARNINGS_BEGIN("frame-address")
    CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    IGNORE_WARNINGS_END
    JSC::JITOperationPrologueCallFrameTracer tracerFrame(vm, callFrame);
    return { JSValue::encode(createSpanFast(defaultGlobalObject(lexicalGlobalObject), tracer->m_scope << 3, name)) };
}

static const JSC::DOMJIT::Signature signatureTelemetryTracerStartSpan(
    telemetryTracerStartSpanWithoutTypeCheck,
    JSTelemetryTracer::info(),
    JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    SpecObjectOther,
    SpecString);

// startActiveSpan(name, [options], [context], fn) — or without fn: activated
// span for `using`.
JSC_DEFINE_HOST_FUNCTION(jsTelemetryTracerStartActiveSpan, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* tracer = dynamicDowncast<JSTelemetryTracer>(callFrame->thisValue());
    if (!tracer) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "not a Tracer"_s);
    JSValue a = callFrame->argument(1), b = callFrame->argument(2), c = callFrame->argument(3);
    JSValue options = jsUndefined(), context = jsUndefined(), fn = jsUndefined();
    if (a.isCallable())
        fn = a;
    else if (b.isCallable()) {
        options = a;
        fn = b;
    } else if (c.isCallable()) {
        options = a;
        context = b;
        fn = c;
    } else {
        options = a;
        context = b;
    }
    JSValue extras = jsUndefined();
    auto* span = tracerStartSpan(globalObject, tracer, callFrame->argument(0), options, context, &extras);
    RETURN_IF_EXCEPTION(scope, {});
    if (fn.isUndefined()) {
        // `using span = tracer.startActiveSpan(...)`
        JSValue prev = JSValue::decode(Bun__Telemetry__enter(globalObject, JSValue::encode(span)));
        span->field(JSTelemetrySpan::Field::Restore).set(vm, span, prev ? prev : jsUndefined());
        return JSValue::encode(span);
    }
    JSValue prev = JSValue::decode(Bun__Telemetry__enterWithExtras(globalObject, JSValue::encode(span), JSValue::encode(extras.isCell() ? extras : JSValue())));
    MarkedArgumentBuffer args;
    args.append(span);
    JSValue result = call(globalObject, fn, jsUndefined(), args, "startActiveSpan"_s);
    Bun__Telemetry__exit(globalObject, JSValue::encode(prev));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

const ClassInfo JSTelemetryTracer::s_info = { "Tracer"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTelemetryTracer) };

template<typename, SubspaceAccess mode>
GCClient::IsoSubspace* JSTelemetryTracer::subspaceFor(VM& vm)
{
    return WebCore::subspaceForImpl<JSTelemetryTracer, WebCore::UseCustomHeapCellType::No>(vm, BUN_SUBSPACE_SLOTS(m_clientSubspaceForJSTelemetryTracer, m_subspaceForJSTelemetryTracer));
}

JSTelemetryTracer* JSTelemetryTracer::create(VM& vm, Zig::GlobalObject* globalObject, uint16_t scopeId, JSValue name, JSValue version)
{
    // One structure per tracer is fine: tracers are long-lived singletons per library.
    Structure* structure = Structure::create(vm, globalObject, globalObject->objectPrototype(), TypeInfo(ObjectType, StructureFlags), info());
    auto* tracer = new (NotNull, allocateCell<JSTelemetryTracer>(vm)) JSTelemetryTracer(vm, structure);
    tracer->finishCreation(vm);
    tracer->m_scope = scopeId;
    tracer->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "startSpan"_s), 1, jsTelemetryTracerStartSpan, ImplementationVisibility::Public, NoIntrinsic, &signatureTelemetryTracerStartSpan, static_cast<unsigned>(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    tracer->putDirectNativeFunction(vm, globalObject, Identifier::fromString(vm, "startActiveSpan"_s), 2, jsTelemetryTracerStartActiveSpan, ImplementationVisibility::Public, NoIntrinsic, static_cast<unsigned>(PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly));
    tracer->putDirect(vm, vm.propertyNames->name, name, static_cast<unsigned>(PropertyAttribute::ReadOnly));
    tracer->putDirect(vm, Identifier::fromString(vm, "version"_s), version, static_cast<unsigned>(PropertyAttribute::ReadOnly));
    return tracer;
}

// createTracer(scopeId, name, version)
JSC_DEFINE_HOST_FUNCTION(jsTelemetryCreateTracer, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue idV = callFrame->argument(0);
    uint16_t scopeId = idV.isInt32() ? static_cast<uint16_t>(idV.asInt32()) : Bun__Telemetry__userScope();
    return JSValue::encode(JSTelemetryTracer::create(globalObject->vm(), globalObject, scopeId, callFrame->argument(1), callFrame->argument(2)));
}

// propagationHeaders(span) → [traceparent | undefined, tracestate | undefined, baggage | undefined]
// for a native-owned span (node:http client), honouring OTEL_PROPAGATORS.
JSC_DEFINE_HOST_FUNCTION(jsTelemetryPropagationHeaders, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto* span = toTelemetrySpan(callFrame->argument(0));
    JSArray* out = constructEmptyArray(globalObject, nullptr, 3);
    if (!out)
        return JSValue::encode(jsUndefined());
    if (!span)
        return JSValue::encode(out);
    uint32_t flags = Bun__Telemetry__propagationFlags();
    static const uint8_t zero[16] = {};
    if ((flags & 1) && memcmp(span->m_stub.traceId, zero, 16)) {
        // 00-<trace>-<span>-<flags>
        std::span<Latin1Character> buf;
        auto tp = String::createUninitialized(55, buf);
        buf[0] = '0';
        buf[1] = '0';
        buf[2] = '-';
        for (size_t i = 0; i < 16; ++i) {
            buf[3 + i * 2] = hexDigits[span->m_stub.traceId[i] >> 4];
            buf[4 + i * 2] = hexDigits[span->m_stub.traceId[i] & 15];
        }
        buf[35] = '-';
        for (size_t i = 0; i < 8; ++i) {
            buf[36 + i * 2] = hexDigits[span->m_stub.spanId[i] >> 4];
            buf[37 + i * 2] = hexDigits[span->m_stub.spanId[i] & 15];
        }
        buf[52] = '-';
        uint8_t w3c = span->m_stub.flags & SpanStub::Sampled;
        buf[53] = hexDigits[w3c >> 4];
        buf[54] = hexDigits[w3c & 15];
        out->putDirectIndex(globalObject, 0, jsString(vm, WTF::move(tp)));
    }
    if (span->m_native) {
        Vector<uint8_t, 256> tmp;
        for (int i = 0; i < 2; ++i) {
            uint8_t which = i == 0 ? 't' : 'b';
            if (!(flags & (i == 0 ? 1u : 2u)))
                continue;
            tmp.grow(256);
            size_t n = Bun__Telemetry__nativePropagation(span->m_native, which, tmp.begin(), tmp.size());
            if (n > tmp.size()) {
                tmp.grow(n);
                n = Bun__Telemetry__nativePropagation(span->m_native, which, tmp.begin(), tmp.size());
            }
            if (n)
                out->putDirectIndex(globalObject, 1 + i, jsString(vm, String::fromUTF8(std::span(tmp.begin(), n))));
        }
    } else {
        if (flags & 1) {
            JSValue t = JSValue::decode(Bun__TelemetrySpan__extraString(globalObject, JSValue::encode(span), 't'));
            if (t.isString() && asString(t)->length())
                out->putDirectIndex(globalObject, 1, t);
        }
        if (flags & 2) {
            JSValue b = JSValue::decode(Bun__TelemetrySpan__extraString(globalObject, JSValue::encode(span), 'b'));
            if (b.isString() && asString(b)->length())
                out->putDirectIndex(globalObject, 2, b);
        }
    }
    return JSValue::encode(out);
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetryCreateBinding, (JSGlobalObject * lexicalGlobalObject, CallFrame*))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    return JSValue::encode(JSTelemetryBinding::create(globalObject->vm(), globalObject));
}

// startSpan(scope, name, kind, parent, startTime)
JSC_DEFINE_HOST_FUNCTION(jsTelemetryStartSpan, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue scopeV = callFrame->argument(0);
    uint16_t scopeId = scopeV.isInt32() ? static_cast<uint16_t>(scopeV.asInt32()) : Bun__Telemetry__userScope();
    JSValue nameV = callFrame->argument(1);
    JSString* name = nameV.isString() ? asString(nameV) : nameV.toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue kindV = callFrame->argument(2);
    uint8_t kind = kindV.isInt32() && kindV.asInt32() >= 0 && kindV.asInt32() <= 4 ? static_cast<uint8_t>(kindV.asInt32()) : 0;
    SpanStub storage;
    JSTelemetrySpan* parentCell;
    const SpanStub* parent = resolveParent(globalObject, callFrame->argument(3), storage, parentCell);
    RETURN_IF_EXCEPTION(scope, {});
    uint64_t startNs = timeInputToNs(globalObject, callFrame->argument(4));
    SpanStub stub;
    Bun__Telemetry__stubStart(&stub, parent, startNs);
    auto* span = JSTelemetrySpan::create(vm, globalObject, stub, scopeId, kind, name, 0);
    inheritPropagation(vm, globalObject, span, parentCell);
    return JSValue::encode(span);
}

// wrapSpanContext({traceId, spanId, traceFlags, isRemote, traceState} | null)
JSC_DEFINE_HOST_FUNCTION(jsTelemetryWrapSpanContext, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue arg = callFrame->argument(0);
    SpanStub stub {};
    stub.startNs = 1;
    stub.flags = SpanStub::NonRecording;
    if (arg.isObject()) {
        SpanStub storage;
        JSTelemetrySpan* unused;
        if (const SpanStub* p = resolveParent(globalObject, arg, storage, unused))
            stub = *p;
        RETURN_IF_EXCEPTION(scope, {});
        stub.flags |= SpanStub::NonRecording;
    }
    auto* span = JSTelemetrySpan::create(vm, globalObject, stub, Bun__Telemetry__userScope(), 0, jsEmptyString(vm), 0);
    span->setState(vm, 0);
    if (arg.isObject()) {
        JSValue ts = arg.getObject()->get(globalObject, Identifier::fromString(vm, "traceState"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (ts.isString() && asString(ts)->length()) {
            JSObject* extra = constructEmptyObject(globalObject, globalObject->objectPrototype(), 6);
            extra->putDirect(vm, Identifier::fromString(vm, "e"_s), jsNull());
            extra->putDirect(vm, Identifier::fromString(vm, "l"_s), jsNull());
            extra->putDirect(vm, Identifier::fromString(vm, "s"_s), jsNumber(0));
            extra->putDirect(vm, Identifier::fromString(vm, "m"_s), jsEmptyString(vm));
            // api TraceState object or string
            JSValue tsStr = ts;
            extra->putDirect(vm, Identifier::fromString(vm, "t"_s), tsStr);
            extra->putDirect(vm, Identifier::fromString(vm, "b"_s), jsEmptyString(vm));
            span->field(JSTelemetrySpan::Field::Extra).set(vm, span, extra);
        }
    }
    return JSValue::encode(span);
}

// startInstrumentSpan(instrumentIndex, name, kind) — native-owned span for a
// JS-implemented built-in instrumentation (node:http client).
JSC_DEFINE_HOST_FUNCTION(jsTelemetryStartInstrumentSpan, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    JSValue idx = callFrame->argument(0);
    JSValue nameV = callFrame->argument(1);
    JSValue kindV = callFrame->argument(2);
    if (!idx.isInt32() || !nameV.isString())
        return JSValue::encode(jsUndefined());
    auto name = asString(nameV)->value(globalObject);
    BunStrRef nameRef = strRef(name);
    uint8_t kind = kindV.isInt32() ? static_cast<uint8_t>(kindV.asInt32()) : 0;
    return Bun__Telemetry__startInstrumentSpan(globalObject, static_cast<uint32_t>(idx.asInt32()), &nameRef, kind);
}

// $telemetryNativeSpanOp(span, op, a, b, c) — see TelemetrySpan.ts
JSC_DEFINE_HOST_FUNCTION(jsTelemetryNativeSpanOp, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    int op = callFrame->argument(1).isInt32() ? callFrame->argument(1).asInt32() : -1;
    if (op == 5) // now (epoch ms)
        return JSValue::encode(jsNumber(static_cast<double>(Bun__Telemetry__nowNs()) / 1e6));
    auto* span = toTelemetrySpan(callFrame->argument(0));
    if (!span || !span->m_native)
        return JSValue::encode(jsUndefined());
    JSValue a = callFrame->argument(2), b = callFrame->argument(3), c = callFrame->argument(4);
    AttrScratch sc;
    switch (op) {
    case 0: { // setAttribute(key, value)
        if (!a.isString())
            break;
        BunAttrRef ref;
        if (!fillValue(globalObject, sc, ref, b, true))
            break;
        RETURN_IF_EXCEPTION(scope, {});
        ref.setKey(strRef(implOf(globalObject, asString(a))));
        if (ref.kind == 4)
            ref.u.array.items = sc.arrayItems.begin() + reinterpret_cast<size_t>(ref.u.array.items);
        Bun__Telemetry__nativeSetAttribute(span->m_native, &ref);
        break;
    }
    case 1: { // setName(name)
        auto str = a.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        BunStrRef r = strRef(str);
        Bun__Telemetry__nativeSetName(span->m_native, &r);
        break;
    }
    case 2: { // setStatus(code, message)
        auto m = b.isString() ? asString(b)->value(globalObject) : String();
        BunStrRef r = strRef(m);
        Bun__Telemetry__nativeSetStatus(span->m_native, a.isInt32() ? static_cast<uint8_t>(a.asInt32()) : 0, &r);
        break;
    }
    case 3: { // addEvent(name, flatAttrs | null, time)
        auto n = a.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        Vector<BunAttrRef, 16> attrs;
        if (auto* flat = b.isCell() ? dynamicDowncast<JSArray>(b.asCell()) : nullptr) {
            gatherAttrs(globalObject, sc, flat, attrs);
            RETURN_IF_EXCEPTION(scope, {});
            patchArrays(sc, attrs);
        }
        BunEventRef ev { strRef(n), timeInputToNs(globalObject, c), attrs.begin(), static_cast<uint32_t>(attrs.size()) };
        Bun__Telemetry__nativeAddEvent(span->m_native, &ev);
        break;
    }
    case 4: { // addLink(ctx, flatAttrs | null)
        if (!a.isObject())
            break;
        JSObject* ctx = a.getObject();
        JSValue t = ctx->get(globalObject, Identifier::fromString(vm, "traceId"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue s = ctx->get(globalObject, Identifier::fromString(vm, "spanId"_s));
        RETURN_IF_EXCEPTION(scope, {});
        JSValue f = ctx->get(globalObject, Identifier::fromString(vm, "traceFlags"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!t.isString() || !s.isString())
            break;
        auto ts = asString(t)->value(globalObject);
        auto ss = asString(s)->value(globalObject);
        Vector<BunAttrRef, 16> attrs;
        if (auto* flat = b.isCell() ? dynamicDowncast<JSArray>(b.asCell()) : nullptr) {
            gatherAttrs(globalObject, sc, flat, attrs);
            RETURN_IF_EXCEPTION(scope, {});
            patchArrays(sc, attrs);
        }
        BunLinkRef link { strRef(ts), strRef(ss), static_cast<uint8_t>(f.isNumber() ? f.asNumber() : 0), attrs.begin(), static_cast<uint32_t>(attrs.size()) };
        Bun__Telemetry__nativeAddLink(span->m_native, &link);
        break;
    }
    default:
        break;
    }
    return JSValue::encode(jsUndefined());
}

// ─── prototype ───

static void endSpan(Zig::GlobalObject* globalObject, JSTelemetrySpan* span, uint64_t endNs)
{
    auto& vm = globalObject->vm();
    int32_t state = span->state();
    if (state & JSTelemetrySpan::StateEnded)
        return;
    span->setState(vm, (state | JSTelemetrySpan::StateEnded) & ~JSTelemetrySpan::StateRecording);
    if (span->m_native) {
        Bun__Telemetry__nativeEnd(span->m_native, endNs);
        return;
    }
    if (!(state & JSTelemetrySpan::StateRecording))
        return;
    if (!endNs)
        endNs = Bun__Telemetry__nowNs();

    AttrScratch sc;
    Vector<BunAttrRef, 16> attrs;
    EncodedAttrs enc;
    unsigned dropped = 0;
    JSValue attrsV = span->get(JSTelemetrySpan::Field::Attributes);
    if (attrsV.isCell()) {
        uint32_t valueLengthLimit;
        unsigned limit = Bun__Telemetry__attributeLimits(&valueLengthLimit);
        if (valueLengthLimit < 96) [[unlikely]]
            gatherAttrs(globalObject, sc, uncheckedDowncast<JSArray>(attrsV.asCell()), attrs);
        else
            dropped += gatherAttrsFast(globalObject, sc, uncheckedDowncast<JSArray>(attrsV.asCell()), enc, attrs, limit);
    }

    JSValue nameV = span->get(JSTelemetrySpan::Field::Name);
    const StringImpl* name = nameV.isString() ? implOf(globalObject, asString(nameV)) : nullptr;

    BunEndDesc desc {
        &span->m_stub,
        span->m_scope,
        span->m_kind,
        0,
        endNs,
        strRef(name),
        { nullptr, 0, 0 },
        { nullptr, 0, 0 },
        nullptr,
        0,
        dropped,
        enc.bytes.begin(),
        static_cast<uint32_t>(enc.bytes.size()),
        enc.count,
        nullptr,
        0,
        nullptr,
        0,
    };

    JSValue extraV = span->get(JSTelemetrySpan::Field::Extra);
    if (!extraV.isObject()) [[likely]] {
        patchArrays(sc, attrs);
        desc.attrs = attrs.begin();
        desc.nAttrs = attrs.size();
        Bun__Telemetry__encodeSpan(&desc);
        span->field(JSTelemetrySpan::Field::Attributes).setWithoutWriteBarrier(jsNull());
        return;
    }

    // Slow path: status / events / links / tracestate.
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    const StringImpl* statusMessage = nullptr;
    const StringImpl* traceState = nullptr;
    String traceStateOwned;
    Vector<BunEventRef, 4> events;
    Vector<BunLinkRef, 4> links;
    Vector<Vector<BunAttrRef, 16>, 4> nestedAttrs;
    JSObject* extra = extraV.getObject();
    auto getField = [&](ASCIILiteral n) -> JSValue {
        JSValue v = extra->getDirect(vm, Identifier::fromString(vm, n));
        return v ? v : jsUndefined();
    };
    JSValue sV = getField("s"_s);
    if (sV.isInt32())
        desc.status = static_cast<uint8_t>(sV.asInt32());
    JSValue mV = getField("m"_s);
    if (mV.isString())
        statusMessage = implOf(globalObject, asString(mV));
    JSValue tV = getField("t"_s);
    if (tV.isString())
        traceState = implOf(globalObject, asString(tV));
    else if (tV.isObject()) {
        // api TraceState object: serialize()
        JSValue ser = tV.getObject()->get(globalObject, Identifier::fromString(vm, "serialize"_s));
        if (!scope.exception() && ser.isCallable()) {
            MarkedArgumentBuffer noArgs;
            JSValue out = call(globalObject, ser, tV, noArgs, "serialize"_s);
            if (!scope.exception() && out.isString()) {
                traceStateOwned = asString(out)->value(globalObject);
                traceState = traceStateOwned.impl();
            }
        }
        if (scope.exception())
            (void)scope.tryClearException();
    }
    JSValue eV = getField("e"_s);
    if (auto* ev = eV.isCell() ? dynamicDowncast<JSArray>(eV.asCell()) : nullptr) {
        unsigned n = ev->length() / 3;
        nestedAttrs.grow(nestedAttrs.size() + n);
        for (unsigned i = 0; i < n; ++i) {
            JSValue en = ev->getIndex(globalObject, i * 3);
            JSValue et = ev->getIndex(globalObject, i * 3 + 1);
            JSValue ea = ev->getIndex(globalObject, i * 3 + 2);
            if (!en || !en.isString())
                continue;
            BunEventRef ref { strRef(implOf(globalObject, asString(en))), et ? timeInputToNs(globalObject, et) : 0, nullptr, 0 };
            auto& na = nestedAttrs[nestedAttrs.size() - n + i];
            if (auto* flat = ea && ea.isCell() ? dynamicDowncast<JSArray>(ea.asCell()) : nullptr) {
                gatherAttrs(globalObject, sc, flat, na);
                ref.nAttrs = na.size();
            }
            events.append(ref);
        }
    }
    JSValue lV = getField("l"_s);
    if (auto* lk = lV.isCell() ? dynamicDowncast<JSArray>(lV.asCell()) : nullptr) {
        unsigned n = lk->length() / 4;
        size_t base = nestedAttrs.size();
        nestedAttrs.grow(base + n);
        for (unsigned i = 0; i < n; ++i) {
            JSValue lt = lk->getIndex(globalObject, i * 4);
            JSValue ls = lk->getIndex(globalObject, i * 4 + 1);
            JSValue lf = lk->getIndex(globalObject, i * 4 + 2);
            JSValue la = lk->getIndex(globalObject, i * 4 + 3);
            if (!lt || !lt.isString() || !ls || !ls.isString())
                continue;
            BunLinkRef ref { strRef(implOf(globalObject, asString(lt))), strRef(implOf(globalObject, asString(ls))), static_cast<uint8_t>(lf && lf.isInt32() ? lf.asInt32() : 0), nullptr, 0 };
            auto& na = nestedAttrs[base + i];
            if (auto* flat = la && la.isCell() ? dynamicDowncast<JSArray>(la.asCell()) : nullptr) {
                gatherAttrs(globalObject, sc, flat, na);
                ref.nAttrs = na.size();
            }
            links.append(ref);
        }
    }
    if (scope.exception()) [[unlikely]]
        (void)scope.tryClearException();

    // All gathering done: vectors are stable, patch item pointers.
    patchArrays(sc, attrs);
    {
        size_t k = 0;
        for (size_t ei = 0; k < nestedAttrs.size() && ei < events.size(); ++k, ++ei) {
            patchArrays(sc, nestedAttrs[k]);
            events[ei].attrs = nestedAttrs[k].begin();
        }
        for (size_t li = 0; k < nestedAttrs.size() && li < links.size(); ++k, ++li) {
            patchArrays(sc, nestedAttrs[k]);
            links[li].attrs = nestedAttrs[k].begin();
        }
    }
    desc.attrs = attrs.begin();
    desc.nAttrs = attrs.size();
    desc.statusMessage = strRef(statusMessage);
    desc.traceState = strRef(traceState);
    desc.events = events.begin();
    desc.nEvents = events.size();
    desc.links = links.begin();
    desc.nLinks = links.size();
    Bun__Telemetry__encodeSpan(&desc);
    span->field(JSTelemetrySpan::Field::Attributes).setWithoutWriteBarrier(jsNull());
    span->field(JSTelemetrySpan::Field::Extra).setWithoutWriteBarrier(jsNull());
}

static JSTelemetrySpan* thisSpan(JSGlobalObject* globalObject, CallFrame* callFrame, ThrowScope& scope)
{
    auto* span = toTelemetrySpan(callFrame->thisValue());
    if (!span) [[unlikely]]
        throwTypeError(globalObject, scope, "not a Span"_s);
    return span;
}

// DFG/FTL call `end()` (no arguments) through this directly (CallDOM): no
// JS call frame, `this` already type-checked.
JSC_DEFINE_JIT_OPERATION(telemetrySpanEndWithoutTypeCheck, JSC::EncodedJSValue, (JSGlobalObject * lexicalGlobalObject, JSTelemetrySpan* span))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    IGNORE_WARNINGS_BEGIN("frame-address")
    CallFrame* callFrame = DECLARE_CALL_FRAME(vm);
    IGNORE_WARNINGS_END
    JSC::JITOperationPrologueCallFrameTracer tracer(vm, callFrame);
    endSpan(defaultGlobalObject(lexicalGlobalObject), span, 0);
    return { JSValue::encode(jsUndefined()) };
}

static const JSC::DOMJIT::Signature signatureTelemetrySpanEnd(
    telemetrySpanEndWithoutTypeCheck,
    JSTelemetrySpan::info(),
    JSC::DOMJIT::Effect::forReadWrite(JSC::DOMJIT::HeapRange::top(), JSC::DOMJIT::HeapRange::top()),
    SpecOther);

JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanProtoFuncEnd, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* span = thisSpan(globalObject, callFrame, scope);
    RETURN_IF_EXCEPTION(scope, {});
    endSpan(globalObject, span, timeInputToNs(globalObject, callFrame->argument(0)));
    return JSValue::encode(jsUndefined());
}

extern "C" void Bun__TelemetrySpan__end(Zig::GlobalObject* globalObject, JSC::EncodedJSValue cell, uint64_t endNs)
{
    if (auto* span = toTelemetrySpan(JSValue::decode(cell)))
        endSpan(globalObject, span, endNs);
}

static void exitSpan(Zig::GlobalObject* globalObject, JSTelemetrySpan* span)
{
    JSValue prev = span->get(JSTelemetrySpan::Field::Restore);
    if (!prev)
        return;
    Bun__Telemetry__exit(globalObject, JSValue::encode(prev));
    span->field(JSTelemetrySpan::Field::Restore).setWithoutWriteBarrier(JSValue());
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanProtoFuncEnter, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* span = thisSpan(globalObject, callFrame, scope);
    RETURN_IF_EXCEPTION(scope, {});
    if (!span->get(JSTelemetrySpan::Field::Restore)) {
        JSValue prev = JSValue::decode(Bun__Telemetry__enter(globalObject, JSValue::encode(span)));
        span->field(JSTelemetrySpan::Field::Restore).set(vm, span, prev ? prev : jsUndefined());
    }
    return JSValue::encode(span);
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanProtoFuncExit, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* span = thisSpan(globalObject, callFrame, scope);
    RETURN_IF_EXCEPTION(scope, {});
    exitSpan(globalObject, span);
    return JSValue::encode(span);
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanProtoFuncDispose, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* span = thisSpan(globalObject, callFrame, scope);
    RETURN_IF_EXCEPTION(scope, {});
    endSpan(globalObject, span, 0);
    exitSpan(globalObject, span);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsTelemetrySpanProtoFuncSpanContext, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* span = thisSpan(globalObject, callFrame, scope);
    RETURN_IF_EXCEPTION(scope, {});
    if (JSValue cached = span->get(JSTelemetrySpan::Field::Context))
        return JSValue::encode(cached);
    JSObject* ctx = constructEmptyObject(globalObject, globalObject->objectPrototype(), 5);
    ctx->putDirect(vm, Identifier::fromString(vm, "traceId"_s), hexString(vm, span->m_stub.traceId, 16));
    ctx->putDirect(vm, Identifier::fromString(vm, "spanId"_s), hexString(vm, span->m_stub.spanId, 8));
    ctx->putDirect(vm, Identifier::fromString(vm, "traceFlags"_s), jsNumber(span->m_stub.flags & SpanStub::Sampled));
    if (span->m_stub.flags & SpanStub::Remote)
        ctx->putDirect(vm, Identifier::fromString(vm, "isRemote"_s), jsBoolean(true));
    JSValue ts = JSValue::decode(Bun__TelemetrySpan__extraString(globalObject, JSValue::encode(span), 't'));
    if (ts.isObject() || (ts.isString() && asString(ts)->length()))
        ctx->putDirect(vm, Identifier::fromString(vm, "traceState"_s), ts);
    else if (span->m_native) {
        Vector<uint8_t, 256> buf;
        buf.grow(256);
        size_t n = Bun__Telemetry__nativePropagation(span->m_native, 't', buf.begin(), buf.size());
        if (n > buf.size()) {
            buf.grow(n);
            n = Bun__Telemetry__nativePropagation(span->m_native, 't', buf.begin(), buf.size());
        }
        if (n)
            ctx->putDirect(vm, Identifier::fromString(vm, "traceState"_s), jsString(vm, String::fromUTF8(std::span(buf.begin(), n))));
    }
    span->field(JSTelemetrySpan::Field::Context).set(vm, span, ctx);
    return JSValue::encode(ctx);
}

JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_traceId, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    return JSValue::encode(hexString(globalObject->vm(), span->m_stub.traceId, 16));
}
JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_spanId, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    return JSValue::encode(hexString(globalObject->vm(), span->m_stub.spanId, 8));
}
JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_parentSpanId, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    static const uint8_t zero[8] = {};
    if (!memcmp(span->m_stub.parentSpanId, zero, 8))
        return JSValue::encode(jsUndefined());
    return JSValue::encode(hexString(globalObject->vm(), span->m_stub.parentSpanId, 8));
}
JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_traceFlags, (JSGlobalObject*, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    return JSValue::encode(jsNumber(span->m_stub.flags & SpanStub::Sampled));
}
JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_isRemote, (JSGlobalObject*, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    return JSValue::encode(jsBoolean(span->m_stub.flags & SpanStub::Remote));
}
JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_name, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    JSValue n = span->get(JSTelemetrySpan::Field::Name);
    if (n.isString())
        return JSValue::encode(n);
    if (span->m_native) {
        Vector<uint8_t, 128> buf;
        buf.grow(128);
        size_t len = Bun__Telemetry__nativeName(span->m_native, buf.begin(), buf.size());
        if (len > buf.size()) {
            buf.grow(len);
            len = Bun__Telemetry__nativeName(span->m_native, buf.begin(), buf.size());
        }
        return JSValue::encode(jsString(globalObject->vm(), String::fromUTF8(std::span(buf.begin(), std::min(len, buf.size())))));
    }
    return JSValue::encode(jsEmptyString(globalObject->vm()));
}
JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_kind, (JSGlobalObject*, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    return JSValue::encode(jsNumber(span->m_kind));
}
JSC_DEFINE_CUSTOM_GETTER(jsTelemetrySpanGetter_ended, (JSGlobalObject*, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto* span = toTelemetrySpan(JSValue::decode(thisValue));
    if (!span)
        return JSValue::encode(jsUndefined());
    if (span->ended())
        return JSValue::encode(jsBoolean(true));
    if (span->m_native)
        return JSValue::encode(jsBoolean(!Bun__Telemetry__nativeIsLive(span->m_native)));
    return JSValue::encode(jsBoolean(false));
}

class JSTelemetrySpanPrototype final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;
    static JSTelemetrySpanPrototype* create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
    {
        auto* ptr = new (NotNull, allocateCell<JSTelemetrySpanPrototype>(vm)) JSTelemetrySpanPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }
    DECLARE_INFO;
    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSTelemetrySpanPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
    }

private:
    JSTelemetrySpanPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }
    void finishCreation(VM&, JSGlobalObject*);
};

static const HashTableValue JSTelemetrySpanPrototypeTableValues[] = {
    { "setAttribute"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanSetAttributeCodeGenerator, 2 } },
    { "setAttributes"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanSetAttributesCodeGenerator, 1 } },
    { "updateName"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanUpdateNameCodeGenerator, 1 } },
    { "isRecording"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanIsRecordingCodeGenerator, 0 } },
    { "setStatus"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanSetStatusCodeGenerator, 1 } },
    { "addEvent"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanAddEventCodeGenerator, 3 } },
    { "recordException"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanRecordExceptionCodeGenerator, 2 } },
    { "addLink"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanAddLinkCodeGenerator, 1 } },
    { "addLinks"_s, static_cast<unsigned>(PropertyAttribute::Builtin), NoIntrinsic, { HashTableValue::BuiltinGeneratorType, telemetrySpanAddLinksCodeGenerator, 1 } },
    { "end"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DOMJITFunction), NoIntrinsic, { HashTableValue::DOMJITFunctionType, jsTelemetrySpanProtoFuncEnd, &signatureTelemetrySpanEnd } },
    { "spanContext"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsTelemetrySpanProtoFuncSpanContext, 0 } },
    { "enter"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsTelemetrySpanProtoFuncEnter, 0 } },
    { "exit"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsTelemetrySpanProtoFuncExit, 0 } },
    { "traceId"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_traceId, 0 } },
    { "spanId"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_spanId, 0 } },
    { "parentSpanId"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_parentSpanId, 0 } },
    { "traceFlags"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_traceFlags, 0 } },
    { "isRemote"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_isRemote, 0 } },
    { "name"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_name, 0 } },
    { "kind"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_kind, 0 } },
    { "ended"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsTelemetrySpanGetter_ended, 0 } },
};

const ClassInfo JSTelemetrySpanPrototype::s_info = { "Span"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSTelemetrySpanPrototype) };

void JSTelemetrySpanPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSTelemetrySpan::info(), JSTelemetrySpanPrototypeTableValues, *this);
    putDirectWithoutTransition(vm, vm.propertyNames->disposeSymbol, JSFunction::create(vm, globalObject, 0, "[Symbol.dispose]"_s, jsTelemetrySpanProtoFuncDispose, ImplementationVisibility::Public), PropertyAttribute::DontEnum | 0);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSObject* createTelemetrySpanPrototype(VM& vm, Zig::GlobalObject* globalObject)
{
    return JSTelemetrySpanPrototype::create(vm, globalObject, JSTelemetrySpanPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
}

} // namespace Bun
