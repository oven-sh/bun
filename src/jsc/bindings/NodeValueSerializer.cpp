// V8 ValueSerializer wire format implementation on top of JSC.
//
// This is the format Node.js uses for child_process IPC when
// serialization: "advanced" is set. Matching it byte-for-byte is what lets a
// Bun process exchange structured messages with a Node process over IPC.
//
// Reference: v8/src/objects/value-serializer.cc
//            node/lib/v8.js (DefaultSerializer/DefaultDeserializer)
//            node/lib/internal/child_process/serialization.js

#include "root.h"
#include "headers-handwritten.h"
#include "JSBuffer.h"
#include "ZigGlobalObject.h"
#include "JSDOMExceptionHandling.h"
#include "ExceptionCode.h"

#include <JavaScriptCore/BigIntObject.h>
#include <JavaScriptCore/BooleanObject.h>
#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/ErrorPrototype.h>
#include <JavaScriptCore/ErrorType.h>
#include <JavaScriptCore/IterationKind.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSBigInt.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/JSSetInlines.h>
#include <JavaScriptCore/JSSetIterator.h>
#include <JavaScriptCore/JSFinalizationRegistry.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/JSWeakMap.h>
#include <JavaScriptCore/JSWeakObjectRef.h>
#include <JavaScriptCore/JSWeakSet.h>
#include <JavaScriptCore/NumberObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/RegExp.h>
#include <JavaScriptCore/RegExpObject.h>
#include <JavaScriptCore/StringObject.h>
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/YarrFlags.h>
#include <wtf/Vector.h>

namespace Bun {

using namespace JSC;
using namespace WebCore;

// V8 wire format version we emit. Node 26 emits 15.
static constexpr uint32_t kLatestV8Version = 15;
// Oldest wire version this decoder parses correctly. Every tag arm below
// implements the v13+ grammar; earlier versions encoded strings and arrays
// differently, so decoding them with these rules would produce garbage.
static constexpr uint32_t kMinimumV8Version = 13;

enum class V8Tag : uint8_t {
    kVersion = 0xFF,
    kPadding = 0x00,
    kVerifyObjectCount = '?',
    kTheHole = '-',
    kUndefined = '_',
    kNull = '0',
    kTrue = 'T',
    kFalse = 'F',
    kInt32 = 'I',
    kUint32 = 'U',
    kDouble = 'N',
    kBigInt = 'Z',
    kUtf8String = 'S',
    kOneByteString = '"',
    kTwoByteString = 'c',
    kObjectReference = '^',
    kBeginJSObject = 'o',
    kEndJSObject = '{',
    kBeginSparseJSArray = 'a',
    kEndSparseJSArray = '@',
    kBeginDenseJSArray = 'A',
    kEndDenseJSArray = '$',
    kDate = 'D',
    kTrueObject = 'y',
    kFalseObject = 'x',
    kNumberObject = 'n',
    kBigIntObject = 'z',
    kStringObject = 's',
    kRegExp = 'R',
    kBeginJSMap = ';',
    kEndJSMap = ':',
    kBeginJSSet = '\'',
    kEndJSSet = ',',
    kArrayBuffer = 'B',
    kResizableArrayBuffer = '~',
    kArrayBufferTransfer = 't',
    kArrayBufferView = 'V',
    kSharedArrayBuffer = 'u',
    kHostObject = '\\',
    kError = 'r',
};

enum class V8ErrorTag : uint8_t {
    kEvalErrorPrototype = 'E',
    kRangeErrorPrototype = 'R',
    kReferenceErrorPrototype = 'F',
    kSyntaxErrorPrototype = 'S',
    kTypeErrorPrototype = 'T',
    kUriErrorPrototype = 'U',
    kMessage = 'm',
    kCause = 'c',
    kStack = 's',
    kEnd = '.',
};

enum class V8ArrayBufferViewTag : uint8_t {
    kInt8Array = 'b',
    kUint8Array = 'B',
    kUint8ClampedArray = 'C',
    kInt16Array = 'w',
    kUint16Array = 'W',
    kInt32Array = 'd',
    kUint32Array = 'D',
    kFloat16Array = 'h',
    kFloat32Array = 'f',
    kFloat64Array = 'F',
    kBigInt64Array = 'q',
    kBigUint64Array = 'Q',
    kDataView = '?',
};

// Node's DefaultSerializer writes typed arrays as host objects with this index.
// Index 10 is Buffer.
enum NodeViewTypeIndex : uint32_t {
    kNodeInt8Array = 0,
    kNodeUint8Array = 1,
    kNodeUint8ClampedArray = 2,
    kNodeInt16Array = 3,
    kNodeUint16Array = 4,
    kNodeInt32Array = 5,
    kNodeUint32Array = 6,
    kNodeFloat32Array = 7,
    kNodeFloat64Array = 8,
    kNodeDataView = 9,
    kNodeBuffer = 10,
    kNodeBigInt64Array = 11,
    kNodeBigUint64Array = 12,
    kNodeFloat16Array = 13,
};

// Node's ChildProcessSerializer wraps each host object with a discriminator.
static constexpr uint32_t kChildProcessArrayBufferViewTag = 0;
static constexpr uint32_t kChildProcessNotArrayBufferViewTag = 1;

// ──────────────────────────────────────────────────────────────────────────
// Serializer
// ──────────────────────────────────────────────────────────────────────────

class NodeValueSerializer {
public:
    NodeValueSerializer(JSGlobalObject* globalObject, bool forIPC)
        : m_globalObject(globalObject)
        , m_vm(JSC::getVM(globalObject))
        , m_forIPC(forIPC)
    {
    }

    void writeHeader()
    {
        writeTag(V8Tag::kVersion);
        writeVarint(kLatestV8Version);
    }

    bool writeValue(JSValue value)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        // writeValue recurses once per level of the object graph, so the real
        // bound is the native stack, not a fixed depth constant. A deeply
        // nested value must throw a catchable RangeError, never overflow.
        if (!m_vm.isSafeToRecurse()) [[unlikely]] {
            throwStackOverflowError(m_globalObject, scope);
            return false;
        }
        bool result = writeValueImpl(value);
        RETURN_IF_EXCEPTION(scope, false);
        return result;
    }

    Vector<uint8_t>&& release() { return WTF::move(m_buffer); }

    void reserveHeader(size_t bytes) { m_buffer.grow(bytes); }

private:
    void writeTag(V8Tag tag) { m_buffer.append(static_cast<uint8_t>(tag)); }
    void writeByte(uint8_t b) { m_buffer.append(b); }

    void writeVarint(uint32_t value)
    {
        do {
            uint8_t byte = value & 0x7F;
            value >>= 7;
            if (value) byte |= 0x80;
            m_buffer.append(byte);
        } while (value);
    }

    void writeZigZag(int32_t value)
    {
        writeVarint((static_cast<uint32_t>(value) << 1) ^ static_cast<uint32_t>(value >> 31));
    }

    void writeDouble(double value)
    {
        uint64_t bits;
        memcpy(&bits, &value, sizeof(bits));
        for (int i = 0; i < 8; i++) {
            m_buffer.append(static_cast<uint8_t>(bits >> (i * 8)));
        }
    }

    void writeRawBytes(const uint8_t* data, size_t length)
    {
        m_buffer.append(std::span<const uint8_t>(data, length));
    }

    // Takes the caller's ThrowScope so the throw is charged against the scope
    // whose function actually returns after it (required by
    // BUN_JSC_validateExceptionChecks; a nested scope here would leave the
    // caller's scope looking unchecked).
    void throwDataCloneError(JSC::ThrowScope& scope, const String& msg)
    {
        throwException(m_globalObject, scope, createDOMException(m_globalObject, ExceptionCode::DataCloneError, msg));
    }

    std::optional<uint32_t> trackObject(JSObject* obj)
    {
        auto result = m_objectIds.add(JSValue::encode(obj), m_nextObjectId);
        if (!result.isNewEntry)
            return result.iterator->value;
        // Root the object: m_objectIds only records its address, and a later
        // getter can sever the last reference mid-walk. Without a root the GC
        // could reclaim it and alias a freshly allocated object onto this id.
        m_gcBuffer.appendWithCrashOnOverflow(obj);
        m_nextObjectId++;
        return std::nullopt;
    }

