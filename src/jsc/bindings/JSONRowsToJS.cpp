// Builds JS values from the immutable JSON AST rows (`E::JsonTape`, see src/ast/e.rs) that the
// JSON and XML parsers produce: one call for the whole document, keys and short values through
// the VM's JSONAtomStringCache the way JSON.parse does it.

#include "root.h"

#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSONAtomStringCacheInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <wtf/text/ASCIIFastPath.h>
#include <wtf/text/StringBuilder.h>

namespace Bun {
using namespace JSC;

// Mirrors of the `#[repr(C)]` Rust types.
struct __attribute__((packed, aligned(4))) RowStr {
    const Latin1Character* ptr;
    uint32_t len;
    std::span<const Latin1Character> span() const { return { ptr, len }; }
};
static_assert(sizeof(RowStr) == 12);

struct __attribute__((packed, aligned(4))) RowRef {
    const void* ptr;
};

struct __attribute__((packed, aligned(4))) RowNumber {
    double value;
};

struct RowValue {
    enum Tag : uint32_t {
        Null = 0,
        Boolean = 1,
        Number = 2,
        String = 3,
        Object = 4,
        Array = 5,
    };
    Tag tag;
    union {
        bool boolean;
        RowNumber number;
        RowStr string;
        RowRef object;
        RowRef array;
    };
};
static_assert(sizeof(RowValue) == 16);

struct RowProperty {
    RowStr key;
    int32_t keyLoc;
    RowValue value;
};
static_assert(sizeof(RowProperty) == 32);

// `ObjectJSON` / `ArrayJSON`: a span of the tape (only the leading fields are read).
struct RowSpan {
    const void* tape;
    uint32_t first;
    uint32_t count;
};

// Kept in step with the `offset_of!` assertions next to the Rust definitions.
static_assert(offsetof(RowValue, tag) == 0 && offsetof(RowValue, string) == 4);
static_assert(offsetof(RowProperty, key) == 0 && offsetof(RowProperty, keyLoc) == 12 && offsetof(RowProperty, value) == 16);
static_assert(offsetof(RowSpan, tape) == 0 && offsetof(RowSpan, first) == 8 && offsetof(RowSpan, count) == 12);

class RowsToJS {
public:
    RowsToJS(JSGlobalObject* globalObject, const RowProperty* props, const RowValue* items)
        : m_globalObject(globalObject)
        , m_vm(globalObject->vm())
        , m_props(props)
        , m_items(items)
    {
    }

    JSValue value(const RowValue& v)
    {
        switch (v.tag) {
        case RowValue::Null:
            return jsNull();
        case RowValue::Boolean:
            return jsBoolean(v.boolean);
        case RowValue::Number:
            return jsNumber(v.number.value);
        case RowValue::String:
            return string(v.string.span());
        case RowValue::Object:
            return object(*static_cast<const RowSpan*>(v.object.ptr));
        case RowValue::Array:
            return array(*static_cast<const RowSpan*>(v.array.ptr));
        }
        RELEASE_ASSERT_NOT_REACHED();
    }

    JSValue object(const RowSpan& o)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        if (!m_vm.isSafeToRecurse()) [[unlikely]] {
            throwStackOverflowError(m_globalObject, scope);
            return {};
        }
        const RowProperty* rows = m_props + o.first;
        JSObject* object = constructEmptyObject(m_globalObject, m_globalObject->objectPrototype(),
            std::min<unsigned>(o.count, JSFinalObject::maxInlineCapacity));
        for (uint32_t i = 0; i < o.count; ++i) {
            Identifier ident = identifier(rows[i].key.span());
            JSValue v = value(rows[i].value);
            RETURN_IF_EXCEPTION(scope, {});
            if (std::optional<uint32_t> index = parseIndex(ident)) [[unlikely]] {
                object->putDirectIndex(m_globalObject, index.value(), v);
                RETURN_IF_EXCEPTION(scope, {});
            } else
                object->putDirect(m_vm, ident, v);
        }
        return object;
    }

