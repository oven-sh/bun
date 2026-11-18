#pragma once

// The primitive values that are cells, the objects that wrap them, and conversions.

#include "engine/api/Object.h"

namespace JSC {

class JSString : public JSCell {
public:
    ENGINE_DECLARE_CLASS(String)

    static constexpr unsigned MaxLength = StringImpl::MaxLength;
    static constexpr uintptr_t isRopeInPointer = Engine::Layout::isRope;
    static constexpr ptrdiff_t offsetOfValue() { return Engine::Layout::JsString_fiber; }

    bool isRope() const { return m_fiber & isRopeInPointer; }
    bool isSubstring() const { return m_fiber & Engine::Layout::ropeIsSubstring; }
    bool isNonSubstringRope() const { return isRope() && !isSubstring(); }
    bool is8Bit() const { return isRope() ? m_fiber & Engine::Layout::ropeIsLatin1 : resolved().impl()->is8Bit(); }
    unsigned length() const { return isRope() ? Engine::fieldAt<uint32_t>(this, Engine::Layout::JsRopeString_length) : resolved().impl()->length(); }

    // These put a rope together, which can run out of memory.
    ALWAYS_INLINE GCOwnedDataScope<const String&> value(JSGlobalObject* globalObject) const
    {
        if (isRope() && !Engine::string_resolve(this, globalObject)) [[unlikely]]
            return { this, nullString() };
        return { this, resolved() };
    }
    GCOwnedDataScope<const String&> tryGetValue(bool allocationAllowed = true) const
    {
        if (isRope() && !(allocationAllowed && Engine::string_try_resolve(this, vm()))) [[unlikely]]
            return { this, nullString() };
        return { this, resolved() };
    }
    GCOwnedDataScope<StringView> view(JSGlobalObject*) const;
    String tryGetValueWithoutGC() const { return Engine::string_without_resolving(this); }
    StringImpl* tryGetValueImpl() const { return isRope() ? nullptr : resolved().impl(); }
    template<typename Character> void resolveToBuffer(std::span<Character>) const;

    Identifier toIdentifier(JSGlobalObject* globalObject) const { return Identifier::fromUid(getVM(globalObject), toAtomString(globalObject).data); }
    GCOwnedDataScope<AtomStringImpl*> toAtomString(JSGlobalObject* globalObject) const
    {
        if (perCellBit())
            return { this, static_cast<AtomStringImpl*>(resolved().impl()) };
        return { this, static_cast<AtomStringImpl*>(Engine::string_to_atom(this, globalObject, ENGINE_THROWS_ONLY_IF(isRope()))) };
    }
    GCOwnedDataScope<AtomStringImpl*> toExistingAtomString(JSGlobalObject* globalObject) const { return { this, static_cast<AtomStringImpl*>(Engine::string_to_existing_atom(this, globalObject, ENGINE_THROWS_ONLY_IF(isRope()))) }; }
    double toNumber(JSGlobalObject* globalObject) const { return Engine::value_to_number(this, globalObject); }
    bool equal(JSGlobalObject* globalObject, JSString* other) const
    {
        if (isRope() || other->isRope()) [[unlikely]]
            return Engine::string_equals(this, globalObject, other);
        return WTF::equal(resolved().impl(), other->resolved().impl());
    }

protected:
    const String& resolved() const { return *reinterpret_cast<const String*>(&m_fiber); }

    uintptr_t m_fiber;
};
ENGINE_CLASS_HAS_TYPE(JSString, StringType);

// A concatenation of two or three strings, or a part of one.
class JSRopeString final : public JSString {
public:
    static constexpr uintptr_t isSubstringInPointer = Engine::Layout::ropeIsSubstring;
    static constexpr ptrdiff_t offsetOfLength() { return Engine::Layout::JsRopeString_length; }
    static constexpr ptrdiff_t offsetOfFiber1Lower() { return offsetOfLength() + sizeof(uint32_t); }
    static constexpr ptrdiff_t offsetOfFiber2() { return Engine::Layout::JsRopeString_fiber2; }
    static constexpr ptrdiff_t offsetOfFiber2Lower() { return offsetOfFiber2() + sizeof(uint16_t); }

    struct CompactFibers {
        static constexpr uint64_t addressMask = (1ull << 48) - 1;
        static constexpr unsigned shiftOfFiber2InUpperWord = 16;
    };

