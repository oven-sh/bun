// Builds JS values from the immutable JSON AST rows (`E::JsonTape`, see src/ast/e.rs) that the
// JSON and XML parsers produce: one call for the whole document, keys and short values through
// the VM's JSONAtomStringCache the way JSON.parse does it.

#include "root.h"

#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSONAtomStringCacheInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <wtf/text/ASCIIFastPath.h>

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

// `E::StrEncoding`: how the bytes behind every string on one tape are encoded.
enum class RowEncoding : uint8_t {
    Utf8 = 0,
    Latin1 = 1,
    Utf16 = 2,
};

extern "C" EncodedJSValue Bun__JSONRows__wtf8ToJS(JSGlobalObject*, const Latin1Character*, size_t);

template<RowEncoding encoding>
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
            return string(v.string);
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
        JSObject* object = o.count
            ? constructEmptyObject(m_globalObject, m_globalObject->objectPrototype(),
                  std::min<unsigned>(o.count, JSFinalObject::maxInlineCapacity))
            : constructEmptyObject(m_globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        for (uint32_t i = 0; i < o.count; ++i) {
            Identifier ident = identifier(rows[i].key);
            RETURN_IF_EXCEPTION(scope, {});
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
        MarkedArgumentBuffer elements;
        elements.ensureCapacity(a.count);
        for (uint32_t i = 0; i < a.count; ++i) {
            JSValue v = value(rows[i]);
            RETURN_IF_EXCEPTION(scope, {});
            elements.append(v);
        }
        if (elements.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(m_globalObject, scope);
            return {};
        }
        RELEASE_AND_RETURN(scope, constructArray(m_globalObject, static_cast<ArrayAllocationProfile*>(nullptr), elements));
    }

private:
    // The three encodings: Latin-1 and UTF-16 strings are the characters as they stand; UTF-8 is
    // Latin-1 when it is ASCII (nearly always, for keys) and decoded otherwise.

    ALWAYS_INLINE Identifier identifier(const RowStr& key)
    {
        if constexpr (encoding == RowEncoding::Utf16)
            return Identifier::fromString(m_vm, m_vm.jsonAtomStringCache.makeIdentifier(utf16(key)));
        else {
            if (encoding == RowEncoding::Latin1 || charactersAreAllASCII(key.span())) [[likely]]
                return Identifier::fromString(m_vm, m_vm.jsonAtomStringCache.makeIdentifier(key.span()));
            JSValue decoded = utf8(key);
            if (!decoded) [[unlikely]]
                return {};
            return asString(decoded)->toIdentifier(m_globalObject);
        }
    }

    ALWAYS_INLINE JSValue string(const RowStr& s)
    {
        JSString* result;
        if constexpr (encoding == RowEncoding::Utf16)
            result = m_vm.jsonAtomStringCache.tryMakeJSString(utf16(s));
        else {
            if (encoding == RowEncoding::Utf8 && !charactersAreAllASCII(s.span())) [[unlikely]]
                return utf8(s);
            result = m_vm.jsonAtomStringCache.tryMakeJSString(s.span());
        }
        if (!result) [[unlikely]] {
            auto scope = DECLARE_THROW_SCOPE(m_vm);
            throwOutOfMemoryError(m_globalObject, scope);
            return {};
        }
        return result;
    }

    static std::span<const char16_t> utf16(const RowStr& s)
    {
        return { reinterpret_cast<const char16_t*>(s.ptr), s.len / 2 };
    }

    // Non-ASCII UTF-8. Strict first (simdutf); what that rejects is WTF-8 from a JSON escape
    // naming a lone surrogate, which the runtime's WTF-8 path decodes.
    JSValue utf8(const RowStr& s)
    {
        String strict = String::fromUTF8(s.span());
        if (!strict.isNull()) [[likely]]
            return jsString(m_vm, WTF::move(strict));
        return JSValue::decode(Bun__JSONRows__wtf8ToJS(m_globalObject, s.ptr, s.len));
    }

    JSGlobalObject* m_globalObject;
    VM& m_vm;
    const RowProperty* m_props;
    const RowValue* m_items;
};

extern "C" EncodedJSValue Bun__JSONRows__toJS(JSGlobalObject* globalObject, const RowValue* root, const RowProperty* props, const RowValue* items, uint8_t encoding)
{
    switch (static_cast<RowEncoding>(encoding)) {
    case RowEncoding::Latin1:
        return JSValue::encode(RowsToJS<RowEncoding::Latin1>(globalObject, props, items).value(*root));
    case RowEncoding::Utf16:
        return JSValue::encode(RowsToJS<RowEncoding::Utf16>(globalObject, props, items).value(*root));
    case RowEncoding::Utf8:
        break;
    }
    return JSValue::encode(RowsToJS<RowEncoding::Utf8>(globalObject, props, items).value(*root));
}

} // namespace Bun
