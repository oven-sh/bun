#include "root.h"

#include "JSTelemetrySpan.h"
#include "BunTelemetry.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include "WebCoreJSBuiltins.h"
#include <JavaScriptCore/DateInstance.h>
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
    BunStrRef key;
    uint8_t kind; // 0 str 1 bool 2 int 3 double 4 array
    BunStrRef str;
    double num;
    int64_t integer;
    const BunAttrRef* items;
    uint32_t nItems;
};
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
    const BunEventRef* events;
    uint32_t nEvents;
    const BunLinkRef* links;
    uint32_t nLinks;
};

extern "C" void Bun__Telemetry__stubStart(Bun::SpanStub* out, const Bun::SpanStub* parent, uint64_t startNs);
extern "C" void Bun__Telemetry__stubWrap(Bun::SpanStub* out, const uint8_t* traceId, const uint8_t* spanId, uint8_t w3cFlags, bool remote);
extern "C" uint64_t Bun__Telemetry__nowNs();
extern "C" uint16_t Bun__Telemetry__userScope();
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

static inline BunStrRef strRef(const String& s)
{
    if (s.isNull() || s.isEmpty())
        return { nullptr, 0, 0 };
    if (s.is8Bit())
        return { s.span8().data(), s.length(), 0 };
    return { s.span16().data(), s.length(), 1 };
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
    Vector<BunAttrRef, 16> attrs;
    Vector<BunAttrRef, 8> arrayItems;
    Vector<String, 16> keep;
};

static bool fillValue(JSGlobalObject* globalObject, AttrScratch& sc, BunAttrRef& out, JSValue v, bool allowArray)
{
    if (v.isString()) {
        auto s = asString(v)->value(globalObject);
        sc.keep.append(s);
        out.kind = 0;
        out.str = strRef(sc.keep.last());
        return true;
    }
    if (v.isInt32()) {
        out.kind = 2;
        out.integer = v.asInt32();
        return true;
    }
    if (v.isNumber()) {
        double d = v.asNumber();
        if (std::isfinite(d) && std::trunc(d) == d && std::abs(d) < 9007199254740992.0) {
            out.kind = 2;
            out.integer = static_cast<int64_t>(d);
        } else {
            out.kind = 3;
            out.num = d;
        }
        return true;
    }
    if (v.isBoolean()) {
        out.kind = 1;
        out.integer = v.asBoolean();
        return true;
    }
    if (v.isBigInt()) {
#if USE(BIGINT32)
        if (v.isBigInt32()) {
            out.kind = 2;
            out.integer = v.bigInt32AsInt32();
            return true;
        }
#endif
        auto* big = v.asHeapBigInt();
        if (big->length() <= 1) {
            out.kind = 2;
            out.integer = JSBigInt::toBigInt64(big);
            return true;
        }
        sc.keep.append(big->toString(globalObject, 10));
        out.kind = 0;
        out.str = strRef(sc.keep.last());
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
                BunAttrRef ref {};
                if (item && fillValue(globalObject, sc, ref, item, false))
                    sc.arrayItems[start + w++] = ref;
            }
            sc.arrayItems.shrink(start + w);
            out.kind = 4;
            out.items = nullptr; // patched after all arrays are gathered (vector may move)
            out.integer = static_cast<int64_t>(start);
            out.nItems = w;
            return true;
        }
    }
    return false;
}