    JSValue array(const RowSpan& a)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        if (!m_vm.isSafeToRecurse()) [[unlikely]] {
            throwStackOverflowError(m_globalObject, scope);
            return {};
        }
        const RowValue* rows = m_items + a.first;
        JSArray* array = constructEmptyArray(m_globalObject, nullptr, a.count);
        RETURN_IF_EXCEPTION(scope, {});
        for (uint32_t i = 0; i < a.count; ++i) {
            JSValue v = value(rows[i]);
            RETURN_IF_EXCEPTION(scope, {});
            array->putDirectIndex(m_globalObject, i, v);
            RETURN_IF_EXCEPTION(scope, {});
        }
        return array;
    }

private:
    ALWAYS_INLINE Identifier identifier(std::span<const Latin1Character> key)
    {
        if (charactersAreAllASCII(key)) [[likely]]
            return Identifier::fromString(m_vm, m_vm.jsonAtomStringCache.makeIdentifier(key));
        return Identifier::fromString(m_vm, decodeWTF8(key));
    }

    ALWAYS_INLINE JSValue string(std::span<const Latin1Character> s)
    {
        if (charactersAreAllASCII(s)) [[likely]] {
            if (JSString* result = m_vm.jsonAtomStringCache.tryMakeJSString(s)) [[likely]]
                return result;
            auto scope = DECLARE_THROW_SCOPE(m_vm);
            throwOutOfMemoryError(m_globalObject, scope);
            return {};
        }
        return jsString(m_vm, decodeWTF8(s));
    }

    // The parsers hand over WTF-8: UTF-8 that may also encode lone surrogates (from JSON
    // `\uD800`-style escapes). Anything malformed becomes U+FFFD, one per offending byte.
    static String decodeWTF8(std::span<const Latin1Character> bytes)
    {
        String strict = String::fromUTF8(bytes);
        if (!strict.isNull()) [[likely]]
            return strict;
        StringBuilder out;
        out.reserveCapacity(bytes.size());
        size_t i = 0;
        while (i < bytes.size()) {
            uint8_t b = bytes[i];
            if (b < 0x80) {
                out.append(static_cast<char16_t>(b));
                i += 1;
                continue;
            }
            size_t n = (b & 0xE0) == 0xC0 ? 2 : (b & 0xF0) == 0xE0 ? 3 : (b & 0xF8) == 0xF0 ? 4 : 0;
            uint32_t cp = n == 2 ? (b & 0x1F) : n == 3 ? (b & 0x0F) : (b & 0x07);
            bool ok = n != 0 && i + n <= bytes.size();
            for (size_t k = 1; ok && k < n; ++k) {
                ok = (bytes[i + k] & 0xC0) == 0x80;
                cp = (cp << 6) | (bytes[i + k] & 0x3F);
            }
            // Overlong forms and values past U+10FFFF are malformed; encoded surrogates
            // (the WTF-8 extension) are kept.
            ok = ok && (n == 2 ? cp >= 0x80 : n == 3 ? cp >= 0x800 : (cp >= 0x10000 && cp <= 0x10FFFF));
            if (!ok) {
                out.append(static_cast<char16_t>(0xFFFD));
                i += 1;
                continue;
            }
            i += n;
            if (cp >= 0x10000) {
                out.append(U16_LEAD(cp));
                out.append(U16_TRAIL(cp));
            } else
                out.append(static_cast<char16_t>(cp));
        }
        return out.toString();
    }

    JSGlobalObject* m_globalObject;
    VM& m_vm;
    const RowProperty* m_props;
    const RowValue* m_items;
};

extern "C" EncodedJSValue Bun__JSONRows__toJS(JSGlobalObject* globalObject, const RowValue* root, const RowProperty* props, const RowValue* items)
{
    RowsToJS converter(globalObject, props, items);
    return JSValue::encode(converter.value(*root));
}

} // namespace Bun