    // The pieces of a string from the first to the last. Nothing may be allocated in the heap meanwhile.
    class LeafIterator {
    public:
        explicit LeafIterator(const JSString* string) { m_pending.append(string); }

        bool isAtEnd() const { return m_pending.isEmpty(); }
        StringView next()
        {
            const JSString* string = m_pending.takeLast();
            while (string->isNonSubstringRope()) {
                auto* rope = static_cast<const JSRopeString*>(string);
                if (rope->fiber2())
                    m_pending.append(reinterpret_cast<const JSString*>(rope->fiber2()));
                m_pending.append(rope->fiber1());
                string = rope->fiber0();
            }
            return string->isRope() ? static_cast<const JSRopeString*>(string)->substringView() : StringView(string->tryGetValueImpl());
        }

    private:
        Vector<const JSString*, 16> m_pending;
    };

private:
    friend class JSString;

    JSString* fiber0() const { return reinterpret_cast<JSString*>(m_fiber & ~Engine::Layout::ropeFlags); }
    JSString* fiber1() const { return reinterpret_cast<JSString*>(m_lengthAndFiber1 >> 32 | (m_fiber1AndFiber2 & 0xffff) << 32); }
    uintptr_t fiber2() const { return m_fiber1AndFiber2 >> CompactFibers::shiftOfFiber2InUpperWord; }
    StringView substringView() const { return StringView(fiber1()->tryGetValueImpl()).substring(fiber2(), length()); }

    uint64_t m_lengthAndFiber1;
    uint64_t m_fiber1AndFiber2;
};
ENGINE_CHECK_SIZE(JSRopeString, sizeOfJsRopeString);

ALWAYS_INLINE GCOwnedDataScope<StringView> JSString::view(JSGlobalObject* globalObject) const
{
    if (isRope()) [[unlikely]] {
        if (isSubstring())
            return { static_cast<const JSRopeString*>(this)->fiber1(), static_cast<const JSRopeString*>(this)->substringView() };
        if (!Engine::string_resolve(this, globalObject))
            return { this, StringView() };
    }
    return { this, StringView(resolved()) };
}

template<typename Character> void JSString::resolveToBuffer(std::span<Character> buffer) const
{
    for (JSRopeString::LeafIterator leaves(this); !leaves.isAtEnd();) {
        StringView leaf = leaves.next();
        leaf.getCharacters(buffer);
        buffer = buffer.subspan(leaf.length());
    }
}

ALWAYS_INLINE JSString* asString(JSValue value)
{
    ASSERT(value.isString());
    return static_cast<JSString*>(value.asCell());
}

ALWAYS_INLINE JSString* jsEmptyString(VM& vm) { return vm.smallStrings.emptyString(); }
ALWAYS_INLINE JSString* jsSingleCharacterString(VM& vm, Latin1Character character) { return vm.smallStrings.singleCharacterString(character); }
inline JSString* jsString(VM& vm, String&& string) { return Engine::string_create(vm, WTF::move(string)); }
inline JSString* jsString(VM& vm, const String& string) { return Engine::string_create_retaining(vm, string); }
inline JSString* jsString(VM& vm, AtomString&& string) { return jsString(vm, string.string()); }
inline JSString* jsString(VM& vm, const AtomString& string) { return jsString(vm, string.string()); }
inline JSString* jsString(VM& vm, StringView string) { return jsString(vm, string.toString()); }
inline JSString* jsNontrivialString(VM& vm, String&& string) { return jsString(vm, WTF::move(string)); }
inline JSString* jsNontrivialString(VM& vm, const String& string) { return jsString(vm, string); }
inline JSString* jsOwnedString(VM& vm, const String& string) { return jsString(vm, string); }
inline JSString* jsStringWithCache(VM& vm, const String& string) { return Engine::string_create_cached(vm, string); }
inline JSString* jsString(JSGlobalObject* globalObject, JSString* a, JSString* b) { return Engine::string_concat(globalObject, a, b); }
inline JSString* jsString(JSGlobalObject* globalObject, JSString* a, JSString* b, JSString* c) { return Engine::string_concat3(globalObject, a, b, c); }
inline JSString* jsSubstring(JSGlobalObject* globalObject, JSString* string, unsigned offset, unsigned length) { return Engine::string_substring(string, globalObject, offset, length); }
inline JSString* jsSubstringOfResolved(VM& vm, JSString* string, unsigned offset, unsigned length) { return Engine::string_substring_of_resolved(string, vm, offset, length); }
inline JSString* numberToString(VM& vm, double number, int32_t radix) { return Engine::number_to_string(vm, number, radix); }
inline double jsToNumber(StringView string) { return Engine::text_to_number(string); }

template<typename Character> bool isStrWhiteSpace(Character character) { return Engine::is_str_white_space(character); }

enum class ErrorTypeWithExtension : uint8_t { OutOfMemoryError };

class Symbol final : public JSCell {
public:
    ENGINE_DECLARE_CLASS(Symbol)

