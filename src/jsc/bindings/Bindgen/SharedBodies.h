#pragma once
#include "root.h"
#include "Bindgen/JSInterface.h"
#include "JSDOMConvertEnumeration.h"

// What the glue of an `isCold` file is made of. Members that convert alike share a function, which is passed what differs.

#define BINDGEN_OUT_OF_LINE NEVER_INLINE __attribute__((minsize))

namespace Bun::Bindgen {

using RustFunction = void (*)();

// `name` points at a byte that says how far ahead the name is, or at a ComputedName.
WTF::String sharedName(const char* name);
struct ComputedName {
    const char zero { 0 };
    WTF::String (*compute)(const ComputedName&);
};
struct ElementName : ComputedName {
    explicit ElementName(const char* container);
    const char* container;
};
WTF::String describeRange(int64_t min, uint64_t max, const WTF::String& received);
void throwSharedError(JSC::JSGlobalObject&, JSC::ThrowScope&, const char* name, WTF::StringView verb, WTF::StringView predicate, std::optional<ErrorCode>);

// WebConversionContext or LiteralConversionContext, in a register.
template<typename Derived, bool isWeb>
struct SharedContext : Bun::IDLConversionContextBase<Derived> {
    static constexpr std::optional<ErrorCode> typeError = isWeb ? std::nullopt : std::optional { ErrorCode::ERR_INVALID_ARG_TYPE };
    static constexpr std::optional<ErrorCode> rangeError = isWeb ? std::nullopt : std::optional { ErrorCode::ERR_OUT_OF_RANGE };

    explicit constexpr SharedContext(const char* name)
        : m_name(name)
    {
    }

    const char* name() const { return m_name; }
    WTF::String source() const { return sharedName(m_name); }

    template<std::integral Int, std::integral Limit>
    void throwIntegerOutOfRange(JSC::JSGlobalObject& global, JSC::ThrowScope& scope, Int value, Limit min, Limit max) const
    {
        throwRangeErrorWithPredicate(global, scope, describeRange(min, max, WTF::String::number(static_cast<std::conditional_t<std::is_signed_v<Int>, long long, unsigned long long>>(value))));
    }
    template<std::integral Limit>
    void throwBigIntOutOfRange(JSC::JSGlobalObject& global, JSC::ThrowScope& scope, Limit min, Limit max) const { throwRangeErrorWithPredicate(global, scope, describeRange(min, max, {})); }

