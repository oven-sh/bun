#pragma once

#include "root.h"

#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/ThrowScope.h>
#include <JavaScriptCore/VM.h>

using JSC__JSGlobalObject = JSC::JSGlobalObject;
using JSC__JSValue = JSC::EncodedJSValue;
using JSC__CallFrame = JSC::CallFrame;
namespace Zig {
}

#include "headers-handwritten.h"

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunused-function"

template<class CppType, typename ZigType> class Wrap {
public:
    Wrap() {};

    Wrap(ZigType zig)
    {
        result = zig;
        cpp = static_cast<CppType*>(static_cast<void*>(&zig));
    };

    Wrap(ZigType* zig) { cpp = static_cast<CppType*>(static_cast<void*>(&zig)); };

    Wrap(CppType _cpp)
    {
        auto buffer = alignedBuffer();
        cpp = new (buffer) CppType(_cpp);
    };

    ~Wrap() {};

    unsigned char* alignedBuffer()
    {
        return result.bytes + alignof(CppType) - reinterpret_cast<intptr_t>(result.bytes) % alignof(CppType);
    }

    ZigType result;
    CppType* cpp;

    static ZigType wrap(CppType obj) { return *static_cast<ZigType*>(static_cast<void*>(&obj)); }

    static CppType unwrap(ZigType obj) { return *static_cast<CppType*>(static_cast<void*>(&obj)); }

    static CppType* unwrap(ZigType* obj) { return static_cast<CppType*>(static_cast<void*>(obj)); }
};

template<class To, class From> To cast(From v)
{
    return *static_cast<To*>(static_cast<void*>(v));
}

template<class To, class From> To ccast(From v)
{
    return *static_cast<const To*>(static_cast<const void*>(v));
}

static const JSC::ArgList makeArgs(JSC__JSValue* v, size_t count)
{
    JSC::MarkedArgumentBuffer args = JSC::MarkedArgumentBuffer();
    args.ensureCapacity(count);
    for (size_t i = 0; i < count; ++i) {
        args.append(JSC::JSValue::decode(v[i]));
    }

    return JSC::ArgList(args);
}