    static Symbol* create(VM& vm) { return Engine::symbol_create(vm, String()); }
    static Symbol* createWithDescription(VM& vm, const String& description) { return Engine::symbol_create(vm, description.isNull() ? emptyString() : description); }
    // The one cell that stands for it.
    static Symbol* create(VM& vm, SymbolImpl& uid) { return asSymbolCell(Engine::value_from_name(vm, &uid)); }

    SymbolImpl& uid() const { return *Engine::fieldAt<SymbolImpl*>(this, Engine::Layout::JsSymbol_symbol); }
    GCOwnedDataScope<const PrivateName&> privateName() const { return { this, Engine::fieldAt<PrivateName>(this, Engine::Layout::JsSymbol_symbol) }; }
    std::expected<String, ErrorTypeWithExtension> tryGetDescriptiveString() const
    {
        if (String string = Engine::symbol_descriptive_string(this); !string.isNull())
            return string;
        return std::unexpected(ErrorTypeWithExtension::OutOfMemoryError);
    }

private:
    static Symbol* asSymbolCell(JSValue value) { return static_cast<Symbol*>(value.asCell()); }
};
ENGINE_CLASS_HAS_TYPE(Symbol, SymbolType);

inline Symbol* asSymbol(JSValue value)
{
    ASSERT(value.isSymbol());
    return static_cast<Symbol*>(value.asCell());
}

enum class JSBigIntComparisonResult : uint8_t { Equal,
    Undefined,
    GreaterThan,
    LessThan };

class JSBigInt final : public JSCell {
public:
    using Digit = uint64_t;
    using ComparisonResult = JSBigIntComparisonResult;
    enum class ErrorParseMode { IgnoreExceptions };
    enum class ParseIntSign { Unsigned };

    ENGINE_DECLARE_CLASS(BigInt)

    static JSBigInt* createFrom(JSGlobalObject* globalObject, int64_t value) { return Engine::bigint_from_i64(getVM(globalObject), value); }
    static JSBigInt* createFrom(JSGlobalObject* globalObject, uint64_t value) { return Engine::bigint_from_u64(getVM(globalObject), value); }
    static JSBigInt* createFrom(JSGlobalObject* globalObject, Int128 value)
    {
        UInt128 magnitude = value < 0 ? -static_cast<UInt128>(value) : static_cast<UInt128>(value);
        const Digit digits[] = { static_cast<Digit>(magnitude), static_cast<Digit>(magnitude >> 64) };
        return createFromWords(globalObject, digits, value < 0);
    }
    static JSBigInt* createFromWords(JSGlobalObject* globalObject, std::span<const uint64_t> digits, bool sign) { return Engine::bigint_from_digits(globalObject, digits, sign); }
    static JSBigInt* tryCreateFrom(JSGlobalObject* globalObjectToThrowIn, VM& vm, bool sign, std::span<const Digit> digits) { return globalObjectToThrowIn ? createFromWords(globalObjectToThrowIn, digits, sign) : Engine::bigint_try_from_digits(vm, digits, sign); }
    static JSBigInt* tryCreateZero(VM& vm) { return Engine::bigint_from_i64(vm, 0); }
    // Empty if the text is no such number.
    static JSValue parseInt(JSGlobalObject* globalObject, VM&, StringView text, uint8_t radix, ErrorParseMode, ParseIntSign)
    {
        ASSERT_UNUSED(radix, radix == 16);
        return Engine::bigint_from_hexadecimal(globalObject, text);
    }
    static JSValue stringToBigInt(JSGlobalObject* globalObject, StringView text) { return Engine::bigint_from_text(globalObject, text); }