// Gather [k0, v0, k1, v1, ...] with last-write-wins on duplicate keys.
static void gatherAttrs(JSGlobalObject* globalObject, AttrScratch& sc, JSArray* flat, Vector<BunAttrRef, 16>& out)
{
    unsigned n = flat->length() & ~1u;
    for (unsigned i = 0; i < n; i += 2) {
        JSValue k = flat->getIndex(globalObject, i);
        JSValue v = flat->getIndex(globalObject, i + 1);
        if (!k || !k.isString() || !v || v.isUndefinedOrNull())
            continue;
        auto ks = asString(k)->value(globalObject);
        BunAttrRef ref {};
        if (!fillValue(globalObject, sc, ref, v, true))
            continue;
        // Later duplicate wins but keeps the key's original position (so the
        // attribute-count limit drops the right ones).
        bool replaced = false;
        for (auto& e : out) {
            StringView existing = e.key.is16
                ? StringView(std::span(static_cast<const char16_t*>(e.key.ptr), e.key.len))
                : StringView(std::span(static_cast<const Latin1Character*>(e.key.ptr), e.key.len));
            if (existing == StringView(ks)) {
                BunStrRef key = e.key;
                e = ref;
                e.key = key;
                replaced = true;
                break;
            }
        }
        if (replaced)
            continue;
        sc.keep.append(ks);
        ref.key = strRef(sc.keep.last());
        out.append(ref);
    }
}

static void patchArrays(AttrScratch& sc, Vector<BunAttrRef, 16>& attrs)
{
    for (auto& a : attrs) {
        if (a.kind == 4)
            a.items = sc.arrayItems.begin() + static_cast<size_t>(a.integer);
    }
}

// ─── creation entry points ───