    bool writeValueImpl(JSValue value)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);

        if (value.isEmpty() || value.isUndefined()) {
            writeTag(V8Tag::kUndefined);
            return true;
        }
        if (value.isNull()) {
            writeTag(V8Tag::kNull);
            return true;
        }
        if (value.isBoolean()) {
            writeTag(value.isTrue() ? V8Tag::kTrue : V8Tag::kFalse);
            return true;
        }
        if (value.isInt32()) {
            writeTag(V8Tag::kInt32);
            writeZigZag(value.asInt32());
            return true;
        }
        if (value.isNumber()) {
            double d = value.asNumber();
            // double -> int32_t is UB for NaN, +/-Infinity, and out-of-range
            // values, so prove d is in range (in the wide type) before casting.
            // NaN fails both comparisons and correctly takes the kDouble path.
            if (d >= static_cast<double>(INT32_MIN) && d <= static_cast<double>(INT32_MAX)) {
                int32_t i = static_cast<int32_t>(d);
                if (static_cast<double>(i) == d && !(i == 0 && std::signbit(d))) {
                    writeTag(V8Tag::kInt32);
                    writeZigZag(i);
                    return true;
                }
            }
            writeTag(V8Tag::kDouble);
            writeDouble(d);
            return true;
        }
#if USE(BIGINT32)
        if (value.isBigInt32()) {
            writeTag(V8Tag::kBigInt);
            writeBigIntContents32(value.bigInt32AsInt32());
            return true;
        }
#endif
        if (value.isString())
            RELEASE_AND_RETURN(scope, writeString(value));

        // Heap BigInts are JSCells, not objects; handle them before asObject.
        if (value.isHeapBigInt()) {
            writeTag(V8Tag::kBigInt);
            writeBigIntContents(value.asHeapBigInt());
            return true;
        }

        if (!value.isObject()) {
            throwDataCloneError(scope, "unserializable value"_s);
            return false;
        }

        JSObject* obj = asObject(value);

        if (auto existing = trackObject(obj)) {
            writeTag(V8Tag::kObjectReference);
            writeVarint(*existing);
            return true;
        }

        if (auto* date = dynamicDowncast<DateInstance>(obj)) {
            writeTag(V8Tag::kDate);
            writeDouble(date->internalNumber());
            return true;
        }

        if (auto* booleanObj = dynamicDowncast<BooleanObject>(obj)) {
            // internalValue() of a BooleanObject is always a JSBoolean.
            writeTag(booleanObj->internalValue().isTrue() ? V8Tag::kTrueObject : V8Tag::kFalseObject);
            return true;
        }

        if (auto* numberObj = dynamicDowncast<NumberObject>(obj)) {
            writeTag(V8Tag::kNumberObject);
            writeDouble(numberObj->internalValue().asNumber());
            return true;
        }

        if (auto* stringObj = dynamicDowncast<StringObject>(obj)) {
            writeTag(V8Tag::kStringObject);
            RELEASE_AND_RETURN(scope, writeString(stringObj->internalValue()));
        }

        if (auto* bigIntObj = dynamicDowncast<BigIntObject>(obj)) {
            writeTag(V8Tag::kBigIntObject);
            JSValue inner = bigIntObj->internalValue();
#if USE(BIGINT32)
            if (inner.isBigInt32()) {
                writeBigIntContents32(inner.bigInt32AsInt32());
                return true;
            }
#endif
            writeBigIntContents(inner.asHeapBigInt());
            return true;
        }

        if (auto* regExp = dynamicDowncast<RegExpObject>(obj)) {
            writeTag(V8Tag::kRegExp);
            writeStringView(StringView(regExp->regExp()->pattern()));
            writeVarint(v8RegExpFlags(regExp->regExp()->flags()));
            return true;
        }

        if (auto* view = dynamicDowncast<JSArrayBufferView>(obj))
            RELEASE_AND_RETURN(scope, writeHostArrayBufferView(view));

        if (auto* arrayBuffer = dynamicDowncast<JSArrayBuffer>(obj))
            RELEASE_AND_RETURN(scope, writeArrayBuffer(arrayBuffer));

        if (auto* map = dynamicDowncast<JSMap>(obj))
            RELEASE_AND_RETURN(scope, writeMap(map));

        if (auto* set = dynamicDowncast<JSSet>(obj))
            RELEASE_AND_RETURN(scope, writeSet(set));

        if (auto* err = dynamicDowncast<ErrorInstance>(obj))
            RELEASE_AND_RETURN(scope, writeError(err));

        bool isArr = JSC::isArray(m_globalObject, value);
        RETURN_IF_EXCEPTION(scope, false);
        if (isArr)
            RELEASE_AND_RETURN(scope, writeArray(obj));

        // Types V8 refuses to clone. Without this they'd fall through to
        // writePlainObject and silently arrive as `{}`.
        if (obj->isCallable() || obj->inherits<JSC::JSPromise>()
            || obj->inherits<JSC::JSWeakMap>() || obj->inherits<JSC::JSWeakSet>()
            || obj->inherits<JSC::JSWeakObjectRef>() || obj->inherits<JSC::JSFinalizationRegistry>()) {
            throwDataCloneError(scope, "The object could not be cloned."_s);
            return false;
        }

        RELEASE_AND_RETURN(scope, writePlainObject(obj));
    }

    bool writeString(JSValue value)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSString* jsString = value.toString(m_globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        auto view = jsString->view(m_globalObject);
        RETURN_IF_EXCEPTION(scope, false);
        writeStringView(view);
        return true;
    }

    void writeStringView(StringView view)
    {
        if (view.is8Bit()) {
            auto span = view.span8();
            writeTag(V8Tag::kOneByteString);
            writeVarint(static_cast<uint32_t>(span.size()));
            writeRawBytes(reinterpret_cast<const uint8_t*>(span.data()), span.size());
        } else {
            auto span = view.span16();
            uint32_t byteLength = static_cast<uint32_t>(span.size()) * 2;
            // V8 pads so the UTF-16 payload starts at an even offset.
            uint32_t varintLen = 1;
            for (uint32_t v = byteLength >> 7; v; v >>= 7)
                varintLen++;
            if ((m_buffer.size() + 1 + varintLen) & 1)
                writeTag(V8Tag::kPadding);
            writeTag(V8Tag::kTwoByteString);
            writeVarint(byteLength);
            const char16_t* data = span.data();
            for (size_t i = 0; i < span.size(); i++) {
                m_buffer.append(static_cast<uint8_t>(data[i] & 0xFF));
                m_buffer.append(static_cast<uint8_t>(data[i] >> 8));
            }
        }
    }

    void writeBigIntContents(JSBigInt* bigInt)
    {
        // V8: varint bitfield (bit 0 = sign, bits 1.. = byteLength), then LE digit bytes.
        static_assert(sizeof(JSBigInt::Digit) == sizeof(uint64_t));
        uint32_t digitCount = bigInt->length();
        uint32_t byteLength = digitCount * 8;
        uint32_t bitfield = (byteLength << 1) | (bigInt->sign() ? 1 : 0);
        writeVarint(bitfield);
        for (uint32_t i = 0; i < digitCount; i++) {
            uint64_t digit = bigInt->digit(i);
            for (int b = 0; b < 8; b++)
                m_buffer.append(static_cast<uint8_t>(digit >> (b * 8)));
        }
    }

#if USE(BIGINT32)
    void writeBigIntContents32(int32_t value)
    {
        if (value == 0) {
            writeVarint(0);
            return;
        }
        bool negative = value < 0;
        uint64_t magnitude = negative ? (0ULL - static_cast<uint64_t>(static_cast<int64_t>(value))) : static_cast<uint64_t>(value);
        writeVarint((8u << 1) | (negative ? 1 : 0));
        for (int b = 0; b < 8; b++)
            m_buffer.append(static_cast<uint8_t>(magnitude >> (b * 8)));
    }