    unsigned length() const { return Engine::fieldAt<uint32_t>(this, Engine::Layout::JsBigInt_length); }
    bool sign() const { return Engine::fieldAt<bool>(this, Engine::Layout::JsBigInt_sign); }
    bool isZero() const { return !length(); }
    Digit digit(unsigned index) const { return digits()[index]; }
    size_t toWordsArray(std::span<uint64_t> words) const
    {
        size_t count = std::min<size_t>(words.size(), length());
        std::ranges::copy(digits().first(count), words.begin());
        return count;
    }
    String toString(JSGlobalObject* globalObject, unsigned radix) { return Engine::bigint_to_string(this, globalObject, radix); }

    static uint64_t toBigUInt64(JSValue value)
    {
        auto* bigInt = value.asHeapBigInt();
        uint64_t low = bigInt->isZero() ? 0 : bigInt->digit(0);
        return bigInt->sign() ? -low : low;
    }
    static int64_t toBigInt64(JSValue value) { return toBigUInt64(value); }
    static JSValue toNumber(JSValue value) { return jsNumber(Engine::bigint_to_number(value.asHeapBigInt())); }

    static ComparisonResult compare(JSBigInt* x, JSBigInt* y) { return compare(x, y->sign(), y->digits()); }
    static ComparisonResult compare(JSBigInt* x, int64_t y)
    {
        Digit magnitude = y < 0 ? -static_cast<Digit>(y) : y;
        return compare(x, y < 0, std::span(&magnitude, !!y));
    }
    static ComparisonResult compare(JSBigInt* x, uint64_t y) { return compare(x, false, std::span(&y, !!y)); }
    static ComparisonResult compare(JSValue x, JSValue y) { return compare(x.asHeapBigInt(), y.asHeapBigInt()); }
    static ComparisonResult compare(JSValue x, int64_t y) { return compare(x.asHeapBigInt(), y); }
    static ComparisonResult compare(JSValue x, uint64_t y) { return compare(x.asHeapBigInt(), y); }
    static ComparisonResult compareToDouble(JSBigInt* x, double y)
    {
        if (std::isnan(y))
            return ComparisonResult::Undefined;
        return fromOrdering(Engine::bigint_compare_to_number(x, y));
    }

private:
    std::span<const Digit> digits() const { return { &Engine::fieldAt<const Digit>(this, Engine::Layout::JsBigInt_digits), length() }; }

    static ComparisonResult fromOrdering(int ordering) { return !ordering ? ComparisonResult::Equal : ordering > 0 ? ComparisonResult::GreaterThan
                                                                                                                   : ComparisonResult::LessThan; }
    static ComparisonResult compare(JSBigInt* x, bool ySign, std::span<const Digit> y)
    {
        if (x->sign() != ySign)
            return fromOrdering(ySign ? 1 : -1);
        int ordering = (x->length() > y.size()) - (x->length() < y.size());
        for (size_t i = y.size(); !ordering && i--;)
            ordering = (x->digit(i) > y[i]) - (x->digit(i) < y[i]);
        return fromOrdering(ySign ? -ordering : ordering);
    }
};
ENGINE_CLASS_HAS_TYPE(JSBigInt, HeapBigIntType);

class JSWrapperObject : public JSNonFinalObject {
public:
    ENGINE_DECLARE_CLASS(WrapperObject)

    JSValue internalValue() const { return m_internalValue.get(); }
    void setInternalValue(VM& vm, JSValue value) { m_internalValue.set(vm, this, value); }

private:
    static void checkLayout();

    WriteBarrier<Unknown> m_internalValue;
};

inline void JSWrapperObject::checkLayout() { ENGINE_CHECK_OFFSET(JSWrapperObject, m_internalValue, JsWrapperObject_internal_value); }

class StringObject : public JSWrapperObject {
public:
    ENGINE_DECLARE_CLASS(StringObject)

    JSString* internalValue() const { return asString(JSWrapperObject::internalValue()); }
};
ENGINE_CLASS_HAS_TYPES(StringObject, StringObjectType, DerivedStringObjectType);

inline StringObject* constructString(VM&, JSGlobalObject* globalObject, JSValue string) { return static_cast<StringObject*>(asString(string)->toObject(globalObject)); }

class NumberObject : public JSWrapperObject {
public:
    ENGINE_DECLARE_CLASS(NumberObject)
};
ENGINE_CLASS_HAS_TYPE(NumberObject, NumberObjectType);

inline NumberObject* constructNumber(JSGlobalObject* globalObject, JSValue number) { return static_cast<NumberObject*>(Engine::value_to_object(number, globalObject, ENGINE_THROWS_ONLY_IF(!number.isNumber()))); }

class BooleanObject : public JSWrapperObject {
public:
    ENGINE_DECLARE_CLASS(BooleanObject)