namespace Zig {

// 8 bit byte
// we tag the final two bits
// so 56 bits are copied over
// rest we zero out for consistentcy
static const unsigned char* untag(const unsigned char* ptr)
{
    return reinterpret_cast<const unsigned char*>(
        (((reinterpret_cast<uintptr_t>(ptr) & ~(static_cast<uint64_t>(1) << 63) & ~(static_cast<uint64_t>(1) << 62)) & ~(static_cast<uint64_t>(1) << 61)) & ~(static_cast<uint64_t>(1) << 60)));
}

static void* untagVoid(const unsigned char* ptr)
{
    return const_cast<void*>(reinterpret_cast<const void*>(untag(ptr)));
}

static void* untagVoid(const char16_t* ptr)
{
    return untagVoid(reinterpret_cast<const unsigned char*>(ptr));
}

static const JSC::Identifier toIdentifier(ZigString str, JSC::JSGlobalObject* global)
{
    if (str.len == 0 || str.ptr == nullptr) {
        return JSC::Identifier::EmptyIdentifier;
    }

    return JSC::Identifier::fromString(global->vm(), untag(str.ptr), str.len);
}

static bool isTaggedUTF16Ptr(const unsigned char* ptr)
{
    return (reinterpret_cast<uintptr_t>(ptr) & (static_cast<uint64_t>(1) << 63)) != 0;
}

// Do we need to convert the string from UTF-8 to UTF-16?
static bool isTaggedUTF8Ptr(const unsigned char* ptr)
{
    return (reinterpret_cast<uintptr_t>(ptr) & (static_cast<uint64_t>(1) << 61)) != 0;
}

static bool isTaggedExternalPtr(const unsigned char* ptr)
{
    return (reinterpret_cast<uintptr_t>(ptr) & (static_cast<uint64_t>(1) << 62)) != 0;
}

static void free_global_string(void* str, void* ptr, unsigned len)
{
    // i don't understand why this happens
    if (ptr == nullptr)
        return;

    ZigString__free_global(reinterpret_cast<const unsigned char*>(ptr), len);
}

// Switching to AtomString doesn't yield a perf benefit because we're recreating it each time.
static const WTF::String toString(ZigString str)
{
    if (str.len == 0 || str.ptr == nullptr) {
        return WTF::String();
    }
    if (UNLIKELY(isTaggedUTF8Ptr(str.ptr))) {
        return WTF::String::fromUTF8(untag(str.ptr), str.len);
    }

    if (UNLIKELY(isTaggedExternalPtr(str.ptr))) {
        return !isTaggedUTF16Ptr(str.ptr)
            ? WTF::String(WTF::ExternalStringImpl::create(untag(str.ptr), str.len, untagVoid(str.ptr), free_global_string))
            : WTF::String(WTF::ExternalStringImpl::create(
                reinterpret_cast<const UChar*>(untag(str.ptr)), str.len, untagVoid(str.ptr), free_global_string));
    }

    return !isTaggedUTF16Ptr(str.ptr)
        ? WTF::String(WTF::StringImpl::createWithoutCopying(untag(str.ptr), str.len))
        : WTF::String(WTF::StringImpl::createWithoutCopying(
            reinterpret_cast<const UChar*>(untag(str.ptr)), str.len));
}

static WTF::AtomString toAtomString(ZigString str)
{

    if (!isTaggedUTF16Ptr(str.ptr)) {
        return makeAtomString(untag(str.ptr), str.len);
    } else {
        return makeAtomString(reinterpret_cast<const UChar*>(untag(str.ptr)), str.len);
    }
}

static const WTF::String toString(ZigString str, StringPointer ptr)
{
    if (str.len == 0 || str.ptr == nullptr || ptr.len == 0) {
        return WTF::String();
    }
    if (UNLIKELY(isTaggedUTF8Ptr(str.ptr))) {
        return WTF::String::fromUTF8ReplacingInvalidSequences(&untag(str.ptr)[ptr.off], ptr.len);
    }

    return !isTaggedUTF16Ptr(str.ptr)
        ? WTF::String(WTF::StringImpl::createWithoutCopying(&untag(str.ptr)[ptr.off], ptr.len))
        : WTF::String(WTF::StringImpl::createWithoutCopying(
            &reinterpret_cast<const UChar*>(untag(str.ptr))[ptr.off], ptr.len));
}

static const WTF::String toStringCopy(ZigString str, StringPointer ptr)
{
    if (str.len == 0 || str.ptr == nullptr || ptr.len == 0) {
        return WTF::String();
    }
    if (UNLIKELY(isTaggedUTF8Ptr(str.ptr))) {
        return WTF::String::fromUTF8ReplacingInvalidSequences(&untag(str.ptr)[ptr.off], ptr.len);
    }

    return !isTaggedUTF16Ptr(str.ptr)
        ? WTF::String(WTF::StringImpl::create(&untag(str.ptr)[ptr.off], ptr.len))
        : WTF::String(WTF::StringImpl::create(
            &reinterpret_cast<const UChar*>(untag(str.ptr))[ptr.off], ptr.len));
}

static const WTF::String toStringCopy(ZigString str)
{
    if (str.len == 0 || str.ptr == nullptr) {
        return WTF::String();
    }
    if (UNLIKELY(isTaggedUTF8Ptr(str.ptr))) {
        return WTF::String::fromUTF8ReplacingInvalidSequences(untag(str.ptr), str.len);
    }

    if (isTaggedUTF16Ptr(str.ptr)) {
        UChar* out = nullptr;
        auto impl = WTF::StringImpl::tryCreateUninitialized(str.len, out);
        if (UNLIKELY(!impl))
            return WTF::String();
        memcpy(out, untag(str.ptr), str.len * sizeof(UChar));
        return WTF::String(WTFMove(impl));
    } else {
        LChar* out = nullptr;
        auto impl = WTF::StringImpl::tryCreateUninitialized(str.len, out);
        if (UNLIKELY(!impl))
            return WTF::String();
        memcpy(out, untag(str.ptr), str.len * sizeof(LChar));
        return WTF::String(WTFMove(impl));
    }
}

static WTF::String toStringNotConst(ZigString str) { return toString(str); }

static const JSC::JSString* toJSString(ZigString str, JSC::JSGlobalObject* global)
{
    return JSC::jsOwnedString(global->vm(), toString(str));
}

static const JSC::JSValue toJSStringValue(ZigString str, JSC::JSGlobalObject* global)
{
    return JSC::JSValue(toJSString(str, global));
}

static const JSC::JSString* toJSStringGC(ZigString str, JSC::JSGlobalObject* global)
{
    return JSC::jsString(global->vm(), toStringCopy(str));
}

static const JSC::JSValue toJSStringValueGC(ZigString str, JSC::JSGlobalObject* global)
{
    return JSC::JSValue(toJSStringGC(str, global));
}

static const ZigString ZigStringEmpty = ZigString { nullptr, 0 };
static const unsigned char __dot_char = '.';
static const ZigString ZigStringCwd = ZigString { &__dot_char, 1 };
static const BunString BunStringCwd = BunString { BunStringTag::StaticZigString, ZigStringCwd };
static const BunString BunStringEmpty = BunString { BunStringTag::Empty, nullptr };

static const unsigned char* taggedUTF16Ptr(const UChar* ptr)
{
    return reinterpret_cast<const unsigned char*>(reinterpret_cast<uintptr_t>(ptr) | (static_cast<uint64_t>(1) << 63));
}

static ZigString toZigString(WTF::String* str)
{
    return str->isEmpty()
        ? ZigStringEmpty
        : ZigString { str->is8Bit() ? str->characters8() : taggedUTF16Ptr(str->characters16()),
              str->length() };
}

static ZigString toZigString(WTF::StringImpl& str)
{
    return str.isEmpty()
        ? ZigStringEmpty
        : ZigString { str.is8Bit() ? str.characters8() : taggedUTF16Ptr(str.characters16()),
              str.length() };
}

static ZigString toZigString(WTF::StringView& str)
{
    return str.isEmpty()
        ? ZigStringEmpty
        : ZigString { str.is8Bit() ? str.characters8() : taggedUTF16Ptr(str.characters16()),
              str.length() };
}

static ZigString toZigString(const WTF::StringView& str)
{
    return str.isEmpty()
        ? ZigStringEmpty
        : ZigString { str.is8Bit() ? str.characters8() : taggedUTF16Ptr(str.characters16()),
              str.length() };
}

static ZigString toZigString(JSC::JSString& str, JSC::JSGlobalObject* global)
{
    return toZigString(str.value(global));
}

static ZigString toZigString(JSC::JSString* str, JSC::JSGlobalObject* global)
{
    return toZigString(str->value(global));
}

static ZigString toZigString(JSC::Identifier& str, JSC::JSGlobalObject* global)
{
    return toZigString(str.string());
}

static ZigString toZigString(JSC::Identifier* str, JSC::JSGlobalObject* global)
{
    return toZigString(str->string());
}

static WTF::StringView toStringView(ZigString str)
{
    return WTF::StringView(untag(str.ptr), str.len);
}

static void throwException(JSC::ThrowScope& scope, ZigErrorType err, JSC::JSGlobalObject* global)
{
    scope.throwException(global,
        JSC::Exception::create(global->vm(), JSC::JSValue((JSC::JSCell*)err.ptr)));
}

static ZigString toZigString(JSC::JSValue val, JSC::JSGlobalObject* global)
{
    auto scope = DECLARE_THROW_SCOPE(global->vm());
    WTF::String str = val.toWTFString(global);

    if (scope.exception()) {
        scope.clearException();
        scope.release();
        return ZigStringEmpty;
    }

    scope.release();

    return toZigString(str);
}

static const WTF::String toStringStatic(ZigString str)
{
    if (str.len == 0 || str.ptr == nullptr) {
        return WTF::String();
    }
    if (UNLIKELY(isTaggedUTF8Ptr(str.ptr))) {
        abort();
    }

    if (isTaggedUTF16Ptr(str.ptr)) {
        return WTF::String(AtomStringImpl::add(reinterpret_cast<const UChar*>(untag(str.ptr)), str.len));
    }

    return WTF::String(AtomStringImpl::add(
        reinterpret_cast<const LChar*>(untag(str.ptr)), str.len));
}

static JSC::JSValue getErrorInstance(const ZigString* str, JSC__JSGlobalObject* globalObject)
{
    WTF::String message = toStringCopy(*str);
    if (UNLIKELY(message.isNull() && str->len > 0)) {
        // pending exception while creating an error.
        return JSC::JSValue();
    }

    JSC::JSObject* result = JSC::createError(globalObject, message);
    JSC::EnsureStillAliveScope ensureAlive(result);

    return JSC::JSValue(result);
}

static JSC::JSValue getTypeErrorInstance(const ZigString* str, JSC__JSGlobalObject* globalObject)
{
    JSC::JSObject* result = JSC::createTypeError(globalObject, toStringCopy(*str));
    JSC::EnsureStillAliveScope ensureAlive(result);

    return JSC::JSValue(result);
}

static JSC::JSValue getSyntaxErrorInstance(const ZigString* str, JSC__JSGlobalObject* globalObject)
{
    JSC::JSObject* result = JSC::createSyntaxError(globalObject, toStringCopy(*str));
    JSC::EnsureStillAliveScope ensureAlive(result);

    return JSC::JSValue(result);
}

static JSC::JSValue getRangeErrorInstance(const ZigString* str, JSC__JSGlobalObject* globalObject)
{
    JSC::JSObject* result = JSC::createRangeError(globalObject, toStringCopy(*str));
    JSC::EnsureStillAliveScope ensureAlive(result);

    return JSC::JSValue(result);
}

}; // namespace Zig

JSC::JSValue createSystemError(JSC::JSGlobalObject* global, ASCIILiteral message, ASCIILiteral syscall, int err);
JSC::JSValue createSystemError(JSC::JSGlobalObject* global, ASCIILiteral syscall, int err);

static void throwSystemError(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, ASCIILiteral syscall, int err)
{
    scope.throwException(globalObject, createSystemError(globalObject, syscall, err));
}

static void throwSystemError(JSC::ThrowScope& scope, JSC::JSGlobalObject* globalObject, ASCIILiteral message, ASCIILiteral syscall, int err)
{
    scope.throwException(globalObject, createSystemError(globalObject, message, syscall, err));
}

template<typename WebCoreType, typename OutType>
OutType* WebCoreCast(JSC__JSValue JSValue0)
{
    // we must use jsDynamicCast here so that we check that the type is correct
    WebCoreType* jsdomURL = JSC::jsDynamicCast<WebCoreType*>(JSC::JSValue::decode(JSValue0));
    if (jsdomURL == nullptr) {
        return nullptr;
    }

    return reinterpret_cast<OutType*>(&jsdomURL->wrapped());
}

#pragma clang diagnostic pop