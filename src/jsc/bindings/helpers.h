#pragma once

#include "root.h"
#include "wtf/text/ASCIILiteral.h"
#include "wtf/SIMDUTF.h"

#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/ThrowScope.h>
#include <JavaScriptCore/VM.h>
#include <limits>

namespace Zig {
class GlobalObject;
}

#include "headers-handwritten.h"

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunused-function"

extern "C" size_t Bun__stringSyntheticAllocationLimit;
extern "C" const char* Bun__errnoName(int);

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

    EncodedSlice__freeGlobal(reinterpret_cast<const unsigned char*>(ptr), len);
}

static WTF::String convertUTF8ToString(std::span<const unsigned char> bytes)
{
    // fromUTF8ReplacingInvalidSequences CRASH()es past a ~2^30-byte input
    // (it sizes an intermediate Vector<char16_t> by byte count).
    if (WTF::isValidCapacityForVector<char16_t>(bytes.size())) [[likely]]
        return WTF::String::fromUTF8ReplacingInvalidSequences(bytes);

    const char* data = reinterpret_cast<const char*>(bytes.data());
    if (!simdutf::validate_utf8(data, bytes.size())) [[unlikely]]
        return {};
    size_t utf16Length = simdutf::utf16_length_from_utf8(data, bytes.size());
    if (utf16Length > WTF::String::MaxLength) [[unlikely]]
        return {};
    if (utf16Length == bytes.size()) {
        // all-ASCII: stays 8-bit
        std::span<Latin1Character> out;
        auto impl = WTF::StringImpl::tryCreateUninitialized(bytes.size(), out);
        if (!impl) [[unlikely]]
            return {};
        memcpy(out.data(), bytes.data(), bytes.size());
        return WTF::String(WTF::move(impl));
    }
    std::span<char16_t> out;
    auto impl = WTF::StringImpl::tryCreateUninitialized(utf16Length, out);
    if (!impl) [[unlikely]]
        return {};
    RELEASE_ASSERT(simdutf::convert_utf8_to_utf16(data, bytes.size(), out.data()) == utf16Length);
    return WTF::String(WTF::move(impl));
}

// Switching to AtomString doesn't yield a perf benefit because we're recreating it each time.
static const WTF::String toString(EncodedSlice str)
{
    if (str.len == 0 || str.ptr == nullptr) {
        return WTF::String();
    }
    if (isTaggedUTF8Ptr(str.ptr)) [[unlikely]] {
        ASSERT_WITH_MESSAGE(!isTaggedExternalPtr(str.ptr), "UTF8 and external ptr are mutually exclusive. The external will never be freed.");
        // Check if the resulting UTF-16 string could possibly exceed the maximum length.
        // For valid UTF-8, the number of UTF-16 code units is <= the number of UTF-8 bytes
        // (ASCII is 1:1; other code points use multiple UTF-8 bytes per UTF-16 code unit).
        // We only need to compute the actual UTF-16 length when the byte length exceeds the limit.
        size_t maxLength = std::min(Bun__stringSyntheticAllocationLimit, static_cast<size_t>(WTF::String::MaxLength));
        if (str.len > maxLength) [[unlikely]] {
            // UTF-8 byte length != UTF-16 length, so use simdutf to calculate the actual UTF-16 length.
            size_t utf16Length = simdutf::utf16_length_from_utf8(reinterpret_cast<const char*>(untag(str.ptr)), str.len);
            if (utf16Length > maxLength) {
                return {};
            }
        }
        return convertUTF8ToString(std::span { untag(str.ptr), str.len });
    }

    if (isTaggedExternalPtr(str.ptr)) [[unlikely]] {
        // This will fail if the string is too long. Let's make it explicit instead of an ASSERT.
        if (str.len > Bun__stringSyntheticAllocationLimit || str.len > WTF::String::MaxLength) [[unlikely]] {
            free_global_string(nullptr, reinterpret_cast<void*>(const_cast<unsigned char*>(untag(str.ptr))), static_cast<unsigned>(str.len));
            return {};
        }

        return !isTaggedUTF16Ptr(str.ptr)
            ? WTF::String(WTF::ExternalStringImpl::create({ untag(str.ptr), str.len }, untagVoid(str.ptr), free_global_string))
            : WTF::String(WTF::ExternalStringImpl::create({ reinterpret_cast<const char16_t*>(untag(str.ptr)), str.len }, untagVoid(str.ptr), free_global_string));
    }

    // This will fail if the string is too long. Let's make it explicit instead of an ASSERT.
    if (str.len > Bun__stringSyntheticAllocationLimit || str.len > WTF::String::MaxLength) [[unlikely]] {
        return {};
    }

    return !isTaggedUTF16Ptr(str.ptr)
        ? WTF::String(WTF::StringImpl::createWithoutCopying({ untag(str.ptr), str.len }))
        : WTF::String(WTF::StringImpl::createWithoutCopying(
              { reinterpret_cast<const char16_t*>(untag(str.ptr)), str.len }));
}

