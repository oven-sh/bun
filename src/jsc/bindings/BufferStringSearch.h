// Two-Way substring search (Crochemore & Perrin, 1991): guaranteed O(n + m)
// time, O(1) extra space. Used as the safety-net fallback for the SIMD
// substring kernels in highway_strings.cpp when their anchor filter keeps
// firing (adversarial input where both anchor bytes are common in the
// haystack), so Buffer#indexOf / includes / lastIndexOf stay linear even on
// inputs Node's kBMMaxShift-capped Boyer-Moore still goes quadratic on.
//
// Based on the public-domain musl libc implementation (src/string/memmem.c),
// adapted to support 16-bit units and reverse search via the same
// index-reversing Vector trick Node's SearchString uses.

#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace bun {
namespace stringsearch {

template<typename T>
class Vector {
public:
    Vector(const T* data, size_t length, bool isForward)
        : start_(data)
        , length_(length)
        , is_forward_(isForward)
    {
    }

    size_t length() const { return length_; }
    bool forward() const { return is_forward_; }

    T operator[](size_t index) const
    {
        return start_[is_forward_ ? index : (length_ - index - 1)];
    }

private:
    const T* start_;
    size_t length_;
    bool is_forward_;
};

// Critical factorization: on return, *period is the period of the maximal
// suffix and the function returns its start index.
template<typename Char>
static size_t MaximalSuffix(Vector<Char> needle, size_t* period, bool order)
{
    size_t ms = static_cast<size_t>(-1);
    size_t j = 0, k = 1, p = 1;
    const size_t l = needle.length();
    while (j + k < l) {
        Char a = needle[j + k];
        Char b = needle[ms + k];
        if (a == b) {
            if (k == p) {
                j += p;
                k = 1;
            } else {
                k++;
            }
        } else if ((order ? a > b : a < b)) {
            j += k;
            k = 1;
            p = j - ms;
        } else {
            ms = j++;
            k = p = 1;
        }
    }
    *period = p;
    return ms;
}

template<typename Char>
static size_t TwoWay(Vector<Char> haystack, Vector<Char> needle, size_t start_index)
{
    const size_t n = haystack.length();
    const size_t m = needle.length();

    size_t p0, p1;
    size_t ms0 = MaximalSuffix(needle, &p0, true);
    size_t ms1 = MaximalSuffix(needle, &p1, false);
    size_t ms, p;
    if (ms0 + 1 > ms1 + 1) {
        ms = ms0;
        p = p0;
    } else {
        ms = ms1;
        p = p1;
    }

    // Is the needle periodic? (Is needle[0..ms] a prefix of needle[p..p+ms]?)
    // ms may be (size_t)-1, in which case the prefix is empty and the needle
    // is trivially periodic with period p.
    bool periodic = true;
    for (size_t i = 0, e = ms + 1; i < e; i++) {
        if (needle[i] != needle[i + p]) {
            periodic = false;
            break;
        }
    }
    size_t mem0;
    if (periodic) {
        mem0 = m - p;
    } else {
        mem0 = 0;
        p = std::max(ms + 1, m - ms - 1) + 1;
    }

    size_t pos = start_index;
    size_t mem = 0;
    while (pos + m <= n) {
        // Right half: [max(ms+1, mem), m).
        size_t k = std::max(ms + 1, mem);
        while (k < m && needle[k] == haystack[pos + k])
            k++;
        if (k < m) {
            pos += k - ms;
            mem = 0;
            continue;
        }
        // Left half: (mem, ms].
        k = ms + 1;
        while (k > mem && needle[k - 1] == haystack[pos + k - 1])
            k--;
        if (k <= mem) return pos;
        pos += p;
        mem = mem0;
    }
    return n;
}

} // namespace stringsearch

// One-shot entry point matching Node's SearchString in node_buffer.cc.
// Returns the match index in [0, haystack_length - needle_length], or
// haystack_length if not found. Preconditions: needle_length > 0 and
// haystack_length >= needle_length (callers handle empty / oversized needles).
template<typename Char>
size_t SearchString(const Char* haystack, size_t haystack_length,
    const Char* needle, size_t needle_length,
    size_t start_index, bool is_forward)
{
    stringsearch::Vector<Char> v_needle(needle, needle_length, is_forward);
    stringsearch::Vector<Char> v_haystack(haystack, haystack_length, is_forward);
    size_t diff = haystack_length - needle_length;
    size_t relative_start_index;
    if (is_forward) {
        relative_start_index = start_index;
    } else if (diff < start_index) {
        relative_start_index = 0;
    } else {
        relative_start_index = diff - start_index;
    }
    size_t pos = stringsearch::TwoWay(v_haystack, v_needle, relative_start_index);
    if (pos == haystack_length) return haystack_length;
    return is_forward ? pos : (diff - pos);
}

} // namespace bun