    void throwTypeMustBe(JSC::JSGlobalObject& global, JSC::ThrowScope& scope, WTF::StringView expected) const { throwSharedError(global, scope, m_name, " must be "_s, expected, typeError); }
    void throwTypeErrorWithPredicate(JSC::JSGlobalObject& global, JSC::ThrowScope& scope, WTF::StringView predicate) const { throwSharedError(global, scope, m_name, " "_s, predicate, typeError); }
    void throwRangeErrorWithPredicate(JSC::JSGlobalObject& global, JSC::ThrowScope& scope, WTF::StringView predicate) const { throwSharedError(global, scope, m_name, " "_s, predicate, rangeError); }
    void throwGenericTypeError(JSC::JSGlobalObject& global, JSC::ThrowScope& scope, WTF::StringView message) const { throwSharedError(global, scope, nullptr, {}, message, typeError); }
    void throwGenericRangeError(JSC::JSGlobalObject& global, JSC::ThrowScope& scope, WTF::StringView message) const { throwSharedError(global, scope, nullptr, {}, message, rangeError); }

private:
    const char* m_name;
};

struct SharedWebContext : SharedContext<SharedWebContext, true> {
    using ElementContext = SharedWebContext;
    using SharedContext::SharedContext;
    static constexpr bool followsWebIDL = true;
};

struct SharedLiteralContext : SharedContext<SharedLiteralContext, false> {
    using ElementContext = Detail::ElementOf<SharedLiteralContext>;
    using SharedContext::SharedContext;
};

// The number of an interface, how many of those that follow extend it, and above that what the callee says.
using Brand = uint32_t;
constexpr unsigned bitsOfInterfaceNumber = 11;
constexpr unsigned bitsOfBrand = 21;
constexpr uint32_t maskOfBrand = (1u << bitsOfBrand) - 1;
enum class Receiver : uint32_t {
    Instance,
    InstanceOrGlobal,
    BehindInstance,
};
constexpr unsigned bitsOfReceiver = 2;

// `brand` has the Receiver. Null if it is something else.
JSC::JSCell* receiverOrNull(JSC::JSGlobalObject*, JSC::EncodedJSValue thisValue, Brand);
// Null if they threw. For a call, `brand` has the number of arguments required above the Receiver.
JSC::JSCell* receiverOfAccessor(JSC::JSGlobalObject*, JSC::EncodedJSValue thisValue, Brand);
JSC::JSCell* receiverOfCall(JSC::JSGlobalObject*, JSC::CallFrame*, Brand);

JSC::EncodedJSValue SYSV_ABI getCachedAttribute(JSC::JSGlobalObject*, JSC::JSCell*, JSC::EncodedJSValue(SYSV_ABI* get)(JSC::JSGlobalObject*, JSC::JSCell*), unsigned offsetOfField);

void forEachInArray(JSC::JSGlobalObject&, JSC::JSObject*, const WTF::ScopedLambda<void(JSC::JSValue)>&);

template<typename IDL> struct ElementOfArray {
};
template<typename IDL> struct ElementOfArray<IDLArray<IDL>> {
    using Type = IDL;
};

// The conversions are false if they threw.
template<typename IDL, typename Ctx>
BINDGEN_OUT_OF_LINE bool convertSlot(JSC::JSGlobalObject* globalObject, JSC::JSValue value, Ctx ctx, void* slot)
{
    auto& result = *static_cast<typename IDL::ImplementationType*>(slot);
    if constexpr (requires { typename ElementOfArray<IDL>::Type; ctx.name(); }) {
        using Element = typename ElementOfArray<IDL>::Type;
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!value.inherits<JSC::JSArray>()) [[unlikely]] {
            ctx.template throwNotArray<Element>(*globalObject, scope);
            return false;
        }
        ElementName name { ctx.name() };
        forEachInArray(*globalObject, JSC::asObject(value), [&](JSC::JSValue next) {
            Ctx ofElement { &name.zero };
            auto scope = DECLARE_THROW_SCOPE(vm);
            auto converted = Bun::convertIDL<Element>(*globalObject, next, ofElement);
            RETURN_IF_EXCEPTION(scope, void());
            result.append(WTF::move(converted));
        });
        RETURN_IF_EXCEPTION(scope, false);
        return true;
    } else
        return Bun::convertIDLInto<IDL>(*globalObject, value, ctx, result);
}
ALWAYS_INLINE bool convertNumber(JSC::JSGlobalObject* globalObject, JSC::JSValue value, double& result)
{
    if (value.isNumber()) [[likely]] {
        result = value.asNumber();
        return true;
    }
    double converted;
    bool succeeded = convertSlot<WebCore::IDLUnrestrictedDouble>(globalObject, value, SharedWebContext { nullptr }, &converted);
    result = converted;
    return succeeded;
}
template<typename IDL, typename Ctx, typename Result>
ALWAYS_INLINE bool convertOutOfLine(JSC::JSGlobalObject* globalObject, JSC::JSValue value, Ctx ctx, Result& result)
{
    static_assert(std::is_same_v<Result, typename IDL::ImplementationType>);
    return convertSlot<IDL, Ctx>(globalObject, value, ctx, &result);
}
template<typename IDL, typename Ctx>
BINDGEN_OUT_OF_LINE bool convertBytesOutOfLine(JSC::JSGlobalObject* globalObject, JSC::JSValue value, Ctx ctx, typename IDL::ImplementationType& result, const char* expected)
{
    return WebCore::Converter<IDL>::convertInto(*globalObject, value, ctx, result, WTF::ASCIILiteral::fromLiteralUnsafe(expected));
}