static const WTF::String toStringCopy(EncodedSlice str, StringPointer ptr)
{
    if (str.len == 0 || str.ptr == nullptr || ptr.len == 0) {
        return WTF::String();
    }
    if (isTaggedUTF8Ptr(str.ptr)) [[unlikely]] {
        // Check if the resulting UTF-16 string could possibly exceed the maximum length.
        size_t maxLength = std::min(Bun__stringSyntheticAllocationLimit, static_cast<size_t>(WTF::String::MaxLength));
        if (ptr.len > maxLength) [[unlikely]] {
            size_t utf16Length = simdutf::utf16_length_from_utf8(reinterpret_cast<const char*>(&untag(str.ptr)[ptr.off]), ptr.len);
            if (utf16Length > maxLength) {
                return {};
            }
        }
        return convertUTF8ToString(std::span { &untag(str.ptr)[ptr.off], ptr.len });
    }

    // This will fail if the string is too long. Let's make it explicit instead of an ASSERT.
    if (ptr.len > Bun__stringSyntheticAllocationLimit || ptr.len > WTF::String::MaxLength) [[unlikely]] {
        return {};
    }

    return !isTaggedUTF16Ptr(str.ptr)
        ? WTF::String(WTF::StringImpl::create(std::span { &untag(str.ptr)[ptr.off], ptr.len }))
        : WTF::String(WTF::StringImpl::create(
              std::span { &reinterpret_cast<const char16_t*>(untag(str.ptr))[ptr.off], ptr.len }));
}

static const WTF::String toStringCopy(EncodedSlice str)
{
    if (str.len == 0 || str.ptr == nullptr) {
        return WTF::String();
    }
    if (isTaggedUTF8Ptr(str.ptr)) [[unlikely]] {
        // Check if the resulting UTF-16 string could possibly exceed the maximum length.
        size_t maxLength = std::min(Bun__stringSyntheticAllocationLimit, static_cast<size_t>(WTF::String::MaxLength));
        if (str.len > maxLength) [[unlikely]] {
            size_t utf16Length = simdutf::utf16_length_from_utf8(reinterpret_cast<const char*>(untag(str.ptr)), str.len);
            if (utf16Length > maxLength) {
                return {};
            }
        }
        return convertUTF8ToString(std::span { untag(str.ptr), str.len });
    }

    if (isTaggedUTF16Ptr(str.ptr)) {
        std::span<char16_t> out;
        auto impl = WTF::StringImpl::tryCreateUninitialized(str.len, out);
        if (!impl) [[unlikely]] {
            return WTF::String();
        }
        memcpy(out.data(), untag(str.ptr), str.len * sizeof(char16_t));
        return WTF::String(WTF::move(impl));
    } else {
        std::span<Latin1Character> out;
        auto impl = WTF::StringImpl::tryCreateUninitialized(str.len, out);
        if (!impl) [[unlikely]]
            return WTF::String();
        memcpy(out.data(), untag(str.ptr), str.len * sizeof(Latin1Character));
        return WTF::String(WTF::move(impl));
    }
}

static void appendToBuilder(EncodedSlice str, WTF::StringBuilder& builder)
{
    if (str.len == 0 || str.ptr == nullptr) {
        return;
    }
    if (isTaggedUTF8Ptr(str.ptr)) [[unlikely]] {
        // Check if the resulting UTF-16 string could possibly exceed the maximum length.
        size_t maxLength = std::min(Bun__stringSyntheticAllocationLimit, static_cast<size_t>(WTF::String::MaxLength));
        if (str.len > maxLength) [[unlikely]] {
            size_t utf16Length = simdutf::utf16_length_from_utf8(reinterpret_cast<const char*>(untag(str.ptr)), str.len);
            if (utf16Length > maxLength) {
                return;
            }
        }
        WTF::String converted = convertUTF8ToString(std::span { untag(str.ptr), str.len });
        builder.append(converted);
        return;
    }
    if (isTaggedUTF16Ptr(str.ptr)) {
        builder.append({ reinterpret_cast<const char16_t*>(untag(str.ptr)), str.len });
        return;
    }

    builder.append({ untag(str.ptr), str.len });
}

