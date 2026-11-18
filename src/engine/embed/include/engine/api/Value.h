#pragma once

// A value of the language, or nothing.

#include "engine/api/CellType.h"

namespace JSC {

inline constexpr uint64_t PNaNAsBits = Engine::Layout::pureNaN;
inline constexpr double PNaN = std::bit_cast<double>(PNaNAsBits);

constexpr double purifyNaN(double value) { return value != value ? PNaN : value; }
constexpr bool isNegativeZero(double value) { return std::bit_cast<uint64_t>(value) == 1ull << 63; }
constexpr uint64_t maxSafeIntegerAsUInt64() { return (1ull << 53) - 1; }
constexpr double maxSafeInteger() { return maxSafeIntegerAsUInt64(); }
constexpr double minSafeInteger() { return -maxSafeInteger(); }
inline bool isSafeInteger(double value) { return std::trunc(value) == value && std::abs(value) <= maxSafeInteger(); }

int32_t toInt32(double);
uint32_t toUInt32(double);
uint64_t toUInt64(double);
int64_t tryConvertToInt52(double);

class JSValue {
public:
    static constexpr int64_t NumberTag = Engine::Layout::numberTag;
    static constexpr int64_t DoubleEncodeOffset = Engine::Layout::doubleOffset;
    static constexpr int32_t OtherTag = Engine::Layout::otherTag;
    static constexpr int32_t BoolTag = Engine::Layout::boolTag;
    static constexpr int32_t UndefinedTag = Engine::Layout::undefinedTag;
    static constexpr int64_t NotCellMask = NumberTag | OtherTag;
    static constexpr int32_t ValueFalse = OtherTag | BoolTag;
    static constexpr int32_t ValueTrue = ValueFalse | 1;
    static constexpr int32_t ValueUndefined = OtherTag | UndefinedTag;
    static constexpr int32_t ValueNull = OtherTag;
    static constexpr int32_t ValueEmpty = 0x0;
    static constexpr int32_t ValueDeleted = 0x4;
    static constexpr int64_t notInt52 = 1ll << 52;

    enum JSNullTag { JSNull };
    enum JSUndefinedTag { JSUndefined };
    enum JSTrueTag { JSTrue };
    enum JSFalseTag { JSFalse };
    enum EncodeAsDoubleTag { EncodeAsDouble };

    static constexpr EncodedJSValue encode(JSValue value) { return value.m_bits; }
    static constexpr JSValue decode(EncodedJSValue bits)
    {
        JSValue value;
        value.m_bits = bits;
        return value;
    }

    constexpr JSValue() = default;
    constexpr JSValue(JSNullTag)
        : m_bits(ValueNull)
    {
    }
    constexpr JSValue(JSUndefinedTag)
        : m_bits(ValueUndefined)
    {
    }
    constexpr JSValue(JSTrueTag)
        : m_bits(ValueTrue)
    {
    }
    constexpr JSValue(JSFalseTag)
        : m_bits(ValueFalse)
    {
    }
    JSValue(JSCell* cell)
        : m_bits(reinterpret_cast<intptr_t>(cell))
    {
    }
    JSValue(const JSCell* cell)
        : m_bits(reinterpret_cast<intptr_t>(cell))
    {
    }
    constexpr JSValue(EncodeAsDoubleTag, double number)
        : m_bits(encodeDouble(number))
    {
    }
    explicit JSValue(double number)
    {
        int32_t integer = truncateOrZero(number);
        m_bits = std::bit_cast<uint64_t>(static_cast<double>(integer)) == std::bit_cast<uint64_t>(number) ? encodeInt32(integer) : encodeDouble(number);
    }
    template<std::integral Integer>
        requires(!std::same_as<Integer, bool>)
    explicit constexpr JSValue(Integer number)
        : m_bits(fitsInt32(number) ? encodeInt32(static_cast<int32_t>(number)) : encodeDouble(static_cast<double>(number)))
    {
    }
    JSValue(bool) = delete;

    explicit constexpr operator bool() const { return m_bits; }
    constexpr bool operator==(const JSValue& other) const { return m_bits == other.m_bits; }

    constexpr bool isEmpty() const { return !m_bits; }
    constexpr bool isUndefined() const { return m_bits == ValueUndefined; }
    constexpr bool isNull() const { return m_bits == ValueNull; }
    constexpr bool isUndefinedOrNull() const { return (m_bits & ~UndefinedTag) == ValueNull; }
    constexpr bool isBoolean() const { return (m_bits & ~1) == ValueFalse; }
    constexpr bool isTrue() const { return m_bits == ValueTrue; }
    constexpr bool isFalse() const { return m_bits == ValueFalse; }
    constexpr bool isNumber() const { return m_bits & NumberTag; }
    constexpr bool isInt32() const { return static_cast<uint64_t>(m_bits) >= static_cast<uint64_t>(NumberTag); }
    constexpr bool isUInt32() const { return isInt32() && asInt32() >= 0; }
    constexpr bool isDouble() const { return isNumber() && !isInt32(); }
    // Also true of the empty value.
    constexpr bool isCell() const { return !(m_bits & NotCellMask); }