JSC::JSCell* instanceOrNull(JSC::JSValue, Brand);
WTF::String describeInstanceOf(Brand);
template<typename Ctx>
BINDGEN_OUT_OF_LINE bool convertInstance(JSC::JSGlobalObject* globalObject, JSC::JSValue value, Ctx ctx, void* slot, Brand brand)
{
    if (auto* cell = instanceOrNull(value, brand)) [[likely]] {
        *static_cast<JSC::JSCell**>(slot) = cell;
        return true;
    }
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    ctx.throwTypeMustBe(*globalObject, scope, describeInstanceOf(brand));
    return false;
}

// `spellings` says where those of an enumeration are in Tables::enumerationSpellings.
enum class AnyEnumeration : uint32_t {};
template<> struct ExternTraits<AnyEnumeration> : TrivialExtern<AnyEnumeration> {};
template<> struct ExternTraits<JSC::JSCell*> : TrivialExtern<JSC::JSCell*> {};
std::optional<AnyEnumeration> findSpelling(const WTF::String&, uint32_t spellings);
std::optional<AnyEnumeration> findSpelling(JSC::JSGlobalObject&, JSC::JSValue, uint32_t spellings);
WTF::String describeSpellings(uint32_t spellings);
template<typename Ctx>
BINDGEN_OUT_OF_LINE bool convertEnumeration(JSC::JSGlobalObject* globalObject, JSC::JSValue value, Ctx ctx, void* slot, uint32_t spellings)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    if constexpr (!requires { Ctx::followsWebIDL; }) {
        if (!value.isString() && !value.inherits<JSC::StringObject>()) {
            ctx.throwNotString(*globalObject, scope);
            return false;
        }
    }
    auto found = findSpelling(*globalObject, value, spellings);
    RETURN_IF_EXCEPTION(scope, false);
    if (!found) {
        ctx.throwTypeMustBe(*globalObject, scope, describeSpellings(spellings));
        return false;
    }
    *static_cast<AnyEnumeration*>(slot) = *found;
    return true;
}

// What becomes of `undefined`.
enum class Absent : uint8_t {
    Converted,
    Refused,
    Zero,
};

template<typename Ctx>
struct DictionaryMember {
    using Convert = bool (*)(JSC::JSGlobalObject*, JSC::JSValue, Ctx, void* slot);
    using ConvertWith = bool (*)(JSC::JSGlobalObject*, JSC::JSValue, Ctx, void* slot, uint32_t datum);

    constexpr DictionaryMember(Convert convert, uint16_t offset, Absent absent)
        : convert(convert)
        , offset(offset)
        , absent(absent)
    {
    }
    constexpr DictionaryMember(ConvertWith convertWith, uint16_t offset, Absent absent, uint32_t datum)
        : convertWith(convertWith)
        , offset(offset)
        , absent(absent)
        , hasDatum(true)
        , datum(datum)
    {
    }

    union {
        Convert convert;
        ConvertWith convertWith;
    };
    uint16_t offset;
    Absent absent;
    bool hasDatum { false };
    uint32_t datum { 0 };
};

struct DictionaryDescription {
    enum class Empty : uint8_t {
        Nothing,
        UndefinedAndNull,
        Primitives,
        PrimitivesAndFunctions,
    };
    const char* name;
    // DictionaryMember<SharedWebContext> or DictionaryMember<SharedLiteralContext>.
    const void* members;
    uint16_t size;
    uint16_t firstMemberNameIndex;
    uint8_t memberCount;
    Empty takesAsEmpty;
    bool qualifiesMemberNames;
    bool allowsArray;
    bool isWeb;
    bool readsObjectPrototype;
};
bool convertMembers(JSC::JSGlobalObject&, JSC::JSValue, void* result, const DictionaryDescription&, bool isZeroed = false);

// Room for a dictionary that has nothing to construct or destroy.
struct alignas(8) AnyDictionary {
    char bytes[256];
};
bool convertAnyDictionary(JSC::JSGlobalObject&, JSC::JSValue, AnyDictionary&, const DictionaryDescription&);

static_assert(sizeof(std::optional<double>) == sizeof(ExternOptional<double>) && sizeof(std::optional<bool>) == sizeof(ExternOptional<bool>));

JSC::JSObject* createInterfaceObjectOutOfLine(Zig::GlobalObject*, unsigned number, JSC::Structure*, size_t cellSize, bool needsDestruction);

}
