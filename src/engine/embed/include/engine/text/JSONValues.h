#pragma once

#include "engine/support/HashMap.h"
#include "engine/support/Vector.h"
#include "engine/text/StringBuilder.h"
#include "engine/text/StringHash.h"

#include <optional>

// The namespace is not `JSON`, which code inside of `WTF` would then find twice.
namespace WTF::JSONImpl {

class ArrayBase;
class ObjectBase;

class Value : public RefCounted<Value> {
public:
    enum class Type : uint8_t { Null,
        Boolean,
        Double,
        Integer,
        String,
        Object,
        Array };

    static Ref<Value> null();
    static Ref<Value> create(bool);
    static Ref<Value> create(int);
    static Ref<Value> create(double);
    static Ref<Value> create(const String&);
    static Ref<Value> create(auto) = delete;

    // Null if it is not JSON.
    static RefPtr<Value> parseJSON(StringView);

    void operator delete(Value*, std::destroying_delete_t);

    Type type() const { return m_type; }
    bool isNull() const { return m_type == Type::Null; }

    std::optional<bool> asBoolean() const;
    std::optional<int> asInteger() const;
    std::optional<double> asDouble() const;
    bool asInteger(int&) const;
    bool asDouble(double&) const;
    const String& asString() const LIFETIME_BOUND { return m_string; }
    RefPtr<Object> asObject();
    RefPtr<Array> asArray();

    String toJSONString() const;
    void writeJSON(StringBuilder&) const;

protected:
    explicit Value(Type type, double number = 0, const String& string = {})
        : m_type(type)
        , m_number(number)
        , m_string(string)
    {
    }

private:
    Type m_type;
    // Also of a boolean and of an integer.
    double m_number;
    String m_string;
};

class ObjectBase : public Value {
protected:
    ObjectBase()
        : Value(Type::Object)
    {
    }

    void setInteger(const String& name, int value) { setValue(name, Value::create(value)); }
    void setDouble(const String& name, double value) { setValue(name, Value::create(value)); }
    void setString(const String& name, const String& value) { setValue(name, Value::create(value)); }
    void setObject(const String& name, Ref<ObjectBase>&& value) { setValue(name, WTF::move(value)); }
    inline void setArray(const String& name, Ref<ArrayBase>&&);
    void setValue(const String& name, Ref<Value>&&);

    std::optional<bool> getBoolean(const String& name) const;
    std::optional<int> getInteger(const String& name) const;
    std::optional<double> getDouble(const String& name) const;
    String getString(const String& name) const;
    RefPtr<Object> getObject(const String& name) const;
    RefPtr<Array> getArray(const String& name) const;
    RefPtr<Value> getValue(const String& name) const { return m_values.get(name); }

private:
    friend class Value;

    HashMap<String, Ref<Value>> m_values;
    Vector<String> m_names;
};

class Object : public ObjectBase {
public:
    static Ref<Object> create() { return adoptRef(*new Object); }

    using ObjectBase::getArray;
    using ObjectBase::getBoolean;
    using ObjectBase::getDouble;
    using ObjectBase::getInteger;
    using ObjectBase::getObject;
    using ObjectBase::getString;
    using ObjectBase::getValue;
    using ObjectBase::setArray;
    using ObjectBase::setDouble;
    using ObjectBase::setInteger;
    using ObjectBase::setObject;
    using ObjectBase::setString;
    using ObjectBase::setValue;
};

class ArrayBase : public Value {
public:
    size_t length() const { return m_values.size(); }
    Ref<Value> get(size_t index) const { return m_values[index]; }
    auto begin() const LIFETIME_BOUND { return m_values.begin(); }
    auto end() const LIFETIME_BOUND { return m_values.end(); }

protected:
    ArrayBase()
        : Value(Type::Array)
    {
    }

    void pushBoolean(bool value) { pushValue(Value::create(value)); }
    void pushInteger(int value) { pushValue(Value::create(value)); }
    void pushDouble(double value) { pushValue(Value::create(value)); }
    void pushString(const String& value) { pushValue(Value::create(value)); }
    void pushValue(Ref<Value>&& value) { m_values.append(WTF::move(value)); }

private:
    friend class Value;

    Vector<Ref<Value>> m_values;
};

class Array final : public ArrayBase {
public:
    static Ref<Array> create() { return adoptRef(*new Array); }

    using ArrayBase::pushBoolean;
    using ArrayBase::pushDouble;
    using ArrayBase::pushInteger;
    using ArrayBase::pushString;
    using ArrayBase::pushValue;
};

template<typename T> class ArrayOf final : public ArrayBase {
public:
    static Ref<ArrayOf> create() { return adoptRef(*new ArrayOf); }

    void addItem(int value)
        requires std::same_as<T, int>
    {
        pushInteger(value);
    }

    void addItem(const String& value)
        requires std::same_as<T, String>
    {
        pushString(value);
    }

    void addItem(Ref<Value>&& value)
        requires std::derived_from<T, Value>
    {
        pushValue(WTF::move(value));
    }
};

inline void ObjectBase::setArray(const String& name, Ref<ArrayBase>&& value) { setValue(name, WTF::move(value)); }

}
