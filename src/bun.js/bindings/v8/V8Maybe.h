#pragma once

namespace v8 {

template<class T>
class Maybe {
public:
    Maybe()
        : m_hasValue(false)
    {
    }
    explicit Maybe(const T& t)
        : m_hasValue(true)
        , m_value(t)
    {
    }
    bool m_hasValue;
    T m_value;
};

template<class T>
inline Maybe<T> Nothing()
{
    return Maybe<T>();
}

template<class T>
inline Maybe<T> Just(const T& t)
{
    return Maybe<T>(t);
}

template<>
class Maybe<void> {
public:
    Maybe()
        : m_hasValue(false)
    {
    }
    explicit Maybe(bool hasValue)
        : m_hasValue(hasValue)
    {
    }
    bool m_hasValue;
};

inline Maybe<void> JustVoid()
{
    return Maybe<void>(true);
}

} // namespace v8