    static BooleanObject* create(VM& vm, Structure* structure) { return Engine::boolean_object_create(vm, structure); }
};
ENGINE_CLASS_HAS_TYPE(BooleanObject, BooleanObjectType);

class SymbolObject final : public JSWrapperObject {
public:
    ENGINE_DECLARE_CLASS(SymbolObject)
};

class BigIntObject final : public JSWrapperObject {
public:
    ENGINE_DECLARE_CLASS(BigIntObject)

    static BigIntObject* create(VM&, JSGlobalObject* globalObject, JSValue bigInt) { return static_cast<BigIntObject*>(bigInt.toObject(globalObject)); }
};

inline Identifier Identifier::fromString(VM&, ASCIILiteral literal) { return Engine::identifier_from_literal(literal); }
inline Identifier Identifier::from(VM&, unsigned index) { return Engine::identifier_from_index(index); }
inline JSValue identifierToJSValue(VM& vm, const Identifier& identifier) { return Engine::value_from_name(vm, identifier); }
inline JSValue identifierToSafePublicJSValue(VM& vm, const Identifier& identifier) { return identifier.isPrivateName() ? jsString(vm, String(identifier.impl()->isolatedCopy())) : identifierToJSValue(vm, identifier); }

inline int32_t toInt32(double number)
{
    if (number >= INT32_MIN && number <= INT32_MAX) [[likely]]
        return static_cast<int32_t>(number);
    return Engine::number_to_int32(number);
}
inline uint32_t toUInt32(double number) { return toInt32(number); }
inline uint64_t toUInt64(double number) { return Engine::number_to_uint64(number); }
inline double operationMathPow(double base, double exponent) { return Engine::number_pow(base, exponent); }

inline String JSCell::getString(JSGlobalObject* globalObject) const { return isString() ? static_cast<const JSString*>(this)->value(globalObject).data : String(); }
inline String JSValue::getString(JSGlobalObject* globalObject) const { return isCell() ? asCell()->getString(globalObject) : String(); }

inline TriState JSValue::pureToBoolean() const
{
    if (isInt32())
        return triState(asInt32());
    if (isDouble())
        return triState(asDouble() > 0.0 || asDouble() < 0.0);
    if (!isCell() || isEmpty())
        return triState(isTrue());
    if (isString())
        return triState(asString(*this)->length());
    if (isHeapBigInt())
        return triState(!asHeapBigInt()->isZero());
    return isSymbol() ? TriState::True : TriState::Indeterminate;
}

ALWAYS_INLINE bool JSValue::toBoolean(JSGlobalObject*) const { return isBoolean() ? isTrue() : pureToBoolean() != TriState::False; }
inline JSValue JSValue::toPrimitive(JSGlobalObject* globalObject, PreferredPrimitiveType preferred) const { return isObject() ? Engine::value_to_primitive(*this, globalObject, preferred) : *this; }
ALWAYS_INLINE double JSValue::toNumber(JSGlobalObject* globalObject) const { return isNumber() ? asNumber() : Engine::value_to_number(*this, globalObject); }
inline JSValue JSValue::toNumeric(JSGlobalObject* globalObject) const { return isNumber() ? *this : Engine::value_to_numeric(*this, globalObject); }
ALWAYS_INLINE int32_t JSValue::toInt32(JSGlobalObject* globalObject) const { return isInt32() ? asInt32() : JSC::toInt32(toNumber(globalObject)); }
inline double JSValue::toIntegerOrInfinity(JSGlobalObject* globalObject) const
{
    if (isInt32())
        return asInt32();
    double number = toNumber(globalObject);
    return std::isnan(number) ? 0.0 : std::trunc(number) + 0.0;
}
inline uint64_t JSValue::toLength(JSGlobalObject* globalObject) const { return std::clamp(toIntegerOrInfinity(globalObject), 0.0, maxSafeInteger()); }
inline int64_t JSValue::toBigInt64(JSGlobalObject* globalObject) const { return Engine::value_to_bigint64(*this, globalObject); }
ALWAYS_INLINE JSString* JSValue::toString(JSGlobalObject* globalObject) const { return isString() ? asString(*this) : Engine::value_to_string_or_empty(*this, globalObject); }
ALWAYS_INLINE JSString* JSValue::toStringOrNull(JSGlobalObject* globalObject) const { return isString() ? asString(*this) : Engine::value_to_string(*this, globalObject); }
ALWAYS_INLINE String JSValue::toWTFString(JSGlobalObject* globalObject) const
{
    if (isString())
        return asString(*this)->value(globalObject).data;
    return Engine::value_to_string_ref(*this, globalObject);
}
inline String JSValue::toWTFStringForConsole(JSGlobalObject* globalObject) const { return Engine::value_to_string_for_console(*this, globalObject); }
inline Identifier JSValue::toPropertyKey(JSGlobalObject* globalObject) const { return Engine::value_to_property_key(*this, globalObject); }
ALWAYS_INLINE JSObject* JSValue::toObject(JSGlobalObject* globalObject) const { return isObject() ? asObject(*this) : Engine::value_to_object(*this, globalObject, ENGINE_THROWS_ONLY_IF(!isCell())); }
ALWAYS_INLINE JSValue JSValue::toThis(JSGlobalObject* globalObject, ECMAMode mode) const
{
    if (!mode.isStrict())
        return Engine::value_to_sloppy_this(*this, globalObject);
    return isCell() && asCell()->type() == GlobalObjectType ? jsUndefined() : *this;
}

inline JSValue JSValue::get(JSGlobalObject* globalObject, PropertyName name) const { return Engine::value_get(*this, globalObject, name); }
inline JSValue JSValue::get(JSGlobalObject* globalObject, unsigned index) const { return Engine::value_get_index(*this, globalObject, index); }
inline bool JSValue::getOwnPropertySlot(JSGlobalObject* globalObject, PropertyName name, PropertySlot& slot) const { return Engine::value_get_own_property_slot(*this, globalObject, name, slot); }
inline bool JSValue::put(JSGlobalObject* globalObject, PropertyName name, JSValue value, PutPropertySlot& slot) { return Engine::value_put(*this, globalObject, name, value, slot); }
inline JSValue JSValue::getPrototype(JSGlobalObject* globalObject) const { return isObject() ? asObject(*this)->getPrototype(globalObject) : Engine::value_get_prototype_of(*this, globalObject, ENGINE_THROWS_ONLY_IF(isUndefinedOrNull())); }

inline bool JSValue::equal(JSGlobalObject* globalObject, JSValue a, JSValue b) { return a.isInt32() && b.isInt32() ? a == b : Engine::value_loose_equals(a, globalObject, b); }
inline bool JSValue::strictEqual(JSGlobalObject* globalObject, JSValue a, JSValue b)
{
    if (a.isNumber() && b.isNumber())
        return a.asNumber() == b.asNumber();
    if (a == b)
        return true;
    if (!a.isCell() || !b.isCell() || !a || !b)
        return false;
    if (a.isString() && b.isString())
        return asString(a)->equal(globalObject, asString(b));
    return a.isHeapBigInt() && b.isHeapBigInt() && JSBigInt::compare(a, b) == JSBigInt::ComparisonResult::Equal;
}
inline bool sameValueZero(JSGlobalObject* globalObject, JSValue a, JSValue b) { return a == b || JSValue::strictEqual(globalObject, a, b); }
inline bool sameValue(JSGlobalObject* globalObject, JSValue a, JSValue b)
{
    if (a.isNumber() && b.isNumber())
        return std::bit_cast<uint64_t>(a.asNumber()) == std::bit_cast<uint64_t>(b.asNumber());
    return JSValue::strictEqual(globalObject, a, b);
}

inline JSValue jsAdd(JSGlobalObject* globalObject, JSValue a, JSValue b) { return a.isNumber() && b.isNumber() ? jsNumber(a.asNumber() + b.asNumber()) : Engine::value_add(globalObject, a, b); }
inline JSString* jsTypeStringForValue(JSGlobalObject* globalObject, JSValue value) { return Engine::value_type_of(value, globalObject); }
inline bool jsTypeofIsFunction(JSGlobalObject*, JSValue value) { return value.isCallable(); }
inline bool jsTypeofIsObject(JSGlobalObject*, JSValue value) { return value.isNull() || (value.isObject() && !value.isCallable()); }

inline constexpr ASCIILiteral SymbolCoercionError = "Cannot convert a symbol to a string"_s;

} // namespace JSC
