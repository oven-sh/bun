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

} // namespace v8