#endif

    static uint32_t v8RegExpFlags(OptionSet<Yarr::Flags> flags)
    {
        uint32_t result = 0;
        if (flags.contains(Yarr::Flags::Global)) result |= 1 << 0;
        if (flags.contains(Yarr::Flags::IgnoreCase)) result |= 1 << 1;
        if (flags.contains(Yarr::Flags::Multiline)) result |= 1 << 2;
        if (flags.contains(Yarr::Flags::Sticky)) result |= 1 << 3;
        if (flags.contains(Yarr::Flags::Unicode)) result |= 1 << 4;
        if (flags.contains(Yarr::Flags::DotAll)) result |= 1 << 5;
        if (flags.contains(Yarr::Flags::HasIndices)) result |= 1 << 7;
        if (flags.contains(Yarr::Flags::UnicodeSets)) result |= 1 << 8;
        return result;
    }

    bool writeHostArrayBufferView(JSArrayBufferView* view)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        if (view->isDetached()) {
            throwDataCloneError(scope, "An ArrayBuffer is detached and could not be cloned."_s);
            return false;
        }
        // The wire format stores the length as a 32-bit varint. Narrowing a
        // larger size_t would silently truncate, so refuse it like V8 does.
        size_t byteLength = view->byteLength();
        if (byteLength > UINT32_MAX) {
            throwDataCloneError(scope, "An ArrayBuffer view is larger than 4 GiB and could not be cloned."_s);
            return false;
        }
        writeTag(V8Tag::kHostObject);
        if (m_forIPC)
            writeVarint(kChildProcessArrayBufferViewTag);
        uint32_t typeIndex;
        switch (typedArrayType(view->type())) {
        case TypeInt8:
            typeIndex = kNodeInt8Array;
            break;
        case TypeUint8Clamped:
            typeIndex = kNodeUint8ClampedArray;
            break;
        case TypeInt16:
            typeIndex = kNodeInt16Array;
            break;
        case TypeUint16:
            typeIndex = kNodeUint16Array;
            break;
        case TypeInt32:
            typeIndex = kNodeInt32Array;
            break;
        case TypeUint32:
            typeIndex = kNodeUint32Array;
            break;
        case TypeFloat16:
            typeIndex = kNodeFloat16Array;
            break;
        case TypeFloat32:
            typeIndex = kNodeFloat32Array;
            break;
        case TypeFloat64:
            typeIndex = kNodeFloat64Array;
            break;
        case TypeBigInt64:
            typeIndex = kNodeBigInt64Array;
            break;
        case TypeBigUint64:
            typeIndex = kNodeBigUint64Array;
            break;
        case TypeDataView:
            typeIndex = kNodeDataView;
            break;
        case TypeUint8:
        default:
            typeIndex = JSBuffer__isBuffer(m_globalObject, JSValue::encode(view)) ? kNodeBuffer : kNodeUint8Array;
            break;
        }
        writeVarint(typeIndex);
        writeVarint(static_cast<uint32_t>(byteLength));
        writeRawBytes(static_cast<const uint8_t*>(view->vector()), byteLength);
        return true;
    }

    bool writeArrayBuffer(JSArrayBuffer* jsBuffer)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        ArrayBuffer* buffer = jsBuffer->impl();
        if (!buffer || buffer->isDetached()) {
            throwDataCloneError(scope, "An ArrayBuffer is detached and could not be cloned."_s);
            return false;
        }
        if (buffer->isShared()) {
            throwDataCloneError(scope, "A SharedArrayBuffer could not be cloned over IPC."_s);
            return false;
        }
        // Both lengths travel as 32-bit varints; see writeHostArrayBufferView.
        size_t byteLength = buffer->byteLength();
        size_t maxByteLength = buffer->maxByteLength().value_or(byteLength);
        if (byteLength > UINT32_MAX || maxByteLength > UINT32_MAX) {
            throwDataCloneError(scope, "An ArrayBuffer is larger than 4 GiB and could not be cloned."_s);
            return false;
        }
        if (buffer->isResizableOrGrowableShared()) {
            writeTag(V8Tag::kResizableArrayBuffer);
            writeVarint(static_cast<uint32_t>(byteLength));
            writeVarint(static_cast<uint32_t>(maxByteLength));
        } else {
            writeTag(V8Tag::kArrayBuffer);
            writeVarint(static_cast<uint32_t>(byteLength));
        }
        writeRawBytes(static_cast<const uint8_t*>(buffer->data()), byteLength);
        return true;
    }

    bool writeMap(JSMap* map)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        writeTag(V8Tag::kBeginJSMap);
        JSMapIterator* iterator = JSMapIterator::create(m_vm, m_globalObject->mapIteratorStructure(), map, IterationKind::Entries);
        RETURN_IF_EXCEPTION(scope, false);
        JSC::EnsureStillAliveScope keepIter(iterator);
        uint32_t count = 0;
        JSValue key, value;
        while (iterator->nextKeyValue(m_globalObject, key, value)) {
            bool ok = writeValue(key);
            RETURN_IF_EXCEPTION(scope, false);
            if (!ok) return false;
            ok = writeValue(value);
            RETURN_IF_EXCEPTION(scope, false);
            if (!ok) return false;
            count += 2;
        }
        RETURN_IF_EXCEPTION(scope, false);
        writeTag(V8Tag::kEndJSMap);
        writeVarint(count);
        return true;
    }

    bool writeSet(JSSet* set)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        writeTag(V8Tag::kBeginJSSet);
        JSSetIterator* iterator = JSSetIterator::create(m_vm, m_globalObject->setIteratorStructure(), set, IterationKind::Keys);
        RETURN_IF_EXCEPTION(scope, false);
        JSC::EnsureStillAliveScope keepIter(iterator);
        uint32_t count = 0;
        JSValue key;
        while (iterator->next(m_globalObject, key)) {
            bool ok = writeValue(key);
            RETURN_IF_EXCEPTION(scope, false);
            if (!ok) return false;
            count++;
        }
        RETURN_IF_EXCEPTION(scope, false);
        writeTag(V8Tag::kEndJSSet);
        writeVarint(count);
        return true;
    }

    bool writeError(ErrorInstance* err)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        writeTag(V8Tag::kError);
        switch (err->errorType()) {
        case ErrorType::EvalError:
            writeByte(static_cast<uint8_t>(V8ErrorTag::kEvalErrorPrototype));
            break;
        case ErrorType::RangeError:
            writeByte(static_cast<uint8_t>(V8ErrorTag::kRangeErrorPrototype));
            break;
        case ErrorType::ReferenceError:
            writeByte(static_cast<uint8_t>(V8ErrorTag::kReferenceErrorPrototype));
            break;
        case ErrorType::SyntaxError:
            writeByte(static_cast<uint8_t>(V8ErrorTag::kSyntaxErrorPrototype));
            break;
        case ErrorType::TypeError:
            writeByte(static_cast<uint8_t>(V8ErrorTag::kTypeErrorPrototype));
            break;
        case ErrorType::URIError:
            writeByte(static_cast<uint8_t>(V8ErrorTag::kUriErrorPrototype));
            break;
        default:
            break;
        }
        // Sub-tag order must match V8's WriteJSError exactly: message, stack,
        // then cause LAST. V8's reader is order-strict (it walks these
        // linearly, not in a loop) and rejects cause-before-stack, and it
        // constructs the Error after the stack so a self-referential cause
        // can resolve to it.
        JSValue messageValue = err->getDirect(m_vm, m_vm.propertyNames->message);
        if (messageValue && messageValue.isString()) {
            writeByte(static_cast<uint8_t>(V8ErrorTag::kMessage));
            if (!writeString(messageValue))
                return false;
            RETURN_IF_EXCEPTION(scope, false);
        }
        JSValue stackValue = err->get(m_globalObject, m_vm.propertyNames->stack);
        RETURN_IF_EXCEPTION(scope, false);
        if (stackValue && stackValue.isString()) {
            writeByte(static_cast<uint8_t>(V8ErrorTag::kStack));
            if (!writeString(stackValue))
                return false;
            RETURN_IF_EXCEPTION(scope, false);
        }
        // V8 gates kCause on HasOwnProperty, so an inherited
        // Error.prototype.cause is never emitted (but an own
        // `cause: undefined` is serialized as kCause kUndefined).
        JSValue causeValue = getOwnProperty(err, m_vm.propertyNames->cause);
        RETURN_IF_EXCEPTION(scope, false);
        if (causeValue) {
            writeByte(static_cast<uint8_t>(V8ErrorTag::kCause));
            bool ok = writeValue(causeValue);
            RETURN_IF_EXCEPTION(scope, false);
            if (!ok) return false;
        }
        writeByte(static_cast<uint8_t>(V8ErrorTag::kEnd));
        return true;
    }

    // Own-only property read. An earlier getter on the same object can delete
    // a later name out of the snapshot; V8 skips such names
    // (`LookupIterator::OWN` + "do not serialize it") where a prototype-walking
    // `obj->get()` would emit an `undefined` (or a leaked inherited value).
    // Returns an empty JSValue when the property is gone, matching
    // CloneSerializer::getProperty in SerializedScriptValue.cpp.
    JSValue getOwnProperty(JSObject* object, const Identifier& propertyName)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        PropertySlot slot(object, PropertySlot::InternalMethodType::Get);
        bool found = object->methodTable()->getOwnPropertySlot(object, m_globalObject, propertyName, slot);
        RETURN_IF_EXCEPTION(scope, {});
        if (!found)
            return {};
        RELEASE_AND_RETURN(scope, slot.getValue(m_globalObject, propertyName));
    }

    // Shared body of writeArray / writePlainObject: emit the key then the
    // value for every own name still present, skipping ones a getter removed.
    // `skipLength` is set only for arrays, whose `length` is not a data
    // property; a plain object's own `length` key is serialized normally.
    bool writeOwnProperties(JSObject* obj, const PropertyNameArrayBuilder& names, bool skipLength, uint32_t& propsWritten)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        propsWritten = 0;
        for (auto& name : names) {
            if (skipLength && name == m_vm.propertyNames->length) continue;
            JSValue propValue = getOwnProperty(obj, name);
            RETURN_IF_EXCEPTION(scope, false);
            if (!propValue) continue;
            if (auto index = parseIndex(name)) {
                writeTag(V8Tag::kUint32);
                writeVarint(*index);
            } else {
                writeStringView(StringView(name.string()));
            }
            bool ok = writeValue(propValue);
            RETURN_IF_EXCEPTION(scope, false);
            if (!ok) return false;
            propsWritten++;
        }
        return true;
    }

    bool writeArray(JSObject* array)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        uint64_t length64 = toLength(m_globalObject, array);
        RETURN_IF_EXCEPTION(scope, false);
        uint32_t length = length64 > UINT32_MAX ? UINT32_MAX : static_cast<uint32_t>(length64);

        // The sparse form handles holes and extra named properties uniformly.
        writeTag(V8Tag::kBeginSparseJSArray);
        writeVarint(length);

        // Enumerate own enumerable keys like V8's sparse path, rather than
        // probing every index in 0..length: that would make new Array(1e8)
        // block the event loop and serialize inherited indices as own.
        PropertyNameArrayBuilder names(m_vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        array->methodTable()->getOwnPropertyNames(array, m_globalObject, names, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
        uint32_t propsWritten = 0;
        bool ok = writeOwnProperties(array, names, /* skipLength */ true, propsWritten);
        RETURN_IF_EXCEPTION(scope, false);
        if (!ok) return false;

        writeTag(V8Tag::kEndSparseJSArray);
        writeVarint(propsWritten);
        writeVarint(length);
        return true;
    }

    bool writePlainObject(JSObject* obj)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        writeTag(V8Tag::kBeginJSObject);
        PropertyNameArrayBuilder names(m_vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
        obj->methodTable()->getOwnPropertyNames(obj, m_globalObject, names, DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
        uint32_t propsWritten = 0;
        bool ok = writeOwnProperties(obj, names, /* skipLength */ false, propsWritten);
        RETURN_IF_EXCEPTION(scope, false);
        if (!ok) return false;
        writeTag(V8Tag::kEndJSObject);
        writeVarint(propsWritten);
        return true;
    }

    JSGlobalObject* m_globalObject;
    VM& m_vm;
    bool m_forIPC;
    Vector<uint8_t> m_buffer;
    HashMap<EncodedJSValue, uint32_t> m_objectIds;
    // GC roots for the keys of m_objectIds; see trackObject.
    MarkedArgumentBuffer m_gcBuffer;
    uint32_t m_nextObjectId { 0 };
};

// ──────────────────────────────────────────────────────────────────────────
// Deserializer
// ──────────────────────────────────────────────────────────────────────────

class NodeValueDeserializer {
public:
    NodeValueDeserializer(JSGlobalObject* globalObject, const uint8_t* data, size_t length, bool forIPC)
        : m_globalObject(globalObject)
        , m_vm(JSC::getVM(globalObject))
        , m_end(data + length)
        , m_position(data)
        , m_forIPC(forIPC)
    {
    }

    bool readHeader()
    {
        auto tag = peekTag();
        if (!tag || *tag != V8Tag::kVersion) return false;
        m_position++;
        auto version = readVarint();
        if (!version) return false;
        m_version = *version;
        // Deliberately NOT V8's `version > kLatestVersion` check. V8 can
        // reject newer-than-self because its writer and reader move in
        // lockstep; this is a follower, so hard-capping at 15 would fail
        // every Bun<->Node frame the day Node ships a v16 V8, instead of
        // only frames that use a genuinely new tag (which the unknown-tag
        // path already rejects). Versions below kMinimumV8Version ARE
        // rejected: those grammars differ and would silently mis-parse.
        return m_version >= kMinimumV8Version;
    }

    JSValue readValue()
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        // readValue recurses once per nesting level, and nesting costs the
        // peer as little as two bytes per level, so a fixed depth cap would
        // still let a hostile payload exhaust the native stack. Bound by the
        // real stack instead and surface a catchable error.
        if (!m_vm.isSafeToRecurse()) [[unlikely]] {
            throwStackOverflowError(m_globalObject, scope);
            return {};
        }
        JSValue result = readValueImpl();
        RETURN_IF_EXCEPTION(scope, {});
        return result;
    }

private:
    // See NodeValueSerializer::throwDataCloneError for why the caller's
    // ThrowScope is taken instead of declaring a nested one here.
    void throwFormatError(JSC::ThrowScope& scope)
    {
        throwException(m_globalObject, scope, createDOMException(m_globalObject, ExceptionCode::DataCloneError, "Unable to deserialize cloned data."_s));
    }

    std::optional<V8Tag> peekTag()
    {
        while (m_position < m_end && *m_position == static_cast<uint8_t>(V8Tag::kPadding))
            m_position++;
        if (m_position >= m_end) return std::nullopt;
        return static_cast<V8Tag>(*m_position);
    }

    std::optional<V8Tag> readTag()
    {
        auto tag = peekTag();
        if (tag) m_position++;
        return tag;
    }

    std::optional<uint8_t> readByte()
    {
        if (m_position >= m_end) return std::nullopt;
        return *m_position++;
    }

    std::optional<uint32_t> readVarint()
    {
        uint32_t value = 0;
        unsigned shift = 0;
        while (m_position < m_end) {
            uint8_t byte = *m_position++;
            value |= static_cast<uint32_t>(byte & 0x7F) << shift;
            if (!(byte & 0x80)) return value;
            shift += 7;
            if (shift >= 35) return std::nullopt;
        }
        return std::nullopt;
    }

    std::optional<int32_t> readZigZag()
    {
        auto u = readVarint();
        if (!u) return std::nullopt;
        return static_cast<int32_t>((*u >> 1) ^ (0U - (*u & 1)));
    }

    std::optional<double> readDouble()
    {
        if (static_cast<size_t>(m_end - m_position) < 8) return std::nullopt;
        uint64_t bits = 0;
        for (int i = 0; i < 8; i++)
            bits |= static_cast<uint64_t>(*m_position++) << (i * 8);
        double result;
        memcpy(&result, &bits, sizeof(result));
        return result;
    }

    const uint8_t* readRawBytes(size_t length)
    {
        if (static_cast<size_t>(m_end - m_position) < length) return nullptr;
        const uint8_t* result = m_position;
        m_position += length;
        return result;
    }

    JSValue trackObject(JSObject* obj)
    {
        m_objectIds.append(JSValue(obj));
        return obj;
    }

    JSValue readValueImpl()
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto tag = readTag();
        if (!tag) {
            throwFormatError(scope);
            return {};
        }

        switch (*tag) {
        case V8Tag::kUndefined:
            return jsUndefined();
        case V8Tag::kNull:
            return jsNull();
        case V8Tag::kTrue:
            return jsBoolean(true);
        case V8Tag::kFalse:
            return jsBoolean(false);
        // kTheHole is only legal inside a dense array's element list, where
        // readDenseArray consumes it via peekTag before calling readValue.
        // Anywhere else V8 rejects the frame, so it falls to throwFormatError.
        case V8Tag::kInt32: {
            auto v = readZigZag();
            if (!v) break;
            return jsNumber(*v);
        }
        case V8Tag::kUint32: {
            auto v = readVarint();
            if (!v) break;
            return jsNumber(*v);
        }
        case V8Tag::kDouble: {
            auto v = readDouble();
            if (!v) break;
            return jsNumber(purifyNaN(*v));
        }
        case V8Tag::kBigInt:
            RELEASE_AND_RETURN(scope, readBigInt());
        case V8Tag::kUtf8String: {
            auto len = readVarint();
            if (!len) break;
            const uint8_t* bytes = readRawBytes(*len);
            if (!bytes) break;
            return jsString(m_vm, String::fromUTF8ReplacingInvalidSequences(std::span(bytes, *len)));
        }
        case V8Tag::kOneByteString:
            RELEASE_AND_RETURN(scope, readOneByteString());
        case V8Tag::kTwoByteString:
            RELEASE_AND_RETURN(scope, readTwoByteString());
        case V8Tag::kObjectReference: {
            auto id = readVarint();
            if (!id || *id >= m_objectIds.size()) break;
            JSValue referenced = m_objectIds.at(*id);
            // V8's ReadObject consumes a trailing kArrayBufferView after ANY
            // tag that resolved to an ArrayBuffer, including an object
            // reference: a raw v8.Serializer emits the second view over an
            // already-seen buffer as `^<id> V<subtag>...`. Without this peek
            // the orphaned 'V' is read as the parent's next value and rejects
            // the whole frame.
            if (JSObject* referencedObj = referenced.getObject()) {
                if (auto* jsBuffer = dynamicDowncast<JSArrayBuffer>(referencedObj)) {
                    auto next = peekTag();
                    if (next && *next == V8Tag::kArrayBufferView) {
                        m_position++;
                        RELEASE_AND_RETURN(scope, readArrayBufferView(jsBuffer));
                    }
                }
            }
            return referenced;
        }
        case V8Tag::kBeginJSObject:
            RELEASE_AND_RETURN(scope, readPlainObject());
        case V8Tag::kBeginSparseJSArray:
            RELEASE_AND_RETURN(scope, readSparseArray());
        case V8Tag::kBeginDenseJSArray:
            RELEASE_AND_RETURN(scope, readDenseArray());
        case V8Tag::kDate: {
            auto d = readDouble();
            if (!d) break;
            DateInstance* date = DateInstance::create(m_vm, m_globalObject->dateStructure(), *d);
            return trackObject(date);
        }
        case V8Tag::kTrueObject:
        case V8Tag::kFalseObject: {
            BooleanObject* obj = BooleanObject::create(m_vm, m_globalObject->booleanObjectStructure());
            obj->setInternalValue(m_vm, jsBoolean(*tag == V8Tag::kTrueObject));
            return trackObject(obj);
        }
        case V8Tag::kNumberObject: {
            auto d = readDouble();
            if (!d) break;
            NumberObject* obj = constructNumber(m_globalObject, jsNumber(purifyNaN(*d)));
            RETURN_IF_EXCEPTION(scope, {});
            return trackObject(obj);
        }
        case V8Tag::kStringObject: {
            JSValue inner = readValue();
            RETURN_IF_EXCEPTION(scope, {});
            if (!inner || !inner.isString()) break;
            StringObject* obj = StringObject::create(m_vm, m_globalObject->stringObjectStructure(), asString(inner));
            return trackObject(obj);
        }
        case V8Tag::kBigIntObject: {
            JSValue inner = readBigInt();
            RETURN_IF_EXCEPTION(scope, {});
            if (!inner) break;
            BigIntObject* obj = BigIntObject::create(m_vm, m_globalObject, inner);
            RETURN_IF_EXCEPTION(scope, {});
            return trackObject(obj);
        }
        case V8Tag::kRegExp:
            RELEASE_AND_RETURN(scope, readRegExp());
        case V8Tag::kBeginJSMap:
            RELEASE_AND_RETURN(scope, readMap());
        case V8Tag::kBeginJSSet:
            RELEASE_AND_RETURN(scope, readSet());
        case V8Tag::kArrayBuffer:
            RELEASE_AND_RETURN(scope, readArrayBuffer(false));
        case V8Tag::kResizableArrayBuffer:
            RELEASE_AND_RETURN(scope, readArrayBuffer(true));
        case V8Tag::kHostObject:
            RELEASE_AND_RETURN(scope, readHostObject());
        case V8Tag::kError:
            RELEASE_AND_RETURN(scope, readError());
        case V8Tag::kVerifyObjectCount: {
            readVarint();
            RELEASE_AND_RETURN(scope, readValue());
        }
        default:
            break;
        }

        throwFormatError(scope);
        return {};
    }

    JSValue readOneByteString()
    {
        auto len = readVarint();
        if (!len) return {};
        const uint8_t* bytes = readRawBytes(*len);
        if (!bytes) return {};
        return jsString(m_vm, String(std::span<const Latin1Character>(reinterpret_cast<const Latin1Character*>(bytes), *len)));
    }

    JSValue readTwoByteString()
    {
        auto byteLen = readVarint();
        if (!byteLen || (*byteLen & 1)) return {};
        const uint8_t* bytes = readRawBytes(*byteLen);
        if (!bytes) return {};
        size_t charLen = *byteLen / 2;
        Vector<char16_t> chars;
        if (!chars.tryReserveCapacity(charLen)) return {};
        for (size_t i = 0; i < charLen; i++)
            chars.append(static_cast<char16_t>(bytes[i * 2]) | (static_cast<char16_t>(bytes[i * 2 + 1]) << 8));
        return jsString(m_vm, String(WTF::move(chars)));
    }

    JSValue readBigInt()
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto bitfield = readVarint();
        if (!bitfield) return {};
        bool sign = *bitfield & 1;
        uint32_t byteLength = *bitfield >> 1;
        const uint8_t* bytes = readRawBytes(byteLength);
        if (!bytes) return {};
        if (byteLength == 0) {
#if USE(BIGINT32)
            return jsBigInt32(0);
#else
            JSBigInt* zero = JSBigInt::tryCreateZero(m_vm);
            if (!zero) {
                throwOutOfMemoryError(m_globalObject, scope);
                return {};
            }
            return zero;
#endif
        }
        static_assert(sizeof(JSBigInt::Digit) == sizeof(uint64_t));
        uint32_t digitCount = (byteLength + 7) / 8;
        Vector<JSBigInt::Digit, 16> digits;
        if (!digits.tryReserveCapacity(digitCount)) {
            throwOutOfMemoryError(m_globalObject, scope);
            return {};
        }
        for (uint32_t d = 0; d < digitCount; d++) {
            uint64_t digit = 0;
            for (uint32_t b = 0; b < 8; b++) {
                uint32_t idx = d * 8 + b;
                if (idx < byteLength)
                    digit |= static_cast<uint64_t>(bytes[idx]) << (b * 8);
            }
            digits.append(digit);
        }
        auto* bigInt = JSBigInt::tryCreateFrom(nullptr, m_vm, sign, digits.span());
        if (!bigInt) {
            throwOutOfMemoryError(m_globalObject, scope);
            return {};
        }
        return tryConvertToBigInt32(bigInt);
    }

    JSValue readRegExp()
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSValue pattern = readValue();
        RETURN_IF_EXCEPTION(scope, {});
        if (!pattern || !pattern.isString()) return {};
        auto flags = readVarint();
        if (!flags) return {};
        OptionSet<Yarr::Flags> yarrFlags;
        if (*flags & (1 << 0)) yarrFlags.add(Yarr::Flags::Global);
        if (*flags & (1 << 1)) yarrFlags.add(Yarr::Flags::IgnoreCase);
        if (*flags & (1 << 2)) yarrFlags.add(Yarr::Flags::Multiline);
        if (*flags & (1 << 3)) yarrFlags.add(Yarr::Flags::Sticky);
        if (*flags & (1 << 4)) yarrFlags.add(Yarr::Flags::Unicode);
        if (*flags & (1 << 5)) yarrFlags.add(Yarr::Flags::DotAll);
        if (*flags & (1 << 7)) yarrFlags.add(Yarr::Flags::HasIndices);
        if (*flags & (1 << 8)) yarrFlags.add(Yarr::Flags::UnicodeSets);
        String patternString = asString(pattern)->value(m_globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        RegExp* regExp = RegExp::create(m_vm, patternString, yarrFlags);
        if (!regExp->isValid()) {
            throwFormatError(scope);
            return {};
        }
        RegExpObject* obj = RegExpObject::create(m_vm, m_globalObject->regExpStructure(), regExp);
        return trackObject(obj);
    }

    bool readKeyValuePairsInto(JSObject* target, V8Tag endTag, uint32_t& propsRead)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        propsRead = 0;
        while (true) {
            auto next = peekTag();
            if (!next) return false;
            if (*next == endTag) {
                m_position++;
                return true;
            }
            JSValue key = readValue();
            RETURN_IF_EXCEPTION(scope, false);
            if (!key) return false;
            JSValue value = readValue();
            RETURN_IF_EXCEPTION(scope, false);
            if (!value) return false;
            if (key.isString()) {
                auto name = asString(key)->toIdentifier(m_globalObject);
                RETURN_IF_EXCEPTION(scope, false);
                if (auto index = parseIndex(name)) {
                    target->putDirectIndex(m_globalObject, *index, value);
                    RETURN_IF_EXCEPTION(scope, false);
                } else {
                    target->putDirect(m_vm, name, value);
                }
            } else if (key.isUInt32AsAnyInt()) {
                target->putDirectIndex(m_globalObject, key.asUInt32AsAnyInt(), value);
                RETURN_IF_EXCEPTION(scope, false);
            } else {
                return false;
            }
            propsRead++;
        }
    }

    JSValue readPlainObject()
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSObject* obj = constructEmptyObject(m_globalObject);
        trackObject(obj);
        uint32_t propsRead = 0;
        bool ok = readKeyValuePairsInto(obj, V8Tag::kEndJSObject, propsRead);
        RETURN_IF_EXCEPTION(scope, {});
        if (!ok) return {};
        auto expected = readVarint();
        if (!expected || *expected != propsRead) return {};
        return obj;
    }

    JSValue readSparseArray()
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto length = readVarint();
        if (!length) return {};
        JSArray* array = constructEmptyArray(m_globalObject, nullptr, 0);
        RETURN_IF_EXCEPTION(scope, {});
        trackObject(array);
        array->setLength(m_globalObject, *length);
        RETURN_IF_EXCEPTION(scope, {});
        uint32_t propsRead = 0;
        bool ok = readKeyValuePairsInto(array, V8Tag::kEndSparseJSArray, propsRead);
        RETURN_IF_EXCEPTION(scope, {});
        if (!ok) return {};
        auto expectedProps = readVarint();
        auto expectedLength = readVarint();
        if (!expectedProps || !expectedLength || *expectedProps != propsRead || *expectedLength != *length) return {};
        return array;
    }

    JSValue readDenseArray()
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto length = readVarint();
        if (!length) return {};
        JSArray* array = constructEmptyArray(m_globalObject, nullptr, 0);
        RETURN_IF_EXCEPTION(scope, {});
        trackObject(array);
        array->setLength(m_globalObject, *length);
        RETURN_IF_EXCEPTION(scope, {});
        for (uint32_t i = 0; i < *length; i++) {
            auto next = peekTag();
            if (!next) return {};
            if (*next == V8Tag::kTheHole) {
                m_position++;
                continue;
            }
            JSValue element = readValue();
            RETURN_IF_EXCEPTION(scope, {});
            if (!element) return {};
            array->putDirectIndex(m_globalObject, i, element);
            RETURN_IF_EXCEPTION(scope, {});
        }
        uint32_t propsRead = 0;
        bool ok = readKeyValuePairsInto(array, V8Tag::kEndDenseJSArray, propsRead);
        RETURN_IF_EXCEPTION(scope, {});
        if (!ok) return {};
        auto expectedProps = readVarint();
        auto expectedLength = readVarint();
        if (!expectedProps || !expectedLength || *expectedProps != propsRead || *expectedLength != *length) return {};
        return array;
    }

    JSValue readMap()
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSMap* map = JSMap::create(m_vm, m_globalObject->mapStructure());
        trackObject(map);
        uint32_t count = 0;
        while (true) {
            auto next = peekTag();
            if (!next) return {};
            if (*next == V8Tag::kEndJSMap) {
                m_position++;
                break;
            }
            JSValue key = readValue();
            RETURN_IF_EXCEPTION(scope, {});
            if (!key) return {};
            JSValue value = readValue();
            RETURN_IF_EXCEPTION(scope, {});
            if (!value) return {};
            map->set(m_globalObject, key, value);
            RETURN_IF_EXCEPTION(scope, {});
            count += 2;
        }
        auto expected = readVarint();
        if (!expected || *expected != count) return {};
        return map;
    }

    JSValue readSet()
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSSet* set = JSSet::create(m_vm, m_globalObject->setStructure());
        trackObject(set);
        uint32_t count = 0;
        while (true) {
            auto next = peekTag();
            if (!next) return {};
            if (*next == V8Tag::kEndJSSet) {
                m_position++;
                break;
            }
            JSValue key = readValue();
            RETURN_IF_EXCEPTION(scope, {});
            if (!key) return {};
            set->add(m_globalObject, key);
            RETURN_IF_EXCEPTION(scope, {});
            count++;
        }
        auto expected = readVarint();
        if (!expected || *expected != count) return {};
        return set;
    }

    JSValue readArrayBuffer(bool resizable)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto byteLength = readVarint();
        if (!byteLength) return {};
        std::optional<uint32_t> maxByteLength;
        if (resizable) {
            maxByteLength = readVarint();
            // V8 rejects an inconsistent pair as a format error, not an OOM.
            if (!maxByteLength || *maxByteLength < *byteLength) return {};
        }
        const uint8_t* bytes = readRawBytes(*byteLength);
        if (!bytes) return {};
        RefPtr<ArrayBuffer> buffer;
        if (resizable)
            buffer = ArrayBuffer::tryCreate(*byteLength, 1, *maxByteLength);
        else
            buffer = ArrayBuffer::tryCreate(*byteLength, 1);
        if (!buffer) {
            throwOutOfMemoryError(m_globalObject, scope);
            return {};
        }
        memcpy(buffer->data(), bytes, *byteLength);
        JSArrayBuffer* jsBuffer = JSArrayBuffer::create(m_vm, m_globalObject->arrayBufferStructure(ArrayBufferSharingMode::Default), buffer.releaseNonNull());
        trackObject(jsBuffer);

        auto next = peekTag();
        if (next && *next == V8Tag::kArrayBufferView) {
            m_position++;
            RELEASE_AND_RETURN(scope, readArrayBufferView(jsBuffer));
        }
        return jsBuffer;
    }

    JSValue readArrayBufferView(JSArrayBuffer* jsBuffer)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto subtag = readByte();
        auto byteOffset = readVarint();
        auto byteLength = readVarint();
        // V8 appends a flags varint only for wire version >= 14: bit 0 is
        // "length-tracking" and bit 1 is "backed by a resizable buffer".
        // Reading it unconditionally on an older stream would eat the parent
        // container's next tag byte when the buffer+view pair is nested.
        uint32_t flags = 0;
        if (m_version >= 14) {
            auto read = readVarint();
            if (!read) return {};
            flags = *read;
        }
        if (!subtag || !byteOffset || !byteLength) return {};
        RefPtr<ArrayBuffer> buffer = jsBuffer->impl();
        bool bufferIsResizable = buffer->isResizableOrGrowableShared();
        // ValidateJSArrayBufferViewFlags: bit 1 ("backed by a resizable
        // buffer") must agree with the preceding buffer, in both directions.
        // Unknown high bits are accepted, matching V8.
        bool isBackedByResizable = flags & 2;
        if (isBackedByResizable != bufferIsResizable) return {};
        // V8 writes byteLength 0 for a length-tracking view; the view's real
        // extent is the whole tail of the (resizable) buffer past byteOffset.
        // Accepting the flag over a fixed buffer would be a malformed frame.
        bool isLengthTracking = flags & 1;
        if (isLengthTracking && !bufferIsResizable) return {};
        if (*byteOffset > buffer->byteLength() || (!isLengthTracking && *byteLength > buffer->byteLength() - *byteOffset)) return {};
        JSObject* view = nullptr;
        auto makeView = [&](TypedArrayType type, uint32_t elementSize) -> JSObject* {
            if (*byteOffset % elementSize != 0) return nullptr;
            // A length-tracking view has no stored length: JSC auto-tracks the
            // buffer when `std::nullopt` is passed. Otherwise the wire
            // byteLength fixes the element count.
            std::optional<size_t> count;
            if (!isLengthTracking) {
                if (*byteLength % elementSize != 0) return nullptr;
                count = *byteLength / elementSize;
            }
            Structure* structure = m_globalObject->typedArrayStructure(type, bufferIsResizable);
            switch (type) {
            case TypeInt8:
                return JSInt8Array::create(m_globalObject, structure, WTF::move(buffer), *byteOffset, count);
            case TypeUint8:
                return JSUint8Array::create(m_globalObject, structure, WTF::move(buffer), *byteOffset, count);
            case TypeUint8Clamped:
                return JSUint8ClampedArray::create(m_globalObject, structure, WTF::move(buffer), *byteOffset, count);
            case TypeInt16:
                return JSInt16Array::create(m_globalObject, structure, WTF::move(buffer), *byteOffset, count);
            case TypeUint16:
                return JSUint16Array::create(m_globalObject, structure, WTF::move(buffer), *byteOffset, count);
            case TypeInt32:
                return JSInt32Array::create(m_globalObject, structure, WTF::move(buffer), *byteOffset, count);
            case TypeUint32:
                return JSUint32Array::create(m_globalObject, structure, WTF::move(buffer), *byteOffset, count);
            case TypeFloat16:
                return JSFloat16Array::create(m_globalObject, structure, WTF::move(buffer), *byteOffset, count);
            case TypeFloat32:
                return JSFloat32Array::create(m_globalObject, structure, WTF::move(buffer), *byteOffset, count);
            case TypeFloat64:
                return JSFloat64Array::create(m_globalObject, structure, WTF::move(buffer), *byteOffset, count);
            case TypeBigInt64:
                return JSBigInt64Array::create(m_globalObject, structure, WTF::move(buffer), *byteOffset, count);
            case TypeBigUint64:
                return JSBigUint64Array::create(m_globalObject, structure, WTF::move(buffer), *byteOffset, count);
            case TypeDataView:
                return JSDataView::create(m_globalObject, structure, WTF::move(buffer), *byteOffset, isLengthTracking ? std::nullopt : std::optional<size_t>(*byteLength));
            default:
                return nullptr;
            }
        };
        switch (static_cast<V8ArrayBufferViewTag>(*subtag)) {
        case V8ArrayBufferViewTag::kInt8Array:
            view = makeView(TypeInt8, 1);
            break;
        case V8ArrayBufferViewTag::kUint8Array:
            view = makeView(TypeUint8, 1);
            break;
        case V8ArrayBufferViewTag::kUint8ClampedArray:
            view = makeView(TypeUint8Clamped, 1);
            break;
        case V8ArrayBufferViewTag::kInt16Array:
            view = makeView(TypeInt16, 2);
            break;
        case V8ArrayBufferViewTag::kUint16Array:
            view = makeView(TypeUint16, 2);
            break;
        case V8ArrayBufferViewTag::kInt32Array:
            view = makeView(TypeInt32, 4);
            break;
        case V8ArrayBufferViewTag::kUint32Array:
            view = makeView(TypeUint32, 4);
            break;
        case V8ArrayBufferViewTag::kFloat16Array:
            view = makeView(TypeFloat16, 2);
            break;
        case V8ArrayBufferViewTag::kFloat32Array:
            view = makeView(TypeFloat32, 4);
            break;
        case V8ArrayBufferViewTag::kFloat64Array:
            view = makeView(TypeFloat64, 8);
            break;
        case V8ArrayBufferViewTag::kBigInt64Array:
            view = makeView(TypeBigInt64, 8);
            break;
        case V8ArrayBufferViewTag::kBigUint64Array:
            view = makeView(TypeBigUint64, 8);
            break;
        case V8ArrayBufferViewTag::kDataView:
            view = makeView(TypeDataView, 1);
            break;
        }
        RETURN_IF_EXCEPTION(scope, {});
        if (!view) return {};
        return trackObject(view);
    }

    JSValue readHostObject()
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        if (m_forIPC) {
            auto discriminator = readVarint();
            if (!discriminator) return {};
            if (*discriminator == kChildProcessNotArrayBufferViewTag)
                RELEASE_AND_RETURN(scope, readValue());
            if (*discriminator != kChildProcessArrayBufferViewTag) return {};
        }
        auto typeIndex = readVarint();
        auto byteLength = readVarint();
        if (!typeIndex || !byteLength) return {};
        const uint8_t* bytes = readRawBytes(*byteLength);
        if (!bytes) return {};

        TypedArrayType arrayType = TypeUint8;
        uint32_t elementSize = 1;
        bool isNodeBuffer = false;
        switch (*typeIndex) {
        case kNodeInt8Array:
            arrayType = TypeInt8;
            break;
        case kNodeUint8Array:
            arrayType = TypeUint8;
            break;
        case kNodeUint8ClampedArray:
            arrayType = TypeUint8Clamped;
            break;
        case kNodeInt16Array:
            arrayType = TypeInt16;
            elementSize = 2;
            break;
        case kNodeUint16Array:
            arrayType = TypeUint16;
            elementSize = 2;
            break;
        case kNodeInt32Array:
            arrayType = TypeInt32;
            elementSize = 4;
            break;
        case kNodeUint32Array:
            arrayType = TypeUint32;
            elementSize = 4;
            break;
        case kNodeFloat32Array:
            arrayType = TypeFloat32;
            elementSize = 4;
            break;
        case kNodeFloat64Array:
            arrayType = TypeFloat64;
            elementSize = 8;
            break;
        case kNodeDataView:
            arrayType = TypeDataView;
            break;
        case kNodeBuffer:
            arrayType = TypeUint8;
            isNodeBuffer = true;
            break;
        case kNodeBigInt64Array:
            arrayType = TypeBigInt64;
            elementSize = 8;
            break;
        case kNodeBigUint64Array:
            arrayType = TypeBigUint64;
            elementSize = 8;
            break;
        case kNodeFloat16Array:
            arrayType = TypeFloat16;
            elementSize = 2;
            break;
        default:
            return {};
        }
        if (*byteLength % elementSize != 0) return {};

        auto buffer = ArrayBuffer::tryCreate(*byteLength, 1);
        if (!buffer) {
            throwOutOfMemoryError(m_globalObject, scope);
            return {};
        }
        memcpy(buffer->data(), bytes, *byteLength);
        uint32_t count = *byteLength / elementSize;
        auto* zigGlobal = defaultGlobalObject(m_globalObject);
        Structure* structure = isNodeBuffer ? zigGlobal->JSBufferSubclassStructure() : m_globalObject->typedArrayStructure(arrayType, false);
        JSObject* view = nullptr;
        switch (arrayType) {
        case TypeInt8:
            view = JSInt8Array::create(m_globalObject, structure, WTF::move(buffer), 0, count);
            break;
        case TypeUint8:
            view = JSUint8Array::create(m_globalObject, structure, WTF::move(buffer), 0, count);
            break;
        case TypeUint8Clamped:
            view = JSUint8ClampedArray::create(m_globalObject, structure, WTF::move(buffer), 0, count);
            break;
        case TypeInt16:
            view = JSInt16Array::create(m_globalObject, structure, WTF::move(buffer), 0, count);
            break;
        case TypeUint16:
            view = JSUint16Array::create(m_globalObject, structure, WTF::move(buffer), 0, count);
            break;
        case TypeInt32:
            view = JSInt32Array::create(m_globalObject, structure, WTF::move(buffer), 0, count);
            break;
        case TypeUint32:
            view = JSUint32Array::create(m_globalObject, structure, WTF::move(buffer), 0, count);
            break;
        case TypeFloat16:
            view = JSFloat16Array::create(m_globalObject, structure, WTF::move(buffer), 0, count);
            break;
        case TypeFloat32:
            view = JSFloat32Array::create(m_globalObject, structure, WTF::move(buffer), 0, count);
            break;
        case TypeFloat64:
            view = JSFloat64Array::create(m_globalObject, structure, WTF::move(buffer), 0, count);
            break;
        case TypeBigInt64:
            view = JSBigInt64Array::create(m_globalObject, structure, WTF::move(buffer), 0, count);
            break;
        case TypeBigUint64:
            view = JSBigUint64Array::create(m_globalObject, structure, WTF::move(buffer), 0, count);
            break;
        case TypeDataView:
            view = JSDataView::create(m_globalObject, structure, WTF::move(buffer), 0, *byteLength);
            break;
        default:
            break;
        }
        RETURN_IF_EXCEPTION(scope, {});
        if (!view) return {};
        return trackObject(view);
    }

    JSValue readError()
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        // Mirror V8's ReadJSError exactly: the sub-tags are a fixed linear
        // sequence `[prototype] [message] [stack] [cause] end`, not a loop.
        // The Error is constructed and tracked AFTER `stack` and BEFORE
        // `cause`. Both halves matter:
        //  - the writer tracks the Error before writeError, so the cause's
        //    nested objects get later ids; the reader must do the same or
        //    every later kObjectReference in the message resolves wrong.
        //  - a self-referential cause (`err.cause = err`) is a
        //    kObjectReference to the Error's own id, which must already be
        //    in the table when the cause is read.
        auto sub = readByte();
        if (!sub) return {};

        ErrorType type = ErrorType::Error;
        bool hadPrototypeTag = true;
        switch (static_cast<V8ErrorTag>(*sub)) {
        case V8ErrorTag::kEvalErrorPrototype:
            type = ErrorType::EvalError;
            break;
        case V8ErrorTag::kRangeErrorPrototype:
            type = ErrorType::RangeError;
            break;
        case V8ErrorTag::kReferenceErrorPrototype:
            type = ErrorType::ReferenceError;
            break;
        case V8ErrorTag::kSyntaxErrorPrototype:
            type = ErrorType::SyntaxError;
            break;
        case V8ErrorTag::kTypeErrorPrototype:
            type = ErrorType::TypeError;
            break;
        case V8ErrorTag::kUriErrorPrototype:
            type = ErrorType::URIError;
            break;
        default:
            hadPrototypeTag = false;
            break;
        }
        if (hadPrototypeTag) {
            sub = readByte();
            if (!sub) return {};
        }

        String messageStr;
        if (static_cast<V8ErrorTag>(*sub) == V8ErrorTag::kMessage) {
            JSValue message = readValue();
            RETURN_IF_EXCEPTION(scope, {});
            if (!message || !message.isString()) return {};
            messageStr = asString(message)->value(m_globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            sub = readByte();
            if (!sub) return {};
        }

        String stackStr;
        if (static_cast<V8ErrorTag>(*sub) == V8ErrorTag::kStack) {
            JSValue stack = readValue();
            RETURN_IF_EXCEPTION(scope, {});
            if (!stack || !stack.isString()) return {};
            stackStr = asString(stack)->value(m_globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            sub = readByte();
            if (!sub) return {};
        }

        // This overload installs `message` and `stack` as non-enumerable own
        // data properties (matching a freshly-constructed Error), and skips
        // capturing a stack trace at the deserialization site.
        ErrorInstance* error = ErrorInstance::create(m_globalObject, WTF::move(messageStr), type, {}, {}, WTF::move(stackStr));
        trackObject(error);

        if (static_cast<V8ErrorTag>(*sub) == V8ErrorTag::kCause) {
            JSValue cause = readValue();
            RETURN_IF_EXCEPTION(scope, {});
            if (!cause) return {};
            error->putDirect(m_vm, m_vm.propertyNames->cause, cause, static_cast<unsigned>(PropertyAttribute::DontEnum));
            sub = readByte();
            if (!sub) return {};
        }

        if (static_cast<V8ErrorTag>(*sub) != V8ErrorTag::kEnd) return {};
        return error;
    }

    JSGlobalObject* m_globalObject;
    VM& m_vm;
    const uint8_t* m_end;
    const uint8_t* m_position;
    bool m_forIPC;
    // Wire version from the header; some trailing fields are version-gated.
    uint32_t m_version { 0 };
    MarkedArgumentBuffer m_objectIds;
};

} // namespace Bun

