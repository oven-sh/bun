/*
 * Copyright 2021 Google LLC.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkTOptional_DEFINED
#define SkTOptional_DEFINED

#include "include/core/SkTypes.h"

#include <utility>

namespace skstd {

/**
 * An empty optional is represented with `nullopt`.
 */
struct nullopt_t {
    struct tag {};

    // nullopt_t must not be default-constructible.
    explicit constexpr nullopt_t(tag) {}
};

static constexpr nullopt_t nullopt{nullopt_t::tag{}};

/**
 * Simple drop-in replacement for std::optional until we move to C++17. This does not have all of
 * std::optional's capabilities, but it covers our needs for the time being.
 */
template<typename T>
class optional {
public:
    optional(const T& value)
        : fHasValue(true) {
        new(&fPayload.fValue) T(value);
    }

    optional(T&& value)
        : fHasValue(true) {
        new(&fPayload.fValue) T(std::move(value));
    }

    optional() {}

    optional(const optional& other) {
        *this = other;
    }

    // Construction with nullopt is the same as default construction.
    optional(nullopt_t) : optional() {}

    // We need a non-const copy constructor because otherwise optional(nonConstSrc) isn't an exact
    // match for the copy constructor, and we'd end up invoking the Args&&... template by mistake.
    optional(optional& other) {
        *this = other;
    }

    optional(optional&& other) {
        *this = std::move(other);
    }

    template<typename... Args>
    optional(Args&&... args) {
        fHasValue = true;
        new(&fPayload.fValue) T(std::forward<Args>(args)...);
    }

    ~optional() {
        this->reset();
    }

    optional& operator=(const optional& other) {
        if (this != &other) {
            if (fHasValue) {
                if (other.fHasValue) {
                    fPayload.fValue = other.fPayload.fValue;
                } else {
                    this->reset();
                }
            } else {
                if (other.fHasValue) {
                    fHasValue = true;
                    new (&fPayload.fValue) T(other.fPayload.fValue);
                } else {
                    // do nothing, no value on either side
                }
            }
        }
        return *this;
    }

    optional& operator=(optional&& other) {
        if (this != &other) {
            if (fHasValue) {
                if (other.fHasValue) {
                    fPayload.fValue = std::move(other.fPayload.fValue);
                } else {
                    this->reset();
                }
            } else {
                if (other.fHasValue) {
                    fHasValue = true;
                    new (&fPayload.fValue) T(std::move(other.fPayload.fValue));
                } else {
                    // do nothing, no value on either side
                }
            }
        }
        return *this;
    }

    template<typename... Args>
    optional& emplace(Args&&... args) {
        this->reset();
        fHasValue = true;
        new(&fPayload.fValue) T(std::forward<Args>(args)...);
        return *this;
    }

    template<typename U, typename... Args>
    optional& emplace(std::initializer_list<U> il, Args&&... args) {
        this->reset();
        fHasValue = true;
        new(&fPayload.fValue) T(il, std::forward<Args>(args)...);
        return *this;
    }

    // Assignment to nullopt is the same as reset().
    optional& operator=(nullopt_t) {
        this->reset();
        return *this;
    }

    T& operator*() & {
        SkASSERT(fHasValue);
        return fPayload.fValue;
    }

    const T& operator*() const& {
        SkASSERT(fHasValue);
        return fPayload.fValue;
    }

    T&& operator*() && {
        SkASSERT(fHasValue);
        return std::move(fPayload.fValue);
    }

    const T&& operator*() const&& {
        SkASSERT(fHasValue);
        return std::move(fPayload.fValue);
    }

    const T& value() const& {
        SkASSERT_RELEASE(fHasValue);
        return **this;
    }

    T& value() & {
        SkASSERT_RELEASE(fHasValue);
        return **this;
    }

    const T&& value() const&& {
        SkASSERT_RELEASE(fHasValue);
        return std::move(**this);
    }

    T&& value() && {
        SkASSERT_RELEASE(fHasValue);
        return std::move(**this);
    }

    T* operator->() {
        return &**this;
    }

    const T* operator->() const {
        return &**this;
    }

    template<typename U>
    T value_or(U&& value) const& {
        return this->has_value() ? **this : static_cast<T>(std::forward<U>(value));
    }

    template<typename U>
    T value_or(U&& value) && {
        return this->has_value() ? std::move(**this) : static_cast<T>(std::forward<U>(value));
    }

    bool has_value() const {
        return fHasValue;
    }

