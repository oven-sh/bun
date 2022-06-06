#pragma once

#include "root.h"

#include "headers.h"

#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/Exception.h"
#include "JavaScriptCore/Identifier.h"
#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSValueInternal.h"
#include "JavaScriptCore/ThrowScope.h"
#include "JavaScriptCore/VM.h"

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
        ((reinterpret_cast<uintptr_t>(ptr) & ~(static_cast<uint64_t>(1) << 63) & ~(static_cast<uint64_t>(1) << 62)) & ~(static_cast<uint64_t>(1) << 61)));
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

// Switching to AtomString doesn't yield a perf benefit because we're recreating it each time.
static const WTF::String toString(ZigString str)
{
    if (str.len == 0 || str.ptr == nullptr) {
        return WTF::String();
    }
    if (UNLIKELY(isTaggedUTF8Ptr(str.ptr))) {
        return WTF::String::fromUTF8(untag(str.ptr), str.len);
    }

    return !isTaggedUTF16Ptr(str.ptr)
        ? WTF::String(WTF::StringImpl::createWithoutCopying(untag(str.ptr), str.len))
        : WTF::String(WTF::StringImpl::createWithoutCopying(
            reinterpret_cast<const UChar*>(untag(str.ptr)), str.len));
}

static const WTF::String toString(ZigString str, StringPointer ptr)
{
    if (str.len == 0 || str.ptr == nullptr || ptr.len == 0) {
        return WTF::String();
    }
    if (UNLIKELY(isTaggedUTF8Ptr(str.ptr))) {
        return WTF::String::fromUTF8(&untag(str.ptr)[ptr.off], ptr.len);
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
        return WTF::String::fromUTF8(&untag(str.ptr)[ptr.off], ptr.len);
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
        return WTF::String::fromUTF8(untag(str.ptr), str.len);
    }

    return !isTaggedUTF16Ptr(str.ptr) ? WTF::String(WTF::StringImpl::create(untag(str.ptr), str.len))
                                      : WTF::String(WTF::StringImpl::create(
                                          reinterpret_cast<const UChar*>(untag(str.ptr)), str.len));
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
    return JSC::JSValue(toJSString(str, global));
}

static const ZigString ZigStringEmpty = ZigString { nullptr, 0 };
static const unsigned char __dot_char = '.';
static const ZigString ZigStringCwd = ZigString { &__dot_char, 1 };

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

static JSC::JSValue getErrorInstance(const ZigString* str, JSC__JSGlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();

    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue message = Zig::toJSString(*str, globalObject);
    JSC::JSValue options = JSC::jsUndefined();
    JSC::Structure* errorStructure = globalObject->errorStructure();
    JSC::JSObject* result = JSC::ErrorInstance::create(globalObject, errorStructure, message, options);
    RETURN_IF_EXCEPTION(scope, JSC::JSValue());
    scope.release();

    return JSC::JSValue(result);
}

}; // namespace Zig

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