extern "C" JSC::EncodedJSValue Bun__TelemetrySpan__createNative(Zig::GlobalObject* globalObject, const SpanStub* stub, uint16_t scope, uint8_t kind, uint64_t native)
{
    return JSValue::encode(JSTelemetrySpan::create(globalObject->vm(), globalObject, *stub, scope, kind, jsNull(), native));
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

// If `parentCell` carries tracestate/baggage, copy them into the child's extra.
static void inheritPropagation(VM& vm, Zig::GlobalObject* globalObject, JSTelemetrySpan* child, JSTelemetrySpan* parentCell)
{
    if (!parentCell)
        return;
    JSValue t = JSValue::decode(Bun__TelemetrySpan__extraString(globalObject, JSValue::encode(parentCell), 't'));
    JSValue b = JSValue::decode(Bun__TelemetrySpan__extraString(globalObject, JSValue::encode(parentCell), 'b'));
    String ts, bg;
    if (parentCell->m_native) {
        Vector<uint8_t, 256> buf;
        for (uint8_t which : { 't', 'b' }) {
            buf.grow(512);
            size_t n = Bun__Telemetry__nativePropagation(parentCell->m_native, which, buf.begin(), buf.size());
            if (n > buf.size()) {
                buf.grow(n);
                n = Bun__Telemetry__nativePropagation(parentCell->m_native, which, buf.begin(), buf.size());
            }
            if (n)
                (which == 't' ? ts : bg) = String::fromUTF8(std::span(buf.begin(), n));
        }
    } else {
        if (t.isString())
            ts = asString(t)->value(globalObject);
        if (b.isString())
            bg = asString(b)->value(globalObject);
    }
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
        BunAttrRef ref {};
        if (!fillValue(globalObject, sc, ref, b, true))
            break;
        RETURN_IF_EXCEPTION(scope, {});
        sc.keep.append(asString(a)->value(globalObject));
        ref.key = strRef(sc.keep.last());
        if (ref.kind == 4)
            ref.items = sc.arrayItems.begin() + static_cast<size_t>(ref.integer);
        Bun__Telemetry__nativeSetAttribute(span->m_native, &ref);
        break;
    }
    case 1: { // setName(name)
        auto s = a.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        BunStrRef r = strRef(s);
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
    if (!endNs)
        endNs = Bun__Telemetry__nowNs();
    span->m_endNs = endNs;
    if (span->m_native) {
        Bun__Telemetry__nativeEnd(span->m_native, endNs);
        return;
    }
    if (!(state & JSTelemetrySpan::StateRecording))
        return;

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    AttrScratch sc;
    Vector<BunAttrRef, 16> attrs;
    JSValue attrsV = span->get(JSTelemetrySpan::Field::Attributes);
    if (auto* flat = attrsV.isCell() ? dynamicDowncast<JSArray>(attrsV.asCell()) : nullptr)
        gatherAttrs(globalObject, sc, flat, attrs);

    JSValue nameV = span->get(JSTelemetrySpan::Field::Name);
    String name = nameV.isString() ? asString(nameV)->value(globalObject) : String();

    uint8_t status = 0;
    String statusMessage, traceState;
    Vector<BunEventRef, 4> events;
    Vector<BunLinkRef, 4> links;
    Vector<Vector<BunAttrRef, 16>, 4> nestedAttrs;
    JSValue extraV = span->get(JSTelemetrySpan::Field::Extra);
    if (extraV.isObject()) {
        JSObject* extra = extraV.getObject();
        auto getField = [&](ASCIILiteral n) -> JSValue {
            JSValue v = extra->getDirect(vm, Identifier::fromString(vm, n));
            return v ? v : jsUndefined();
        };
        JSValue sV = getField("s"_s);
        if (sV.isInt32())
            status = static_cast<uint8_t>(sV.asInt32());
        JSValue mV = getField("m"_s);
        if (mV.isString())
            statusMessage = asString(mV)->value(globalObject);
        JSValue tV = getField("t"_s);
        if (tV.isString())
            traceState = asString(tV)->value(globalObject);
        else if (tV.isObject()) {
            // api TraceState object: serialize()
            JSValue ser = tV.getObject()->get(globalObject, Identifier::fromString(vm, "serialize"_s));
            if (!scope.exception() && ser.isCallable()) {
                MarkedArgumentBuffer noArgs;
                JSValue out = call(globalObject, ser, jsUndefined(), noArgs, "serialize"_s);
                if (!scope.exception() && out.isString())
                    traceState = asString(out)->value(globalObject);
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
                sc.keep.append(asString(en)->value(globalObject));
                BunEventRef ref { strRef(sc.keep.last()), et ? timeInputToNs(globalObject, et) : 0, nullptr, 0 };
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
                sc.keep.append(asString(lt)->value(globalObject));
                BunStrRef tRef = strRef(sc.keep.last());
                sc.keep.append(asString(ls)->value(globalObject));
                BunStrRef sRef = strRef(sc.keep.last());
                BunLinkRef ref { tRef, sRef, static_cast<uint8_t>(lf && lf.isInt32() ? lf.asInt32() : 0), nullptr, 0 };
                auto& na = nestedAttrs[base + i];
                if (auto* flat = la && la.isCell() ? dynamicDowncast<JSArray>(la.asCell()) : nullptr) {
                    gatherAttrs(globalObject, sc, flat, na);
                    ref.nAttrs = na.size();
                }
                links.append(ref);
            }
        }
    }
    if (scope.exception()) [[unlikely]]
        (void)scope.tryClearException();

    // All gathering done: vectors are stable, patch item pointers.
    patchArrays(sc, attrs);
    {
        size_t ei = 0, li = 0, k = 0;
        for (; k < nestedAttrs.size() && ei < events.size(); ++k, ++ei) {
            patchArrays(sc, nestedAttrs[k]);
            events[ei].attrs = nestedAttrs[k].begin();
        }
        for (; k < nestedAttrs.size() && li < links.size(); ++k, ++li) {
            patchArrays(sc, nestedAttrs[k]);
            links[li].attrs = nestedAttrs[k].begin();
        }
    }

    BunEndDesc desc {
        &span->m_stub,
        span->m_scope,
        span->m_kind,
        status,
        endNs,
        strRef(name),
        strRef(statusMessage),
        strRef(traceState),
        attrs.begin(),
        static_cast<uint32_t>(attrs.size()),
        static_cast<uint32_t>(static_cast<uint32_t>(state) >> 8),
        events.begin(),
        static_cast<uint32_t>(events.size()),
        links.begin(),
        static_cast<uint32_t>(links.size()),
    };
    Bun__Telemetry__encodeSpan(&desc);
    // Attributes are on the wire; let them be collected.
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
    if (ts.isObject())
        ctx->putDirect(vm, Identifier::fromString(vm, "traceState"_s), ts);
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
    { "end"_s, static_cast<unsigned>(PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsTelemetrySpanProtoFuncEnd, 1 } },
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