    constexpr bool asBoolean() const { return isTrue(); }
    constexpr int32_t asInt32() const { return static_cast<int32_t>(m_bits); }
    constexpr uint32_t asUInt32() const { return static_cast<uint32_t>(m_bits); }
    constexpr double asDouble() const { return std::bit_cast<double>(m_bits - DoubleEncodeOffset); }
    constexpr double asNumber() const { return isInt32() ? asInt32() : asDouble(); }
    JSCell* asCell() const { return reinterpret_cast<JSCell*>(m_bits); }
    JSBigInt* asHeapBigInt() const { return reinterpret_cast<JSBigInt*>(m_bits); }

    bool isAnyInt() const { return isInt32() || (isNumber() && tryConvertToInt52(asDouble()) != notInt52); }
    bool isInt32AsAnyInt() const { return isAnyInt() && fitsInt32(asAnyInt()); }
    bool isUInt32AsAnyInt() const { return isAnyInt() && static_cast<uint64_t>(asAnyInt()) <= UINT32_MAX; }
    int64_t asAnyInt() const { return isInt32() ? asInt32() : static_cast<int64_t>(asDouble()); }
    int32_t asInt32AsAnyInt() const { return static_cast<int32_t>(asAnyInt()); }
    uint32_t asUInt32AsAnyInt() const { return static_cast<uint32_t>(asAnyInt()); }
    bool getUInt32(uint32_t&) const;
    std::optional<int32_t> tryGetAsInt32() const;

    bool isString() const;
    bool isSymbol() const;
    bool isBigInt() const { return isHeapBigInt(); }
    bool isHeapBigInt() const;
    bool isObject() const;
    bool isPrimitive() const { return !isCell() || isString() || isSymbol() || isHeapBigInt(); }
    bool isGetterSetter() const;
    bool isCustomGetterSetter() const;
    bool isCallable() const;
    bool isConstructor() const;
    bool inherits(const ClassInfo*) const;
    template<typename Target> bool inherits() const;
    const ClassInfo* classInfoOrNull() const;
    Structure* structureOrNull() const;
    JSObject* getObject() const;
    String getString(JSGlobalObject*) const;

    TriState pureToBoolean() const;
    bool toBoolean(JSGlobalObject*) const;
    JSValue toPrimitive(JSGlobalObject*, PreferredPrimitiveType = NoPreference) const;
    double toNumber(JSGlobalObject*) const;
    JSValue toNumeric(JSGlobalObject*) const;
    int32_t toInt32(JSGlobalObject*) const;
    uint32_t toUInt32(JSGlobalObject* globalObject) const { return toInt32(globalObject); }
    double toIntegerOrInfinity(JSGlobalObject*) const;
    uint64_t toLength(JSGlobalObject*) const;
    int64_t toBigInt64(JSGlobalObject*) const;
    uint64_t toBigUInt64(JSGlobalObject* globalObject) const { return toBigInt64(globalObject); }
    // The empty string if it throws.
    JSString* toString(JSGlobalObject*) const;
    JSString* toStringOrNull(JSGlobalObject*) const;
    String toWTFString(JSGlobalObject*) const;
    String toWTFStringForConsole(JSGlobalObject*) const;
    Identifier toPropertyKey(JSGlobalObject*) const;
    JSObject* toObject(JSGlobalObject*) const;
    JSValue toThis(JSGlobalObject*, ECMAMode) const;

    JSValue get(JSGlobalObject*, PropertyName) const;
    JSValue get(JSGlobalObject*, unsigned index) const;
    bool getOwnPropertySlot(JSGlobalObject*, PropertyName, PropertySlot&) const;
    bool put(JSGlobalObject*, PropertyName, JSValue, PutPropertySlot&);
    JSValue getPrototype(JSGlobalObject*) const;

    static bool equal(JSGlobalObject*, JSValue, JSValue);
    static bool strictEqual(JSGlobalObject*, JSValue, JSValue);

private:
    template<typename Integer> static constexpr bool fitsInt32(Integer number)
    {
        if constexpr (sizeof(Integer) < sizeof(int32_t))
            return true;
        else if constexpr (std::is_signed_v<Integer>)
            return number == static_cast<int32_t>(number);
        else
            return number <= static_cast<Integer>(INT32_MAX);
    }