using namespace Bun;

// Serialize with Node's ChildProcessSerializer framing (4-byte big-endian
// length + V8 payload). Transfers the buffer to `*outBytes`; pair with
// Bun__NodeIPC__serialize_free. Returns SIZE_MAX with a JS exception on failure.
extern "C" size_t Bun__NodeIPC__serialize(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, uint8_t** outBytes)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    *outBytes = nullptr;
    NodeValueSerializer serializer(globalObject, true);
    serializer.reserveHeader(4);
    serializer.writeHeader();
    bool ok = serializer.writeValue(JSC::JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(scope, SIZE_MAX);
    if (!ok) {
        if (!scope.exception())
            throwException(globalObject, scope, createDOMException(globalObject, ExceptionCode::DataCloneError, "The object could not be cloned."_s));
        return SIZE_MAX;
    }
    Vector<uint8_t> buffer = serializer.release();
    size_t total = buffer.size();
    // A payload >= 4 GiB cannot be represented in the 4-byte frame header;
    // a truncated length would desynchronize every subsequent IPC frame.
    if (total - 4 > UINT32_MAX) {
        throwException(globalObject, scope, createDOMException(globalObject, ExceptionCode::DataCloneError, "Serialized IPC message is larger than 4 GiB."_s));
        return SIZE_MAX;
    }
    uint32_t payloadLen = static_cast<uint32_t>(total - 4);
    buffer[0] = static_cast<uint8_t>((payloadLen >> 24) & 0xFF);
    buffer[1] = static_cast<uint8_t>((payloadLen >> 16) & 0xFF);
    buffer[2] = static_cast<uint8_t>((payloadLen >> 8) & 0xFF);
    buffer[3] = static_cast<uint8_t>(payloadLen & 0xFF);
    *outBytes = buffer.releaseBuffer().leakSpan().data();
    return total;
}

extern "C" void Bun__NodeIPC__serialize_free(uint8_t* ptr)
{
    WTF::VectorBufferMalloc::free(static_cast<void*>(ptr));
}

// Deserialize a single V8-format payload (without the length prefix) using
// the ChildProcessDeserializer rules. Returns 0 with a JS exception on error.
extern "C" JSC::EncodedJSValue Bun__NodeIPC__deserialize(JSC::JSGlobalObject* globalObject, const uint8_t* bytes, size_t size)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    NodeValueDeserializer deserializer(globalObject, bytes, size, true);
    if (!deserializer.readHeader()) {
        throwException(globalObject, scope, createDOMException(globalObject, ExceptionCode::DataCloneError, "Unable to deserialize cloned data."_s));
        return {};
    }
    JSC::JSValue result = deserializer.readValue();
    RETURN_IF_EXCEPTION(scope, {});
    if (!result) {
        throwException(globalObject, scope, createDOMException(globalObject, ExceptionCode::DataCloneError, "Unable to deserialize cloned data."_s));
        return {};
    }
    return JSC::JSValue::encode(result);
}