    explicit operator bool() const {
        return this->has_value();
    }

    void reset() {
        if (fHasValue) {
            fPayload.fValue.~T();
            fHasValue = false;
        }
    }

private:
    union Payload {
        T fValue;

        Payload() {}

        ~Payload() {}
    } fPayload;

    bool fHasValue = false;
};

// Comparison operators for optional x optional
template <typename T, typename U> bool operator==(const optional<T>& a, const optional<U>& b) {
    return (a.has_value() != b.has_value()) ? false :
                            !a.has_value()  ? true :
                                              (*a == *b);
}

template <typename T, typename U> bool operator!=(const optional<T>& a, const optional<U>& b) {
    return (a.has_value() != b.has_value()) ? true :
                            !a.has_value()  ? false :
                                              (*a != *b);
}

template <typename T, typename U> bool operator<(const optional<T>& a, const optional<U>& b) {
    return !b.has_value() ? false :
           !a.has_value() ? true :
                            (*a < *b);
}

template <typename T, typename U> bool operator<=(const optional<T>& a, const optional<U>& b) {
    return !a.has_value() ? true :
           !b.has_value() ? false :
                            (*a <= *b);
}

template <typename T, typename U> bool operator>(const optional<T>& a, const optional<U>& b) {
    return !a.has_value() ? false :
           !b.has_value() ? true :
                            (*a > *b);
}

template <typename T, typename U> bool operator>=(const optional<T>& a, const optional<U>& b) {
    return !b.has_value() ? true :
           !a.has_value() ? false :
                            (*a >= *b);
}

// Comparison operators for optional x nullopt
template <typename T> bool operator==(const optional<T>& a, nullopt_t) {
    return !a.has_value();
}

template <typename T> bool operator!=(const optional<T>& a, nullopt_t) {
    return a.has_value();
}

template <typename T> bool operator<(const optional<T>&, nullopt_t) {
    return false;
}

template <typename T> bool operator<=(const optional<T>& a, nullopt_t) {
    return !a.has_value();
}

template <typename T> bool operator>(const optional<T>& a, nullopt_t) {
    return a.has_value();
}

template <typename T>
bool operator>=(const optional<T>&, nullopt_t) {
    return true;
}

// Comparison operators for nullopt x optional
template <typename U> bool operator==(nullopt_t, const optional<U>& b) {
    return !b.has_value();
}

template <typename U> bool operator!=(nullopt_t, const optional<U>& b) {
    return b.has_value();
}

template <typename U> bool operator<(nullopt_t, const optional<U>& b) {
  return b.has_value();
}

template <typename U> bool operator<=(nullopt_t, const optional<U>&) {
    return true;
}

template <typename U> bool operator>(nullopt_t, const optional<U>&) {
    return false;
}

template <typename U> bool operator>=(nullopt_t, const optional<U>& b) {
    return !b.has_value();
}

// Comparison operators for optional x value
template <typename T, typename U> bool operator==(const optional<T>& a, const U& b) {
    return a.has_value() && (*a == b);
}

template <typename T, typename U> bool operator!=(const optional<T>& a, const U& b) {
    return !a.has_value() || (*a != b);
}

template <typename T, typename U> bool operator<(const optional<T>& a, const U& b) {
    return !a.has_value() || (*a < b);
}

template <typename T, typename U> bool operator<=(const optional<T>& a, const U& b) {
    return !a.has_value() || (*a <= b);
}

template <typename T, typename U> bool operator>(const optional<T>& a, const U& b) {
  return a.has_value() && (*a > b);
}

template <typename T, typename U> bool operator>=(const optional<T>& a, const U& b) {
  return a.has_value() && (*a >= b);
}

// Comparison operators for value x optional
template <typename T, typename U> bool operator==(const T& a, const optional<U>& b) {
    return b.has_value() && (a == *b);
}

template <typename T, typename U> bool operator!=(const T& a, const optional<U>& b) {
    return !b.has_value() || (a != *b);
}

template <typename T, typename U> bool operator<(const T& a, const optional<U>& b) {
    return b.has_value() && (a < *b);
}

template <typename T, typename U> bool operator<=(const T& a, const optional<U>& b) {
    return b.has_value() && (a <= *b);
}

template <typename T, typename U> bool operator>(const T& a, const optional<U>& b) {
    return !b.has_value() || (a > *b);
}

template <typename T, typename U> bool operator>=(const T& a, const optional<U>& b) {
    return !b.has_value() || (a >= *b);
}

} // namespace skstd

#endif