static JSC::JSString* toJSStringGC(EncodedSlice str, JSC::JSGlobalObject* global)
{
    return JSC::jsString(global->vm(), toStringCopy(str));
}

static const EncodedSlice EncodedSliceEmpty = EncodedSlice { (unsigned char*)"", 0 };
static const BunString BunStringEmpty = BunString { BunStringTag::Empty, nullptr };

static const unsigned char* taggedUTF16Ptr(const char16_t* ptr)
{
    return reinterpret_cast<const unsigned char*>(reinterpret_cast<uintptr_t>(ptr) | (static_cast<uint64_t>(1) << 63));
}

// Overload for `StringImpl*` so callers like `toEncodedSlice(string.impl())` resolve here
// instead of implicitly constructing a temporary `WTF::StringView` (which, in debug builds
// with CHECK_STRINGVIEW_LIFETIME, takes a lock and heap-allocates an UnderlyingString entry).
static EncodedSlice toEncodedSlice(const WTF::StringImpl* str)
{
    return (!str || str->isEmpty())
        ? EncodedSliceEmpty
        : EncodedSlice { str->is8Bit() ? str->span8().data() : taggedUTF16Ptr(str->span16().data()),
              str->length() };
}

static EncodedSlice toEncodedSlice(const WTF::StringView& str)
{
    return str.isEmpty()
        ? EncodedSliceEmpty
        : EncodedSlice { str.is8Bit() ? str.span8().data() : taggedUTF16Ptr(str.span16().data()),
              str.length() };
}

static EncodedSlice toEncodedSlice(JSC::JSString* str, JSC::JSGlobalObject* global)
{
    if (str->isSubstring()) {
        return toEncodedSlice(str->view(global));
    }
    return toEncodedSlice(str->value(global));
}

static void throwException(JSC::ThrowScope& scope, JSC::EncodedJSValue err, JSC::JSGlobalObject* global)
{
    scope.throwException(global,
        JSC::Exception::create(global->vm(), JSC::JSValue::decode(err)));
}

static const WTF::String toStringStatic(EncodedSlice str)
{
    if (str.len == 0 || str.ptr == nullptr) {
        return WTF::String();
    }
    if (isTaggedUTF8Ptr(str.ptr)) [[unlikely]] {
        abort();
    }

    if (isTaggedUTF16Ptr(str.ptr)) {
        return WTF::String(AtomStringImpl::add(std::span { reinterpret_cast<const char16_t*>(untag(str.ptr)), str.len }));
    }

    // Rust `&'static str` / `&'static [u8]` literals are NOT null-terminated,
    // so the previous `ASCIILiteral::fromLiteralUnsafe` path (which `strlen`s
    // and asserts a trailing NUL) over-reads. Intern via a length-bounded span
    // instead — same atom-table caching, no NUL dependency.
    auto* untagged = untag(str.ptr);
    return WTF::String(AtomStringImpl::add(std::span { untagged, str.len }));
}

static const JSC::Identifier toIdentifier(EncodedSlice str, JSC::JSGlobalObject* global)
{
    if (str.len == 0 || str.ptr == nullptr) {
        return global->vm().propertyNames->emptyIdentifier;
    }
    WTF::String wtfstr = Zig::isTaggedExternalPtr(str.ptr) ? toString(str) : Zig::toStringCopy(str);
    JSC::Identifier id = JSC::Identifier::fromString(global->vm(), wtfstr);
    return id;
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
OutType* WebCoreCast(JSC::EncodedJSValue JSValue0)
{
    // we must use jsDynamicCast here so that we check that the type is correct
    WebCoreType* jsdomURL = dynamicDowncast<WebCoreType>(JSC::JSValue::decode(JSValue0));
    if (jsdomURL == nullptr) {
        return nullptr;
    }

    return reinterpret_cast<OutType*>(&jsdomURL->wrapped());
}

#pragma clang diagnostic pop
