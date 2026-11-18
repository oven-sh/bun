#include "engine/text/JSONValues.h"

#include <cmath>

extern "C" double engine_number_parse_json(WTF::StringView, size_t& length);

namespace WTF::JSONImpl {

namespace {

template<typename T> class Parser {
public:
    explicit Parser(std::span<const T> text)
        : m_rest(text)
    {
    }

    RefPtr<Value> parse()
    {
        auto value = parseValue(0);
        skipWhitespace();
        return m_rest.empty() ? value : nullptr;
    }

private:
    static constexpr unsigned maximumDepth = 1000;

    void advance(size_t count) { m_rest = m_rest.subspan(count); }

    void skipWhitespace()
    {
        while (!m_rest.empty() && (isTabOrSpace(m_rest[0]) || m_rest[0] == '\n' || m_rest[0] == '\r'))
            advance(1);
    }

    bool skipToken(ASCIILiteral token)
    {
        skipWhitespace();
        if (!StringView { m_rest }.startsWith(token))
            return false;
        advance(token.length());
        return true;
    }

    RefPtr<Value> parseValue(unsigned depth)
    {
        if (depth > maximumDepth)
            return nullptr;
        if (skipToken("\""_s)) {
            auto string = parseRestOfString();
            return string.isNull() ? nullptr : RefPtr { Value::create(string) };
        }
        if (skipToken("{"_s))
            return parseRestOfObject(depth);
        if (skipToken("["_s))
            return parseRestOfArray(depth);
        if (skipToken("null"_s))
            return Value::null();
        if (skipToken("true"_s))
            return Value::create(true);
        if (skipToken("false"_s))
            return Value::create(false);
        size_t length;
        double number = engine_number_parse_json(m_rest, length);
        advance(length);
        return length ? RefPtr { Value::create(number) } : nullptr;
    }

    RefPtr<Value> parseRestOfObject(unsigned depth)
    {
        auto object = Object::create();
        if (skipToken("}"_s))
            return object;
        do {
            auto name = skipToken("\""_s) ? parseRestOfString() : String {};
            if (name.isNull() || !skipToken(":"_s))
                return nullptr;
            auto value = parseValue(depth + 1);
            if (!value)
                return nullptr;
            object->setValue(name, value.releaseNonNull());
        } while (skipToken(","_s));
        return skipToken("}"_s) ? RefPtr<Value> { WTF::move(object) } : nullptr;
    }

    RefPtr<Value> parseRestOfArray(unsigned depth)
    {
        auto array = Array::create();
        if (skipToken("]"_s))
            return array;
        do {
            auto value = parseValue(depth + 1);
            if (!value)
                return nullptr;
            array->pushValue(value.releaseNonNull());
        } while (skipToken(","_s));
        return skipToken("]"_s) ? RefPtr<Value> { WTF::move(array) } : nullptr;
    }

    // Null if it is malformed.
    String parseRestOfString()
    {
        StringBuilder builder;
        while (true) {
            size_t end = find(m_rest, [](T character) { return character == '"' || character == '\\'; });
            if (end == notFound)
                return {};
            builder.append(m_rest.first(end));
            bool isEscape = m_rest[end] == '\\';
            advance(end + 1);
            if (!isEscape)
                return WTF::move(builder).toString();
            auto character = parseRestOfEscape();
            if (!character)
                return {};
            builder.append(*character);
        }
    }

    std::optional<char16_t> parseRestOfEscape()
    {
        if (m_rest.empty())
            return std::nullopt;
        char16_t letter = m_rest[0];
        advance(1);
        if (letter == 'u')
            return parseHexDigits(4);
        if (letter == 'x')
            return parseHexDigits(2);
        size_t index = StringView { "\"/\\bfnrtv"_s }.find(letter);
        return index == notFound ? std::nullopt : std::optional<char16_t> { "\"/\\\b\f\n\r\t\v"[index] };
    }

    std::optional<char16_t> parseHexDigits(size_t count)
    {
        if (m_rest.size() < count)
            return std::nullopt;
        char16_t value = 0;
        for (auto digit : m_rest.first(count)) {
            if (!isASCIIHexDigit(digit))
                return std::nullopt;
            value = value << 4 | toASCIIHexValue(digit);
        }
        advance(count);
        return value;
    }

    std::span<const T> m_rest;
};

}

Ref<Value> Value::null() { return adoptRef(*new Value(Type::Null)); }
Ref<Value> Value::create(bool value) { return adoptRef(*new Value(Type::Boolean, value)); }
Ref<Value> Value::create(int value) { return adoptRef(*new Value(Type::Integer, value)); }
Ref<Value> Value::create(double value) { return adoptRef(*new Value(Type::Double, value)); }
Ref<Value> Value::create(const String& value) { return adoptRef(*new Value(Type::String, 0, value)); }

RefPtr<Value> Value::parseJSON(StringView text)
{
    return text.visitCharacters([](auto characters) { return Parser { characters }.parse(); });
}

void Value::operator delete(Value* value, std::destroying_delete_t)
{
    if (value->m_type == Type::Object)
        static_cast<ObjectBase*>(value)->~ObjectBase();
    else if (value->m_type == Type::Array)
        static_cast<ArrayBase*>(value)->~ArrayBase();
    else
        value->~Value();
    fastFree(value);
}

std::optional<bool> Value::asBoolean() const
{
    return m_type == Type::Boolean ? std::optional<bool> { m_number } : std::nullopt;
}

std::optional<double> Value::asDouble() const
{
    return m_type == Type::Double || m_type == Type::Integer ? std::optional { m_number } : std::nullopt;
}

std::optional<int> Value::asInteger() const
{
    using Limits = std::numeric_limits<int>;
    return asDouble().transform([](double number) { return static_cast<int>(std::fmin(std::fmax(number, Limits::min()), Limits::max())); });
}

bool Value::asDouble(double& result) const
{
    auto value = asDouble();
    result = value.value_or(result);
    return value.has_value();
}

bool Value::asInteger(int& result) const
{
    auto value = asInteger();
    result = value.value_or(result);
    return value.has_value();
}

RefPtr<Object> Value::asObject()
{
    static_assert(sizeof(Object) == sizeof(ObjectBase));
    return m_type == Type::Object ? static_cast<Object*>(this) : nullptr;
}

RefPtr<Array> Value::asArray()
{
    static_assert(sizeof(Array) == sizeof(ArrayBase));
    return m_type == Type::Array ? static_cast<Array*>(this) : nullptr;
}

String Value::toJSONString() const
{
    StringBuilder builder;
    writeJSON(builder);
    return WTF::move(builder).toString();
}

void Value::writeJSON(StringBuilder& builder) const
{
    switch (m_type) {
    case Type::Null:
        return builder.append("null"_s);
    case Type::Boolean:
        return builder.append(m_number ? "true"_s : "false"_s);
    case Type::Integer:
        return builder.append(static_cast<int>(m_number));
    case Type::Double:
        return std::isfinite(m_number) ? builder.append(m_number) : builder.append("null"_s);
    case Type::String:
        return builder.appendQuotedJSONString(m_string);
    case Type::Object: {
        auto& object = *static_cast<const ObjectBase*>(this);
        builder.append('{');
        for (auto& name : object.m_names) {
            if (&name != object.m_names.begin())
                builder.append(',');
            builder.appendQuotedJSONString(name);
            builder.append(':');
            object.m_values.get(name)->writeJSON(builder);
        }
        return builder.append('}');
    }
    case Type::Array: {
        auto& array = *static_cast<const ArrayBase*>(this);
        builder.append('[');
        for (auto& value : array.m_values) {
            if (&value != array.m_values.begin())
                builder.append(',');
            value->writeJSON(builder);
        }
        return builder.append(']');
    }
    }
}

void ObjectBase::setValue(const String& name, Ref<Value>&& value)
{
    if (m_values.set(name, WTF::move(value)).isNewEntry)
        m_names.append(name);
}

std::optional<bool> ObjectBase::getBoolean(const String& name) const
{
    auto* value = m_values.get(name);
    return value ? value->asBoolean() : std::nullopt;
}

std::optional<int> ObjectBase::getInteger(const String& name) const
{
    auto* value = m_values.get(name);
    return value ? value->asInteger() : std::nullopt;
}

std::optional<double> ObjectBase::getDouble(const String& name) const
{
    auto* value = m_values.get(name);
    return value ? value->asDouble() : std::nullopt;
}

String ObjectBase::getString(const String& name) const
{
    auto* value = m_values.get(name);
    return value ? value->asString() : nullString();
}

RefPtr<Object> ObjectBase::getObject(const String& name) const
{
    auto* value = m_values.get(name);
    return value ? value->asObject() : nullptr;
}

RefPtr<Array> ObjectBase::getArray(const String& name) const
{
    auto* value = m_values.get(name);
    return value ? value->asArray() : nullptr;
}

}
