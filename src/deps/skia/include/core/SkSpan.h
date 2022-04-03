/*
 * Copyright 2018 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkSpan_DEFINED
#define SkSpan_DEFINED

#include <cstddef>
#include <iterator>
#include <type_traits>
#include <utility>
#include "include/private/SkTLogic.h"

/**
 * An SkSpan is a view of a contiguous collection of elements of type T. It can be directly
 * constructed from a pointer and size. SkMakeSpan can be used to construct one from an array,
 * or a container (like std::vector).
 *
 * With C++17, we could add template deduction guides that eliminate the need for SkMakeSpan:
 *     https://skia-review.googlesource.com/c/skia/+/320264
 */
template <typename T>
class SkSpan {
public:
    constexpr SkSpan() : fPtr{nullptr}, fSize{0} {}
    constexpr SkSpan(T* ptr, size_t size) : fPtr{ptr}, fSize{size} {
        SkASSERT(size < kMaxSize);
    }
    template <typename U, typename = typename std::enable_if<std::is_same<const U, T>::value>::type>
    constexpr SkSpan(const SkSpan<U>& that) : fPtr(that.data()), fSize{that.size()} {}
    constexpr SkSpan(const SkSpan& o) = default;

    constexpr SkSpan& operator=(const SkSpan& that) {
        fPtr = that.fPtr;
        fSize = that.fSize;
        return *this;
    }
    constexpr T& operator [] (size_t i) const {
        SkASSERT(i < this->size());
        return fPtr[i];
    }
    constexpr T& front() const { return fPtr[0]; }
    constexpr T& back()  const { return fPtr[fSize - 1]; }
    constexpr T* begin() const { return fPtr; }
    constexpr T* end() const { return fPtr + fSize; }
    constexpr auto rbegin() const { return std::make_reverse_iterator(this->end()); }
    constexpr auto rend() const { return std::make_reverse_iterator(this->begin()); }
    constexpr T* data() const { return this->begin(); }
    constexpr size_t size() const { return fSize; }
    constexpr bool empty() const { return fSize == 0; }
    constexpr size_t size_bytes() const { return fSize * sizeof(T); }
    constexpr SkSpan<T> first(size_t prefixLen) const {
        SkASSERT(prefixLen <= this->size());
        return SkSpan{fPtr, prefixLen};
    }
    constexpr SkSpan<T> last(size_t postfixLen) const {
        SkASSERT(postfixLen <= this->size());
        return SkSpan{fPtr + (this->size() - postfixLen), postfixLen};
    }
    constexpr SkSpan<T> subspan(size_t offset, size_t count) const {
        SkASSERT(offset <= this->size());
        SkASSERT(count <= this->size() - offset);
        return SkSpan{fPtr + offset, count};
    }

private:
    static constexpr size_t kMaxSize = std::numeric_limits<size_t>::max() / sizeof(T);
    T* fPtr;
    size_t fSize;
};

template <typename T, typename S> inline constexpr SkSpan<T> SkMakeSpan(T* p, S s) {
    return SkSpan<T>{p, SkTo<size_t>(s)};
}

template <size_t N, typename T> inline constexpr SkSpan<T> SkMakeSpan(T (&a)[N]) {
    return SkSpan<T>{a, N};
}

template <typename Container>
inline auto SkMakeSpan(Container& c)
        -> SkSpan<typename std::remove_reference<decltype(*(c.data()))>::type> {
    return {c.data(), c.size()};
}

#endif  // SkSpan_DEFINED
