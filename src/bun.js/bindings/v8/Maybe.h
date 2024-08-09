#pragma once

namespace v8 {

template<class T>
class Maybe {
public:
    Maybe()
        : has_value(false)
    {
    }
    explicit Maybe(const T& t)
        : has_value(true)
        , value(t)
    {
    }
    bool has_value;
    T value;
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

}