    static int32_t truncateOrZero(double number) { return number >= INT32_MIN && number <= INT32_MAX ? static_cast<int32_t>(number) : 0; }
    static constexpr int64_t encodeInt32(int32_t number) { return NumberTag | static_cast<uint32_t>(number); }
    // A boxed NaN is the canonical one.
    static constexpr int64_t encodeDouble(double number) { return std::bit_cast<uint64_t>(purifyNaN(number)) + DoubleEncodeOffset; }

    int64_t m_bits { ValueEmpty };
};

inline bool operator==(const JSValue value, const JSCell* cell) { return value == JSValue(cell); }

constexpr JSValue jsNull() { return JSValue::JSNull; }
constexpr JSValue jsUndefined() { return JSValue::JSUndefined; }
constexpr JSValue jsBoolean(bool value) { return JSValue::decode(JSValue::ValueFalse | value); }
constexpr JSValue jsDoubleNumber(double number) { return JSValue(JSValue::EncodeAsDouble, number); }
constexpr JSValue jsNaN() { return jsDoubleNumber(PNaN); }
ALWAYS_INLINE JSValue jsNumber(double number) { return JSValue(number); }
constexpr JSValue jsNumber(char number) { return JSValue(number); }
constexpr JSValue jsNumber(unsigned char number) { return JSValue(number); }
constexpr JSValue jsNumber(short number) { return JSValue(number); }
constexpr JSValue jsNumber(unsigned short number) { return JSValue(number); }
constexpr JSValue jsNumber(int number) { return JSValue(number); }
constexpr JSValue jsNumber(unsigned number) { return JSValue(number); }
constexpr JSValue jsNumber(long number) { return JSValue(number); }
constexpr JSValue jsNumber(unsigned long number) { return JSValue(number); }
constexpr JSValue jsNumber(long long number) { return JSValue(number); }
constexpr JSValue jsNumber(unsigned long long number) { return JSValue(number); }
constexpr EncodedJSValue encodedJSUndefined() { return JSValue::ValueUndefined; }
constexpr EncodedJSValue encodedJSValue() { return JSValue::ValueEmpty; }

inline int64_t tryConvertToInt52(double number)
{
    constexpr double limit = 1ll << 51;
    if (!(number >= -limit && number < limit) || isNegativeZero(number))
        return JSValue::notInt52;
    int64_t integer = static_cast<int64_t>(number);
    return integer == number ? integer : JSValue::notInt52;
}

inline bool JSValue::getUInt32(uint32_t& result) const
{
    if (isInt32()) {
        result = asUInt32();
        return asInt32() >= 0;
    }
    if (!isDouble() || !(asDouble() >= 0 && asDouble() <= UINT32_MAX))
        return false;
    result = static_cast<uint32_t>(asDouble());
    return result == asDouble();
}

inline std::optional<int32_t> JSValue::tryGetAsInt32() const
{
    if (isInt32())
        return asInt32();
    if (isNumber() && truncateOrZero(asDouble()) == asDouble())
        return truncateOrZero(asDouble());
    return std::nullopt;
}

ALWAYS_INLINE void ensureStillAliveHere(JSValue value) { ensureStillAliveHere(static_cast<uint64_t>(JSValue::encode(value))); }

class EnsureStillAliveScope {
    WTF_FORBID_HEAP_ALLOCATION;
    WTF_MAKE_NONCOPYABLE(EnsureStillAliveScope);

public:
    ALWAYS_INLINE EnsureStillAliveScope(JSValue value)
        : m_value(value)
    {
    }
    ALWAYS_INLINE ~EnsureStillAliveScope() { ensureStillAliveHere(m_value); }
    ALWAYS_INLINE JSValue value() const { return m_value; }

private:
    JSValue m_value;
};

// What a cell owns, for as long as this keeps the cell alive.
template<typename T> class GCOwnedDataScope {
    WTF_FORBID_HEAP_ALLOCATION;

public:
    GCOwnedDataScope() = default;
    GCOwnedDataScope(const JSCell* owner, T data)
        : owner(owner)
        , data(data)
    {
    }
    GCOwnedDataScope(const GCOwnedDataScope&) = default;
    GCOwnedDataScope& operator=(const GCOwnedDataScope&) = default;
    ~GCOwnedDataScope() { ensureStillAliveHere(owner); }

    operator const T() const { return data; }
    operator T() { return data; }
    const std::remove_reference_t<T>* operator->() const { return &data; }
    std::remove_reference_t<T>* operator->() { return &data; }

    const JSCell* owner { nullptr };
    T data {};
};

} // namespace JSC

namespace WTF {

template<> struct VectorTraits<JSC::JSValue> : SimpleClassVectorTraits {};

} // namespace WTF
